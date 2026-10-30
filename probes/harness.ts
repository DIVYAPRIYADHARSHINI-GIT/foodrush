/**
 * Shared harness for the headless-Chrome probes.
 *
 * Builds the static site once, serves `build/` over a plain Node static server (exactly how
 * it is deployed), and hands out a Playwright page. Console errors and page exceptions are
 * collected so a probe can assert the app ran CLEAN, not just that the DOM looked right.
 *
 * The server deliberately mirrors Vercel: real files are served as files, unknown asset
 * extensions 404 instead of returning HTML, and only extensionless paths fall back to
 * `200.html`. That is what lets the probes prove the restaurant/menu/coupon JSON is a real
 * file and not the SPA fallback.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD_DIR = join(ROOT, 'build');
export const SHOTS_DIR = join(ROOT, 'probes', 'screenshots');

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff'
};

export function buildSite(force = false): void {
	if (force || !existsSync(join(BUILD_DIR, 'index.html'))) {
		execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
	}
}

export async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		let path = decodeURIComponent(url.pathname);
		if (path.endsWith('/')) path += 'index.html';

		let filePath = join(BUILD_DIR, normalize(path).replace(/^(\.\.[/\\])+/, ''));
		if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
			const htmlPath = `${filePath}.html`;
			if (existsSync(htmlPath)) {
				filePath = htmlPath;
			} else {
				// Unknown asset extensions must 404 rather than return HTML, so a missing
				// data file surfaces as a failed fetch instead of silently parsing markup.
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

	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;

	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((done) => server.close(() => done()))
	};
}

export interface Probe {
	page: Page;
	origin: string;
	browser: Browser;
	errors: string[];
	/** Open a page that shares nothing with the first (fresh storage). */
	freshPage: (viewport?: { width: number; height: number }) => Promise<Page>;
	close: () => Promise<void>;
}

export interface ProbeOptions {
	viewport?: { width: number; height: number };
}

export async function openProbe(options: ProbeOptions = {}): Promise<Probe> {
	buildSite();
	mkdirSync(SHOTS_DIR, { recursive: true });
	const { origin, close: closeServer } = await startServer();

	const browser: Browser = await chromium.launch();
	const viewport = options.viewport ?? { width: 1440, height: 900 };
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();

	const errors: string[] = [];
	const watch = (target: Page) => {
		target.on('console', (msg: ConsoleMessage) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});
		target.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	};
	watch(page);

	return {
		page,
		origin,
		browser,
		errors,
		freshPage: async (customViewport) => {
			const fresh = await browser.newContext({ viewport: customViewport ?? viewport });
			const freshPage = await fresh.newPage();
			watch(freshPage);
			return freshPage;
		},
		close: async () => {
			await browser.close();
			await closeServer();
		}
	};
}

/** Navigate and wait for the catalog to be in memory, so no probe races the fetch. */
export async function visit(page: Page, origin: string, path: string): Promise<void> {
	await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
}

export async function shot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: true });
}

/** Read the persisted store straight from localStorage, for autosave assertions. */
export async function readStore(page: Page): Promise<Record<string, unknown> | null> {
	return page.evaluate(() => {
		const raw = localStorage.getItem('foodrush:data:v1');
		return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
	});
}

/** Set a delivery area through the real landing-page UI. */
export async function chooseArea(page: Page, origin: string, area = 'Koramangala'): Promise<void> {
	await visit(page, origin, '/');
	await page.getByRole('button', { name: new RegExp(`^${area}`) }).click();
}
