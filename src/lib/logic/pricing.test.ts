import { describe, expect, it } from 'vitest';
import {
	DELIVERY_GST_PERCENT,
	FOOD_GST_PERCENT,
	MAX_LINE_QUANTITY,
	PACKAGING_CAP_PAISE,
	PACKAGING_PER_LINE_PAISE,
	deliveryFeeFor,
	findLineIssues,
	itemTotal,
	linePrice,
	packagingFor,
	priceCart,
	savingsOf,
	unitPrice
} from './pricing';
import { percentOf } from './money';
import type { Cart, CartLine, Coupon, Dish, Restaurant, SelectedOption } from '../types';

const NOW = new Date(2026, 3, 29, 13, 0, 0).getTime();

function line(overrides: Partial<CartLine> = {}): CartLine {
	return {
		id: 'line-1',
		dishId: 'dosa-darbar--masala-dosa',
		restaurantId: 'dosa-darbar',
		name: 'Masala Dosa',
		veg: true,
		art: 'dosa',
		basePricePaise: 14900,
		options: [],
		quantity: 1,
		instructions: '',
		...overrides
	};
}

function option(deltaPaise: number, id = 'opt'): SelectedOption {
	return { groupId: 'addons', groupName: 'Add-ons', choiceId: id, choiceName: id, deltaPaise };
}

function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
	return {
		id: 'dosa-darbar',
		name: 'Dosa Darbar',
		cuisines: ['South Indian'],
		area: 'Jayanagar',
		address: '42, 11th Main Road',
		rating: 4.4,
		ratingCount: 2074,
		deliveryMinutes: 20,
		distanceKm: 1.8,
		priceForTwoPaise: 47000,
		pureVeg: true,
		offerCodes: [],
		hours: { open: 390, close: 1320 },
		categories: ['Dosa Counter'],
		art: 'dosa',
		tagline: 'Fresh batter daily',
		...overrides
	};
}

function cart(overrides: Partial<Cart> = {}): Cart {
	return {
		restaurantId: 'dosa-darbar',
		lines: [line()],
		couponCode: null,
		tipPaise: 0,
		...overrides
	};
}

const priceInput = (overrides: Partial<Parameters<typeof priceCart>[0]> = {}) => ({
	cart: cart(),
	restaurant: restaurant(),
	coupon: null as Coupon | null,
	usedCoupons: [] as string[],
	orderCount: 0,
	now: NOW,
	...overrides
});

describe('deliveryFeeFor', () => {
	it('uses the slab boundaries exactly', () => {
		expect(deliveryFeeFor(0)).toBe(1900);
		expect(deliveryFeeFor(2)).toBe(1900);
		expect(deliveryFeeFor(2.1)).toBe(2900);
		expect(deliveryFeeFor(4)).toBe(2900);
		expect(deliveryFeeFor(4.5)).toBe(3900);
		expect(deliveryFeeFor(7)).toBe(3900);
		expect(deliveryFeeFor(9.9)).toBe(4900);
		expect(deliveryFeeFor(10)).toBe(4900);
	});

	it('adds a per-km step beyond the last slab', () => {
		// 11.2 km -> 2 extra km (ceil of 1.2) -> 4900 + 1800.
		expect(deliveryFeeFor(11.2)).toBe(6700);
		expect(deliveryFeeFor(15)).toBe(4900 + 5 * 900);
	});

	it('treats nonsense distances as zero', () => {
		expect(deliveryFeeFor(-4)).toBe(1900);
		expect(deliveryFeeFor(Number.NaN)).toBe(1900);
	});
});

