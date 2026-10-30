import { describe, expect, it } from 'vitest';
import {
	CANCELLABLE_STATUSES,
	STATUS_SCHEDULE_SECONDS,
	canCancel,
	cancelBlockedReason,
	etaSecondsLeft,
	formatCountdown,
	formatWhen,
	isValidPhone,
	isValidPin,
	orderReference,
	orderStats,
	partnerFor,
	progressAt,
	ratingBreakdown,
	scheduleSlots,
	statusAt,
	timelineFor,
	validateAddress
} from './orders';
import { STATUS_RANK } from '../types';
import type { Address, Order, Review } from '../types';

const PLACED_AT = new Date(2026, 3, 29, 13, 0, 0).getTime();

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: 'order-abc123',
		restaurantId: 'dosa-darbar',
		restaurantName: 'Dosa Darbar',
		lines: [],
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
			itemTotalPaise: 14900,
			packagingPaise: 700,
			deliveryFeePaise: 1900,
			deliveryFeeWaived: false,
			taxPaise: 1087,
			discountPaise: 0,
			tipPaise: 0,
			totalPaise: 18587,
			distanceKm: 1.8
		},
		status: 'placed',
		placedAt: PLACED_AT,
		timeline: [{ status: 'placed', at: PLACED_AT }],
		etaAt: PLACED_AT + 20 * 60 * 1000,
		scheduledFor: null,
		partner: partnerFor('order-abc123'),
		cancelledReason: null,
		...overrides
	};
}

const at = (seconds: number) => PLACED_AT + seconds * 1000;

describe('statusAt', () => {
	it('derives the status from elapsed time', () => {
		const o = order();
		expect(statusAt(o, at(0))).toBe('placed');
		expect(statusAt(o, at(11))).toBe('placed');
		expect(statusAt(o, at(12))).toBe('confirmed');
		expect(statusAt(o, at(30))).toBe('preparing');
		expect(statusAt(o, at(75))).toBe('out-for-delivery');
		expect(statusAt(o, at(150))).toBe('delivered');
		expect(statusAt(o, at(10_000))).toBe('delivered');
	});

	it('resumes correctly after a refresh mid-delivery', () => {
		// A freshly-loaded order still carries status 'placed' from storage; the clock wins.
		const fromStorage = order({ status: 'placed' });
		expect(statusAt(fromStorage, at(80))).toBe('out-for-delivery');
	});

	it('never goes backwards from a recorded status', () => {
		// Clock says 'placed' but the record says the owner already confirmed it.
		const o = order({ status: 'preparing' });
		expect(statusAt(o, at(0))).toBe('preparing');
		expect(STATUS_RANK[statusAt(o, at(5))]).toBeGreaterThanOrEqual(STATUS_RANK.preparing);
	});

	it('keeps a cancelled order cancelled forever', () => {
		const o = order({ status: 'cancelled', cancelledReason: 'Changed my mind' });
		expect(statusAt(o, at(10_000))).toBe('cancelled');
	});

	it('is monotonic across a sweep of timestamps', () => {
		const o = order();
		let previous = -1;
		for (let seconds = 0; seconds <= 200; seconds += 1) {
			const rank = STATUS_RANK[statusAt(o, at(seconds))];
			expect(rank).toBeGreaterThanOrEqual(previous);
			previous = rank;
		}
	});

	it('tolerates a clock that jumped backwards', () => {
		const o = order({ status: 'preparing' });
		expect(statusAt(o, PLACED_AT - 60_000)).toBe('preparing');
	});
});

describe('progressAt', () => {
	it('runs from 0 to 1 and clamps', () => {
		const o = order();
		expect(progressAt(o, at(0))).toBe(0);
		expect(progressAt(o, at(75))).toBeCloseTo(0.5, 2);
		expect(progressAt(o, at(150))).toBe(1);
		expect(progressAt(o, at(500))).toBe(1);
	});
});

describe('etaSecondsLeft / formatCountdown', () => {
	it('counts down and floors at zero', () => {
		const o = order({ etaAt: at(120) });
		expect(etaSecondsLeft(o, at(0))).toBe(120);
		expect(etaSecondsLeft(o, at(119))).toBe(1);
		expect(etaSecondsLeft(o, at(500))).toBe(0);
	});

	it('formats mm:ss', () => {
		expect(formatCountdown(0)).toBe('0:00');
		expect(formatCountdown(65)).toBe('1:05');
		expect(formatCountdown(600)).toBe('10:00');
		expect(formatCountdown(-5)).toBe('0:00');
	});
});

