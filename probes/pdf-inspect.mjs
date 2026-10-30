/**
 * Minimal PDF reader used by the probes to prove what an invoice actually contains.
 *
 * It parses the structural parts of the PDF this project writes - the xref table, the
 * object bodies, the content stream and the /ToUnicode CMaps - and decodes the Identity-H
 * hex strings back into text.
 *
 * That round trip is the real proof that the rupee sign survives: `extractText()` returns
 * '₹' only if the glyph id written into the content stream maps back to U+20B9 through the
 * CMap embedded in the document. A missing glyph would show up as glyph 0 or as a '?'.
 */

/** Split a PDF buffer into `objects[n] = { body, stream }`, 1-indexed. */
export function parseObjects(buffer) {
	const text = buffer.toString('latin1');
	const objects = {};
	const pattern = /(\d+)\s+0\s+obj\n([\s\S]*?)\nendobj\n/g;

	let match;
	while ((match = pattern.exec(text)) !== null) {
		const id = Number(match[1]);
		const raw = match[2];
		const streamStart = raw.indexOf('stream\n');

		if (streamStart === -1) {
			objects[id] = { body: raw, stream: null };
			continue;
		}

		const body = raw.slice(0, streamStart).trimEnd();
		// Locate the stream bytes in the ORIGINAL buffer, so binary data is untouched.
		const absoluteStart = match.index + match[1].length + 7 + streamStart + 'stream\n'.length;
		const length = Number(/\/Length\s+(\d+)/.exec(body)?.[1] ?? 0);
		objects[id] = { body, stream: buffer.subarray(absoluteStart, absoluteStart + length) };
	}

	return objects;
}

/** Parse a /ToUnicode CMap into glyph id -> string. */
export function parseToUnicode(cmapText) {
	const map = new Map();
	const sections = cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
	for (const section of sections) {
		const pairs = section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g);
		for (const pair of pairs) {
			const gid = Number.parseInt(pair[1], 16);
			const hex = pair[2];
			let value = '';
			for (let i = 0; i < hex.length; i += 4) {
				value += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
			}
			map.set(gid, value);
		}
	}
	return map;
}

/**
 * Decode every text run in the content stream.
 *
 * Returns one entry per `Tj`, tagged with the font resource that drew it, so a probe can
 * assert that (say) the total line was drawn in the bold font.
 */
export function extractRuns(buffer) {
	const objects = parseObjects(buffer);

	// The page dictionary names its content stream and its font resources.
	const page = Object.values(objects).find((object) => object.body.includes('/Type /Page\b') || /\/Type\s*\/Page[^s]/.test(object.body));
	if (!page) throw new Error('no page object');

	const contentsId = Number(/\/Contents\s+(\d+)\s+0\s+R/.exec(page.body)?.[1]);
	const content = objects[contentsId]?.stream?.toString('latin1');
	if (!content) throw new Error('no content stream');

	// Resource name (F1/F2) -> Type0 font object id.
	const fontResources = new Map();
	const resourceBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(page.body)?.[1] ?? '';
	for (const entry of resourceBlock.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
		fontResources.set(entry[1], Number(entry[2]));
	}

	// Type0 font object -> its /ToUnicode map.
	const cmaps = new Map();
	for (const [name, fontId] of fontResources) {
		const toUnicodeId = Number(/\/ToUnicode\s+(\d+)\s+0\s+R/.exec(objects[fontId]?.body ?? '')?.[1]);
		const cmapText = objects[toUnicodeId]?.stream?.toString('latin1') ?? '';
		cmaps.set(name, parseToUnicode(cmapText));
	}

	const runs = [];
	let currentFont = null;
	// Walk the stream in order so `Tf` selections apply to the `Tj`s that follow.
	const tokens = content.matchAll(/\/(\w+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]*)>\s*Tj/g);
	for (const token of tokens) {
		if (token[1]) {
			currentFont = token[1];
			continue;
		}
		const hex = token[2] ?? '';
		const cmap = cmaps.get(currentFont) ?? new Map();
		let text = '';
		const gids = [];
		for (let i = 0; i < hex.length; i += 4) {
			const gid = Number.parseInt(hex.slice(i, i + 4), 16);
			gids.push(gid);
			text += cmap.get(gid) ?? '\uFFFD';
		}
		runs.push({ font: currentFont, text, gids });
	}

	return runs;
}

/** All decoded text in the PDF, joined. */
export function extractText(buffer) {
	return extractRuns(buffer)
		.map((run) => run.text)
		.join('\n');
}

/** Font programs embedded in the document, with their byte length. */
export function embeddedFonts(buffer) {
	const objects = parseObjects(buffer);
	const fonts = [];
	for (const [id, object] of Object.entries(objects)) {
		if (!/\/FontFile2\s+(\d+)\s+0\s+R/.test(object.body)) continue;
		const fileId = Number(/\/FontFile2\s+(\d+)\s+0\s+R/.exec(object.body)[1]);
		const stream = objects[fileId]?.stream;
		fonts.push({
			descriptorId: Number(id),
			name: /\/FontName\s*\/([\w-]+)/.exec(object.body)?.[1] ?? null,
			bytes: stream?.length ?? 0,
			// A TrueType program starts with the sfnt version 0x00010000.
			isTrueType: Boolean(stream && stream[0] === 0x00 && stream[1] === 0x01 && stream[2] === 0x00 && stream[3] === 0x00)
		});
	}
	return fonts;
}
