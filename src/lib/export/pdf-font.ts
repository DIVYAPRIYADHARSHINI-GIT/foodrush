/**
 * Embedded-font support for the PDF invoice.
 *
 * WHY THIS EXISTS: the invoice used to print "Rs." because the standard PDF base-14 fonts
 * (Helvetica et al.) are WinAnsi-encoded and have no glyph for U+20B9 (₹). Emitting the
 * character anyway produces a blank box in the reader. The fix is to embed a font that
 * actually contains the glyph.
 *
 * HOW: Noto Sans (SIL OFL, so redistributable) is vendored in `vendor/fonts/`, subset to
 * the invoice's character set by `scripts/make-fonts.mjs`, and written to `static/fonts/`
 * as REAL FILES - nothing is fetched from a CDN at build time or at runtime. The subsets
 * are ~15 KB each instead of the 629 KB originals.
 *
 * The font is embedded as a CIDFontType2 with Identity-H encoding, which means text in the
 * content stream is written as 2-byte GLYPH IDS rather than character codes. That is what
 * makes arbitrary Unicode printable; it also means this module owns the text encoding, so
 * `encode()` and `widthOf()` must always agree with each other.
 *
 * A /ToUnicode CMap is included so the rendered PDF is still searchable and copy-pasteable
 * - without it, selecting "₹1,250" in a reader would yield meaningless glyph indices.
 */

import { assetUrl } from '../paths';

export interface GlyphMetric {
	gid: number;
	width: number;
}

export interface WeightMetrics {
	file: string;
	unitsPerEm: number;
	ascent: number;
	descent: number;
	capHeight: number;
	bbox: [number, number, number, number];
	glyphCount: number;
	/** Codepoint (as a string key) -> glyph id + advance width in 1000-unit text space. */
	glyphs: Record<string, GlyphMetric>;
}

export interface FontManifest {
	family: string;
	weights: Record<'regular' | 'bold', WeightMetrics>;
}

export type FontWeight = 'regular' | 'bold';

/** A loaded weight: its metrics plus the raw TTF bytes to embed. */
export interface LoadedWeight {
	metrics: WeightMetrics;
	bytes: Uint8Array;
}

export interface InvoiceFont {
	family: string;
	regular: LoadedWeight;
	bold: LoadedWeight;
}

/** The character substituted when the font genuinely cannot draw something. */
const REPLACEMENT = '?';

let cached: Promise<InvoiceFont> | null = null;

/**
 * Fetch the subset metrics and TTF bytes.
 *
 * Cached for the page's lifetime: generating several invoices should not re-download the
 * font. A failure rejects loudly rather than silently falling back to a base-14 font,
 * because a silent fallback is exactly the "blank box" bug this module exists to prevent.
 */
export function loadInvoiceFont(): Promise<InvoiceFont> {
	if (cached) return cached;

	cached = (async () => {
		const manifestResponse = await fetch(assetUrl('/fonts/noto-sans-invoice.json'), {
			headers: { Accept: 'application/json' }
		});
		if (!manifestResponse.ok) {
			throw new Error(`invoice font metrics returned ${manifestResponse.status}`);
		}
		const manifestText = await manifestResponse.text();
		// Guard against a host serving the SPA fallback instead of a missing file.
		if (manifestText.trimStart().startsWith('<')) {
			throw new Error('invoice font metrics were served as HTML, not JSON');
		}
		const manifest = JSON.parse(manifestText) as FontManifest;

		const weights = await Promise.all(
			(['regular', 'bold'] as const).map(async (weight) => {
				const metrics = manifest.weights[weight];
				if (!metrics) throw new Error(`invoice font manifest has no "${weight}" weight`);
				const response = await fetch(assetUrl(metrics.file as `/${string}`));
				if (!response.ok) throw new Error(`${metrics.file} returned ${response.status}`);
				const bytes = new Uint8Array(await response.arrayBuffer());
				// A TrueType subset must start with the sfnt version 0x00010000.
				if (bytes.length < 12 || bytes[0] !== 0x00 || bytes[1] !== 0x01) {
					throw new Error(`${metrics.file} is not a TrueType font`);
				}
				return [weight, { metrics, bytes }] as const;
			})
		);

		const loaded = Object.fromEntries(weights) as Record<FontWeight, LoadedWeight>;

		// The whole point of the embedded font: it must be able to draw ₹.
		for (const weight of ['regular', 'bold'] as const) {
			if (!loaded[weight].metrics.glyphs[String(0x20b9)]) {
				throw new Error(`invoice font "${weight}" has no U+20B9 (rupee) glyph`);
			}
		}

		return { family: manifest.family, regular: loaded.regular, bold: loaded.bold };
	})();

	// Do not cache a failure: a transient network error should be retryable.
	cached.catch(() => {
		cached = null;
	});

	return cached;
}

