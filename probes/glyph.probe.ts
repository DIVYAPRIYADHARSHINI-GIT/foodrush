/**
 * Pixel-level proof that the invoice PDF DRAWS the rupee glyph.
 *
 * The e2e suite proves the semantics: the glyph ids in the content stream map back to
 * U+20B9 through the embedded /ToUnicode CMap. That is necessary but not sufficient - a
 * reader could still paint an empty .notdef box if the embedded font program were broken.
 *
 * So this probe closes the loop visually:
 *   1. build a 200pt single-glyph PDF with the project's own font-embedding machinery,
 *   2. rasterise it with the OPERATING SYSTEM's PDF engine (macOS qlmanage / PDFKit) -
 *      an independent renderer, not the code under test,
 *   3. parse glyph 204's quadratic outline straight out of the subset TTF and redraw it
 *      from those raw coordinates via Path2D,
 *   4. correlate the two bitmaps.
 *
 * Ink volume alone cannot settle this, because Noto's .notdef is a hollow rectangle of
 * almost exactly the rupee's area - an earlier version of this check was fooled by that.
 * Shape correlation separates them cleanly: ~1.00 against the correct outline versus ~0.00
 * against the box.
 *
 * Skipped automatically where `qlmanage` is unavailable (i.e. not macOS), since the rest of
 * the suite already covers the semantics on every platform.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const FONT_DIR = join(ROOT, 'static', 'fonts');
const WORK = join(ROOT, 'probes', '.glyph-work');

/** qlmanage only exists on macOS; elsewhere these checks are skipped, not failed. */
function hasRenderer(): boolean {
	try {
		execFileSync('which', ['qlmanage'], { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

const RENDERER = hasRenderer();

interface Glyph {
	contours: { x: number; y: number; on: boolean }[][];
	bbox: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
}

/** Parse a simple (non-composite) glyph outline out of a TrueType `glyf` table. */
function readGlyph(ttf: Buffer, gid: number): Glyph {
	const u16 = (o: number) => ttf.readUInt16BE(o);
	const i16 = (o: number) => ttf.readInt16BE(o);
	const u32 = (o: number) => ttf.readUInt32BE(o);

	const tables: Record<string, { off: number; len: number }> = {};
	for (let i = 0; i < u16(4); i += 1) {
		const o = 12 + i * 16;
		tables[ttf.toString('ascii', o, o + 4)] = { off: u32(o + 8), len: u32(o + 12) };
	}

	const numGlyphs = u16(tables.maxp.off + 4);
	const loca: number[] = [];
	for (let i = 0; i <= numGlyphs; i += 1) loca.push(u32(tables.loca.off + i * 4));

	const start = tables.glyf.off + loca[gid];
	if (loca[gid + 1] - loca[gid] === 0) return { contours: [], bbox: null };

	const numberOfContours = i16(start);
	if (numberOfContours < 0) throw new Error(`glyph ${gid} is composite`);

	const bbox = {
		xMin: i16(start + 2),
		yMin: i16(start + 4),
		xMax: i16(start + 6),
		yMax: i16(start + 8)
	};

	let o = start + 10;
	const endPts: number[] = [];
	for (let i = 0; i < numberOfContours; i += 1) {
		endPts.push(u16(o));
		o += 2;
	}
	const numPoints = endPts[endPts.length - 1] + 1;
	o += 2 + u16(o); // skip instructions

	const flags: number[] = [];
	while (flags.length < numPoints) {
		const flag = ttf.readUInt8(o);
		o += 1;
		flags.push(flag);
		if (flag & 8) {
			let repeat = ttf.readUInt8(o);
			o += 1;
			while (repeat-- > 0) flags.push(flag);
		}
	}

	const xs: number[] = [];
	let x = 0;
	for (const flag of flags) {
		if (flag & 2) {
			const delta = ttf.readUInt8(o);
			o += 1;
			x += flag & 16 ? delta : -delta;
		} else if (!(flag & 16)) {
			x += i16(o);
			o += 2;
		}
		xs.push(x);
	}

	const ys: number[] = [];
	let y = 0;
	for (const flag of flags) {
		if (flag & 4) {
			const delta = ttf.readUInt8(o);
			o += 1;
			y += flag & 32 ? delta : -delta;
		} else if (!(flag & 32)) {
			y += i16(o);
			o += 2;
		}
		ys.push(y);
	}

	const contours: Glyph['contours'] = [];
	let from = 0;
	for (const end of endPts) {
		const points = [];
		for (let i = from; i <= end; i += 1) {
			points.push({ x: xs[i], y: ys[i], on: Boolean(flags[i] & 1) });
		}
		contours.push(points);
		from = end + 1;
	}

	return { contours, bbox };
}

/** A one-glyph A4 PDF at 200pt, embedding the subset exactly as the invoice writer does. */
function singleGlyphPdf(ttf: Buffer, glyphHex: string): Buffer {
	const content = `BT /F1 200 Tf 0 g 1 0 0 1 100 400 Tm <${glyphHex}> Tj ET`;
	const ascii = (text: string) => {
		const bytes = Buffer.alloc(text.length);
		for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
		return bytes;
	};

	const objects: { body: string; stream?: Buffer }[] = [
		{ body: '<< /Type /Catalog /Pages 2 0 R >>' },
		{ body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
		{
			body:
				'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ' +
				'/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
		},
		{ body: `<< /Length ${content.length} >>`, stream: ascii(content) },
		{
			body:
				'<< /Type /Font /Subtype /Type0 /BaseFont /NotoSans /Encoding /Identity-H ' +
				'/DescendantFonts [6 0 R] >>'
		},
		{
			body:
				'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSans ' +
				'/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
				'/FontDescriptor 7 0 R /DW 1000 /CIDToGIDMap /Identity >>'
		},
		{
			body:
				'<< /Type /FontDescriptor /FontName /NotoSans /Flags 32 ' +
				'/FontBBox [-1000 -400 2000 1100] /ItalicAngle 0 /Ascent 1069 /Descent -293 ' +
				'/CapHeight 714 /StemV 80 /FontFile2 8 0 R >>'
		},
		{ body: `<< /Length ${ttf.length} /Length1 ${ttf.length} >>`, stream: ttf }
	];

	const chunks: Buffer[] = [ascii('%PDF-1.4\n'), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
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

	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const entry of offsets) xref += `${String(entry).padStart(10, '0')} 00000 n \n`;
	xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
	chunks.push(ascii(xref));

	return Buffer.concat(chunks);
}

let browser: Browser;
let page: Page;
let server: Server;
let origin: string;
let ttf: Buffer;
let rupeeGid: number;

beforeAll(async () => {
	if (!RENDERER) return;

	ttf = readFileSync(join(FONT_DIR, 'noto-sans-invoice-regular.ttf'));
	const manifest = JSON.parse(readFileSync(join(FONT_DIR, 'noto-sans-invoice.json'), 'utf8')) as {
		weights: Record<string, { glyphs: Record<string, { gid: number }> }>;
	};
	rupeeGid = manifest.weights.regular.glyphs[String(0x20b9)].gid;

	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });

	// Render the rupee and the .notdef box through the OS PDF engine.
	const hex = (gid: number) => gid.toString(16).padStart(4, '0');
	writeFileSync(join(WORK, 'rupee.pdf'), singleGlyphPdf(ttf, hex(rupeeGid)));
	writeFileSync(join(WORK, 'notdef.pdf'), singleGlyphPdf(ttf, '0000'));
	for (const name of ['rupee', 'notdef']) {
		execFileSync('qlmanage', ['-t', '-s', '1200', '-o', WORK, join(WORK, `${name}.pdf`)], {
			stdio: 'pipe'
		});
	}

	// Serve the bitmaps: a multi-hundred-KB data URL trips Chrome's URL length limit.
	const images: Record<string, Buffer> = {
		rupee: readFileSync(join(WORK, 'rupee.pdf.png')),
		notdef: readFileSync(join(WORK, 'notdef.pdf.png'))
	};
	server = createServer((request, response) => {
		const key = (request.url ?? '').slice(1).replace('.png', '');
		if (images[key]) {
			response.writeHead(200, { 'Content-Type': 'image/png' });
			response.end(images[key]);
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end('<body style="margin:0"><img id="rupee" src="/rupee.png"><img id="notdef" src="/notdef.png"></body>');
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

	browser = await chromium.launch();
	page = await browser.newPage();
	await page.goto(origin, { waitUntil: 'networkidle' });
	await page.waitForFunction(() =>
		['rupee', 'notdef'].every((id) => {
			const image = document.getElementById(id) as HTMLImageElement | null;
			return image?.complete && image.naturalWidth > 0;
		})
	);
}, 180_000);

afterAll(async () => {
	await browser?.close();
	server?.close();
	rmSync(WORK, { recursive: true, force: true });
});

/** Correlate the OS-rendered PDF glyph against outlines redrawn from the font file. */
async function correlate(): Promise<Record<string, number>> {
	return page.evaluate(
		({ rupee, notdef }) => {
			const N = 64;

			/** Crop to the ink bounding box, then normalise to an NxN coverage mask. */
			const mask = (get: (x: number, y: number) => number, width: number, height: number) => {
				let minX = width;
				let maxX = -1;
				let minY = height;
				let maxY = -1;
				const dark = new Float64Array(width * height);
				for (let y = 0; y < height; y += 1) {
					for (let x = 0; x < width; x += 1) {
						const value = get(x, y);
						dark[y * width + x] = value;
						if (value > 0.45) {
							if (x < minX) minX = x;
							if (x > maxX) maxX = x;
							if (y < minY) minY = y;
							if (y > maxY) maxY = y;
						}
					}
				}
				if (maxX < 0) return null;
				const boxWidth = maxX - minX + 1;
				const boxHeight = maxY - minY + 1;
				const grid = new Float64Array(N * N);
				const count = new Float64Array(N * N);
				for (let y = minY; y <= maxY; y += 1) {
					for (let x = minX; x <= maxX; x += 1) {
						const gx = Math.min(N - 1, Math.floor(((x - minX) * N) / boxWidth));
						const gy = Math.min(N - 1, Math.floor(((y - minY) * N) / boxHeight));
						grid[gy * N + gx] += dark[y * width + x];
						count[gy * N + gx] += 1;
					}
				}
				for (let i = 0; i < grid.length; i += 1) grid[i] = count[i] ? grid[i] / count[i] : 0;
				return { grid, aspect: boxWidth / boxHeight };
			};

			const fromImage = (id: string) => {
				const image = document.getElementById(id) as HTMLImageElement;
				const canvas = document.createElement('canvas');
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext('2d') as CanvasRenderingContext2D;
				context.drawImage(image, 0, 0);
				const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
				return mask(
					(x, y) => {
						const o = (y * canvas.width + x) * 4;
						return 1 - (data[o] + data[o + 1] + data[o + 2]) / 765;
					},
					canvas.width,
					canvas.height
				);
			};

			/** Redraw a glyph from raw font-unit coordinates, per TrueType quadratic rules. */
			const fromOutline = (glyph: typeof rupee) => {
				const size = 512;
				const pad = 24;
				const box = glyph.bbox as { xMin: number; yMin: number; xMax: number; yMax: number };
				const scale = Math.min(
					(size - pad * 2) / (box.xMax - box.xMin),
					(size - pad * 2) / (box.yMax - box.yMin)
				);
				const canvas = document.createElement('canvas');
				canvas.width = size;
				canvas.height = size;
				const context = canvas.getContext('2d') as CanvasRenderingContext2D;
				context.fillStyle = '#fff';
				context.fillRect(0, 0, size, size);

				const X = (value: number) => pad + (value - box.xMin) * scale;
				const Y = (value: number) => size - pad - (value - box.yMin) * scale;

				const path = new Path2D();
				for (const points of glyph.contours) {
					if (points.length === 0) continue;
					let startIndex = points.findIndex((point) => point.on);
					let startPoint;
					if (startIndex === -1) {
						// An all-off-curve contour starts at the implied midpoint.
						startPoint = {
							x: (points[0].x + points[points.length - 1].x) / 2,
							y: (points[0].y + points[points.length - 1].y) / 2
						};
						startIndex = 0;
					} else {
						startPoint = points[startIndex];
					}
					path.moveTo(X(startPoint.x), Y(startPoint.y));

					let pending: { x: number; y: number } | null = null;
					for (let i = 1; i <= points.length; i += 1) {
						const point = points[(startIndex + i) % points.length];
						if (point.on) {
							if (pending) {
								path.quadraticCurveTo(X(pending.x), Y(pending.y), X(point.x), Y(point.y));
								pending = null;
							} else {
								path.lineTo(X(point.x), Y(point.y));
							}
						} else {
							if (pending) {
								// Two consecutive off-curve points imply an on-curve midpoint.
								const mid = { x: (pending.x + point.x) / 2, y: (pending.y + point.y) / 2 };
								path.quadraticCurveTo(X(pending.x), Y(pending.y), X(mid.x), Y(mid.y));
							}
							pending = point;
						}
					}
					if (pending) {
						path.quadraticCurveTo(X(pending.x), Y(pending.y), X(startPoint.x), Y(startPoint.y));
					}
					path.closePath();
				}

				context.fillStyle = '#000';
				context.fill(path, 'nonzero');
				const { data } = context.getImageData(0, 0, size, size);
				return mask(
					(x, y) => {
						const o = (y * size + x) * 4;
						return 1 - (data[o] + data[o + 1] + data[o + 2]) / 765;
					},
					size,
					size
				);
			};

			const pearson = (a: Float64Array, b: Float64Array) => {
				let meanA = 0;
				let meanB = 0;
				for (let i = 0; i < a.length; i += 1) {
					meanA += a[i];
					meanB += b[i];
				}
				meanA /= a.length;
				meanB /= b.length;
				let num = 0;
				let devA = 0;
				let devB = 0;
				for (let i = 0; i < a.length; i += 1) {
					const x = a[i] - meanA;
					const y = b[i] - meanB;
					num += x * y;
					devA += x * x;
					devB += y * y;
				}
				return num / Math.sqrt(devA * devB || 1);
			};

			const pdfRupee = fromImage('rupee');
			const pdfNotdef = fromImage('notdef');
			const outlineRupee = fromOutline(rupee);
			const outlineNotdef = fromOutline(notdef);
			if (!pdfRupee || !pdfNotdef || !outlineRupee || !outlineNotdef) {
				throw new Error('a rendering produced no ink at all');
			}

			return {
				pdfRupeeInk: pdfRupee.grid.reduce((sum, value) => sum + value, 0),
				rupeeVsRupee: pearson(pdfRupee.grid, outlineRupee.grid),
				rupeeVsNotdef: pearson(pdfRupee.grid, outlineNotdef.grid),
				notdefVsNotdef: pearson(pdfNotdef.grid, outlineNotdef.grid),
				notdefVsRupee: pearson(pdfNotdef.grid, outlineRupee.grid),
				aspectPdfRupee: pdfRupee.aspect,
				aspectOutlineRupee: outlineRupee.aspect
			};
		},
		{ rupee: readGlyph(ttf, rupeeGid), notdef: readGlyph(ttf, 0) }
	);
}

describe.skipIf(!RENDERER)('rupee glyph renders as real ink in a real PDF reader', () => {
	it('matches the font\'s OWN rupee outline, and is not the .notdef box', async () => {
		const result = await correlate();

		// The OS-rendered glyph is the rupee outline from the font file.
		expect(result.rupeeVsRupee, 'PDF glyph does not match the rupee outline').toBeGreaterThan(0.9);
		// And it is emphatically not the missing-glyph box.
		expect(result.rupeeVsNotdef).toBeLessThan(0.5);
		expect(result.rupeeVsRupee - result.rupeeVsNotdef).toBeGreaterThan(0.3);

		// Control: the deliberately-broken PDF really does render .notdef, which proves the
		// comparison can tell the two apart at all.
		expect(result.notdefVsNotdef).toBeGreaterThan(0.9);
		expect(result.notdefVsRupee).toBeLessThan(0.5);

		// Sanity: real ink, and the rendered proportions match the outline's.
		expect(result.pdfRupeeInk).toBeGreaterThan(100);
		expect(Math.abs(result.aspectPdfRupee - result.aspectOutlineRupee)).toBeLessThan(0.05);
	}, 120_000);
});
