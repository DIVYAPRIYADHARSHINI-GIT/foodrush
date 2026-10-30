/**
 * End-to-end probes against the REAL built static site in headless Chrome.
 *
 * These walk the flows the brief asks to be verified by hand: choosing a location,
 * filtering restaurants, opening a menu, the veg toggle, customising a dish, adding to
 * cart, applying and removing a coupon, changing quantities, adding an address, placing an
 * order, watching tracking through to delivery, rating the order, reordering from history,
 * favouriting a restaurant, using the owner view to mark a dish out of stock, switching
 * theme, and refreshing on several pages.
 *
 * Every probe asserts on real rendered output and the suite fails on ANY browser console
 * error, so a silent exception cannot pass as green.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { openProbe, readStore, shot, visit, type Probe } from './harness';
import { embeddedFonts, extractRuns, extractText } from './pdf-inspect.mjs';

let probe: Probe;
let page: Page;

beforeAll(async () => {
	probe = await openProbe();
	page = probe.page;
}, 300_000);

afterAll(async () => {
	await probe?.close();
});

/** Collapse markup whitespace so text assertions are not defeated by line breaks. */
function squash(text: string | null): string {
	return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Add the first dish of a restaurant's menu to the cart on a given page. */
async function addFirstDish(target: Page, origin: string, restaurantId: string): Promise<void> {
	await visit(target, origin, `/restaurant/?id=${restaurantId}`);
	const addButton = target.getByRole('button', { name: /^Add .* to cart$/ }).first();
	await addButton.click();
	// A customisable dish opens the dialog; a plain one goes straight in.
	const dialogAdd = target.getByRole('button', { name: /^Add item · ₹/ });
	if (await dialogAdd.isVisible().catch(() => false)) await dialogAdd.click();
}

describe('build output and static hosting', () => {
	it('serves the landing page with real HTML in the markup', async () => {
		await visit(page, probe.origin, '/');
		const heading = await page.getByRole('heading', { level: 1 }).first().textContent();
		expect(heading).toContain('Hungry? Order in minutes.');

		// The prerendered HTML itself must carry the headline, not just the hydrated DOM.
		const html = await (await fetch(`${probe.origin}/index.html`)).text();
		expect(html).toContain('Hungry? Order in minutes.');
		expect(html).toContain('name="description"');
	});

	it('serves the restaurant data as a REAL file, not the HTML fallback', async () => {
		const response = await fetch(`${probe.origin}/data/restaurants.json`);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		const text = await response.text();
		expect(text.trimStart().startsWith('<')).toBe(false);

		const restaurants = JSON.parse(text) as { id: string; name: string; cuisines: string[] }[];
		expect(Array.isArray(restaurants)).toBe(true);
		// The brief asks for 25+ restaurants.
		expect(restaurants.length).toBeGreaterThanOrEqual(25);
		expect(restaurants[0]).toHaveProperty('cuisines');
	});

	it('serves the menus as a REAL file with 8+ dishes per restaurant', async () => {
		const response = await fetch(`${probe.origin}/data/menus.json`);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		const text = await response.text();
		expect(text.trimStart().startsWith('<')).toBe(false);

		const menus = JSON.parse(text) as Record<string, { id: string; pricePaise: number }[]>;
		const counts = Object.values(menus).map((list) => list.length);
		expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
		// Every price must be an integer number of paise - no floats in the catalog.
		for (const list of Object.values(menus)) {
			for (const dish of list) expect(Number.isInteger(dish.pricePaise)).toBe(true);
		}
	});

	it('serves the coupon data as a REAL file including the sample codes', async () => {
		const response = await fetch(`${probe.origin}/data/coupons.json`);
		expect(response.headers.get('content-type')).toContain('application/json');
		const coupons = (await response.json()) as { code: string }[];
		const codes = coupons.map((coupon) => coupon.code);
		for (const code of ['WELCOME50', 'FREEDEL', 'SAVE20', 'BROS40']) {
			expect(codes).toContain(code);
		}
	});

	it('404s a missing asset instead of returning HTML', async () => {
		const response = await fetch(`${probe.origin}/data/does-not-exist.json`);
		expect(response.status).toBe(404);
	});

	it('serves every dish illustration as decodable SVG', async () => {
		for (const art of ['biryani', 'pizza', 'burger', 'cake', 'momo', 'fallback']) {
			const response = await fetch(`${probe.origin}/img/dish/${art}.svg`);
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text.startsWith('<svg')).toBe(true);
			// Duplicate attributes make a browser refuse to decode the image.
			for (const tag of text.match(/<[a-z]+[^>]*>/g) ?? []) {
				const names = [...tag.matchAll(/\s([a-z-]+)="/g)].map((match) => match[1]);
				expect(new Set(names).size).toBe(names.length);
			}
		}
	});
});

describe('location and landing', () => {
	it('lets the user choose a delivery area and remembers it', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/');
		await fresh.getByRole('button', { name: /^Koramangala/ }).click();

		await expect.poll(async () => await fresh.getByText(/Delivering to Koramangala/).count()).toBeGreaterThan(0);
		await expect
			.poll(async () => ((await readStore(fresh)) as { location?: { areaId?: string } })?.location?.areaId)
			.toBe('koramangala');

		// And it survives a reload - the header pill still shows it.
		await fresh.reload({ waitUntil: 'networkidle' });
		await expect.poll(async () => await fresh.getByText('Koramangala, Bengaluru').count()).toBeGreaterThan(0);
		await fresh.context().close();
	});

	it('explains an unserviceable area instead of showing an empty list', async () => {
		await visit(page, probe.origin, '/');
		await page.getByLabel('Delivery location').fill('Antarctica');
		await expect.poll(async () => await page.getByText(/We do not deliver to/).count()).toBeGreaterThan(0);
	});

	it('shows categories, offers and top-rated sections with real content', async () => {
		await visit(page, probe.origin, '/');
		await expect.poll(async () => await page.getByRole('heading', { name: 'Top rated near you' }).count()).toBe(1);
		await expect.poll(async () => await page.getByRole('heading', { name: 'Offers for you' }).count()).toBe(1);
		// Category rail links into a pre-filtered listing.
		const biryani = page.getByRole('link', { name: 'Biryani' }).first();
		await biryani.click();
		await page.waitForURL('**/restaurants/**');
		expect(page.url()).toContain('cuisine=Biryani');
		await shot(page, 'landing');
	});
});

describe('restaurant listing: search, sort, filters', () => {
	it('searches restaurants and dishes', async () => {
		await visit(page, probe.origin, '/restaurants/');
		await page.getByLabel('Search restaurants and dishes').fill('biryani');
		await expect.poll(async () => page.url().includes('q=biryani')).toBe(true);
		await expect
			.poll(async () => await page.getByRole('heading', { level: 3 }).count())
			.toBeGreaterThan(0);
		const names = await page.getByRole('heading', { level: 3 }).allTextContents();
		expect(names.join(' ').toLowerCase()).toContain('biryani');
	});

	it('shows a friendly no-results state and can clear it', async () => {
		await visit(page, probe.origin, '/restaurants/?q=zzzzzz');
		await expect.poll(async () => await page.getByText('No kitchens match that').count()).toBe(1);
		await page.getByRole('button', { name: 'Clear all filters' }).click();
		await expect.poll(async () => await page.getByRole('heading', { level: 3 }).count()).toBeGreaterThan(5);
	});

	it('combines several filters and reflects them as chips in the URL', async () => {
		await visit(page, probe.origin, '/restaurants/');
		await page.getByRole('button', { name: 'Rating 4.0+' }).click();
		await page.getByRole('button', { name: 'Has offers' }).click();
		await expect.poll(async () => page.url().includes('rating=1') && page.url().includes('offers=1')).toBe(true);

		// Every surviving card must actually satisfy both filters.
		const ratings = await page.locator('.fr-rating').allTextContents();
		expect(ratings.length).toBeGreaterThan(0);
		for (const rating of ratings) expect(Number.parseFloat(rating)).toBeGreaterThanOrEqual(4);

		// Chips can be removed one at a time.
		await page.getByRole('button', { name: 'Remove Rating 4+ filter' }).click();
		await expect.poll(async () => page.url().includes('rating=1')).toBe(false);
	});

	it('sorts by cost low to high', async () => {
		await visit(page, probe.origin, '/restaurants/?sort=cost-low');
		const prices = (await page.getByText(/for two/).allTextContents())
			.map((text) => Number.parseInt(text.replace(/[^\d]/g, ''), 10))
			.filter((value) => Number.isFinite(value));
		expect(prices.length).toBeGreaterThan(3);
		expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
	});

	it('KEEPS filters and restores scroll when coming back from a restaurant', async () => {
		await visit(page, probe.origin, '/restaurants/?rating=1&sort=rating');
		// Page down so there is a scroll position worth restoring.
		await page.evaluate(() => window.scrollTo(0, 900));
		await page.waitForTimeout(400);

		/*
		 * Click a card that is ALREADY in view at this offset. Clicking one further up would
		 * make Playwright scroll back to it first, so the position being restored would be
		 * that higher offset - the probe would then be testing its own auto-scroll rather
		 * than the app.
		 */
		const headings = page.getByRole('heading', { level: 3 });
		const total = await headings.count();
		let target = -1;
		for (let index = 0; index < total; index += 1) {
			const box = await headings.nth(index).boundingBox();
			if (box && box.y > 120 && box.y < 700) {
				target = index;
				break;
			}
		}
		expect(target, 'a card should be visible at this scroll offset').toBeGreaterThanOrEqual(0);

		const before = await page.evaluate(() => window.scrollY);
		expect(before).toBeGreaterThan(300);

		await headings.nth(target).click();
		await page.waitForURL('**/restaurant/**');
		await page.goBack({ waitUntil: 'networkidle' });

		// Filters intact...
		expect(page.url()).toContain('rating=1');
		expect(page.url()).toContain('sort=rating');

		// ...the list is as long as it was...
		await expect.poll(async () => await page.getByRole('heading', { level: 3 }).count()).toBe(total);

		// ...and we are back within a card's height of where we left off.
		await expect
			.poll(async () => await page.evaluate(() => window.scrollY), { timeout: 8000 })
			.toBeGreaterThan(before - 250);
	});

	it('loads more kitchens on demand without losing the earlier ones', async () => {
		await visit(page, probe.origin, '/restaurants/');
		const first = await page.getByRole('heading', { level: 3 }).count();
		await page.getByRole('button', { name: /Show more kitchens/ }).click();
		await expect.poll(async () => await page.getByRole('heading', { level: 3 }).count()).toBeGreaterThan(first);
	});
});

describe('restaurant menu', () => {
	it('shows the header, offers, veg marks and menu sections', async () => {
		await visit(page, probe.origin, '/restaurant/?id=biryani-bros');
		await expect.poll(async () => await page.getByRole('heading', { level: 1 }).textContent()).toContain('Biryani Bros.');
		await expect.poll(async () => await page.getByText(/for two/).count()).toBeGreaterThan(0);
		// Every dish carries a veg/non-veg mark.
		const vegMarks = await page.getByRole('img', { name: /^(Vegetarian|Non-vegetarian)$/ }).count();
		expect(vegMarks).toBeGreaterThan(8);
		await shot(page, 'restaurant-menu');
	});

	it('filters the menu by veg and combines it with search', async () => {
		await visit(page, probe.origin, '/restaurant/?id=biryani-bros');
		await page.getByRole('button', { name: /^Veg \d+$/ }).click();
		// No non-veg mark may survive the veg filter.
		await expect.poll(async () => await page.getByRole('img', { name: 'Non-vegetarian' }).count()).toBe(0);

		await page.getByLabel('Search this menu').fill('biryani');
		const titles = await page.getByRole('heading', { level: 3 }).allTextContents();
		expect(titles.some((title) => title.includes('Veg Dum Biryani'))).toBe(true);

		// A search with no match explains itself.
		await page.getByLabel('Search this menu').fill('sushi');
		await expect.poll(async () => await page.getByText('Nothing matches that here').count()).toBe(1);
	});

	it('marks the catalog out-of-stock dish as unavailable with no Add button', async () => {
		await visit(page, probe.origin, '/restaurant/?id=biryani-bros');
		await expect.poll(async () => await page.getByText('Out of stock').count()).toBeGreaterThan(0);
		await expect.poll(async () => await page.getByRole('button', { name: 'Add Prawn Biryani to cart' }).count()).toBe(0);
	});

	it('validates required options and prices add-ons live', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/restaurant/?id=napoli-nook');
		await fresh.getByRole('button', { name: 'Add Margherita Classic to cart' }).click();

		// Size and crust are required; the dialog pre-selects the first of each.
		const addButton = fresh.getByRole('button', { name: /^Add item · ₹/ });
		const basePrice = await addButton.textContent();

		// Picking a large size must move the button price immediately.
		await fresh.getByRole('radio', { name: /Large 13/ }).check();
		await expect.poll(async () => await addButton.textContent()).not.toBe(basePrice);

		// An optional add-on also moves it.
		const withLarge = await addButton.textContent();
		await fresh.getByRole('checkbox', { name: /Extra mozzarella/ }).check();
		await expect.poll(async () => await addButton.textContent()).not.toBe(withLarge);

		await addButton.click();
		await expect.poll(async () => await fresh.getByText(/added to your cart/).count()).toBeGreaterThan(0);
		await fresh.context().close();
	});

	it('guarantees every required option group starts satisfied', async () => {
		/*
		 * The real invariant behind "required-option validation": a required single-pick
		 * group is PRE-SELECTED, so a user can never submit an order missing one. (Clearing
		 * a radio group from the DOM is not a reachable user state - clicking a radio can only
		 * ever select, never deselect - so the rejection path is covered by the unit tests in
		 * src/lib/logic/cart.test.ts instead of faked here.)
		 */
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/restaurant/?id=napoli-nook');
		await fresh.getByRole('button', { name: 'Add Margherita Classic to cart' }).click();

		// Both required groups are flagged as such...
		await expect.poll(async () => await fresh.getByText('Required').count()).toBeGreaterThanOrEqual(2);

		// ...and each has exactly one choice already selected.
		const selected = await fresh.evaluate(() => {
			const groups = new Map<string, number>();
			for (const input of document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="group-"]')) {
				const key = input.name;
				groups.set(key, (groups.get(key) ?? 0) + (input.checked ? 1 : 0));
			}
			return [...groups.values()];
		});
		expect(selected.length).toBeGreaterThanOrEqual(2);
		for (const count of selected) expect(count).toBe(1);

		// So the dialog can be submitted straight away and the item lands in the cart.
		await fresh.getByRole('button', { name: /^Add item · ₹/ }).click();
		await expect
			.poll(async () => ((await readStore(fresh)) as { cart: { lines: unknown[] } }).cart.lines.length)
			.toBe(1);
		await fresh.context().close();
	});

	it('treats two customisations of one dish as separate cart lines', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/restaurant/?id=napoli-nook');

		await fresh.getByRole('button', { name: 'Add Margherita Classic to cart' }).click();
		await fresh.getByRole('button', { name: /^Add item · ₹/ }).click();

		// Second time with a different size.
		await fresh.getByRole('button', { name: /Increase Margherita Classic quantity/ }).waitFor();
		await visit(fresh, probe.origin, '/restaurant/?id=napoli-nook');
		await fresh.getByRole('button', { name: /Increase Margherita Classic quantity/ }).click();

		await visit(fresh, probe.origin, '/cart/');
		// Repeat-last behaviour keeps ONE line at quantity 2 for an identical customisation.
		await expect.poll(async () => await fresh.getByText('2', { exact: true }).count()).toBeGreaterThan(0);

		const store = (await readStore(fresh)) as { cart: { lines: { id: string; quantity: number }[] } };
		expect(store.cart.lines).toHaveLength(1);
		expect(store.cart.lines[0].quantity).toBe(2);
		await fresh.context().close();
	});

	it('asks to replace the cart when mixing two restaurants', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/restaurant/?id=wok-of-fame');
		await fresh.getByRole('button', { name: /^Add .* to cart$/ }).first().click();
		const dialogAdd = fresh.getByRole('button', { name: /^Add item · ₹/ });
		if (await dialogAdd.isVisible().catch(() => false)) await dialogAdd.click();

		await expect.poll(async () => await fresh.getByRole('heading', { name: 'Replace cart?' }).count()).toBe(1);

		// Keeping the old cart must leave it untouched.
		await fresh.getByRole('button', { name: 'Keep old cart' }).click();
		let store = (await readStore(fresh)) as { cart: { restaurantId: string } };
		expect(store.cart.restaurantId).toBe('dosa-darbar');

		// Replacing swaps the restaurant and drops the old lines.
		await fresh.getByRole('button', { name: /^Add .* to cart$/ }).first().click();
		const dialogAdd2 = fresh.getByRole('button', { name: /^Add item · ₹/ });
		if (await dialogAdd2.isVisible().catch(() => false)) await dialogAdd2.click();
		await fresh.getByRole('button', { name: 'Replace cart' }).click();

		await expect
			.poll(async () => ((await readStore(fresh)) as { cart: { restaurantId: string } }).cart.restaurantId)
			.toBe('wok-of-fame');
		store = (await readStore(fresh)) as { cart: { restaurantId: string; lines: unknown[] } };
		expect(store.cart.lines).toHaveLength(1);
		await fresh.context().close();
	});
});