describe('cancellation window', () => {
	it('allows cancelling while placed or confirmed', () => {
		expect(CANCELLABLE_STATUSES).toEqual(['placed', 'confirmed']);
		const o = order();
		expect(canCancel(o, at(0))).toBe(true);
		expect(canCancel(o, at(20))).toBe(true);
	});

	it('blocks cancelling once the kitchen starts', () => {
		const o = order();
		expect(canCancel(o, at(30))).toBe(false);
		expect(cancelBlockedReason(o, at(30))).toContain('started cooking');
		expect(cancelBlockedReason(o, at(80))).toContain('rider already has the food');
		expect(cancelBlockedReason(o, at(200))).toContain('delivered');
	});

	it('explains an already-cancelled order', () => {
		const o = order({ status: 'cancelled' });
		expect(canCancel(o, at(0))).toBe(false);
		expect(cancelBlockedReason(o, at(0))).toContain('already cancelled');
	});
});

describe('timelineFor', () => {
	it('marks reached steps done and future ones pending', () => {
		const steps = timelineFor(order(), at(35));
		expect(steps.map((step) => step.done)).toEqual([true, true, true, false, false]);
		expect(steps[0].at).toBe(PLACED_AT);
		expect(steps[4].at).toBeNull();
	});

	it('ends at a cancelled step and hides the rest', () => {
		const cancelledAt = at(20);
		const o = order({
			status: 'cancelled',
			timeline: [
				{ status: 'placed', at: PLACED_AT },
				{ status: 'confirmed', at: at(12) },
				{ status: 'cancelled', at: cancelledAt }
			]
		});
		const steps = timelineFor(o, at(500));
		expect(steps.map((step) => step.status)).toEqual(['placed', 'confirmed', 'cancelled']);
		expect(steps[2].at).toBe(cancelledAt);
	});

	it('covers every scheduled status', () => {
		expect(STATUS_SCHEDULE_SECONDS.map((step) => step.status)).toEqual([
			'placed',
			'confirmed',
			'preparing',
			'out-for-delivery',
			'delivered'
		]);
	});
});

describe('partnerFor / orderReference', () => {
	it('assigns a stable partner per order id', () => {
		expect(partnerFor('order-1')).toEqual(partnerFor('order-1'));
		expect(partnerFor('order-1').name).toBeTruthy();
	});

	it('formats a short human reference', () => {
		expect(orderReference('order-abc123')).toBe('FR-BC123');
	});
});

describe('scheduleSlots', () => {
	it('offers six half-hour slots starting at least 45 minutes out', () => {
		const now = new Date(2026, 3, 29, 13, 5, 0).getTime();
		const slots = scheduleSlots(now);
		expect(slots).toHaveLength(6);
		expect(new Date(slots[0].id).getTime()).toBeGreaterThanOrEqual(now + 45 * 60 * 1000);
		expect(slots[0].label).toMatch(/\d{1,2}:\d{2} (am|pm) - \d{1,2}:\d{2} (am|pm)/);
	});

	it('produces strictly increasing slots', () => {
		const slots = scheduleSlots(Date.now());
		const times = slots.map((slot) => new Date(slot.id).getTime());
		expect(times).toEqual([...times].sort((a, b) => a - b));
		expect(new Set(times).size).toBe(times.length);
	});
});

describe('formatWhen', () => {
	it('says Today, Yesterday or a date', () => {
		const now = new Date(2026, 3, 29, 20, 0, 0).getTime();
		expect(formatWhen(new Date(2026, 3, 29, 13, 5).getTime(), now)).toBe('Today, 1:05 pm');
		expect(formatWhen(new Date(2026, 3, 28, 9, 30).getTime(), now)).toBe('Yesterday, 9:30 am');
		expect(formatWhen(new Date(2026, 3, 20, 20, 15).getTime(), now)).toBe('20 Apr, 8:15 pm');
	});

	it('formats midnight and noon correctly', () => {
		const now = new Date(2026, 3, 29, 20, 0, 0).getTime();
		expect(formatWhen(new Date(2026, 3, 29, 0, 0).getTime(), now)).toBe('Today, 12:00 am');
		expect(formatWhen(new Date(2026, 3, 29, 12, 0).getTime(), now)).toBe('Today, 12:00 pm');
	});
});

