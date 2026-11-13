// Validation and escaping for everything the tuner generates.
// Pure functions, no DOM, so the tests can run them in plain Node.
//
// The rule throughout: where a value must land in markup, escape it; where a value must land
// in CSS, validate it into a canonical form instead. Escaping CSS is a losing game.

import { DEFAULTS } from '../dither-field.js';

/**
 * JSON for embedding inside an inline <script>. JSON.stringify alone is not enough:
 * a glyph of "</script>" would close the element, and "<!--" opens an HTML comment
 * inside script content. Escaping "<" kills both; the rest is belt and braces.
 */
export function jsonForScript(value) {
	return JSON.stringify(value, null, 2)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

/** Text destined for an HTML attribute. Attributes are always emitted double-quoted. */
export function escapeAttr(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Text destined for HTML body content. */
export function escapeHtml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COLOUR_KEYWORDS = new Set([
	'transparent', 'currentcolor', 'black', 'white', 'red', 'green', 'blue', 'yellow',
	'orange', 'purple', 'pink', 'grey', 'gray', 'cyan', 'magenta', 'brown', 'navy', 'teal',
]);
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^(rgb|rgba|hsl|hsla)\(\s*[0-9a-z%.,\s\/+-]+\)$/i;

/**
 * A colour safe to drop into a CSS custom property, in canonical form, or null.
 * Rejects anything that could end the declaration or fetch a resource:
 * `red; } body { display: none }`, `url(...)`, `var(...)`, comments, newlines.
 */
export function normaliseColour(value) {
	if (typeof value !== 'string') return null;
	const v = value.trim();
	if (!v || v.length > 64) return null;
	if (/[;{}<>\\]/.test(v) || /\/\*/.test(v) || /[\n\r]/.test(v)) return null;
	if (/url\s*\(|var\s*\(|expression\s*\(|image-set\s*\(/i.test(v)) return null;
	if (HEX.test(v)) return v.toLowerCase();
	if (COLOUR_KEYWORDS.has(v.toLowerCase())) return v.toLowerCase();
	if (FUNCTIONAL.test(v)) return v;
	return null;
}

/** A glyph: at most two code points, no control characters, no lone surrogates. */
export function cleanGlyph(value) {
	if (typeof value !== 'string') return '';
	// eslint-disable-next-line no-control-regex
	const stripped = value.replace(/[\u0000-\u001f\u007f]/g, '');
	const wellFormed = typeof stripped.toWellFormed === 'function' ? stripped.toWellFormed() : stripped;
	return [...wellFormed].slice(0, 2).join('');
}

/** A CSS selector conservative enough to be safe, or null. Used from v1.1, when import returns. */
export function isSelector(value) {
	if (typeof value !== 'string') return false;
	const v = value.trim();
	if (!v || v.length > 120) return false;
	return /^[a-z0-9\s.#[\]="'_:()>,^$*|~-]+$/i.test(v);
}

/** A font stack with no way out of the declaration, or null. */
export function isFontStack(value) {
	if (typeof value !== 'string') return false;
	const v = value.trim();
	if (!v || v.length > 200) return false;
	if (/url\s*\(|[;{}<>()]/.test(v)) return false;
	return /^[a-z0-9\s,'"_-]+$/i.test(v);
}

const NUMBER_RANGES = {
	cellSize: [1, 1000],
	maxCells: [64, 40000],
	glyphScale: [0.05, 8],
	patternSize: [0.05, 20],
	patternX: [-500, 500],
	patternY: [-500, 500],
	contrast: [0, 10],
	density: [-1, 1],
	breathe: [0, 1],
	loopSeconds: [1, 3600],
	startPhase: [0, 1],
	speed: [0, 20],
	fps: [1, 60],
	layerCount: [1, 6],
	fontWeight: [1, 1000],
};
const QUIET_RANGES = {
	x: [0, 100], y: [0, 100], size: [0, 400], aspect: [0.05, 20],
	softness: [0, 1], strength: [0, 1], irregularity: [0, 5],
};
const LAYER_RANGES = { threshold: [0, 1], opacity: [0, 1], timeOffset: [0, 1], fontWeight: [1, 1000] };

function num(value, [min, max], fallback) {
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function pair(value, range, fallback) {
	if (!Array.isArray(value) || value.length !== 2) return fallback;
	return [num(value[0], range, fallback[0]), num(value[1], range, fallback[1])];
}

/**
 * Rebuild an options object from a known-key allowlist, clamping every value.
 * Never assigns onto a fresh object from untrusted keys, so a JSON `__proto__`
 * cannot reach Object.prototype. Used on the saved-settings load, and on import from v1.1.
 */
export function sanitiseConfig(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

	for (const [key, range] of Object.entries(NUMBER_RANGES)) {
		if (key in raw) out[key] = num(raw[key], range, DEFAULTS[key]);
	}
	if (raw.overlap === 'stack' || raw.overlap === 'single') out.overlap = raw.overlap;
	if (typeof raw.fontFamily === 'string' && isFontStack(raw.fontFamily)) out.fontFamily = raw.fontFamily;
	if (typeof raw.respectReducedMotion === 'boolean') out.respectReducedMotion = raw.respectReducedMotion;

	if (Array.isArray(raw.layers)) {
		out.layers = raw.layers.slice(0, 6).map((layer, i) => {
			const base = DEFAULTS.layers[i] ?? DEFAULTS.layers[0];
			const clean = { glyph: cleanGlyph(layer?.glyph ?? base.glyph) };
			for (const [key, range] of Object.entries(LAYER_RANGES)) {
				if (layer && key in layer) clean[key] = num(layer[key], range, base[key] ?? 0);
			}
			if (clean.glyph === '') clean.glyph = base.glyph;
			return clean;
		});
		if (out.layers.length === 0) delete out.layers;
	}
	if (out.layers && typeof out.layerCount === 'number') {
		out.layerCount = Math.min(out.layerCount, out.layers.length);
	}

	if (raw.quiet && typeof raw.quiet === 'object' && !Array.isArray(raw.quiet)) {
		const quiet = {};
		if (typeof raw.quiet.enabled === 'boolean') quiet.enabled = raw.quiet.enabled;
		for (const [key, range] of Object.entries(QUIET_RANGES)) {
			if (key in raw.quiet) quiet[key] = num(raw.quiet[key], range, DEFAULTS.quiet[key]);
		}
		out.quiet = quiet;
	}

	if (raw.responsive && typeof raw.responsive === 'object' && !Array.isArray(raw.responsive)) {
		const r = raw.responsive;
		const base = DEFAULTS.responsive;
		out.responsive = {
			minWidth: num(r.minWidth, [1, 10000], base.minWidth),
			maxWidth: num(r.maxWidth, [1, 10000], base.maxWidth),
			patternSize: pair(r.patternSize, NUMBER_RANGES.patternSize, base.patternSize),
			quietSize: pair(r.quietSize, QUIET_RANGES.size, base.quietSize),
			anchorSize: pair(r.anchorSize, [0.05, 20], base.anchorSize),
		};
	}

	if (raw.anchorQuiet && typeof raw.anchorQuiet === 'object' && !Array.isArray(raw.anchorQuiet)) {
		const a = raw.anchorQuiet;
		const anchor = isSelector(a.anchor) ? a.anchor.trim() : '[data-dither-quiet]';
		const zone = { anchor };
		for (const [key, range] of Object.entries({ size: [0.05, 20], ...QUIET_RANGES, timeOffset: [0, 1] })) {
			if (key in a) zone[key] = num(a[key], range, 0);
		}
		out.anchorQuiet = zone;
	}

	return out;
}
