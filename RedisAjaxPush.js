
var config = require("./config").config;
var http = require("http");
var url = require("url");
var task_query = require("./TaskQuery");
var RedisListenerPool = require("./RedisListenerPool").RedisListenerPool;
var redis = require("redis");
var console = require("console");

console.log("redis-ajax-push starting up");

global.trace = function (message)
{
	if (config.console.trace) {
		console.log(message);
	}
}

global.newRedisClient = function ()
{
	return redis.createClient(
		config.redis.port, config.redis.host, config.redis.options
	);
}

global.redis_client = global.newRedisClient();
global.redis_client.on("error", function (err) {
	console.warn("Global redis client error: " + err);
});
global.redis_client.on("ready", function (err) {
	global.trace("Global redis client ready");
});

global.redis_listener_pool = new RedisListenerPool();

global.redisKeyName = function (name)
{
	return config.redis.prefix + name;
}

global.sendError = function (response, message)
{
        var data = {
                'status': 'error',
                'error_message': message,
        };
        sendJSON(response, data);
}

global.sendJSON = function (response, obj)
{
        response.write(JSON.stringify(obj));
        response.end();
}

function handleRequest (request, response)
{
	var parts = url.parse(request.url).pathname.split('/');
	var subsystem = parts[1];
	var task_id = parts[2];

	response.writeHeader(200, {
		"Content-Type": "application/json",
		"Server": "redis-ajax-push"
	});

	if (subsystem != 'task') {
		global.sendError("Not Found");
		return;
	}

	task_query.handleRequest(task_id, request, response);
}

if (!config.http.ip) {
	config.http.ip = "0.0.0.0";
}

http.createServer(handleRequest).listen(
	config.http.port,
	config.http.ip,
	function () {
		console.info(
			"Listening on http://" + config.http.ip + ":" +
			config.http.port
		);
	}
);

