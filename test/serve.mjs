// Tiny static file server for the tests and for `npm run serve`.
// Node's own http module — nothing to install.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.woff2': 'font/woff2',
};

export function serve(port = 0) {
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		let path = decodeURIComponent(url.pathname);
		if (path.endsWith('/')) path += 'index.html';
		// normalize collapses any ../ before it can escape the repo
		const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
		try {
			const body = await readFile(file);
			res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
			res.end(body);
		} catch {
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('not found');
		}
	});
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const { port: actual } = server.address();
			resolve({ origin: `http://127.0.0.1:${actual}`, close: () => new Promise((r) => server.close(r)) });
		});
	});
}

// `node test/serve.mjs` serves the repo on 8765 for hand-testing.
if (import.meta.url === `file://${process.argv[1]}`) {
	const { origin } = await serve(8765);
	console.log(`${origin}/`);
}
