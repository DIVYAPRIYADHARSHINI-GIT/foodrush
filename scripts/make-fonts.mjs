/**
 * Subsets Noto Sans down to the characters an invoice can actually print, and writes the
 * result to `static/fonts/` as real files plus one metrics JSON.
 *
 * WHY SUBSET: the full Noto Sans Regular + Bold are 629 KB + 631 KB. An invoice needs
 * about a hundred glyphs, so shipping the whole thing would mean a 1.2 MB download to
 * render one page of text. The subsets below come out around 10 KB each.
 *
 * WHY NOTO SANS: it contains U+20B9 (the Indian rupee sign) - the entire point of this
 * change - and is licensed under the SIL Open Font License, so it can be redistributed
 * inside the project. The TTFs are vendored in `vendor/fonts/`; nothing is fetched from a
 * CDN at build time or at runtime.
 *
 * WHAT IT EMITS, per weight:
 *   static/fonts/noto-sans-invoice-<weight>.ttf   bytes embedded into the PDF
 *   static/fonts/noto-sans-invoice.json           cmap + widths, so the browser never has
 *                                                 to parse a TTF at runtime
 *
 * The subset keeps ORIGINAL glyph ids remapped to a dense 0..N range, and the PDF uses
 * Identity-H with CIDToGIDMap /Identity - so the 2-byte codes written into the content
 * stream are exactly these dense ids.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor', 'fonts');
const OUT = join(ROOT, 'static', 'fonts');

/**
 * Characters the invoice can print.
 *
 * Printable ASCII covers names, addresses, dish names and numbers. The rest are the
 * typographic characters FoodRush's own copy uses (the rupee sign, the multiplication sign
 * in "x 2", the middot separator, dashes and curly quotes) plus Latin-1 accents, which show
 * up in real restaurant names. Anything outside this set is replaced with '?' at render
 * time rather than silently dropped - see `src/lib/export/pdf-font.ts`.
 */
function charset() {
	const codepoints = new Set();
	for (let cp = 0x20; cp <= 0x7e; cp += 1) codepoints.add(cp);
	// Latin-1 letters and symbols (accented names, degree, etc.).
	for (let cp = 0xa0; cp <= 0xff; cp += 1) codepoints.add(cp);
	for (const cp of [
		0x20b9, // ₹ INDIAN RUPEE SIGN - the reason this font is here
		0x2013, // – en dash
		0x2014, // — em dash
		0x2018, // ' left single quote
		0x2019, // ' right single quote
		0x201c, // " left double quote
		0x201d, // " right double quote
		0x2022, // • bullet
		0x20ac, // € euro
		0x2026 // … ellipsis
	]) {
		codepoints.add(cp);
	}
	return codepoints;
}

class Reader {
	constructor(buffer) {
		this.b = buffer;
	}
	u8(o) {
		return this.b.readUInt8(o);
	}
	u16(o) {
		return this.b.readUInt16BE(o);
	}
	i16(o) {
		return this.b.readInt16BE(o);
	}
	u32(o) {
		return this.b.readUInt32BE(o);
	}
}

function readTables(r) {
	const tables = {};
	const count = r.u16(4);
	for (let i = 0; i < count; i += 1) {
		const o = 12 + i * 16;
		tables[r.b.toString('ascii', o, o + 4)] = { offset: r.u32(o + 8), length: r.u32(o + 12) };
	}
	return tables;
}

/** Unicode -> original glyph id, from a format 4 cmap subtable. */
function readCmap(r, tables) {
	const base = tables.cmap.offset;
	let subtable = null;
	for (let i = 0; i < r.u16(base + 2); i += 1) {
		const rec = base + 4 + i * 8;
		const platform = r.u16(rec);
		const encoding = r.u16(rec + 2);
		const offset = r.u32(rec + 4);
		if (r.u16(base + offset) !== 4) continue;
		if ((platform === 3 && encoding === 1) || platform === 0) subtable = base + offset;
	}
	if (subtable === null) throw new Error('no format 4 unicode cmap subtable');

	const segX2 = r.u16(subtable + 6);
	const endO = subtable + 14;
	const startO = endO + segX2 + 2;
	const deltaO = startO + segX2;
	const rangeO = deltaO + segX2;

	return (cp) => {
		for (let s = 0; s < segX2 / 2; s += 1) {
			const end = r.u16(endO + s * 2);
			if (cp > end) continue;
			const start = r.u16(startO + s * 2);
			if (cp < start) return 0;
			const delta = r.i16(deltaO + s * 2);
			const rangeOffset = r.u16(rangeO + s * 2);
			if (rangeOffset === 0) return (cp + delta) & 0xffff;
			const gid = r.u16(rangeO + s * 2 + rangeOffset + (cp - start) * 2);
			return gid === 0 ? 0 : (gid + delta) & 0xffff;
		}
		return 0;
	};
}

