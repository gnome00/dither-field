// The tuner: sliders over a live field, and an export dialog that hands the settings back
// as code. Everything it loads is same-origin; nothing it does leaves the browser.

import { createDitherField, DEFAULTS } from '../dither-field.js';
import { PRESETS } from './presets.js';
import { sanitiseConfig, normaliseColour } from './safe.js';
import { exportOptions, colourStyle, buildSnippet, buildDemoHtml, buildSettingsJson, CDN_URL } from './export.js';

const STORE = 'dither-tuner-v1';
// Saved tuning is only reused while the built-in defaults are the same as when it was saved;
// otherwise a visitor returning after an update would see neither their settings nor the new ones.
// The tuner's starting look is the Default preset, so a change to it counts as a change of defaults too.
const DEFAULTS_KEY = JSON.stringify([DEFAULTS, PRESETS[0]]);
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

// The tuner's starting state: the Default preset, laid over the engine's defaults.
function defaults() {
	const base = engineDefaults();
	const preset = PRESETS.find((p) => p.id === 'default');
	base.opts = presetOptions(preset, base);
	preset.colours.forEach((c, i) => (base.colours[i + 1] = c));
	base.backdrop = preset.backdrop;
	return base;
}

// The engine's own defaults, plus the tuner's spare layers and view settings.
function engineDefaults() {
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
		for (const k of ['preview', 'underlay', 'exportMode', 'collapsed', 'open', 'panelWidth']) if (k in saved) state[k] = saved[k];
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
	// Each layer's plate prints onto the same backdrop the texture does.
	panel.style.setProperty('--plate-paper', (state.backdropOn && normaliseColour(state.backdrop)) || '#fff');
	frame.classList.toggle('underlay', state.underlay);
	themePanel();
}

// ---- the panel, printed in the current inks ----
// The panel takes its paper from the backdrop and its ink from the layer colours, so every preset
// reprints the whole page. Text colours are checked against the paper and fall back to plain ink
// whenever a layer colour would be too faint to read.

