// Escaping and sanitising, in plain Node. No browser needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../dither-field.js';
import {
	jsonForScript, escapeAttr, escapeHtml, normaliseColour, cleanGlyph,
	isSelector, isFontStack, sanitiseConfig,
} from '../tuner/safe.js';
import { exportOptions, colourStyle, buildSnippet, buildDemoHtml, buildSettingsJson } from '../tuner/export.js';

describe('jsonForScript', () => {
	test('neutralises anything that could end a script element', () => {
		const out = jsonForScript({ glyph: '</script><img src=x onerror=alert(1)>', note: '<!--' });
		assert.ok(!out.includes('<'), 'no literal < may survive');
		assert.ok(!out.includes('>'), 'no literal > may survive');
		assert.ok(!/<\/script/i.test(out));
	});

	test('escapes the line separators that break script parsing', () => {
		const out = jsonForScript({ a: ' ', b: ' ' });
		assert.ok(out.includes('\\u2028') && out.includes('\\u2029'));
		assert.ok(!out.includes(' '));
	});

	test('still parses back to the original value', () => {
		const value = { glyph: '</script>&< x' };
		assert.deepEqual(JSON.parse(jsonForScript(value)), value);
	});
});

describe('escapeAttr and escapeHtml', () => {
	test('close quote breakout', () => {
		const out = escapeAttr('" onload="alert(1)');
		assert.ok(!out.includes('"'));
		assert.ok(out.includes('&quot;'));
	});

	test('escape angle brackets in body text', () => {
		assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
	});
});

