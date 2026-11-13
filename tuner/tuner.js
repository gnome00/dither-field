// The tuner: sliders over a live field, and an export dialog that hands the settings back
// as code. Everything it loads is same-origin; nothing it does leaves the browser.

import { createDitherField, DEFAULTS } from '../dither-field.js';
import { PRESETS } from './presets.js';
import { sanitiseConfig, normaliseColour } from './safe.js';
import { exportOptions, colourStyle, buildSnippet, buildDemoHtml, buildSettingsJson, CDN_URL } from './export.js';

const STORE = 'dither-tuner-v1';
// Saved tuning is only reused while the built-in defaults are the same as when it was saved;
// otherwise a visitor returning after an update would see neither their settings nor the new ones.
const DEFAULTS_KEY = JSON.stringify(DEFAULTS);
// Spare layers, so "Layer count" can go above what a preset uses.
const EXTRA_LAYERS = [
	{ glyph: '%', threshold: 0.82, opacity: 1, timeOffset: 0.28 },
	{ glyph: '@', threshold: 0.9, opacity: 1, timeOffset: 0.35 },
];
const PREVIEW_SIZES = { fill: null, mobile: [320, 640], iphone: [393, 852], desktop: [1440, 900] };

const host = document.getElementById('host');
const frame = document.getElementById('frame');
const panel = document.getElementById('panel');
const statsEl = document.getElementById('stats');
const dialog = document.getElementById('export-dialog');
const exportBox = document.getElementById('export-box');
const exportNote = document.getElementById('export-note');
const exportModes = document.getElementById('export-modes');

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function defaults() {
	const d = structuredClone(DEFAULTS);
	d.layers = [...d.layers, ...structuredClone(EXTRA_LAYERS)];
	// The tuner animates even for a visitor who has reduced motion set, because otherwise there is
	// nothing to judge — but it opens paused for them, and "Static frame" is how they let it run.
	d.paused = prefersReducedMotion;
	d.respectReducedMotion = false;
	return {
		opts: d,
		colours: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [i, getComputedStyle(host).getPropertyValue(`--dither-layer-${i}`).trim()])),
		backdrop: '#ecefe5',
		backdropOn: true,
		underlay: true,
		preview: 'fill',
		collapsed: false,
		preset: 'default',
		exportMode: 'cdn',
	};
}

let state = defaults();
try {
	const saved = JSON.parse(localStorage.getItem(STORE));
	if (saved && saved.defaultsKey === DEFAULTS_KEY) {
		// Even our own saved data goes through the sanitiser: this origin is shared with every
		// other project on github.io, and a wedged option would freeze the tab on load.
		const cleanOpts = sanitiseConfig(saved.opts);
		state = { ...state, ...saved, opts: { ...state.opts, ...cleanOpts, quiet: { ...state.opts.quiet, ...cleanOpts.quiet } } };
		state.opts.paused = prefersReducedMotion;
		state.opts.respectReducedMotion = false;
	} else if (saved) {
		for (const k of ['preview', 'underlay', 'exportMode', 'collapsed']) if (k in saved) state[k] = saved[k];
	}
} catch {}

applyColours();
const bg = createDitherField(host, state.opts);

function save() {
	// Sample text is deliberately not saved — this is a public page and people type into it.
	try { localStorage.setItem(STORE, JSON.stringify({ ...state, defaultsKey: DEFAULTS_KEY })); } catch {}
}

function applyColours() {
	for (const [i, c] of Object.entries(state.colours)) {
		host.style.setProperty(`--dither-layer-${i}`, normaliseColour(c) || 'currentColor');
	}
	host.style.setProperty('--dither-backdrop', (state.backdropOn && normaliseColour(state.backdrop)) || 'transparent');
	frame.classList.toggle('underlay', state.underlay);
}

function push(patch) {
	applyColours(); // before the redraw, so the frame picks up new colours
	bg.set(patch);
	save();
	updateExport();
}

function applyPreset(preset) {
	const base = defaults();
	const o = { ...base.opts, ...structuredClone(preset.opts) };
	o.quiet = { ...base.opts.quiet, ...(preset.opts.quiet || {}) };
	if (preset.opts.layers) o.layers = [...structuredClone(preset.opts.layers), ...base.opts.layers.slice(preset.opts.layers.length)];
	// A preset without its own width-based values uses one value at every width.
	o.responsive = preset.opts.responsive || (preset.id === 'default' ? base.opts.responsive
		: { ...base.opts.responsive, patternSize: [o.patternSize, o.patternSize], quietSize: [o.quiet.size, o.quiet.size] });
	state.opts = o;
	state.colours = { ...base.colours };
	preset.colours.forEach((c, i) => (state.colours[i + 1] = c));
	state.backdrop = preset.backdrop;
	state.backdropOn = true;
	state.preset = preset.id;
	applyColours();
	bg.set(o);
	bg.setPhase(o.startPhase || 0);
	save();
	build();
}

