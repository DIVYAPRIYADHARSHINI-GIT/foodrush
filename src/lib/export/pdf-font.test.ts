import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canRender, encode, fitText, glyphsUsed, widthOf, type WeightMetrics } from './pdf-font';

/**
 * These run against the REAL generated subset metrics, so they fail if `npm run fonts`
 * ever stops emitting a rupee glyph or renumbers the glyph ids the PDF writes.
 */
const manifest = JSON.parse(
	readFileSync(join(process.cwd(), 'static/fonts/noto-sans-invoice.json'), 'utf8')
) as { family: string; weights: Record<'regular' | 'bold', WeightMetrics> };

const regular = manifest.weights.regular;
const bold = manifest.weights.bold;
const RUPEE = '₹';
const RUPEE_CP = 0x20b9;

describe('generated font subset', () => {
	it('is Noto Sans with both weights', () => {
		expect(manifest.family).toBe('NotoSans');
		expect(regular).toBeTruthy();
		expect(bold).toBeTruthy();
	});

	it('CONTAINS the rupee glyph in both weights - the whole point of embedding it', () => {
		expect(regular.glyphs[String(RUPEE_CP)]).toBeTruthy();
		expect(bold.glyphs[String(RUPEE_CP)]).toBeTruthy();
		// Glyph 0 is .notdef; a rupee mapped there would render as an empty box.
		expect(regular.glyphs[String(RUPEE_CP)].gid).toBeGreaterThan(0);
		expect(bold.glyphs[String(RUPEE_CP)].gid).toBeGreaterThan(0);
	});

	it('gives the rupee a real advance width', () => {
		expect(regular.glyphs[String(RUPEE_CP)].width).toBeGreaterThan(200);
		expect(bold.glyphs[String(RUPEE_CP)].width).toBeGreaterThan(200);
	});

	it('covers every character the invoice can print', () => {
		// Digits, grouping punctuation, the rupee, and the typography FoodRush's copy uses.
		for (const character of '0123456789,.-/()₹x·—–“”…ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') {
			expect(canRender(character, regular), `regular cannot render ${character}`).toBe(true);
			expect(canRender(character, bold), `bold cannot render ${character}`).toBe(true);
		}
	});

	it('reports metrics the PDF font descriptor needs', () => {
		expect(regular.unitsPerEm).toBeGreaterThan(0);
		expect(regular.ascent).toBeGreaterThan(0);
		expect(regular.descent).toBeLessThan(0);
		expect(regular.bbox).toHaveLength(4);
		expect(regular.glyphCount).toBeGreaterThan(100);
	});
});

describe('encode', () => {
	it('emits 4 hex digits per character', () => {
		expect(encode('abc', regular)).toHaveLength(12);
		expect(/^[0-9a-f]+$/.test(encode('FoodRush ₹1,250', regular))).toBe(true);
	});

	it('encodes the rupee as its real glyph id, never .notdef', () => {
		const hex = encode(RUPEE, regular);
		expect(hex).toHaveLength(4);
		expect(hex).not.toBe('0000');
		expect(Number.parseInt(hex, 16)).toBe(regular.glyphs[String(RUPEE_CP)].gid);
	});

	it('round-trips a full money string', () => {
		const hex = encode('₹1,00,000.00', regular);
		const gids: number[] = [];
		for (let i = 0; i < hex.length; i += 4) gids.push(Number.parseInt(hex.slice(i, i + 4), 16));
		expect(gids).toHaveLength(12);
		// No character fell through to .notdef.
		expect(gids.every((gid) => gid > 0)).toBe(true);
	});

	it('substitutes "?" for characters the subset lacks rather than an empty box', () => {
		const question = encode('?', regular);
		// Devanagari is outside the invoice charset.
		expect(encode('न', regular)).toBe(question);
		// An emoji is one astral codepoint, so exactly one replacement glyph.
		expect(encode('🍛', regular)).toBe(question);
	});

	it('never emits glyph 0 for any input', () => {
		const hex = encode('न🍛 ₹49 ©', regular);
		for (let i = 0; i < hex.length; i += 4) {
			expect(hex.slice(i, i + 4)).not.toBe('0000');
		}
	});
});

describe('widthOf', () => {
	it('scales linearly with size', () => {
		const at10 = widthOf('₹1,250', regular, 10);
		const at20 = widthOf('₹1,250', regular, 20);
		expect(at20).toBeCloseTo(at10 * 2, 5);
	});

	it('measures the rupee as a real glyph, not zero', () => {
		expect(widthOf(RUPEE, regular, 10)).toBeGreaterThan(1);
	});

	it('agrees with encode about how many glyphs there are', () => {
		// Widths must cover exactly the glyphs encode() writes, or right-alignment drifts.
		const text = '₹1,00,000.00';
		const glyphCount = encode(text, regular).length / 4;
		expect(glyphCount).toBe([...text].length);
		expect(widthOf(text, regular, 9.5)).toBeGreaterThan(0);
	});

	it('is additive across concatenation', () => {
		const a = widthOf('Total paid', bold, 12);
		const b = widthOf(' ₹49.00', bold, 12);
		expect(widthOf('Total paid ₹49.00', bold, 12)).toBeCloseTo(a + b, 5);
	});
});

describe('glyphsUsed', () => {
	it('maps the rupee glyph back to U+20B9 for the /ToUnicode CMap', () => {
		const used = glyphsUsed('₹49', regular);
		const gid = regular.glyphs[String(RUPEE_CP)].gid;
		expect(used.get(gid)).toBe(RUPEE_CP);
	});

	it('includes every distinct glyph exactly once', () => {
		const used = glyphsUsed('aab', regular);
		expect(used.size).toBe(2);
	});
});

describe('fitText', () => {
	it('leaves short text alone', () => {
		expect(fitText('Masala Dosa', regular, 9.5, 300)).toBe('Masala Dosa');
	});

	it('truncates with an ellipsis when it overflows', () => {
		const long = 'Hyderabadi Chicken Dum Biryani with extra raita and mirchi ka salan on the side';
		const fitted = fitText(long, regular, 9.5, 120);
		expect(fitted.length).toBeLessThan(long.length);
		expect(fitted.endsWith('…')).toBe(true);
		expect(widthOf(fitted, regular, 9.5)).toBeLessThanOrEqual(120);
	});

	it('keeps the ellipsis renderable by the embedded font', () => {
		const fitted = fitText('A'.repeat(200), regular, 9.5, 60);
		expect(canRender(fitted, regular)).toBe(true);
	});
});