describe('line maths', () => {
	it('adds option deltas to the base price', () => {
		expect(unitPrice(line({ options: [option(3000), option(2500, 'b')] }))).toBe(14900 + 5500);
	});

	it('multiplies by quantity', () => {
		expect(linePrice(line({ quantity: 3 }))).toBe(44700);
	});

	it('clamps negative and fractional quantities to a sane integer', () => {
		expect(linePrice(line({ quantity: -2 }))).toBe(0);
		expect(linePrice(line({ quantity: 2.7 }))).toBe(29800);
		expect(linePrice(line({ quantity: 999 }))).toBe(14900 * MAX_LINE_QUANTITY);
	});

	it('sums an item total across lines', () => {
		const lines = [line({ quantity: 2 }), line({ id: 'l2', basePricePaise: 9900, quantity: 1 })];
		expect(itemTotal(lines)).toBe(29800 + 9900);
	});

	it('ignores zero-quantity lines in the item total', () => {
		expect(itemTotal([line({ quantity: 0 }), line({ id: 'l2', quantity: 1 })])).toBe(14900);
	});
});

describe('packagingFor', () => {
	it('charges per billable line and caps it', () => {
		expect(packagingFor([line()])).toBe(PACKAGING_PER_LINE_PAISE);
		expect(packagingFor([line(), line({ id: 'l2' })])).toBe(PACKAGING_PER_LINE_PAISE * 2);
		const many = Array.from({ length: 12 }, (_, i) => line({ id: `l${i}` }));
		expect(packagingFor(many)).toBe(PACKAGING_CAP_PAISE);
	});

	it('does not charge for zero-quantity lines', () => {
		expect(packagingFor([line({ quantity: 0 })])).toBe(0);
	});
});

describe('priceCart', () => {
	it('builds a bill that adds up exactly', () => {
		const result = priceCart(priceInput());
		const expectedTax = percentOf(14900, FOOD_GST_PERCENT) + percentOf(1900, DELIVERY_GST_PERCENT);

		expect(result.itemTotalPaise).toBe(14900);
		expect(result.packagingPaise).toBe(700);
		expect(result.deliveryFeePaise).toBe(1900);
		expect(result.taxPaise).toBe(expectedTax);
		expect(result.discountPaise).toBe(0);
		expect(result.totalPaise).toBe(14900 + 700 + 1900 + expectedTax);
	});

	it('charges nothing at all for an empty cart', () => {
		const result = priceCart(priceInput({ cart: cart({ lines: [] }) }));
		expect(result).toMatchObject({
			itemTotalPaise: 0,
			packagingPaise: 0,
			deliveryFeePaise: 0,
			taxPaise: 0,
			totalPaise: 0
		});
	});

	it('applies a percentage coupon to the item total only, then taxes the remainder', () => {
		const coupon: Coupon = {
			code: 'SAVE20',
			title: '20% off',
			description: '',
			kind: 'percent',
			percent: 20,
			maxDiscountPaise: 8000,
			minOrderPaise: 29900,
			restaurantId: null,
			expiresOn: '2027-12-31'
		};
		const result = priceCart(
			priceInput({ cart: cart({ lines: [line({ quantity: 3 })], couponCode: 'SAVE20' }), coupon })
		);

		expect(result.itemTotalPaise).toBe(44700);
		expect(result.discountPaise).toBe(8000); // capped
		// Tax is charged on the DISCOUNTED food, plus the (untouched) delivery fee.
		expect(result.taxPaise).toBe(percentOf(44700 - 8000, 5) + percentOf(1900, 18));
		expect(result.appliedCode).toBe('SAVE20');
		expect(result.totalPaise).toBe(44700 + 700 + 1900 + result.taxPaise - 8000);
	});

	it('waives the delivery fee and its tax for a free-delivery coupon', () => {
		const coupon: Coupon = {
			code: 'FREEDEL',
			title: 'Free delivery',
			description: '',
			kind: 'free-delivery',
			minOrderPaise: 14900,
			restaurantId: null,
			expiresOn: '2027-12-31'
		};
		const result = priceCart(priceInput({ cart: cart({ couponCode: 'FREEDEL' }), coupon }));

		expect(result.deliveryFeePaise).toBe(0);
		expect(result.deliveryFeeWaived).toBe(true);
		expect(result.taxPaise).toBe(percentOf(14900, 5));
		expect(savingsOf(result, 1900)).toBe(1900);
	});

	it('reports a coupon error and charges full price when the cart falls below the minimum', () => {
		const coupon: Coupon = {
			code: 'SAVE20',
			title: '20% off',
			description: '',
			kind: 'percent',
			percent: 20,
			maxDiscountPaise: 8000,
			minOrderPaise: 29900,
			restaurantId: null,
			expiresOn: '2027-12-31'
		};
		// One dosa is below the ₹299 minimum.
		const result = priceCart(priceInput({ cart: cart({ couponCode: 'SAVE20' }), coupon }));

		expect(result.discountPaise).toBe(0);
		expect(result.appliedCode).toBeNull();
		expect(result.couponError).toContain('minimum ₹299');
		expect(result.totalPaise).toBeGreaterThan(result.itemTotalPaise);
	});

	it('adds the tip last, untaxed and undiscounted', () => {
		const withoutTip = priceCart(priceInput());
		const withTip = priceCart(priceInput({ cart: cart({ tipPaise: 3000 }) }));

		expect(withTip.taxPaise).toBe(withoutTip.taxPaise);
		expect(withTip.totalPaise).toBe(withoutTip.totalPaise + 3000);
	});

	it('uses an overridden distance for the delivery fee', () => {
		const result = priceCart(priceInput({ distanceKm: 8.4 }));
		expect(result.deliveryFeePaise).toBe(4900);
		expect(result.distanceKm).toBe(8.4);
	});

	it('never produces a negative total', () => {
		const coupon: Coupon = {
			code: 'HUGE',
			title: 'Huge',
			description: '',
			kind: 'flat',
			flatPaise: 999999,
			minOrderPaise: 0,
			restaurantId: null,
			expiresOn: '2027-12-31'
		};
		const result = priceCart(priceInput({ cart: cart({ couponCode: 'HUGE' }), coupon }));
		expect(result.discountPaise).toBe(result.itemTotalPaise);
		expect(result.totalPaise).toBeGreaterThanOrEqual(0);
	});

	it('produces identical numbers for identical carts (screens cannot disagree)', () => {
		const input = priceInput({ cart: cart({ lines: [line({ quantity: 2 }), line({ id: 'l2', basePricePaise: 18900 })] }) });
		expect(priceCart(input)).toEqual(priceCart(input));
	});

	it('is integer-only across a long random cart', () => {
		const lines = Array.from({ length: 17 }, (_, i) =>
			line({ id: `l${i}`, basePricePaise: 9900 + i * 311, quantity: (i % 4) + 1, options: [option(i * 97)] })
		);
		const result = priceCart(priceInput({ cart: cart({ lines, tipPaise: 2000 }) }));
		for (const value of Object.values(result)) {
			if (typeof value === 'number') expect(Number.isInteger(value) || value === result.distanceKm).toBe(true);
		}
	});
});

