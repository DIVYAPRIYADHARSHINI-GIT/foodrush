/**
 * FoodRush domain types.
 *
 * MONEY RULE, enforced everywhere: amounts are integer PAISE (1 rupee = 100 paise) and
 * every field holding money is suffixed `Paise`. No float rupee value is ever stored,
 * summed or compared - rounding happens once, inside `src/lib/logic/money.ts`, so the cart,
 * checkout, receipt and reorder can never disagree by a paise.
 *
 * TIME RULE: order timestamps are epoch milliseconds (an instant, because tracking counts
 * down against the wall clock), while opening hours are minutes-from-midnight (a civil
 * time, because "opens at 6:30am" is local and must not shift with a timezone).
 */

/** Bumped only when the persisted shape changes; see stores/storage.ts `migrate`. */
export const DATA_VERSION = 1;

export type Theme = 'light' | 'dark' | 'system';

// ---------------------------------------------------------------------------
// Catalog (read-only data shipped as JSON in static/data)
// ---------------------------------------------------------------------------

export interface OptionChoice {
	id: string;
	name: string;
	/** Added to the dish base price when selected. Integer paise, may be 0. */
	deltaPaise: number;
}

export interface OptionGroup {
	id: string;
	name: string;
	/** A required group must have at least `min` choices selected to add to cart. */
	required: boolean;
	min: number;
	max: number;
	choices: OptionChoice[];
}

export interface Dish {
	id: string;
	restaurantId: string;
	name: string;
	description: string;
	category: string;
	pricePaise: number;
	veg: boolean;
	bestseller: boolean;
	recommended: boolean;
	rating: number;
	ratingCount: number;
	serves: number;
	/** Key into static/img/dish/<art>.svg */
	art: string;
	optionGroups: OptionGroup[];
	/** Catalog default; the owner view can override it per dish at runtime. */
	available: boolean;
}

export interface OpeningHours {
	/** Minutes from midnight, local civil time. */
	open: number;
	close: number;
}

export interface Restaurant {
	id: string;
	name: string;
	cuisines: string[];
	area: string;
	address: string;
	/** Catalog rating. The live average also folds in the user's own reviews. */
	rating: number;
	ratingCount: number;
	deliveryMinutes: number;
	distanceKm: number;
	priceForTwoPaise: number;
	pureVeg: boolean;
	offerCodes: string[];
	hours: OpeningHours;
	categories: string[];
	art: string;
	tagline: string;
}

export type CouponKind = 'percent' | 'flat' | 'free-delivery';

export interface Coupon {
	code: string;
	title: string;
	description: string;
	kind: CouponKind;
	percent?: number;
	flatPaise?: number;
	maxDiscountPaise?: number;
	minOrderPaise: number;
	firstOrderOnly?: boolean;
	oncePerUser?: boolean;
	/** When set, the coupon only applies to that restaurant. */
	restaurantId: string | null;
	/** ISO date (YYYY-MM-DD); the coupon is dead from the next day. */
	expiresOn: string;
}

export interface Area {
	id: string;
	name: string;
	city: string;
	pin: string;
}

export interface Category {
	id: string;
	name: string;
	art: string;
}

