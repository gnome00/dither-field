// Dither Field — an animated dithered character-field background.
// Plain ES module, no dependencies, no build step. github.com/gnome00/dither-field
//
// MIT Licence. Copyright (c) 2026 Graeme Arnison. This notice travels with the file,
// including when it is inlined into exported code.
//
// Quick start:
//   import { createDitherField } from './dither-field.js';
//   createDitherField(document.getElementById('bg'));
// The host element must sit inside a positioned parent. Give the host `z-index: -1` and the
// parent `isolation: isolate`, or give the page's own content `position: relative; z-index: 1`.
// Without one of those, the texture paints over that content.
//
// Colours come only from CSS custom properties on the host element:
//   --dither-layer-1 … --dither-layer-N   one per layer (layer 1 is the bottom, lightest)
//   --dither-backdrop                     optional; leave unset/transparent to show what's underneath
//
// The quiet zone — the lighter area that keeps text legible — can also be placed from CSS,
// so it can follow a layout across breakpoints. Unitless numbers; each overrides the matching
// `quiet` option when set:
//   --dither-quiet-x, --dither-quiet-y    centre, % of width / height
//   --dither-quiet-size                   % of the shorter side
//   --dither-quiet-aspect                 width ÷ height
//
// Extra quiet zones can follow page elements instead: give each one `data-dither-quiet` and set
// `anchorQuiet`. Every match gets its own zone, tracking that element's text at every width.
// Off by default; `--dither-quiet-size: 0` switches the fixed zone off and leaves only those.
//
// Every option, with its range and effect, is documented beside its value in DEFAULTS below.

const TAU = Math.PI * 2;
const MAX_DPR = 2; // sharpness cap for larger screens
const PHONE_MAX_DPR = 3; // small screens get full sharpness…
const PHONE_MAX_PIXELS = 4e6; // …while the canvas stays under this many device pixels
const RESIZE_DEBOUNCE_MS = 150;
const QUIET_STEPS = 72; // points around the quiet-zone edge
const MAX_ANCHOR_ZONES = 8; // a selector like '*' would otherwise build one zone per element

// These two glyphs are drawn as shapes rather than type, so they look the same on every device:
// monospace faces mostly lack them, and each system then borrows them from a different font at a
// different size. Sizes are fractions of the font size, matched to how macOS draws the characters.
const SHAPES = {
	'・': (t, c, fs) => {
		t.beginPath();
		t.arc(c, c, 0.075 * fs, 0, TAU);
		t.fill();
	},
	'∷': (t, c, fs) => {
		const s = 0.1425 * fs; // square side
		const h = (0.57 * fs - s) / 2; // centre-to-square offsets: overall 0.57 × 0.54 of the font size
		const v = (0.54 * fs - s) / 2;
		for (const dx of [-h, h]) for (const dy of [-v, v]) t.fillRect(c + dx - s / 2, c + dy - s / 2, s, s);
	},
};

export const VERSION = '1.0.0';