// Function declarations and var only: the first applyColours() call runs above this point in the
// file, where a let or const here would not exist yet.
var probe;
function toRgb(colour) {
	probe ||= document.createElement('canvas').getContext('2d');
	if (!probe || !colour) return null;
	probe.fillStyle = '#000';
	probe.fillStyle = colour;
	const v = probe.fillStyle;
	if (v[0] === '#') {
		const n = parseInt(v.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const m = v.match(/[\d.]+/g);
	return m && +m[3] !== 0 ? [+m[0], +m[1], +m[2]] : null; // fully transparent counts as none
}
function luminance([r, g, b]) {
	const ch = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
	return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
// Blends run in OKLab, where equal steps look equal: a fade toward the paper keeps its hue
// instead of going grey or muddy halfway, as it does when mixed in plain RGB.
function toOklab([r, g, b]) {
	const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
	[r, g, b] = [lin(r), lin(g), lin(b)];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
	];
}
function fromOklab([L, a, b]) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
	const gam = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
	return [
		gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
	];
}
function mix(a, b, t) {
	const [p, q] = [toOklab(a), toOklab(b)];
	return fromOklab(p.map((v, i) => v + (q[i] - v) * t));
}
function chroma(c) { const [, a, b] = toOklab(c); return Math.hypot(a, b); }
function css(c) { return `rgb(${c.join(' ')})`; }
// The furthest a colour can fade toward the paper and still keep the contrast it needs, on the
// paper and on every other ground it may sit on (the raised surface of buttons and dialogs).
function fadeToward(ink, paper, ratio, most, grounds = [paper]) {
	for (let t = most; t > 0; t -= 0.05) {
		const c = mix(ink, paper, t);
		if (grounds.every((g) => contrast(c, g) >= ratio)) return c;
	}
	return ink;
}

function themePanel() {
	const paper = (state.backdropOn && toRgb(normaliseColour(state.backdrop))) || [244, 245, 239];
	const dark = luminance(paper) < 0.18;
	const plain = dark ? [240, 242, 236] : [24, 30, 26];
	const inks = Array.from({ length: state.opts.layerCount }, (_, i) => toRgb(normaliseColour(state.colours[i + 1]))).filter(Boolean);
	const strongest = [...inks].sort((a, b) => contrast(b, paper) - contrast(a, paper))[0];
	// Body ink: the strongest layer colour if it reads as text, otherwise plain ink tinted toward it.
	let ink = plain;
	if (strongest && contrast(strongest, paper) >= 7) ink = strongest;
	else if (strongest) {
		for (let t = 0.5; t > 0; t -= 0.05) {
			const c = mix(plain, strongest, t);
			if (contrast(c, paper) >= 7) { ink = c; break; }
		}
	}
	// Accent (focus ring, selection, controls): the most colourful ink that clears 3:1.
	const accent = inks.filter((c) => contrast(c, paper) >= 3).sort((a, b) => chroma(b) - chroma(a))[0] || ink;
	const root = document.documentElement.style;
	const surface = mix(paper, [255, 255, 255], dark ? 0.07 : 0.6);
	root.setProperty('--paper', css(paper));
	root.setProperty('--surface', css(surface));
	root.setProperty('--stage', css(mix(paper, plain, dark ? 0.3 : 0.1)));
	root.setProperty('--ink', css(ink));
	root.setProperty('--ink-soft', css(fadeToward(ink, paper, 7, 0.3, [paper, surface])));
	root.setProperty('--ink-quiet', css(fadeToward(ink, paper, 4.5, 0.5, [paper, surface])));
	root.setProperty('--accent', css(accent));
	root.colorScheme = dark ? 'dark' : 'light';
}

// Switching presets dissolves the old look into the new one, where the browser supports it.
function switchPreset(preset) {
	if (!document.startViewTransition || document.hidden) return applyPreset(preset);
	// bg.set() redraws on the spot, so the "after" picture already has the new texture in it.
	const transition = document.startViewTransition(() => applyPreset(preset));
	// A skipped transition (tab hidden mid-way, a second click) is harmless: the preset still applies.
	for (const p of [transition.ready, transition.finished, transition.updateCallbackDone]) p?.catch(() => {});
}

function push(patch) {
	applyColours(); // before the redraw, so the frame picks up new colours
	bg.set(patch);
	save();
	updateExport();
}

// A preset's full option set: the engine's defaults with the preset's own values on top.
function presetOptions(preset, base = engineDefaults()) {
	const o = { ...base.opts, ...structuredClone(preset.opts) };
	o.quiet = { ...base.opts.quiet, ...(preset.opts.quiet || {}) };
	if (preset.opts.layers) o.layers = [...structuredClone(preset.opts.layers), ...base.opts.layers.slice(preset.opts.layers.length)];
	// A preset without its own width-based values uses one value at every width.
	o.responsive = preset.opts.responsive || (preset.id === 'default' ? base.opts.responsive
		: { ...base.opts.responsive, patternSize: [o.patternSize, o.patternSize], quietSize: [o.quiet.size, o.quiet.size] });
	return o;
}

function applyPreset(preset) {
	const base = engineDefaults();
	const o = presetOptions(preset);
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

// ---- reset, confirmed first ----

const resetDialog = document.getElementById('reset-dialog');
document.getElementById('reset-cancel').addEventListener('click', () => resetDialog.close());
document.getElementById('reset-confirm').addEventListener('click', () => {
	try { localStorage.removeItem(STORE); } catch {}
	location.reload();
});

// ---- widening the panel ----
// The panel's right edge is a handle: drag it, or focus it and use the arrow keys.

const PANEL_MIN = 300;
const panelMax = () => Math.max(PANEL_MIN, Math.min(640, Math.round(window.innerWidth * 0.6)));
function setPanelWidth(width, persist = true) {
	const w = Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, Number.isFinite(width) ? width : 340)));
	state.panelWidth = w;
	document.documentElement.style.setProperty('--panel-width', `${w}px`);
	handle.setAttribute('aria-valuenow', String(w));
	handle.setAttribute('aria-valuemax', String(panelMax()));
	if (persist) save();
	applyPreview();
}
const handle = document.getElementById('panel-handle');
handle.addEventListener('pointerdown', (e) => {
	e.preventDefault();
	handle.setPointerCapture(e.pointerId);
	document.body.classList.add('resizing');
	const left = document.querySelector('aside').getBoundingClientRect().left;
	const move = (ev) => setPanelWidth(ev.clientX - left, false);
	const up = () => {
		handle.removeEventListener('pointermove', move);
		document.body.classList.remove('resizing');
		save();
	};
	handle.addEventListener('pointermove', move);
	handle.addEventListener('pointerup', up, { once: true });
	handle.addEventListener('pointercancel', up, { once: true });
});
handle.addEventListener('keydown', (e) => {
	const step = e.shiftKey ? 64 : 16;
	if (e.key === 'ArrowRight') setPanelWidth(state.panelWidth + step);
	else if (e.key === 'ArrowLeft') setPanelWidth(state.panelWidth - step);
	else if (e.key === 'Home') setPanelWidth(PANEL_MIN);
	else if (e.key === 'End') setPanelWidth(panelMax());
	else return;
	e.preventDefault();
});
handle.addEventListener('dblclick', () => setPanelWidth(340)); // back to the standard width
window.addEventListener('resize', () => setPanelWidth(state.panelWidth, false));

