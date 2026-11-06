// This will be injected to the page by content.js. Either inline, by copying the code of the injectedCode function
// in a <script>...</script>, or by inserting inject.js as an external script.
//
module.exports = function(PostRPC) {
	if(navigator.geolocation) {		// the geolocation API exists
		var prpc;
		function getPostRPC() {
			// create a PostRPC object only when getCurrentPosition is called. This
			// avoids having our own postMessage handler on every page
			if(!prpc)
				prpc = new PostRPC('page-content', window, window, window.origin);	// This PostRPC is created by the injected code!
			return prpc;
		}
		const handlers = {};
		let nextHandler = 0;
		let watchUpdateRegistered = false;
		function registerWatchUpdate() {
			if(watchUpdateRegistered) return;
			getPostRPC().register('watchUpdate', function(handler, success, position, done) {
				const watch = handlers[handler];
				if(!watch || !watch.active) return;
				const cb = success ? watch.success : watch.error;
				if(cb) cb(position);
				if(done) {
					watch.active = false;
					delete handlers[handler];
				}
			});
			watchUpdateRegistered = true;
		}

		// We replace geolocation methods with our own.
		// getCurrentPosition will be called by the content script (not by the page)
		// so we dont need to keep it at all.

		navigator.geolocation.getCurrentPosition = async function(cb1, cb2, options) {
			// call getNoisyPosition on the content-script
			// call cb1 on success, cb2 on failure
			try {
				// Preserve the native geolocation timeout. Add a small allowance for
				// the content/page message round trip when the caller set one.
				const rpcTimeout = options && Number.isFinite(options.timeout) ? options.timeout + 10000 : 0;
				const res = await getPostRPC().call('getNoisyPosition', [options], rpcTimeout);
				const cb = res.success ? cb1 : cb2;
				if(cb) cb(res.position);
			} catch(err) {
				if(cb2) cb2({ code: 2, message: err && err.message || 'Position unavailable' });
			}
		};

		navigator.geolocation.watchPosition = function(cb1, cb2, options) {
			// The content script decides whether the watch can expose real position
			// data. The page never invokes the captured native watchPosition itself.
			const handler = nextHandler++;
			const watch = { active: true, success: cb1, error: cb2 };
			handlers[handler] = watch;
			registerWatchUpdate();

			getPostRPC().call('startWatch', [handler, options]).then(started => {
				if(!started && watch.active) {
					watch.active = false;
					delete handlers[handler];
					if(cb2) cb2({ code: 2, message: 'Position unavailable' });
				}
			}).catch(err => {
				if(watch.active && cb2) cb2({ code: 2, message: err && err.message || 'Position unavailable' });
				watch.active = false;
				delete handlers[handler];
			});
			return handler;
		};

		navigator.geolocation.clearWatch = function (handler) {
			const watch = handlers[handler];
			if(watch) {
				watch.active = false;
				delete handlers[handler];
				getPostRPC().call('stopWatch', [handler]).catch(() => {});
			}
		};
	}

	// remove script
	var s = document.getElementById('__lg_script');
	if(s) s.remove();	// DEMO: in demo injectCode is run directly so there's no script
};