export const DEFAULTS = {
	layerCount: 2, // layers past this count are spares the tuner can switch on; they are not drawn
	layers: [
		// Bottom to top: light, sparse marks appear first; heavier marks only in the densest areas.
		// ・ and ∷ are drawn as shapes (see SHAPES), so the default look needs no particular font.
		{ glyph: '・', threshold: 0, opacity: 0.65, timeOffset: 0 },
		{ glyph: '∷', threshold: 0.44, opacity: 0.92, timeOffset: 0.11 },
		{ glyph: '+', threshold: 0.68, opacity: 0.5, timeOffset: 0.07, fontWeight: 700 },
		{ glyph: 'x', threshold: 0.73, opacity: 0.18, timeOffset: 0.08 },
	],
	// 'stack': every layer draws where it passes its threshold (glyphs can overlap, like print inks).
	// 'single': each cell shows only the top-most layer that passes (one mark per cell).
	overlap: 'stack',
	cellSize: 9, // CSS px; grows automatically so the grid never exceeds maxCells
	maxCells: 8000,
	glyphScale: 1.6, // glyph size relative to the cell
	// Any monospace family the page already loads. The default glyphs are shape-drawn, so this
	// only matters once you pick your own ASCII glyphs.
	fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
	fontWeight: 400, // a layer's own `fontWeight` overrides this
	patternSize: 0.6, // bigger = larger, softer blobs (overridden by `responsive.patternSize`)
	// Slides the texture across the page, as % of width / height. Quiet zones stay where they are.
	patternX: 0,
	patternY: 0,
	contrast: 1.25,
	density: 0.68, // -1 … 1, shifts the whole field lighter or darker
	breathe: 0, // 0 … 1, how much overall density swells over one loop
	loopSeconds: 60, // length of one seamless cycle at speed 1
	startPhase: 0.2, // 0 … 1, where in the loop playback begins (the tuner's "Start point")
	speed: 1.9,
	fps: 15,
	// irregularity: 0 = clean oval; higher = lumpier edge that shifts with the loop
	// enabled: false switches the fixed zone off, leaving only any anchored zones (see anchorQuiet).
	quiet: { enabled: true, x: 50, y: 50, size: 39, aspect: 1.6, softness: 0.9, strength: 0.8, irregularity: 0.35 },
	// Values that change with the host's width: [at minWidth, at maxWidth].
	// Blended in a straight line between the two widths, held steady beyond them.
	// Set to null to use the plain `patternSize` and `quiet.size` at every width.
	// quietSize is the fixed zone's size; anchorSize is the anchored zones' size (× their text width).
	responsive: { minWidth: 320, maxWidth: 1440, patternSize: [1.15, 0.63], quietSize: [42, 30], anchorSize: [2.5, 2.9] },
	// Extra quiet zones, one per element matching `anchor` (searched next to the background), centred
	// on that element's text. size: zone width as a multiple of that text's width. timeOffset shifts
	// each zone's wobble so they don't move in step. Off by default; set an object like the one below
	// to switch it on, and give each element `data-dither-quiet`:
	//   { anchor: '[data-dither-quiet]', size: 1.6, aspect: 3, softness: 0.85,
	//     strength: 0.78, irregularity: 0.43, timeOffset: 0.37 }
	anchorQuiet: null,
	respectReducedMotion: true,
	paused: false,
};

// 8×8 ordered-dither (Bayer) matrix, values spread evenly across 0…1.
const BAYER = (() => {
	let m = [[0]];
	while (m.length < 8) {
		const s = m.length;
		const next = [];
		for (let y = 0; y < s * 2; y++) {
			next[y] = [];
			for (let x = 0; x < s * 2; x++) {
				const add = y < s ? (x < s ? 0 : 2) : x < s ? 3 : 1;
				next[y][x] = 4 * m[y % s][x % s] + add;
			}
		}
		m = next;
	}
	return Float32Array.from(m.flat(), (v) => (v + 0.5) / 64);
})();

// Every time term is sin/cos of the loop angle (or a whole multiple of it),
// so the field at the end of a loop is identical to the start: no seam.
// Time only wobbles phases back and forth, so nothing drifts in one direction.
function field(x, y, th) {
	const s1 = Math.sin(th);
	const c1 = Math.cos(th);
	const wx = x + 0.55 * Math.sin(0.9 * y + 1.4 * s1);
	const wy = y + 0.55 * Math.cos(0.8 * x + 1.4 * c1);
	const v =
		Math.sin(1.3 * wx + 1.2 * s1) * Math.cos(1.1 * wy + 1.2 * c1) +
		0.7 * Math.sin(0.8 * wx - 0.9 * wy + 1.5 * Math.sin(th + 2.1)) +
		0.5 * Math.cos(0.4 * wx + 1.7 * wy + 1.3 * Math.cos(2 * th + 0.7));
	return v / 2.2; // roughly -1 … 1
}