describe('ratingBreakdown', () => {
	it('reproduces the catalog average when there are no new reviews', () => {
		const breakdown = ratingBreakdown(4.4, 2000, []);
		expect(breakdown.average).toBeCloseTo(4.4, 1);
		expect(breakdown.count).toBeGreaterThan(1500);
		expect(breakdown.distribution).toHaveLength(5);
	});

	it('moves the average when a new review arrives', () => {
		const review = (foodRating: number, id: string): Review => ({
			id,
			orderId: 'o1',
			restaurantId: 'r1',
			foodRating,
			deliveryRating: 5,
			tags: [],
			text: '',
			createdAt: Date.now(),
			authorName: 'Divya'
		});
		// A small base count makes the movement visible, as it would be for a new restaurant.
		const before = ratingBreakdown(4.0, 10, []);
		const after = ratingBreakdown(4.0, 10, [review(5, 'r1'), review(5, 'r2'), review(5, 'r3')]);
		expect(after.average).toBeGreaterThan(before.average);
		expect(after.count).toBe(before.count + 3);
	});

	it('counts a 1-star review in the first bucket', () => {
		const review: Review = {
			id: 'r1',
			orderId: 'o1',
			restaurantId: 'r1',
			foodRating: 1,
			deliveryRating: 1,
			tags: ['Late'],
			text: 'Cold on arrival',
			createdAt: Date.now(),
			authorName: 'Divya'
		};
		const before = ratingBreakdown(4.5, 100, []);
		const after = ratingBreakdown(4.5, 100, [review]);
		expect(after.distribution[0]).toBe(before.distribution[0] + 1);
		// One 1-star review among ~100 ratings moves the mean but not always the rounded
		// headline, so assert on the exact mean.
		expect(after.exactAverage).toBeLessThan(before.exactAverage);
		expect(after.average).toBeLessThanOrEqual(before.average);
	});

	it('handles a restaurant with no ratings at all', () => {
		expect(ratingBreakdown(0, 0, [])).toEqual({
			average: 0,
			count: 0,
			distribution: [0, 0, 0, 0, 0],
			exactAverage: 0
		});
	});

	it('reproduces a range of catalog averages exactly', () => {
		for (const target of [3.8, 3.9, 4.0, 4.1, 4.3, 4.5, 4.6, 4.7]) {
			expect(ratingBreakdown(target, 4000, []).average).toBeCloseTo(target, 1);
		}
	});
});

describe('address validation', () => {
	it('accepts valid Indian pin codes', () => {
		expect(isValidPin('560034')).toBe(true);
		expect(isValidPin(' 560034 ')).toBe(true);
	});

	it('rejects bad pin codes', () => {
		expect(isValidPin('56003')).toBe(false);
		expect(isValidPin('0560034')).toBe(false);
		expect(isValidPin('060034')).toBe(false);
		expect(isValidPin('abcdef')).toBe(false);
	});

	it('accepts valid Indian mobile numbers with common prefixes', () => {
		expect(isValidPhone('9845012345')).toBe(true);
		expect(isValidPhone('+91 98450 12345')).toBe(true);
		expect(isValidPhone('098450-12345')).toBe(true);
	});

	it('rejects bad mobile numbers', () => {
		expect(isValidPhone('1234567890')).toBe(false);
		expect(isValidPhone('98450')).toBe(false);
		expect(isValidPhone('98450123456')).toBe(false);
		expect(isValidPhone('')).toBe(false);
	});

	it('reports every missing address field', () => {
		const errors = validateAddress({});
		expect(Object.keys(errors).sort()).toEqual(['area', 'city', 'line1', 'name', 'phone', 'pin']);
	});

	it('passes a complete address', () => {
		const address: Partial<Address> = {
			name: 'Divya',
			phone: '9845012345',
			line1: '12, 3rd Cross',
			area: 'Jayanagar',
			city: 'Bengaluru',
			pin: '560041'
		};
		expect(validateAddress(address)).toEqual({});
	});
});

describe('orderStats', () => {
	it('counts delivered orders, spend and the favourite restaurant', () => {
		const orders = [
			order({ id: 'o1', status: 'delivered', restaurantName: 'Dosa Darbar' }),
			order({ id: 'o2', status: 'delivered', restaurantName: 'Dosa Darbar' }),
			order({ id: 'o3', status: 'delivered', restaurantName: 'Napoli Nook' }),
			order({ id: 'o4', status: 'cancelled' })
		];
		const stats = orderStats(orders);
		expect(stats).toMatchObject({ delivered: 3, cancelled: 1, favouriteRestaurant: 'Dosa Darbar' });
		expect(stats.spentPaise).toBe(18587 * 3);
	});

	it('handles an empty history', () => {
		expect(orderStats([])).toEqual({
			delivered: 0,
			cancelled: 0,
			spentPaise: 0,
			favouriteRestaurant: null
		});
	});
});