// ---- collapsing the panel ----

const reopen = document.getElementById('reopen');

function setCollapsed(collapsed) {
	state.collapsed = collapsed;
	document.body.classList.toggle('collapsed', collapsed);
	reopen.hidden = !collapsed;
	save();
	applyPreview(); // the preview box changed size
	(collapsed ? reopen : document.getElementById('collapse'))?.focus();
}

reopen.addEventListener('click', () => setCollapsed(false));

// ---- preview ----

function applyPreview() {
	const size = PREVIEW_SIZES[state.preview];
	frame.classList.toggle('fill', !size);
	if (!size) {
		frame.style.width = frame.style.height = frame.style.transform = '';
		return;
	}
	frame.style.width = `${size[0]}px`;
	frame.style.height = `${size[1]}px`;
	const stage = document.getElementById('stage').getBoundingClientRect();
	const k = Math.min(1, (stage.width - 24) / size[0], (stage.height - 24) / size[1]);
	frame.style.transform = `translate(-50%, -50%) scale(${k})`;
}
window.addEventListener('resize', applyPreview);

// ---- control builders ----

let idSeed = 0;
const nextId = () => `c${++idSeed}`;

function el(tag, props = {}, ...kids) {
	const e = Object.assign(document.createElement(tag), props);
	e.append(...kids);
	return e;
}

function slider(parent, label, min, max, step, get, set, hint = '') {
	const id = nextId();
	const out = el('output', { htmlFor: id });
	const input = el('input', { type: 'range', min, max, step, id });
	const show = (v) => (out.value = (+v).toFixed(step < 1 ? 2 : 0));
	const sync = () => { input.value = get(); show(get()); };
	input.addEventListener('input', () => { set(+input.value); show(input.value); });
	sync();
	// The explanation lives on the label as a tooltip rather than as prose in the panel.
	parent.append(el('div', { className: 'row' }, el('label', { textContent: label, htmlFor: id, title: hint }), input, out));
	return sync;
}

function check(label, get, set, hint = '') {
	const id = nextId();
	const box = el('input', { type: 'checkbox', checked: !!get(), id });
	box.addEventListener('change', () => set(box.checked));
	return el('label', { htmlFor: id, title: hint }, box, ` ${label}`);
}

function heading(text) { panel.append(el('h2', { textContent: text })); }

// ---- the panel ----

