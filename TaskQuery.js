var url = require("url");
var console = require("console");
var util = require("util");
var uuid = require("node-uuid");
var timers = require("timers");
var config = require("./config").config;

var whitespace_timer_interval = config.task_query.whitespace_timer_interval;
if (whitespace_timer_interval == undefined) {
	whitespace_timer_interval = 10000;
}

var task_id_validation = config.task_query.task_id_validation;
if (task_id_validation == undefined) {
	task_id_validation = /^[A-Za-z0-9\_]+$/;
}

var max_task_id_length = config.task_query.max_task_id_length;
if (max_task_id_length == undefined) {
	max_task_id_length = 32;
}

var tq_ctr = 0;
function TaskQuery (task_id, request, response)
{
	this.id = tq_ctr++;
	this.task_id = task_id;
	this.request = request;
	this.response = response;
	this.data_name = global.redisKeyName("D_" + task_id);
	this.uuid = uuid.v4();

	console.log(
		"TaskQuery " + this.id + ": HTTP request from " +
		request.connection.remoteAddress + ":" +
		request.connection.remotePort + " (" +
		request.url + ")"
	);
}

TaskQuery.prototype.handleRequest = function ()
{
	this.invoke();
}

TaskQuery.prototype.sendError = function (message)
{
	global.sendError(this.response, message);
	this.cleanup();
}

TaskQuery.prototype.sendJSON = function (obj)
{
	global.sendJSON(this.response, obj);
	this.cleanup();
}

TaskQuery.prototype.stopWhitespaceTimer = function ()
{
	if (this.whitespace_timer_id) {
		timers.clearInterval(this.whitespace_timer_id);
		delete this.whitespace_timer_id;
	}
}

TaskQuery.prototype.startWhitespaceTimer = function ()
{
	if (this.whitespace_timer_id || whitespace_timer_interval == 0) {
		return;
	}
	var tq = this;
	this.whitespace_timer_id = timers.setInterval(
		function () {
			tq.response.write("\n");
		},
		whitespace_timer_interval
	);
}

TaskQuery.prototype.cleanup = function ()
{
	this.stopWhitespaceTimer();
	this.request.connection.removeAllListeners("close");
	this.request = null;
	delete this.request;
	this.response = null;
	delete this.response;
}

function WatchTaskQuery (task_id, request, response)
{
	TaskQuery.call(this, task_id, request, response);
	this.channel_name = global.redisKeyName("SC_" + this.task_id);
}

util.inherits(WatchTaskQuery, TaskQuery);

WatchTaskQuery.prototype.channelName = function ()
{
	return global.redisKeyName("SC_" + this.task_id);
}

WatchTaskQuery.prototype.invoke = function ()
{
	var rl = global.redis_listener_pool.getListener();

	this.request.connection.on("close", function () {
		global.trace(
			"TaskQuery " + tq.id + ": HTTP connection closed"
		);
		tq.cleanup();
		return;
	});
	
	// Listen for changes to the data
	var tq = this;
	rl.addChan(this.channel_name, {
		message: function (channel, message) {
			tq.handleMessage(message);
		},
		subscribe: function (channel) {
			tq.checkValue();

			// Drop other requests waiting on this query
			global.trace(
				"TaskQuery " + tq.id + ": Killing other " +
				"listeners"
			);
			global.redis_client.publish(
				tq.channel_name,
				JSON.stringify({
					'status': 'kill',
					'src': tq.uuid,
				}
			));
		},
		kill: function () {
			global.trace(
				"TaskQuery " + tq.id + ": killed due to " +
				"internal detection of duplicate listener"
			);
			tq.killed();
		}
	});


	// Set to object
	this.rl = rl;
}