// ---- collapsing the panel ----

const reopen = document.getElementById('reopen');

function setCollapsed(collapsed) {
	state.collapsed = collapsed;
	document.body.classList.toggle('collapsed', collapsed);
	reopen.hidden = !collapsed;
	save();
	setThumbsRunning(true);
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
	// The texture fills the window behind the floating panel; a sized preview sits in the space
	// beside the panel (--panel-space in tuner.css), so the scale leaves that space out.
	const stage = document.getElementById('stage').getBoundingClientRect();
	const stacked = window.matchMedia('(max-width: 760px)').matches; // phones: panel sits below, not beside
	const panelSpace = state.collapsed || stacked ? 0 : (state.panelWidth ?? 340) + 32;
	const k = Math.min(1, (stage.width - panelSpace - 24) / size[0], (stage.height - 24) / size[1]);
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

// unit is shown with the value, not the label: "Loop length" reads "60 s".
function slider(parent, label, min, max, step, get, set, hint = '', unit = '') {
	const id = nextId();
	const out = el('output', { htmlFor: id });
	const input = el('input', { type: 'range', min, max, step, id });
	const show = (v) => {
		out.value = (+v).toFixed(step < 1 ? 2 : 0) + unit;
		// The fader's filled track runs up to the value.
		input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
	};
	const sync = () => { input.value = get(); show(get()); };
	input.addEventListener('input', () => { set(+input.value); show(input.value); });
	sync();
	// The explanation lives on the label as a tooltip rather than as prose in the panel.
	parent.append(el('div', { className: 'row' }, el('label', { textContent: label, htmlFor: id, title: hint }), input, out));
	return sync;
}

// A labelled control on the same grid as the sliders: label on the left, control beside it.
function field(label, control, hint = '') {
	return el('div', { className: 'row pick' }, el('label', { htmlFor: control.id, textContent: label, title: hint }), control);
}

function check(label, get, set, hint = '') {
	const id = nextId();
	const box = el('input', { type: 'checkbox', checked: !!get(), id });
	box.addEventListener('change', () => set(box.checked));
	return el('label', { htmlFor: id, title: hint }, box, ` ${label}`);
}

// Each section folds away. Presets and Layers start open; whatever you open or close is remembered.
// Returns the section's body, which the controls under that heading go into.
const OPEN_BY_DEFAULT = ['Presets', 'Layers, bottom first'];
function heading(text) {
	state.open ||= Object.fromEntries(OPEN_BY_DEFAULT.map((t) => [t, true]));
	const details = el('details', { className: 'section', open: !!state.open[text] });
	const body = el('div', { className: 'section-body' });
	details.append(el('summary', {}, el('h2', { textContent: text })), body);
	details.addEventListener('toggle', () => {
		state.open[text] = details.open;
		save();
		if (text === 'Presets') setThumbsRunning(details.open);
	});
	panel.append(details);
	return body;
}

// ---- live preset previews ----
// Each preset button runs a tiny copy of the engine in that preset's look, so you choose by
// watching it move. The grid is built once and kept across panel rebuilds, so the previews
// are not restarted every time a slider rebuilds the panel.

let presetGrid = null;
const thumbs = [];

function presetButtons() {
	if (!presetGrid) {
		presetGrid = el('div', { className: 'presets' });
		for (const p of PRESETS) {
			const thumb = el('span', { className: 'thumb', ariaHidden: 'true' });
			thumb.style.setProperty('--dither-backdrop', normaliseColour(p.backdrop) || '#fff');
			p.colours.forEach((c, i) => thumb.style.setProperty(`--dither-layer-${i + 1}`, normaliseColour(c) || 'currentColor'));
			const button = el('button', { type: 'button', title: p.note, className: 'preset' }, thumb, el('b', { textContent: p.name }));
			button.dataset.preset = p.id;
			button.addEventListener('click', () => switchPreset(p));
			presetGrid.append(button);
			thumbs.push({ thumb, preset: p, field: null });
		}
		// Start the engines once the buttons are in the page and can read their own colours.
		setTimeout(() => {
			for (const t of thumbs) {
				const o = presetOptions(t.preset);
				o.quiet = { ...o.quiet, enabled: false };
				o.anchorQuiet = null;
				o.cellSize = Math.max(4, Math.round(o.cellSize * 0.6));
				o.fps = Math.min(o.fps, 10);
				o.respectReducedMotion = true; // unlike the main preview, thumbnails stay still for reduced motion
				o.paused = !thumbsShouldRun();
				t.field = createDitherField(t.thumb, o);
			}
		}, 0);
	}
	for (const b of presetGrid.children) b.classList.toggle('active', b.dataset.preset === state.preset);
	return presetGrid;
}
function thumbsShouldRun() { return !state.collapsed && !!state.open?.Presets; }
function setThumbsRunning(run) {
	for (const t of thumbs) t.field?.set({ paused: !(run && thumbsShouldRun()) });
}

// ---- the panel ----

let phaseSync = () => {};
let drawnNote = null;
setInterval(() => phaseSync(), 500);

function build() {
	// Rebuilding replaces the whole panel, which would otherwise drop keyboard focus.
	const focusId = document.activeElement?.id;
	panel.replaceChildren();
	const o = state.opts;

	const collapse = el('button', { id: 'collapse', type: 'button', title: 'Hide the controls', textContent: 'Hide' });
	collapse.addEventListener('click', () => setCollapsed(true));
	panel.append(el('div', { className: 'panel-head' },
		el('div', { className: 'intro' },
			el('h1', { textContent: 'Dither Field' }),
			el('p', { textContent: 'An animated texture for web page backgrounds. Try a preset, move the sliders, then take the code.' }),
			el('p', {}, el('a', { href: 'https://github.com/gnome00/dither-field', textContent: 'How it works', rel: 'noopener' }))),
		collapse));


	let sec = heading('Presets');
	sec.append(presetButtons());

	sec = heading('Preview');
	const prev = el('select', { id: nextId() });
	for (const [value, text] of [['fill', 'Fill window'], ['mobile', '320 × 640'], ['iphone', '393 × 852 (phone)'], ['desktop', '1440 × 900 (scaled)']]) {
		prev.append(el('option', { value, textContent: text }));
	}
	prev.value = state.preview;
	prev.addEventListener('change', () => { state.preview = prev.value; applyPreview(); save(); });
	sec.append(
		field('Size', prev, 'Preview at a given screen size'),
		el('div', { className: 'buttons' },
			check('Page color behind', () => state.underlay, (v) => { state.underlay = v; push({}); }, 'Show a page color behind the texture'),
			check('Pause', () => o.paused, (v) => { o.paused = v; push({ paused: v }); }, 'Freeze on one frame, as visitors with reduced motion see it')));

	sec = heading('Motion');
	slider(sec, 'Speed', 0, 4, 0.05, () => o.speed, (v) => push({ speed: (o.speed = v) }), 'How fast the loop plays');
	slider(sec, 'Loop length', 5, 120, 1, () => o.loopSeconds, (v) => push({ loopSeconds: (o.loopSeconds = v) }), 'Seconds for one full cycle', ' s');
	slider(sec, 'Frame rate', 1, 30, 1, () => o.fps, (v) => push({ fps: (o.fps = v) }), 'Redraws per second; 10–15 keeps laptops cool');
	slider(sec, 'Breathe', 0, 1, 0.01, () => o.breathe, (v) => push({ breathe: (o.breathe = v) }), 'Density swelling over the loop');
	// One timer for the whole page, pointed at whichever Loop position slider the latest build made.
	phaseSync = slider(sec, 'Loop position', 0, 1, 0.001, () => bg.getPhase(), (v) => bg.setPhase(v), 'Scrub through the loop');
	const startSync = slider(sec, 'Start point', 0, 1, 0.01, () => o.startPhase ?? 0, (v) => { o.startPhase = v; push({ startPhase: v }); bg.setPhase(v); }, 'Frame shown when the page loads');
	const useCurrent = el('button', { type: 'button', title: 'The texture starts on this frame when the page loads', textContent: 'Use this frame as the start' });
	useCurrent.addEventListener('click', () => { o.startPhase = Math.round(bg.getPhase() * 100) / 100; push({ startPhase: o.startPhase }); startSync(); });
	sec.append(el('div', { className: 'buttons' }, useCurrent));

	sec = heading('Texture');
	slider(sec, 'Cell size', 4, 40, 1, () => o.cellSize, (v) => push({ cellSize: (o.cellSize = v) }), 'Smallest grid cell', 'px');
	// Shown only when the cell limit forces cells larger than asked; the stats timer keeps it current.
	drawnNote = el('p', {
		className: 'note drawn',
		hidden: true,
		title: 'Capped by the cell limit. Filling this screen at the size you set would take more cells than the limit allows, so each cell is drawn larger. Raise the cell limit to go smaller; more cells means more work for visitors’ computers.',
	});
	sec.append(drawnNote);
	slider(sec, 'Cell limit', 2000, 40000, 1000, () => o.maxCells, (v) => push({ maxCells: (o.maxCells = v) }), 'Most cells drawn at once. Higher allows smaller cells on big screens, at more work per frame');
	slider(sec, 'Glyph scale', 0.4, 1.6, 0.01, () => o.glyphScale, (v) => push({ glyphScale: (o.glyphScale = v) }), 'Mark size within its cell');
	const resp = () => {
		o.responsive ||= { minWidth: 320, maxWidth: 1440, patternSize: [o.patternSize, o.patternSize], quietSize: [o.quiet.size, o.quiet.size] };
		o.responsive.anchorSize ||= [1.6, 1.6];
		return o.responsive;
	};
	const pushResp = () => push({ responsive: o.responsive });
	slider(sec, 'Pattern size on phones', 0.2, 4, 0.01, () => resp().patternSize[0], (v) => { resp().patternSize[0] = v; pushResp(); }, 'Blob size on a 320px-wide screen');
	slider(sec, 'Pattern size on desktops', 0.2, 4, 0.01, () => resp().patternSize[1], (v) => { resp().patternSize[1] = v; pushResp(); }, 'Blob size on a 1440px-wide screen');
	slider(sec, 'Shift X', -100, 100, 1, () => o.patternX ?? 0, (v) => push({ patternX: (o.patternX = v) }), 'Slide the texture sideways', '%');
	slider(sec, 'Shift Y', -100, 100, 1, () => o.patternY ?? 0, (v) => push({ patternY: (o.patternY = v) }), 'Slide the texture up or down', '%');
	slider(sec, 'Contrast', 0.2, 3, 0.01, () => o.contrast, (v) => push({ contrast: (o.contrast = v) }), 'How hard light and dark separate');
	slider(sec, 'Density', -1, 1, 0.01, () => o.density, (v) => push({ density: (o.density = v) }), 'Overall lightness of the field');
	const overlap = el('select', { id: nextId() });
	for (const [value, text] of [['single', 'One mark per cell'], ['stack', 'Stack (marks overlap)']]) {
		overlap.append(el('option', { value, textContent: text }));
	}
	overlap.value = o.overlap;
	overlap.addEventListener('change', () => push({ overlap: (o.overlap = overlap.value) }));
	sec.append(field('Marks', overlap, 'Stack layers, or one mark per cell'));

	sec = heading('Quiet zone');
	sec.append(el('p', { className: 'note', textContent: 'An area where the animation is reduced, for placing text.' }));
	sec.append(el('div', { className: 'buttons' }, check('On', () => o.quiet.enabled !== false, (v) => { o.quiet.enabled = v; push({ quiet: { enabled: v } }); build(); }, 'A lighter area to keep text readable')));
	if (o.quiet.enabled !== false) {
		slider(sec, 'Position X', 0, 100, 1, () => o.quiet.x, (v) => push({ quiet: { x: (o.quiet.x = v) } }), 'Zone centre, across', '%');
		slider(sec, 'Position Y', 0, 100, 1, () => o.quiet.y, (v) => push({ quiet: { y: (o.quiet.y = v) } }), 'Zone centre, down', '%');
		slider(sec, 'Size on phones', 0, 120, 1, () => resp().quietSize[0], (v) => { resp().quietSize[0] = v; pushResp(); }, 'Zone size on a 320px-wide screen');
		slider(sec, 'Size on desktops', 0, 120, 1, () => resp().quietSize[1], (v) => { resp().quietSize[1] = v; pushResp(); }, 'Zone size on a 1440px-wide screen');
		slider(sec, 'Width ÷ height', 0.3, 4, 0.01, () => o.quiet.aspect, (v) => push({ quiet: { aspect: (o.quiet.aspect = v) } }), 'Zone shape: wide or tall');
		slider(sec, 'Softness', 0, 1, 0.01, () => o.quiet.softness, (v) => push({ quiet: { softness: (o.quiet.softness = v) } }), 'How gradually the zone fades out');
		slider(sec, 'Strength', 0, 1, 0.01, () => o.quiet.strength, (v) => push({ quiet: { strength: (o.quiet.strength = v) } }), 'How much texture it clears');
		slider(sec, 'Irregularity', 0, 0.8, 0.01, () => o.quiet.irregularity ?? 0, (v) => push({ quiet: { irregularity: (o.quiet.irregularity = v) } }), 'Lumpiness of the zone edge');
	}

	sec = heading('Background color');
	const backdrop = el('input', { type: 'color', value: normaliseColour(state.backdrop) || '#ecefe5', id: nextId() });
	backdrop.addEventListener('input', () => { state.backdrop = backdrop.value; push({}); });
	sec.append(
		el('div', { className: 'buttons' },
			check('Background', () => state.backdropOn, (v) => { state.backdropOn = v; push({}); }, 'Fill behind the marks, instead of transparent')),
		field('Color', backdrop, 'The color behind the marks'));

	sec = heading('Layers, bottom first');
	slider(sec, 'How many', 1, 6, 1, () => o.layerCount, (v) => { o.layerCount = v; push({ layerCount: v }); build(); }, 'Layers of marks drawn');
	for (let i = 0; i < o.layerCount; i++) {
		const layer = o.layers[i];
		const box = el('div', { className: 'layer' });
		const glyph = el('input', { type: 'text', maxLength: 2, value: layer.glyph, id: nextId(), title: 'Character drawn for this layer', 'aria-label': `Layer ${i + 1} character` });
		const colour = el('input', { type: 'color', value: normaliseColour(state.colours[i + 1]) || '#888888', id: nextId(), 'aria-label': `Layer ${i + 1} color` });
		// The plate: this layer's mark in its own colour. Clicking it opens the colour picker.
		const mark = el('span', { className: 'plate-mark', textContent: layer.glyph, ariaHidden: 'true' });
		const paintMark = () => {
			mark.textContent = layer.glyph;
			mark.style.color = normaliseColour(state.colours[i + 1]) || 'currentColor';
			box.style.setProperty('--fader', normaliseColour(state.colours[i + 1]) || 'currentColor');
			mark.style.fontWeight = String(layer.fontWeight || o.fontWeight);
		};
		paintMark();
		const plate = el('label', { className: 'plate', htmlFor: colour.id, title: 'Color for this layer' }, mark, colour);
		glyph.addEventListener('input', () => { layer.glyph = glyph.value; paintMark(); push({ layers: o.layers }); });
		colour.addEventListener('input', () => { state.colours[i + 1] = colour.value; paintMark(); push({}); });
		const weight = el('select', { id: nextId(), title: 'Regular or bold marks', 'aria-label': `Layer ${i + 1} weight` });
		for (const [value, text] of [['400', 'Regular'], ['700', 'Bold']]) weight.append(el('option', { value, textContent: text }));
		weight.value = String(layer.fontWeight || o.fontWeight);
		weight.addEventListener('change', () => {
			if (+weight.value === o.fontWeight) delete layer.fontWeight;
			else layer.fontWeight = +weight.value;
			paintMark();
			push({ layers: o.layers });
		});
		box.append(el('div', { className: 'layer-head' }, plate, el('span', { className: 'plate-name', textContent: `Layer ${i + 1}` }), glyph, weight));
		slider(box, 'Threshold', 0, 1, 0.01, () => layer.threshold, (v) => { layer.threshold = v; push({ layers: o.layers }); }, 'How dense the field must be before this layer appears');
		slider(box, 'Opacity', 0, 1, 0.01, () => layer.opacity, (v) => { layer.opacity = v; push({ layers: o.layers }); }, 'Layer transparency');
		slider(box, 'Time offset', 0, 1, 0.01, () => layer.timeOffset, (v) => { layer.timeOffset = v; push({ layers: o.layers }); }, 'Delay against the other layers');
		sec.append(box);
	}

	// The footer holds the two page-wide actions, so neither reads as part of the last section.
	// Reset is the quiet one on the left and asks first; Get the code is the main action on the right.
	const reset = el('button', { type: 'button', className: 'ghost', title: 'Clear your tuning from this browser', textContent: 'Reset to defaults' });
	reset.addEventListener('click', () => resetDialog.showModal());
	const getCode = el('button', { type: 'button', className: 'primary', title: 'Copy a snippet or download a demo page', textContent: 'Get the code' });
	getCode.addEventListener('click', openExport);
	panel.append(el('div', { className: 'get-code' }, reset, getCode));

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
	// All three notes sit in the same spot and only the current one shows, so the note always
	// takes the height of the longest and the dialog doesn't change size between modes.
	if (!exportNote.children.length) {
		for (const [mode, text] of Object.entries(EXPORT_NOTES)) {
			const span = el('span', { textContent: text });
			span.dataset.mode = mode;
			exportNote.append(span);
		}
	}
	for (const s of exportNote.children) {
		const current = s.dataset.mode === state.exportMode;
		s.classList.toggle('current', current);
		s.setAttribute('aria-hidden', String(!current));
	}
}
const EXPORT_NOTES = {
	cdn: 'Loads the engine from a pinned CDN. Nothing to host — but your visitors’ browsers will contact jsDelivr.',
	host: 'Download the engine below and put it next to your page. Nobody else is involved.',
	inline: 'The whole engine is in the snippet. Longer, but it works in embeds where you cannot upload a file.',
};

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
		// A segmented control: the radio stays for keyboard and screen readers; the span is the segment.
		exportModes.append(el('label', { htmlFor: id, className: 'mode' }, radio, el('span', { textContent: label })));
	}
	if (state.exportMode === 'inline') await loadEngineSource();
	dialog.showModal();
	updateExport();
}

