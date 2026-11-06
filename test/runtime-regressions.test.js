const assert = require('assert');
const { test } = require('node:test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const PostRPC = require('../src/js/common/post-rpc');
const injectedCode = require('../src/js/content/injected');

async function testPostRPC() {
	const target = {
		origin: 'https://example.test',
		listeners: [],
		addEventListener(name, listener) { this.listeners.push(listener); },
		postMessage(data) {
			const event = { data, source: target, origin: target.origin };
			for(const listener of target.listeners) listener(event);
		}
	};
	const caller = new PostRPC('test', target, target, target.origin);
	const receiver = new PostRPC('test', target, target, target.origin);
	receiver.register('echo', value => value);
	receiver.register('fail', () => { throw new Error('expected failure'); });
	caller.register('reply', value => value + 1);

	assert.strictEqual(await caller.call('echo', ['ok'], 100), 'ok');
	await assert.rejects(caller.call('fail', [], 100), /expected failure/);
	await assert.rejects(caller.call('missing', [], 100), /No handler/);
	assert.deepStrictEqual(await Promise.all([
		caller.call('echo', ['outbound'], 100),
		receiver.call('reply', [4], 100)
	]), ['outbound', 5], 'simultaneous calls in both directions must not cross replies');
	await assert.rejects(caller.call('toString', [], 100), /No handler/);

	let invoked = false;
	receiver.register('foreign', () => { invoked = true; });
	await receiver._receiveMessage({
		data: { __PostRPC_test: { method: 'foreign', args: [], callId: 10, from: 123 } },
		source: {}, origin: target.origin
	});
	assert.strictEqual(invoked, false, 'messages from another frame must be ignored');
	let extensionInvoked = false;
	receiver.register('extensionMessage', () => { extensionInvoked = true; });
	await receiver._receiveMessage({
		data: { __PostRPC_test: { method: 'extensionMessage', args: [], callId: 11, from: 123 } },
		source: null, origin: target.origin
	});
	assert.strictEqual(extensionInvoked, true, 'browser extension messages can have a null source');
	const sentOrigins = [];
	const opaque = new PostRPC('opaque', { postMessage(data, origin) { sentOrigins.push(origin); } }, null, 'null');
	opaque._sendMessage({ test: true });
	assert.deepStrictEqual(sentOrigins, ['*'], 'opaque origins require wildcard targetOrigin');
}

async function testBrowserBaseHasAWorkerGlobalFallback() {
	const chromeApi = { runtime: {} };
	const module = { exports: {} };
	const context = vm.createContext({
		chrome: chromeApi, module, exports: module.exports,
		navigator: { userAgent: 'service worker test' }
	});
	const filename = path.join(__dirname, '../src/js/common/browser_base.js');
	vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
	assert.strictEqual(context.browser, chromeApi);
	assert.strictEqual(module.exports.capabilities.isAndroid(), false);
}

async function testWatchNeverUsesPageNativeWatch() {
	const nativeCalls = [];
	const listeners = {};
	const geo = {
		getCurrentPosition() {},
		watchPosition() { nativeCalls.push('watchPosition'); return 17; },
		clearWatch() { nativeCalls.push('clearWatch'); }
	};
	const oldNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
	const oldWindow = global.window;
	const oldDocument = global.document;
	Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: geo } });
	global.window = { origin: 'https://example.test', addEventListener() {} };
	global.document = { getElementById() { return null; } };

	class FakePostRPC {
		constructor() { this.calls = []; }
		register(name, handler) { listeners[name] = handler; }
		call(name, args) {
			this.calls.push(name);
			return Promise.resolve(true);
		}
	}
	try {
		injectedCode(FakePostRPC);
		const handler = geo.watchPosition(() => {}, () => {});
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(handler, 0);
		assert.deepStrictEqual(nativeCalls, [], 'page-world code must never start a native watch');
		assert.strictEqual(listeners.watchUpdate instanceof Function, true);
		geo.clearWatch(handler);
		await new Promise(resolve => setImmediate(resolve));
		assert.deepStrictEqual(nativeCalls, [], 'page-world clearWatch must not call native geolocation');
	} finally {
		if(oldNavigator) Object.defineProperty(global, 'navigator', oldNavigator);
		else delete global.navigator;
		if(oldWindow === undefined) delete global.window;
		else global.window = oldWindow;
		if(oldDocument === undefined) delete global.document;
		else global.document = oldDocument;
	}
}

