/**
 * The same static server the probes use, as a plain ESM module so dev scripts can reuse
 * it. Mirrors Vercel: real files are files, unknown asset extensions 404, extensionless
 * paths fall back to 200.html.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD_DIR = join(ROOT, 'build');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff'
};

export async function startServer() {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		let path = decodeURIComponent(url.pathname);
		if (path.endsWith('/')) path += 'index.html';

		let filePath = join(BUILD_DIR, normalize(path).replace(/^(\.\.[/\\])+/, ''));
		if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
			const htmlPath = `${filePath}.html`;
			if (existsSync(htmlPath)) {
				filePath = htmlPath;
			} else {
				const ext = extname(filePath);
				if (ext && ext !== '.html') {
					res.writeHead(404, { 'Content-Type': 'text/plain' });
					res.end('Not found');
					return;
				}
				filePath = join(BUILD_DIR, '200.html');
			}
		}

		res.writeHead(200, {
			'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		createReadStream(filePath).pipe(res);
	});

	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address();
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise((done) => server.close(() => done()))
	};
}