export interface Catalog {
	restaurants: Restaurant[];
	menus: Record<string, Dish[]>;
	coupons: Coupon[];
	areas: Area[];
	categories: Category[];
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/** A chosen option, flattened for storage and for line-identity hashing. */
export interface SelectedOption {
	groupId: string;
	groupName: string;
	choiceId: string;
	choiceName: string;
	deltaPaise: number;
}

export interface CartLine {
	/** Stable per-line id: dishId + a hash of the selected options (see cart.ts). */
	id: string;
	dishId: string;
	restaurantId: string;
	name: string;
	veg: boolean;
	art: string;
	/** Dish base price captured when the line was added - used to detect price changes. */
	basePricePaise: number;
	options: SelectedOption[];
	quantity: number;
	instructions: string;
}

export interface Cart {
	restaurantId: string | null;
	lines: CartLine[];
	couponCode: string | null;
	tipPaise: number;
}

// ---------------------------------------------------------------------------
// Addresses, orders, ratings
// ---------------------------------------------------------------------------

export type AddressLabel = 'Home' | 'Work' | 'Other';

export interface Address {
	id: string;
	label: AddressLabel;
	name: string;
	phone: string;
	line1: string;
	line2: string;
	area: string;
	city: string;
	pin: string;
	landmark: string;
	instructions: string;
	isDefault: boolean;
}

export type PaymentMethod = 'upi' | 'card' | 'wallet' | 'cod';

export type OrderStatus =
	| 'placed'
	| 'confirmed'
	| 'preparing'
	| 'out-for-delivery'
	| 'delivered'
	| 'cancelled';

/** Progress rank - used to guarantee status never moves backwards. */
export const STATUS_RANK: Record<OrderStatus, number> = {
	placed: 0,
	confirmed: 1,
	preparing: 2,
	'out-for-delivery': 3,
	delivered: 4,
	// Cancelled is terminal and sits outside the forward chain.
	cancelled: 99
};

export const TRACKED_STATUSES: OrderStatus[] = [
	'placed',
	'confirmed',
	'preparing',
	'out-for-delivery',
	'delivered'
];

export interface DeliveryPartner {
	name: string;
	rating: number;
	vehicle: string;
	phone: string;
}

/**
 * A frozen copy of the bill at order time.
 *
 * The receipt must keep showing what the customer actually paid even if the menu price,
 * the delivery fee formula or the coupon changes later, so the order stores the computed
 * totals rather than recomputing them from the current catalog.
 */
export interface PriceBreakdown {
	itemTotalPaise: number;
	packagingPaise: number;
	deliveryFeePaise: number;
	deliveryFeeWaived: boolean;
	taxPaise: number;
	discountPaise: number;
	tipPaise: number;
	totalPaise: number;
	/** Distance used for the delivery fee, kept for the receipt's "why this fee" line. */
	distanceKm: number;
}

export interface Order {
	id: string;
	restaurantId: string;
	restaurantName: string;
	lines: CartLine[];
	address: Address;
	payment: PaymentMethod;
	couponCode: string | null;
	price: PriceBreakdown;
	status: OrderStatus;
	/** Epoch ms when the order was placed. */
	placedAt: number;
	/** Epoch ms for each status the order has reached, in order. */
	timeline: { status: OrderStatus; at: number }[];
	/** Epoch ms the order is expected to arrive. */
	etaAt: number;
	/** Scheduled slot label, or null for "deliver now". */
	scheduledFor: string | null;
	partner: DeliveryPartner;
	cancelledReason: string | null;
	/** Set when the owner view accepts/progresses the order instead of the simulator. */
	ownerTouched?: boolean;
}

export interface Review {
	id: string;
	orderId: string;
	restaurantId: string;
	foodRating: number;
	deliveryRating: number;
	tags: string[];
	text: string;
	createdAt: number;
	authorName: string;
}

export interface Profile {
	name: string;
	phone: string;
	email: string;
}

export interface Settings {
	theme: Theme;
	vegOnly: boolean;
	/** Language is a setting today; copy is English-only but the plumbing is in place. */
	language: 'en';
	reduceMotion: boolean;
}

export interface LocationState {
	areaId: string | null;
	label: string;
	/** True when the user granted geolocation, so the UI can say "using your location". */
	fromDevice: boolean;
}

export interface Favourites {
	restaurants: string[];
	dishes: string[];
}

/** Everything FoodRush writes to localStorage. */
export interface PersistedState {
	version: number;
	profile: Profile;
	settings: Settings;
	location: LocationState;
	cart: Cart;
	addresses: Address[];
	orders: Order[];
	reviews: Review[];
	favourites: Favourites;
	/** Coupon codes already redeemed, for the once-per-user rule. */
	usedCoupons: string[];
	/** Dish availability overrides from the owner view: dishId -> available. */
	availability: Record<string, boolean>;
	/** Orders whose rating prompt has been dismissed or answered. */
	ratedOrders: string[];
}