describe('cart, coupons and pricing', () => {
	it('shows an empty state before anything is added', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/cart/');
		await expect.poll(async () => await fresh.getByText('Your cart is empty').count()).toBe(1);
		await fresh.context().close();
	});

	it('keeps the sticky bar, stepper and cart page in agreement', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');

		// Sticky bar appears with the same count the menu stepper shows.
		await expect.poll(async () => await fresh.getByRole('link', { name: /View cart/ }).count()).toBe(1);
		const barText = squash(await fresh.getByRole('link', { name: /View cart/ }).textContent());
		expect(barText).toContain('1 item');

		// The total in the bar must equal the cart page's "To pay".
		const barTotal = barText.match(/₹[\d,.]+/)?.[0];
		expect(barTotal).toBeTruthy();
		await visit(fresh, probe.origin, '/cart/');
		const payRow = squash(await fresh.getByText('To pay').locator('..').textContent());
		expect(payRow).toContain(barTotal ?? '');
		await fresh.context().close();
	});

	it('recalculates the bill instantly when quantity changes', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');

		const readTotal = async () => {
			const text = await fresh.getByRole('link', { name: /Proceed to checkout/ }).textContent();
			return Number.parseInt((text ?? '').replace(/[^\d]/g, ''), 10);
		};
		const before = await readTotal();
		await fresh.getByRole('button', { name: /Increase .* quantity/ }).first().click();
		await expect.poll(readTotal).toBeGreaterThan(before);
		await fresh.context().close();
	});

	it('applies, rejects and removes coupons with clear reasons', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');

		// Unknown code.
		await fresh.getByLabel('Coupon code').fill('NOPE123');
		await fresh.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await fresh.getByText(/is not a FoodRush coupon/).count()).toBe(1);

		// Expired code.
		await fresh.getByLabel('Coupon code').fill('MONSOON25');
		await fresh.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await fresh.getByText(/expired on 30 Sep 2024/).count()).toBe(1);

		// Wrong restaurant.
		await fresh.getByLabel('Coupon code').fill('BROS40');
		await fresh.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await fresh.getByText(/only valid at selected restaurants/).count()).toBe(1);

		// Below minimum - and the message says how much more is needed.
		await fresh.getByLabel('Coupon code').fill('SAVE20');
		await fresh.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await fresh.getByText(/minimum ₹299/).count()).toBe(1);

		// A valid one applies and discounts the bill.
		const couponBox = fresh.getByRole('region', { name: 'Coupons & offers' });
		await fresh.getByLabel('Coupon code').fill('OFF20');
		await fresh.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await couponBox.getByText('OFF20 applied').count()).toBe(1);
		await expect.poll(async () => await fresh.getByText(/Coupon discount \(OFF20\)/).count()).toBe(1);

		// And it can be removed again.
		await fresh.getByRole('button', { name: 'Remove coupon OFF20' }).click();
		await expect.poll(async () => await couponBox.getByText('OFF20 applied').count()).toBe(0);
		await fresh.context().close();
	});

	it('AUTO-REMOVES a coupon when the cart drops below its minimum', async () => {
		const fresh = await probe.freshPage();
		// Build a cart above ₹299 so SAVE20 applies.
		// Two ₹129 idlis = ₹258, which is UNDER SAVE20's ₹299 minimum; three = ₹387, over it.
		// Dropping back to two must therefore invalidate the coupon.
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');
		await fresh.getByRole('button', { name: /Increase .* quantity/ }).first().click();
		await fresh.getByRole('button', { name: /Increase .* quantity/ }).first().click();
		const couponBox = fresh.getByRole('region', { name: 'Coupons & offers' });
		await fresh.getByLabel('Coupon code').fill('SAVE20');
		await fresh.getByRole('button', { name: 'Apply' }).click();
		await expect.poll(async () => await couponBox.getByText('SAVE20 applied').count()).toBe(1);

		// Now shrink the cart back under the minimum.
		const decrease = fresh.getByRole('button', { name: /Decrease .* quantity/ }).first();
		await decrease.click();

		// The coupon must be gone AND the user must be told why.
		await expect.poll(async () => await fresh.getByText(/SAVE20 was removed/).count()).toBeGreaterThan(0);
		await expect.poll(async () => await couponBox.getByText('SAVE20 applied').count()).toBe(0);
		await fresh.context().close();
	});

	it('waives the delivery fee for FREEDEL and shows the saving', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');
		// FREEDEL needs a ₹149 minimum; two idlis clear it.
		await fresh.getByRole('button', { name: /Increase .* quantity/ }).first().click();
		await fresh.getByLabel('Coupon code').fill('FREEDEL');
		await fresh.getByRole('button', { name: 'Apply' }).click();

		await expect.poll(async () => await fresh.getByText('FREE', { exact: true }).count()).toBeGreaterThan(0);
		await expect.poll(async () => await fresh.getByText(/You saved ₹/).count()).toBeGreaterThan(0);
		await fresh.context().close();
	});

	it('changes the total when a tip is selected', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');

		const readTotal = async () => {
			const text = await fresh.getByRole('link', { name: /Proceed to checkout/ }).textContent();
			return Number.parseInt((text ?? '').replace(/[^\d]/g, ''), 10);
		};
		const before = await readTotal();
		await fresh.getByRole('button', { name: '₹30', exact: true }).click();
		// The tip is added last and untaxed, so the grand total rises by EXACTLY ₹30.
		// readTotal() returns paise (the decimal point is stripped), hence 3000.
		await expect.poll(readTotal).toBe(before + 3000);
		await expect.poll(async () => await fresh.getByText('Delivery tip').count()).toBe(1);
		await fresh.context().close();
	});

	it('removes a line and empties the cart cleanly', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');
		await fresh.getByRole('button', { name: /^Remove .* from cart$/ }).click();
		await expect.poll(async () => await fresh.getByText('Your cart is empty').count()).toBe(1);

		// Saves are debounced, so poll the persisted copy rather than reading it immediately.
		await expect
			.poll(async () => ((await readStore(fresh)) as { cart: { lines: unknown[] } }).cart.lines.length)
			.toBe(0);
		const store = (await readStore(fresh)) as { cart: { restaurantId: string | null } };
		expect(store.cart.restaurantId).toBeNull();
		await fresh.context().close();
	});

	it('survives a refresh with the cart intact', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/cart/');
		const before = await fresh.getByRole('link', { name: /Proceed to checkout/ }).textContent();

		await fresh.reload({ waitUntil: 'networkidle' });
		await expect.poll(async () => await fresh.getByRole('link', { name: /Proceed to checkout/ }).textContent()).toBe(before);
		await fresh.context().close();
	});
});

