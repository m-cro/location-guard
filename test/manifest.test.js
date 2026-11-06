const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

function manifestFor(target) {
	const args = ['-P', `-Dis_${target}`, 'src/manifest.json'];
	if(target !== 'firefox') args.splice(2, 0, '-Dis_chromium_mv3');
	const output = execFileSync('cpp', args, { encoding: 'utf8' });
	return JSON.parse(output.replace(/^\s*\/\/.*$/gm, ''));
}

for(const target of ['chrome', 'edge', 'opera']) {
	test(`${target} builds a Chromium MV3 manifest`, () => {
		const manifest = manifestFor(target);
		assert.equal(manifest.manifest_version, 3);
		assert.equal(manifest.background.service_worker, 'js/service-worker.js');
		assert.ok(manifest.action);
		assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
		assert.ok(manifest.content_scripts.some(script => script.world === 'MAIN' && script.js.includes('js/content/inject.js')));
	});
}

test('Firefox keeps the MV2 background and page action manifest', () => {
	const manifest = manifestFor('firefox');
	assert.equal(manifest.manifest_version, 2);
	assert.deepEqual(manifest.background.scripts, ['js/common.js', 'js/main.js']);
	assert.ok(manifest.page_action);
	assert.ok(!manifest.action);
	assert.deepEqual(manifest.web_accessible_resources, ['js/content/inject.js']);
	assert.ok(!manifest.content_scripts.some(script => script.world === 'MAIN'));
});
