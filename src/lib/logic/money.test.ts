import { describe, expect, it } from 'vitest';
import { clampPaise, formatPaise, groupIndian, parseRupees, percentOf, rupeesOf } from './money';

describe('percentOf', () => {
	it('rounds half up on the paise', () => {
		// 33% of ₹1.00 = 33 paise exactly.
		expect(percentOf(100, 33)).toBe(33);
		// 50% of 25 paise = 12.5 -> 13.
		expect(percentOf(25, 50)).toBe(13);
		// 5% GST on ₹249 = ₹12.45.
		expect(percentOf(24900, 5)).toBe(1245);
	});

	it('is exact for the float-trap cases', () => {
		// 0.1 + 0.2 territory: 10% of ₹0.30 must be 3 paise, not 2.9999.
		expect(percentOf(30, 10)).toBe(3);
		expect(percentOf(2010, 5)).toBe(101);
	});

	it('returns 0 for non-finite inputs instead of NaN', () => {
		expect(percentOf(Number.NaN, 5)).toBe(0);
		expect(percentOf(100, Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('clampPaise', () => {
	it('floors at zero and returns integers', () => {
		expect(clampPaise(-500)).toBe(0);
		expect(clampPaise(12.4)).toBe(12);
		expect(clampPaise(Number.NaN)).toBe(0);
	});
});

describe('groupIndian', () => {
	it('groups in the lakh/crore style', () => {
		expect(groupIndian(0)).toBe('0');
		expect(groupIndian(999)).toBe('999');
		expect(groupIndian(1000)).toBe('1,000');
		expect(groupIndian(99999)).toBe('99,999');
		expect(groupIndian(123456)).toBe('1,23,456');
		expect(groupIndian(1234567)).toBe('12,34,567');
		expect(groupIndian(12345678)).toBe('1,23,45,678');
	});
});

describe('formatPaise', () => {
	it('shows whole rupees without decimals', () => {
		expect(formatPaise(24900)).toBe('₹249');
		expect(formatPaise(0)).toBe('₹0');
	});

	it('shows paise when they are non-zero', () => {
		expect(formatPaise(1245)).toBe('₹12.45');
		expect(formatPaise(100_05)).toBe('₹100.05');
	});

	it('can force decimals for bill lines', () => {
		expect(formatPaise(24900, { decimals: true })).toBe('₹249.00');
	});

	it('uses lakh grouping for big totals', () => {
		expect(formatPaise(12_34_567_00)).toBe('₹12,34,567');
	});

	it('handles negatives and garbage without throwing', () => {
		expect(formatPaise(-5000)).toBe('-₹50');
		expect(formatPaise(Number.NaN)).toBe('₹0');
	});
});

describe('parseRupees', () => {
	it('parses plain and formatted rupee strings', () => {
		expect(parseRupees('249')).toBe(24900);
		expect(parseRupees('₹1,234.50')).toBe(123450);
		expect(parseRupees('0.05')).toBe(5);
		expect(parseRupees('12.5')).toBe(1250);
	});

	it('rejects nonsense', () => {
		expect(parseRupees('')).toBeNull();
		expect(parseRupees('abc')).toBeNull();
		expect(parseRupees('1.234')).toBeNull();
		expect(parseRupees('-50')).toBeNull();
	});
});

describe('rupeesOf', () => {
	it('rounds to whole rupees for compact display', () => {
		expect(rupeesOf(24900)).toBe(249);
		expect(rupeesOf(24949)).toBe(249);
		expect(rupeesOf(24950)).toBe(250);
	});
});
