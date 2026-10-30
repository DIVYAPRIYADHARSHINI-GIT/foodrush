/**
 * Order lifecycle: status progression, ETA, cancellation window, reviews.
 *
 * The simulated delivery is driven by ELAPSED TIME, not by a counter that ticks. The
 * status is a pure function of `now - placedAt`, so:
 *   - refreshing during tracking resumes exactly where it was (the brief requires this),
 *   - a throttled background tab cannot fall behind,
 *   - and the status can never go backwards, because it is derived from a monotonic clock
 *     and clamped against the highest status already recorded in the order's timeline.
 */

import type { Address, DeliveryPartner, Order, OrderStatus, Review } from '../types';
import { STATUS_RANK, TRACKED_STATUSES } from '../types';

/**
 * Seconds after placing at which each status is reached, for the demo simulation.
 *
 * Deliberately short so the whole flow is watchable in a demo (and in the e2e probes)
 * without waiting 30 real minutes. The displayed ETA still uses the restaurant's real
 * delivery estimate so the receipt reads plausibly.
 */
export const STATUS_SCHEDULE_SECONDS: { status: OrderStatus; at: number }[] = [
	{ status: 'placed', at: 0 },
	{ status: 'confirmed', at: 12 },
	{ status: 'preparing', at: 30 },
	{ status: 'out-for-delivery', at: 75 },
	{ status: 'delivered', at: 150 }
];

/** Cancelling is allowed until the kitchen starts cooking. */
export const CANCELLABLE_STATUSES: OrderStatus[] = ['placed', 'confirmed'];

export const STATUS_COPY: Record<OrderStatus, { title: string; detail: string }> = {
	placed: { title: 'Order placed', detail: 'We have sent your order to the restaurant.' },
	confirmed: { title: 'Confirmed', detail: 'The restaurant accepted your order.' },
	preparing: { title: 'Preparing', detail: 'Your food is on the stove right now.' },
	'out-for-delivery': { title: 'Out for delivery', detail: 'Your rider has picked up the order.' },
	delivered: { title: 'Delivered', detail: 'Enjoy your meal!' },
	cancelled: { title: 'Cancelled', detail: 'This order was cancelled.' }
};

/**
 * Status implied by the clock.
 *
 * `floor` is the highest status already persisted on the order; the result can never be
 * lower than it. A cancelled order is terminal and returns immediately.
 */
export function statusAt(order: Order, now: number): OrderStatus {
	if (order.status === 'cancelled') return 'cancelled';
	if (order.ownerTouched && order.status === 'delivered') return 'delivered';

	const elapsedSeconds = Math.max(0, (now - order.placedAt) / 1000);
	let fromClock: OrderStatus = 'placed';
	for (const step of STATUS_SCHEDULE_SECONDS) {
		if (elapsedSeconds >= step.at) fromClock = step.status;
	}

	// Never go backwards: take whichever is further along, the clock or the record.
	const recorded = order.status;
	return STATUS_RANK[fromClock] >= STATUS_RANK[recorded] ? fromClock : recorded;
}

/** Fraction of the way through the delivery, 0..1, for the progress bar and the rider. */
export function progressAt(order: Order, now: number): number {
	if (order.status === 'cancelled') return 0;
	const last = STATUS_SCHEDULE_SECONDS[STATUS_SCHEDULE_SECONDS.length - 1];
	const elapsed = Math.max(0, (now - order.placedAt) / 1000);
	return Math.min(1, elapsed / last.at);
}

/** Seconds remaining until the ETA, floored at 0. */
export function etaSecondsLeft(order: Order, now: number): number {
	return Math.max(0, Math.round((order.etaAt - now) / 1000));
}

export function canCancel(order: Order, now: number): boolean {
	return CANCELLABLE_STATUSES.includes(statusAt(order, now));
}

/** Why cancelling is no longer possible, shown in place of the button. */
export function cancelBlockedReason(order: Order, now: number): string {
	const status = statusAt(order, now);
	if (status === 'cancelled') return 'This order is already cancelled.';
	if (status === 'delivered') return 'This order has been delivered.';
	if (status === 'out-for-delivery') return 'Your rider already has the food - it is too late to cancel.';
	return 'The restaurant has started cooking, so this order can no longer be cancelled.';
}

