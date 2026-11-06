//
// content.js
//
// This script runs as a _content script_ (in a separate js environment) on all pages.
//
// HOWEVER:
// Chrome does not allow content scripts in internal pages, so in the _demo page_ we just
// include content.js as a normal <script>. This mostly works (we don't need the
// separate js environment anyway), apart from a few things marked as DEMO below.
//
//
// PostRPC is being used for communication between the content script and the code
// injected in the page (they both share the same window object).
// NOTE: this communication is not secure and could be intercepted by the page.
//       so only a noisy location should be transmitted over PostRPC
//
// The following run in the content script

const Browser = require('../common/browser');
const Util = require('../common/util');
const PostRPC = require('../common/post-rpc');
const injectedCode = require('./injected');

// insert a script in the html, inline (<script>...</script>) or external (<script src='...'>)
function insertScript(inline, data) {
	var script = document.createElement('script');
	script.setAttribute('id', '__lg_script');
	if(inline)
		script.appendChild(document.createTextNode(data));
	else
		script.setAttribute('src', data);

	// FF: there is another variables in the scope named parent, this causes a very hard to catch bug
	var _parent = document.head || document.body || document.documentElement;
	var firstChild = (_parent.childNodes && (_parent.childNodes.length > 0)) ? _parent.childNodes[0] : null;
	if(firstChild)
		_parent.insertBefore(script, firstChild);
	else
		_parent.appendChild(script);
}

// DEMO: save the getCurrentPosition function, cause in the demo page it gets replaced (no separate js environment)
var getCurrentPosition = navigator.geolocation && navigator.geolocation.getCurrentPosition;
var nativeWatchPosition = navigator.geolocation && navigator.geolocation.watchPosition;
var nativeClearWatch = navigator.geolocation && navigator.geolocation.clearWatch;

if(Browser.inDemo) {	// DEMO: this is set in demo.js
	// DEMO: we are inside the page, just run injectedCode()
	injectedCode(PostRPC);

} else if(!Browser.capabilities.mainWorldContentScript() &&
	 document.documentElement.tagName.toLowerCase() == 'html') { // only for html
	// We first try to inject the code in an inline <script>. This is the only way to force it to run immediately.
	// We run the PostRPC code (which creates PostRPC) and pass the result to the injectedCode.
	//
	var code =
		"(" + injectedCode + ")(" +
			"(" + PostRPC._code + ")()" +
		");"
	insertScript(true, code);

	// BUT: in Firefox this fails if the page has a CSP that prevents inline scripts (chrome ignores the CSP for scripts injected by extensions).
	// If the inline script did not execute, we insert an external one (this might be executed too late, but it's all we can do).
	//
	var s = document.getElementById('__lg_script');
	if(s) { // the injected code deletes the script, if it's still there it means that the code failed
		s.remove();
		insertScript(false, Browser.gui.getURL("js/content/inject.js"));
	}
}

var inFrame = (window != window.top);	// are we in a frame?
var apiCalls = 0;						// how many times the API has been called here or in an iframe
var myUrl = Browser.inDemo ? 'http://demo-page/' : window.location.href;	// DEMO: user-friendly url
var callUrl = myUrl;					// the url from which the last call is _shown_ to be made (it could be a nested frame if the last call was made there and Browser.capabilities.iframeGeoFromOwnDomain() is true)
var activeWatches = {};
var cancelledWatches = {};

// methods called by the page
//
var rpc = new PostRPC('page-content', window, window, window.origin);
rpc.register('getNoisyPosition', async function(options) {
	const requestDomain = await recordApiCall();
	return await getNoisyPosition(options, requestDomain);
});
// Keep native watch access in the isolated content-script world. A decision
// sent to page JavaScript over postMessage can be forged by that page.
rpc.register('startWatch', async function(handler, options) {
	if(!Number.isInteger(handler)) return false;
	if(activeWatches[handler]) return false;
	if(cancelledWatches[handler]) {
		delete cancelledWatches[handler];
		return false;
	}
	const watch = { handler: handler, active: true, nativeId: null, domain: null };
	activeWatches[handler] = watch;
	const requestDomain = await recordApiCall();
	if(!watch.active) return false;
	const st = await Browser.storage.get();
	if(!watch.active) return false;
	const level = st.domainLevel[requestDomain] || st.defaultLevel;
	const allowed = !inFrame && (st.paused || level == 'real');
	watch.domain = requestDomain;

	if(allowed && nativeWatchPosition && nativeClearWatch) {
		try {
			watch.nativeId = nativeWatchPosition.apply(navigator.geolocation, [
				position => deliverNativeWatchPosition(watch, serializePosition(position)),
				error => deliverWatchUpdate(watch, false, serializePositionError(error)),
				options
			]);
		} catch(err) {
			deliverWatchUpdate(watch, false, { code: 2, message: err && err.message || 'Position unavailable' });
		}
	} else {
		try {
			const result = await getNoisyPosition(options, requestDomain);
			if(watch.active) deliverWatchUpdate(watch, result.success, result.position, true);
		} catch(err) {
			if(watch.active) deliverWatchUpdate(watch, false, { code: 2, message: err && err.message || 'Position unavailable' }, true);
		} finally {
			watch.active = false;
			delete activeWatches[handler];
			delete cancelledWatches[handler];
		}
	}
	return true;
});