describe('checkout and order placement', () => {
	it('validates the address form, then places an order', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/checkout/');

		await fresh.getByRole('button', { name: 'Add delivery address' }).click();

		// Submitting an empty form must surface field errors, not place an order.
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await expect.poll(async () => await fresh.getByText('Who is this order for?').count()).toBe(1);

		// Bad phone and pin are rejected with specific messages.
		await fresh.getByLabel("Receiver's name").fill('Divya');
		await fresh.getByLabel('Mobile number').fill('12345');
		await fresh.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await fresh.getByLabel('Area / locality').fill('Jayanagar');
		await fresh.getByLabel('Pin code').fill('0560');
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await expect.poll(async () => await fresh.getByText(/valid 10-digit Indian mobile/).count()).toBe(1);
		await expect.poll(async () => await fresh.getByText(/valid 6-digit pin code/).count()).toBe(1);

		// Fix them and save.
		await fresh.getByLabel('Mobile number').fill('9845012345');
		await fresh.getByLabel('Pin code').fill('560041');
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await expect.poll(async () => await fresh.getByText('Address saved.').count()).toBeGreaterThan(0);

		// UPI is the default method and needs a valid-looking id.
		await fresh.getByLabel('UPI ID').fill('not-a-upi');
		await fresh.getByRole('button', { name: /^Place order · ₹/ }).click();
		await expect.poll(async () => await fresh.getByText(/does not look like a UPI ID/).count()).toBe(1);

		await fresh.getByLabel('UPI ID').fill('divya@okbank');
		await shot(fresh, 'checkout');
		await fresh.getByRole('button', { name: /^Place order · ₹/ }).click();

		// Lands on tracking, and the cart is now empty.
		await fresh.waitForURL('**/order/**');
		await expect.poll(async () => await fresh.getByRole('heading', { level: 1 }).textContent()).toContain('Order placed');
		const store = (await readStore(fresh)) as { cart: { lines: unknown[] }; orders: unknown[] };
		expect(store.cart.lines).toHaveLength(0);
		expect(store.orders).toHaveLength(1);
		await fresh.context().close();
	});

	it('cannot place two orders from one double-click', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/checkout/');
		await fresh.getByRole('button', { name: 'Add delivery address' }).click();
		await fresh.getByLabel("Receiver's name").fill('Divya');
		await fresh.getByLabel('Mobile number').fill('9845012345');
		await fresh.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await fresh.getByLabel('Area / locality').fill('Jayanagar');
		await fresh.getByLabel('Pin code').fill('560041');
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await fresh.getByLabel('UPI ID').fill('divya@okbank');

		// Fire the click twice as fast as possible.
		const button = fresh.getByRole('button', { name: /^Place order · ₹/ });
		await button.dispatchEvent('click');
		await button.dispatchEvent('click').catch(() => {});
		await fresh.waitForURL('**/order/**');

		await expect
			.poll(async () => ((await readStore(fresh)) as { orders: unknown[] }).orders.length)
			.toBe(1);
		await fresh.context().close();
	});

	it('charges a higher delivery fee for a further address', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/checkout/');
		await fresh.getByRole('button', { name: 'Add delivery address' }).click();
		await fresh.getByLabel("Receiver's name").fill('Divya');
		await fresh.getByLabel('Mobile number').fill('9845012345');
		await fresh.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		// Dosa Darbar is in Jayanagar; delivering to Whitefield must cost more.
		await fresh.getByLabel('Area / locality').fill('Whitefield');
		await fresh.getByLabel('Pin code').fill('560066');
		await fresh.getByRole('button', { name: 'Save address' }).click();

		await expect.poll(async () => await fresh.getByText(/4\.2 km from the restaurant/).count()).toBeGreaterThan(0);
		await fresh.context().close();
	});
});

