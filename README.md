AJAX Push/Long-Polling with Redis and node.js
===

### To run the server:

    node redis-ajax-push.js

### Dependencies

  - [node.js](http://nodejs.org/)
  - [Redis](http://redis.io/)
  - [js\_bintrees](https://github.com/vadimg/js_bintrees)
  - [node\_redis](https://github.com/mranney/node_redis)
  * [node-uuid](https://github.com/broofa/node-uuid)

### Using redis-ajax-push

Configure redis-ajax-push in config.js.

Run RedisAjaxPush.js:

    node RedisAjaxPush.js

redis-ajax-push can be queried in either poll or watch mode:

    # Poll mode
    curl http://127.0.0.1:8888/task/TASK_ID

    curl http://127.0.0.1:8888/task/TASK_ID?poll

    # Watch mode
    curl http://127.0.0.1:8888/task/TASK_ID?watch

A configurable redis\_prefix is available to put all keys related to this
software in a specific namespace.

The API relies on two key types, both which store JSON.

For these examples, we will assume the default redis\_prefix of RA\_.

When a query comes in with no associated mode, or in poll mode,
redis-ajax-push simply reads the "data key" of the task\_id supplied as
part of the request. Data keys are named RA\_D\_(TASK\_ID).

If the task\_id is not formatted correctly, or there is no associated data
key in Redis, an error is returned.

When a query arrives in watch mode, redis-ajax-push enters AJAX push mode.
The client connection will be suspended while Redis is consulted, and perhaps
while we wait for an update.

First, redis-ajax-push subscribes to a channel called RA\_SC\_(TASK\_ID).
Next, The data key is checked, and if the JSON in the data key value has a
key named "status" with a value of "done", the watch is immediately
terminated, and it unsubscribes from the channel, returning the contents of
the data key.

However, if the data key status is not "done", a message is PUBLISHed to the
channel with a special status of "kill". This way, even if multiple
redis-ajax-push instances are set up in a network to point to the same Redis
database, there will only ever be a single watch for a single task\_id. Old
listeners are replaced by new listeners.

While we are waiting for a final result, redis-ajax-push will, by default,
emit a newline character every 10 seconds. This helps to keep the HTTP
connection open. Note that intermediate proxies (forward or reverse) may
buffer the request, in which case it's probably better to disable this
feature.

When an update or final result is available for a task\_id, the program
updating the data key should also send a 'status': 'update' or a
'status': 'done' on the channel. This causes the active watch for that
task\_id to be terminated. If the 'data': key exists in the channel message,
the message is returned directly to the HTTP client. Otherwise, the data
key is checked and returned. Remember, when you store the done status in
the data key, further watches will return that data key value immediately.

Note that due to Redis reconnections, network latency, etc., an HTTP client
repeatedly polling may not see every state the task enters. Only the most
recent state is returned.

A word on the internal use of Redis: one global connection is maintained for
retrieving and storing keys, and publishing messages, and a pool of
connections is maintained for watch subscriptions. Each subscription
connection will handle multiple simultaneous watches. This keeps the
SUBSCRIBE channel list for any given connection small while avoiding the
need to burn one connection per listener (which is also why I opted not to
use the Redis queue structures).

### Security

You should use hard to predict, digitally signed task\_ids.

redis-ajax-push tries to be resistant against DoS attacks by only allowing one
active watch per valid task\_id.

### Bugs

I haven't thoroughly verified that objects are destroyed when they are
supposed to. Keep an eye on the memory use and let me know if you are having
problems.

### See Also

  - [Ajax Push Engine](http://www.ape-project.org/)

### Copyright / License

Copyright Exceleron Software, Inc. and other contributors. All rights
reserved. Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including without
limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to
whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.

### Author

    Chase Venters <chase@exceleron.com>

