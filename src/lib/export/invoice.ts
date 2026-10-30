/**
 * Dependency-free PDF invoice writer, with an EMBEDDED font.
 *
 * FoodRush ships no PDF library: a one-page A4 invoice is a few text runs and lines, and
 * pulling in ~400 KB of pdf-lib for that would be the wrong trade in a static app.
 *
 * MONEY RENDERS AS ₹. Earlier revisions printed "Rs." because the base-14 PDF fonts are
 * WinAnsi-encoded and have no U+20B9 glyph - emitting it produced a blank box. This writer
 * embeds a subset of Noto Sans (vendored under `vendor/fonts/`, SIL OFL) that contains the
 * glyph, as a CIDFontType2 with Identity-H encoding. Consequences worth knowing:
 *
 *   - text in the content stream is 2-byte GLYPH IDS, not characters, so all encoding goes
 *     through `encode()` in ./pdf-font.ts;
 *   - a /ToUnicode CMap is written so the PDF stays searchable and copy-pasteable;
 *   - the font bytes are a binary stream, so the PDF is assembled as BYTES throughout
 *     rather than as a latin-1 string.
 *
 * Indian lakh/crore grouping is unchanged - it comes from `formatPaise` in logic/money.ts,
 * which this module does not reimplement.
 */

import type { Order } from '../types';
import { formatPaise } from '../logic/money';
import { formatWhen, orderReference } from '../logic/orders';
import {
	encode,
	fitText,
	glyphsUsed,
	loadInvoiceFont,
	widthOf,
	type InvoiceFont,
	type WeightMetrics
} from './pdf-font';

interface TextRun {
	x: number;
	y: number;
	size: number;
	text: string;
	bold?: boolean;
	/** 0..1 grey. */
	grey?: number;
	/** Right-align the run so its RIGHT edge sits at `x`. */
	align?: 'left' | 'right';
}

interface Line {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	grey?: number;
}

const FONT_REGULAR = 'F1';
const FONT_BOLD = 'F2';

/** Build the page content stream. Text is emitted as Identity-H hex strings. */
function buildContent(runs: TextRun[], lines: Line[], font: InvoiceFont): string {
	const parts: string[] = [];

	for (const line of lines) {
		const grey = line.grey ?? 0.8;
		parts.push(`${grey} G 0.7 w ${line.x1} ${line.y1} m ${line.x2} ${line.y2} l S`);
	}

	for (const run of runs) {
		const weight = run.bold ? font.bold : font.regular;
		const grey = run.grey ?? 0;
		const x = run.align === 'right' ? run.x - widthOf(run.text, weight.metrics, run.size) : run.x;
		parts.push(
			`BT /${run.bold ? FONT_BOLD : FONT_REGULAR} ${run.size} Tf ${grey} g ` +
				`1 0 0 1 ${x.toFixed(2)} ${run.y} Tm <${encode(run.text, weight.metrics)}> Tj ET`
		);
	}

	return parts.join('\n');
}

/**
 * /ToUnicode CMap: maps glyph ids back to characters.
 *
 * Without this a reader can display the invoice but cannot search or copy from it - the
 * selection would come out as raw glyph indices.
 */
