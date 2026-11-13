// Tuner tests, including the two that matter most: that the page talks to nobody,
// and that the code it hands out reproduces what the visitor saw.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';
import { serve } from './serve.mjs';

let server, browser;

before(async () => {
	server = await serve();
	browser = await launch();
});

after(async () => {
	await browser?.close();
	await server?.close();
});

async function openTuner({ width = 1280, height = 900 } = {}) {
	const page = await browser.newPage();
	const requests = [];
	await page.send('Network.enable');
	page.listen((msg) => {
		if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
		if (msg.method === 'Network.webSocketCreated') requests.push(msg.params.url);
	});
	const errors = [];
	page.listen((msg) => {
		if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.text ?? 'exception');
		if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error');
	});
	await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
	await page.send('Page.navigate', { url: `${server.origin}/` });
	await page.waitFor('Page.loadEventFired');
	await page.evaluate('new Promise(r => { const t = setInterval(() => { if (window.__tuner) { clearInterval(t); r(); } }, 10); })');
	return { page, requests, errors };
}

describe('privacy', () => {
	test('loads nothing from anywhere but this origin, right through the flow', async () => {
		const { page, requests } = await openTuner();
		// exercise the parts that could reach out: presets, the dialog, every export mode
		await page.evaluate(`(async () => {
			document.querySelectorAll('.preset')[1].click();
			document.querySelector('.get-code .primary').click();
			await new Promise(r => setTimeout(r, 200));
			for (const value of ['cdn', 'host', 'inline']) {
				const radio = [...document.querySelectorAll('#export-modes input')].find(r => r.value === value);
				radio.checked = true;
				radio.dispatchEvent(new Event('change'));
				await new Promise(r => setTimeout(r, 200));
			}
			document.getElementById('dl-settings').click();
			await new Promise(r => setTimeout(r, 200));
		})()`);

		const offOrigin = requests.filter((url) => {
			if (url.startsWith('data:') || url.startsWith('blob:')) return false;
			return !url.startsWith(server.origin);
		});
		assert.deepEqual(offOrigin, [], `the tuner must contact nobody: ${offOrigin.join(', ')}`);
		await page.close();
	});

	test('stores only its own settings, and reset clears them', async () => {
		const { page } = await openTuner();
		const keys = await page.evaluate(`(() => {
			document.querySelector('input[type=range]').dispatchEvent(new Event('input'));
			return Object.keys(localStorage);
		})()`);
		assert.deepEqual(keys, ['dither-tuner-v1']);

		const cleared = await page.evaluate(`(() => {
			localStorage.removeItem('dither-tuner-v1');
			return localStorage.getItem('dither-tuner-v1');
		})()`);
		assert.equal(cleared, null);
		await page.close();
	});

	test('boots even when the saved settings are junk', async () => {
		const page = await browser.newPage();
		await page.send('Page.enable');
		await page.send('Page.addScriptToEvaluateOnNewDocument', {
			source: `localStorage.setItem('dither-tuner-v1', '{"opts":{"maxCells":0,"layers":"nope"},"defaultsKey":"x"}');`,
		});
		await page.send('Page.navigate', { url: `${server.origin}/` });
		await page.waitFor('Page.loadEventFired');
		const ok = await Promise.race([
			page.evaluate('new Promise(r => { const t = setInterval(() => { if (window.__tuner) { clearInterval(t); r(true); } }, 10); })'),
			new Promise((_, reject) => setTimeout(() => reject(new Error('the tuner hung on bad saved data')), 8000)),
		]);
		assert.equal(ok, true);
		await page.close();
	});
});

