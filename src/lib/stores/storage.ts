/**
 * localStorage persistence. NOTHING in this module throws.
 *
 * Browser storage fails in ways an app cannot control: private mode, embedded webviews,
 * disabled cookies, a full quota, or a key corrupted by another tab. A food app that loses
 * the user's cart - or worse, crashes to a blank screen on boot - because a read threw is
 * unacceptable, so every read and write is wrapped and failures surface as a
 * `StorageStatus` the UI shows as a banner.
 *
 * Saved data carries a `version`. `migrate()` is the single upgrade path: data from a
 * NEWER version is refused rather than silently mangled, older data walks the migration
 * list, and structurally wrong data is parked under a salvage key so the user's order
 * history is not destroyed by the first autosave.
 */

import {
	DATA_VERSION,
	type Address,
	type Cart,
	type Favourites,
	type LocationState,
	type Order,
	type PersistedState,
	type Profile,
	type Review,
	type Settings
} from '../types';

export const STORAGE_KEY = 'foodrush:data:v1';
export const THEME_KEY = 'foodrush:theme';
/** Where an unreadable payload is parked so the user's data is not lost on first save. */
export const SALVAGE_KEY = 'foodrush:data:unreadable';

export type StorageStatus =
	| { kind: 'ok' }
	| { kind: 'unavailable'; message: string }
	| { kind: 'corrupt'; message: string }
	| { kind: 'full'; message: string }
	| { kind: 'future'; message: string };

export const STORAGE_OK: StorageStatus = { kind: 'ok' };

function hasStorage(): boolean {
	try {
		if (typeof localStorage === 'undefined') return false;
		const probe = '__foodrush_probe__';
		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);
		return true;
	} catch {
		return false;
	}
}

export interface LoadResult {
	state: PersistedState | null;
	status: StorageStatus;
}

/** Read + validate + migrate. Never throws; a bad payload returns `state: null`. */
export function loadState(): LoadResult {
	if (!hasStorage()) {
		return {
			state: null,
			status: {
				kind: 'unavailable',
				message:
					'Browser storage is blocked, so your cart and orders will not survive a refresh. FoodRush still works for this visit.'
			}
		};
	}

	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return {
			state: null,
			status: { kind: 'unavailable', message: 'Could not read saved data from this browser.' }
		};
	}
	if (!raw) return { state: null, status: STORAGE_OK };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		salvage(raw);
		return {
			state: null,
			status: {
				kind: 'corrupt',
				message:
					'Saved data could not be read, so FoodRush started fresh. A copy of the unreadable file was kept in this browser under "foodrush:data:unreadable".'
			}
		};
	}

	const migrated = migrate(parsed);
	if (migrated.kind === 'future') {
		return {
			state: null,
			status: {
				kind: 'future',
				message:
					'This data was saved by a newer version of FoodRush. Update the app rather than overwriting it.'
			}
		};
	}
	if (migrated.kind === 'invalid') {
		salvage(raw);
		return {
			state: null,
			status: {
				kind: 'corrupt',
				message:
					'Saved data was incomplete, so FoodRush started fresh. A copy of it was kept in this browser under "foodrush:data:unreadable".'
			}
		};
	}
	return { state: migrated.state, status: STORAGE_OK };
}

/** Keep one copy of an unreadable payload. Never throws, never overwrites an older copy. */
function salvage(raw: string): void {
	try {
		if (localStorage.getItem(SALVAGE_KEY) === null) localStorage.setItem(SALVAGE_KEY, raw);
	} catch {
		// Quota full or storage blocked - nothing more we can do, and the app must still boot.
	}
}

export type MigrateResult =
	| { kind: 'ok'; state: PersistedState }
	| { kind: 'invalid' }
	| { kind: 'future' };

export const defaultProfile = (): Profile => ({ name: '', phone: '', email: '' });

export const defaultSettings = (): Settings => ({
	theme: 'system',
	vegOnly: false,
	language: 'en',
	reduceMotion: false
});

export const emptyCart = (): Cart => ({ restaurantId: null, lines: [], couponCode: null, tipPaise: 0 });

export const defaultLocation = (): LocationState => ({ areaId: null, label: '', fromDevice: false });

export function emptyState(): PersistedState {
	return {
		version: DATA_VERSION,
		profile: defaultProfile(),
		settings: defaultSettings(),
		location: defaultLocation(),
		cart: emptyCart(),
		addresses: [],
		orders: [],
		reviews: [],
		favourites: { restaurants: [], dishes: [] },
		usedCoupons: [],
		availability: {},
		ratedOrders: []
	};
}

/**
 * Coerce an unknown payload into the current shape.
 *
 * Deliberately TOLERANT about missing collections (a key added in a later version just
 * defaults to empty) and STRICT about wrong types (an object where an array belongs means
 * the file is not ours). That combination makes forward migration cheap without accepting
 * garbage. Cart lines are validated individually, because one malformed line must not cost
 * the user their whole order history.
 */
