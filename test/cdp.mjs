// Minimal Chrome DevTools Protocol driver: launches the installed Google
// Chrome headless and talks to it over Node's built-in WebSocket. No installs.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
	process.env.CHROME ??
	(process.platform === 'darwin'
		? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
		: '/usr/bin/google-chrome');

export async function launch() {
	const profile = mkdtempSync(join(tmpdir(), 'qa-chrome-'));
	const proc = spawn(
		CHROME,
		[
			'--headless=new',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`,
			'--hide-scrollbars',
			// No --force-device-scale-factor here: the tests set the ratio per page, so the
			// phone sharpness path gets exercised.
			'--no-first-run',
			'--no-default-browser-check',
			'--font-render-hinting=none',
			...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
			'about:blank',
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	// A failed start must kill the Chrome it spawned: a Chrome left running keeps Node alive, so
	// the test run never exits and a CI job hangs until GitHub's six-hour limit instead of failing.
	// The error carries Chrome's own last words, so a CI log says why it didn't start.
	let buf = '';
	const wsUrl = await new Promise((resolve, reject) => {
		const fail = (why) => {
			clearTimeout(t);
			proc.kill('SIGKILL');
			rmSync(profile, { recursive: true, force: true });
			reject(new Error(`${why}\n${buf.trim().split('\n').slice(-15).join('\n')}`));
		};
		// Generous: a cold runner can take well over 15 seconds to bring Chrome up.
		const t = setTimeout(() => fail('Chrome did not start within 60s'), 60000);
		proc.stderr.on('data', (d) => {
			buf += d;
			const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		proc.on('error', (e) => fail(`Chrome could not be launched from ${CHROME}: ${e.message}`));
		proc.on('exit', (c) => fail(`Chrome exited (${c})`));
	});
	proc.removeAllListeners('exit');

	const ws = new WebSocket(wsUrl);
	await new Promise((r, j) => {
		ws.onopen = r;
		ws.onerror = j;
	});
	let id = 0;
	const pending = new Map();
	const listeners = new Set();
	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
		} else if (msg.method) {
			for (const l of listeners) l(msg);
		}
	};
	const send = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const mid = ++id;
			pending.set(mid, { resolve, reject });
			ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
		});

	async function newPage() {
		const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
		const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
		const s = (m, p) => send(m, p, sessionId);
		await s('Page.enable');
		await s('Runtime.enable');
		const waitFor = (method, ms = 30000) =>
			new Promise((resolve, reject) => {
				const t = setTimeout(() => {
					listeners.delete(l);
					reject(new Error(`timeout waiting for ${method}`));
				}, ms);
				const l = (msg) => {
					if (msg.sessionId === sessionId && msg.method === method) {
						clearTimeout(t);
						listeners.delete(l);
						resolve(msg.params);
					}
				};
				listeners.add(l);
			});
		const evaluate = async (expression) => {
			const r = await s('Runtime.evaluate', {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
			return r.result.value;
		};
		// Every protocol event for this page, until the returned function is called.
		const listen = (fn) => {
			const l = (msg) => {
				if (msg.sessionId === sessionId) fn(msg);
			};
			listeners.add(l);
			return () => listeners.delete(l);
		};
		return { send: s, waitFor, evaluate, listen, close: () => send('Target.closeTarget', { targetId }) };
	}

	async function close() {
		ws.close();
		proc.kill();
		await new Promise((r) => setTimeout(r, 300));
		rmSync(profile, { recursive: true, force: true });
	}
	return { newPage, close };
}