// How far to move a character, drawn centre/middle, so its visible shape sits in the middle of
// the cell. Measured from the drawn pixels rather than measureText(), whose bounding boxes don't
// match what is drawn for some fonts. Runs only when the glyph tiles are rebuilt, not per frame.
let scratch = null;
function glyphOffset(glyph, font, cellPx) {
	const size = cellPx * 3; // room for a mark larger than its cell
	scratch ||= document.createElement('canvas');
	scratch.width = scratch.height = size;
	const s = scratch.getContext('2d', { willReadFrequently: true });
	if (!s) return [0, 0];
	s.font = font;
	s.textAlign = 'center';
	s.textBaseline = 'middle';
	s.fillStyle = '#000';
	s.fillText(glyph, size / 2, size / 2);
	const px = s.getImageData(0, 0, size, size).data;
	let top = size, bottom = -1, left = size, right = -1;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (px[(y * size + x) * 4 + 3] > 0) {
				if (y < top) top = y;
				if (y > bottom) bottom = y;
				if (x < left) left = x;
				if (x > right) right = x;
			}
		}
	}
	if (bottom < 0) return [0, 0]; // nothing drawn (a space, or a font without the character)
	return [size / 2 - (left + right + 1) / 2, size / 2 - (top + bottom + 1) / 2];
}

