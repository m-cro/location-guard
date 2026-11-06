

const Browser = require('../common/browser');
const PlanarLaplace = require('../common/laplace');
const Util = require('../common/util');
const MapLayers = require('./map');
const { GeoMap, Circle, Marker, Popup } = require('./minimap');
const { byId, h, initPanel } = require('./ui');

var levelMap, fixedPosMap;
var epsilon;
var activeLevel = "medium";
var inited = {};
var sliderRadius, sliderCacheTime;

// default pos
var currentPos = {
	latitude: 48.86014106672441,
	longitude: 2.3569107055664062
};

Browser.init('options');


// slider wrapper class around <input type=range>:
// opt.slide is called while dragging, opt.change when the user releases it
function Slider(opt) {
	this.opt = opt;
	this.value = opt.min;

	const input = byId(opt.id);
	const read = () => this.value = Number(input.value);
	input.addEventListener('input',  () => opt.slide(read()));
	input.addEventListener('change', () => opt.change(read()));

	this.set = function(value) {
		this.value = value;
		input.value = value;
	}
}

async function saveOptions() {
	const st = await Browser.storage.get();
	st.defaultLevel = byId('defaultLevel').value;
	st.paused = byId('paused').checked;
	st.hideIcon = byId('hideIcon').checked;

	var updateAccuracy = byId('updateAccuracy').checked;
	if(st.updateAccuracy != updateAccuracy) {
		// update accuracy of cached positions to reflect the change
		for(var level in st.cachedPos) {
			var epsilon = st.epsilon / st.levels[level].radius;
			var pl = new PlanarLaplace();

			st.cachedPos[level].position.coords.accuracy +=									// add/remove the .9 accuracy
				(updateAccuracy ? 1 : -1) * Math.round(pl.alphaDeltaAccuracy(epsilon, .9));
		}

		st.updateAccuracy = updateAccuracy;
	}

	await Browser.storage.set(st);
	Browser.gui.refreshAllIcons();
}

async function saveFixedPosNoAPI() {
	const st = await Browser.storage.get();
	st.fixedPosNoAPI = byId('fixedPosNoAPI').checked;

	await Browser.storage.set(st);
}

async function saveMapTiles() {
	const st = await Browser.storage.get();
	const enabled = byId('mapTilesEnabled').checked;
	const url = byId('mapTilesUrl').value.trim();
	const attribution = byId('mapTilesAttribution').value.trim();
	const attributionUrl = byId('mapTilesAttributionUrl').value.trim();
	if(enabled && !Util.mapTileConfig({ mapTilesEnabled: true, mapTilesUrl: url, mapTilesAttribution: attribution, mapTilesAttributionUrl: attributionUrl })) {
		byId('mapTilesError').textContent = 'Enter a valid HTTPS tile URL with {z}, {x}, and {y}, attribution text, and an optional HTTPS attribution link. Public OpenStreetMap tile hosts are not supported here.';
		byId('mapTilesEnabled').checked = false;
		st.mapTilesEnabled = false;
		st.mapTilesUrl = url;
		st.mapTilesAttribution = attribution;
		st.mapTilesAttributionUrl = attributionUrl;
		await Browser.storage.set(st);
		await refreshMapLayers();
		return;
	}
	byId('mapTilesError').textContent = '';
	st.mapTilesEnabled = enabled;
	st.mapTilesUrl = url;
	st.mapTilesAttribution = attribution;
	st.mapTilesAttributionUrl = attributionUrl;
	await Browser.storage.set(st);
	await refreshMapLayers();
}

async function refreshMapLayers() {
	if(levelMap) await MapLayers.addBaseLayer(levelMap);
	if(fixedPosMap) await MapLayers.addBaseLayer(fixedPosMap);
}

async function saveLevel() {
	const st = await Browser.storage.get();
	var radius = sliderRadius.value;
	var ct = sliderCacheTime.value;
	var cacheTime = ct <= 59 ? ct : 60 * (ct-59);

	updateRadius(radius, true);

	// delete cache for that level if radius changes
	if(st.levels[activeLevel].radius != radius)
		delete st.cachedPos[activeLevel];

	st.levels[activeLevel] = {
		radius: radius,
		cacheTime: cacheTime
	};

	await Browser.storage.set(st);
}

