import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SALVAGE_KEY,
	STORAGE_KEY,
	clearState,
	emptyState,
	exportBackup,
	loadState,
	migrate,
	parseBackup,
	saveState
} from './storage';
import { DATA_VERSION, type PersistedState } from '../types';

/**
 * A minimal in-memory localStorage. Each test installs a FRESH one, so no test can see
 * another test's leftovers - the brief requires exactly this isolation.
 */
function installStorage(options: { throwOnSet?: Error; throwOnGet?: boolean } = {}) {
	const map = new Map<string, string>();
	const storage = {
		getItem(key: string) {
			if (options.throwOnGet) throw new Error('blocked');
			return map.has(key) ? (map.get(key) as string) : null;
		},
		setItem(key: string, value: string) {
			// The availability probe must still succeed when we are simulating a quota error
			// on real writes, otherwise we would be testing "unavailable" instead of "full".
			if (options.throwOnSet && !key.startsWith('__foodrush_probe__')) throw options.throwOnSet;
			map.set(key, value);
		},
		removeItem(key: string) {
			map.delete(key);
		},
		clear() {
			map.clear();
		}
	};
	vi.stubGlobal('localStorage', storage);
	return map;
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

describe('loadState', () => {
	it('returns an empty result for a first visit', () => {
		installStorage();
		expect(loadState()).toEqual({ state: null, status: { kind: 'ok' } });
	});

	it('round-trips a saved state', () => {
		installStorage();
		const state = emptyState();
		state.profile.name = 'Divya';
		state.cart.tipPaise = 3000;
		expect(saveState(state)).toEqual({ kind: 'ok' });

		const loaded = loadState();
		expect(loaded.status.kind).toBe('ok');
		expect(loaded.state?.profile.name).toBe('Divya');
		expect(loaded.state?.cart.tipPaise).toBe(3000);
	});

	it('reports unavailable storage instead of crashing', () => {
		vi.stubGlobal('localStorage', undefined);
		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status.kind).toBe('unavailable');
	});

	it('survives a read that throws', () => {
		installStorage({ throwOnGet: true });
		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status.kind).toBe('unavailable');
	});

	it('salvages a corrupted payload and starts fresh', () => {
		const map = installStorage();
		map.set(STORAGE_KEY, '{not json at all');

		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status.kind).toBe('corrupt');
		// The message promises a copy was kept, so a copy must actually be there.
		expect(map.get(SALVAGE_KEY)).toBe('{not json at all');
	});

	it('does not overwrite an existing salvage copy', () => {
		const map = installStorage();
		map.set(SALVAGE_KEY, 'the original');
		map.set(STORAGE_KEY, 'garbage');
		loadState();
		expect(map.get(SALVAGE_KEY)).toBe('the original');
	});

	it('refuses data from a newer version rather than mangling it', () => {
		const map = installStorage();
		map.set(STORAGE_KEY, JSON.stringify({ ...emptyState(), version: DATA_VERSION + 5 }));

		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status.kind).toBe('future');
		// And it must NOT be salvaged/destroyed - the newer file stays exactly where it is.
		expect(map.get(SALVAGE_KEY)).toBeUndefined();
	});

	it('starts fresh on a structurally wrong payload', () => {
		const map = installStorage();
		map.set(STORAGE_KEY, JSON.stringify({ hello: 'world' }));
		expect(loadState().status.kind).toBe('corrupt');
	});
});

describe('saveState', () => {
	it('reports a full quota with an actionable message', () => {
		const error = new Error('quota');
		error.name = 'QuotaExceededError';
		installStorage({ throwOnSet: error });

		const status = saveState(emptyState());
		expect(status.kind).toBe('full');
		if (status.kind === 'full') expect(status.message).toContain('storage is full');
	});

	it('reports Safari quota errors too', () => {
		const error = new Error('quota');
		error.name = 'NS_ERROR_DOM_QUOTA_REACHED';
		installStorage({ throwOnSet: error });
		expect(saveState(emptyState()).kind).toBe('full');
	});

	it('reports a generic write failure without throwing', () => {
		installStorage({ throwOnSet: new Error('nope') });
		expect(saveState(emptyState()).kind).toBe('unavailable');
	});

	it('does not throw when storage is missing entirely', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(() => saveState(emptyState())).not.toThrow();
		expect(saveState(emptyState()).kind).toBe('unavailable');
	});
});

describe('clearState', () => {
	it('removes the key and never throws', () => {
		const map = installStorage();
		map.set(STORAGE_KEY, JSON.stringify(emptyState()));
		clearState();
		expect(map.has(STORAGE_KEY)).toBe(false);

		vi.stubGlobal('localStorage', undefined);
		expect(() => clearState()).not.toThrow();
	});
});