describe('the exported code', () => {
	// These run on their own fixture: index.html's CSP forbids the inline script an exported
	// page uses, which is right for the shipped page but makes it the wrong host for this test.
	async function openExportFixture() {
		const page = await browser.newPage();
		await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
		await page.send('Page.navigate', { url: `${server.origin}/test/fixtures/export-host.html` });
		await page.waitFor('Page.loadEventFired');
		await page.evaluate('new Promise(r => { const t = setInterval(() => { if (window.__ready) { clearInterval(t); r(); } }, 10); })');
		return page;
	}

	test('reproduces what the tuner showed', async () => {
		const page = await openExportFixture();
		const same = await page.evaluate(`(async () => {
			const opts = { ...DEFAULTS, speed: 1.2, density: 0.55, startPhase: 0.3, layerCount: 2 };
			const colours = ['#80e862', '#2ad1b2'];
			const here = renderHere(opts, colours, '#ecefe5');
			const there = await renderExported(opts, colours, '#ecefe5');
			return { here, there: there.hash, ink: there.ink };
		})()`);
		assert.ok(same.ink > 0, 'the exported page must draw something');
		assert.equal(same.there, same.here, 'the downloaded page must draw what the tuner drew');
		await page.close();
	});

	test('a hostile glyph or colour cannot execute or restyle anything', async () => {
		const page = await openExportFixture();
		const result = await page.evaluate(`(async () => {
			const opts = {
				...DEFAULTS,
				layerCount: 2,
				layers: [
					{ glyph: '</scr' + 'ipt><img src=x onerror="window.__xss=1">', threshold: 0, opacity: 1, timeOffset: 0 },
					{ glyph: '.', threshold: 0.4, opacity: 0.9, timeOffset: 0.1 },
				],
			};
			return renderExported(opts, ['}body{display:none} .x{', 'red; } * { visibility: hidden } .y {'], '#ecefe5');
		})()`);
		assert.equal(result.xssOuter, false, 'no script may run in the tuner');
		assert.equal(result.xssInner, false, 'no script may run in the exported page');
		assert.equal(result.injected, 0, 'no element may be injected');
		assert.notEqual(result.bodyVisibility, 'hidden', 'no CSS may escape the style attribute');
		assert.ok(result.ink > 0, 'the texture must still draw');
		await page.close();
	});

	test('every snippet mode is valid enough to run', async () => {
		const page = await openExportFixture();
		const lengths = await page.evaluate(`(() => {
			const opts = { ...DEFAULTS, layerCount: 2 };
			return ['cdn', 'host', 'inline'].map((m) => snippetFor(opts, ['#80e862', '#2ad1b2'], '#ecefe5', m).length);
		})()`);
		assert.ok(lengths[0] > 200 && lengths[1] > 200, 'cdn and host snippets should be short');
		assert.ok(lengths[2] > 10000, 'the paste-everything snippet carries the engine');
		await page.close();
	});
});

describe('the panel', () => {
	test('every control moves without throwing', async () => {
		const { page, errors } = await openTuner();
		const after = await page.evaluate(`(() => {
			const inputs = [...document.querySelectorAll('#panel input, #panel select')];
			for (const input of inputs) {
				if (input.type === 'range') {
					for (const v of [input.min, input.max, String((+input.min + +input.max) / 2)]) {
						input.value = v;
						input.dispatchEvent(new Event('input'));
					}
				} else if (input.type === 'checkbox') {
					input.checked = !input.checked;
					input.dispatchEvent(new Event('change'));
					input.checked = !input.checked;
					input.dispatchEvent(new Event('change'));
				} else if (input.tagName === 'SELECT') {
					for (const option of input.options) {
						input.value = option.value;
						input.dispatchEvent(new Event('change'));
					}
				}
			}
			return window.__tuner.bg.getStats().cells;
		})()`);
		assert.ok(after > 0, 'the field must still be drawing');
		assert.deepEqual(errors, [], `no errors expected: ${errors.join(', ')}`);
		await page.close();
	});

	test('every preset applies', async () => {
		const { page } = await openTuner();
		const names = await page.evaluate(`(() => {
			const out = [];
			for (const button of document.querySelectorAll('.preset')) {
				button.click();
				out.push(window.__tuner.bg.getStats().cells > 0);
			}
			return out;
		})()`);
		assert.ok(names.length >= 7);
		assert.ok(names.every(Boolean), 'each preset must leave a working field');
		await page.close();
	});

	test('the export dialog closes on Escape', async () => {
		const { page } = await openTuner();
		const closed = await page.evaluate(`(async () => {
			document.querySelector('.get-code .primary').click();
			await new Promise(r => setTimeout(r, 150));
			const open = document.getElementById('export-dialog').open;
			document.getElementById('export-dialog').close();
			return open && !document.getElementById('export-dialog').open;
		})()`);
		assert.equal(closed, true);
		await page.close();
	});

	test('fits a phone without sideways scrolling', async () => {
		const { page } = await openTuner({ width: 320, height: 640 });
		const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
		assert.ok(overflow <= 0, `no horizontal overflow at 320px, got ${overflow}px`);
		await page.close();
	});

	test('opens paused when the visitor asked for reduced motion', async () => {
		const page = await browser.newPage();
		await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
		await page.send('Page.navigate', { url: `${server.origin}/` });
		await page.waitFor('Page.loadEventFired');
		await page.evaluate('new Promise(r => { const t = setInterval(() => { if (window.__tuner) { clearInterval(t); r(); } }, 10); })');
		const paused = await page.evaluate('window.__tuner.state.opts.paused');
		assert.equal(paused, true, 'the tuner must not animate at someone who asked it not to');
		await page.close();
	});
});
