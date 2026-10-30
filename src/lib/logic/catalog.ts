/**
 * Restaurant search, filtering and sorting.
 *
 * All of it is pure functions over the catalog so the listing page holds NO derived state
 * of its own: the URL carries the filters, the store carries the catalog, and this module
 * turns the two into a list. That is what makes "filter state kept when navigating back"
 * work without any snapshot/restore code.
 */

import type { Dish, Restaurant } from '../types';

export type SortKey = 'relevance' | 'rating' | 'delivery-time' | 'cost-low' | 'cost-high';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
	{ key: 'relevance', label: 'Relevance' },
	{ key: 'rating', label: 'Rating: high to low' },
	{ key: 'delivery-time', label: 'Delivery time' },
	{ key: 'cost-low', label: 'Cost: low to high' },
	{ key: 'cost-high', label: 'Cost: high to low' }
];

export interface Filters {
	query: string;
	cuisine: string | null;
	vegOnly: boolean;
	ratingFourPlus: boolean;
	fastDelivery: boolean;
	offersOnly: boolean;
	/** Inclusive price-for-two band in paise; null means "no bound". */
	minPricePaise: number | null;
	maxPricePaise: number | null;
	sort: SortKey;
}

export const EMPTY_FILTERS: Filters = {
	query: '',
	cuisine: null,
	vegOnly: false,
	ratingFourPlus: false,
	fastDelivery: false,
	offersOnly: false,
	minPricePaise: null,
	maxPricePaise: null,
	sort: 'relevance'
};

/** "Fast delivery" threshold, in minutes. */
export const FAST_DELIVERY_MINUTES = 30;

/** Price bands offered as filter chips. */
export const PRICE_BANDS: { id: string; label: string; minPaise: number | null; maxPaise: number | null }[] = [
	{ id: 'under-300', label: 'Under ₹300', minPaise: null, maxPaise: 30000 },
	{ id: '300-500', label: '₹300 - ₹500', minPaise: 30000, maxPaise: 50000 },
	{ id: 'above-500', label: 'Above ₹500', minPaise: 50000, maxPaise: null }
];

/** Minutes from midnight, local time. */
export function minutesOfDay(at: Date = new Date()): number {
	return at.getHours() * 60 + at.getMinutes();
}

export function isOpenAt(restaurant: Restaurant, minutes: number): boolean {
	const { open, close } = restaurant.hours;
	// A close time past midnight (e.g. 23:30 -> 01:00) wraps; handled for completeness.
	if (close >= open) return minutes >= open && minutes < close;
	return minutes >= open || minutes < close;
}