function build() {
	// Rebuilding replaces the whole panel, which would otherwise drop keyboard focus.
	const focusId = document.activeElement?.id;
	panel.replaceChildren();
	const o = state.opts;

	const collapse = el('button', { id: 'collapse', type: 'button', title: 'Hide the controls', textContent: '→' });
	collapse.addEventListener('click', () => setCollapsed(true));
	panel.append(el('div', { className: 'panel-head' },
		el('div', { className: 'intro' },
			el('h1', { textContent: 'Dither Field' }),
			el('p', { textContent: 'An animated texture for web page backgrounds. Try a preset, move the sliders, then take the code.' }),
			el('p', {}, el('a', { href: 'https://github.com/gnome00/dither-field', textContent: 'How it works →', rel: 'noopener' }))),
		collapse));


	heading('Presets');
	const grid = el('div', { className: 'presets' });
	for (const p of PRESETS) {
		const swatch = el('span', { className: 'swatch' });
		swatch.style.background = normaliseColour(p.backdrop) || '#fff';
		for (const c of p.colours) {
			const dot = el('i');
			dot.style.background = normaliseColour(c) || 'currentColor';
			swatch.append(dot);
		}
		const button = el('button', { type: 'button', title: p.note, className: `preset${state.preset === p.id ? ' active' : ''}` },
			swatch, el('span', {}, el('b', { textContent: p.name })));
		button.addEventListener('click', () => applyPreset(p));
		grid.append(button);
	}
	panel.append(grid);

	heading('Preview');
	const prev = el('select', { id: nextId() });
	for (const [value, text] of [['fill', 'Fill window'], ['mobile', '320 × 640'], ['iphone', '393 × 852 (phone)'], ['desktop', '1440 × 900 (scaled)']]) {
		prev.append(el('option', { value, textContent: text }));
	}
	prev.value = state.preview;
	prev.addEventListener('change', () => { state.preview = prev.value; applyPreview(); save(); });
	panel.append(
		el('div', { className: 'buttons' }, el('label', { htmlFor: prev.id, textContent: 'Size' , title: 'Preview at a given screen size' }), prev),
		el('div', { className: 'buttons' },
			check('Backdrop behind', () => state.underlay, (v) => { state.underlay = v; push({}); }, 'Show a page colour behind the texture'),
			check('Static frame (what reduced motion sees)', () => o.paused, (v) => { o.paused = v; push({ paused: v }); }, 'Freeze on a single frame')));

	heading('Motion');
	slider(panel, 'Speed', 0, 4, 0.05, () => o.speed, (v) => push({ speed: (o.speed = v) }), 'How fast the loop plays');
	slider(panel, 'Loop length s', 5, 120, 1, () => o.loopSeconds, (v) => push({ loopSeconds: (o.loopSeconds = v) }), 'Seconds for one full cycle');
	slider(panel, 'Frame rate', 1, 30, 1, () => o.fps, (v) => push({ fps: (o.fps = v) }), 'Redraws per second; 10–15 keeps laptops cool');
	slider(panel, 'Breathe', 0, 1, 0.01, () => o.breathe, (v) => push({ breathe: (o.breathe = v) }), 'Density swelling over the loop');
	const phaseSync = slider(panel, 'Loop position', 0, 1, 0.001, () => bg.getPhase(), (v) => bg.setPhase(v), 'Scrub through the loop');
	setInterval(phaseSync, 500);
	const startSync = slider(panel, 'Start point', 0, 1, 0.01, () => o.startPhase ?? 0, (v) => { o.startPhase = v; push({ startPhase: v }); bg.setPhase(v); }, 'Frame shown when the page loads');
	const useCurrent = el('button', { type: 'button', title: 'Use the current frame as the starting one', textContent: 'Start where the loop is now' });
	useCurrent.addEventListener('click', () => { o.startPhase = Math.round(bg.getPhase() * 100) / 100; push({ startPhase: o.startPhase }); startSync(); });
	panel.append(el('div', { className: 'buttons' }, useCurrent));

	heading('Texture');
	slider(panel, 'Cell size px', 4, 40, 1, () => o.cellSize, (v) => push({ cellSize: (o.cellSize = v) }), 'Smallest grid cell');
	slider(panel, 'Glyph scale', 0.4, 1.6, 0.01, () => o.glyphScale, (v) => push({ glyphScale: (o.glyphScale = v) }), 'Mark size within its cell');
	const resp = () => {
		o.responsive ||= { minWidth: 320, maxWidth: 1440, patternSize: [o.patternSize, o.patternSize], quietSize: [o.quiet.size, o.quiet.size] };
		o.responsive.anchorSize ||= [1.6, 1.6];
		return o.responsive;
	};
	const pushResp = () => push({ responsive: o.responsive });
	slider(panel, 'Pattern @320', 0.2, 4, 0.01, () => resp().patternSize[0], (v) => { resp().patternSize[0] = v; pushResp(); }, 'Blob size on a narrow screen');
	slider(panel, 'Pattern @1440', 0.2, 4, 0.01, () => resp().patternSize[1], (v) => { resp().patternSize[1] = v; pushResp(); }, 'Blob size on a wide screen');
	slider(panel, 'Shift X %', -100, 100, 1, () => o.patternX ?? 0, (v) => push({ patternX: (o.patternX = v) }), 'Slide the texture sideways');
	slider(panel, 'Shift Y %', -100, 100, 1, () => o.patternY ?? 0, (v) => push({ patternY: (o.patternY = v) }), 'Slide the texture up or down');
	slider(panel, 'Contrast', 0.2, 3, 0.01, () => o.contrast, (v) => push({ contrast: (o.contrast = v) }), 'How hard light and dark separate');
	slider(panel, 'Density', -1, 1, 0.01, () => o.density, (v) => push({ density: (o.density = v) }), 'Overall lightness of the field');
	const overlap = el('select', { id: nextId() });
	for (const [value, text] of [['single', 'One mark per cell'], ['stack', 'Stack (marks overlap)']]) {
		overlap.append(el('option', { value, textContent: text }));
	}
	overlap.value = o.overlap;
	overlap.addEventListener('change', () => push({ overlap: (o.overlap = overlap.value) }));
	panel.append(el('div', { className: 'buttons' }, el('label', { htmlFor: overlap.id, textContent: 'Marks' , title: 'Stack layers, or one mark per cell' }), overlap));

	heading('Quiet zone');
	panel.append(el('div', { className: 'buttons' }, check('On', () => o.quiet.enabled !== false, (v) => { o.quiet.enabled = v; push({ quiet: { enabled: v } }); build(); }, 'A lighter area to keep text readable')));
	if (o.quiet.enabled !== false) {
		slider(panel, 'Position X %', 0, 100, 1, () => o.quiet.x, (v) => push({ quiet: { x: (o.quiet.x = v) } }), 'Zone centre, across');
		slider(panel, 'Position Y %', 0, 100, 1, () => o.quiet.y, (v) => push({ quiet: { y: (o.quiet.y = v) } }), 'Zone centre, down');
		slider(panel, 'Size @320', 0, 120, 1, () => resp().quietSize[0], (v) => { resp().quietSize[0] = v; pushResp(); }, 'Zone size on a narrow screen');
		slider(panel, 'Size @1440', 0, 120, 1, () => resp().quietSize[1], (v) => { resp().quietSize[1] = v; pushResp(); }, 'Zone size on a wide screen');
		slider(panel, 'Width ÷ height', 0.3, 4, 0.01, () => o.quiet.aspect, (v) => push({ quiet: { aspect: (o.quiet.aspect = v) } }), 'Zone shape: wide or tall');
		slider(panel, 'Softness', 0, 1, 0.01, () => o.quiet.softness, (v) => push({ quiet: { softness: (o.quiet.softness = v) } }), 'How gradually the zone fades out');
		slider(panel, 'Strength', 0, 1, 0.01, () => o.quiet.strength, (v) => push({ quiet: { strength: (o.quiet.strength = v) } }), 'How much texture it clears');
		slider(panel, 'Irregularity', 0, 0.8, 0.01, () => o.quiet.irregularity ?? 0, (v) => push({ quiet: { irregularity: (o.quiet.irregularity = v) } }), 'Lumpiness of the zone edge');
	}

	heading('Colour');
	const backdrop = el('input', { type: 'color', value: normaliseColour(state.backdrop) || '#ecefe5', id: nextId() });
	backdrop.addEventListener('input', () => { state.backdrop = backdrop.value; push({}); });
	panel.append(el('div', { className: 'buttons' },
		check('Backdrop', () => state.backdropOn, (v) => { state.backdropOn = v; push({}); }, 'Fill behind the marks, instead of transparent'),
		el('label', { htmlFor: backdrop.id, textContent: 'colour' , title: 'The colour behind the marks' }), backdrop));

	heading('Layers (1 is the bottom)');
	slider(panel, 'How many', 1, 6, 1, () => o.layerCount, (v) => { o.layerCount = v; push({ layerCount: v }); build(); }, 'Layers of marks drawn');
	for (let i = 0; i < o.layerCount; i++) {
		const layer = o.layers[i];
		const box = el('div', { className: 'layer' });
		const glyph = el('input', { type: 'text', maxLength: 2, value: layer.glyph, id: nextId(), title: 'Character drawn for this layer', 'aria-label': `Layer ${i + 1} character` });
		glyph.addEventListener('input', () => { layer.glyph = glyph.value; push({ layers: o.layers }); });
		const colour = el('input', { type: 'color', value: normaliseColour(state.colours[i + 1]) || '#888888', id: nextId(), title: 'Colour for this layer', 'aria-label': `Layer ${i + 1} colour` });
		colour.addEventListener('input', () => { state.colours[i + 1] = colour.value; push({}); });
		const weight = el('select', { id: nextId(), title: 'Regular or bold marks', 'aria-label': `Layer ${i + 1} weight` });
		for (const [value, text] of [['400', 'Regular'], ['700', 'Bold']]) weight.append(el('option', { value, textContent: text }));
		weight.value = String(layer.fontWeight || o.fontWeight);
		weight.addEventListener('change', () => {
			if (+weight.value === o.fontWeight) delete layer.fontWeight;
			else layer.fontWeight = +weight.value;
			push({ layers: o.layers });
		});
		box.append(el('div', { className: 'layer-head' }, `Layer ${i + 1}`, glyph, colour, weight));
		slider(box, 'Threshold', 0, 1, 0.01, () => layer.threshold, (v) => { layer.threshold = v; push({ layers: o.layers }); }, 'How dense the field must be before this layer appears');
		slider(box, 'Opacity', 0, 1, 0.01, () => layer.opacity, (v) => { layer.opacity = v; push({ layers: o.layers }); }, 'Layer transparency');
		slider(box, 'Time offset', 0, 1, 0.01, () => layer.timeOffset, (v) => { layer.timeOffset = v; push({ layers: o.layers }); }, 'Delay against the other layers');
		panel.append(box);
	}

	heading('Start over');
	const reset = el('button', { type: 'button', title: 'Clear your tuning from this browser', textContent: 'Reset to defaults' });
	reset.addEventListener('click', () => {
		try { localStorage.removeItem(STORE); } catch {}
		location.reload();
	});
	panel.append(el('div', { className: 'buttons' }, reset));

	const getCode = el('button', { type: 'button', title: 'Copy a snippet or download a demo page', textContent: 'Get the code' });
	getCode.addEventListener('click', openExport);
	panel.append(el('div', { className: 'get-code' }, getCode));

	if (focusId) document.getElementById(focusId)?.focus();
	updateExport();
}