WatchTaskQuery.prototype.checkValue = function ()
{
	// Start whitespace timer
	this.startWhitespaceTimer();

	// Get current value
	var tq = this;
	global.redis_client.get(this.data_name, function (err, value) {
		// Make sure the get succeeded
		if (err) {
			cosole.warn(
				"TaskQuery " + tq.id + ": Redis error: " +
				err
			);
			tq.sendError("Redis error");
			return;
		}

		// Make sure we got data
		if (!value) {
			global.trace(
				"TaskQuery " + tq.id + ": No task in Redis"
			);
			tq.sendError("Not Found");
			return;
		}

		// Parse data
		var json;
		try {
			json = JSON.parse(value);
		}
		catch (err) {
			console.warn(
				"TaskQuery " + tq.id + ": JSON parse " +
				"failure reading task data: " + err
			);
			tq.sendError(
				"JSON parse failure reading task data: " +
				err
			);
			return;
		}

		// Check status
		var tstatus = json['status'];
		if (tstatus == 'done') {
			global.trace(
				"TaskQuery " + tq.id + ": Sending task " +
				"data from data key"
			);

			// We're already done! Send the data
			tq.response.write(value);
			tq.response.end();
			tq.cleanup();
			return;
		}
	});
}

WatchTaskQuery.prototype.killed = function ()
{
	global.trace(
		"TaskQuery " + this.id + " killed due to a concurrent request"
	);

	this.sendError(
		"Killed due to another concurrent request for this task"
	);
}

WatchTaskQuery.prototype.handleMessage = function (message)
{
	// Parse message
	var json;
	try {
		json = JSON.parse(message);
	}
	catch (err) {
		console.warn(
			"WatchTaskQuery " + tq.id + " ignoring SC " +
			"message due to JSON parse error: " + err
		);
		return;
	}

	// Determine status
	var tstatus = json['status'];
	if (tstatus == 'kill') {
		// Don't let a query kill itself
		if (json['src'] == this.uuid) {
			return;
		}

		// Dispatch kill command
		this.killed();
		return;
	}
	else if (tstatus == 'update' || tstatus == 'done') {
		this.stopWhitespaceTimer();
		if (json['data']) {
			// Data included! Send it back
			global.trace(
				"TaskQuery " + this.id + ": Sending data " +
				"from SC"
			);
			this.response.write(message);
			this.response.end();
			this.cleanup();
			return;
		}
		else {
			// Retrieve data
			this.invokeReturnValue();
			return;
		}
	}
	else {
		global.trace(
			"WatchTaskQuery " + this.id + " ignoring unknown " +
			"SC status update"
		);
	}
}

WatchTaskQuery.prototype.cleanup = function ()
{
	// Only run cleanup once
	if (this.cleaned_up) {
		return;
	}
	this.cleaned_up = 1;

	// Emit log
	global.trace(
		"TaskQuery " + this.id + ": Unsubscribing from channel: " +
		this.channel_name
	);

	// Unsubscribe
	this.rl.removeChan(this.channel_name);

	// Destroy TaskQuery
	TaskQuery.prototype.cleanup.call(this);
}

TaskQuery.prototype.invokeReturnValue = function ()
{
	global.trace(
		"TaskQuery " + this.id + ": Getting data for task " +
		this.task_id
	);
	var tq = this;
	global.redis_client.get(this.data_name, function (error, value) {
		if (error) {
			console.warn(
				"TaskQuery " + tq.id + ": Redis error: " +
				error
			);
			tq.sendError("Redis error");
			return;
		}

		if (!value) {
			console.warn(
				"TaskQuery " + tq.id + ": No task in Redis"
			);
			tq.sendError("Not Found");
			return;
		}

		tq.response.write(value);
		tq.response.end();
		tq.cleanup();
	});
}

function PollTaskQuery (task_id, request, response)
{
	TaskQuery.call(this, task_id, request, response);
}

util.inherits(PollTaskQuery, TaskQuery);

PollTaskQuery.prototype.invoke = function ()
{
	this.invokeReturnValue();
}

function handleRequest (task_id, request, response)
{
	// Validate task_id
	if (!task_id || !task_id.match(task_id_validation)
	  || task_id.length > max_task_id_length) {
		sendError(response, "Not Found");
		return;
	}

	// Determine operation mode
	var qstr = url.parse(request.url).query;
	if (qstr == "watch") {
		var tq = new WatchTaskQuery(task_id, request, response);
		tq.invoke();
		return tq;
	}
	else if (qstr == "poll" || !qstr) {
		var tq = new PollTaskQuery(task_id, request, response);
		tq.invoke();
		return tq;
	}
	else {
		sendError(response, "Invalid mode");
		return;
	}
}

exports.handleRequest = handleRequest;