function glyphFor(metrics: WeightMetrics, codepoint: number): GlyphMetric | null {
	return metrics.glyphs[String(codepoint)] ?? null;
}

/**
 * Encode a string as Identity-H hex: two bytes per glyph.
 *
 * Any codepoint the subset lacks falls back to '?' rather than glyph 0, because .notdef is
 * precisely the empty box we are trying to eliminate. Astral characters (emoji) are handled
 * through their surrogate pair, so one emoji yields one '?' and not two.
 */
export function encode(text: string, metrics: WeightMetrics): string {
	const fallback = glyphFor(metrics, REPLACEMENT.codePointAt(0) as number);
	let hex = '';
	for (const character of text) {
		const codepoint = character.codePointAt(0) as number;
		const glyph = glyphFor(metrics, codepoint) ?? fallback;
		if (!glyph) continue;
		hex += glyph.gid.toString(16).padStart(4, '0');
	}
	return hex;
}

/** Width of a string at a given size, in points. Mirrors `encode` exactly. */
export function widthOf(text: string, metrics: WeightMetrics, size: number): number {
	const fallback = glyphFor(metrics, REPLACEMENT.codePointAt(0) as number);
	let units = 0;
	for (const character of text) {
		const codepoint = character.codePointAt(0) as number;
		const glyph = glyphFor(metrics, codepoint) ?? fallback;
		if (!glyph) continue;
		units += glyph.width;
	}
	return (units * size) / 1000;
}

/** True when every character in `text` has a real glyph (no '?' substitution). */
export function canRender(text: string, metrics: WeightMetrics): boolean {
	for (const character of text) {
		if (!glyphFor(metrics, character.codePointAt(0) as number)) return false;
	}
	return true;
}

/** Glyph ids actually used by a string - used to build the /ToUnicode CMap. */
export function glyphsUsed(text: string, metrics: WeightMetrics): Map<number, number> {
	const used = new Map<number, number>();
	const fallback = glyphFor(metrics, REPLACEMENT.codePointAt(0) as number);
	for (const character of text) {
		const codepoint = character.codePointAt(0) as number;
		const glyph = glyphFor(metrics, codepoint);
		if (glyph) used.set(glyph.gid, codepoint);
		else if (fallback) used.set(fallback.gid, REPLACEMENT.codePointAt(0) as number);
	}
	return used;
}

/**
 * Trim a string to fit a width, appending an ellipsis.
 *
 * Measured with the real font metrics, so a long dish name is cut where it actually
 * overflows the column rather than at a guessed character count.
 */
export function fitText(text: string, metrics: WeightMetrics, size: number, maxWidth: number): string {
	if (widthOf(text, metrics, size) <= maxWidth) return text;
	const ellipsis = '…';
	const characters = [...text];
	let result = '';
	for (const character of characters) {
		if (widthOf(result + character + ellipsis, metrics, size) > maxWidth) break;
		result += character;
	}
	return `${result.trimEnd()}${ellipsis}`;
}