// ---- export ----

let engineSource = '';
async function loadEngineSource() {
	if (engineSource) return engineSource;
	try {
		engineSource = await (await fetch(new URL('../dither-field.js', import.meta.url))).text();
	} catch {
		engineSource = '';
	}
	return engineSource;
}

function currentExport() {
	const options = exportOptions(state.opts);
	const colours = Array.from({ length: state.opts.layerCount }, (_, i) => state.colours[i + 1]);
	const style = colourStyle({ colours, backdrop: state.backdrop, backdropOn: state.backdropOn }, state.opts.layerCount);
	return { options, colours, style };
}

function updateExport() {
	if (!dialog.open) return;
	const { options, style } = currentExport();
	exportBox.value = buildSnippet({ options, style, mode: state.exportMode, engineSource });
	exportNote.textContent = {
		cdn: 'Loads the engine from a pinned CDN. Nothing to host — but your visitors’ browsers will contact jsDelivr.',
		host: 'Download the engine below and put it next to your page. Nobody else is involved.',
		inline: 'The whole engine is in the snippet. Longer, but it works in embeds where you cannot upload a file.',
	}[state.exportMode];
}

async function openExport() {
	exportModes.replaceChildren();
	for (const [value, label] of [['cdn', 'Use a CDN'], ['host', 'Host the file yourself'], ['inline', 'Paste everything']]) {
		const id = nextId();
		const radio = el('input', { type: 'radio', name: 'export-mode', value, id, checked: state.exportMode === value });
		radio.addEventListener('change', async () => {
			state.exportMode = value;
			save();
			if (value === 'inline') await loadEngineSource();
			updateExport();
		});
		exportModes.append(el('label', { htmlFor: id }, radio, ` ${label}`));
	}
	if (state.exportMode === 'inline') await loadEngineSource();
	dialog.showModal();
	updateExport();
}