/** Normalise for search: lowercase, strip punctuation, collapse whitespace. */
export function normalise(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export interface SearchHit {
	restaurant: Restaurant;
	/** Dishes that matched the query, for the "contains: Butter Chicken" line on the card. */
	matchedDishes: Dish[];
	score: number;
}

/**
 * Score a restaurant against a query. Name matches outrank cuisine matches, which outrank
 * dish matches - so searching "biryani" puts biryani PLACES first and places that merely
 * sell one biryani lower, which is what a hungry user expects.
 */
function scoreRestaurant(restaurant: Restaurant, dishes: Dish[], tokens: string[]): SearchHit | null {
	if (tokens.length === 0) return { restaurant, matchedDishes: [], score: 0 };

	const name = normalise(restaurant.name);
	const cuisines = normalise(restaurant.cuisines.join(' '));
	const area = normalise(restaurant.area);

	let score = 0;
	const matchedDishes: Dish[] = [];

	for (const token of tokens) {
		let tokenHit = false;
		if (name.includes(token)) {
			score += name.startsWith(token) ? 120 : 90;
			tokenHit = true;
		}
		if (cuisines.includes(token)) {
			score += 60;
			tokenHit = true;
		}
		if (area.includes(token)) {
			score += 25;
			tokenHit = true;
		}
		const dishMatches = dishes.filter((dish) => normalise(dish.name).includes(token));
		if (dishMatches.length > 0) {
			score += 30 + Math.min(20, dishMatches.length * 3);
			for (const dish of dishMatches) {
				if (!matchedDishes.some((entry) => entry.id === dish.id)) matchedDishes.push(dish);
			}
			tokenHit = true;
		}
		// Every token must hit something: "veg biryani koramangala" should not match a place
		// that only satisfies "veg".
		if (!tokenHit) return null;
	}

	return { restaurant, matchedDishes, score };
}

export interface FilterInput {
	restaurants: Restaurant[];
	menus: Record<string, Dish[]>;
	filters: Filters;
	/** Minutes from midnight, so "closed now" is testable without mocking Date. */
	nowMinutes: number;
	availability: Record<string, boolean>;
}

/**
 * The listing pipeline: search -> filter -> sort.
 *
 * Closed restaurants are NOT removed (the brief asks for a "Closed now" state on the card)
 * but they always sort last, because showing a closed place above an open one is hostile.
 */
export function filterRestaurants(input: FilterInput): SearchHit[] {
	const { restaurants, menus, filters, nowMinutes, availability } = input;
	const tokens = normalise(filters.query).split(' ').filter(Boolean);

	const hits: SearchHit[] = [];
	for (const restaurant of restaurants) {
		const dishes = (menus[restaurant.id] ?? []).filter(
			(dish) => availability[dish.id] ?? dish.available
		);

		if (filters.cuisine && !restaurant.cuisines.includes(filters.cuisine)) continue;
		// Veg-only keeps pure-veg restaurants AND restaurants with at least one veg dish,
		// because the menu page's own veg toggle will filter the dishes.
		if (filters.vegOnly && !restaurant.pureVeg && !dishes.some((dish) => dish.veg)) continue;
		if (filters.ratingFourPlus && restaurant.rating < 4) continue;
		if (filters.fastDelivery && restaurant.deliveryMinutes > FAST_DELIVERY_MINUTES) continue;
		if (filters.offersOnly && restaurant.offerCodes.length === 0) continue;
		if (filters.minPricePaise !== null && restaurant.priceForTwoPaise < filters.minPricePaise) continue;
		if (filters.maxPricePaise !== null && restaurant.priceForTwoPaise > filters.maxPricePaise) continue;

		const hit = scoreRestaurant(restaurant, dishes, tokens);
		if (hit) hits.push(hit);
	}

	const openness = (restaurant: Restaurant) => (isOpenAt(restaurant, nowMinutes) ? 0 : 1);

	return hits.sort((a, b) => {
		const closedDiff = openness(a.restaurant) - openness(b.restaurant);
		if (closedDiff !== 0) return closedDiff;

		switch (filters.sort) {
			case 'rating':
				if (b.restaurant.rating !== a.restaurant.rating) return b.restaurant.rating - a.restaurant.rating;
				break;
			case 'delivery-time':
				if (a.restaurant.deliveryMinutes !== b.restaurant.deliveryMinutes) {
					return a.restaurant.deliveryMinutes - b.restaurant.deliveryMinutes;
				}
				break;
			case 'cost-low':
				if (a.restaurant.priceForTwoPaise !== b.restaurant.priceForTwoPaise) {
					return a.restaurant.priceForTwoPaise - b.restaurant.priceForTwoPaise;
				}
				break;
			case 'cost-high':
				if (a.restaurant.priceForTwoPaise !== b.restaurant.priceForTwoPaise) {
					return b.restaurant.priceForTwoPaise - a.restaurant.priceForTwoPaise;
				}
				break;
			case 'relevance':
			default:
				if (b.score !== a.score) return b.score - a.score;
				if (b.restaurant.rating !== a.restaurant.rating) return b.restaurant.rating - a.restaurant.rating;
				break;
		}
		// Stable tie-break so pagination never shuffles rows between pages.
		return a.restaurant.id.localeCompare(b.restaurant.id);
	});
}

/** Active filter chips, so the listing can render them and "Clear all" knows what exists. */
export function activeChips(filters: Filters): { id: string; label: string }[] {
	const chips: { id: string; label: string }[] = [];
	if (filters.vegOnly) chips.push({ id: 'vegOnly', label: 'Pure veg' });
	if (filters.ratingFourPlus) chips.push({ id: 'ratingFourPlus', label: 'Rating 4+' });
	if (filters.fastDelivery) chips.push({ id: 'fastDelivery', label: 'Fast delivery' });
	if (filters.offersOnly) chips.push({ id: 'offersOnly', label: 'Has offers' });
	if (filters.cuisine) chips.push({ id: 'cuisine', label: filters.cuisine });
	const band = PRICE_BANDS.find(
		(entry) => entry.minPaise === filters.minPricePaise && entry.maxPaise === filters.maxPricePaise
	);
	if (band && (filters.minPricePaise !== null || filters.maxPricePaise !== null)) {
		chips.push({ id: 'price', label: band.label });
	}
	return chips;
}

export function hasActiveFilters(filters: Filters): boolean {
	return activeChips(filters).length > 0 || filters.query.trim().length > 0;
}

/** Menu-page search + veg filter, same normalisation as the listing. */
export function filterDishes(
	dishes: Dish[],
	options: { query: string; veg: 'all' | 'veg' | 'non-veg' }
): Dish[] {
	const tokens = normalise(options.query).split(' ').filter(Boolean);
	return dishes.filter((dish) => {
		if (options.veg === 'veg' && !dish.veg) return false;
		if (options.veg === 'non-veg' && dish.veg) return false;
		if (tokens.length === 0) return true;
		const haystack = `${normalise(dish.name)} ${normalise(dish.description)} ${normalise(dish.category)}`;
		return tokens.every((token) => haystack.includes(token));
	});
}

/** Group dishes into their menu categories, preserving the restaurant's category order. */
export function groupByCategory(dishes: Dish[], order: string[]): { category: string; dishes: Dish[] }[] {
	const groups = new Map<string, Dish[]>();
	for (const dish of dishes) {
		const list = groups.get(dish.category) ?? [];
		list.push(dish);
		groups.set(dish.category, list);
	}
	const ordered: { category: string; dishes: Dish[] }[] = [];
	for (const category of order) {
		const list = groups.get(category);
		if (list && list.length > 0) ordered.push({ category, dishes: list });
	}
	// Any category not in the restaurant's declared order still gets shown, at the end.
	for (const [category, list] of groups) {
		if (!order.includes(category) && list.length > 0) ordered.push({ category, dishes: list });
	}
	return ordered;
}