function smoothstep(a, b, v) {
	if (a === b) return v < a ? 0 : 1;
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

// A finite number within [min, max], or the fallback. Guards the two options that can wedge
// the grid: maxCells of 0 would make layout()'s loop never finish, and a non-finite cellSize
// or maxCells reaches createImageData(NaN, NaN), which throws.
function clampNumber(value, min, max, fallback) {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function merge(base, patch) {
	const out = { ...base, ...patch };
	out.quiet = { ...base.quiet, ...(patch.quiet || {}) };
	out.layers = (patch.layers || base.layers).map((l) => ({ ...l }));
	const r = 'responsive' in patch ? patch.responsive : base.responsive;
	out.responsive = r ? { ...(base.responsive || {}), ...r } : null;
	const a = 'anchorQuiet' in patch ? patch.anchorQuiet : base.anchorQuiet;
	out.anchorQuiet = a ? { ...(base.anchorQuiet || {}), ...a } : null;
	out.maxCells = Math.round(clampNumber(out.maxCells, 64, 40000, DEFAULTS.maxCells));
	out.cellSize = clampNumber(out.cellSize, 1, 1000, DEFAULTS.cellSize);
	return out;
}

export function createDitherField(host, options = {}) {
	let opts = merge(DEFAULTS, options);

	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	Object.assign(canvas.style, {
		position: 'absolute',
		top: '0',
		left: '0',
		display: 'block',
		pointerEvents: 'none',
	});
	const ctx = canvas.getContext('2d');
	if (!ctx) return null; // no canvas: the CSS background underneath simply stays
	host.appendChild(canvas);

	// Offscreen helpers: a 1-pixel-per-cell mask, scaled up and filled with a glyph pattern.
	const mask = document.createElement('canvas');
	const mctx = mask.getContext('2d');
	const layerCanvas = document.createElement('canvas');
	const lctx = layerCanvas.getContext('2d');

	let W = 0, H = 0, dpr = 1, cellPx = 1, cellCss = 1, cols = 0, rows = 0;
	let quietMask = new Float32Array(0);
	let activeQuiet = opts.quiet; // options merged with any CSS overrides
	const makeZone = () => ({ key: '', dist: new Float32Array(0), angle: new Float32Array(0), radius: new Float32Array(QUIET_STEPS + 1), mask: new Float32Array(0) });
	const mainZone = makeZone();
	let anchorZones = []; // one per element matching anchorQuiet.anchor
	let anchorFound = false;
	let blankMask = new Float32Array(0); // all 1s, used when the fixed zone is off
	let maskData = null;
	let tiles = [];
	let tileKey = '';
	let phase = (((opts.startPhase || 0) % 1) + 1) % 1;
	let timer = 0;
	let lastTick = 0;
	let destroyed = false;
	let resizeTimer = 0;
	const stats = { fps: 0, drawMs: 0 };
	let frames = 0, statsSince = performance.now();

	const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

	function isStatic() {
		return opts.paused || (opts.respectReducedMotion && reducedMotion && reducedMotion.matches);
	}

	function layout() {
		// clientWidth ignores CSS transforms, so a scaled-down preview still gets its true size.
		W = Math.max(1, host.clientWidth);
		H = Math.max(1, host.clientHeight);
		const screenDpr = window.devicePixelRatio || 1;
		const phoneDpr = Math.min(PHONE_MAX_DPR, screenDpr);
		dpr = phoneDpr > MAX_DPR && W * H * phoneDpr * phoneDpr <= PHONE_MAX_PIXELS ? phoneDpr : Math.min(MAX_DPR, screenDpr);

		// On big screens grow the cells instead of adding more of them.
		const minCss = Math.max(opts.cellSize, Math.sqrt((W * H) / opts.maxCells));
		cellPx = Math.max(1, Math.round(minCss * dpr));
		cols = Math.ceil((W * dpr) / cellPx);
		rows = Math.ceil((H * dpr) / cellPx);
		while (cols * rows > opts.maxCells) {
			cellPx++;
			cols = Math.ceil((W * dpr) / cellPx);
			rows = Math.ceil((H * dpr) / cellPx);
		}
		cellCss = cellPx / dpr;

		canvas.width = layerCanvas.width = cols * cellPx;
		canvas.height = layerCanvas.height = rows * cellPx;
		canvas.style.width = `${(cols * cellPx) / dpr}px`;
		canvas.style.height = `${(rows * cellPx) / dpr}px`;
		mask.width = cols;
		mask.height = rows;
		maskData = mctx.createImageData(cols, rows);

		mainZone.key = ''; // grid changed: quiet zones are re-measured on the next draw
		for (const z of anchorZones) z.key = '';
		tileKey = ''; // cell size changed: rebuild glyph tiles
	}

	// Distance and angle of every cell from a zone's centre (px). Only changes on resize or option change.
	function measureZone(z, cx, cy, aspect) {
		const ax = Math.sqrt(Math.max(0.1, aspect));
		const n = cols * rows;
		if (z.dist.length !== n) {
			z.dist = new Float32Array(n);
			z.angle = new Float32Array(n);
			z.mask = new Float32Array(n);
		}
		for (let r = 0; r < rows; r++) {
			const dy = ((r + 0.5) * cellCss - cy) * ax;
			for (let c = 0; c < cols; c++) {
				const dx = ((c + 0.5) * cellCss - cx) / ax;
				const k = r * cols + c;
				z.dist[k] = Math.hypot(dx, dy);
				z.angle[k] = ((Math.atan2(dy, dx) / TAU) + 1) % 1 * QUIET_STEPS;
			}
		}
	}

	// A zone's edge is an oval with gentle lumps that rotate and swell over the loop.
	// Like the field, every time term is periodic in the loop angle, so the shape loops seamlessly too.
	// Writes 1 (untouched) … 1 - strength (fully quiet) per cell into z.mask.
	function shapeZone(z, R, q, th) {
		const soft = Math.min(1, Math.max(0, q.softness));
		const irr = q.irregularity || 0;
		const s1 = Math.sin(th), c1 = Math.cos(th);
		for (let i = 0; i <= QUIET_STEPS; i++) {
			const a = (i / QUIET_STEPS) * TAU;
			const lumps =
				0.3 * Math.cos(a + 1.2 * s1) * (0.6 + 0.4 * c1) +
				0.5 * Math.cos(2 * a + 1.8 + 0.9 * c1) * (0.7 + 0.3 * Math.sin(th + 1)) +
				0.35 * Math.cos(3 * a + 0.6 + 1.4 * Math.sin(th + 2.3)) +
				0.2 * Math.cos(5 * a + 4.1 + 1.1 * Math.cos(2 * th));
			z.radius[i] = Math.max(1, R) * Math.max(0.15, 1 + irr * lumps);
		}
		for (let k = 0; k < z.dist.length; k++) {
			const f = z.angle[k];
			const i = f | 0;
			const rr = z.radius[i] + (z.radius[i + 1] - z.radius[i]) * (f - i);
			const outside = smoothstep(rr * (1 - soft), rr * (1 + soft), z.dist[k]);
			z.mask[k] = 1 - q.strength * (1 - outside);
		}
	}

	// Centre and text width of every anchor element, in the host's own px (undoes any preview scaling).
	function measureAnchors() {
		const a = opts.anchorQuiet;
		if (!a || !a.anchor) return [];
		const scope = host.parentElement || document;
		// An invalid selector throws, and this runs every frame — one typo would otherwise
		// take the whole background down on someone else's page.
		let targets;
		try {
			targets = scope.querySelectorAll(a.anchor);
			if (!targets.length) targets = document.querySelectorAll(a.anchor);
		} catch {
			return [];
		}
		if (targets.length > MAX_ANCHOR_ZONES) targets = [...targets].slice(0, MAX_ANCHOR_ZONES);
		const hr = host.getBoundingClientRect();
		const scale = hr.width / W || 1;
		const boxes = [];
		for (const target of targets) {
			const range = document.createRange();
			range.selectNodeContents(target); // the text itself, not the full-width block around it
			const tr = range.getBoundingClientRect();
			if (!tr.width) continue;
			boxes.push({
				x: (tr.left + tr.width / 2 - hr.left) / scale,
				y: (tr.top + tr.height / 2 - hr.top) / scale,
				w: tr.width / scale,
			});
		}
		return boxes;
	}

	function updateQuiet(th) {
		const q = activeQuiet;
		if (q.enabled === false) {
			if (blankMask.length !== cols * rows) blankMask = new Float32Array(cols * rows).fill(1);
			quietMask = blankMask;
		} else {
			shapeZone(mainZone, (q.size / 100) * Math.min(W, H), q, th);
			quietMask = mainZone.mask;
		}

		const a = opts.anchorQuiet;
		const boxes = a ? measureAnchors() : [];
		anchorFound = boxes.length > 0;
		if (!boxes.length) return;

		while (anchorZones.length < boxes.length) anchorZones.push(makeZone());
		if (anchorZones.length > boxes.length) anchorZones = anchorZones.slice(0, boxes.length);

		const combined = new Float32Array(quietMask.length);
		combined.set(quietMask);
		boxes.forEach((box, i) => {
			const zone = anchorZones[i];
			const key = [Math.round(box.x * 2), Math.round(box.y * 2), a.aspect, cols, rows, cellCss].join('|');
			if (key !== zone.key) {
				zone.key = key;
				measureZone(zone, box.x, box.y, a.aspect);
			}
			// size sets the zone's width; R is the base radius before the aspect stretch.
			const size = atWidth('anchorSize', a.size);
			// Each zone's wobble is offset again per index so they don't move in step.
			shapeZone(zone, (size * box.w) / 2 / Math.sqrt(Math.max(0.1, a.aspect)), a, th + TAU * ((a.timeOffset || 0) * (i + 1)));
			for (let k = 0; k < combined.length; k++) combined[k] *= zone.mask[k];
		});
		quietMask = combined;
	}

	// A width-dependent value from `responsive`, or the fallback if none is set.
	function atWidth(key, fallback) {
		const r = opts.responsive;
		const pair = r && r[key];
		if (!Array.isArray(pair)) return fallback;
		const t = Math.min(1, Math.max(0, (W - r.minWidth) / Math.max(1, r.maxWidth - r.minWidth)));
		return pair[0] + (pair[1] - pair[0]) * t;
	}

	function readStyle() {
		const cs = getComputedStyle(host);
		const n = opts.layerCount;
		const colours = [];
		for (let i = 0; i < n; i++) {
			colours.push(cs.getPropertyValue(`--dither-layer-${i + 1}`).trim() || cs.color);
		}
		const backdrop = cs.getPropertyValue('--dither-backdrop').trim();
		const quiet = { ...opts.quiet, size: atWidth('quietSize', opts.quiet.size) };
		for (const key of ['x', 'y', 'size', 'aspect']) {
			const v = parseFloat(cs.getPropertyValue(`--dither-quiet-${key}`));
			if (Number.isFinite(v)) quiet[key] = v;
		}
		return { colours, backdrop, quiet };
	}

	function buildTiles(colours) {
		const key = [cellPx, opts.glyphScale, opts.fontFamily, opts.fontWeight, colours.join('|'),
			opts.layers.slice(0, opts.layerCount).map((l) => l.glyph + (l.fontWeight || '')).join('')].join('~');
		if (key === tileKey) return;
		tileKey = key;
		tiles = colours.map((colour, i) => {
			const tile = document.createElement('canvas');
			tile.width = tile.height = cellPx;
			const t = tile.getContext('2d');
			t.fillStyle = colour;
			const weight = (opts.layers[i] && opts.layers[i].fontWeight) || opts.fontWeight;
			t.font = `${weight} ${cellPx * opts.glyphScale}px ${opts.fontFamily}`;
			t.textAlign = 'center';
			t.textBaseline = 'middle';
			const glyph = (opts.layers[i] && opts.layers[i].glyph) || '';
			if (SHAPES[glyph]) SHAPES[glyph](t, cellPx / 2, cellPx * opts.glyphScale);
			else {
				// Centre the mark's own shape in the cell. The font's middle line is not the middle
				// of most characters: capitals and digits sit above it, so centring on it pushed
				// O and 0 up until their tops were cut off by the cell edge.
				const [dx, dy] = glyphOffset(glyph, t.font, cellPx);
				t.fillText(glyph, cellPx / 2 + dx, cellPx / 2 + dy);
			}
			return ctx.createPattern(tile, 'repeat');
		});
	}

	function draw() {
		const t0 = performance.now();
		const n = Math.min(opts.layerCount, opts.layers.length);
		const { colours, backdrop, quiet } = readStyle();
		buildTiles(colours);
		const qKey = [quiet.x, quiet.y, quiet.aspect, cols, rows, W, H].join('|');
		if (qKey !== mainZone.key) {
			mainZone.key = qKey;
			measureZone(mainZone, (quiet.x / 100) * W, (quiet.y / 100) * H, quiet.aspect);
		}
		activeQuiet = quiet; // size, softness, strength and irregularity don't need re-measuring

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (backdrop && backdrop !== 'transparent') {
			ctx.fillStyle = backdrop;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}

		updateQuiet(TAU * phase);
		const unit = 4 / (Math.min(W, H) * Math.max(0.05, atWidth('patternSize', opts.patternSize)));
		const offX = ((opts.patternX || 0) / 100) * W;
		const offY = ((opts.patternY || 0) / 100) * H;
		const count = cols * rows;

		// Which layer (if any) fills each cell. In 'stack' mode, a bit per layer.
		const hits = new Uint8Array(count);
		for (let i = 0; i < n; i++) {
			const layer = opts.layers[i];
			const th = TAU * (phase + layer.timeOffset);
			const swell = 1 + opts.breathe * 0.35 * Math.cos(th);
			const span = Math.max(0.001, 1 - layer.threshold);
			const ox = (i * 3) % 8, oy = (i * 5) % 8; // shift each layer's dither so marks interleave
			for (let r = 0; r < rows; r++) {
				const y = ((r + 0.5) * cellCss - offY) * unit;
				const brow = ((r + oy) & 7) * 8;
				for (let c = 0; c < cols; c++) {
					const k = r * cols + c;
					let d = 0.5 + 0.5 * field(((c + 0.5) * cellCss - offX) * unit, y, th) * opts.contrast * swell + opts.density * 0.5;
					d *= quietMask[k];
					const coverage = (d - layer.threshold) / span;
					if (coverage > BAYER[brow + ((c + ox) & 7)]) {
						hits[k] = opts.overlap === 'stack' ? hits[k] | (1 << i) : i + 1;
					}
				}
			}
		}

		lctx.imageSmoothingEnabled = false;
		const px = maskData.data;
		for (let i = 0; i < n; i++) {
			for (let k = 0; k < count; k++) {
				const on = opts.overlap === 'stack' ? hits[k] & (1 << i) : hits[k] === i + 1;
				px[k * 4 + 3] = on ? 255 : 0;
			}
			mctx.putImageData(maskData, 0, 0);
			lctx.globalCompositeOperation = 'copy';
			lctx.drawImage(mask, 0, 0, cols * cellPx, rows * cellPx);
			lctx.globalCompositeOperation = 'source-in';
			lctx.fillStyle = tiles[i];
			lctx.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
			ctx.globalAlpha = Math.min(1, Math.max(0, opts.layers[i].opacity));
			ctx.drawImage(layerCanvas, 0, 0);
		}
		ctx.globalAlpha = 1;

		frames++;
		const now = performance.now();
		stats.drawMs = now - t0;
		if (now - statsSince >= 1000) {
			stats.fps = (frames * 1000) / (now - statsSince);
			frames = 0;
			statsSince = now;
		}
	}

	function tick() {
		timer = 0;
		if (destroyed || isStatic() || document.hidden) return;
		const now = performance.now();
		const dt = Math.min(0.25, (now - lastTick) / 1000); // don't jump after a stall
		lastTick = now;
		phase = (phase + (dt * opts.speed) / Math.max(1, opts.loopSeconds)) % 1;
		requestAnimationFrame(() => {
			if (destroyed) return;
			draw();
			schedule();
		});
	}

	function schedule() {
		if (timer || destroyed || isStatic() || document.hidden) return;
		timer = setTimeout(tick, 1000 / Math.min(60, Math.max(1, opts.fps)));
	}

	function stop() {
		clearTimeout(timer);
		timer = 0;
	}

	function restart() {
		stop();
		lastTick = performance.now();
		draw(); // static modes still get one frame
		schedule();
	}

	function onVisibility() {
		if (document.hidden) return stop();
		layout(); // resize events don't arrive while hidden, so re-measure on return
		restart();
	}

	function onResize() {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			layout();
			draw();
		}, RESIZE_DEBOUNCE_MS);
	}

	const ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
	if (ro) ro.observe(host);
	else window.addEventListener('resize', onResize);
	document.addEventListener('visibilitychange', onVisibility);
	if (reducedMotion) reducedMotion.addEventListener('change', restart);

	// Redraw once the web font arrives, otherwise the first frames use the fallback face.
	if (document.fonts) {
		const weights = new Set([opts.fontWeight, ...opts.layers.map((l) => l.fontWeight).filter(Boolean)]);
		Promise.all([...weights].map((w) => document.fonts.load(`${w} 16px ${opts.fontFamily}`))).then(() => {
			if (destroyed) return;
			tileKey = '';
			draw();
		}, () => {});
	}

	layout();
	restart();

	return {
		/** Merge new options and redraw. `layers` replaces the whole array. */
		set(patch) {
			const needsLayout = 'cellSize' in patch || 'maxCells' in patch;
			opts = merge(opts, patch);
			if (needsLayout) layout();
			else if (patch.quiet || patch.anchorQuiet) {
				mainZone.key = '';
				for (const z of anchorZones) z.key = '';
			}
			restart();
		},
		/** Redraw now. Only needed after changing CSS custom properties while static; animation picks them up each frame. */
		refresh() {
			tileKey = '';
			draw();
		},
		/** Jump to a point in the loop (0 … 1). Handy for checking the seam while paused. */
		setPhase(p) {
			phase = ((p % 1) + 1) % 1;
			draw();
		},
		getPhase: () => phase,
		getOptions: () => merge(opts, {}),
		getStats: () => ({ ...stats, cols, rows, cells: cols * rows, cellCss, static: isStatic(),
			width: W, patternSize: atWidth('patternSize', opts.patternSize), quietSize: activeQuiet.size, anchorFound }),
		destroy() {
			destroyed = true;
			stop();
			clearTimeout(resizeTimer);
			if (ro) ro.disconnect();
			else window.removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVisibility);
			if (reducedMotion) reducedMotion.removeEventListener('change', restart);
			canvas.remove();
		},
	};
}