document.getElementById('close-dialog').addEventListener('click', () => dialog.close());

document.getElementById('copy-btn').addEventListener('click', async (e) => {
	const button = e.currentTarget;
	try {
		await navigator.clipboard.writeText(exportBox.value);
		button.textContent = 'Copied';
	} catch {
		// Clipboard refused: the textarea is the fallback, so select it and say so.
		exportBox.select();
		button.textContent = 'Press ⌘C';
	}
	setTimeout(() => (button.textContent = 'Copy'), 1500);
});

function download(filename, text, type) {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = el('a', { href: url, download: filename });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

document.getElementById('dl-demo').addEventListener('click', async () => {
	const { options, style } = currentExport();
	await loadEngineSource();
	download('dither-demo.html', buildDemoHtml({ options, style, engineSource, backdrop: state.backdrop }), 'text/html');
});

document.getElementById('dl-settings').addEventListener('click', () => {
	const { options, colours } = currentExport();
	download('dither-settings.json', buildSettingsJson({ options, colours, backdrop: state.backdrop, backdropOn: state.backdropOn }), 'application/json');
});

document.getElementById('dl-engine').addEventListener('click', () => {
	const a = el('a', { href: new URL('../dither-field.js', import.meta.url).pathname, download: 'dither-field.js' });
	document.body.append(a);
	a.click();
	a.remove();
});

// ---- stats ----

setInterval(() => {
	const s = bg.getStats();
	statsEl.textContent = `${s.static ? 'static' : `${s.fps.toFixed(1)} fps`} · ${s.drawMs.toFixed(1)} ms · ${s.cols}×${s.rows} = ${s.cells}/${state.opts.maxCells} cells · cell ${s.cellCss.toFixed(1)}px · ${Math.round(s.width)}px wide`;
}, 500);

// Exposed for the test suite; harmless to a visitor.
window.__tuner = { get state() { return state; }, bg, currentExport, buildSnippet, buildDemoHtml, loadEngineSource, CDN_URL };

build();
setCollapsed(!!state.collapsed);
applyPreview();
