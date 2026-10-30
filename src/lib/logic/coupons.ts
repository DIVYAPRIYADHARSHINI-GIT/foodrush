/**
 * Coupon rules.
 *
 * Every rejection returns a plain-language `reason` the UI shows verbatim, because the
 * brief asks for clear errors (expired, minimum order not met, already used, not
 * applicable to this restaurant) rather than a generic "invalid coupon".
 *
 * NO STACKING: FoodRush applies at most one coupon per order. That is a product decision,
 * not an oversight - stacking a free-delivery coupon with a percentage coupon is where
 * double-discount bugs live. `applyBest` picks the single best coupon when several are
 * eligible.
 */

import type { Coupon } from '../types';
import { formatPaise, percentOf } from './money';

export interface CouponContext {
	coupon: Coupon;
	itemTotalPaise: number;
	restaurantId: string | null;
	usedCoupons: string[];
	orderCount: number;
	/** Epoch ms. */
	now: number;
}

export type CouponEvaluation =
	| { ok: true; discountPaise: number; waiveDelivery: boolean }
	| { ok: false; reason: string; discountPaise: 0; waiveDelivery: false };

const reject = (reason: string): CouponEvaluation => ({
	ok: false,
	reason,
	discountPaise: 0,
	waiveDelivery: false
});

/** A coupon expires at the END of `expiresOn`, local time. */
export function isExpired(coupon: Coupon, now: number): boolean {
	const [year, month, day] = coupon.expiresOn.split('-').map(Number);
	if (!year || !month || !day) return false;
	// End of the expiry day in local time.
	const deadline = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
	return now > deadline;
}

export function evaluateCoupon(context: CouponContext): CouponEvaluation {
	const { coupon, itemTotalPaise, restaurantId, usedCoupons, orderCount, now } = context;

	if (itemTotalPaise <= 0) {
		return reject('Add something to your cart before applying a coupon.');
	}
	if (isExpired(coupon, now)) {
		return reject(`${coupon.code} expired on ${formatDate(coupon.expiresOn)}.`);
	}
	if (coupon.restaurantId && coupon.restaurantId !== restaurantId) {
		return reject(`${coupon.code} is only valid at selected restaurants, not this one.`);
	}
	if (coupon.oncePerUser && usedCoupons.includes(coupon.code)) {
		return reject(`You have already used ${coupon.code}.`);
	}
	if (coupon.firstOrderOnly && orderCount > 0) {
		return reject(`${coupon.code} is for your first FoodRush order only.`);
	}
	if (itemTotalPaise < coupon.minOrderPaise) {
		const short = coupon.minOrderPaise - itemTotalPaise;
		return reject(
			`Add items worth ${formatPaise(short)} more to use ${coupon.code} (minimum ${formatPaise(coupon.minOrderPaise)}).`
		);
	}

	if (coupon.kind === 'free-delivery') {
		return { ok: true, discountPaise: 0, waiveDelivery: true };
	}
	if (coupon.kind === 'flat') {
		const flat = Math.min(coupon.flatPaise ?? 0, itemTotalPaise);
		return { ok: true, discountPaise: flat, waiveDelivery: false };
	}
	// Percentage, with the cap the brief calls "discount caps".
	const raw = percentOf(itemTotalPaise, coupon.percent ?? 0);
	const capped = coupon.maxDiscountPaise ? Math.min(raw, coupon.maxDiscountPaise) : raw;
	return { ok: true, discountPaise: Math.min(capped, itemTotalPaise), waiveDelivery: false };
}

/** "2024-09-30" -> "30 Sep 2024", for the expiry message. */
export function formatDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	if (!year || !month || !day) return iso;
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${day} ${months[month - 1]} ${year}`;
}

export interface CouponOffer {
	coupon: Coupon;
	evaluation: CouponEvaluation;
	/** What the user would save, used to sort the offers list and pick the best. */
	savingsPaise: number;
}

/**
 * Rank every coupon for the current cart.
 *
 * Eligible coupons come first (best saving first), then ineligible ones with their reason,
 * so the "available offers" sheet can show the whole wallet honestly instead of hiding
 * coupons the user is two hundred rupees away from.
 */
export function rankCoupons(
	coupons: Coupon[],
	context: Omit<CouponContext, 'coupon'>,
	deliveryFeePaise: number
): CouponOffer[] {
	const offers = coupons.map((coupon) => {
		const evaluation = evaluateCoupon({ ...context, coupon });
		const savingsPaise = evaluation.ok
			? evaluation.discountPaise + (evaluation.waiveDelivery ? deliveryFeePaise : 0)
			: 0;
		return { coupon, evaluation, savingsPaise };
	});

	return offers.sort((a, b) => {
		if (a.evaluation.ok !== b.evaluation.ok) return a.evaluation.ok ? -1 : 1;
		if (b.savingsPaise !== a.savingsPaise) return b.savingsPaise - a.savingsPaise;
		return a.coupon.code.localeCompare(b.coupon.code);
	});
}

/** The single best applicable coupon, or null. Used by "apply best offer". */
export function bestCoupon(
	coupons: Coupon[],
	context: Omit<CouponContext, 'coupon'>,
	deliveryFeePaise: number
): Coupon | null {
	const ranked = rankCoupons(coupons, context, deliveryFeePaise);
	const first = ranked[0];
	return first && first.evaluation.ok && first.savingsPaise > 0 ? first.coupon : null;
}