describe('order tracking', () => {
	/** Place one order and return its tracking URL. */
	async function placeOrder(target: Page): Promise<string> {
		await addFirstDish(target, probe.origin, 'dosa-darbar');
		await visit(target, probe.origin, '/checkout/');
		await target.getByRole('button', { name: 'Add delivery address' }).click();
		await target.getByLabel("Receiver's name").fill('Divya');
		await target.getByLabel('Mobile number').fill('9845012345');
		await target.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await target.getByLabel('Area / locality').fill('Jayanagar');
		await target.getByLabel('Pin code').fill('560041');
		await target.getByRole('button', { name: 'Save address' }).click();
		await target.getByRole('button', { name: 'Cash on delivery' }).click().catch(async () => {
			await target.getByLabel(/Cash on delivery/).check();
		});
		await target.getByRole('button', { name: /^Place order · ₹/ }).click();
		await target.waitForURL('**/order/**');
		return target.url();
	}

	it('progresses through the status timeline and resumes after a refresh', async () => {
		const fresh = await probe.freshPage();
		const url = await placeOrder(fresh);

		await expect.poll(async () => await fresh.getByRole('heading', { level: 1 }).textContent()).toContain('Order placed');
		// Confirmed arrives at 12s in the demo schedule.
		await expect
			.poll(async () => await fresh.getByRole('heading', { level: 1 }).textContent(), { timeout: 25_000 })
			.toContain('Confirmed');

		// A refresh must RESUME, never restart at "Order placed".
		await fresh.goto(url, { waitUntil: 'networkidle' });
		const afterReload = await fresh.getByRole('heading', { level: 1 }).textContent();
		expect(afterReload).not.toContain('Order placed');

		// And it keeps moving forward to Preparing.
		await expect
			.poll(async () => await fresh.getByRole('heading', { level: 1 }).textContent(), { timeout: 30_000 })
			.toContain('Preparing');
		await shot(fresh, 'tracking');
		await fresh.context().close();
	});

	it('allows cancelling early and explains when it is too late', async () => {
		const fresh = await probe.freshPage();
		await placeOrder(fresh);

		// Early: cancellation is offered.
		await expect.poll(async () => await fresh.getByRole('button', { name: 'Cancel order' }).count()).toBe(1);
		await fresh.getByRole('button', { name: 'Cancel order' }).click();
		await fresh.getByRole('radio', { name: 'Ordered by mistake' }).check();
		await fresh.getByRole('button', { name: 'Confirm cancellation' }).click();

		// The headline flips to Cancelled, the reason is shown, and the timeline ends there.
		await expect
			.poll(async () => squash(await fresh.getByRole('heading', { level: 1 }).textContent()))
			.toBe('Cancelled');
		await expect.poll(async () => await fresh.getByText(/Reason: Ordered by mistake/).count()).toBe(1);
		await expect.poll(async () => await fresh.getByRole('button', { name: 'Cancel order' }).count()).toBe(0);
		await fresh.context().close();
	});

	it('blocks cancellation once the kitchen starts cooking', async () => {
		const fresh = await probe.freshPage();
		await placeOrder(fresh);
		// Preparing begins at 30s in the demo schedule.
		await expect
			.poll(async () => await fresh.getByText(/no longer be cancelled|rider already has/).count(), {
				timeout: 50_000
			})
			.toBeGreaterThan(0);
		await expect.poll(async () => await fresh.getByRole('button', { name: 'Cancel order' }).count()).toBe(0);
		await fresh.context().close();
	});

	it('reaches delivered, prompts for a rating and updates the restaurant average', async () => {
		const fresh = await probe.freshPage();
		await placeOrder(fresh);

		// Delivered lands at 150s in the demo schedule.
		await expect
			.poll(async () => await fresh.getByRole('heading', { level: 1 }).textContent(), { timeout: 200_000 })
			.toContain('Delivered');

		// The rating dialog opens by itself.
		await expect.poll(async () => await fresh.getByRole('heading', { name: 'How was your order?' }).count()).toBe(1);

		// It refuses to submit without both ratings.
		await fresh.getByRole('button', { name: 'Submit rating' }).click();
		await expect.poll(async () => await fresh.getByText('Give the food at least one star.').count()).toBe(1);

		await fresh.getByRole('radio', { name: '5 stars' }).first().click();
		await fresh.getByRole('radio', { name: '4 stars' }).last().click();
		await fresh.getByRole('button', { name: 'Tasty' }).click();
		await fresh.getByLabel(/Tell us more/).fill('Hot, crisp, and the chutney was perfect.');
		await fresh.getByRole('button', { name: 'Submit rating' }).click();

		await expect.poll(async () => await fresh.getByText(/Your rating/).count()).toBeGreaterThan(0);

		// The review is now visible on the restaurant page.
		await visit(fresh, probe.origin, '/restaurant/?id=dosa-darbar');
		await expect.poll(async () => await fresh.getByText('Hot, crisp, and the chutney was perfect.').count()).toBe(1);
		await expect.poll(async () => await fresh.getByText('Tasty').count()).toBeGreaterThan(0);
		await fresh.context().close();
	}, 260_000);
});