async function initLevelMap() {
	var latlng = [currentPos.latitude, currentPos.longitude];

	// map
	levelMap = new GeoMap('levelMap')
		.setView(latlng, 13)
		.on('dragstart', function() {
			levelMap.closePopup();
		})
		.on('click', function(e){
			if(levelMap.popup.isOpen()) {	// if popup is open, close it
				levelMap.closePopup();
				return;
			}
			handleChangePosEvent(e);
		});
	await MapLayers.addBaseLayer(levelMap);

	// marker
	levelMap.marker = new Marker(latlng, { draggable: true })
		.addTo(levelMap)
		.on('click', function() {
			showPopup(levelMap);
		})
		.on('drag', handleChangePosEvent);

	// popup
	var locateLink = h('a', { href: '#', id: 'levelMapCurrentPos', class: 'popup-location-btn' });
	locateLink.addEventListener('click', function(e) {
		e.preventDefault();
		showCurrentPosition();
	});
	var popupContent = h('div', { class: 'map-popup' },
		h('p', {}, h('b', {}, 'Protection area (red)'), ' and ', h('b', {}, 'accuracy (blue)'),
			' around some (hypothetical) location.'),
		h('p', {}, 'Click on the map or drag the marker to change the location. Click on ',
			locateLink, ' to show your current location.')
	);

	levelMap.popup = new Popup({
			maxWidth: Math.min(byId('levelMap').clientWidth - 50, 300),
		})
		.setContent(popupContent);

	// circles (accuracy circle first to be on bottom)
	levelMap.accuracy = new Circle(latlng, 1500, {
			fillColor: 'blue',
			fillOpacity: 0.4,
		})
		.addTo(levelMap);

	levelMap.protection = new Circle(latlng, 500, {
			fillColor: '#f03',
			fillOpacity: 0.4,
		})
		.addTo(levelMap);

	// "show my location" button
	levelMap.addButton('gm-locate', 'Show my location', showCurrentPosition);
}

async function initFixedPosMap() {
	const st = await Browser.storage.get();
	var fixedPos = st.fixedPos || {};
	if(!Util.isValidLatLng(fixedPos.latitude, fixedPos.longitude))
		fixedPos = { latitude: -4.448784, longitude: -171.24832 };
	var latlng = [fixedPos.latitude, fixedPos.longitude];

	fixedPosMap = new GeoMap('fixedPosMap')
		.setView(latlng, 14)
		.on('dragstart', function() {
			fixedPosMap.closePopup();
		})
		.on('click', function(e) {
			if(fixedPosMap.popup.isOpen()) {	// if popup is open, close it
				fixedPosMap.closePopup();
				return;
			}
			saveFixedPos(e.latlng);
		});
	await MapLayers.addBaseLayer(fixedPosMap);

	// marker
	fixedPosMap.marker = new Marker(latlng, { draggable: true })
		.addTo(fixedPosMap)
		.on('click', function() {
			showPopup(fixedPosMap);
		})
		.on('dragend', function(e) {
			saveFixedPos(e.latlng);
		});

	// popup
	var popupContent = h('div', { class: 'map-popup' },
		h('p', {}, 'This is the location reported when the privacy level is set to ', h('b', {}, '"Use fixed location"'), '.'),
		h('p', {}, 'Click on the map or drag the marker to set a new fixed location.')
	);

	fixedPosMap.popup = new Popup({
			maxWidth: Math.min(byId('fixedPosMap').clientWidth - 50, 300),
		})
		.setContent(popupContent);

	showPopup(fixedPosMap);

	// "show my location" button
	fixedPosMap.addButton('gm-locate', 'Show my location', showCurrentPositionFixed);
}

async function saveFixedPos(latlng) {
	const st = await Browser.storage.get();
	var wrapped = latlng;			// already within the normal range
	if(!Util.isValidLatLng(wrapped.lat, wrapped.lng)) return false;
	st.fixedPos = { latitude: wrapped.lat, longitude: wrapped.lng };
	byId('fixedLatitude').value = wrapped.lat.toFixed(6);
	byId('fixedLongitude').value = wrapped.lng.toFixed(6);

	fixedPosMap.marker.setLatLng(wrapped);

	Browser.log('saving st', st);
	await Browser.storage.set(st);
	return true;
}

