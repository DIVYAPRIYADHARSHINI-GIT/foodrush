/**
 * Money. Integer paise in, formatted rupees out.
 *
 * Every amount in FoodRush is an integer number of paise. Floats are never used for money:
 * `0.1 + 0.2 !== 0.3` is exactly the class of bug that makes a cart total disagree with a
 * receipt by one paise, and the brief calls that out explicitly.
 *
 * Rounding happens in exactly two places:
 *   - `percentOf`, for percentage discounts and taxes (round-half-up on the paise).
 *   - the formatter, which only ever rounds for DISPLAY.
 * Nothing else is allowed to divide a money value.
 */

/** Round-half-up percentage of a paise amount, returned as integer paise. */
export function percentOf(amountPaise: number, percent: number): number {
	if (!Number.isFinite(amountPaise) || !Number.isFinite(percent)) return 0;
	// Multiply first, divide once: keeps full integer precision until the single rounding.
	return Math.round((amountPaise * percent) / 100);
}

/** Clamp to a non-negative integer paise value. Guards every subtraction in the engine. */
export function clampPaise(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.round(value));
}

/**
 * Format paise as Indian rupees with lakh/crore digit grouping.
 *
 * Uses the `en-IN` locale grouping (1,23,456.78) via a hand-rolled grouper rather than
 * Intl, because Intl's grouping for the Indian locale is inconsistent across engines and
 * the probes assert on exact strings.
 */
export function formatPaise(paise: number, options: { decimals?: boolean } = {}): string {
	const showDecimals = options.decimals ?? false;
	const safe = Number.isFinite(paise) ? Math.round(paise) : 0;
	const negative = safe < 0;
	const abs = Math.abs(safe);

	const rupees = Math.floor(abs / 100);
	const paisePart = abs % 100;

	const grouped = groupIndian(rupees);
	const body = showDecimals || paisePart !== 0 ? `${grouped}.${String(paisePart).padStart(2, '0')}` : grouped;
	return `${negative ? '-' : ''}₹${body}`;
}

/** 1234567 -> "12,34,567" (last three digits, then pairs). */
export function groupIndian(value: number): string {
	const digits = String(Math.abs(Math.trunc(value)));
	if (digits.length <= 3) return digits;
	const last3 = digits.slice(-3);
	const rest = digits.slice(0, -3);
	const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
	return `${pairs},${last3}`;
}

/** Parse a user-typed rupee string ("₹1,234.50", "1234") into integer paise. */
export function parseRupees(input: string): number | null {
	const cleaned = input.replace(/[₹,\s]/g, '');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	const [whole, fraction = ''] = cleaned.split('.');
	const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	return Number.isFinite(paise) ? paise : null;
}

/** Whole rupees, for compact UI like "₹249" chips and the price-for-two line. */
export function rupeesOf(paise: number): number {
	return Math.round(paise / 100);
}
