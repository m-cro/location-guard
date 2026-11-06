const test = require('node:test');
const assert = require('node:assert/strict');
const Util = require('../src/js/common/util');

const config = (overrides = {}) => Util.mapTileConfig({
	mapTilesEnabled: true,
	mapTilesUrl: 'https://tiles.example/{z}/{x}/{y}.png',
	mapTilesAttribution: '© Example Maps',
	...overrides,
});

test('map tiles are disabled unless explicitly enabled', () => {
	assert.equal(Util.mapTileConfig({}), null);
	assert.equal(Util.mapTileConfig({ mapTilesEnabled: false }), null);
});

test('valid HTTPS provider templates require attribution and are escaped', () => {
	const result = config({ mapTilesAttribution: 'Maps <img src=x onerror=alert(1)>' });
	assert.equal(result.url, 'https://tiles.example/{z}/{x}/{y}.png');
	assert.equal(result.info.attribution, 'Maps &lt;img src=x onerror=alert(1)&gt;');
	const linked = config({ mapTilesAttribution: '© Example', mapTilesAttributionUrl: 'https://example.com/copyright?x=1&y=2' });
	assert.equal(linked.info.attribution, '<a href="https://example.com/copyright?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">© Example</a>');
	const injectedUrl = config({ mapTilesAttributionUrl: 'https://example.com/" onmouseover="alert(1)' });
	assert.equal(injectedUrl.info.attribution.includes('" onmouseover='), false);
	assert.equal(injectedUrl.info.attribution.includes('<script'), false);
	assert.equal(config({ mapTilesAttribution: '  ' }), null);
	assert.equal(config({ mapTilesUrl: 42 }), null);
	assert.equal(config({ mapTilesAttribution: {} }), null);
	assert.equal(config({ mapTilesUrl: 'http://tiles.example/{z}/{x}/{y}.png' }), null);
	assert.equal(config({ mapTilesUrl: 'https://tiles.example/{z}/{x}.png' }), null);
	assert.equal(config({ mapTilesUrl: 'not a URL/{z}/{x}/{y}' }), null);
	assert.equal(config({ mapTilesAttributionUrl: 'javascript:alert(1)' }), null);
	assert.equal(config({ mapTilesAttributionUrl: 'https://user:pass@example.com/legal' }), null);
	assert.equal(config({ mapTilesAttributionUrl: 'https://%' }), null);
});

test('public OpenStreetMap tile endpoints cannot be configured', () => {
	for(const url of [
		'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
		'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
		'https://tile.openstreetmap.org.:443/{z}/{x}/{y}.png',
		'https://user@tile.openstreetmap.org/{z}/{x}/{y}.png',
		'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
		'https://a.tile.openstreetmap.de/{z}/{x}/{y}.png',
	]) assert.equal(config({ mapTilesUrl: url }), null, url);
});

test('coordinate validation rejects malformed or out of range positions', () => {
	assert.equal(Util.isValidLatLng(0, 0), true);
	assert.equal(Util.isValidLatLng(-90, 180), true);
	assert.equal(Util.isValidLatLng(NaN, 0), false);
	assert.equal(Util.isValidLatLng(91, 0), false);
	assert.equal(Util.isValidLatLng(0, -181), false);
	assert.equal(Util.isValidLatLng('0', '0'), false);
});