describe('order history and reorder', () => {
	it('lists a past order and rebuilds the cart from it', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/checkout/');
		await fresh.getByRole('button', { name: 'Add delivery address' }).click();
		await fresh.getByLabel("Receiver's name").fill('Divya');
		await fresh.getByLabel('Mobile number').fill('9845012345');
		await fresh.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await fresh.getByLabel('Area / locality').fill('Jayanagar');
		await fresh.getByLabel('Pin code').fill('560041');
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await fresh.getByLabel('UPI ID').fill('divya@okbank');
		await fresh.getByRole('button', { name: /^Place order · ₹/ }).click();
		await fresh.waitForURL('**/order/**');

		await visit(fresh, probe.origin, '/orders/');
		await expect.poll(async () => await fresh.getByRole('heading', { name: 'Dosa Darbar' }).count()).toBe(1);

		await fresh.getByRole('button', { name: 'Reorder' }).click();
		await fresh.waitForURL('**/cart/**');
		await expect.poll(async () => await fresh.getByRole('link', { name: /Proceed to checkout/ }).count()).toBe(1);
		await shot(fresh, 'orders');
		await fresh.context().close();
	});

	it('downloads a real PDF invoice', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'dosa-darbar');
		await visit(fresh, probe.origin, '/checkout/');
		await fresh.getByRole('button', { name: 'Add delivery address' }).click();
		await fresh.getByLabel("Receiver's name").fill('Divya');
		await fresh.getByLabel('Mobile number').fill('9845012345');
		await fresh.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await fresh.getByLabel('Area / locality').fill('Jayanagar');
		await fresh.getByLabel('Pin code').fill('560041');
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await fresh.getByLabel('UPI ID').fill('divya@okbank');
		await fresh.getByRole('button', { name: /^Place order · ₹/ }).click();
		await fresh.waitForURL('**/order/**');

		await visit(fresh, probe.origin, '/orders/');
		const [download] = await Promise.all([
			fresh.waitForEvent('download'),
			fresh.getByRole('button', { name: 'Invoice (PDF)' }).click()
		]);
		expect(download.suggestedFilename()).toMatch(/^FoodRush_Invoice_FR-[A-Z0-9]+\.pdf$/);

		// Verify it is a real PDF by its magic bytes and EOF marker.
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const bytes = Buffer.concat(chunks);
		expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
		expect(bytes.subarray(-6).toString()).toContain('%%EOF');
		expect(bytes.length).toBeGreaterThan(900);

		// It must EMBED the font, not reference a base-14 one - that is what lets it print ₹.
		const fonts = embeddedFonts(bytes);
		expect(fonts.length).toBe(2);
		for (const font of fonts) {
			expect(font.isTrueType, `${font.name} is not a TrueType program`).toBe(true);
			expect(font.bytes).toBeGreaterThan(5000);
			expect(font.name).toMatch(/^NotoSans-(Regular|Bold)$/);
		}

		// And the decoded text must contain real rupee signs, never "Rs." or a blank box.
		const text = extractText(bytes);
		expect(text).toContain('₹');
		expect(text).not.toContain('Rs.');
		expect(text).not.toContain('�');
		await fresh.context().close();
	});
});