async function testNoisyPositionsStripNativeVerticalAndMotionFields() {
	const state = {
		paused: false, hideIcon: false, cachedPos: {}, fixedPos: { latitude: 1, longitude: 2 },
		fixedPosNoAPI: false, updateAccuracy: true, epsilon: 2,
		levels: { medium: { radius: 500, cacheTime: 30 } },
		defaultLevel: 'medium', domainLevel: {}
	};
	const browserHandlers = {};
	const contentHandlers = {};
	const postRpcCalls = [];
	const nativeWatchCalls = [];
	let nativeWatchCallbacks = null;
	let storageGate = null;
	const Browser = {
		inDemo: true, testing: false,
		init() {},
		capabilities: {
			mainWorldContentScript() { return false; },
			permanentIcon() { return false; },
			iframeGeoFromOwnDomain() { return false; }
		},
		rpc: { register(name, handler) { browserHandlers[name] = handler; }, async call() { return null; } },
		storage: {
			async get() { if(storageGate) await storageGate.promise; return state; },
			async set(value) { Object.assign(state, value); }
		},
		gui: { async refreshIcon() {} },
		log() {}
	};
	const Util = {
		extractDomain(url) { return (/\/\/([^/]+)/.exec(url) || [null, ''])[1]; },
		clone(value) { return value; }
	};
	class FakePostRPC {
		constructor() { this.methods = contentHandlers; }
		register(name, handler) { contentHandlers[name] = handler; }
		call(name, args) { postRpcCalls.push([name, args]); return Promise.resolve(null); }
	}
	const coords = {
		get latitude() { return 51; }, get longitude() { return -1; },
		get accuracy() { return 12; }, get altitude() { return 150; },
		get altitudeAccuracy() { return 4; }, get heading() { return 90; }, get speed() { return 12; }
	};
	const nativePosition = { get coords() { return coords; }, get timestamp() { return 1234; } };
	const navigator = {
		userAgent: 'test',
		geolocation: {
			getCurrentPosition(success) { success(nativePosition); },
			watchPosition(success, error) {
				nativeWatchCalls.push('watch');
				nativeWatchCallbacks = { success, error };
				return 29;
			},
			clearWatch(id) { nativeWatchCalls.push(['clear', id]); }
		}
	};
	const window = { top: null, origin: 'https://demo-page/', location: { href: 'https://demo-page/' } };
	window.top = window;
	const laplace = function() {};
	laplace.prototype.addNoise = () => ({ latitude: 52, longitude: -2 });
	laplace.prototype.alphaDeltaAccuracy = () => 0;
	const requireMock = id => {
		if(id === '../common/browser') return Browser;
		if(id === '../common/util') return Util;
		if(id === '../common/post-rpc') return FakePostRPC;
		if(id === './injected') return () => {};
		if(id === '../common/laplace') return laplace;
		throw new Error('Unexpected require: ' + id);
	};
	const filename = path.join(__dirname, '../src/js/content/content.js');
	const source = fs.readFileSync(filename, 'utf8');
	const module = { exports: {} };
	const context = vm.createContext({
		require: requireMock, module, exports: module.exports,
		window, navigator, document: { documentElement: { tagName: 'html' } },
		console, Promise, Date, Math, setTimeout, clearTimeout
	});
	vm.runInContext(source, context, { filename });
	await new Promise(resolve => setImmediate(resolve));
	const result = await contentHandlers.getNoisyPosition({});
	assert.strictEqual(result.success, true);
	assert.strictEqual(result.position.coords.latitude, 52);
	for(const field of ['altitude', 'altitudeAccuracy', 'heading', 'speed']) {
		assert.strictEqual(result.position.coords[field], null, field + ' must be removed from protected output');
	}
	assert.deepStrictEqual(Object.keys(result.position).sort(), ['coords', 'timestamp']);
	for(const field of ['altitude', 'altitudeAccuracy', 'heading', 'speed']) {
		assert.strictEqual(state.cachedPos.medium.position.coords[field], null, field + ' must not be retained in cache');
	}
	state.cachedPos.medium = {
		epoch: Date.now(),
		position: { coords: { latitude: 1, longitude: 2, accuracy: 3, altitude: 900, altitudeAccuracy: 8, heading: 45, speed: 30 }, timestamp: 5678 }
	};
	const fromOldCache = await contentHandlers.getNoisyPosition({});
	for(const field of ['altitude', 'altitudeAccuracy', 'heading', 'speed']) {
		assert.strictEqual(fromOldCache.position.coords[field], null, field + ' must be removed from older cached entries');
	}

	// Real mode keeps native watch updates inside the content script and relays
	// each result through the sanitized RPC protocol.
	state.defaultLevel = 'real';
	assert.strictEqual(await contentHandlers.startWatch(7, {}), true);
	nativeWatchCallbacks.success(nativePosition);
	await new Promise(resolve => setImmediate(resolve));
	assert.strictEqual(postRpcCalls.at(-1)[0], 'watchUpdate');
	assert.strictEqual(postRpcCalls.at(-1)[1][0], 7);
	assert.strictEqual(postRpcCalls.at(-1)[1][2].coords.altitude, 150, 'real mode retains the configured real coordinates');
	state.defaultLevel = 'medium';
	nativeWatchCallbacks.success(nativePosition);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepStrictEqual(nativeWatchCalls.at(-1), ['clear', 29], 'new protection setting stops an existing native watch');
	assert.strictEqual(postRpcCalls.length, 1, 'no further raw updates are sent after protection becomes active');

	// clearWatch can arrive while settings are still loading; no native watcher
	// should be installed once that pending start is cancelled.
	state.defaultLevel = 'real';
	let releaseStorage;
	storageGate = { promise: new Promise(resolve => { releaseStorage = resolve; }) };
	const starting = contentHandlers.startWatch(8, {});
	await new Promise(resolve => setImmediate(resolve));
	contentHandlers.stopWatch(8);
	releaseStorage();
	assert.strictEqual(await starting, false);
	storageGate = null;
	assert.strictEqual(nativeWatchCalls.filter(call => call === 'watch').length, 1);

	// Protected watches make one sanitized request and never install a native
	// watcher, even if page code forges the old watchAllowed reply.
	state.defaultLevel = 'medium';
	assert.strictEqual(await contentHandlers.startWatch(9, {}), true);
	const protectedUpdate = postRpcCalls.at(-1);
	assert.strictEqual(protectedUpdate[0], 'watchUpdate');
	assert.strictEqual(protectedUpdate[1][0], 9);
	assert.strictEqual(protectedUpdate[1][3], true);
	assert.strictEqual(protectedUpdate[1][2].coords.altitude, null);
	assert.strictEqual(nativeWatchCalls.filter(call => call === 'watch').length, 1);
}

test('PostRPC rejects errors and ignores messages from other frames', testPostRPC);
test('browser base initializes without a window global', testBrowserBaseHasAWorkerGlobalFallback);
test('injected page code never starts a native watch', testWatchNeverUsesPageNativeWatch);
test('protected position output and cache omit raw altitude and motion fields', testNoisyPositionsStripNativeVerticalAndMotionFields);
