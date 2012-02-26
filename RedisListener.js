var redis = require("redis");
var timer = require("timers");
var config = require("./config").config;

var max_chans = config.redis.listener.max_channels;
if (!max_chans) {
	max_chans = 16;
}

var rlctr = 0;
function RedisListener (pool)
{
	this.id = rlctr++;
	this.chan_set = {};
	this.chan_sub_count = {};
	this.nr_chans = 0;
	this.pool = pool;
	this.redis_ready = false;
	this.connect();
}

exports.RedisListener = RedisListener;

RedisListener.prototype.connect = function ()
{
	global.trace("RedisListener " + this.id + ": Attempting connect");

	// No pinging should take place until we enter the idle state
	this.stopPingTimer();

	// Create redis connection
	var rc = global.newRedisClient();

	// Error handler
	var rl = this;
	rc.on("error", function (err) {
		console.warn("RedisListener " + rl.id + " error: " + err);
	});

	// Notifies of connection
	rc.on("connect", function () {
		global.trace("RedisListener " + rl.id + ": Connected to Redis");
	});

	// Subscribes to any channels being watched
	rc.on("ready", function () {
		rl.redis_ready = true;
		global.trace("RedisListener " + rl.id + ": Ready");
		var chan_set_length = Object.keys(rl.chan_set).length;
		if (chan_set_length > 0) {
			global.trace(
				"RedisListener " + rl.id + ": " +
				"Subscribing to " + chan_set_length + " " +
				"channels"
			);
			rc.subscribe(Object.keys(rl.chan_set));
		}
	});

	// Dispatches Pub/Sub messages to listeners
	rc.on("message", function (channel, message) {
		// Get event handler
		var eventHandlers = rl.chan_set[channel];
		if (!eventHandlers) {
			return;
		}

		// Log dispatch
		global.trace(
			"RedisListener " + rl.id + ": " +
			"Got Redis message on channel " + channel
		);

		// Dispatch to event handler
		eventHandlers.message(channel, message);
	});

	// Dispatches subscriptions to subscriber
	rc.on("subscribe", function (channel, count) {
		// Get event handler
		var eventHandlers = rl.chan_set[channel];
		if (!eventHandlers) {
			return;
		}

		// Dispatch to event handler
		if (eventHandlers.subscribe) {
			eventHandlers.subscribe(channel);
		}
	});

	// Turns the ping timer on and off
	rc.on("idle", function () {
		if (rl.nr_chans == 0) {
			if (!rl.ping_timer) {
				rl.ping_timer = timer.setInterval(
					function () {
						rl.ping();
					}, 60000
				);
			}
		}
		else {
			rl.stopPingTimer();	
		}
	});

	this.redis_client = rc;
}

RedisListener.prototype.ping = function ()
{
	if (this.redis_ready) {
		this.redis_client.ping();
	}
}

RedisListener.prototype.stopPingTimer = function ()
{
	if (this.ping_timer) {
		timer.clearInterval(this.ping_timer);
		delete this.ping_timer;
	}
}

RedisListener.prototype.addChan = function (chan_id, eventHandlers)
{
	// Track addChan
	if (!this.chan_sub_count[chan_id]) {
		this.chan_sub_count[chan_id] = 0;
	}
	var sub_cnt = ++this.chan_sub_count[chan_id];
	if (sub_cnt > 1) {
		this.chan_set[chan_id].kill();
	}

	// Remember callback
	this.chan_set[chan_id] = eventHandlers;

	// Update tree position / number of channels
	this.pool.removeFromTree();
	this.nr_chans++;
	this.pool.addToTree();

	// PING isn't allowed in Pub/Sub mode
	this.stopPingTimer();

	// Send subscribe command if connected
	if (this.redis_ready) {
		this.redis_client.subscribe(chan_id);
	}
}

RedisListener.prototype.removeChan = function (chan_id)
{
	// Update tree position / number of channels
	this.pool.removeFromTree();
	this.nr_chans--;
	this.pool.addToTree();

	// Let pool expire empty RedisListeners
	this.pool.trimPool();

	// Hacky: This channel protection prevents us from unsubscribing /
	// forgetting the callback if we have a new request come in with the
	// same watch task id
	if (--this.chan_sub_count[chan_id] > 0) {
		return;
	}

	global.trace(
		"RedisListener " + this.id + ": Really unsubscribing " +
		"from " + chan_id
	);

	// Forget callback
	delete this.chan_set[chan_id];
	delete this.chan_sub_count[chan_id];

	// Send unsubscribe command if connected
	if (this.redis_client) {
		this.redis_client.unsubscribe(chan_id);
	}
}

RedisListener.prototype.getFreeChans = function ()
{
	return max_chans - this.nr_chans;
}

RedisListener.prototype.getUsedChans = function ()
{
	return this.nr_chans;
}