function readLoca(r, tables, numGlyphs, longFormat) {
	const base = tables.loca.offset;
	const loca = new Array(numGlyphs + 1);
	for (let i = 0; i <= numGlyphs; i += 1) {
		loca[i] = longFormat ? r.u32(base + i * 4) : r.u16(base + i * 2) * 2;
	}
	return loca;
}

/** Advance widths from hmtx, in font units. */
function readWidths(r, tables, numGlyphs, numberOfHMetrics) {
	const base = tables.hmtx.offset;
	const widths = new Array(numGlyphs);
	let last = 0;
	for (let gid = 0; gid < numGlyphs; gid += 1) {
		if (gid < numberOfHMetrics) {
			last = r.u16(base + gid * 4);
			widths[gid] = last;
		} else {
			widths[gid] = last;
		}
	}
	return widths;
}

/**
 * Glyph ids a composite glyph depends on.
 *
 * A composite glyph (negative contour count) is assembled from other glyphs by index, so
 * those components must travel with the subset or the glyph renders empty. Accented Latin-1
 * characters are the usual case here.
 */
function componentsOf(r, tables, loca, gid) {
	const start = tables.glyf.offset + loca[gid];
	if (loca[gid + 1] - loca[gid] === 0) return [];
	if (r.i16(start) >= 0) return [];

	const components = [];
	let o = start + 10;
	for (;;) {
		const flags = r.u16(o);
		components.push({ flagsOffset: o, glyphIndexOffset: o + 2, index: r.u16(o + 2) });
		o += 4;
		o += flags & 1 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
		if (flags & 8) o += 2; // WE_HAVE_A_SCALE
		else if (flags & 0x40) o += 4; // X_AND_Y_SCALE
		else if (flags & 0x80) o += 8; // TWO_BY_TWO
		if (!(flags & 0x20)) break; // MORE_COMPONENTS
	}
	return components;
}

function subset(file, codepoints) {
	const r = new Reader(readFileSync(file));
	const tables = readTables(r);

	const unitsPerEm = r.u16(tables.head.offset + 18);
	const indexToLocFormat = r.i16(tables.head.offset + 50);
	const numGlyphs = r.u16(tables.maxp.offset + 4);
	const numberOfHMetrics = r.u16(tables.hhea.offset + 34);

	const lookup = readCmap(r, tables);
	const loca = readLoca(r, tables, numGlyphs, indexToLocFormat === 1);
	const widths = readWidths(r, tables, numGlyphs, numberOfHMetrics);

	// Resolve the needed original glyph ids, pulling in composite components recursively.
	const needed = new Set([0]); // .notdef must stay glyph 0
	const missing = [];
	const cpToOriginal = new Map();
	for (const cp of [...codepoints].sort((a, b) => a - b)) {
		const gid = lookup(cp);
		if (gid === 0) {
			missing.push(cp);
			continue;
		}
		cpToOriginal.set(cp, gid);
		needed.add(gid);
	}
	const stack = [...needed];
	while (stack.length > 0) {
		const gid = stack.pop();
		for (const component of componentsOf(r, tables, loca, gid)) {
			if (!needed.has(component.index)) {
				needed.add(component.index);
				stack.push(component.index);
			}
		}
	}

	// Dense remap: original gid -> new gid, with .notdef pinned at 0.
	const ordered = [...needed].sort((a, b) => a - b);
	const remap = new Map();
	for (const [index, gid] of ordered.entries()) remap.set(gid, index);

	// Rebuild glyf with component indices rewritten to the new ids.
	const glyphBuffers = [];
	for (const gid of ordered) {
		const start = tables.glyf.offset + loca[gid];
		const end = tables.glyf.offset + loca[gid + 1];
		if (end <= start) {
			glyphBuffers.push(Buffer.alloc(0));
			continue;
		}
		const data = Buffer.from(r.b.subarray(start, end));
		if (r.i16(start) < 0) {
			for (const component of componentsOf(r, tables, loca, gid)) {
				const mapped = remap.get(component.index);
				if (mapped === undefined) throw new Error(`component ${component.index} missing from subset`);
				data.writeUInt16BE(mapped, component.glyphIndexOffset - start);
			}
		}
		// Glyph data must be 2-byte aligned for the short loca format; long format does not
		// require it, but padding keeps offsets even and costs at most one byte per glyph.
		glyphBuffers.push(data.length % 2 === 0 ? data : Buffer.concat([data, Buffer.alloc(1)]));
	}

	const newNumGlyphs = ordered.length;
	const glyf = Buffer.concat(glyphBuffers);

	// loca in long format, so no offset can overflow.
	const newLoca = Buffer.alloc((newNumGlyphs + 1) * 4);
	let running = 0;
	for (const [index, buffer] of glyphBuffers.entries()) {
		newLoca.writeUInt32BE(running, index * 4);
		running += buffer.length;
	}
	newLoca.writeUInt32BE(running, newNumGlyphs * 4);

	// hmtx: a full long metric per glyph keeps it simple and consistent.
	const newHmtx = Buffer.alloc(newNumGlyphs * 4);
	for (const [index, gid] of ordered.entries()) {
		newHmtx.writeUInt16BE(widths[gid], index * 4);
		newHmtx.writeInt16BE(0, index * 4 + 2);
	}

	const head = Buffer.from(r.b.subarray(tables.head.offset, tables.head.offset + 54));
	head.writeInt16BE(1, 50); // indexToLocFormat = long
	head.writeUInt32BE(0, 8); // checkSumAdjustment is recomputed by nothing here; zero it

	const hhea = Buffer.from(r.b.subarray(tables.hhea.offset, tables.hhea.offset + 36));
	hhea.writeUInt16BE(newNumGlyphs, 34); // numberOfHMetrics

	const maxp = Buffer.from(r.b.subarray(tables.maxp.offset, tables.maxp.offset + 32));
	maxp.writeUInt16BE(newNumGlyphs, 4);

	const out = buildFont({ head, hhea, maxp, hmtx: newHmtx, loca: newLoca, glyf });

	// Metrics the PDF writer needs, in 1000-unit text space.
	const scale = 1000 / unitsPerEm;
	const glyphs = {};
	for (const [cp, original] of cpToOriginal) {
		glyphs[cp] = { gid: remap.get(original), width: Math.round(widths[original] * scale) };
	}

	return {
		bytes: out,
		missing,
		metrics: {
			unitsPerEm,
			ascent: Math.round(r.i16(tables.hhea.offset + 4) * scale),
			descent: Math.round(r.i16(tables.hhea.offset + 6) * scale),
			capHeight: Math.round(r.i16(tables.hhea.offset + 4) * scale * 0.72),
			bbox: [
				Math.round(r.i16(tables.head.offset + 36) * scale),
				Math.round(r.i16(tables.head.offset + 38) * scale),
				Math.round(r.i16(tables.head.offset + 40) * scale),
				Math.round(r.i16(tables.head.offset + 42) * scale)
			],
			glyphCount: newNumGlyphs,
			glyphs
		}
	};
}

