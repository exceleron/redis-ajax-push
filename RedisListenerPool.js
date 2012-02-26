var RedisListener = require("./RedisListener").RedisListener;
var Tree = require("bintrees").RBTree;

function RedisListenerPool() {
	this.rlset_size = 0;
	this.rlset = new Tree(function (a, b) {
		if (!a && !b) {
			return 0;
		}
		else if (!a) {
			return 1;
		}
		else if (!b) {
			return -1;
		}
		var fa = a.getFreeChans();
		var fb = b.getFreeChans();
		return (fa - fb);
	});
}

exports.RedisListenerPool = RedisListenerPool;

RedisListenerPool.prototype.getListener = function ()
{
	var rl = this.rlset.min();
	if (!rl || rl.getFreeChans() < 1) {
		rl = new RedisListener(this);
		this.rlset.insert(rl);
	}
	return rl;
}

RedisListenerPool.prototype.addToTree = function (rl)
{
	this.rlset.insert(rl);
}

RedisListenerPool.prototype.removeFromTree = function (rl)
{
	this.rlset.remove(rl);	
}

RedisListenerPool.prototype.trimPool = function ()
{
	while (this.rlset_size > 1) {
		var rl = this.rlset.max();
		if (rl.getUsedChans() < 1) {
			delete rl;
			this.rlset.remove(rl);
			this.rlset_size--;
		}
	}
}

