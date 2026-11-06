
const Tour = require('./tour');

const Browser = require('../common/browser');
const MapLayers = require('./map');
const { GeoMap, Circle, Marker } = require('./minimap');
const { byId, initPanel } = require('./ui');

Browser.inDemo = true;		// used in content.js
var intro, outcome = '';
var demoMap;
var showPressed, geoDone;

document.addEventListener('DOMContentLoaded', async function() {
	initPanel();

	// setup map
	demoMap = new GeoMap('demoMap')
		.on('click', function(e){
			if(intro) intro.exit();
		})
		.setView([0,0], 2);
	await MapLayers.addBaseLayer(demoMap);

	// button that asks the browser for the user's location
	demoMap.addButton('gm-locate', 'Show my location', showCurrentPosition);

	byId('demo-link').addEventListener('click', function(e) {
		e.preventDefault();
		if(intro && !intro.active)
			intro.start();
	});

	// ready to go
	startDemo();
});

function showCurrentPosition() {
	navigator.geolocation.getCurrentPosition(
		drawPosition,
		function(err) {
			geoDone = true;
			alert("The following error occurred while retrieving your location:\n\n" + err.message);
		}
	);

	showPressed = true;
	if(intro.active && intro.current <= 2)
		intro.goToStep(3);
}

async function drawPosition(pos) {
	var latlng = [pos.coords.latitude, pos.coords.longitude];
	var acc = pos.coords.accuracy;

	if(!demoMap.marker) {
		demoMap.marker = new Marker(latlng)
			.addTo(demoMap);

		demoMap.accuracy = new Circle(latlng, acc, {
				color: '#136AEC',
				fillColor: '#136AEC',
				fillOpacity: 0.15,
				weight: 2,
				opacity: 0.5,
			})
			.addTo(demoMap);
	}

	demoMap.marker.setLatLng(latlng);
	demoMap.accuracy.setLatLng(latlng);
	demoMap.accuracy.setRadius(acc);

	demoMap.fitBounds(demoMap.accuracy.getBounds());

	geoDone = true;
	if(intro.active && intro.current <= 3) {
		const st = await Browser.storage.get();
		var level = st.paused ? 'real' : (st.domainLevel['demo-page'] || st.defaultLevel);

		outcome =
			level == 'fixed' ? 'Location Guard replaced it with your configured fixed location.' :
			level == 'real'  ? 'Location Guard did not modify it.' :
			'Location Guard added "noise" to it so that it\'s not very accurate.';

		intro.goToStep(4);
	}
}

function startDemo() {
	var iconClass = Browser.capabilities.permanentIcon() ? 'lg-icon-browseraction' : 'lg-icon-pageaction';
	var steps = [ {
			content: () => [
				['Location Guard was successfully installed.'],
				['This demo illustrates its use.'],
			],
			className: 'tour-step1',
		}, {
			element: ".gm-locate",
			highlight: true,
			content: () => [
				['The demo asks the browser for your location when you press the ',
					{cls: 'popup-location-btn'},
					' button.'],
				['Press it!'],
			],
			className: 'tour-step2',
			place: (tip, rect) => { tip.style.top = (rect.bottom + 12) + 'px'; },
		}, {
			element: ".placeholder-step3",
			highlight: true,
			content: () => [
				['The browser asks permission to disclose your location. At the same time, the ',
					{cls: iconClass}, ' icon ' +
					(Browser.capabilities.permanentIcon()
						? 'shows that a location request has been made.'
						: 'appears, showing that Location Guard is active.')],
				['To continue, allow access to your location.'],
			],
			className: 'tour-step3',
		}, {
			content: () => [
				['This is the location disclosed by your browser. ' + outcome],
				['Click on the ', {cls: iconClass}, ' icon to try more options.'],
			],
			className: 'tour-step4',
	} ];

	intro = new Tour(steps);
	intro.onchange = function(step) {
		// disable "Next" in steps 2/3 until the corresponding actions are performed
		intro.setNextEnabled(!((step == 2 && !showPressed) || (step == 3 && !geoDone)));
	};
	intro.start();
}