describe('migrate', () => {
	it('rejects non-objects', () => {
		expect(migrate(null).kind).toBe('invalid');
		expect(migrate('a string').kind).toBe('invalid');
		expect(migrate([1, 2, 3]).kind).toBe('invalid');
		expect(migrate(42).kind).toBe('invalid');
	});

	it('accepts a v0 payload that predates later keys', () => {
		const result = migrate({ cart: { restaurantId: null, lines: [], couponCode: null, tipPaise: 0 } });
		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.state.version).toBe(DATA_VERSION);
			expect(result.state.orders).toEqual([]);
			expect(result.state.favourites).toEqual({ restaurants: [], dishes: [] });
			expect(result.state.availability).toEqual({});
		}
	});

	it('refuses a future version', () => {
		expect(migrate({ cart: {}, version: DATA_VERSION + 1 }).kind).toBe('future');
	});

	it('drops malformed cart lines but keeps the good ones', () => {
		const result = migrate({
			cart: {
				restaurantId: 'dosa-darbar',
				lines: [
					{ id: 'ok', dishId: 'd1', basePricePaise: 14900, quantity: 2, options: [] },
					{ id: 'no-price', dishId: 'd2', quantity: 1, options: [] },
					{ dishId: 'no-id', basePricePaise: 100, quantity: 1, options: [] },
					null,
					'nonsense'
				],
				couponCode: 'SAVE20',
				tipPaise: 2000
			}
		});
		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.state.cart.lines.map((line) => line.id)).toEqual(['ok']);
			expect(result.state.cart.restaurantId).toBe('dosa-darbar');
			expect(result.state.cart.couponCode).toBe('SAVE20');
		}
	});

	it('clears the restaurant when every cart line was dropped', () => {
		const result = migrate({
			cart: { restaurantId: 'dosa-darbar', lines: [{ broken: true }], couponCode: 'X', tipPaise: 0 }
		});
		if (result.kind === 'ok') {
			expect(result.state.cart.lines).toEqual([]);
			expect(result.state.cart.restaurantId).toBeNull();
		}
	});

	it('sanitises a negative or non-numeric tip', () => {
		const run = (tipPaise: unknown) => migrate({ cart: { lines: [], tipPaise } });
		for (const tip of [-500, 'lots', null, Number.NaN]) {
			const result = run(tip);
			if (result.kind === 'ok') expect(result.state.cart.tipPaise).toBe(0);
		}
	});

	it('keeps only boolean availability overrides', () => {
		const result = migrate({ cart: { lines: [] }, availability: { a: false, b: 'yes', c: true } });
		if (result.kind === 'ok') expect(result.state.availability).toEqual({ a: false, c: true });
	});

	it('repairs favourites that arrived with the wrong inner types', () => {
		const result = migrate({ cart: { lines: [] }, favourites: { restaurants: 'nope', dishes: null } });
		if (result.kind === 'ok') {
			expect(result.state.favourites).toEqual({ restaurants: [], dishes: [] });
		}
	});

	it('drops entries without ids from every collection', () => {
		const result = migrate({
			cart: { lines: [] },
			addresses: [{ id: 'a' }, {}, null],
			orders: [{ id: 'o' }, { noId: true }],
			reviews: [{ id: 'r' }, 5],
			usedCoupons: ['SAVE20', 7],
			ratedOrders: ['o', null]
		});
		if (result.kind === 'ok') {
			expect(result.state.addresses).toHaveLength(1);
			expect(result.state.orders).toHaveLength(1);
			expect(result.state.reviews).toHaveLength(1);
			expect(result.state.usedCoupons).toEqual(['SAVE20']);
			expect(result.state.ratedOrders).toEqual(['o']);
		}
	});

	it('accepts a payload that only has orders (cart cleared after ordering)', () => {
		expect(migrate({ orders: [] }).kind).toBe('ok');
	});
});

describe('backup export/import', () => {
	it('round-trips through export and parse', () => {
		const state: PersistedState = { ...emptyState(), usedCoupons: ['WELCOME50'] };
		const result = parseBackup(exportBackup(state));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.state.usedCoupons).toEqual(['WELCOME50']);
	});

	it('explains every bad-file case', () => {
		expect(parseBackup('')).toEqual({ ok: false, error: 'That file is empty.' });
		expect(parseBackup('<html>')).toMatchObject({ ok: false });
		expect(parseBackup('{"hello":1}')).toMatchObject({
			ok: false,
			error: 'That JSON file is not a FoodRush backup.'
		});
		expect(parseBackup(JSON.stringify({ cart: {}, version: 999 }))).toMatchObject({
			ok: false,
			error: 'That backup was made by a newer version of FoodRush.'
		});
	});
});
