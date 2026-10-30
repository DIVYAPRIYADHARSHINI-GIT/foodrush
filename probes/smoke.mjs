/**
 * Quick visual smoke check used during development.
 *
 * Boots the built site, screenshots the pages passed on the command line at the given
 * width, and prints any browser console error. This is a DEV tool - the real assertions
 * live in e2e.probe.ts / a11y.probe.ts.
 *
 *   node probes/smoke.mjs /            1280
 *   node probes/smoke.mjs /restaurants 390
 */

import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'probes', 'screenshots');

const path = process.argv[2] ?? '/';
const width = Number(process.argv[3] ?? 1280);
const name = process.argv[4] ?? `smoke${path.replace(/\W+/g, '-')}-${width}`;

mkdirSync(OUT, { recursive: true });

const { origin, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });

const errors = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });

console.log(`screenshot: probes/screenshots/${name}.png`);
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'console clean');

await browser.close();
await close();
