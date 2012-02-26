
var config = {
	'console': {
		'trace': false,
	},

	'http': {
		'port': 8888,
	},

	'redis': {
		'host': '127.0.0.1',
		'port': '6379',
		'options': {

		},
		'prefix': 'RA_',
		'listener': {
			'max_channels': 16,
		}
	},

	'task_query': {
		'task_id_validation': /^[A-Za-z0-9_]+$/,
		'whitespace_timer_interval': 10000,
		'max_task_id_length': 32,
	}
};

exports.config = config;

