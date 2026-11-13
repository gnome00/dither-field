// Complete looks to start tuning from. Each sets options, layer colours and a backdrop.
// Glyphs are plain ASCII apart from the two the engine draws as shapes, so every preset
// looks the same on every device.

const L = (glyph, threshold, opacity, timeOffset, extra = {}) => ({ glyph, threshold, opacity, timeOffset, ...extra });

export const PRESETS = [
	{
		// The tuner opens on this one. Tuned 2026-11-13; the engine's own DEFAULTS are left as they are.
		id: 'default',
		name: 'Default',
		note: 'Two soft layers, green into teal.',
		opts: {
			layerCount: 2, overlap: 'stack', cellSize: 10, maxCells: 12000, glyphScale: 1.45, fontWeight: 400,
			layers: [L('・', 0, 0.65, 0), L('∷', 0.44, 0.92, 0.11)],
			patternSize: 0.6, patternX: 0, patternY: 0, contrast: 1.25, density: 0.68,
			breathe: 0.83, loopSeconds: 60, startPhase: 0.2, speed: 3.3, fps: 15,
			quiet: { enabled: true, x: 50, y: 50, size: 39, aspect: 1.6, softness: 0.9, strength: 0.8, irregularity: 0.35 },
			responsive: { minWidth: 320, maxWidth: 1440, patternSize: [0.7, 0.48], quietSize: [42, 30], anchorSize: [2.5, 2.9] },
			anchorQuiet: null,
		},
		colours: ['#80e862', '#2ad1b2', '#00a6da', '#468dff'],
		backdrop: '#ecefe5',
	},
	{
		id: 'riso',
		name: 'Risograph',
		note: 'Fluoro pink and riso blue on warm stock. Offset timing reads like misregistered print.',
		opts: {
			layerCount: 3, overlap: 'stack', cellSize: 10, maxCells: 12000, glyphScale: 1.1, fontWeight: 400, // @ stops fitting its cell above about 1.1
			layers: [L(':', 0, 1, 0, { fontWeight: 700 }), L('o', 0.42, 0.85, 0.5, { fontWeight: 700 }), L('@', 0.6, 0.8, 0.25)],
			patternSize: 1.7, contrast: 1.4, density: 0.2, breathe: 0.2, loopSeconds: 60, speed: 1, fps: 12,
			quiet: { size: 36, aspect: 2, softness: 0.7, irregularity: 0.45 },
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
			layers: [L('.', 0.05, 1, 0), L(':', 0.35, 1, 0.02), L('+', 0.6, 1, 0.04), L('#', 0.8, 1, 0.06)],
			patternSize: 1.2, contrast: 1.7, density: 0, breathe: 0.45, loopSeconds: 30, speed: 1, fps: 12,
			quiet: { size: 34, aspect: 2.4, softness: 0.5, irregularity: 0.2 },
		},
		colours: ['#0e3b22', '#1b7a43', '#39d37a', '#c8ffd9'],
		backdrop: '#050d09',
	},
	{
		id: 'editorial',
		name: 'Editorial',
		note: 'Swiss grid: black ink, one international-orange accent, hard edges.',
		opts: {
			layerCount: 3, overlap: 'single', cellSize: 10, maxCells: 12000, glyphScale: 1, fontWeight: 700,
			layers: [L('-', 0.1, 1, 0), L('+', 0.45, 1, 0), L('#', 0.78, 1, 0)],
			patternSize: 2.2, contrast: 2.4, density: -0.05, breathe: 0.1, loopSeconds: 50, speed: 1, fps: 10,
			quiet: { size: 40, aspect: 2.3, softness: 0.35, irregularity: 0.15 },
		},
		colours: ['#b9b6ad', '#1a1a1a', '#ff4f00'],
		backdrop: '#f1efe9',
	},
	{
		id: 'cyanotype',
		name: 'Cyanotype',
		note: 'Blueprint print. Pale diagonal hatching, like an engraving.',
		opts: {
			layerCount: 3, overlap: 'single', cellSize: 10, maxCells: 12000, glyphScale: 1.1, fontWeight: 400, // / stops fitting its cell above 1.1
			layers: [L('.', 0.1, 0.55, 0), L('/', 0.45, 0.8, 0.05), L('X', 0.75, 1, 0.1)],
			patternSize: 1.5, contrast: 1.35, density: 0.16, breathe: 0.25, loopSeconds: 45, speed: 1, fps: 12,
			quiet: { size: 38, aspect: 2.2, softness: 0.6, irregularity: 0.35 },
		},
		colours: ['#3d62b3', '#9bb8ee', '#f2f6ff'],
		backdrop: '#0f2e73',
	},
	{
		id: 'nocturne',
		name: 'Nocturne',
		note: 'Dark mode aurora: violet into cyan with pink sparks, slow and deep.',
		opts: {
			layerCount: 4, overlap: 'stack', cellSize: 10, maxCells: 12000, glyphScale: 1.3, fontWeight: 400,
			layers: [L('.', 0, 0.7, 0), L('+', 0.3, 0.7, 0.15), L('*', 0.5, 0.85, 0.3), L('x', 0.68, 1, 0.45)],
			patternSize: 2.6, contrast: 1.4, density: 0.22, breathe: 0.3, loopSeconds: 55, speed: 1, fps: 15,
			quiet: { size: 40, aspect: 2.1, softness: 0.85, irregularity: 0.5 },
		},
		colours: ['#2b2170', '#6b4bff', '#22d3ee', '#f5b8ff'],
		backdrop: '#0a0b17',
	},
	{
		id: 'soft',
		name: 'Soft focus',
		note: 'Pastel gradient-mesh feel: big, blurry rings of peach, rose, lilac and sky.',
		opts: {
			// A mark can't be bigger than its cell, and O and 0 stop fitting above about 1.25.
			// 13px × 1.2 keeps the rings close to their original size (10px × 1.6) and whole.
			layerCount: 4, overlap: 'stack', cellSize: 13, maxCells: 12000, glyphScale: 1.2, fontWeight: 400,
			layers: [L('.', 0, 0.8, 0), L('o', 0.32, 0.7, 0.2), L('O', 0.55, 0.65, 0.4), L('0', 0.74, 0.6, 0.6)],
			patternSize: 3.4, contrast: 0.95, density: 0.32, breathe: 0.4, loopSeconds: 50, speed: 1, fps: 15,
			quiet: { size: 42, aspect: 2, softness: 0.95, irregularity: 0.3 },
		},
		colours: ['#ffc9a8', '#ff9fb2', '#b9a7ff', '#86b6ff'],
		backdrop: '#fbf5ef',
	},
];
