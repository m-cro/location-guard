#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const chrome = process.argv[2];
const extensionDir = path.resolve(process.argv[3] || 'build/chrome');
if(!chrome) {
	console.error('Set CHROME to a Chrome for Testing or Chromium executable.');
	process.exit(2);
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function cdp(url) {
	const socket = new WebSocket(url);
	const pending = new Map();
	const listeners = new Map();
	let nextId = 1;
	let closed = false;
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	socket.addEventListener('close', () => {
		closed = true;
		for(const entry of pending.values()) entry.reject(new Error('Chrome DevTools connection closed'));
		pending.clear();
	});
	socket.addEventListener('message', event => {
		const message = JSON.parse(event.data);
		if(message.id) {
			const entry = pending.get(message.id);
			if(!entry) return;
			pending.delete(message.id);
			if(message.error) entry.reject(new Error(message.error.message));
			else entry.resolve(message.result);
		} else {
			for(const listener of listeners.get(message.method) || []) listener(message.params);
		}
	});
	return {
		send(method, params = {}) {
			const id = nextId++;
			return new Promise((resolve, reject) => {
				if(closed) return reject(new Error('Chrome DevTools connection is closed'));
				pending.set(id, { resolve, reject });
				socket.send(JSON.stringify({ id, method, params }));
			});
		},
		on(method, listener) {
			if(!listeners.has(method)) listeners.set(method, []);
			listeners.get(method).push(listener);
		},
		close() { socket.close(); }
	};
}

async function fetchJson(url, options) {
	const response = await fetch(url, options);
	if(!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
	return response.json();
}

async function waitFor(read, predicate, label, timeoutMs = 15000) {
	const end = Date.now() + timeoutMs;
	let value;
	do {
		value = await read();
		if(predicate(value)) return value;
		await delay(100);
	} while(Date.now() < end);
	throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(value)}`);
}

async function evaluate(page, expression) {
	const result = await page.send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true
	});
	if(result.exceptionDetails)
		throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	return result.result.value;
}

async function pageForTarget(targetId, listTargets) {
	const target = await waitFor(
		async () => (await listTargets()).find(item => item.id === targetId && item.webSocketDebuggerUrl),
		Boolean,
		`CDP page target ${targetId}`
	);
	return cdp(target.webSocketDebuggerUrl);
}

async function main() {
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'location-guard-chrome-smoke-'));
	const localServer = http.createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end(`<!doctype html><meta charset="utf-8"><title>Location Guard Geo Smoke</title><body>
		<script>
		navigator.geolocation.getCurrentPosition(position => {
			document.body.dataset.position = JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy });
		}, error => { document.body.dataset.error = error.message; });
		</script></body>`);
	});
	await new Promise(resolve => localServer.listen(0, '127.0.0.1', resolve));
	const localUrl = `http://localhost:${localServer.address().port}/`;
	const args = [
		'--headless=new',
		'--disable-gpu',
		'--no-first-run',
		'--no-default-browser-check',
		`--user-data-dir=${profile}`,
		'--remote-debugging-port=0',
		`--load-extension=${extensionDir}`,
		'about:blank'
	];
	const browser = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
	let output = '';
	for(const stream of [browser.stdout, browser.stderr])
		stream.on('data', chunk => { output = (output + chunk).slice(-6000); });
	const browsers = new Set();
	const pages = new Set();
	let killedByScript = false;
	let spawnError;
	browser.on('error', error => { spawnError = error; });
	try {
		const activePort = path.join(profile, 'DevToolsActivePort');
		const portFile = await waitFor(() => {
			if(spawnError) throw spawnError;
			if(browser.exitCode !== null || browser.signalCode)
				throw new Error(`Chrome exited with code ${browser.exitCode}, signal ${browser.signalCode}. Recent output:\n${output}`);
			try { return fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/); }
			catch { return null; }
		}, value => value && /^\d+$/.test(value[0]), 'Chrome ephemeral DevTools port file', 20000);
		const debugPort = Number(portFile[0]);
		const versionUrl = `http://127.0.0.1:${debugPort}/json/version`;
		const version = await waitFor(async () => {
			try { return await fetchJson(versionUrl); }
			catch { return null; }
		}, value => value && value.webSocketDebuggerUrl, 'Chrome DevTools endpoint', 20000);
		const browserCdp = await cdp(version.webSocketDebuggerUrl);
		browsers.add(browserCdp);
		await browserCdp.send('Browser.grantPermissions', {
			origin: localUrl.slice(0, localUrl.indexOf('/', 'http://'.length)),
			permissions: ['geolocation']
		});
		const listTargets = () => fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
		const extensionTarget = await waitFor(
			async () => (await listTargets()).find(item => item.type === 'service_worker' && /chrome-extension:\/\/[^/]+\/js\/service-worker\.js$/.test(item.url)),
			Boolean,
			'Location Guard service worker'
		);
		const extensionId = extensionTarget.url.match(/^chrome-extension:\/\/([^/]+)/)[1];
		const demoCreated = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
		const demoTarget = await waitFor(
			async () => (await listTargets()).find(item => item.id === demoCreated.targetId),
			Boolean,
			'Location Guard demo page'
		);
		const demo = await pageForTarget(demoTarget.id, listTargets);
		pages.add(demo);
		const demoErrors = [];
		await demo.send('Runtime.enable');
		demo.on('Runtime.exceptionThrown', event => demoErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
		await demo.send('Page.navigate', { url: `chrome-extension://${extensionId}/demo.html` });
		const demoInfo = await waitFor(
			() => evaluate(demo, '({title: document.title, ready: document.readyState, map: !!document.querySelector("#demoMap .leaflet-map-pane"), grid: !!document.querySelector("#demoMap .map-offline-note")})'),
			state => state && state.ready === 'complete' && state.map && state.grid,
			'demo page map and offline grid rendering'
		);
		assert.match(demoInfo.title, /Location Guard/);

		const optionsTarget = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
		const options = await pageForTarget(optionsTarget.targetId, listTargets);
		pages.add(options);
		await options.send('Runtime.enable');
		await options.send('Network.enable');
		const pageErrors = [];
		const requests = [];
		options.on('Runtime.exceptionThrown', event => pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
		options.on('Network.requestWillBeSent', event => requests.push(event.request.url));
		await options.send('Page.navigate', { url: `chrome-extension://${extensionId}/options.html#fixedPos` });
		const controls = await waitFor(
			() => evaluate(options, `({
				ready: document.readyState,
				latitude: document.getElementById('fixedLatitude')?.value,
				longitude: document.getElementById('fixedLongitude')?.value,
				grid: !!document.querySelector('#fixedPosMap .map-offline-note')
			})`),
			state => state && state.ready === 'complete' && state.latitude !== undefined && state.grid,
			'Options UI controls and offline map grid'
		);
		await evaluate(options, `(() => {
			document.getElementById('defaultLevel').value = 'fixed';
			document.getElementById('defaultLevel').dispatchEvent(new Event('change', {bubbles:true}));
			return true;
		})()`);
		await waitFor(() => evaluate(options, "chrome.storage.local.get('global').then(items => items.global?.defaultLevel)"), value => value === 'fixed', 'saved default fixed privacy level');
		await evaluate(options, `(() => {
			const fixed = document.getElementById('fixedPosNoAPI');
			fixed.checked = true;
			fixed.dispatchEvent(new Event('change', {bubbles:true}));
			return true;
		})()`);
		await waitFor(() => evaluate(options, "chrome.storage.local.get('global').then(items => items.global?.fixedPosNoAPI)"), value => value === true, 'saved disable-geolocation option');
		await evaluate(options, `(() => {
			document.getElementById('fixedLatitude').value = '37.421999';
			document.getElementById('fixedLongitude').value = '-122.084057';
			document.getElementById('saveFixedCoordinates').click();
			return true;
		})()`);
		await waitFor(
			() => evaluate(options, "chrome.storage.local.get('global').then(items => items.global?.fixedPos)"),
			value => value && Math.abs(value.latitude - 37.421999) < 1e-9 && Math.abs(value.longitude + 122.084057) < 1e-9,
			'saved fixed coordinates'
		);

		const geoTarget = await browserCdp.send('Target.createTarget', { url: localUrl });
		const geoPage = await pageForTarget(geoTarget.targetId, listTargets);
		pages.add(geoPage);
		const position = await waitFor(
			() => evaluate(geoPage, 'document.body.dataset.position ? JSON.parse(document.body.dataset.position) : null'),
			value => value && Number.isFinite(value.latitude),
			'fixed geolocation response on localhost'
		);
		assert.ok(Math.abs(position.latitude - 37.421999) < 1e-9, `unexpected latitude: ${position.latitude}`);
		assert.ok(Math.abs(position.longitude + 122.084057) < 1e-9, `unexpected longitude: ${position.longitude}`);
		assert.equal(position.accuracy, 10);
		await delay(250);
		assert.deepEqual([...demoErrors, ...pageErrors], [], `Extension page JavaScript errors: ${[...demoErrors, ...pageErrors].join('; ')}`);
		assert.ok(!requests.some(url => {
			try { return /^tile\.openstreetmap\.(?:org|de)$/i.test(new URL(url).hostname); }
			catch { return false; }
		}), 'offline default requested public OSM tiles');

		console.log(`Chrome smoke passed: extension ${extensionId}; demo rendered; Options controls/grid rendered; fixed localhost geolocation ${position.latitude}, ${position.longitude}; no options exceptions or public OSM tile requests.`);
		console.log(`Options controls observed: latitude=${controls.latitude}, longitude=${controls.longitude}.`);
	} finally {
		for(const page of pages) page.close();
		for(const client of browsers) client.close();
		await new Promise(resolve => localServer.close(resolve));
		if(browser.exitCode === null) {
			killedByScript = true;
			browser.kill('SIGTERM');
			await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(3000)]);
			if(browser.exitCode === null) browser.kill('SIGKILL');
		}
		fs.rmSync(profile, { recursive: true, force: true });
		if(!killedByScript && browser.exitCode !== 0 && browser.exitCode !== null) {
			throw new Error(`Chrome exited with ${browser.exitCode}. Recent output:\n${output}`);
		}
	}
}

main().catch(error => {
	console.error(error.stack || error);
	process.exitCode = 1;
});
