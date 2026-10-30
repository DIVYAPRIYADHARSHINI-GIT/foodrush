import { describe, expect, it } from 'vitest';
import {
	EMPTY_FILTERS,
	activeChips,
	filterDishes,
	filterRestaurants,
	groupByCategory,
	hasActiveFilters,
	isOpenAt,
	normalise,
	type Filters
} from './catalog';
import type { Dish, Restaurant } from '../types';

function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
	return {
		id: 'r1',
		name: 'Dosa Darbar',
		cuisines: ['South Indian'],
		area: 'Jayanagar',
		address: '42, 11th Main',
		rating: 4.4,
		ratingCount: 1000,
		deliveryMinutes: 20,
		distanceKm: 1.8,
		priceForTwoPaise: 40000,
		pureVeg: true,
		offerCodes: [],
		hours: { open: 390, close: 1320 },
		categories: ['Dosa Counter'],
		art: 'dosa',
		tagline: '',
		...overrides
	};
}

function dish(overrides: Partial<Dish> = {}): Dish {
	return {
		id: 'd1',
		restaurantId: 'r1',
		name: 'Masala Dosa',
		description: 'Crisp rice crepe with potato masala',
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

const filters = (overrides: Partial<Filters> = {}): Filters => ({ ...EMPTY_FILTERS, ...overrides });

const NOON = 12 * 60;

describe('normalise', () => {
	it('lowercases, strips punctuation and collapses whitespace', () => {
		expect(normalise("Anna's   Tiffin-Room!")).toBe('anna s tiffin room');
	});

	it('keeps unicode letters and digits', () => {
		expect(normalise('Café 99 ☕')).toBe('café 99');
	});
});

describe('isOpenAt', () => {
	it('is open inside the window and closed outside it', () => {
		const r = restaurant({ hours: { open: 660, close: 1380 } });
		expect(isOpenAt(r, 660)).toBe(true);
		expect(isOpenAt(r, 1379)).toBe(true);
		expect(isOpenAt(r, 1380)).toBe(false);
		expect(isOpenAt(r, 300)).toBe(false);
	});

	it('handles a window that wraps past midnight', () => {
		const r = restaurant({ hours: { open: 1380, close: 120 } });
		expect(isOpenAt(r, 1400)).toBe(true);
		expect(isOpenAt(r, 60)).toBe(true);
		expect(isOpenAt(r, 600)).toBe(false);
	});
});

describe('filterRestaurants', () => {
	const base = {
		restaurants: [
			restaurant({ id: 'dosa', name: 'Dosa Darbar', cuisines: ['South Indian'], rating: 4.4, deliveryMinutes: 20, priceForTwoPaise: 40000, pureVeg: true }),
			restaurant({ id: 'biryani', name: 'Biryani Bros.', cuisines: ['Biryani'], rating: 4.3, deliveryMinutes: 24, priceForTwoPaise: 47000, pureVeg: false, offerCodes: ['BROS40'] }),
			restaurant({ id: 'pizza', name: 'Napoli Nook', cuisines: ['Pizza'], rating: 3.8, deliveryMinutes: 45, priceForTwoPaise: 62000, pureVeg: false })
		],
		menus: {
			dosa: [dish({ id: 'd-dosa', restaurantId: 'dosa', name: 'Masala Dosa', veg: true })],
			biryani: [
				dish({ id: 'd-bir', restaurantId: 'biryani', name: 'Hyderabadi Chicken Dum Biryani', veg: false }),
				dish({ id: 'd-vegbir', restaurantId: 'biryani', name: 'Veg Dum Biryani', veg: true })
			],
			pizza: [dish({ id: 'd-pizza', restaurantId: 'pizza', name: 'Margherita Classic', veg: true })]
		},
		nowMinutes: NOON,
		availability: {} as Record<string, boolean>
	};

	it('returns everything with no filters', () => {
		expect(filterRestaurants({ ...base, filters: filters() })).toHaveLength(3);
	});

	it('matches a restaurant by name', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ query: 'napoli' }) });
		expect(hits.map((hit) => hit.restaurant.id)).toEqual(['pizza']);
	});

	it('matches restaurants by dish and reports which dishes matched', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ query: 'biryani' }) });
		expect(hits[0].restaurant.id).toBe('biryani');
		expect(hits[0].matchedDishes.length).toBeGreaterThan(0);
	});

	it('ranks a name match above a dish-only match', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ query: 'dosa' }) });
		expect(hits[0].restaurant.id).toBe('dosa');
	});

	it('requires every token to hit something', () => {
		expect(filterRestaurants({ ...base, filters: filters({ query: 'biryani sushi' }) })).toHaveLength(0);
	});

	it('returns an empty list for a no-results query', () => {
		expect(filterRestaurants({ ...base, filters: filters({ query: 'zzzzz' }) })).toHaveLength(0);
	});

	it('filters by cuisine', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ cuisine: 'Pizza' }) });
		expect(hits.map((hit) => hit.restaurant.id)).toEqual(['pizza']);
	});

	it('filters by rating 4+', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ ratingFourPlus: true }) });
		expect(hits.map((hit) => hit.restaurant.id).sort()).toEqual(['biryani', 'dosa']);
	});

	it('filters by fast delivery', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ fastDelivery: true }) });
		expect(hits.every((hit) => hit.restaurant.deliveryMinutes <= 30)).toBe(true);
		expect(hits.map((hit) => hit.restaurant.id)).not.toContain('pizza');
	});

	it('filters by offers', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ offersOnly: true }) });
		expect(hits.map((hit) => hit.restaurant.id)).toEqual(['biryani']);
	});

	it('filters by price band', () => {
		const hits = filterRestaurants({
			...base,
			filters: filters({ minPricePaise: null, maxPricePaise: 45000 })
		});
		expect(hits.map((hit) => hit.restaurant.id)).toEqual(['dosa']);
	});

	it('keeps a non-veg restaurant that has veg dishes under veg-only', () => {
		const hits = filterRestaurants({ ...base, filters: filters({ vegOnly: true }) });
		// Biryani Bros. has a Veg Dum Biryani, so it stays; the menu veg toggle filters dishes.
		expect(hits.map((hit) => hit.restaurant.id).sort()).toEqual(['biryani', 'dosa', 'pizza']);
	});

	it('drops a restaurant whose only veg dish was marked out of stock', () => {
		const hits = filterRestaurants({
			...base,
			availability: { 'd-vegbir': false, 'd-bir': true },
			filters: filters({ vegOnly: true })
		});
		expect(hits.map((hit) => hit.restaurant.id)).not.toContain('biryani');
	});

	it('combines veg-only with a search query', () => {
		const hits = filterRestaurants({
			...base,
			availability: { 'd-vegbir': false },
			filters: filters({ vegOnly: true, query: 'biryani' })
		});
		expect(hits).toHaveLength(0);
	});

	it('combines several filters at once', () => {
		const hits = filterRestaurants({
			...base,
			filters: filters({ ratingFourPlus: true, fastDelivery: true, offersOnly: true })
		});
		expect(hits.map((hit) => hit.restaurant.id)).toEqual(['biryani']);
	});

	it('sorts by rating, delivery time and cost both ways', () => {
		const ids = (sort: Filters['sort']) =>
			filterRestaurants({ ...base, filters: filters({ sort }) }).map((hit) => hit.restaurant.id);

		expect(ids('rating')).toEqual(['dosa', 'biryani', 'pizza']);
		expect(ids('delivery-time')).toEqual(['dosa', 'biryani', 'pizza']);
		expect(ids('cost-low')).toEqual(['dosa', 'biryani', 'pizza']);
		expect(ids('cost-high')).toEqual(['pizza', 'biryani', 'dosa']);
	});

	it('always sorts closed restaurants last, whatever the sort', () => {
		// 4am: only the South Indian place would be shut too, so use a custom set.
		const closedPizza = {
			...base,
			restaurants: base.restaurants.map((r) => (r.id === 'pizza' ? { ...r, hours: { open: 1380, close: 1400 } } : r))
		};
		const hits = filterRestaurants({ ...closedPizza, filters: filters({ sort: 'cost-high' }) });
		expect(hits[hits.length - 1].restaurant.id).toBe('pizza');
	});

	it('is deterministic for equal rows so pagination never shuffles', () => {
		const twins = {
			...base,
			restaurants: [
				restaurant({ id: 'bbb', name: 'Bbb', rating: 4, deliveryMinutes: 20, priceForTwoPaise: 30000 }),
				restaurant({ id: 'aaa', name: 'Aaa', rating: 4, deliveryMinutes: 20, priceForTwoPaise: 30000 })
			],
			menus: {}
		};
		const ids = filterRestaurants({ ...twins, filters: filters({ sort: 'rating' }) }).map((hit) => hit.restaurant.id);
		expect(ids).toEqual(['aaa', 'bbb']);
		expect(filterRestaurants({ ...twins, filters: filters({ sort: 'rating' }) }).map((h) => h.restaurant.id)).toEqual(ids);
	});
});

