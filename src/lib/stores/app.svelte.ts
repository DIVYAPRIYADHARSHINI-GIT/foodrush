/**
 * THE store. One source of truth for the whole app (Svelte 5 runes).
 *
 * Architectural rule, enforced by convention and by the probes: NO view keeps its own copy
 * of a restaurant, dish, cart line, coupon, address, order, review or favourite. The
 * listing, menu, sticky cart bar, cart page, checkout, tracking, history, ratings, profile
 * and owner view all read from here and all write through these methods. That is why
 * adding an item instantly updates the dish stepper, the sticky bar and the cart page
 * together, why a new review moves the restaurant average, and why marking a dish out of
 * stock in the owner view changes the customer menu immediately.
 *
 * Derived data (totals, availability, ratings, issues) is computed with `$derived` or pure
 * functions over the raw state - never cached - so one mutation corrects every dependent
 * view automatically.
 *
 * Persistence is write-through and debounced: every mutation calls `persist()`, which
 * never throws. A failed save surfaces as `storage` (a banner) rather than silently losing
 * the user's cart.
 */

import { browser } from '$app/env';
import { assetUrl } from '../paths';
import {
	DATA_VERSION,
	type Address,
	type Area,
	type Cart,
	type CartLine,
	type Category,
	type Coupon,
	type Dish,
	type Order,
	type OrderStatus,
	type PaymentMethod,
	type PersistedState,
	type Restaurant,
	type Review,
	type SelectedOption,
	type Settings,
	type Theme
} from '../types';
import {
	STORAGE_OK,
	clearState,
	emptyCart,
	emptyState,
	exportBackup,
	loadState,
	parseBackup,
	saveState,
	saveTheme,
	THEME_KEY,
	type StorageStatus
} from './storage';
import { lineIdFor } from '../logic/cart';
import { MAX_LINE_QUANTITY, deliveryFeeFor, findLineIssues, priceCart, type PriceResult } from '../logic/pricing';
import { rankCoupons, type CouponOffer } from '../logic/coupons';
import { partnerFor, ratingBreakdown, statusAt, type RatingBreakdown } from '../logic/orders';

const DEBOUNCE_MS = 120;

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A transient message shown as a toast ("Added to cart", "Coupon removed"). */
export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'warning';
}

function makeId(prefix: string): string {
	const random = Math.random().toString(36).slice(2, 8);
	return `${prefix}-${Date.now().toString(36)}${random}`;
}

class AppStore {
	// --- persisted state -------------------------------------------------
	profile = $state(emptyState().profile);
	settings = $state<Settings>(emptyState().settings);
	location = $state(emptyState().location);
	cart = $state<Cart>(emptyCart());
	addresses = $state<Address[]>([]);
	orders = $state<Order[]>([]);
	reviews = $state<Review[]>([]);
	favourites = $state(emptyState().favourites);
	usedCoupons = $state<string[]>([]);
	availability = $state<Record<string, boolean>>({});
	ratedOrders = $state<string[]>([]);

	// --- catalog (read-only, fetched once) --------------------------------
	restaurants = $state<Restaurant[]>([]);
	menus = $state<Record<string, Dish[]>>({});
	coupons = $state<Coupon[]>([]);
	areas = $state<Area[]>([]);
	categories = $state<Category[]>([]);
	catalogStatus = $state<CatalogStatus>('idle');
	catalogError = $state<string | null>(null);

	// --- session state -----------------------------------------------------
	storage = $state<StorageStatus>(STORAGE_OK);
	hydrated = $state(false);
	toasts = $state<Toast[]>([]);
	/** Ticks every second while an order is live, so countdowns re-render. */
	clock = $state(Date.now());

	#saveTimer: ReturnType<typeof setTimeout> | null = null;
	#clockTimer: ReturnType<typeof setInterval> | null = null;
	#toastSeq = 0;

	// =====================================================================
	// Boot
	// =====================================================================

