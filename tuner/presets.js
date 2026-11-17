// Complete looks to start tuning from. Each sets options, layer colours and a backdrop.
// Glyphs are plain ASCII apart from the two the engine draws as shapes, so every preset
// looks the same on every device. Values were tuned in the tuner and exported 2026-11-17.
// Every preset has the fixed quiet zone switched off: the tuner is a blank page, and a
// site adds its own zone where its text is.

const L = (glyph, threshold, opacity, timeOffset, extra = {}) => ({ glyph, threshold, opacity, timeOffset, ...extra });
const quietOff = (size, aspect, softness, irregularity) =>
	({ enabled: false, x: 50, y: 50, size, aspect, softness, strength: 0.8, irregularity });
const widths = (patternSize, quietSize) =>
	({ minWidth: 320, maxWidth: 1440, patternSize, quietSize, anchorSize: [2.5, 2.9] });

export const PRESETS = [
	{
		// The tuner opens on this one. The engine's own DEFAULTS are left as they are.
		id: 'default',
		name: 'Default',
		note: 'Three soft layers, green into blue.',
		opts: {
			layerCount: 3, overlap: 'stack', cellSize: 11, maxCells: 10000, glyphScale: 1.45, fontWeight: 400,
			layers: [L('・', 0, 0.65, 0), L('∷', 0.31, 0.92, 0.11), L('+', 0.59, 0.41, 0.07)],
			patternSize: 0.6, patternX: 0, patternY: 0, contrast: 1.36, density: 0.35,
			breathe: 0.83, loopSeconds: 60, startPhase: 0.2, speed: 3.35, fps: 15,
			quiet: quietOff(39, 1.6, 0.9, 0.35),
			responsive: widths([0.87, 0.74], [42, 30]),
			anchorQuiet: null,
		},
		colours: ['#80e862', '#2ad1b2', '#00a6da'],
		backdrop: '#ecefe5',
	},
	{
		id: 'riso',
		name: 'Risograph',
		note: 'Fluoro pink and riso blue on warm stock. Offset timing reads like misregistered print.',
		opts: {
			layerCount: 3, overlap: 'stack', cellSize: 11, maxCells: 10000, glyphScale: 1.6, fontWeight: 400,
			layers: [L(':', 0, 0.65, 0, { fontWeight: 700 }), L('o', 0.17, 0.52, 0.04, { fontWeight: 700 }), L('@', 0.52, 0.5, 0.05)],
			patternSize: 1.7, patternX: 1, patternY: 30, contrast: 2.18, density: -0.04,
			breathe: 0.2, loopSeconds: 60, startPhase: 0.79, speed: 2, fps: 12,
			quiet: quietOff(36, 2, 0.7, 0.45),
			responsive: widths([1.18, 0.74], [36, 36]),
			anchorQuiet: null,
		},
		colours: ['#0078bf', '#ff48b0', '#ff6c2f'],
		backdrop: '#f3ede2',
	},
	{
		id: 'phosphor',
		name: 'Phosphor',
		note: 'Green CRT terminal. One mark per cell, bold, crisp and breathing.',
		opts: {
			layerCount: 4, overlap: 'single', cellSize: 10, maxCells: 12000, glyphScale: 1, fontWeight: 700,
			layers: [L('.', 0.05, 1, 0), L(':', 0.35, 1, 0.02), L('+', 0.6, 1, 0.04), L('#', 0.89, 0.97, 0.06)],
			patternSize: 1.2, patternX: 33, patternY: 34, contrast: 1.2, density: 0,
			breathe: 0.45, loopSeconds: 30, startPhase: 0.78, speed: 2.05, fps: 12,
			quiet: quietOff(34, 2.4, 0.5, 0.2),
			responsive: widths([1.39, 1.09], [34, 34]),
			anchorQuiet: null,
		},
		colours: ['#0e3b22', '#1b7a43', '#39d37a', '#c8ffd9'],
		backdrop: '#050d09',
	},
	{
		id: 'editorial',
		name: 'Editorial',
		note: 'Swiss grid: black ink, one international-orange accent, hard edges.',
		opts: {
			layerCount: 3, overlap: 'single', cellSize: 12, maxCells: 12000, glyphScale: 1.1, fontWeight: 700,
			layers: [L('-', 0.1, 1, 0), L('+', 0.41, 1, 0, { fontWeight: 400 }), L('#', 0.65, 0.86, 0, { fontWeight: 400 })],
			patternSize: 2.2, patternX: -62, patternY: 13, contrast: 1.46, density: 0.1,
			breathe: 0.1, loopSeconds: 50, startPhase: 0.2, speed: 2, fps: 10,
			quiet: quietOff(40, 2.3, 0.35, 0.15),
			responsive: widths([1.19, 1.02], [40, 40]),
			anchorQuiet: null,
		},
		colours: ['#b9b6ad', '#1a1a1a', '#ff4f00'],
		backdrop: '#f1efe9',
	},
	{
		id: 'cyanotype',
		name: 'Cyanotype',
		note: 'Blueprint print. Pale diagonal hatching, like an engraving.',
		opts: {
			layerCount: 3, overlap: 'single', cellSize: 10, maxCells: 10000, glyphScale: 1.1, fontWeight: 400,
			layers: [L('.', 0.1, 0.55, 0), L('/', 0.45, 0.7, 0.05), L('X', 0.75, 0.91, 0.1)],
			patternSize: 1.5, patternX: -27, patternY: -4, contrast: 1.14, density: 0.23,
			breathe: 0.25, loopSeconds: 45, startPhase: 0.2, speed: 1.65, fps: 12,
			quiet: quietOff(38, 2.2, 0.6, 0.35),
			responsive: widths([2, 2.07], [38, 38]),
			anchorQuiet: null,
		},
		colours: ['#3d62b3', '#9bb8ee', '#f2f6ff'],
		backdrop: '#0f2e73',
	},
	{
		id: 'nocturne',
		name: 'Nocturne',
		note: 'Dark mode aurora: violet into cyan with pink sparks, slow and deep.',
		opts: {
			layerCount: 4, overlap: 'stack', cellSize: 10, maxCells: 12000, glyphScale: 1.6, fontWeight: 400,
			layers: [L('.', 0, 0.72, 0.24), L('+', 0.3, 0.62, 0.13), L('*', 0.5, 0.68, 0.06), L('x', 0.85, 0.74, 0)],
			patternSize: 2.6, patternX: 0, patternY: 0, contrast: 0.99, density: -0.03,
			breathe: 0.3, loopSeconds: 55, startPhase: 0.2, speed: 2.05, fps: 15,
			quiet: quietOff(40, 2.1, 0.85, 0.5),
			responsive: widths([1.44, 1.33], [40, 40]),
			anchorQuiet: null,
		},
		colours: ['#2b2170', '#6b4bff', '#22d3ee', '#da91e7'],
		backdrop: '#0a0b17',
	},
	{
		id: 'soft',
		name: 'Soft focus',
		note: 'Pastel gradient-mesh feel: big, blurry rings of peach, rose, lilac and sky.',
		opts: {
			layerCount: 4, overlap: 'stack', cellSize: 12, maxCells: 9000, glyphScale: 1.2, fontWeight: 400,
			layers: [L('.', 0, 0.8, 0), L('o', 0.32, 0.7, 0.1), L('O', 0.55, 0.65, 0.27), L('0', 0.74, 0.6, 0.48)],
			patternSize: 3.4, patternX: 14, patternY: 100, contrast: 1.27, density: 0.21,
			breathe: 0.78, loopSeconds: 50, startPhase: 0.2, speed: 1.25, fps: 15,
			quiet: quietOff(42, 2, 0.95, 0.3),
			responsive: widths([0.97, 1.38], [42, 42]),
			anchorQuiet: null,
		},
		colours: ['#ffc9a8', '#ff9fb2', '#b9a7ff', '#86b6ff'],
		backdrop: '#fbf5ef',
	},
];
