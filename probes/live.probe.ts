/**
 * Live-site probes: the deployed production URL, exercised anonymously.
 *
 * These are deliberately separate from `e2e.probe.ts`, which builds and serves the site
 * locally. This suite proves the DEPLOYMENT: a fresh browser context with no cookies and no
 * stored state, hitting the public alias over the network, walking the flows the brief asks
 * to be verified by hand, and failing on any browser console error.
 *
 * Target URL comes from FOODRUSH_URL, defaulting to the production alias.
 *
 *   FOODRUSH_URL=https://foodrush-zeta.vercel.app npm run probe:live
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';

const BASE = (process.env.FOODRUSH_URL ?? 'https://foodrush-zeta.vercel.app').replace(/\/$/, '');
const SHOTS = resolve(import.meta.dirname, 'screenshots-live');

let browser: Browser;
const errors: string[] = [];

/** A context with nothing carried over: no cookies, no storage, no service worker. */
async function anonymousPage(viewport = { width: 1440, height: 900 }): Promise<Page> {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	page.on('console', (message: ConsoleMessage) => {
		if (message.type() === 'error') errors.push(`[${page.url()}] ${message.text()}`);
	});
	page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
	return page;
}

async function visit(page: Page, path: string): Promise<void> {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
}

async function shot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** Add the first dish of a restaurant to the cart, handling the customisation dialog. */
async function addFirstDish(page: Page, restaurantId: string): Promise<void> {
	await visit(page, `/restaurant/?id=${restaurantId}`);
	await page.getByRole('button', { name: /^Add .* to cart$/ }).first().click();
	const dialogAdd = page.getByRole('button', { name: /^Add item · ₹/ });
	if (await dialogAdd.isVisible().catch(() => false)) await dialogAdd.click();
}

beforeAll(async () => {
	mkdirSync(SHOTS, { recursive: true });
	browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
	await browser?.close();
});

describe('deployment is public and serves real files', () => {
	it('serves the landing page anonymously, with real markup', async () => {
		const response = await fetch(`${BASE}/`);
		expect(response.status).toBe(200);
		const html = await response.text();
		// Real prerendered content, not a Vercel SSO/login interstitial.
		expect(html).toContain('Hungry? Order in minutes.');
		expect(html).toContain('name="description"');
		expect(html.toLowerCase()).not.toContain('vercel authentication');
	});

	it('serves every catalog data file as a REAL file, not the HTML fallback', async () => {
		for (const file of ['restaurants', 'menus', 'coupons', 'areas', 'categories']) {
			const response = await fetch(`${BASE}/data/${file}.json`);
			expect(response.status, file).toBe(200);
			expect(response.headers.get('content-type'), file).toContain('application/json');
			const text = await response.text();
			expect(text.trimStart().startsWith('<'), `${file} was served as HTML`).toBe(false);
			JSON.parse(text);
		}
	});

	it('serves the invoice fonts as REAL TrueType files', async () => {
		for (const file of ['noto-sans-invoice-regular.ttf', 'noto-sans-invoice-bold.ttf']) {
			const response = await fetch(`${BASE}/fonts/${file}`);
			expect(response.status, file).toBe(200);
			const bytes = Buffer.from(await response.arrayBuffer());
			// sfnt version 0x00010000 - a real font program, not markup.
			expect(bytes.subarray(0, 4), file).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x00]));
		}
		const metrics = await fetch(`${BASE}/fonts/noto-sans-invoice.json`);
		expect(metrics.headers.get('content-type')).toContain('application/json');
		const manifest = (await metrics.json()) as {
			weights: Record<string, { glyphs: Record<string, { gid: number }> }>;
		};
		// U+20B9 present in both weights, and not .notdef.
		for (const weight of ['regular', 'bold']) {
			expect(manifest.weights[weight].glyphs['8377'].gid).toBeGreaterThan(0);
		}
	});

	it('resolves every deep link, and 404s a missing asset', async () => {
		for (const path of [
			'/',
			'/restaurants/',
			'/restaurants/?q=biryani&veg=1',
			'/restaurant/?id=dosa-darbar',
			'/cart/',
			'/checkout/',
			'/orders/',
			'/order/?id=nope',
			'/offers/',
			'/favourites/',
			'/profile/',
			'/owner/'
		]) {
			const response = await fetch(`${BASE}${path}`);
			expect(response.status, path).toBe(200);
		}
		expect((await fetch(`${BASE}/data/does-not-exist.json`)).status).toBe(404);
	});
});

