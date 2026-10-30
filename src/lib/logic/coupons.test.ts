import { describe, expect, it } from 'vitest';
import { bestCoupon, evaluateCoupon, isExpired, rankCoupons } from './coupons';
import type { Coupon } from '../types';

// Every test builds its own data. No shared mutable fixture, so one failure cannot
// cascade into the next test (a hard requirement in the brief).
const NOW = new Date(2026, 3, 29, 13, 0, 0).getTime();

function coupon(overrides: Partial<Coupon> = {}): Coupon {
	return {
		code: 'TEST10',
		title: 'Test coupon',
		description: 'A coupon for tests',
		kind: 'flat',
		flatPaise: 1000,
		minOrderPaise: 0,
		restaurantId: null,
		expiresOn: '2027-12-31',
		...overrides
	};
}

const context = (overrides: Partial<Parameters<typeof evaluateCoupon>[0]> = {}) => ({
	itemTotalPaise: 50000,
	restaurantId: 'dosa-darbar',
	usedCoupons: [] as string[],
	orderCount: 0,
	now: NOW,
	...overrides
});

describe('isExpired', () => {
	it('keeps a coupon alive through the whole expiry day', () => {
		const c = coupon({ expiresOn: '2026-04-29' });
		expect(isExpired(c, new Date(2026, 3, 29, 23, 59, 0).getTime())).toBe(false);
		expect(isExpired(c, new Date(2026, 3, 30, 0, 1, 0).getTime())).toBe(true);
	});
});

describe('evaluateCoupon', () => {
	it('applies a flat discount', () => {
		const result = evaluateCoupon({ ...context(), coupon: coupon({ flatPaise: 5000 }) });
		expect(result).toEqual({ ok: true, discountPaise: 5000, waiveDelivery: false });
	});

	it('applies a percentage discount and respects the cap', () => {
		const capped = evaluateCoupon({
			...context({ itemTotalPaise: 100000 }),
			coupon: coupon({ kind: 'percent', percent: 50, maxDiscountPaise: 10000 })
		});
		expect(capped).toMatchObject({ ok: true, discountPaise: 10000 });

		const uncapped = evaluateCoupon({
			...context({ itemTotalPaise: 10000 }),
			coupon: coupon({ kind: 'percent', percent: 50, maxDiscountPaise: 10000 })
		});
		expect(uncapped).toMatchObject({ ok: true, discountPaise: 5000 });
	});

	it('never discounts more than the item total', () => {
		const result = evaluateCoupon({
			...context({ itemTotalPaise: 3000 }),
			coupon: coupon({ flatPaise: 10000 })
		});
		expect(result).toMatchObject({ ok: true, discountPaise: 3000 });
	});

	it('waives delivery without touching the item total', () => {
		const result = evaluateCoupon({ ...context(), coupon: coupon({ kind: 'free-delivery' }) });
		expect(result).toEqual({ ok: true, discountPaise: 0, waiveDelivery: true });
	});

	it('rejects an expired coupon with the date in the message', () => {
		const result = evaluateCoupon({
			...context(),
			coupon: coupon({ code: 'MONSOON25', expiresOn: '2024-09-30' })
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('MONSOON25 expired on 30 Sep 2024.');
	});

	it('rejects a coupon for a different restaurant', () => {
		const result = evaluateCoupon({
			...context({ restaurantId: 'napoli-nook' }),
			coupon: coupon({ code: 'BROS40', restaurantId: 'biryani-bros' })
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('not this one');
	});

	it('accepts a restaurant-specific coupon at its own restaurant', () => {
		const result = evaluateCoupon({
			...context({ restaurantId: 'biryani-bros' }),
			coupon: coupon({ code: 'BROS40', restaurantId: 'biryani-bros', flatPaise: 4000 })
		});
		expect(result).toMatchObject({ ok: true, discountPaise: 4000 });
	});

	it('rejects a below-minimum cart and says how much more is needed', () => {
		const result = evaluateCoupon({
			...context({ itemTotalPaise: 15000 }),
			coupon: coupon({ code: 'SAVE20', minOrderPaise: 29900 })
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('₹149');
			expect(result.reason).toContain('minimum ₹299');
		}
	});

	it('rejects an already-used once-per-user coupon', () => {
		const result = evaluateCoupon({
			...context({ usedCoupons: ['WELCOME50'] }),
			coupon: coupon({ code: 'WELCOME50', oncePerUser: true })
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('You have already used WELCOME50.');
	});

	it('rejects a first-order coupon once an order exists', () => {
		const result = evaluateCoupon({
			...context({ orderCount: 2 }),
			coupon: coupon({ code: 'WELCOME50', firstOrderOnly: true })
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('first FoodRush order');
	});

	it('rejects any coupon on an empty cart', () => {
		const result = evaluateCoupon({ ...context({ itemTotalPaise: 0 }), coupon: coupon() });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('Add something to your cart');
	});
});

describe('rankCoupons', () => {
	it('puts eligible coupons first, best saving first, and keeps reasons for the rest', () => {
		const coupons = [
			coupon({ code: 'SMALL', flatPaise: 2000 }),
			coupon({ code: 'BIG', flatPaise: 8000 }),
			coupon({ code: 'DEAD', expiresOn: '2020-01-01' }),
			coupon({ code: 'DEL', kind: 'free-delivery' })
		];
		const ranked = rankCoupons(coupons, context({ itemTotalPaise: 60000 }), 4900);

		expect(ranked.map((offer) => offer.coupon.code)).toEqual(['BIG', 'DEL', 'SMALL', 'DEAD']);
		expect(ranked[0].savingsPaise).toBe(8000);
		expect(ranked[1].savingsPaise).toBe(4900);
		expect(ranked[3].evaluation.ok).toBe(false);
	});

	it('is deterministic when two coupons save the same amount', () => {
		const coupons = [coupon({ code: 'BBB', flatPaise: 5000 }), coupon({ code: 'AAA', flatPaise: 5000 })];
		const ranked = rankCoupons(coupons, context(), 0);
		expect(ranked.map((offer) => offer.coupon.code)).toEqual(['AAA', 'BBB']);
	});
});

describe('bestCoupon', () => {
	it('picks the highest-saving applicable coupon', () => {
		const coupons = [
			coupon({ code: 'FLAT20', flatPaise: 2000 }),
			coupon({ code: 'PCT50', kind: 'percent', percent: 50, maxDiscountPaise: 10000 })
		];
		expect(bestCoupon(coupons, context({ itemTotalPaise: 60000 }), 4900)?.code).toBe('PCT50');
	});

	it('returns null when nothing applies', () => {
		const coupons = [coupon({ code: 'DEAD', expiresOn: '2020-01-01' })];
		expect(bestCoupon(coupons, context(), 4900)).toBeNull();
	});
});