export function migrate(input: unknown): MigrateResult {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'invalid' };
	const data = input as Record<string, unknown>;

	const version = typeof data.version === 'number' ? data.version : 0;
	if (version > DATA_VERSION) return { kind: 'future' };

	// A payload with no cart AND no orders key is not a FoodRush backup.
	const hasCart = typeof data.cart === 'object' && data.cart !== null && !Array.isArray(data.cart);
	const hasOrders = Array.isArray(data.orders);
	if (!hasCart && !hasOrders) return { kind: 'invalid' };

	const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
	const object = <T extends object>(value: unknown, fallback: T): T =>
		value && typeof value === 'object' && !Array.isArray(value) ? ({ ...fallback, ...value } as T) : fallback;

	const rawCart = object<Cart>(data.cart, emptyCart());
	const cart: Cart = {
		restaurantId: typeof rawCart.restaurantId === 'string' ? rawCart.restaurantId : null,
		// Drop lines that lost their identity or price; keeping them would poison the bill.
		lines: list<Cart['lines'][number]>(rawCart.lines).filter(
			(line) =>
				line &&
				typeof line.id === 'string' &&
				typeof line.dishId === 'string' &&
				Number.isFinite(line.basePricePaise) &&
				Number.isFinite(line.quantity) &&
				Array.isArray(line.options)
		),
		couponCode: typeof rawCart.couponCode === 'string' ? rawCart.couponCode : null,
		tipPaise: Number.isFinite(rawCart.tipPaise) ? Math.max(0, Math.round(rawCart.tipPaise)) : 0
	};
	// A cart whose lines all failed validation must not keep claiming a restaurant.
	if (cart.lines.length === 0) cart.restaurantId = null;

	const availabilityInput = object<Record<string, unknown>>(data.availability, {});
	const availability: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(availabilityInput)) {
		if (typeof value === 'boolean') availability[key] = value;
	}

	const state: PersistedState = {
		version: DATA_VERSION,
		profile: object<Profile>(data.profile, defaultProfile()),
		settings: object<Settings>(data.settings, defaultSettings()),
		location: object<LocationState>(data.location, defaultLocation()),
		cart,
		addresses: list<Address>(data.addresses).filter((address) => address && typeof address.id === 'string'),
		orders: list<Order>(data.orders).filter((order) => order && typeof order.id === 'string'),
		reviews: list<Review>(data.reviews).filter((review) => review && typeof review.id === 'string'),
		favourites: object<Favourites>(data.favourites, { restaurants: [], dishes: [] }),
		usedCoupons: list<string>(data.usedCoupons).filter((code) => typeof code === 'string'),
		availability,
		ratedOrders: list<string>(data.ratedOrders).filter((id) => typeof id === 'string')
	};

	// Favourites may arrive with the wrong inner types from a hand-edited backup.
	if (!Array.isArray(state.favourites.restaurants)) state.favourites.restaurants = [];
	if (!Array.isArray(state.favourites.dishes)) state.favourites.dishes = [];

	return { kind: 'ok', state };
}

/** Write. Returns a status instead of throwing, so a caller can show a banner. */
export function saveState(state: PersistedState): StorageStatus {
	if (!hasStorage()) {
		return {
			kind: 'unavailable',
			message: 'Browser storage is blocked, so changes are not being saved.'
		};
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		return STORAGE_OK;
	} catch (error) {
		const name = error instanceof Error ? error.name : '';
		// Safari uses a different quota error name than Chrome/Firefox.
		if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
			return {
				kind: 'full',
				message:
					'Browser storage is full. Clear some space or reset FoodRush data from Profile to keep ordering.'
			};
		}
		return { kind: 'unavailable', message: 'Changes could not be saved to this browser.' };
	}
}

export function clearState(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Nothing to do - the caller already resets in-memory state.
	}
}

/** JSON backup text (pretty-printed so a human can read/diff it). */
export function exportBackup(state: PersistedState): string {
	return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export type ParseResult = { ok: true; state: PersistedState } | { ok: false; error: string };

/** Parse an uploaded backup. Every failure mode returns a message the UI can show. */
export function parseBackup(text: string): ParseResult {
	const trimmed = text.trim();
	if (!trimmed) return { ok: false, error: 'That file is empty.' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { ok: false, error: 'That file is not valid JSON. Pick a FoodRush backup file.' };
	}
	const result = migrate(parsed);
	if (result.kind === 'future') {
		return { ok: false, error: 'That backup was made by a newer version of FoodRush.' };
	}
	if (result.kind === 'invalid') {
		return { ok: false, error: 'That JSON file is not a FoodRush backup.' };
	}
	return { ok: true, state: result.state };
}

/** Theme is stored separately so app.html can apply it before first paint. */
export function saveTheme(theme: string): void {
	try {
		localStorage.setItem(THEME_KEY, theme);
	} catch {
		// Non-fatal: the app still renders, it just flashes on the next load.
	}
}