/** Assemble tables into a valid sfnt with the required directory and checksums. */
function buildFont(tables) {
	const tags = Object.keys(tables).sort();
	const count = tags.length;
	// searchRange etc. are derived from the table count, per the sfnt spec.
	let entrySelector = 0;
	while (1 << (entrySelector + 1) <= count) entrySelector += 1;
	const searchRange = (1 << entrySelector) * 16;

	const header = Buffer.alloc(12 + count * 16);
	header.writeUInt32BE(0x00010000, 0); // sfnt version: TrueType outlines
	header.writeUInt16BE(count, 4);
	header.writeUInt16BE(searchRange, 6);
	header.writeUInt16BE(entrySelector, 8);
	header.writeUInt16BE(count * 16 - searchRange, 10);

	const padded = [];
	let offset = header.length;
	for (const [index, tag] of tags.entries()) {
		const data = tables[tag];
		const pad = (4 - (data.length % 4)) % 4;
		const block = pad === 0 ? data : Buffer.concat([data, Buffer.alloc(pad)]);
		const o = 12 + index * 16;
		header.write(tag.padEnd(4), o, 4, 'ascii');
		header.writeUInt32BE(checksum(block), o + 4);
		header.writeUInt32BE(offset, o + 8);
		header.writeUInt32BE(data.length, o + 12);
		padded.push(block);
		offset += block.length;
	}
	return Buffer.concat([header, ...padded]);
}

function checksum(buffer) {
	let sum = 0;
	for (let i = 0; i + 3 < buffer.length; i += 4) sum = (sum + buffer.readUInt32BE(i)) >>> 0;
	return sum;
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const codepoints = charset();
const weights = [
	{ key: 'regular', file: 'NotoSans-Regular.ttf' },
	{ key: 'bold', file: 'NotoSans-Bold.ttf' }
];

const manifest = { family: 'NotoSans', weights: {} };
for (const weight of weights) {
	const result = subset(join(VENDOR, weight.file), codepoints);
	const name = `noto-sans-invoice-${weight.key}.ttf`;
	writeFileSync(join(OUT, name), result.bytes);
	manifest.weights[weight.key] = { file: `/fonts/${name}`, ...result.metrics };

	const rupee = result.metrics.glyphs[0x20b9];
	if (!rupee) throw new Error(`${weight.file}: no U+20B9 glyph - wrong font for an invoice`);
	console.log(
		`${name}: ${(result.bytes.length / 1024).toFixed(1)} KB, ` +
			`${result.metrics.glyphCount} glyphs, rupee gid ${rupee.gid} width ${rupee.width}` +
			(result.missing.length > 0
				? `, ${result.missing.length} requested codepoints absent from the font`
				: '')
	);
}

writeFileSync(join(OUT, 'noto-sans-invoice.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
console.log(`noto-sans-invoice.json: metrics for ${Object.keys(manifest.weights).join(' + ')}`);
