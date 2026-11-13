// Engine tests. Chrome-only by design: they read canvas pixels, and Firefox's
// resistFingerprinting and Brave's farbling add noise to getImageData.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';
import { serve } from './serve.mjs';

let server, browser, page;

before(async () => {
	server = await serve();
	browser = await launch();
});

after(async () => {
	await browser?.close();
	await server?.close();
});

// A page at a known size, with the fixture loaded and fonts settled.
async function openFixture({ width = 1440, height = 900, dpr = 1, path = '/test/fixtures/engine-host.html' } = {}) {
	page = await browser.newPage();
	await page.send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor: dpr,
		mobile: false,
	});
	await page.send('Page.navigate', { url: `${server.origin}${path}` });
	await page.waitFor('Page.loadEventFired');
	await page.evaluate('new Promise(r => { const t = setInterval(() => { if (window.__ready) { clearInterval(t); r(); } }, 10); })');
	return page;
}

describe('the loop', () => {
	test('has no seam: the wrap is no bigger a step than any other frame', async () => {
		const p = await openFixture();
		await p.evaluate('makeField({ paused: true })');

		// One frame at the default speed, as a fraction of the loop.
		const step = await p.evaluate('(1.9 / 15) / 60');
		const diffs = await p.evaluate(`(async () => {
			const c = document.querySelector('#bg canvas');
			const ctx = c.getContext('2d');
			const frameAt = (ph) => { field.setPhase(ph); return ctx.getImageData(0, 0, c.width, c.height).data; };
			// How many cells changed between two frames — the honest measure of a step.
			const changed = (a, b) => { let n = 0; for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) n++; return n; };
			const step = ${step};
			const diff = (x, y) => changed(frameAt(x), frameAt(y));
			const wrap = diff(1 - step, 0);
			const others = [];
			for (let i = 1; i <= 12; i++) { const ph = i / 13; others.push(diff(ph, ph + step)); }
			return { wrap, others };
		})()`);

		const median = diffs.others.sort((a, b) => a - b)[Math.floor(diffs.others.length / 2)];
		assert.ok(
			diffs.wrap <= Math.max(median * 1.5, median + 50),
			`wrap step (${diffs.wrap}) should be no larger than an ordinary step (median ${median})`
		);
		await p.close();
	});

	test('is deterministic, and different phases differ', async () => {
		const p = await openFixture();
		await p.evaluate('makeField({ paused: true })');
		const [a1, b, a2, half] = await p.evaluate(`(() => {
			field.setPhase(0.25); const a1 = canvasHash();
			field.setPhase(0.8);  const b  = canvasHash();
			field.setPhase(0.25); const a2 = canvasHash();
			field.setPhase(0.75); const half = canvasHash();
			return [a1, b, a2, half];
		})()`);
		assert.equal(a1, a2, 'the same phase must render the same frame');
		assert.notEqual(a1, b, 'different phases must differ');
		assert.notEqual(a1, half, 'different phases must differ');
		await p.close();
	});
});

describe('performance guards', () => {
	test('keeps the grid under maxCells', async () => {
		const p = await openFixture({ width: 1440, height: 900 });
		const big = await p.evaluate('makeField({ paused: true, maxCells: 2000 }) && field.getStats()');
		assert.ok(big.cells <= 2000, `cells ${big.cells} should be <= 2000`);
		assert.equal(big.cols * big.rows, big.cells);

		const dflt = await p.evaluate('makeField({ paused: true }) && field.getStats()');
		assert.ok(dflt.cells <= 8000, `cells ${dflt.cells} should be <= 8000`);
		await p.close();
	});

	test('survives maxCells 0, NaN and cellSize 0 instead of freezing', async () => {
		const p = await openFixture();
		// Each of these wedged layout() before the clamp in merge().
		for (const opts of ['{ paused: true, maxCells: 0 }', '{ paused: true, maxCells: NaN }', '{ paused: true, cellSize: 0 }']) {
			const stats = await Promise.race([
				p.evaluate(`makeField(${opts}) && field.getStats()`),
				new Promise((_, reject) => setTimeout(() => reject(new Error(`${opts} hung`)), 5000)),
			]);
			assert.ok(stats.cells > 0 && Number.isFinite(stats.cells), `${opts} should still build a grid`);
		}
		await p.close();
	});

	test('draws one still frame under prefers-reduced-motion', async () => {
		const p = await openFixture();
		await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
		await p.evaluate('makeField({})');
		const before = await p.evaluate('({ phase: field.getPhase(), hash: canvasHash(), stat: field.getStats().static })');
		assert.equal(before.stat, true);
		await p.evaluate('new Promise(r => setTimeout(r, 1200))');
		const after = await p.evaluate('({ phase: field.getPhase(), hash: canvasHash() })');
		assert.equal(after.phase, before.phase, 'phase must not advance');
		assert.equal(after.hash, before.hash, 'the frame must not change');
		const blank = await p.evaluate('inkIn(0, 0, 400, 400) === 0');
		assert.equal(blank, false, 'the still frame must not be blank');
		await p.close();
	});

	test('pauses while the tab is hidden, and resumes', async () => {
		const p = await openFixture();
		await p.evaluate('makeField({})');
		await p.evaluate('new Promise(r => setTimeout(r, 300))');
		await p.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {});
		await p.evaluate(`(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
			document.dispatchEvent(new Event('visibilitychange'));
		})()`);
		const stopped = await p.evaluate('new Promise(r => { const a = field.getPhase(); setTimeout(() => r({ a, b: field.getPhase() }), 800); })');
		assert.equal(stopped.a, stopped.b, 'phase must freeze while hidden');

		await p.evaluate(`(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
			document.dispatchEvent(new Event('visibilitychange'));
		})()`);
		const resumed = await p.evaluate('new Promise(r => { const a = field.getPhase(); setTimeout(() => r({ a, b: field.getPhase() }), 800); })');
		assert.notEqual(resumed.a, resumed.b, 'phase must advance again once visible');
		await p.close();
	});
});