document.getElementById('close-dialog').addEventListener('click', () => dialog.close());

// The one delight: on a successful copy, the label scrambles into the texture's own marks and
// settles into "Copied", left to right. Reduced motion gets the word straight away.
function scrambleTo(button, text) {
	button.setAttribute('aria-label', text); // screen readers hear the word, not the scramble
	button.style.minWidth = `${button.offsetWidth}px`; // no width jitter while the marks change
	if (prefersReducedMotion || document.hidden) { button.textContent = text; return; }
	const marks = state.opts.layers.slice(0, state.opts.layerCount).map((l) => [...(l.glyph || '')][0]).filter((g) => g && g.trim());
	if (!marks.length) marks.push('·');
	const start = performance.now();
	const step = (now) => {
		const t = Math.min(1, (now - start) / 360);
		const settled = Math.floor(t * text.length);
		button.textContent = text.slice(0, settled) + [...text.slice(settled)]
			.map((c) => (c === ' ' ? ' ' : marks[Math.floor(Math.random() * marks.length)])).join('');
		if (t < 1) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}

document.getElementById('copy-btn').addEventListener('click', async (e) => {
	const button = e.currentTarget;
	try {
		await navigator.clipboard.writeText(exportBox.value);
		scrambleTo(button, 'Copied');
	} catch {
		// Clipboard refused: the textarea is the fallback, so select it and say so.
		exportBox.select();
		button.textContent = 'Press ⌘C or Ctrl+C';
	}
	setTimeout(() => {
		button.textContent = 'Copy code';
		button.removeAttribute('aria-label');
		button.style.minWidth = '';
	}, 1500);
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
	if (drawnNote) {
		const drawn = +s.cellCss.toFixed(1); // 5.5 stays 5.5; 12.0 reads as 12
		drawnNote.hidden = !(drawn > state.opts.cellSize);
		drawnNote.textContent = `Drawn at ${drawn}px`;
	}
	statsEl.textContent = `${s.static ? 'Still' : `${s.fps.toFixed(1)} fps`}, ${s.drawMs.toFixed(1)} ms a frame, ${s.cells} of ${state.opts.maxCells} cells, ${Math.round(s.width)}px wide`;
}, 500);

// Exposed for the test suite; harmless to a visitor.
window.__tuner = { get state() { return state; }, bg, currentExport, buildSnippet, buildDemoHtml, loadEngineSource, CDN_URL };

build();
setCollapsed(!!state.collapsed);
setPanelWidth(state.panelWidth ?? 340, false);
applyPreview();