/** Timeline entries for every status reached so far, with the ones ahead marked pending. */
export function timelineFor(order: Order, now: number): { status: OrderStatus; at: number | null; done: boolean }[] {
	const current = statusAt(order, now);
	if (current === 'cancelled') {
		const reached = order.timeline.filter((entry) => entry.status !== 'cancelled');
		return [
			...reached.map((entry) => ({ status: entry.status, at: entry.at, done: true })),
			{ status: 'cancelled' as OrderStatus, at: order.timeline.find((e) => e.status === 'cancelled')?.at ?? null, done: true }
		];
	}
	return TRACKED_STATUSES.map((status) => {
		const recorded = order.timeline.find((entry) => entry.status === status);
		const done = STATUS_RANK[status] <= STATUS_RANK[current];
		const scheduled = STATUS_SCHEDULE_SECONDS.find((entry) => entry.status === status);
		return {
			status,
			at: recorded?.at ?? (done && scheduled ? order.placedAt + scheduled.at * 1000 : null),
			done
		};
	});
}

/** Delivery partners, assigned deterministically from the order id. */
const PARTNERS: DeliveryPartner[] = [
	{ name: 'Ramesh Kumar', rating: 4.8, vehicle: 'KA 01 AB 4412', phone: '+91 98450 11223' },
	{ name: 'Sundar Rajan', rating: 4.9, vehicle: 'KA 05 CJ 7781', phone: '+91 98450 44556' },
	{ name: 'Imran Shaikh', rating: 4.7, vehicle: 'KA 03 MN 2098', phone: '+91 98450 77889' },
	{ name: 'Lakshmi Devi', rating: 4.9, vehicle: 'KA 02 EL 5516', phone: '+91 98450 33445' },
	{ name: 'Vinod Patil', rating: 4.6, vehicle: 'KA 51 HG 3390', phone: '+91 98450 66778' }
];

export function partnerFor(orderId: string): DeliveryPartner {
	let hash = 0;
	for (let i = 0; i < orderId.length; i += 1) hash = (hash * 31 + orderId.charCodeAt(i)) >>> 0;
	return PARTNERS[hash % PARTNERS.length];
}

/** Human order reference, e.g. "FR-7K2M9". */
export function orderReference(orderId: string): string {
	return `FR-${orderId.slice(-5).toUpperCase()}`;
}

/** Scheduling slots offered at checkout, generated from the current time. */
export function scheduleSlots(now: number): { id: string; label: string }[] {
	const slots: { id: string; label: string }[] = [];
	const start = new Date(now);
	start.setMinutes(start.getMinutes() + 45, 0, 0);
	// Round up to the next half hour.
	const minutes = start.getMinutes();
	start.setMinutes(minutes < 30 ? 30 : 60, 0, 0);

	for (let i = 0; i < 6; i += 1) {
		const slotStart = new Date(start.getTime() + i * 30 * 60 * 1000);
		const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
		slots.push({
			id: slotStart.toISOString(),
			label: `${formatClock(slotStart)} - ${formatClock(slotEnd)}`
		});
	}
	return slots;
}

export function formatClock(date: Date): string {
	let hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const suffix = hours >= 12 ? 'pm' : 'am';
	hours = hours % 12 || 12;
	return `${hours}:${minutes} ${suffix}`;
}

/** "Today, 7:45 pm" / "Yesterday, 1:10 pm" / "24 Oct, 8:05 pm" for history rows. */
export function formatWhen(at: number, now: number = Date.now()): string {
	const date = new Date(at);
	const today = new Date(now);
	const sameDay = date.toDateString() === today.toDateString();
	const yesterday = new Date(now - 86_400_000).toDateString() === date.toDateString();
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const dayLabel = sameDay
		? 'Today'
		: yesterday
			? 'Yesterday'
			: `${date.getDate()} ${months[date.getMonth()]}`;
	return `${dayLabel}, ${formatClock(date)}`;
}