describe('quiet zone', () => {
	test('clears the middle and moves when told to', async () => {
		const p = await openFixture();
		const centred = await p.evaluate(`(() => {
			makeField({ paused: true, quiet: { enabled: true, x: 50, y: 50, size: 40, aspect: 1, softness: 0.2, strength: 1, irregularity: 0 } });
			field.setPhase(0.2);
			return { middle: inkIn(620, 350, 200, 200), corner: inkIn(20, 20, 200, 200) };
		})()`);
		assert.ok(centred.middle < centred.corner * 0.25, `middle ${centred.middle} should be far clearer than corner ${centred.corner}`);

		const moved = await p.evaluate(`(() => {
			field.set({ quiet: { x: 15, y: 20 } });
			field.setPhase(0.2);
			return { middle: inkIn(620, 350, 200, 200), topLeft: inkIn(20, 20, 200, 200) };
		})()`);
		assert.ok(moved.topLeft < moved.middle, 'moving the zone must move the clear area');
		await p.close();
	});

	test('a CSS custom property beats the option', async () => {
		const p = await openFixture();
		const size = await p.evaluate(`(() => {
			document.getElementById('bg').style.setProperty('--dither-quiet-size', '0');
			makeField({ paused: true });
			return field.getStats().quietSize;
		})()`);
		assert.equal(size, 0);
		await p.close();
	});

	test('an invalid anchor selector does not throw', async () => {
		const p = await openFixture();
		const ok = await p.evaluate(`(() => {
			makeField({ paused: true, anchorQuiet: { anchor: '!!!', size: 1.6, aspect: 3, softness: 0.8, strength: 0.8, irregularity: 0.4, timeOffset: 0.37 } });
			field.setPhase(0.2);
			return inkIn(0, 0, 400, 400) > 0;
		})()`);
		assert.equal(ok, true, 'a bad selector must not stop the texture drawing');
		await p.close();
	});
});

describe('layout', () => {
	test('blends width-based values between 320 and 1440', async () => {
		for (const [width, expected] of [[320, 1.15], [1440, 0.63]]) {
			const p = await openFixture({ width, height: 800 });
			const got = await p.evaluate('makeField({ paused: true }) && field.getStats().patternSize');
			assert.ok(Math.abs(got - expected) < 0.02, `at ${width}px patternSize ${got} should be about ${expected}`);
			await p.close();
		}
		const mid = await openFixture({ width: 880, height: 800 });
		const got = await mid.evaluate('makeField({ paused: true }) && field.getStats().patternSize');
		assert.ok(Math.abs(got - 0.89) < 0.03, `at 880px patternSize ${got} should be about 0.89`);
		await mid.close();
	});

	test('handles phone pixel ratios', async () => {
		for (const dpr of [2, 3]) {
			const p = await openFixture({ width: 393, height: 852, dpr });
			const stats = await p.evaluate('makeField({ paused: true }) && field.getStats()');
			assert.ok(stats.cells > 0 && stats.cells <= 8000);
			await p.close();
		}
	});

	test('survives degenerate hosts', async () => {
		const p = await openFixture();
		const ok = await p.evaluate(`(() => {
			const bg = document.getElementById('bg');
			for (const css of ['width:0;height:0', 'width:1px;height:1px', 'display:none']) {
				bg.style.cssText = 'position:absolute;inset:0;overflow:hidden;' + css;
				if (!makeField({ paused: true })) return false;
			}
			return true;
		})()`);
		assert.equal(ok, true);
		await p.close();
	});

	test('stops cleanly on destroy', async () => {
		const p = await openFixture();
		const result = await p.evaluate(`(async () => {
			makeField({});
			await new Promise(r => setTimeout(r, 300));
			field.destroy();
			const draws = window.__draws;
			window.dispatchEvent(new Event('resize'));
			document.dispatchEvent(new Event('visibilitychange'));
			await new Promise(r => setTimeout(r, 400));
			let threw = false;
			try { field.destroy(); } catch { threw = true; }
			return { canvas: !!document.querySelector('#bg canvas'), drawsAfter: window.__draws - draws, threw };
		})()`);
		assert.equal(result.canvas, false, 'the canvas must be removed');
		assert.equal(result.drawsAfter, 0, 'nothing must draw after destroy');
		assert.equal(result.threw, false, 'a second destroy must not throw');
		await p.close();
	});

	test('returns null when there is no 2D context', async () => {
		const p = await openFixture({ path: '/test/fixtures/no-canvas.html' });
		const got = await p.evaluate('window.__result');
		assert.equal(got, 'null');
		await p.close();
	});
});
