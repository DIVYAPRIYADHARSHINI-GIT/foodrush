/**
 * THE pricing engine. One function, used by the cart, the sticky bar, checkout, the
 * receipt, order history and reorder.
 *
 * The brief's hard requirement: "Cart total, delivery fee, taxes, discount and grand total
 * must come from ONE pricing function used everywhere, so numbers can never disagree
 * between screens." `priceCart()` is that function. No view is allowed to add up line
 * prices by itself - they all call `linePrice()`/`priceCart()` from here.
 *
 * Order of operations matters and is deliberate:
 *   1. item total   = sum(line base + options) * quantity
 *   2. packaging    = per-line charge, capped (restaurants charge per container)
 *   3. delivery fee = distance-based slabs
 *   4. discount     = coupon applied to the ITEM TOTAL only (never to fees or taxes),
 *                     so a coupon can never discount the delivery fee twice or make the
 *                     government's share smaller than it should be
 *   5. taxes        = 5% GST on (item total - discount) + 18% on the delivery fee,
 *                     which is how food aggregator bills actually split it
 *   6. tip          = added last, never taxed, never discounted
 *   7. total        = item + packaging + delivery + tax - discount + tip, floored at 0
 */

import type { Cart, CartLine, Coupon, Dish, PriceBreakdown, Restaurant } from '../types';
import { clampPaise, percentOf } from './money';
import { evaluateCoupon } from './coupons';

/** GST on prepared food, as it appears on a real aggregator bill. */
export const FOOD_GST_PERCENT = 5;
/** GST on the delivery service component. */
export const DELIVERY_GST_PERCENT = 18;
/** Packaging charge per cart line, and the cap so a 20-line order is not punished. */
export const PACKAGING_PER_LINE_PAISE = 700;
export const PACKAGING_CAP_PAISE = 3500;
/** Hard ceiling on a single line's quantity, matched by the stepper UI. */
export const MAX_LINE_QUANTITY = 20;

/** Tip presets offered in the cart, in paise. */
export const TIP_PRESETS_PAISE = [0, 2000, 3000, 5000];

/**
 * Distance-based delivery fee slabs.
 *
 * Flat under 2 km, then a per-km step. Kept as data so the receipt can explain the fee
 * and the tests can assert each boundary rather than a magic number.
 */
export const DELIVERY_SLABS: { upToKm: number; feePaise: number }[] = [
	{ upToKm: 2, feePaise: 1900 },
	{ upToKm: 4, feePaise: 2900 },
	{ upToKm: 7, feePaise: 3900 },
	{ upToKm: 10, feePaise: 4900 }
];
/** Beyond the last slab, every extra km (rounded up) adds this much. */
export const DELIVERY_PER_EXTRA_KM_PAISE = 900;

export function deliveryFeeFor(distanceKm: number): number {
	const distance = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
	for (const slab of DELIVERY_SLABS) {
		if (distance <= slab.upToKm) return slab.feePaise;
	}
	const last = DELIVERY_SLABS[DELIVERY_SLABS.length - 1];
	const extraKm = Math.ceil(distance - last.upToKm);
	return last.feePaise + extraKm * DELIVERY_PER_EXTRA_KM_PAISE;
}

/** Unit price of one line: dish base plus every selected option delta. */
export function unitPrice(line: Pick<CartLine, 'basePricePaise' | 'options'>): number {
	const addons = line.options.reduce((sum, option) => sum + (option.deltaPaise || 0), 0);
	return clampPaise(line.basePricePaise + addons);
}

/** Total for a line including quantity. Quantity is clamped to [0, MAX_LINE_QUANTITY]. */
export function linePrice(line: Pick<CartLine, 'basePricePaise' | 'options' | 'quantity'>): number {
	const quantity = Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.trunc(line.quantity || 0)));
	return unitPrice(line) * quantity;
}

export function itemTotal(lines: CartLine[]): number {
	return lines.reduce((sum, line) => sum + linePrice(line), 0);
}

export function packagingFor(lines: CartLine[]): number {
	const billable = lines.filter((line) => line.quantity > 0).length;
	return Math.min(PACKAGING_CAP_PAISE, billable * PACKAGING_PER_LINE_PAISE);
}

