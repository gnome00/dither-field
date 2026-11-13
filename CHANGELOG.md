# Changelog

## 1.0.0 — unreleased

Prepared 2026-11-13. The version is tagged when the repository is first published; the
export's CDN link depends on that tag existing.

First public release: the engine, a browser tuner that exports working code, docs and a test suite.

### Before this release

The engine was written in a closed repository between September and November 2026 and is
published here without that history. What it does was settled over those months:

- A dithered character field on a canvas, with layered glyphs standing in for print inks.
- A seamless loop — every time term is periodic, so the animation returns exactly to its start.
- Quiet zones, so text over the texture stays readable: one fixed zone, plus optional zones that
  follow a page element's text at every width.
- Per-layer colour, weight and timing: colour from CSS custom properties, the rest from options.
- Width-based values that blend between a narrow and a wide screen, rather than snapping at a
  breakpoint.
- Performance guards: a capped frame rate, a cell ceiling, pausing while the tab is hidden, a
  single still frame under `prefers-reduced-motion`, and sharper rendering on phone screens.
- The two default marks drawn as shapes rather than type, so the default look is identical on
  every device and needs no font.

### Changed for the public release

- Defaults retuned around a single centred quiet zone, so the texture reads on a blank page.
- The default font stack is the system monospace; no font is bundled or downloaded.
- Element-following quiet zones (`anchorQuiet`, matching whatever selector you give it — the
  convention is `data-dither-quiet` on each element) ship but are off by default. The tuner
  exposes only the single fixed zone in this release.
- Two engine fixes found while writing the tests: `maxCells: 0` could spin forever, and an
  invalid anchor selector threw on every frame.
- The tuner gained an export dialog, a collapsible panel, a phone layout, a tooltip on every
  control, and a content security policy that forbids it loading anything from another origin.
- Typed characters are now centred on their own shape in each cell. They were centred on the
  font's middle line, which sits below most capitals and digits, so marks like `O` and `0` were
  pushed up and lost their tops. A mark still can't be larger than its cell: past a glyph scale
  of about 1.25 for round capitals, edges are cut.
- The tuner was redesigned (2026-11-13): the texture fills the window under a floating,
  resizable panel; the panel takes its colours from the current preset; sections fold away;
  preset buttons show a live preview; sliders, toggles and dropdowns are custom-built; a cell
  limit control shows when large screens enlarge the cells; and reset asks before clearing.