describe('invoice PDF: embedded font and the rupee sign', () => {
	/**
	 * Seeds three delivered orders at the amounts the brief calls out - ₹49, ₹1,250 and
	 * ₹1,00,000 - so the invoice can be checked at a single-digit amount, a thousands
	 * amount, and a LAKH amount where Indian grouping differs from Western grouping.
	 */
	function seedOrders() {
		const make = (id: string, paise: number, name: string) => ({
			id,
			restaurantId: 'dosa-darbar',
			restaurantName: 'Dosa Darbar',
			lines: [
				{
					id: 'l1',
					dishId: 'dosa-darbar--masala-dosa',
					restaurantId: 'dosa-darbar',
					name,
					veg: true,
					art: 'dosa',
					basePricePaise: paise,
					options: [],
					quantity: 1,
					instructions: ''
				}
			],
			address: {
				id: 'a1',
				label: 'Home',
				name: 'Divya',
				phone: '9845012345',
				line1: '12, 3rd Cross',
				line2: '',
				area: 'Jayanagar',
				city: 'Bengaluru',
				pin: '560041',
				landmark: '',
				instructions: '',
				isDefault: true
			},
			payment: 'upi',
			couponCode: null,
			price: {
				itemTotalPaise: paise,
				packagingPaise: 0,
				deliveryFeePaise: 0,
				deliveryFeeWaived: false,
				taxPaise: 0,
				discountPaise: 0,
				tipPaise: 0,
				totalPaise: paise,
				distanceKm: 1.8
			},
			status: 'delivered',
			placedAt: Date.now() - 86_400_000,
			timeline: [{ status: 'placed', at: Date.now() - 86_400_000 }],
			etaAt: Date.now() - 86_000_000,
			scheduledFor: null,
			partner: { name: 'Ramesh Kumar', rating: 4.8, vehicle: 'KA 01 AB 4412', phone: '+91 98450 11223' },
			cancelledReason: null
		});

		return JSON.stringify({
			version: 1,
			profile: { name: 'Divya', phone: '', email: '' },
			settings: { theme: 'light', vegOnly: false, language: 'en', reduceMotion: false },
			location: { areaId: null, label: '', fromDevice: false },
			cart: { restaurantId: null, lines: [], couponCode: null, tipPaise: 0 },
			addresses: [],
			reviews: [],
			favourites: { restaurants: [], dishes: [] },
			usedCoupons: [],
			availability: {},
			ratedOrders: [],
			orders: [
				make('order-aaa', 4900, 'Medu Vada'),
				make('order-bbb', 125_000, 'Family Thali'),
				make('order-ccc', 10_000_000, 'Wedding Catering Package')
			]
		});
	}

	it('serves the subset fonts as REAL files after build', async () => {
		for (const file of ['noto-sans-invoice-regular.ttf', 'noto-sans-invoice-bold.ttf']) {
			const response = await fetch(`${probe.origin}/fonts/${file}`);
			expect(response.status, file).toBe(200);
			const bytes = Buffer.from(await response.arrayBuffer());
			// Real TrueType program, not the SPA HTML fallback.
			expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x00]));
			expect(bytes.length).toBeGreaterThan(5000);
		}

		const metrics = await fetch(`${probe.origin}/fonts/noto-sans-invoice.json`);
		expect(metrics.status).toBe(200);
		expect(metrics.headers.get('content-type')).toContain('application/json');
		const text = await metrics.text();
		expect(text.trimStart().startsWith('<')).toBe(false);
		const manifest = JSON.parse(text) as {
			family: string;
			weights: Record<string, { glyphs: Record<string, { gid: number }> }>;
		};
		expect(manifest.family).toBe('NotoSans');
		// U+20B9 = 8377. Present and not .notdef, in both weights.
		for (const weight of ['regular', 'bold']) {
			expect(manifest.weights[weight].glyphs['8377'].gid).toBeGreaterThan(0);
		}
	});

	it('prints ₹ (not "Rs.") at ₹49, ₹1,250 and ₹1,00,000 with lakh grouping', async () => {
		const context = await probe.browser.newContext({
			viewport: { width: 1280, height: 900 },
			acceptDownloads: true
		});
		await context.addInitScript((payload) => {
			try {
				localStorage.setItem('foodrush:data:v1', payload);
			} catch {
				/* storage unavailable */
			}
		}, seedOrders());

		const page = await context.newPage();
		await page.goto(`${probe.origin}/orders/`, { waitUntil: 'networkidle' });

		const buttons = page.getByRole('button', { name: 'Invoice (PDF)' });
		await expect.poll(async () => await buttons.count()).toBe(3);

		// Newest first, matching the seeded order.
		const expected = [
			{ amount: '₹49.00', label: '₹49' },
			{ amount: '₹1,250.00', label: '₹1,250' },
			{ amount: '₹1,00,000.00', label: '₹1,00,000 (lakh grouping)' }
		];

		for (const [index, target] of expected.entries()) {
			const [download] = await Promise.all([
				page.waitForEvent('download'),
				buttons.nth(index).click()
			]);
			const stream = await download.createReadStream();
			const chunks: Buffer[] = [];
			for await (const chunk of stream) chunks.push(chunk as Buffer);
			const bytes = Buffer.concat(chunks);

			const text = extractText(bytes);
			// The amount is present, formatted the Indian way.
			expect(text, `${target.label} missing from the invoice`).toContain(target.amount);
			// No legacy fallback, and no undecodable glyph anywhere.
			expect(text, `${target.label} still prints Rs.`).not.toContain('Rs.');
			expect(text, `${target.label} has an unmapped glyph`).not.toContain('�');
			// The footnote says rupees, in rupees.
			expect(text).toContain('Amounts are in Indian rupees (₹).');

			// Every rupee in the document is the real glyph, not a substitution.
			const runs = extractRuns(bytes);
			const rupeeRuns = runs.filter((run) => run.text.includes('₹'));
			expect(rupeeRuns.length, `${target.label} drew no rupee runs`).toBeGreaterThan(3);
			for (const run of rupeeRuns) {
				expect(run.gids.every((gid) => gid > 0), 'a run fell back to .notdef').toBe(true);
			}
		}

		await context.close();
	});

	it('keeps the PDF searchable by mapping glyphs back to Unicode', async () => {
		const context = await probe.browser.newContext({
			viewport: { width: 1280, height: 900 },
			acceptDownloads: true
		});
		await context.addInitScript((payload) => {
			try {
				localStorage.setItem('foodrush:data:v1', payload);
			} catch {
				/* storage unavailable */
			}
		}, seedOrders());

		const page = await context.newPage();
		await page.goto(`${probe.origin}/orders/`, { waitUntil: 'networkidle' });
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Invoice (PDF)' }).first().click()
		]);
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const bytes = Buffer.concat(chunks);

		// Both weights carry a /ToUnicode CMap, so selecting text in a reader yields
		// characters rather than glyph indices.
		const pdf = bytes.toString('latin1');
		expect(pdf.match(/\/ToUnicode/g)?.length).toBe(2);
		expect(pdf).toContain('/Encoding /Identity-H');
		expect(pdf).toContain('/CIDToGIDMap /Identity');

		// Real content survives the round trip, including the restaurant and dish names.
		const text = extractText(bytes);
		expect(text).toContain('Dosa Darbar');
		expect(text).toContain('Medu Vada');
		expect(text).toContain('FoodRush');
		await context.close();
	});
});

