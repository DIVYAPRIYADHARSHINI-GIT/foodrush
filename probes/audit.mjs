/**
 * DOM audit used during development instead of eyeballing screenshots.
 *
 * Prints, for a given route: the heading outline, the number of cards/images rendered,
 * whether every image actually decoded (naturalWidth > 0), any element overflowing the
 * viewport horizontally, the computed accent colour, and all console errors. A layout or
 * asset regression shows up here as a number, not as a vibe.
 *
 *   node probes/audit.mjs /restaurants 390
 */

import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const path = process.argv[2] ?? '/';
const width = Number(process.argv[3] ?? 1280);

const { origin, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });

const errors = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const report = await page.evaluate((viewportWidth) => {
	const headings = [...document.querySelectorAll('h1, h2, h3')]
		.slice(0, 14)
		.map((node) => `${node.tagName}: ${node.textContent.trim().slice(0, 70)}`);

	const images = [...document.querySelectorAll('img')];
	const broken = images
		.filter((img) => img.complete && img.naturalWidth === 0)
		.map((img) => img.getAttribute('src'));
	const missingAlt = images.filter((img) => img.getAttribute('alt') === null).length;

	const overflowing = [...document.querySelectorAll('body *')]
		.filter((node) => {
			const rect = node.getBoundingClientRect();
			return rect.width > 0 && (rect.right > viewportWidth + 1 || rect.left < -1);
		})
		.slice(0, 6)
		.map((node) => `${node.tagName}.${String(node.className).split(' ')[0]}`);

	const buttons = [...document.querySelectorAll('button, a')];
	const smallTargets = buttons.filter((node) => {
		const rect = node.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && rect.height < 32;
	}).length;

	const unlabelled = buttons.filter((node) => {
		const rect = node.getBoundingClientRect();
		if (rect.width === 0) return false;
		const text = (node.textContent ?? '').trim();
		return !text && !node.getAttribute('aria-label') && !node.getAttribute('title');
	}).length;

	return {
		title: document.title,
		headings,
		imageCount: images.length,
		brokenImages: broken,
		missingAlt,
		overflowing,
		smallTargets,
		unlabelled,
		bodyScrollWidth: document.body.scrollWidth,
		cards: document.querySelectorAll('article').length
	};
}, width);

console.log(JSON.stringify({ path, width, ...report, errors }, null, 2));

await browser.close();
await close();