/** mm:ss countdown for the tracking ETA. */
export function formatCountdown(seconds: number): string {
	const safe = Math.max(0, Math.round(seconds));
	const mins = Math.floor(safe / 60);
	const secs = safe % 60;
	return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Review tags offered after delivery. */
export const REVIEW_TAGS = [
	'Tasty',
	'Fresh',
	'Hot on arrival',
	'Good packaging',
	'Late',
	'Spill in transit',
	'Value for money',
	'Portion too small'
];

export interface RatingBreakdown {
	average: number;
	count: number;
	/** Count per star, index 0 = 1 star. */
	distribution: number[];
	/**
	 * Unrounded mean. `average` is rounded to one decimal for display (a restaurant page
	 * showing "4.43" would look broken), but one new review on a restaurant with thousands
	 * of ratings moves the mean by less than 0.05 and would vanish in that rounding. Tests
	 * and "your review moved the average" copy use this value.
	 */
	exactAverage: number;
}

/**
 * Blend the catalog's baseline rating with the user's own reviews.
 *
 * The catalog rating stands in for the thousands of ratings a real restaurant already has;
 * a new review moves the average by a realistic (small) amount rather than overwriting it,
 * while still being visibly reflected - which is what "average updated from new reviews"
 * needs to mean to be believable.
 */
export function ratingBreakdown(
	baseRating: number,
	baseCount: number,
	reviews: Review[]
): RatingBreakdown {
	const distribution = [0, 0, 0, 0, 0];
	// Spread the baseline count over the stars in a shape that produces `baseRating`.
	const shape = shapeFor(baseRating);
	for (let star = 1; star <= 5; star += 1) {
		distribution[star - 1] = Math.round(baseCount * shape[star - 1]);
	}
	for (const review of reviews) {
		const star = Math.min(5, Math.max(1, Math.round(review.foodRating)));
		distribution[star - 1] += 1;
	}
	const count = distribution.reduce((sum, value) => sum + value, 0);
	const weighted = distribution.reduce((sum, value, index) => sum + value * (index + 1), 0);
	return {
		average: count === 0 ? 0 : Math.round((weighted / count) * 10) / 10,
		count,
		distribution,
		exactAverage: count === 0 ? 0 : weighted / count
	};
}

/**
 * Plausible star distribution whose mean is EXACTLY the given average.
 *
 * A pure "closeness to the average" bell shape looks right but does not reproduce the
 * average it was built from (the 1..5 bounds truncate it asymmetrically), which would make
 * a 4.4-star restaurant render as 4.2. So the bell is mixed with a point mass at the
 * nearest extreme by the factor that corrects the mean in closed form:
 *
 *     mean((1-t)*bell + t*anchor) = target  =>  t = (target - mean(bell)) / (anchor - mean(bell))
 *
 * That keeps the bars looking like real review spread while guaranteeing the headline
 * number matches the catalog.
 */
function shapeFor(average: number): number[] {
	const target = Math.min(5, Math.max(1, average));

	const bell = [1, 2, 3, 4, 5].map((star) => {
		const distance = Math.abs(star - target);
		return Math.exp(-distance * 1.35) * (star >= 4 ? 1.25 : 1);
	});
	const bellTotal = bell.reduce((sum, value) => sum + value, 0);
	const normalised = bell.map((value) => value / bellTotal);
	const bellMean = normalised.reduce((sum, value, index) => sum + value * (index + 1), 0);

	const difference = target - bellMean;
	if (Math.abs(difference) < 1e-9) return normalised;

	// Pull towards 5 stars when the bell reads low, towards 1 star when it reads high.
	const anchorStar = difference > 0 ? 5 : 1;
	const t = difference / (anchorStar - bellMean);
	const clampedT = Math.min(0.95, Math.max(0, t));

	return normalised.map((value, index) =>
		index + 1 === anchorStar ? value * (1 - clampedT) + clampedT : value * (1 - clampedT)
	);
}

/** Validate an Indian 6-digit pin code (cannot start with 0). */
export function isValidPin(pin: string): boolean {
	return /^[1-9]\d{5}$/.test(pin.trim());
}

/** Validate an Indian 10-digit mobile number, tolerating +91 / 0 prefixes and spaces. */
export function isValidPhone(phone: string): boolean {
	const digits = phone.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
	return /^[6-9]\d{9}$/.test(digits);
}

export type AddressErrors = Partial<Record<keyof Address, string>>;

/** Address validation shared by the add and edit forms. */
export function validateAddress(address: Partial<Address>): AddressErrors {
	const errors: AddressErrors = {};
	if (!address.name?.trim()) errors.name = 'Who is this order for?';
	if (!address.phone?.trim()) errors.phone = 'We need a number for the rider.';
	else if (!isValidPhone(address.phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
	if (!address.line1?.trim()) errors.line1 = 'Flat / house / building is required.';
	if (!address.area?.trim()) errors.area = 'Area or locality is required.';
	if (!address.city?.trim()) errors.city = 'City is required.';
	if (!address.pin?.trim()) errors.pin = 'Pin code is required.';
	else if (!isValidPin(address.pin)) errors.pin = 'Enter a valid 6-digit pin code.';
	return errors;
}

/** Order stats for the profile page. */
export function orderStats(orders: Order[]): {
	delivered: number;
	cancelled: number;
	spentPaise: number;
	favouriteRestaurant: string | null;
} {
	const delivered = orders.filter((order) => order.status === 'delivered');
	const counts = new Map<string, number>();
	for (const order of delivered) {
		counts.set(order.restaurantName, (counts.get(order.restaurantName) ?? 0) + 1);
	}
	let favouriteRestaurant: string | null = null;
	let best = 0;
	for (const [name, count] of counts) {
		if (count > best) {
			best = count;
			favouriteRestaurant = name;
		}
	}
	return {
		delivered: delivered.length,
		cancelled: orders.filter((order) => order.status === 'cancelled').length,
		spentPaise: delivered.reduce((sum, order) => sum + order.price.totalPaise, 0),
		favouriteRestaurant
	};
}