describe('findLineIssues', () => {
	function dish(overrides: Partial<Dish> = {}): Dish {
		return {
			id: 'dosa-darbar--masala-dosa',
			restaurantId: 'dosa-darbar',
			name: 'Masala Dosa',
			description: '',
			category: 'Dosa Counter',
			pricePaise: 14900,
			veg: true,
			bestseller: false,
			recommended: false,
			rating: 4.5,
			ratingCount: 100,
			serves: 1,
			art: 'dosa',
			optionGroups: [],
			available: true,
			...overrides
		};
	}

	it('finds nothing wrong with a clean cart', () => {
		const dishes = new Map([[dish().id, dish()]]);
		expect(findLineIssues([line()], dishes, {})).toEqual([]);
	});

	it('flags a dish that left the menu', () => {
		const issues = findLineIssues([line()], new Map(), {});
		expect(issues).toHaveLength(1);
		expect(issues[0].kind).toBe('missing');
	});

	it('flags a dish marked out of stock by the owner view', () => {
		const dishes = new Map([[dish().id, dish()]]);
		const issues = findLineIssues([line()], dishes, { [dish().id]: false });
		expect(issues[0].kind).toBe('unavailable');
	});

	it('flags a price change with both prices', () => {
		const dishes = new Map([[dish().id, dish({ pricePaise: 16900 })]]);
		const issues = findLineIssues([line()], dishes, {});
		expect(issues[0]).toMatchObject({ kind: 'price-changed', fromPaise: 14900, toPaise: 16900 });
	});
});