describe('live customer journey', () => {
	it('chooses a location and lands on the listing', async () => {
		const page = await anonymousPage();
		await visit(page, '/');
		await expect
			.poll(async () => await page.getByRole('heading', { level: 1 }).first().textContent())
			.toContain('Hungry? Order in minutes.');

		await page.getByRole('button', { name: /^Koramangala/ }).click();
		await expect.poll(async () => await page.getByText(/Delivering to Koramangala/).count()).toBeGreaterThan(0);
		await shot(page, 'live-landing');
		await page.context().close();
	});

	it('filters the restaurant listing and keeps state in the URL', async () => {
		const page = await anonymousPage();
		await visit(page, '/restaurants/');
		await expect.poll(async () => await page.getByRole('heading', { level: 3 }).count()).toBeGreaterThan(5);

		await page.getByLabel('Search restaurants and dishes').fill('biryani');
		await expect.poll(async () => page.url().includes('q=biryani')).toBe(true);
		const names = await page.getByRole('heading', { level: 3 }).allTextContents();
		expect(names.join(' ').toLowerCase()).toContain('biryani');

		await page.getByLabel('Search restaurants and dishes').fill('');
		await page.getByRole('button', { name: 'Rating 4.0+' }).click();
		await expect.poll(async () => page.url().includes('rating=1')).toBe(true);
		const ratings = await page.locator('.fr-rating').allTextContents();
		for (const rating of ratings) expect(Number.parseFloat(rating)).toBeGreaterThanOrEqual(4);
		await shot(page, 'live-listing');
		await page.context().close();
	});

	it('opens a menu, toggles veg, and customises a dish', async () => {
		const page = await anonymousPage();
		await visit(page, '/restaurant/?id=biryani-bros');
		await expect
			.poll(async () => await page.getByRole('heading', { level: 1 }).textContent())
			.toContain('Biryani Bros.');

		// Veg toggle removes every non-veg mark.
		await page.getByRole('button', { name: /^Veg \d+$/ }).click();
		await expect.poll(async () => await page.getByRole('img', { name: 'Non-vegetarian' }).count()).toBe(0);
		await page.getByRole('button', { name: /^All \d+$/ }).click();

		// Customisation dialog prices add-ons live.
		await visit(page, '/restaurant/?id=napoli-nook');
		await page.getByRole('button', { name: 'Add Margherita Classic to cart' }).click();
		const addButton = page.getByRole('button', { name: /^Add item · ₹/ });
		const basePrice = await addButton.textContent();
		await page.getByRole('radio', { name: /Large 13/ }).check();
		await expect.poll(async () => await addButton.textContent()).not.toBe(basePrice);
		await shot(page, 'live-customise');
		await addButton.click();

		await expect.poll(async () => await page.getByRole('link', { name: /View cart/ }).count()).toBe(1);
		await page.context().close();
	});

	it('applies and removes a coupon, and recalculates the bill', async () => {
		const page = await anonymousPage();
		await addFirstDish(page, 'dosa-darbar');
		await visit(page, '/cart/');

		const readTotal = async () => {
			const text = await page.getByRole('link', { name: /Proceed to checkout/ }).textContent();
			return Number.parseInt((text ?? '').replace(/[^\d]/g, ''), 10);
		};
		const before = await readTotal();

		// A coupon below its minimum is rejected with a readable reason.
		await page.getByLabel('Coupon code').fill('SAVE20');
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await page.getByText(/minimum ₹299/).count()).toBe(1);

		// A valid one applies and reduces the total.
		await page.getByLabel('Coupon code').fill('OFF20');
		await page.getByRole('button', { name: 'Apply' }).click();
		const couponBox = page.getByRole('region', { name: 'Coupons & offers' });
		await expect.poll(async () => await couponBox.getByText('OFF20 applied').count()).toBe(1);
		await expect.poll(readTotal).toBeLessThan(before);

		// Removing it restores the original total.
		await page.getByRole('button', { name: 'Remove coupon OFF20' }).click();
		await expect.poll(async () => await couponBox.getByText('OFF20 applied').count()).toBe(0);
		await expect.poll(readTotal).toBe(before);

		// Quantity changes recalculate instantly.
		await page.getByRole('button', { name: /Increase .* quantity/ }).first().click();
		await expect.poll(readTotal).toBeGreaterThan(before);
		await shot(page, 'live-cart');
		await page.context().close();
	});

	it('checks out, places an order, and tracks it to delivered', async () => {
		const page = await anonymousPage();
		await addFirstDish(page, 'dosa-darbar');
		await visit(page, '/checkout/');

		await page.getByRole('button', { name: 'Add delivery address' }).click();
		await page.getByLabel("Receiver's name").fill('Divya');
		// Validation rejects a bad number before it will save.
		await page.getByLabel('Mobile number').fill('12345');
		await page.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await page.getByLabel('Area / locality').fill('Jayanagar');
		await page.getByLabel('Pin code').fill('560041');
		await page.getByRole('button', { name: 'Save address' }).click();
		await expect.poll(async () => await page.getByText(/valid 10-digit Indian mobile/).count()).toBe(1);

		await page.getByLabel('Mobile number').fill('9845012345');
		await page.getByRole('button', { name: 'Save address' }).click();
		await page.getByLabel('UPI ID').fill('divya@okbank');
		await shot(page, 'live-checkout');

		await page.getByRole('button', { name: /^Place order · ₹/ }).click();
		await page.waitForURL('**/order/**');
		await expect
			.poll(async () => await page.getByRole('heading', { level: 1 }).textContent())
			.toContain('Order placed');

		// A refresh mid-delivery must RESUME, not restart.
		await expect
			.poll(async () => await page.getByRole('heading', { level: 1 }).textContent(), { timeout: 30_000 })
			.toContain('Confirmed');
		await page.reload({ waitUntil: 'networkidle' });
		expect(await page.getByRole('heading', { level: 1 }).textContent()).not.toContain('Order placed');

		// Run through to delivered (the demo schedule lands at ~150s).
		await expect
			.poll(async () => await page.getByRole('heading', { level: 1 }).textContent(), { timeout: 210_000 })
			.toContain('Delivered');
		await shot(page, 'live-tracking');

		// Rating prompt appears and submits.
		await expect.poll(async () => await page.getByRole('heading', { name: 'How was your order?' }).count()).toBe(1);
		await page.getByRole('radio', { name: '5 stars' }).first().click();
		await page.getByRole('radio', { name: '4 stars' }).last().click();
		await page.getByRole('button', { name: 'Tasty' }).click();
		await page.getByRole('button', { name: 'Submit rating' }).click();
		await expect.poll(async () => await page.getByText(/Your rating/).count()).toBeGreaterThan(0);
		await page.context().close();
	}, 300_000);

	it('reorders from history and downloads a PDF invoice with a real ₹', async () => {
		const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
		const page = await context.newPage();
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(`[orders] ${message.text()}`);
		});
		page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

		// Place one order so history has content.
		await page.goto(`${BASE}/restaurant/?id=dosa-darbar`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: /^Add .* to cart$/ }).first().click();
		const dialogAdd = page.getByRole('button', { name: /^Add item · ₹/ });
		if (await dialogAdd.isVisible().catch(() => false)) await dialogAdd.click();
		await page.goto(`${BASE}/checkout/`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Add delivery address' }).click();
		await page.getByLabel("Receiver's name").fill('Divya');
		await page.getByLabel('Mobile number').fill('9845012345');
		await page.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await page.getByLabel('Area / locality').fill('Jayanagar');
		await page.getByLabel('Pin code').fill('560041');
		await page.getByRole('button', { name: 'Save address' }).click();
		await page.getByLabel('UPI ID').fill('divya@okbank');
		await page.getByRole('button', { name: /^Place order · ₹/ }).click();
		await page.waitForURL('**/order/**');

		await page.goto(`${BASE}/orders/`, { waitUntil: 'networkidle' });
		await expect.poll(async () => await page.getByRole('heading', { name: 'Dosa Darbar' }).count()).toBe(1);

		// Invoice: the font is fetched from the deployment, so this exercises the real asset.
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Invoice (PDF)' }).click()
		]);
		expect(download.suggestedFilename()).toMatch(/^FoodRush_Invoice_FR-[A-Z0-9]+\.pdf$/);

		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const pdf = Buffer.concat(chunks);
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

		// Decode the text back through the PDF's own embedded CMap: the rupee must survive.
		const { extractText, embeddedFonts } = await import('./pdf-inspect.mjs');
		const text = extractText(pdf);
		expect(text).toContain('\u20b9');
		expect(text).not.toContain('Rs.');
		expect(text).not.toContain('\uFFFD');
		const fonts = embeddedFonts(pdf);
		expect(fonts.length).toBe(2);
		for (const font of fonts) expect(font.isTrueType).toBe(true);

		// Reorder rebuilds the cart.
		await page.getByRole('button', { name: 'Reorder' }).click();
		await page.waitForURL('**/cart/**');
		await expect.poll(async () => await page.getByRole('link', { name: /Proceed to checkout/ }).count()).toBe(1);
		await shot(page, 'live-orders');
		await context.close();
	}, 240_000);

	it('marks a dish out of stock from the owner view', async () => {
		const page = await anonymousPage();
		await visit(page, '/owner/');
		await page.getByLabel('Signed in as').selectOption('dosa-darbar');
		await page.getByLabel('Search this menu').fill('Masala Dosa');
		await page.getByRole('checkbox', { name: 'Masala Dosa availability' }).first().uncheck();

		await visit(page, '/restaurant/?id=dosa-darbar');
		await expect.poll(async () => await page.getByRole('button', { name: 'Add Masala Dosa to cart' }).count()).toBe(0);
		await expect.poll(async () => await page.getByText('Out of stock').count()).toBeGreaterThan(0);
		await shot(page, 'live-owner');
		await page.context().close();
	});

	it('switches to dark mode and keeps it across a reload', async () => {
		const page = await anonymousPage();
		await visit(page, '/');
		const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
		await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
		await expect
			.poll(async () => await page.evaluate(() => document.documentElement.classList.contains('dark')))
			.toBe(!wasDark);

		await page.reload({ waitUntil: 'networkidle' });
		expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!wasDark);
		await shot(page, 'live-dark');
		await page.context().close();
	});

	it('survives a hard refresh on a deep link with filters', async () => {
		const page = await anonymousPage();
		await visit(page, '/restaurants/?q=dosa&veg=1&rating=1');
		await expect.poll(async () => await page.getByRole('heading', { level: 1 }).count()).toBe(1);
		await page.reload({ waitUntil: 'networkidle' });
		// Filters survive the refresh because they live in the URL.
		expect(page.url()).toContain('q=dosa');
		expect(page.url()).toContain('veg=1');
		await expect.poll(async () => await page.getByRole('heading', { level: 1 }).count()).toBe(1);
		await page.context().close();
	});
});

describe('responsive widths on the live site', () => {
	for (const [label, width, height] of [
		['mobile', 390, 844],
		['tablet', 834, 1112],
		['desktop', 1440, 900]
	] as const) {
		it(`renders ${label} with no horizontal overflow`, async () => {
			const page = await anonymousPage({ width, height });
			for (const path of ['/', '/restaurants/', '/restaurant/?id=biryani-bros', '/cart/']) {
				await visit(page, path);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth
				);
				expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
			}
			await visit(page, '/restaurants/');
			await shot(page, `live-${label}`);
			await page.context().close();
		});
	}
});

describe('console cleanliness', () => {
	it('collected zero browser console errors across the live run', () => {
		expect(errors).toEqual([]);
	});
});