describe('normaliseColour', () => {
	for (const good of ['#fff', '#ffffff', '#ffffffcc', 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', 'hsl(200 50% 50%)', 'red', 'transparent', 'currentColor']) {
		test(`accepts ${good}`, () => assert.ok(normaliseColour(good), `${good} should be accepted`));
	}

	for (const bad of [
		'red; } body { display: none }',
		'url(javascript:alert(1))',
		'var(--x)',
		'expression(alert(1))',
		'#fff;}',
		'rgb(1,2,3)<script>',
		'red\n}',
		'/* */red',
		'a'.repeat(100),
		42,
		null,
	]) {
		test(`rejects ${String(bad).slice(0, 28)}`, () => assert.equal(normaliseColour(bad), null));
	}

	test('canonicalises case', () => assert.equal(normaliseColour('#AABBCC'), '#aabbcc'));
});

describe('cleanGlyph', () => {
	test('caps at two code points', () => assert.equal(cleanGlyph('abcdef'), 'ab'));
	test('keeps astral characters whole', () => assert.equal([...cleanGlyph('🙂🙂🙂')].length, 2));
	test('strips control characters', () => assert.equal(cleanGlyph('\u0000a\u001f'), 'a'));
	test('drops lone surrogates', () => assert.ok(!/[\ud800-\udfff]/.test(cleanGlyph('\ud800x'))));
	test('handles non-strings', () => assert.equal(cleanGlyph(null), ''));
});

describe('isSelector and isFontStack', () => {
	test('accept ordinary values', () => {
		assert.ok(isSelector('[data-dither-quiet]'));
		assert.ok(isSelector('.name, h1'));
		assert.ok(isFontStack('ui-monospace, "Anonymous Pro", monospace'));
	});
	test('reject hostile or oversized values', () => {
		assert.ok(!isSelector('x'.repeat(200)));
		assert.ok(!isSelector('a{}'));
		assert.ok(!isFontStack('x; } body { display:none'));
		assert.ok(!isFontStack('url(evil.woff2)'));
	});
});

describe('sanitiseConfig', () => {
	test('does not pollute Object.prototype', () => {
		const raw = JSON.parse('{"__proto__": {"polluted": true}, "fps": 12}');
		const out = sanitiseConfig(raw);
		assert.equal({}.polluted, undefined, 'Object.prototype must be untouched');
		assert.equal(out.polluted, undefined);
		assert.equal(out.fps, 12);
	});

	test('drops unknown keys', () => {
		const out = sanitiseConfig({ fps: 10, nonsense: 'x', onload: 'alert(1)' });
		assert.deepEqual(Object.keys(out), ['fps']);
	});

	test('clamps the values that could wedge the engine', () => {
		assert.equal(sanitiseConfig({ maxCells: 0 }).maxCells, 64);
		assert.equal(sanitiseConfig({ maxCells: NaN }).maxCells, DEFAULTS.maxCells);
		assert.equal(sanitiseConfig({ maxCells: Infinity }).maxCells, DEFAULTS.maxCells);
		assert.equal(sanitiseConfig({ maxCells: 1e999 }).maxCells, DEFAULTS.maxCells);
		assert.equal(sanitiseConfig({ maxCells: '9' }).maxCells, 64);
		assert.equal(sanitiseConfig({ cellSize: 0 }).cellSize, 1);
		assert.equal(sanitiseConfig({ fps: 999 }).fps, 60);
		assert.equal(sanitiseConfig({ density: -50 }).density, -1);
	});

	test('truncates layers and cleans their glyphs', () => {
		const out = sanitiseConfig({
			layers: Array.from({ length: 12 }, () => ({ glyph: '</script>', opacity: 5 })),
			layerCount: 6,
		});
		assert.equal(out.layers.length, 6);
		assert.equal(out.layers[0].glyph.length <= 2, true);
		assert.equal(out.layers[0].opacity, 1);
	});

	test('keeps layerCount within the layers it was given', () => {
		const out = sanitiseConfig({ layers: [{ glyph: 'a' }, { glyph: 'b' }], layerCount: 6 });
		assert.equal(out.layerCount, 2);
	});

	test('only accepts the two overlap values', () => {
		assert.equal(sanitiseConfig({ overlap: 'stack' }).overlap, 'stack');
		assert.equal(sanitiseConfig({ overlap: 'evil' }).overlap, undefined);
	});

	test('requires two-number arrays for the width-based values', () => {
		const out = sanitiseConfig({ responsive: { patternSize: ['x'], quietSize: [1, 2, 3] } });
		assert.deepEqual(out.responsive.quietSize, DEFAULTS.responsive.quietSize);
		assert.equal(Number.isFinite(out.responsive.patternSize[0]), true);
	});

	test('falls back to a safe anchor selector', () => {
		const out = sanitiseConfig({ anchorQuiet: { anchor: 'a{}', size: 2 } });
		assert.equal(out.anchorQuiet.anchor, '[data-dither-quiet]');
	});

	test('survives junk input', () => {
		for (const junk of [null, undefined, 42, 'x', []]) assert.deepEqual(sanitiseConfig(junk), {});
	});
});

describe('exportOptions', () => {
	const tuned = {
		...structuredClone(DEFAULTS),
		layerCount: 2,
		paused: true,
		respectReducedMotion: false,
	};

	test('never ships the tuner-only flags', () => {
		const out = exportOptions(tuned);
		assert.equal('paused' in out, false, 'exporting paused would freeze the texture');
		assert.equal('respectReducedMotion' in out, false, 'exporting this would override a visitor setting');
	});

	test('ships only the layers that are drawn', () => {
		const out = exportOptions(tuned);
		assert.equal(out.layers.length, 2);
	});

	test('fills the width-based values', () => {
		const out = exportOptions({ ...tuned, responsive: { minWidth: 320, maxWidth: 1440 } });
		assert.equal(out.responsive.patternSize.length, 2);
		assert.equal(out.responsive.anchorSize.length, 2);
	});
});

describe('colourStyle', () => {
	test('passes valid colours through', () => {
		const css = colourStyle({ colours: ['#80e862', '#2ad1b2'], backdrop: '#ecefe5', backdropOn: true }, 2);
		assert.ok(css.includes('--dither-layer-1:#80e862'));
		assert.ok(css.includes('--dither-backdrop:#ecefe5'));
	});

	test('cannot be used to escape the style attribute', () => {
		const css = colourStyle({ colours: ['red; } body { display: none } .x {'], backdropOn: false }, 1);
		assert.ok(!css.includes('}'), 'no brace may survive');
		assert.ok(!css.includes(';}'));
		assert.ok(css.includes('currentColor'), 'a rejected colour falls back');
	});

	test('a backdrop that is switched off stays transparent', () => {
		assert.ok(colourStyle({ backdrop: '#fff', backdropOn: false }, 0).includes('transparent'));
	});
});

describe('the built output', () => {
	const hostile = {
		...structuredClone(DEFAULTS),
		layerCount: 1,
		layers: [{ glyph: '</script><img src=x onerror="window.__xss=1">', threshold: 0, opacity: 1, timeOffset: 0 }],
	};
	const style = colourStyle({ colours: ['}body{display:none'], backdropOn: false }, 1);
	const engineSource = 'export function createDitherField() { return null; }';

	for (const mode of ['cdn', 'host', 'inline']) {
		test(`snippet (${mode}) contains nothing that can break out`, () => {
			const out = buildSnippet({ options: exportOptions(hostile), style, mode, engineSource });
			assert.ok(!/<\/script\s*>[^]*<\/script\s*>[^]*<\/script/i.test(out), 'only the intended closer');
			assert.ok(!out.includes('onerror='), 'the glyph must not land as markup');
			assert.ok(!out.includes('}body{'), 'the colour must not land in CSS');
			assert.ok(out.includes('z-index:-1'), 'the texture must sit behind page content');
			assert.ok(out.includes('isolation:isolate'));
		});
	}

	test('the CDN snippet pins a version', () => {
		const out = buildSnippet({ options: exportOptions(hostile), style, mode: 'cdn' });
		assert.ok(/@v\d+\.\d+\.\d+\//.test(out), 'the CDN URL must be pinned, never @main');
	});

	test('the demo page is self-contained and escapes the same way', () => {
		const out = buildDemoHtml({ options: exportOptions(hostile), style, engineSource, backdrop: '#ecefe5' });
		assert.ok(out.startsWith('<!doctype html>'));
		assert.ok(!out.includes('onerror='));
		assert.ok(!/https?:\/\//.test(out.replace(/github\.com\/gnome00\/dither-field/g, '')), 'no network requests');
	});

	test('the settings file is versioned and colour-checked', () => {
		const json = JSON.parse(buildSettingsJson({ options: exportOptions(hostile), colours: ['#fff', 'red; }'], backdrop: '#ecefe5', backdropOn: true }));
		assert.equal(json.ditherField, 1);
		assert.ok(json.engine);
		assert.equal(json.colours[1], 'currentColor', 'a bad colour is replaced, not carried');
	});

	test('the engine source carries nothing that breaks an inline script', async () => {
		const { readFile } = await import('node:fs/promises');
		const src = await readFile(new URL('../dither-field.js', import.meta.url), 'utf8');
		assert.ok(!/<\/script/i.test(src), 'the engine is inlined into exports');
		assert.ok(!src.includes('<!--'));
	});
});