describe('activeChips / hasActiveFilters', () => {
	it('lists only the filters that are on', () => {
		const chips = activeChips(filters({ vegOnly: true, ratingFourPlus: true, cuisine: 'Pizza' }));
		expect(chips.map((chip) => chip.id)).toEqual(['vegOnly', 'ratingFourPlus', 'cuisine']);
	});

	it('labels a price band chip', () => {
		const chips = activeChips(filters({ minPricePaise: null, maxPricePaise: 30000 }));
		expect(chips).toEqual([{ id: 'price', label: 'Under ₹300' }]);
	});

	it('counts a search query as an active filter', () => {
		expect(hasActiveFilters(filters())).toBe(false);
		expect(hasActiveFilters(filters({ query: 'dosa' }))).toBe(true);
		expect(hasActiveFilters(filters({ query: '   ' }))).toBe(false);
	});
});

describe('filterDishes', () => {
	const dishes = [
		dish({ id: 'v', name: 'Veg Dum Biryani', veg: true, category: 'Biryani' }),
		dish({ id: 'nv', name: 'Chicken Dum Biryani', veg: false, category: 'Biryani' }),
		dish({ id: 'sw', name: 'Gulab Jamun', veg: true, category: 'Sides', description: 'Khoya dumplings' })
	];

	it('filters by veg and non-veg', () => {
		expect(filterDishes(dishes, { query: '', veg: 'veg' }).map((d) => d.id)).toEqual(['v', 'sw']);
		expect(filterDishes(dishes, { query: '', veg: 'non-veg' }).map((d) => d.id)).toEqual(['nv']);
		expect(filterDishes(dishes, { query: '', veg: 'all' })).toHaveLength(3);
	});

	it('searches name, description and category', () => {
		expect(filterDishes(dishes, { query: 'khoya', veg: 'all' }).map((d) => d.id)).toEqual(['sw']);
		expect(filterDishes(dishes, { query: 'biryani', veg: 'all' })).toHaveLength(2);
	});

	it('combines the veg toggle with a search', () => {
		expect(filterDishes(dishes, { query: 'biryani', veg: 'veg' }).map((d) => d.id)).toEqual(['v']);
	});

	it('requires every token to match', () => {
		expect(filterDishes(dishes, { query: 'veg biryani', veg: 'all' }).map((d) => d.id)).toEqual(['v']);
		expect(filterDishes(dishes, { query: 'veg sushi', veg: 'all' })).toHaveLength(0);
	});
});

describe('groupByCategory', () => {
	it('keeps the restaurant category order and drops empty categories', () => {
		const dishes = [
			dish({ id: 'a', category: 'Mains' }),
			dish({ id: 'b', category: 'Starters' }),
			dish({ id: 'c', category: 'Mains' })
		];
		const groups = groupByCategory(dishes, ['Starters', 'Mains', 'Desserts']);
		expect(groups.map((group) => group.category)).toEqual(['Starters', 'Mains']);
		expect(groups[1].dishes.map((d) => d.id)).toEqual(['a', 'c']);
	});

	it('appends categories that are not in the declared order', () => {
		const dishes = [dish({ id: 'a', category: 'Secret Menu' })];
		expect(groupByCategory(dishes, ['Mains']).map((group) => group.category)).toEqual(['Secret Menu']);
	});
});
