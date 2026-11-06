// PostRPC provides RPC functionality through message passing (postMessage).
//
// sendObj: object for sending messages (window or port)
// receiveObj: object for receiving messages
//
// The case when sendObj == receiveObj == window is supported. In this
// case sent messages will be received by us and ignored.
//
function _code() {
	var PostRPC = function(name, sendObj, receiveObj, targetOrigin) {
		this._id = Math.floor(Math.random()*1000000);
		this._nextCallId = 0;
		this._ns = '__PostRPC_' + name;
		this._sendObj = sendObj;
		this._receiveObj = receiveObj;
		this._calls = {};
		this._methods = Object.create(null);
		this._targetOrigin = targetOrigin;

		if(receiveObj)
			receiveObj.addEventListener('message', this._receiveMessage.bind(this), false);
	};

	PostRPC.prototype.register = function(name, fun) {
		this._methods[name] = fun;
	};

	PostRPC.prototype.call = function(method, args, timeout) {
		return new Promise((resolve, reject) => {
			var callId = this._nextCallId++;
			var timer = timeout > 0 ? setTimeout(() => {
				delete this._calls[callId];
				reject(new Error('PostRPC call timed out: ' + method));
			}, timeout) : null;
			this._calls[callId] = { resolve: resolve, reject: reject, timer: timer };
			if(!args) args = [];

			try {
				this._sendMessage({ method: method, args: args, callId: callId, from: this._id });
			} catch(err) {
				clearTimeout(timer);
				delete this._calls[callId];
				reject(err);
			}
		});
	};

	PostRPC.prototype._sendMessage = function(message) {
		var temp = {};
		temp[this._ns] = message;
		// Opaque origins (including file: URLs) cannot be addressed with a
		// literal origin. Their messages still carry an origin value that the
		// receiving side checks below.
		var targetOrigin = this._targetOrigin === 'null' || this._targetOrigin === 'file://'
			? '*' : this._targetOrigin;
		this._sendObj.postMessage(temp, targetOrigin);
	};

	PostRPC.prototype._receiveMessage = async function(event) {
		// The page can observe messages in its own frame, so only accept messages
		// delivered by this frame and from its expected origin. Keep RPC values
		// safe for page exposure even with this check in place.
		if((event.source !== this._receiveObj && event.source !== null) ||
		   event.origin !== this._targetOrigin) return;
		var data = event.data && event.data[this._ns];
		if(!data || typeof data !== 'object') return;

		if(data.method) {
			if(typeof data.method !== 'string' || !Array.isArray(data.args) ||
			   !Number.isInteger(data.callId) || !Number.isInteger(data.from)) return;
			if(data.from == this._id) return;

			try {
				if(!Object.prototype.hasOwnProperty.call(this._methods, data.method))
					throw new Error('No handler for ' + data.method);
				const res = await this._methods[data.method].apply(null, data.args);
				this._sendMessage({ callId: data.callId, to: data.from, value: [res] });
			} catch(err) {
				this._sendMessage({ callId: data.callId, to: data.from, error: String(err && err.message || err) });
			}
		} else {
			if(!Number.isInteger(data.callId) || data.to !== this._id) return;
			var c = this._calls[data.callId];
			delete this._calls[data.callId];
			if(!c) return;
			clearTimeout(c.timer);
			if(data.error)
				c.reject(new Error(data.error));
			else
				c.resolve.apply(null, Array.isArray(data.value) ? data.value : []);
		}
	};

	return PostRPC;
}

module.exports = _code();
module.exports._code = _code;