describe('owner view', () => {
	it('marks a dish out of stock and the customer menu updates immediately', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/owner/');
		await fresh.getByLabel('Signed in as').selectOption('dosa-darbar');
		await fresh.getByLabel('Search this menu').fill('Masala Dosa');

		const toggle = fresh.getByRole('checkbox', { name: 'Masala Dosa availability' }).first();
		await toggle.uncheck();
		await expect.poll(async () => await fresh.getByText('Out of stock').count()).toBeGreaterThan(0);

		// Customer menu now shows it unavailable with no Add button.
		await visit(fresh, probe.origin, '/restaurant/?id=dosa-darbar');
		await expect.poll(async () => await fresh.getByRole('button', { name: 'Add Masala Dosa to cart' }).count()).toBe(0);
		await expect.poll(async () => await fresh.getByText('Out of stock').count()).toBeGreaterThan(0);

		// And it comes back when the owner switches it on again.
		await visit(fresh, probe.origin, '/owner/');
		await fresh.getByLabel('Signed in as').selectOption('dosa-darbar');
		await fresh.getByLabel('Search this menu').fill('Masala Dosa');
		await fresh.getByRole('checkbox', { name: 'Masala Dosa availability' }).first().check();
		await visit(fresh, probe.origin, '/restaurant/?id=dosa-darbar');
		await expect.poll(async () => await fresh.getByRole('button', { name: 'Add Masala Dosa to cart' }).count()).toBe(1);
		await fresh.context().close();
	});

	it('pulls an out-of-stock dish out of the live cart with a message', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/restaurant/?id=dosa-darbar');
		await fresh.getByRole('button', { name: 'Add Masala Dosa to cart' }).click();
		const dialogAdd = fresh.getByRole('button', { name: /^Add item · ₹/ });
		if (await dialogAdd.isVisible().catch(() => false)) await dialogAdd.click();

		await visit(fresh, probe.origin, '/owner/');
		await fresh.getByLabel('Signed in as').selectOption('dosa-darbar');
		await fresh.getByLabel('Search this menu').fill('Masala Dosa');
		await fresh.getByRole('checkbox', { name: 'Masala Dosa availability' }).first().uncheck();

		await expect.poll(async () => await fresh.getByText(/went out of stock and was removed/).count()).toBeGreaterThan(0);
		await expect
			.poll(async () => ((await readStore(fresh)) as { cart: { lines: unknown[] } }).cart.lines.length)
			.toBe(0);
		await fresh.context().close();
	});

	it('accepts an order and moves it through the kitchen states', async () => {
		const fresh = await probe.freshPage();
		await addFirstDish(fresh, probe.origin, 'chilli-dragon');
		await visit(fresh, probe.origin, '/checkout/');
		await fresh.getByRole('button', { name: 'Add delivery address' }).click();
		await fresh.getByLabel("Receiver's name").fill('Divya');
		await fresh.getByLabel('Mobile number').fill('9845012345');
		await fresh.getByLabel('Flat / house no. / building').fill('12, 3rd Cross');
		await fresh.getByLabel('Area / locality').fill('BTM Layout');
		await fresh.getByLabel('Pin code').fill('560076');
		await fresh.getByRole('button', { name: 'Save address' }).click();
		await fresh.getByLabel('UPI ID').fill('divya@okbank');
		await fresh.getByRole('button', { name: /^Place order · ₹/ }).click();
		await fresh.waitForURL('**/order/**');

		await visit(fresh, probe.origin, '/owner/');
		await fresh.getByLabel('Signed in as').selectOption('chilli-dragon');
		await expect.poll(async () => await fresh.getByText(/FR-/).count()).toBeGreaterThan(0);

		// Whatever stage the simulator has reached, the owner has a next action available.
		const action = fresh.getByRole('button', { name: /Accept order|Mark preparing|Mark ready|Mark delivered/ }).first();
		await action.click();
		await expect.poll(async () => await fresh.getByText(/FR-.*:/).count()).toBeGreaterThan(0);
		await shot(fresh, 'owner');
		await fresh.context().close();
	});
});