rpc.register('stopWatch', function(handler) {
	if(!Number.isInteger(handler)) return false;
	cancelledWatches[handler] = true;
	const watch = activeWatches[handler];
	if(watch) {
		watch.active = false;
		delete activeWatches[handler];
		if(watch.nativeId != null)
			nativeClearWatch.apply(navigator.geolocation, [watch.nativeId]);
		delete cancelledWatches[handler];
	}
	return true;
});

async function recordApiCall() {
	callUrl = myUrl;
	if(inFrame && !Browser.capabilities.iframeGeoFromOwnDomain())
		callUrl = await Browser.rpc.call(null, 'apiCalledInFrame', [myUrl]);
	else if(!inFrame) {
		apiCalls++;
		Browser.gui.refreshIcon('self');
	}
	return Util.extractDomain(callUrl);
}

async function deliverNativeWatchPosition(watch, position) {
	if(!watch.active) return;
	let st;
	try {
		st = await Browser.storage.get();
	} catch(err) {
		if(watch.active) {
			if(watch.nativeId != null) nativeClearWatch.apply(navigator.geolocation, [watch.nativeId]);
			deliverWatchUpdate(watch, false, { code: 2, message: err && err.message || 'Position unavailable' });
			watch.active = false;
			delete activeWatches[watch.handler];
		}
		return;
	}
	const level = st.domainLevel[watch.domain] || st.defaultLevel;
	if(inFrame || (!st.paused && level != 'real')) {
		// Stop the native watch as soon as protection becomes active.
		watch.active = false;
		if(watch.nativeId != null) nativeClearWatch.apply(navigator.geolocation, [watch.nativeId]);
		delete activeWatches[watch.handler];
		return;
	}
	if(!watch.active) return;
	apiCalls++;
	Browser.gui.refreshIcon('self');
	deliverWatchUpdate(watch, true, position, false);
}

function deliverWatchUpdate(watch, success, position, done) {
	if(!watch.active) return;
	rpc.call('watchUpdate', [watch.handler, success, position, !!done]).catch(function(err) {
		Browser.log('failed to deliver geolocation watch update', err);
	});
}

// gets the options passed to the fake navigator.geolocation.getCurrentPosition.
// Either returns fixed pos directly, or calls the real one, then calls addNoise.
//
async function getNoisyPosition(options, requestDomain) {
	const st = await Browser.storage.get();

	// if level == 'fixed' and fixedPosNoAPI == true, then we return the
	// fixed position without calling the geolocation API at all.
	//
	var domain = requestDomain;
	var level = st.domainLevel[domain] || st.defaultLevel;

	if(!st.paused && level == 'fixed' && st.fixedPosNoAPI) {
		var noisy = {
			coords: {
				latitude: st.fixedPos.latitude,
				longitude: st.fixedPos.longitude,
				accuracy: 10,
				altitude: null,
				altitudeAccuracy: null,
				heading: null,
				speed: null
			},
			timestamp: new Date().getTime()
		};
		Browser.log("returning fixed", noisy);
		return { success: true, position: noisy };
	}

	return new Promise(resolve => {
		// we call getCurrentPosition here in the content script, instead of
		// inside the page, because the content-script/page communication is not secure
		//
		if(!getCurrentPosition) {
			resolve({ success: false, position: { code: 2, message: 'Geolocation is unavailable' } });
			return;
		}
		try {
		getCurrentPosition.apply(navigator.geolocation, [
			async function(position) {
				// clone, modifying/sending the native object returns error
				try {
					const noisy = await addNoise(serializePosition(position), requestDomain);
					resolve({ success: true, position: noisy });
				} catch(err) {
					resolve({ success: false, position: { code: 2, message: err && err.message || 'Position unavailable' } });
				}
			},
			function(error) {
				resolve({ success: false, position: serializePositionError(error) });
			},
			options
		]);
		} catch(err) {
			resolve({ success: false, position: { code: 2, message: err && err.message || 'Position unavailable' } });
		}
	});
}