	/** Load persisted state. Safe to call repeatedly; only the first call does work. */
	hydrate(): void {
		if (!browser || this.hydrated) return;
		const { state, status } = loadState();
		this.storage = status;
		if (state) this.#apply(state);

		/*
		 * Adopt the theme that app.html already applied before first paint.
		 *
		 * app.html reads `foodrush:theme` and sets the `dark` class to avoid a flash. If the
		 * main store has no saved settings yet (first visit, or a corrupted payload), its
		 * default is 'system' - and `#syncTheme()` would then RE-derive the class from the
		 * media query and wipe an explicit choice the user made earlier. Reading the
		 * standalone theme key back keeps the two in agreement.
		 */
		try {
			const saved = localStorage.getItem(THEME_KEY);
			if (saved === 'light' || saved === 'dark' || saved === 'system') {
				this.settings.theme = saved;
			}
		} catch {
			// Storage blocked - keep whatever the settings already say.
		}

		this.hydrated = true;
		this.#syncTheme();
		this.#startClock();
	}

	#apply(state: PersistedState): void {
		this.profile = state.profile;
		this.settings = state.settings;
		this.location = state.location;
		this.cart = state.cart;
		this.addresses = state.addresses;
		this.orders = state.orders;
		this.reviews = state.reviews;
		this.favourites = state.favourites;
		this.usedCoupons = state.usedCoupons;
		this.availability = state.availability;
		this.ratedOrders = state.ratedOrders;
	}

	snapshot(): PersistedState {
		return {
			version: DATA_VERSION,
			profile: $state.snapshot(this.profile),
			settings: $state.snapshot(this.settings),
			location: $state.snapshot(this.location),
			cart: $state.snapshot(this.cart),
			addresses: $state.snapshot(this.addresses),
			orders: $state.snapshot(this.orders),
			reviews: $state.snapshot(this.reviews),
			favourites: $state.snapshot(this.favourites),
			usedCoupons: $state.snapshot(this.usedCoupons),
			availability: $state.snapshot(this.availability),
			ratedOrders: $state.snapshot(this.ratedOrders)
		};
	}

	/** Debounced write-through save. Never throws. */
	persist(): void {
		if (!browser) return;
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = null;
			const status = saveState(this.snapshot());
			// Only surface failures; a successful save must clear a previous error banner.
			this.storage = status;
		}, DEBOUNCE_MS);
	}

	/** Flush a pending save immediately (used before navigating away / on unload). */
	flush(): void {
		if (!browser) return;
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = null;
		}
		this.storage = saveState(this.snapshot());
	}

	/**
	 * Fetch the catalog JSON.
	 *
	 * The data files are REAL files under `static/data/`, not bundled modules, so a host
	 * misconfiguration that returns the SPA fallback instead shows up here as a parse
	 * error rather than as mysteriously empty screens.
	 */
	async loadCatalog(): Promise<void> {
		if (!browser || this.catalogStatus === 'loading' || this.catalogStatus === 'ready') return;
		this.catalogStatus = 'loading';
		this.catalogError = null;
		try {
			const files = ['restaurants', 'menus', 'coupons', 'areas', 'categories'] as const;
			const responses = await Promise.all(
				files.map((file) => fetch(assetUrl(`/data/${file}.json`), { headers: { Accept: 'application/json' } }))
			);
			for (const [index, response] of responses.entries()) {
				if (!response.ok) throw new Error(`${files[index]}.json returned ${response.status}`);
			}
			const texts = await Promise.all(responses.map((response) => response.text()));
			for (const [index, text] of texts.entries()) {
				// Guard against a host serving index.html for a missing data file.
				if (text.trimStart().startsWith('<')) {
					throw new Error(`${files[index]}.json was served as HTML, not JSON`);
				}
			}
			const [restaurants, menus, coupons, areas, categories] = texts.map((text) => JSON.parse(text)) as [
				Restaurant[],
				Record<string, Dish[]>,
				Coupon[],
				Area[],
				Category[]
			];

			this.restaurants = restaurants;
			this.menus = menus;
			this.coupons = coupons;
			this.areas = areas;
			this.categories = categories;
			this.catalogStatus = 'ready';
		} catch (error) {
			this.catalogStatus = 'error';
			this.catalogError =
				error instanceof Error ? error.message : 'The FoodRush menu could not be loaded.';
		}
	}

	#startClock(): void {
		if (!browser || this.#clockTimer) return;
		this.#clockTimer = setInterval(() => {
			this.clock = Date.now();
		}, 1000);
	}

	/** Stop the shared clock - called when the app unmounts, so no timer leaks. */
	stopClock(): void {
		if (this.#clockTimer) {
			clearInterval(this.#clockTimer);
			this.#clockTimer = null;
		}
	}

	// =====================================================================
	// Derived catalog views
	// =====================================================================

	/** Every dish, keyed by id, with owner-view availability applied. */
	dishIndex = $derived.by(() => {
		const index = new Map<string, Dish>();
		for (const list of Object.values(this.menus)) {
			for (const dish of list) index.set(dish.id, dish);
		}
		return index;
	});

	restaurantIndex = $derived.by(() => {
		const index = new Map<string, Restaurant>();
		for (const restaurant of this.restaurants) index.set(restaurant.id, restaurant);
		return index;
	});

	restaurant(id: string | null | undefined): Restaurant | null {
		if (!id) return null;
		return this.restaurantIndex.get(id) ?? null;
	}

	dish(id: string | null | undefined): Dish | null {
		if (!id) return null;
		return this.dishIndex.get(id) ?? null;
	}

	/** Menu for a restaurant, with availability overrides applied to each dish. */
	menuFor(restaurantId: string): Dish[] {
		const dishes = this.menus[restaurantId] ?? [];
		return dishes.map((dish) => ({
			...dish,
			available: this.availability[dish.id] ?? dish.available
		}));
	}

	isAvailable(dishId: string): boolean {
		const dish = this.dishIndex.get(dishId);
		if (!dish) return false;
		return this.availability[dishId] ?? dish.available;
	}

	/** Coupons advertised by a restaurant, for the offer tag and the menu header. */
	offersFor(restaurantId: string): Coupon[] {
		const restaurant = this.restaurantIndex.get(restaurantId);
		if (!restaurant) return [];
		return restaurant.offerCodes
			.map((code) => this.coupons.find((coupon) => coupon.code === code))
			.filter((coupon): coupon is Coupon => Boolean(coupon));
	}

	// =====================================================================
	// Derived cart views - every screen reads these
	// =====================================================================

	cartRestaurant = $derived(this.restaurant(this.cart.restaurantId));

	cartCount = $derived(this.cart.lines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0));

	appliedCoupon = $derived.by(() => {
		if (!this.cart.couponCode) return null;
		return this.coupons.find((coupon) => coupon.code === this.cart.couponCode) ?? null;
	});

	/** Number of orders that count towards "first order only" coupons. */
	orderCount = $derived(this.orders.filter((order) => order.status !== 'cancelled').length);

	/** THE bill. Cart, sticky bar, checkout and receipt all read this. */
	price: PriceResult = $derived(
		priceCart({
			cart: this.cart,
			restaurant: this.cartRestaurant,
			coupon: this.appliedCoupon,
			usedCoupons: this.usedCoupons,
			orderCount: this.orderCount,
			now: this.clock
		})
	);

	/** Delivery fee before any waiver, so the UI can show "₹29 FREE". */
	baseDeliveryFee = $derived(
		this.cart.lines.length === 0 ? 0 : deliveryFeeFor(this.cartRestaurant?.distanceKm ?? 0)
	);

	/** Problems with the current cart: dish gone, out of stock, or price changed. */
	cartIssues = $derived(findLineIssues(this.cart.lines, this.dishIndex, this.availability));

	/** All coupons ranked for the current cart, for the offers sheet. */
	couponOffers: CouponOffer[] = $derived(
		rankCoupons(
			this.coupons,
			{
				itemTotalPaise: this.price.itemTotalPaise,
				restaurantId: this.cart.restaurantId,
				usedCoupons: this.usedCoupons,
				orderCount: this.orderCount,
				now: this.clock
			},
			this.baseDeliveryFee
		)
	);

	/** Quantity of a given dish in the cart, summed across customisation lines. */
	quantityOf(dishId: string): number {
		return this.cart.lines
			.filter((line) => line.dishId === dishId)
			.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
	}

	lineFor(lineId: string): CartLine | null {
		return this.cart.lines.find((line) => line.id === lineId) ?? null;
	}

	// =====================================================================
	// Cart mutations
	// =====================================================================

	/**
	 * Add a dish to the cart.
	 *
	 * Returns `needs-replace` when the cart already holds another restaurant's food, so
	 * the caller can show the "Replace cart?" confirmation rather than silently mixing
	 * two kitchens into one order.
	 */
	addToCart(
		dish: Dish,
		options: SelectedOption[] = [],
		instructions = '',
		quantity = 1
	): 'added' | 'needs-replace' | 'unavailable' {
		if (!this.isAvailable(dish.id)) return 'unavailable';
		if (this.cart.restaurantId && this.cart.restaurantId !== dish.restaurantId && this.cart.lines.length > 0) {
			return 'needs-replace';
		}

		const id = lineIdFor(dish.id, options, instructions);
		const existing = this.cart.lines.find((line) => line.id === id);
		if (existing) {
			existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + quantity);
		} else {
			this.cart.lines.push({
				id,
				dishId: dish.id,
				restaurantId: dish.restaurantId,
				name: dish.name,
				veg: dish.veg,
				art: dish.art,
				basePricePaise: dish.pricePaise,
				options,
				quantity: Math.min(MAX_LINE_QUANTITY, Math.max(1, quantity)),
				instructions: instructions.trim()
			});
		}
		this.cart.restaurantId = dish.restaurantId;
		this.#revalidateCoupon();
		this.persist();
		return 'added';
	}

	/** Empty the cart and add this dish instead (the "Replace cart?" confirmation). */
	replaceCartWith(
		dish: Dish,
		options: SelectedOption[] = [],
		instructions = '',
		quantity = 1
	): 'added' | 'unavailable' {
		this.cart = emptyCart();
		const result = this.addToCart(dish, options, instructions, quantity);
		return result === 'needs-replace' ? 'added' : result;
	}

	setLineQuantity(lineId: string, quantity: number): void {
		const line = this.cart.lines.find((entry) => entry.id === lineId);
		if (!line) return;
		const next = Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.trunc(quantity)));
		if (next === 0) {
			this.removeLine(lineId);
			return;
		}
		line.quantity = next;
		this.#revalidateCoupon();
		this.persist();
	}

	incrementLine(lineId: string): void {
		const line = this.cart.lines.find((entry) => entry.id === lineId);
		if (line) this.setLineQuantity(lineId, line.quantity + 1);
	}

	decrementLine(lineId: string): void {
		const line = this.cart.lines.find((entry) => entry.id === lineId);
		if (line) this.setLineQuantity(lineId, line.quantity - 1);
	}

	removeLine(lineId: string): void {
		this.cart.lines = this.cart.lines.filter((line) => line.id !== lineId);
		if (this.cart.lines.length === 0) {
			// A cart with no lines has no restaurant and no coupon.
			this.cart.restaurantId = null;
			this.cart.couponCode = null;
			this.cart.tipPaise = 0;
		}
		this.#revalidateCoupon();
		this.persist();
	}

	/** Decrement the LAST line of a dish - what the dish-card stepper does. */
	decrementDish(dishId: string): void {
		const lines = this.cart.lines.filter((line) => line.dishId === dishId);
		const last = lines[lines.length - 1];
		if (last) this.decrementLine(last.id);
	}

	setLineInstructions(lineId: string, instructions: string): void {
		const line = this.cart.lines.find((entry) => entry.id === lineId);
		if (!line) return;
		line.instructions = instructions;
		this.persist();
	}

	clearCart(): void {
		this.cart = emptyCart();
		this.persist();
	}

	setTip(tipPaise: number): void {
		this.cart.tipPaise = Math.max(0, Math.round(tipPaise));
		this.persist();
	}

	/**
	 * Apply a coupon by code. Returns an error message when it cannot be applied, so the
	 * coupon box can show the exact reason.
	 */
	applyCoupon(code: string): { ok: true } | { ok: false; error: string } {
		const normalised = code.trim().toUpperCase();
		if (!normalised) return { ok: false, error: 'Enter a coupon code.' };

		const coupon = this.coupons.find((entry) => entry.code === normalised);
		if (!coupon) return { ok: false, error: `${normalised} is not a FoodRush coupon.` };

		const offer = this.couponOffers.find((entry) => entry.coupon.code === normalised);
		if (offer && !offer.evaluation.ok) return { ok: false, error: offer.evaluation.reason };

		this.cart.couponCode = coupon.code;
		this.persist();
		return { ok: true };
	}

	removeCoupon(): void {
		this.cart.couponCode = null;
		this.persist();
	}

	/**
	 * Drop a coupon that stopped being valid after a cart change.
	 *
	 * The brief requires this: "applied then cart changed so it becomes invalid (must
	 * auto-remove with a message)". Pricing already reports the failure, so this just acts
	 * on it and tells the user.
	 */
	#revalidateCoupon(): void {
		if (!this.cart.couponCode) return;
		const coupon = this.coupons.find((entry) => entry.code === this.cart.couponCode);
		if (!coupon) {
			this.cart.couponCode = null;
			return;
		}
		const result = priceCart({
			cart: this.cart,
			restaurant: this.cartRestaurant,
			coupon,
			usedCoupons: this.usedCoupons,
			orderCount: this.orderCount,
			now: Date.now()
		});
		if (result.couponError) {
			const code = this.cart.couponCode;
			this.cart.couponCode = null;
			this.toast(`${code} was removed: ${result.couponError}`, 'warning');
		}
	}

	// =====================================================================
	// Addresses
	// =====================================================================

	defaultAddress = $derived(
		this.addresses.find((address) => address.isDefault) ?? this.addresses[0] ?? null
	);

	addAddress(address: Omit<Address, 'id'>): Address {
		const entry: Address = { ...address, id: makeId('addr') };
		// The first address is always the default, whatever the form said.
		if (this.addresses.length === 0) entry.isDefault = true;
		if (entry.isDefault) {
			for (const existing of this.addresses) existing.isDefault = false;
		}
		this.addresses.push(entry);
		this.persist();
		return entry;
	}

	updateAddress(id: string, patch: Partial<Address>): void {
		const index = this.addresses.findIndex((address) => address.id === id);
		if (index === -1) return;
		const next = { ...this.addresses[index], ...patch, id };
		if (next.isDefault) {
			for (const address of this.addresses) address.isDefault = false;
		}
		this.addresses[index] = next;
		// Deleting/unsetting the last default must leave one behind.
		if (!this.addresses.some((address) => address.isDefault) && this.addresses[0]) {
			this.addresses[0].isDefault = true;
		}
		this.persist();
	}

	/**
	 * Delete an address.
	 *
	 * Deleting the DEFAULT address promotes the next one, so checkout never ends up with
	 * addresses but no default (a crash the brief explicitly asks to be tested).
	 */
	deleteAddress(id: string): void {
		const wasDefault = this.addresses.find((address) => address.id === id)?.isDefault ?? false;
		this.addresses = this.addresses.filter((address) => address.id !== id);
		if (wasDefault && this.addresses.length > 0) this.addresses[0].isDefault = true;
		this.persist();
	}

	setDefaultAddress(id: string): void {
		for (const address of this.addresses) address.isDefault = address.id === id;
		this.persist();
	}

	// =====================================================================
	// Orders
	// =====================================================================

	/**
	 * Place the current cart as an order and clear the cart.
	 *
	 * Returns the created order, or null when the cart is not orderable. The caller
	 * disables its button, but this is the real guard against double submission: once the
	 * cart is empty a second call cannot create a second order.
	 */
	placeOrder(input: {
		address: Address;
		payment: PaymentMethod;
		scheduledFor: string | null;
		instructions: string;
	}): Order | null {
		const restaurant = this.cartRestaurant;
		const lines = this.cart.lines.filter((line) => line.quantity > 0);
		if (!restaurant || lines.length === 0) return null;
		// Out-of-stock or withdrawn items must be resolved before ordering.
		if (this.cartIssues.some((issue) => issue.kind !== 'price-changed')) return null;

		const now = Date.now();
		const price = this.price;
		const id = makeId('order');
		const etaMinutes = restaurant.deliveryMinutes;

		const order: Order = {
			id,
			restaurantId: restaurant.id,
			restaurantName: restaurant.name,
			lines: $state.snapshot(lines) as CartLine[],
			address: { ...input.address, instructions: input.instructions || input.address.instructions },
			payment: input.payment,
			couponCode: price.appliedCode,
			// Freeze the bill: the receipt must keep showing what was actually paid.
			price: {
				itemTotalPaise: price.itemTotalPaise,
				packagingPaise: price.packagingPaise,
				deliveryFeePaise: price.deliveryFeePaise,
				deliveryFeeWaived: price.deliveryFeeWaived,
				taxPaise: price.taxPaise,
				discountPaise: price.discountPaise,
				tipPaise: price.tipPaise,
				totalPaise: price.totalPaise,
				distanceKm: price.distanceKm
			},
			status: 'placed',
			placedAt: now,
			timeline: [{ status: 'placed', at: now }],
			etaAt: now + etaMinutes * 60 * 1000,
			scheduledFor: input.scheduledFor,
			partner: partnerFor(id),
			cancelledReason: null
		};

		this.orders.unshift(order);
		if (price.appliedCode && !this.usedCoupons.includes(price.appliedCode)) {
			this.usedCoupons.push(price.appliedCode);
		}
		// The cart clears ONLY after a successful order (brief requirement).
		this.cart = emptyCart();
		this.flush();
		return order;
	}

	order(id: string | null | undefined): Order | null {
		if (!id) return null;
		return this.orders.find((order) => order.id === id) ?? null;
	}

	/** The most recent order that is still on its way, for the "track order" banner. */
	activeOrder = $derived.by(() => {
		for (const order of this.orders) {
			const status = statusAt(order, this.clock);
			if (status !== 'delivered' && status !== 'cancelled') return order;
		}
		return null;
	});

	/**
	 * Advance an order's recorded status to whatever the clock says.
	 *
	 * The tracking page calls this on each tick. Status is derived from elapsed time, so
	 * this only WRITES the derived value into the record (for history and for the owner
	 * view); it can never move an order backwards.
	 */
	syncOrderStatus(id: string): void {
		const order = this.orders.find((entry) => entry.id === id);
		if (!order || order.status === 'cancelled') return;
		const next = statusAt(order, Date.now());
		if (next === order.status) return;
		order.status = next;
		if (!order.timeline.some((entry) => entry.status === next)) {
			order.timeline.push({ status: next, at: Date.now() });
		}
		this.persist();
	}

	cancelOrder(id: string, reason: string): boolean {
		const order = this.orders.find((entry) => entry.id === id);
		if (!order) return false;
		const status = statusAt(order, Date.now());
		if (status !== 'placed' && status !== 'confirmed') return false;
		order.status = 'cancelled';
		order.cancelledReason = reason;
		order.timeline.push({ status: 'cancelled', at: Date.now() });
		this.persist();
		return true;
	}

	/** Owner view: push an order forward one step by hand. */
	advanceOrder(id: string, status: OrderStatus): void {
		const order = this.orders.find((entry) => entry.id === id);
		if (!order || order.status === 'cancelled') return;
		order.status = status;
		order.ownerTouched = true;
		if (!order.timeline.some((entry) => entry.status === status)) {
			order.timeline.push({ status, at: Date.now() });
		}
		this.persist();
	}

	/**
	 * Rebuild the cart from a past order.
	 *
	 * Reports what could not be restored (withdrawn dishes, out-of-stock dishes, changed
	 * prices) instead of quietly charging the new price, and refreshes every surviving
	 * line to the CURRENT price so the cart and the menu agree.
	 */
	reorder(orderId: string): {
		ok: boolean;
		added: number;
		unavailable: string[];
		priceChanged: { name: string; fromPaise: number; toPaise: number }[];
	} {
		const order = this.orders.find((entry) => entry.id === orderId);
		if (!order) return { ok: false, added: 0, unavailable: [], priceChanged: [] };

		const unavailable: string[] = [];
		const priceChanged: { name: string; fromPaise: number; toPaise: number }[] = [];
		const lines: CartLine[] = [];

		for (const line of order.lines) {
			const dish = this.dishIndex.get(line.dishId);
			if (!dish || !this.isAvailable(line.dishId)) {
				unavailable.push(line.name);
				continue;
			}
			if (dish.pricePaise !== line.basePricePaise) {
				priceChanged.push({ name: dish.name, fromPaise: line.basePricePaise, toPaise: dish.pricePaise });
			}
			lines.push({
				...$state.snapshot(line),
				// Always re-price from the live menu.
				basePricePaise: dish.pricePaise,
				name: dish.name,
				veg: dish.veg,
				art: dish.art
			});
		}

		if (lines.length === 0) return { ok: false, added: 0, unavailable, priceChanged };

		this.cart = {
			restaurantId: order.restaurantId,
			lines,
			couponCode: null,
			tipPaise: 0
		};
		this.persist();
		return { ok: true, added: lines.length, unavailable, priceChanged };
	}

	// =====================================================================
	// Reviews
	// =====================================================================

	reviewsFor(restaurantId: string): Review[] {
		return this.reviews
			.filter((review) => review.restaurantId === restaurantId)
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	/** Live rating for a restaurant: catalog baseline blended with the user's reviews. */
	ratingFor(restaurantId: string): RatingBreakdown {
		const restaurant = this.restaurantIndex.get(restaurantId);
		if (!restaurant) return { average: 0, count: 0, distribution: [0, 0, 0, 0, 0], exactAverage: 0 };
		return ratingBreakdown(restaurant.rating, restaurant.ratingCount, this.reviewsFor(restaurantId));
	}

	reviewForOrder(orderId: string): Review | null {
		return this.reviews.find((review) => review.orderId === orderId) ?? null;
	}

	addReview(input: Omit<Review, 'id' | 'createdAt' | 'authorName'> & { authorName?: string }): Review {
		// One review per order: re-rating replaces the previous one rather than stacking.
		this.reviews = this.reviews.filter((review) => review.orderId !== input.orderId);
		const review: Review = {
			...input,
			id: makeId('review'),
			createdAt: Date.now(),
			authorName: input.authorName || this.profile.name || 'FoodRush customer'
		};
		this.reviews.unshift(review);
		if (!this.ratedOrders.includes(input.orderId)) this.ratedOrders.push(input.orderId);
		this.persist();
		return review;
	}

	dismissRating(orderId: string): void {
		if (!this.ratedOrders.includes(orderId)) this.ratedOrders.push(orderId);
		this.persist();
	}

	/** A delivered order with no review yet - drives the "Rate your order" prompt. */
	pendingRatingOrder = $derived.by(() => {
		for (const order of this.orders) {
			if (statusAt(order, this.clock) !== 'delivered') continue;
			if (this.ratedOrders.includes(order.id)) continue;
			return order;
		}
		return null;
	});

	// =====================================================================
	// Favourites
	// =====================================================================

	isFavouriteRestaurant(id: string): boolean {
		return this.favourites.restaurants.includes(id);
	}

	isFavouriteDish(id: string): boolean {
		return this.favourites.dishes.includes(id);
	}

	toggleFavouriteRestaurant(id: string): void {
		const list = this.favourites.restaurants;
		const index = list.indexOf(id);
		if (index === -1) list.push(id);
		else list.splice(index, 1);
		this.persist();
	}

	toggleFavouriteDish(id: string): void {
		const list = this.favourites.dishes;
		const index = list.indexOf(id);
		if (index === -1) list.push(id);
		else list.splice(index, 1);
		this.persist();
	}

	// =====================================================================
	// Owner view
	// =====================================================================

	/** Orders for the owner's restaurant, newest first. */
	ordersForRestaurant(restaurantId: string): Order[] {
		return this.orders.filter((order) => order.restaurantId === restaurantId);
	}

	setDishAvailability(dishId: string, available: boolean): void {
		const dish = this.dishIndex.get(dishId);
		if (!dish) return;
		if (dish.available === available) {
			// Back to the catalog default: drop the override instead of storing a no-op.
			const { [dishId]: _removed, ...rest } = this.availability;
			this.availability = rest;
		} else {
			this.availability = { ...this.availability, [dishId]: available };
		}
		// An out-of-stock dish must disappear from the live cart too.
		if (!available) {
			const affected = this.cart.lines.filter((line) => line.dishId === dishId);
			if (affected.length > 0) {
				this.cart.lines = this.cart.lines.filter((line) => line.dishId !== dishId);
				if (this.cart.lines.length === 0) {
					this.cart.restaurantId = null;
					this.cart.couponCode = null;
				}
				this.toast(`${dish.name} went out of stock and was removed from your cart.`, 'warning');
			}
		}
		this.#revalidateCoupon();
		this.persist();
	}

	// =====================================================================
	// Settings, location, profile
	// =====================================================================

	setTheme(theme: Theme): void {
		this.settings.theme = theme;
		saveTheme(theme);
		this.#syncTheme();
		this.persist();
	}

	#syncTheme(): void {
		if (!browser) return;
		const dark =
			this.settings.theme === 'dark' ||
			(this.settings.theme === 'system' &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
	}

	setVegOnly(vegOnly: boolean): void {
		this.settings.vegOnly = vegOnly;
		this.persist();
	}

	setReduceMotion(reduceMotion: boolean): void {
		this.settings.reduceMotion = reduceMotion;
		this.persist();
	}

	setLocation(areaId: string | null, label: string, fromDevice = false): void {
		this.location = { areaId, label, fromDevice };
		this.persist();
	}

	updateProfile(patch: Partial<typeof this.profile>): void {
		this.profile = { ...this.profile, ...patch };
		this.persist();
	}

	// =====================================================================
	// Toasts, backup, reset
	// =====================================================================

	toast(message: string, tone: Toast['tone'] = 'info'): void {
		const id = ++this.#toastSeq;
		this.toasts.push({ id, message, tone });
		if (browser) {
			setTimeout(() => {
				this.toasts = this.toasts.filter((entry) => entry.id !== id);
			}, 4200);
		}
	}

	dismissToast(id: number): void {
		this.toasts = this.toasts.filter((entry) => entry.id !== id);
	}

	exportJson(): string {
		return exportBackup(this.snapshot());
	}

	importJson(text: string): { ok: true } | { ok: false; error: string } {
		const result = parseBackup(text);
		if (!result.ok) return result;
		this.#apply(result.state);
		this.flush();
		this.#syncTheme();
		return { ok: true };
	}

	resetAll(): void {
		clearState();
		this.#apply(emptyState());
		this.#syncTheme();
		this.flush();
	}
}


/** The single shared instance. Importing this anywhere gets the same state. */
export const app = new AppStore();