export interface PriceInput {
	cart: Cart;
	restaurant: Restaurant | null;
	coupon: Coupon | null;
	/** Codes already redeemed, for once-per-user coupons. */
	usedCoupons: string[];
	/** Count of delivered/placed orders, for first-order-only coupons. */
	orderCount: number;
	/** Override the restaurant distance (checkout uses the chosen address's area). */
	distanceKm?: number;
	/** Reference time for expiry checks. Defaults to now. */
	now?: number;
}

export interface PriceResult extends PriceBreakdown {
	/** Null when no coupon is applied or the applied coupon is not valid for this cart. */
	appliedCode: string | null;
	/** Human-readable reason the coupon did not apply, for the auto-remove message. */
	couponError: string | null;
}

/**
 * Price a cart. PURE: no store access, no clock access beyond `now`, no side effects.
 *
 * Returning the coupon error alongside the totals is what lets the cart auto-remove a
 * coupon that became invalid (cart changed below the minimum, say) and tell the user why,
 * using exactly the same numbers it is about to display.
 */
export function priceCart(input: PriceInput): PriceResult {
	const { cart, restaurant, coupon, usedCoupons, orderCount } = input;
	const lines = cart.lines.filter((line) => line.quantity > 0);

	const items = itemTotal(lines);
	const packaging = packagingFor(lines);
	const distanceKm = input.distanceKm ?? restaurant?.distanceKm ?? 0;
	const baseDeliveryFee = lines.length === 0 ? 0 : deliveryFeeFor(distanceKm);

	// Evaluate the coupon against THIS cart. An invalid coupon contributes nothing and
	// surfaces a reason instead of silently discounting.
	const evaluation = coupon
		? evaluateCoupon({
				coupon,
				itemTotalPaise: items,
				restaurantId: cart.restaurantId,
				usedCoupons,
				orderCount,
				now: input.now ?? Date.now()
			})
		: null;

	const couponValid = evaluation?.ok === true;
	// A percentage/flat discount applies to the item total only, and can never exceed it.
	const discount = couponValid ? Math.min(items, evaluation.discountPaise) : 0;
	const deliveryFeeWaived = couponValid && evaluation.waiveDelivery;
	const deliveryFee = deliveryFeeWaived ? 0 : baseDeliveryFee;

	const taxableFood = clampPaise(items - discount);
	const tax = percentOf(taxableFood, FOOD_GST_PERCENT) + percentOf(deliveryFee, DELIVERY_GST_PERCENT);

	const tip = clampPaise(cart.tipPaise);
	const total = clampPaise(items + packaging + deliveryFee + tax - discount + tip);

	return {
		itemTotalPaise: items,
		packagingPaise: packaging,
		deliveryFeePaise: deliveryFee,
		deliveryFeeWaived,
		taxPaise: tax,
		discountPaise: discount,
		tipPaise: tip,
		totalPaise: total,
		distanceKm,
		appliedCode: couponValid ? coupon?.code ?? null : null,
		couponError: evaluation && !evaluation.ok ? evaluation.reason : null
	};
}

/** Total savings headline shown on the cart ("You saved ₹x on this order"). */
export function savingsOf(price: PriceBreakdown, baseDeliveryFeePaise: number): number {
	return price.discountPaise + (price.deliveryFeeWaived ? baseDeliveryFeePaise : 0);
}

/**
 * Compare a cart line against the live catalog.
 *
 * Used by the cart and by reorder: a dish can be withdrawn from the menu, go out of stock,
 * or change price between being added and being ordered. The brief requires all three to
 * be surfaced rather than silently charged.
 */
export type LineIssue =
	| { kind: 'missing'; line: CartLine }
	| { kind: 'unavailable'; line: CartLine }
	| { kind: 'price-changed'; line: CartLine; fromPaise: number; toPaise: number };

export function findLineIssues(
	lines: CartLine[],
	dishes: Map<string, Dish>,
	availability: Record<string, boolean>
): LineIssue[] {
	const issues: LineIssue[] = [];
	for (const line of lines) {
		const dish = dishes.get(line.dishId);
		if (!dish) {
			issues.push({ kind: 'missing', line });
			continue;
		}
		const available = availability[dish.id] ?? dish.available;
		if (!available) {
			issues.push({ kind: 'unavailable', line });
			continue;
		}
		if (dish.pricePaise !== line.basePricePaise) {
			issues.push({
				kind: 'price-changed',
				line,
				fromPaise: line.basePricePaise,
				toPaise: dish.pricePaise
			});
		}
	}
	return issues;
}