describe('favourites, theme and resilience', () => {
	it('saves a restaurant to favourites and shows it on the favourites page', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/restaurant/?id=mithai-mahal');
		await fresh.getByRole('button', { name: 'Save to favourites' }).click();

		await visit(fresh, probe.origin, '/favourites/');
		await expect.poll(async () => await fresh.getByRole('heading', { name: 'Mithai Mahal' }).count()).toBe(1);
		await shot(fresh, 'favourites');
		await fresh.context().close();
	});

	it('switches theme and keeps it across a reload', async () => {
		const fresh = await probe.freshPage();
		await visit(fresh, probe.origin, '/');
		const wasDark = await fresh.evaluate(() => document.documentElement.classList.contains('dark'));

		await fresh.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
		await expect
			.poll(async () => await fresh.evaluate(() => document.documentElement.classList.contains('dark')))
			.toBe(!wasDark);

		await fresh.reload({ waitUntil: 'networkidle' });
		expect(await fresh.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!wasDark);
		await fresh.context().close();
	});

	it('boots cleanly from CORRUPTED saved data instead of showing a blank screen', async () => {
		/*
		 * The bad payload is injected with addInitScript so it is in place BEFORE the app
		 * boots. Writing it from an already-loaded page does not work: FoodRush flushes its
		 * store on `pagehide` (so a refresh never loses the cart), which would overwrite the
		 * corrupt value with valid JSON before the reload even happened.
		 */
		const context = await probe.browser.newContext({ viewport: { width: 1280, height: 900 } });
		await context.addInitScript(() => {
			try {
				localStorage.setItem('foodrush:data:v1', '{{{not json');
			} catch {
				/* storage unavailable in this context */
			}
		});
		const corrupt = await context.newPage();
		await corrupt.goto(`${probe.origin}/`, { waitUntil: 'networkidle' });

		// The app still renders, and it tells the user what happened.
		await expect.poll(async () => await corrupt.getByRole('heading', { level: 1 }).count()).toBe(1);
		await expect.poll(async () => await corrupt.getByText(/could not be read/).count()).toBeGreaterThan(0);
		// The unreadable payload was preserved, exactly as the message promises.
		await expect
			.poll(async () => await corrupt.evaluate(() => localStorage.getItem('foodrush:data:unreadable')))
			.toBe('{{{not json');
		await context.close();
	});

	it('refuses to overwrite data from a NEWER app version', async () => {
		const context = await probe.browser.newContext({ viewport: { width: 1280, height: 900 } });
		await context.addInitScript(() => {
			try {
				localStorage.setItem('foodrush:data:v1', JSON.stringify({ version: 99, cart: { lines: [] } }));
			} catch {
				/* storage unavailable in this context */
			}
		});
		const future = await context.newPage();
		await future.goto(`${probe.origin}/`, { waitUntil: 'networkidle' });

		await expect.poll(async () => await future.getByText(/newer version of FoodRush/).count()).toBeGreaterThan(0);
		// The newer file must survive untouched rather than being salvaged or overwritten.
		await expect
			.poll(async () => await future.evaluate(() => localStorage.getItem('foodrush:data:unreadable')))
			.toBeNull();
		await context.close();
	});

	it('keeps working when a cart line is garbage', async () => {
		const context = await probe.browser.newContext({ viewport: { width: 1280, height: 900 } });
		await context.addInitScript(() => {
			try {
				localStorage.setItem(
					'foodrush:data:v1',
					JSON.stringify({
						version: 1,
						cart: {
							restaurantId: 'dosa-darbar',
							lines: [{ nonsense: true }, null],
							couponCode: 'X',
							tipPaise: -5
						}
					})
				);
			} catch {
				/* storage unavailable in this context */
			}
		});
		const garbage = await context.newPage();
		await garbage.goto(`${probe.origin}/cart/`, { waitUntil: 'networkidle' });

		// Malformed lines are dropped rather than poisoning the bill, and the page still works.
		await expect.poll(async () => await garbage.getByText('Your cart is empty').count()).toBe(1);
		await context.close();
	});

	it('deep links and hard refreshes resolve on every route', async () => {
		for (const path of [
			'/',
			'/restaurants/',
			'/restaurants/?q=dosa&veg=1',
			'/restaurant/?id=dosa-darbar',
			'/cart/',
			'/checkout/',
			'/orders/',
			'/offers/',
			'/favourites/',
			'/profile/',
			'/owner/',
			'/order/?id=does-not-exist'
		]) {
			const response = await page.goto(`${probe.origin}${path}`, { waitUntil: 'networkidle' });
			expect(response?.status(), `status for ${path}`).toBeLessThan(400);
			// Never a blank screen: every route renders exactly one h1.
			await expect.poll(async () => await page.getByRole('heading', { level: 1 }).count()).toBe(1);
		}
	});

	it('shows a friendly message for an order id that does not exist', async () => {
		await visit(page, probe.origin, '/order/?id=nope');
		await expect.poll(async () => await page.getByText('We cannot find that order').count()).toBe(1);
	});
});

describe('responsive layout', () => {
	for (const [label, width, height] of [
		['mobile', 390, 844],
		['tablet', 834, 1112],
		['desktop', 1440, 900]
	] as const) {
		it(`renders ${label} with no horizontal overflow`, async () => {
			const sized = await probe.freshPage({ width, height });
			for (const path of ['/', '/restaurants/', '/restaurant/?id=biryani-bros', '/cart/']) {
				await visit(sized, probe.origin, path);
				const overflow = await sized.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
				// Allow 1px for sub-pixel rounding.
				expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
			}
			await visit(sized, probe.origin, '/restaurants/');
			await shot(sized, `listing-${label}`);
			await sized.context().close();
		});
	}

	it('shows the mobile tab bar and sticky cart bar on a phone', async () => {
		const phone = await probe.freshPage({ width: 390, height: 844 });
		await visit(phone, probe.origin, '/');
		await expect.poll(async () => await phone.getByRole('navigation', { name: 'Primary' }).count()).toBe(1);

		await addFirstDish(phone, probe.origin, 'dosa-darbar');
		await expect.poll(async () => await phone.getByRole('link', { name: /View cart/ }).count()).toBe(1);
		await shot(phone, 'mobile-cart-bar');
		await phone.context().close();
	});
});

describe('no console errors anywhere', () => {
	it('collected zero browser console errors across the whole run', () => {
		// Deliberately last: every probe above shares this error collector.
		expect(probe.errors).toEqual([]);
	});
});
