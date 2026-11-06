// utility class, loaded in various places
//
// It should contain only browser-independent functions, browser-specific
// functionality should go to browser/*.js
//

var Util = {
	extractDomain: function(url) {
		var match = /\/\/([^\/]+)/.exec(url);
		return match ? match[1] : "";
	},
	extractAnchor: function(url) {
		var match = /#(.+)/.exec(url);
		return match ? match[1] : "";
	},
	clone: function(obj) {
		// Note: JSON stringify/parse doesn't work for cloning native objects such as Position and PositionError
		//
		var t = typeof obj;
		if(obj === null || t === 'undefined' || t === 'boolean' || t === 'string' || t === 'number')
			return obj;
		if(t !== 'object')
			return null;

		var o = {};
		for (var k in obj)
			o[k] = Util.clone(obj[k]);
		return o;
	},

	// Validate user-configured map tiles before contacting a remote provider.
	// Extensions cannot set a dependable identifying User-Agent for OSM's public
	// tile service, so those endpoints are deliberately excluded here.
	mapTileConfig: function(settings) {
		if(!settings || settings.mapTilesEnabled !== true)
			return null;

		var url = typeof settings.mapTilesUrl === 'string' ? settings.mapTilesUrl.trim() : '';
		var attribution = typeof settings.mapTilesAttribution === 'string' ? settings.mapTilesAttribution.trim() : '';
		var attributionUrl = typeof settings.mapTilesAttributionUrl === 'string' ? settings.mapTilesAttributionUrl.trim() : '';
		if(!url || !attribution || !/^https:\/\//i.test(url) ||
			!url.includes('{z}') || !url.includes('{x}') || !url.includes('{y}'))
			return null;

		// Replace Leaflet placeholders for URL parsing. Reject the public OSM
		// tile hosts, including subdomains, because extension requests cannot
		// reliably provide the identifying headers required by their policy.
		var parsed;
		try {
			parsed = new URL(url.replace(/\{[^}]+\}/g, 'placeholder'));
		} catch(e) {
			return null;
		}
		var host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
		if(parsed.protocol !== 'https:' || parsed.username || parsed.password ||
			host === 'tile.openstreetmap.org' || host.endsWith('.tile.openstreetmap.org') ||
			host === 'tile.openstreetmap.de' || host.endsWith('.tile.openstreetmap.de'))
			return null;

		if(attributionUrl) {
			var parsedAttributionUrl;
			try {
				parsedAttributionUrl = new URL(attributionUrl);
			} catch(e) {
				return null;
			}
			if(parsedAttributionUrl.protocol !== 'https:' || parsedAttributionUrl.username || parsedAttributionUrl.password)
				return null;
			attributionUrl = parsedAttributionUrl.href;
		}

		// Leaflet treats attribution as HTML. Escape it so stored text cannot
		// inject markup into the extension page.
		function escapeHtml(value) {
			return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
		}
		attribution = escapeHtml(attribution);
		if(attributionUrl)
			attribution = '<a href="' + escapeHtml(attributionUrl) + '" target="_blank" rel="noopener noreferrer">' + attribution + '</a>';
		return { url: url, info: { attribution: attribution } };
	},

	isValidLatLng: function(latitude, longitude) {
		return Number.isFinite(latitude) && Number.isFinite(longitude) &&
			latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
	},

	// Get icon information. 'about' can be:
	//   tabId
	//   null (get info for the default icon)
	//   state object { callUrl: ..., apiCalls: ... }
	//
	// Returns:
	//   { hidden:          true if the icon should be hidden,
	//     private:         true if the current tab is in a private mode,
	//     defaultPrivate:  true if the default settings are in a private mode,
	//     apiCalls:        no of times the API has been called in the current tab
	//     title:           icon's title }
	//
	//
	getIconInfo: async function(about) {
		if(typeof(about) != 'object') {	// tabId
			const Browser = require('./browser');
			about = await Browser.rpc.call(about, 'getState', []);
		}

		return await Util._getStateIconInfo(about);
	},

	_getStateIconInfo: async function(state) {
		// return info for the default icon if state is null
		state = state || { callUrl: '', apiCalls: 0 };

		const Browser = require('./browser');
		const st = await Browser.storage.get();
		var domain = Util.extractDomain(state.callUrl);
		var level = st.domainLevel[domain] || st.defaultLevel;

		var info = {
			hidden:  st.hideIcon,
			private: !st.paused && level != 'real',
			defaultPrivate: !st.paused && st.defaultLevel != 'real',
			apiCalls: state.apiCalls,
			title:
				"Location Guard\n" +
				(st.paused		? "Paused" :
				level == 'real'	? "Using your real location" :
				level == 'fixed'? "Using a fixed location" :
				"Privacy level: " + level)
		};
		return info;
	},

	events: {
		_listeners: {},

		addListener: function(name, fun) {
			if(!this._listeners[name])
				this._listeners[name] = [];
			this._listeners[name].push(fun);
		},

		fire: function(name) {
			var list = this._listeners[name];
			if(!list) return;

			for(var i = 0; i < list.length; i++)
				list[i]();
		}
	}
};

module.exports = Util;