function toUnicodeCMap(used: Map<number, number>): string {
	const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
	const chunks: string[] = [];

	// bfchar sections are capped at 100 entries each by the spec.
	for (let index = 0; index < entries.length; index += 100) {
		const slice = entries.slice(index, index + 100);
		const body = slice
			.map(([gid, codepoint]) => {
				let target: string;
				if (codepoint > 0xffff) {
					// Astral codepoints are expressed as a UTF-16 surrogate pair.
					const value = codepoint - 0x10000;
					const high = 0xd800 + (value >> 10);
					const low = 0xdc00 + (value & 0x3ff);
					target = `${high.toString(16).padStart(4, '0')}${low.toString(16).padStart(4, '0')}`;
				} else {
					target = codepoint.toString(16).padStart(4, '0');
				}
				return `<${gid.toString(16).padStart(4, '0')}> <${target}>`;
			})
			.join('\n');
		chunks.push(`${slice.length} beginbfchar\n${body}\nendbfchar`);
	}

	return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

/** Latin-1 bytes for the ASCII/structural parts of the PDF. */
function ascii(text: string): Uint8Array {
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
	return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

interface PdfObject {
	/** ASCII dictionary/body. */
	body: string;
	/** Optional binary stream appended between `stream` and `endstream`. */
	stream?: Uint8Array;
}

/**
 * Assemble objects into a byte-correct PDF with a real xref table.
 *
 * Offsets are measured in BYTES (not string length), which matters because the embedded
 * font streams are binary.
 */
function assemble(objects: PdfObject[]): Blob {
	const chunks: Uint8Array[] = [ascii('%PDF-1.4\n')];
	// A binary comment line marks the file as containing binary data, so transfer agents
	// do not mangle the font streams.
	chunks.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

	let offset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const offsets: number[] = [];

	for (const [index, object] of objects.entries()) {
		offsets.push(offset);
		const header = ascii(`${index + 1} 0 obj\n${object.body}\n`);
		chunks.push(header);
		offset += header.length;

		if (object.stream) {
			const open = ascii('stream\n');
			const close = ascii('\nendstream\n');
			chunks.push(open, object.stream, close);
			offset += open.length + object.stream.length + close.length;
		}

		const footer = ascii('endobj\n');
		chunks.push(footer);
		offset += footer.length;
	}

	const xrefOffset = offset;
	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const entry of offsets) xref += `${String(entry).padStart(10, '0')} 00000 n \n`;
	xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
	chunks.push(ascii(xref));

	// `.buffer` rather than the view itself: TypeScript's BlobPart does not accept a
	// Uint8Array<ArrayBufferLike>, and `concat` always returns an exactly-sized array so the
	// whole buffer is the payload.
	return new Blob([concat(chunks).buffer as ArrayBuffer], { type: 'application/pdf' });
}

/**
 * Build the invoice PDF for an order.
 *
 * Async because the embedded font is fetched from `static/fonts/`. It is cached after the
 * first call, so a second invoice is immediate.
 */
export async function invoicePdf(order: Order): Promise<Blob> {
	const font = await loadInvoiceFont();
	const regular: WeightMetrics = font.regular.metrics;
	const bold: WeightMetrics = font.bold.metrics;

	const runs: TextRun[] = [];
	const lines: Line[] = [];
	const left = 56;
	const right = 539;
	let y = 790;

	// --- header ---------------------------------------------------------
	runs.push({ x: left, y, size: 22, text: 'FoodRush', bold: true });
	runs.push({
		x: right,
		y,
		size: 9,
		text: 'TAX INVOICE (DEMO)',
		bold: true,
		grey: 0.45,
		align: 'right'
	});
	y -= 16;
	runs.push({ x: left, y, size: 9, text: 'Hungry? Order in minutes.', grey: 0.45 });
	y -= 24;
	lines.push({ x1: left, y1: y, x2: right, y2: y });
	y -= 22;

	// --- order summary ---------------------------------------------------
	runs.push({ x: left, y, size: 11, text: `Order ${orderReference(order.id)}`, bold: true });
	runs.push({
		x: right,
		y,
		size: 9,
		text: formatWhen(order.placedAt, order.placedAt),
		grey: 0.35,
		align: 'right'
	});
	y -= 16;
	runs.push({ x: left, y, size: 10, text: order.restaurantName, bold: true });
	y -= 14;
	runs.push({ x: left, y, size: 9, text: `Status: ${order.status}`, grey: 0.35 });
	y -= 22;

	// --- delivery address -------------------------------------------------
	runs.push({ x: left, y, size: 9, text: 'DELIVERED TO', bold: true, grey: 0.45 });
	y -= 13;
	runs.push({ x: left, y, size: 9, text: `${order.address.name} - ${order.address.phone}` });
	y -= 12;
	runs.push({
		x: left,
		y,
		size: 9,
		text: `${order.address.line1}${order.address.line2 ? `, ${order.address.line2}` : ''}`
	});
	y -= 12;
	runs.push({
		x: left,
		y,
		size: 9,
		text: `${order.address.area}, ${order.address.city} ${order.address.pin}`
	});
	y -= 24;

	// --- items table -------------------------------------------------------
	const qtyColumn = 420;
	const amountColumn = right;
	const itemColumnWidth = 330;

	lines.push({ x1: left, y1: y + 12, x2: right, y2: y + 12 });
	runs.push({ x: left, y, size: 9, text: 'ITEM', bold: true, grey: 0.45 });
	runs.push({ x: qtyColumn, y, size: 9, text: 'QTY', bold: true, grey: 0.45, align: 'right' });
	runs.push({
		x: amountColumn,
		y,
		size: 9,
		text: 'AMOUNT',
		bold: true,
		grey: 0.45,
		align: 'right'
	});
	y -= 6;
	lines.push({ x1: left, y1: y, x2: right, y2: y });
	y -= 16;

	for (const line of order.lines) {
		const unit =
			line.basePricePaise + line.options.reduce((sum, option) => sum + option.deltaPaise, 0);
		// Trim with real metrics so a long dish name is cut exactly where it overflows.
		runs.push({ x: left, y, size: 9.5, text: fitText(line.name, regular, 9.5, itemColumnWidth) });
		runs.push({ x: qtyColumn, y, size: 9.5, text: String(line.quantity), align: 'right' });
		runs.push({
			x: amountColumn,
			y,
			size: 9.5,
			text: formatPaise(unit * line.quantity, { decimals: true }),
			align: 'right'
		});
		y -= 13;

		if (line.options.length > 0) {
			const options = line.options.map((option) => option.choiceName).join(', ');
			runs.push({
				x: left + 10,
				y,
				size: 8,
				text: fitText(options, regular, 8, itemColumnWidth - 10),
				grey: 0.45
			});
			y -= 11;
		}
		if (line.instructions) {
			runs.push({
				x: left + 10,
				y,
				size: 8,
				text: fitText(`Note: ${line.instructions}`, regular, 8, itemColumnWidth - 10),
				grey: 0.45
			});
			y -= 11;
		}
		y -= 3;
	}

	y -= 4;
	lines.push({ x1: left, y1: y, x2: right, y2: y });
	y -= 18;

	// --- bill breakdown ----------------------------------------------------
	const labelColumn = 330;
	const billRows: [string, string][] = [
		['Item total', formatPaise(order.price.itemTotalPaise, { decimals: true })]
	];
	if (order.price.discountPaise > 0) {
		billRows.push([
			`Coupon discount${order.couponCode ? ` (${order.couponCode})` : ''}`,
			`- ${formatPaise(order.price.discountPaise, { decimals: true })}`
		]);
	}
	billRows.push([
		`Delivery fee (${order.price.distanceKm} km)`,
		order.price.deliveryFeeWaived
			? 'FREE'
			: formatPaise(order.price.deliveryFeePaise, { decimals: true })
	]);
	billRows.push(['Packaging charge', formatPaise(order.price.packagingPaise, { decimals: true })]);
	billRows.push(['Taxes (GST)', formatPaise(order.price.taxPaise, { decimals: true })]);
	if (order.price.tipPaise > 0) {
		billRows.push(['Delivery tip', formatPaise(order.price.tipPaise, { decimals: true })]);
	}

	for (const [label, value] of billRows) {
		runs.push({ x: labelColumn, y, size: 9.5, text: label });
		runs.push({ x: amountColumn, y, size: 9.5, text: value, align: 'right' });
		y -= 14;
	}

	y -= 2;
	lines.push({ x1: labelColumn, y1: y + 8, x2: right, y2: y + 8, grey: 0.3 });
	y -= 6;
	runs.push({ x: labelColumn, y, size: 12, text: 'Total paid', bold: true });
	runs.push({
		x: amountColumn,
		y,
		size: 12,
		text: formatPaise(order.price.totalPaise, { decimals: true }),
		bold: true,
		align: 'right'
	});
	y -= 30;

	runs.push({
		x: left,
		y,
		size: 8,
		text: 'This is a demonstration invoice from a sample app. No goods were supplied and no payment was taken.',
		grey: 0.45
	});
	y -= 11;
	runs.push({ x: left, y, size: 8, text: 'Amounts are in Indian rupees (₹).', grey: 0.45 });

	// --- assemble ----------------------------------------------------------
	const content = buildContent(runs, lines, font);

	// /ToUnicode per weight, covering exactly the glyphs each weight actually drew.
	const regularText = runs
		.filter((run) => !run.bold)
		.map((run) => run.text)
		.join('');
	const boldText = runs
		.filter((run) => run.bold)
		.map((run) => run.text)
		.join('');
	const regularCMap = toUnicodeCMap(glyphsUsed(regularText, regular));
	const boldCMap = toUnicodeCMap(glyphsUsed(boldText, bold));

	const contentBytes = ascii(content);

	/** /W maps CIDs (= glyph ids under Identity-H) to advance widths. */
	const widthsArray = (metrics: WeightMetrics): string => {
		const byGid = new Map<number, number>();
		for (const glyph of Object.values(metrics.glyphs)) byGid.set(glyph.gid, glyph.width);
		return [...byGid.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([gid, width]) => `${gid} [${width}]`)
			.join(' ');
	};

	const descriptor = (metrics: WeightMetrics, fileObject: number, isBold: boolean): string =>
		`<< /Type /FontDescriptor /FontName /${font.family}-${isBold ? 'Bold' : 'Regular'} ` +
		`/Flags 32 /FontBBox [${metrics.bbox.join(' ')}] /ItalicAngle 0 ` +
		`/Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${metrics.capHeight} ` +
		`/StemV ${isBold ? 160 : 80} /FontFile2 ${fileObject} 0 R >>`;

	/*
	 * Object layout (1-indexed, referenced by the dictionaries below):
	 *   1 catalog           2 pages            3 page           4 content stream
	 *   5 regular Type0     6 regular CIDFont  7 regular descriptor
	 *   8 regular FontFile2 9 regular ToUnicode
	 *  10 bold Type0       11 bold CIDFont    12 bold descriptor
	 *  13 bold FontFile2   14 bold ToUnicode
	 */
	const objects: PdfObject[] = [
		{ body: '<< /Type /Catalog /Pages 2 0 R >>' },
		{ body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
		{
			body:
				'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ' +
				`/Resources << /Font << /${FONT_REGULAR} 5 0 R /${FONT_BOLD} 10 0 R >> >> /Contents 4 0 R >>`
		},
		{ body: `<< /Length ${contentBytes.length} >>`, stream: contentBytes },

		// regular
		{
			body:
				`<< /Type /Font /Subtype /Type0 /BaseFont /${font.family}-Regular ` +
				'/Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 9 0 R >>'
		},
		{
			body:
				`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.family}-Regular ` +
				'/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
				`/FontDescriptor 7 0 R /DW 1000 /W [${widthsArray(regular)}] /CIDToGIDMap /Identity >>`
		},
		{ body: descriptor(regular, 8, false) },
		{
			body: `<< /Length ${font.regular.bytes.length} /Length1 ${font.regular.bytes.length} >>`,
			stream: font.regular.bytes
		},
		{ body: `<< /Length ${ascii(regularCMap).length} >>`, stream: ascii(regularCMap) },

		// bold
		{
			body:
				`<< /Type /Font /Subtype /Type0 /BaseFont /${font.family}-Bold ` +
				'/Encoding /Identity-H /DescendantFonts [11 0 R] /ToUnicode 14 0 R >>'
		},
		{
			body:
				`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.family}-Bold ` +
				'/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
				`/FontDescriptor 12 0 R /DW 1000 /W [${widthsArray(bold)}] /CIDToGIDMap /Identity >>`
		},
		{ body: descriptor(bold, 13, true) },
		{
			body: `<< /Length ${font.bold.bytes.length} /Length1 ${font.bold.bytes.length} >>`,
			stream: font.bold.bytes
		},
		{ body: `<< /Length ${ascii(boldCMap).length} >>`, stream: ascii(boldCMap) }
	];

	return assemble(objects);
}

/** Suggested file name, e.g. FoodRush_Invoice_FR-7K2M9.pdf */
export function invoiceFileName(order: Order): string {
	return `FoodRush_Invoice_${orderReference(order.id)}.pdf`;
}
