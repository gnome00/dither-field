// Builds what a visitor takes away: a paste-in snippet, a self-contained demo page,
// and a settings file. Pure functions — the tests call them directly in Node.

import { VERSION } from '../dither-field.js';
import { jsonForScript, normaliseColour, cleanGlyph } from './safe.js';

export const CDN_URL = `https://cdn.jsdelivr.net/gh/gnome00/dither-field@v${VERSION}/dither-field.js`;
const FALLBACK_COLOUR = 'currentColor';

/**
 * The options that should ship, as opposed to the ones the tuner uses on itself.
 * - layers beyond layerCount are the tuner's spares
 * - `paused` is the "Static frame" checkbox; exporting it would freeze the texture
 * - `respectReducedMotion` is forced off in the tuner so motion can be judged; exporting
 *   that would override the visitor's own accessibility setting on someone else's site
 */
export function exportOptions(opts) {
	const out = structuredClone(opts);
	out.layers = (out.layers ?? []).slice(0, out.layerCount).map((layer) => ({
		...layer,
		glyph: cleanGlyph(layer.glyph),
	}));
	delete out.paused;
	delete out.respectReducedMotion;
	// Fill the width-based values rather than shipping a half-built object.
	if (out.responsive) {
		const r = out.responsive;
		if (!Array.isArray(r.patternSize)) r.patternSize = [out.patternSize, out.patternSize];
		if (!Array.isArray(r.quietSize)) r.quietSize = [out.quiet?.size ?? 40, out.quiet?.size ?? 40];
		if (!Array.isArray(r.anchorSize)) r.anchorSize = [1.6, 1.6];
	}
	return out;
}

/** The CSS custom properties that carry the colours, each validated into canonical form. */
export function colourStyle({ colours = [], backdrop, backdropOn } = {}, layerCount = colours.length) {
	const parts = [`--dither-backdrop:${(backdropOn && normaliseColour(backdrop)) || 'transparent'}`];
	for (let i = 0; i < layerCount; i++) {
		parts.push(`--dither-layer-${i + 1}:${normaliseColour(colours[i]) || FALLBACK_COLOUR}`);
	}
	return parts.join('; ');
}

const ENGINE_NOTE = '<!-- Dither Field — github.com/gnome00/dither-field — MIT -->';

/**
 * The paste-in snippet. `mode` picks where the engine comes from:
 *   'cdn'    — a pinned jsDelivr URL; the user's visitors contact that CDN
 *   'host'   — a copy of dither-field.js the user hosts themselves
 *   'inline' — the engine pasted into the page, for embeds that cannot host a file
 *
 * The wrapper and z-index are not decoration: without a positioned parent and a stacking
 * context for the content, the texture paints over the page's own text.
 */
export function buildSnippet({ options, style, mode = 'cdn', engineSource = '' }) {
	const config = jsonForScript(options);
	const script =
		mode === 'inline'
			? `  <script type="module">\n${indent(engineSource)}\n\n    createDitherField(document.getElementById('dither-bg'), ${indent(config, 4).trim()});\n  </script>`
			: `  <script type="module">\n    import { createDitherField } from '${mode === 'cdn' ? CDN_URL : '/dither-field.js'}';\n    createDitherField(document.getElementById('dither-bg'), ${indent(config, 4).trim()});\n  </script>`;

	return `${ENGINE_NOTE}
<div style="position:relative; isolation:isolate; min-height:60vh; overflow:hidden">
  <div id="dither-bg" aria-hidden="true"
       style="position:absolute; inset:0; z-index:-1; pointer-events:none; ${style}"></div>
  <div style="position:relative">
    <!-- your content goes here -->
  </div>
${script}
</div>`;
}

/** A complete page: engine inlined, settings baked in, no network requests at all. */
export function buildDemoHtml({ options, style, engineSource, backdrop = '#ecefe5' }) {
	const page = normaliseColour(backdrop) || '#ffffff';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dither Field</title>
${ENGINE_NOTE}
<style>
  html, body { margin: 0; height: 100%; }
  body { background: ${page}; font-family: system-ui, sans-serif; }
  .stage { position: relative; isolation: isolate; min-height: 100vh; overflow: hidden; }
  .bg { position: absolute; inset: 0; z-index: -1; pointer-events: none; ${style} }
</style>
</head>
<body>
<div class="stage">
  <div class="bg" aria-hidden="true"></div>
</div>
<script type="module">
${indent(engineSource)}

  createDitherField(document.querySelector('.bg'), ${indent(jsonForScript(options), 2).trim()});
</script>
</body>
</html>
`;
}

/** The settings file: versioned, so whatever reads it can tell which engine it was tuned on.
    The tuner itself has no import yet. */
export function buildSettingsJson({ options, colours = [], backdrop, backdropOn }) {
	return JSON.stringify(
		{
			ditherField: 1,
			engine: VERSION,
			options,
			colours: colours.map((c) => normaliseColour(c) || FALLBACK_COLOUR),
			backdrop: normaliseColour(backdrop) || 'transparent',
			backdropOn: !!backdropOn,
		},
		null,
		2
	);
}

function indent(text, spaces = 2) {
	const pad = ' '.repeat(spaces);
	return String(text)
		.split('\n')
		.map((line) => (line ? pad + line : line))
		.join('\n');
}