// Native GeolocationPosition and GeolocationPositionError properties can be
// exposed through prototypes and are not reliably cloned by enumeration.
// Copy only the standard scalar fields before sending the result through RPC.
function serializePosition(position) {
	const coords = position.coords;
	return {
		coords: {
			latitude: coords.latitude,
			longitude: coords.longitude,
			accuracy: coords.accuracy,
			altitude: coords.altitude,
			altitudeAccuracy: coords.altitudeAccuracy,
			heading: coords.heading,
			speed: coords.speed
		},
		timestamp: position.timestamp
	};
}

function serializePositionError(error) {
	return { code: error.code, message: error.message };
}

// gets position, returs noisy version based on the privacy options
//
async function addNoise(position, domain) {
	const st = await Browser.storage.get();
	var level = st.domainLevel[domain] || st.defaultLevel;
	var cacheNoisy = false;

	if(st.paused || level == 'real') {
		// do nothing, use real location

	} else if(level == 'fixed') {
		position.coords = {
			latitude: st.fixedPos.latitude,
			longitude: st.fixedPos.longitude,
			accuracy: 10,
			altitude: null,
			altitudeAccuracy: null,
			heading: null,
			speed: null
		};

	} else if(st.cachedPos[level] && ((new Date).getTime() - st.cachedPos[level].epoch)/60000 < st.levels[level].cacheTime) {
		position = st.cachedPos[level].position;
		Browser.log('using cached', position);

	} else {
		// add noise
		var epsilon = st.epsilon / st.levels[level].radius;

		const PlanarLaplace = require('../common/laplace');
		var pl = new PlanarLaplace();
		var noisy = pl.addNoise(epsilon, position.coords);

		position.coords.latitude = noisy.latitude;
		position.coords.longitude = noisy.longitude;

		// update accuracy
		if(position.coords.accuracy && st.updateAccuracy)
			position.coords.accuracy += Math.round(pl.alphaDeltaAccuracy(epsilon, .9));

		cacheNoisy = true;

		Browser.log('noisy coords', position.coords);
	}

	// These measurements are directly tied to the user's physical location and
	// are not protected by the horizontal noise mechanism. Strip them from every
	// protected response, including values loaded from an older cache entry.
	if(!st.paused && level != 'real') {
		position.coords.altitude = null;
		position.coords.altitudeAccuracy = null;
		position.coords.heading = null;
		position.coords.speed = null;
	}
	if(cacheNoisy) {
		st.cachedPos[level] = { epoch: (new Date).getTime(), position: position };
		await Browser.storage.set(st);
	}

	// return noisy position
	return position;
}

(async function() {
	Browser.init('content');

	// if a browser action (always visible button) is used, we need to refresh the
	// icon immediately (before the API is called). HOWEVER: Browser.gui.refreshIcon
	// causes the background script to be awaken. To avoid doing this on every page,
	// we only call it if the icon is different than the default icon!
	//
	if(Browser.capabilities.permanentIcon() && !inFrame) {
		const info = await Util.getIconInfo({ callUrl: myUrl, apiCalls: 0 });
		if(info.private != info.defaultPrivate) // the icon for myUrl is different than the default
			Browser.gui.refreshIcon('self');
	}

	// only the top frame handles getState and apiCalledInFrame requests
	if(!inFrame) {
		Browser.rpc.register('getState', function(tabId) {
			return {
				callUrl: callUrl,
				apiCalls: apiCalls
			};
		});

		Browser.rpc.register('apiCalledInFrame', function(iframeUrl, tabId) {
			apiCalls++;
			if(Browser.capabilities.iframeGeoFromOwnDomain())
				callUrl = iframeUrl;
			Browser.gui.refreshIcon('self');

			return myUrl;
		});
	}

	if(Browser.testing) {
		// test for nested calls, and for correct passing of tabId
		//
		Browser.rpc.register('nestedTestTab', function(tabId) {
			Browser.log("in nestedTestTab, returning 'content'");
			return "content";
		});

		Browser.log("calling nestedTestMain");
		const res = await Browser.rpc.call(null, 'nestedTestMain', []);
		Browser.log('got from nestedTestMain', res);
	}
}())