async function saveFixedCoordinates() {
	const latitudeText = byId('fixedLatitude').value.trim();
	const longitudeText = byId('fixedLongitude').value.trim();
	const latitude = Number(latitudeText);
	const longitude = Number(longitudeText);
	if(!latitudeText || !longitudeText || !Util.isValidLatLng(latitude, longitude)) {
		byId('fixedCoordinatesError').textContent = 'Enter a latitude from -90 to 90 and longitude from -180 to 180.';
		return;
	}
	byId('fixedCoordinatesError').textContent = '';
	await saveFixedPos({ lat: latitude, lng: longitude });
	fixedPosMap.setView([latitude, longitude], 14);
}

async function showLevelInfo() {
	const st = await Browser.storage.get();
	// set sliders' value
	var radius = st.levels[activeLevel].radius;
	var cacheTime = st.levels[activeLevel].cacheTime;
	var ct = cacheTime <= 59				// 0-59 are mins, 60 and higher are hours
		? cacheTime
		: 59 + Math.floor(cacheTime/59);

	sliderRadius.set(radius);
	sliderCacheTime.set(ct);

	updateRadius(radius, true);
	updateCache(ct);
}

// change current pos as a reaction to a Leaflet event
function handleChangePosEvent(e) {
	currentPos = { latitude: e.latlng.lat, longitude: e.latlng.lng };
	moveCircles();
}

function moveCircles() {
	var latlng = [currentPos.latitude, currentPos.longitude];

	levelMap.marker.setLatLng(latlng);
	levelMap.protection.setLatLng(latlng);
	levelMap.accuracy.setLatLng(latlng);
}

function showPopup(map) {
	var smallSize = map.el.clientWidth < 500 || map.el.clientHeight < 450;

	// on small screens we center the popup at the bottom of the map
	// on large screens we open at the marker
	//
	var latlng;
	if(smallSize) {
		var bounds = map.getBounds();
		latlng = bounds.getCenter();
		latlng.lat = bounds.getSouth();
	} else {
		// get pos 30 pixes above the marker
		var pos = map.latLngToPoint(map.marker.getLatLng());
		pos.y -= 30;
		latlng = map.pointToLatLng(pos);
	}

	map.popup
		.setLatLng(latlng)
		.openOn(map)
		.setTip(!smallSize);		// hide popup "arrow" on small screens
}

function updateRadius(radius, fit) {
	// update radius text and map
	var acc = Math.round((new PlanarLaplace).alphaDeltaAccuracy(epsilon/radius, .95));

	moveCircles();

	levelMap.protection.setRadius(radius);
	levelMap.accuracy.setRadius(acc);

	var first_view = !inited.radius;
	inited.radius = true;

	if(fit)
		levelMap.fitBounds(levelMap.accuracy.getBounds(), { animate: !first_view });

	if(first_view)
		showPopup(levelMap);

	byId('radius').textContent = radius;
	byId('accuracy').textContent = acc;
}

function updateCache(ct) {
	// update cache time text
	var hours = ct-59

	byId('cacheTime').textContent = (
		ct == 0 ? "don't cache" :
		ct < 60 ? ct + " minute" + (ct > 1 ? "s" : "") :
		hours + " hour" + (hours > 1 ? "s" : "")
	);
}

const PAGES = ['options', 'levels', 'fixedPos'];

// Very small page router: each page is a <div class="page">, selected by the url hash.
function currentPage() {
	var id = location.hash.substr(1);
	return PAGES.includes(id) ? id : 'options';
}

