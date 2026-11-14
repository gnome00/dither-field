# Backlog

Everything not done yet. Items keep their number for life; finished items are
deleted. Last updated 2026-11-14.

## Later

- **B01 — Glyph scale can't cut marks off.** The tuner's Glyph scale slider can still make a typed mark taller or wider than its cell, which cuts its edges (round capitals like `O` above about 1.25). Either cap the slider per glyph, or have the engine shrink a mark to fit.
- **B02 — The local server always serves fresh files.** `npm run serve` (`test/serve.mjs`) sends no cache headers, so after a change the browser can show old files until a hard reload (⌘⇧R).
