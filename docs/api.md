# API

Everything is one import away:

```js
import { createDitherField, DEFAULTS, VERSION } from './dither-field.js';
```

`DEFAULTS` is the built-in option set; `VERSION` is the engine's version string, worth recording alongside a configuration you save.

## createDitherField(host, options?)

Draws into a canvas it adds to `host`, and returns a controller — or `null` if the browser gives no 2D context, in which case whatever CSS background sits under `host` simply stays. Check the result before calling methods on it.

`host` should be absolutely positioned inside a positioned parent, with `z-index: -1` so page content paints above it. Give the parent `isolation: isolate` to keep that negative layer inside the box — or, instead, give the page's own content `position: relative; z-index: 1`.

### The controller

| Method | What it does |
| --- | --- |
| `set(patch)` | Merges new options and redraws. `layers` replaces the whole array. Changing `cellSize` or `maxCells` re-measures the grid. |
| `refresh()` | Redraws now. Only needed after changing a CSS custom property while the animation is static. |
| `setPhase(p)` | Jumps to a point in the loop, 0 to 1. `setPhase(1)` wraps to 0. |
| `getPhase()` | Where the loop is now. |
| `getOptions()` | A copy of the current options. |
| `getStats()` | `fps`, `drawMs`, `cols`, `rows`, `cells`, `cellCss`, `static`, `width`, `patternSize`, `quietSize`, `anchorFound`. Semi-stable — it exists for the tuner and may gain fields. |
| `destroy()` | Removes the canvas and every listener. Safe to call twice. |

## Options

The authoritative list is `DEFAULTS` at the top of [`dither-field.js`](../dither-field.js), where most values carry their range and effect beside them. `test/docs.test.mjs` fails if an option exists there without being named here, or the reverse.

The values that could otherwise break the grid are clamped: `maxCells` to 64–40000 and `cellSize` to 1–1000 when options are merged, `fps` to 1–60, `loopSeconds` to at least 1.

**Grid and marks:** `cellSize`, `maxCells`, `glyphScale`, `fontFamily`, `fontWeight`, `layers`, `layerCount`, `overlap`.

`overlap` is `'stack'`, where every layer draws wherever it passes its threshold, or `'single'`, where each cell shows only the topmost layer that passes. `・` and `∷` are drawn as shapes rather than type; any other character is drawn in `fontFamily` at `fontWeight`, which the page must already have loaded, and is centred on its own visible shape in the cell. Each mark is drawn inside its own cell, so a `glyphScale` large enough to make a character taller or wider than the cell cuts its edges off — for round capitals like `O` and `0` in the system monospace that is above about 1.25.

Each entry in `layers` has `glyph`, `threshold`, `opacity`, `timeOffset`, and optionally `fontWeight`. Layers past `layerCount` are ignored, so a configuration can carry spares.

**Field:** `patternSize`, `patternX`, `patternY`, `contrast`, `density`, `breathe`.

**Motion:** `loopSeconds`, `speed`, `fps`, `startPhase`, `paused`, `respectReducedMotion`.

`startPhase` sets where playback begins, and which single frame is drawn when the animation is static. It goes static when `paused` is true, or when `respectReducedMotion` is left on and the browser reports `prefers-reduced-motion: reduce`.

**Quiet zone:** `quiet` — `enabled`, `x`, `y`, `size`, `aspect`, `softness`, `strength`, `irregularity`. The quiet zone is the lighter area that keeps text over the texture legible; `enabled: false` removes it, leaving only any anchored zones. `quiet.size` applies only when `responsive` is `null` — otherwise `responsive.quietSize` sets the size.

**Width-based values:** `responsive` — `minWidth`, `maxWidth`, and the pairs `patternSize`, `quietSize`, `anchorSize`, each `[value at minWidth, value at maxWidth]`. Values blend in a straight line between the two widths and hold steady outside them. The width measured is the host element's, not the viewport's. Set `responsive` to `null` to use the plain `patternSize`, `quiet.size` and `anchorQuiet.size` at every width.

**Element-following zones:** `anchorQuiet`, off by default. Set it to an object and every element matching `anchor` gets its own zone, centred on that element's text and tracking it at every width:

```js
createDitherField(el, {
  // `anchor` has no default: without one, no zone is built.
  // `size` here applies only when `responsive` is null; otherwise responsive.anchorSize wins.
  anchorQuiet: { anchor: '[data-dither-quiet]', size: 1.6, aspect: 3,
                 softness: 0.85, strength: 0.78, irregularity: 0.43, timeOffset: 0.37 },
});
```

`size` is a multiple of the text's own width, and `responsive.anchorSize` overrides it. Elements are looked for inside the host's parent first, and in the whole document only if that finds none. Anchored zones combine with the fixed zone rather than replacing it. An invalid selector is ignored rather than throwing, and at most eight zones are built.

## CSS contract

Set these on the host element. They are read every frame, so a media query can change them.

| Property | Effect |
| --- | --- |
| `--dither-layer-1` … `--dither-layer-N` | One colour per layer, bottom first, where N is `layerCount`. A layer with none set falls back to the host's own `color` |
| `--dither-backdrop` | Fills behind the marks; `transparent` shows what is underneath |
| `--dither-quiet-x`, `--dither-quiet-y` | Zone centre, as % of width and height, unitless |
| `--dither-quiet-size` | Zone size, as % of the shorter side; it also overrides `responsive.quietSize`. `0` shrinks the zone to nothing, which is how a page switches it off |
| `--dither-quiet-aspect` | Zone width ÷ height |

A CSS value wins over the matching option, so a layout can move the zone at a breakpoint without touching JavaScript.

## Several instances

Call `createDitherField` once per element. Each keeps its own grid, options and listeners, and `destroy()` affects only that one.