async function showPage() {
	var page = currentPage();
	for(const id of PAGES)
		byId(id).classList.toggle('active', id == page);

	if(inited[page]) {
		// page already inited. only call invalidateSize on maps
		if(page == "levels" && levelMap)   levelMap.invalidateSize();
		if(page == "fixedPos" && fixedPosMap) fixedPosMap.invalidateSize();
		return;
	}
	inited[page] = 'initializing';

	// page initialization
	//
	if(page == "options") {
		const st = await Browser.storage.get();
		byId('defaultLevel').value = st.defaultLevel;
		byId('paused').checked = st.paused;
		byId('hideIcon').checked = st.hideIcon;
		byId('updateAccuracy').checked = st.updateAccuracy;
		byId('mapTilesEnabled').checked = st.mapTilesEnabled === true;
		byId('mapTilesUrl').value = st.mapTilesUrl || '';
		byId('mapTilesAttribution').value = st.mapTilesAttribution || '';
		byId('mapTilesAttributionUrl').value = st.mapTilesAttributionUrl || '';

	} else if (page == "levels") {
		const st = await Browser.storage.get();
		epsilon = st.epsilon;
		sliderRadius = new Slider({
			id: "setRadius",
			min: 40,
			max: 3000,
			step: 20,
			slide: function(value) {
				levelMap.closePopup();
				updateRadius(value, false);
			},
			change: saveLevel,
		});
		sliderCacheTime = new Slider({
			id: "setCacheTime",
			min: 0,
			max: 69,
			step: 1,
			slide: updateCache,
			change: saveLevel,
		});

		await initLevelMap();
		await showLevelInfo();

	} else if (page == "fixedPos") {
		const st = await Browser.storage.get();
		byId('fixedPosNoAPI').checked = st.fixedPosNoAPI;
		const fixedPos = st.fixedPos && Util.isValidLatLng(st.fixedPos.latitude, st.fixedPos.longitude)
			? st.fixedPos : { latitude: -4.448784, longitude: -171.24832 };
		byId('fixedLatitude').value = fixedPos.latitude;
		byId('fixedLongitude').value = fixedPos.longitude;

		await initFixedPosMap();
	}
	inited[page] = true;
}

function showCurrentPosition() {
	navigator.geolocation.getCurrentPosition(
		function (pos) {
			levelMap.closePopup();
			currentPos = pos.coords;
			showLevelInfo();		// moves circles and also centers map
		},
		function(err) {
			Browser.log("cannot get location", err);
		}
	);
}

// centers the fixed-location map on the user's real position (it doesn't change the fixed location)
function showCurrentPositionFixed() {
	navigator.geolocation.getCurrentPosition(
		function(pos) {
			fixedPosMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
		},
		function(err) {
			Browser.log("cannot get location", err);
		}
	);
}

async function restoreDefaults() {
	if(window.confirm('Are you sure you want to restore the default options?')) {
		await Browser.storage.clear();
		await Browser.gui.refreshAllIcons();
		location.reload();
	}
}

async function deleteCache() {
	const st = await Browser.storage.get();
	st.cachedPos = {};
	await Browser.storage.set(st);
	window.alert('Location cache was deleted');
}

document.addEventListener('DOMContentLoaded', function() {
	initPanel();

	// hiding the icon only works with page action (not browser action)
	byId('hideIcon').closest('label').hidden = Browser.capabilities.permanentIcon();

	for(const id of ['defaultLevel', 'paused', 'hideIcon', 'updateAccuracy'])
		byId(id).addEventListener('change', saveOptions);
	byId('fixedPosNoAPI').addEventListener('change', saveFixedPosNoAPI);
	for(const id of ['mapTilesEnabled', 'mapTilesUrl', 'mapTilesAttribution', 'mapTilesAttributionUrl'])
		byId(id).addEventListener('change', saveMapTiles);
	byId('saveFixedCoordinates').addEventListener('click', saveFixedCoordinates);

	byId('restoreDefaults').addEventListener('click', restoreDefaults);
	byId('deleteCache').addEventListener('click', deleteCache);

	for(const a of document.querySelectorAll('#activeLevel a')) {
		a.addEventListener('click', function(e) {
			e.preventDefault();
			levelMap.closePopup();

			for(const other of document.querySelectorAll('#activeLevel a'))
				other.classList.toggle('active', other === a);
			activeLevel = a.getAttribute('level');
			showLevelInfo();
		});
	}

	for(const btn of document.querySelectorAll('.showFAQ'))
		btn.addEventListener('click', () => { location.href = "faq.html#" + btn.getAttribute('faq'); });
	for(const btn of document.querySelectorAll('.reportIssue'))
		btn.addEventListener('click', () => window.open('https://github.com/chatziko/location-guard/issues', '_blank'));

	window.addEventListener('hashchange', showPage);
	showPage();
});

(async function() {
	if(!Browser.testing) return;

	// test for nested calls, and for correct passing of tabId
	//
	Browser.rpc.register('nestedTestTab', function(tabId) {
		Browser.log("in nestedTestTab, returning 'options'");
		return "options";
	});

	Browser.log("calling nestedTestMain");
	const res = await Browser.rpc.call(null, 'nestedTestMain', []);
	Browser.log('got from nestedTestMain', res);
}());
