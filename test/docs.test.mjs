// Keeps the documentation honest: an option cannot be added or removed without docs/api.md
// moving with it. Cheap, and it is the only thing standing between the docs and rot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS } from '../dither-field.js';

const docs = await readFile(new URL('../docs/api.md', import.meta.url), 'utf8');

// Keys that exist for the tuner rather than for someone using the engine.
const INTERNAL = new Set(['layers']);

function optionNames(object, prefix = '') {
	const names = [];
	for (const [key, value] of Object.entries(object)) {
		names.push(key);
		if (value && typeof value === 'object' && !Array.isArray(value) && !prefix) {
			names.push(...optionNames(value, `${key}.`));
		}
	}
	return names;
}

test('every option is documented', () => {
	const missing = optionNames(DEFAULTS)
		.filter((name) => !INTERNAL.has(name))
		.filter((name) => !docs.includes(`\`${name}\``));
	assert.deepEqual(missing, [], `undocumented options: ${missing.join(', ')}`);
});

test('every controller method is documented', () => {
	for (const method of ['set', 'refresh', 'setPhase', 'getPhase', 'getOptions', 'getStats', 'destroy']) {
		assert.ok(docs.includes(`\`${method}(`), `${method} is missing from docs/api.md`);
	}
});

test('the CSS contract is documented', () => {
	for (const prop of ['--dither-layer-1', '--dither-backdrop', '--dither-quiet-x', '--dither-quiet-size', '--dither-quiet-aspect']) {
		assert.ok(docs.includes(prop), `${prop} is missing from docs/api.md`);
	}
});

test('the README quick start matches the engine filename', async () => {
	const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
	assert.ok(readme.includes("from './dither-field.js'"), 'the quick start must import the real file');
});
