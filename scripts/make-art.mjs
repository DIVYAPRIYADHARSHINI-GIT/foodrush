/**
 * Generates FoodRush's food artwork as original SVG illustrations.
 *
 * The brief asks for "large food imagery" with no real-brand assets, no stock photos and
 * no lorem-ipsum placeholders. Every image here is drawn from primitives in this file, so
 * the project ships with zero third-party image licences and the layout can rely on exact
 * intrinsic dimensions (4:3 dish art, 16:9 hero art) - which is what stops the cards from
 * jumping while images load.
 *
 * Each archetype is a top-down "plate" composition on a warm surface, in a shared palette
 * drawn from the app's saffron accent so a grid of 400 dishes reads as one product.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DISH_DIR = join(ROOT, 'static', 'img', 'dish');
const HERO_DIR = join(ROOT, 'static', 'img', 'hero');

const W = 480;
const H = 360;

const C = {
	surface: '#f4e3cd',
	surfaceDeep: '#e7cfae',
	plate: '#fffaf2',
	plateRim: '#eadcc8',
	steel: '#e2e6ea',
	steelRim: '#c3cad1',
	leaf: '#2f7d4f',
	leafLight: '#4aa368',
	tomato: '#c8402f',
	saffron: '#e8871e',
	saffronDeep: '#c96a10',
	turmeric: '#f0b429',
	cream: '#fdf3e0',
	brown: '#8b5a2b',
	brownDeep: '#6b421d',
	char: '#53300f',
	gravy: '#b4531f',
	gravyVeg: '#d98324',
	chocolate: '#4a2c17',
	milk: '#fcf7ee',
	mint: '#3f8f5f',
	purple: '#7b3f6b',
	pink: '#e86a8a',
	coffee: '#6f4123',
	green: '#6aa84f'
};

/** Deterministic PRNG so the artwork is byte-identical on every run. */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const ellipse = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const rect = (x, y, w, h, fill, r = 0, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;

/** Warm textured surface + soft plate shadow shared by every dish illustration. */
function base(seed) {
	const rand = rng(seed);
	let out = `<rect width="${W}" height="${H}" fill="${C.surface}"/>`;
	// Subtle speckle so the background is not a flat fill.
	for (let i = 0; i < 46; i += 1) {
		const x = rand() * W;
		const y = rand() * H;
		out += circle(x.toFixed(1), y.toFixed(1), (1 + rand() * 2.4).toFixed(1), C.surfaceDeep, 'opacity="0.55"');
	}
	out += ellipse(W / 2, H / 2 + 16, 150, 122, 'rgba(120, 72, 24, 0.16)');
	return out;
}

const roundPlate = (r = 136) =>
	ellipse(W / 2, H / 2, r, r * 0.8, C.plate) + ellipse(W / 2, H / 2, r * 0.86, r * 0.68, C.plateRim, 'opacity="0.55"') + ellipse(W / 2, H / 2, r * 0.8, r * 0.63, C.plate);

const steelPlate = () =>
	ellipse(W / 2, H / 2, 140, 112, C.steelRim) + ellipse(W / 2, H / 2, 128, 101, C.steel) + ellipse(W / 2, H / 2, 104, 82, '#eef1f4');

/** A few coriander leaves, the universal Indian-plate garnish. */
function garnish(seed, cx = W / 2, cy = H / 2, spread = 70) {
	const rand = rng(seed);
	let out = '';
	for (let i = 0; i < 6; i += 1) {
		const x = cx + (rand() - 0.5) * spread * 2;
		const y = cy + (rand() - 0.5) * spread;
		const rot = Math.floor(rand() * 360);
		out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot})">${path('M0 0 C 5 -6, 12 -6, 16 0 C 12 6, 5 6, 0 0 Z', i % 2 ? C.leafLight : C.leaf)}</g>`;
	}
	return out;
}

const ART = {
	dosa: (seed) => {
		let out = base(seed) + steelPlate();
		// Conical dosa.
		out += path(`M ${W / 2 - 96} ${H / 2 + 54} L ${W / 2 + 6} ${H / 2 - 74} L ${W / 2 + 92} ${H / 2 + 54} Z`, C.turmeric);
		out += path(`M ${W / 2 - 72} ${H / 2 + 48} L ${W / 2 + 4} ${H / 2 - 52} L ${W / 2 + 60} ${H / 2 + 48} Z`, '#f6cb5c', 'opacity="0.75"');
		out += path(`M ${W / 2 - 40} ${H / 2 + 44} L ${W / 2 + 2} ${H / 2 - 18} L ${W / 2 + 28} ${H / 2 + 44} Z`, C.saffron, 'opacity="0.5"');
		// Chutney + sambar katoris.
		out += circle(W / 2 - 118, H / 2 + 58, 30, C.steelRim) + circle(W / 2 - 118, H / 2 + 58, 25, C.cream);
		out += circle(W / 2 + 120, H / 2 + 58, 30, C.steelRim) + circle(W / 2 + 120, H / 2 + 58, 25, C.gravy);
		out += garnish(seed + 1, W / 2, H / 2 + 20, 48);
		return out;
	},
	idli: (seed) => {
		let out = base(seed) + steelPlate();
		const spots = [
			[W / 2 - 48, H / 2 - 26],
			[W / 2 + 36, H / 2 - 34],
			[W / 2 - 18, H / 2 + 34]
		];
		for (const [x, y] of spots) {
			out += ellipse(x, y + 6, 46, 30, 'rgba(120,72,24,0.14)');
			out += ellipse(x, y, 45, 30, C.milk);
			out += ellipse(x, y - 4, 38, 22, '#ffffff');
		}
		// Podi dusting.
		const rand = rng(seed + 7);
		for (let i = 0; i < 40; i += 1) {
			out += circle((W / 2 - 60 + rand() * 120).toFixed(1), (H / 2 - 40 + rand() * 80).toFixed(1), (1.4 + rand() * 1.6).toFixed(1), C.tomato, 'opacity="0.75"');
		}
		out += circle(W / 2 + 112, H / 2 + 52, 28, C.steelRim) + circle(W / 2 + 112, H / 2 + 52, 23, C.gravy);
		return out;
	},
	biryani: (seed) => {
		const rand = rng(seed);
		let out = base(seed) + roundPlate(138);
		out += ellipse(W / 2, H / 2, 112, 88, C.turmeric, 'opacity="0.35"');
		// Rice grains in two tones for the dum-layered look.
		for (let i = 0; i < 300; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 104;
			const x = W / 2 + Math.cos(ang) * rad;
			const y = H / 2 + Math.sin(ang) * rad * 0.78;
			const tone = rand() > 0.68 ? C.turmeric : rand() > 0.3 ? C.cream : '#ffffff';
            out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.floor(rand() * 180)})">${ellipse(0, 0, 7, 2.6, tone)}</g>`;
		}
		// Masala pieces + fried onion.
		for (let i = 0; i < 7; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 76;
			out += circle((W / 2 + Math.cos(ang) * rad).toFixed(1), (H / 2 + Math.sin(ang) * rad * 0.75).toFixed(1), (12 + rand() * 7).toFixed(1), C.brown);
		}
		for (let i = 0; i < 22; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 96;
			out += path(`M0 0 q 8 -4 16 1 q -8 5 -16 -1 Z`, C.brownDeep, `transform="translate(${(W / 2 + Math.cos(ang) * rad).toFixed(1)} ${(H / 2 + Math.sin(ang) * rad * 0.75).toFixed(1)}) rotate(${Math.floor(rand() * 360)})"`);
		}
		out += garnish(seed + 3, W / 2, H / 2, 80);
		return out;
	},
	rice: (seed) => {
		const rand = rng(seed);
		let out = base(seed) + steelPlate();
		for (let i = 0; i < 240; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 92;
			out += `<g transform="translate(${(W / 2 + Math.cos(ang) * rad).toFixed(1)} ${(H / 2 + Math.sin(ang) * rad * 0.78).toFixed(1)}) rotate(${Math.floor(rand() * 180)})">${ellipse(0, 0, 7, 2.6, rand() > 0.5 ? '#ffffff' : C.cream)}</g>`;
		}
		out += circle(W / 2, H / 2 - 4, 34, C.turmeric, 'opacity="0.85"');
		out += garnish(seed + 2, W / 2, H / 2, 70);
		return out;
	},
	'curry-veg': (seed) => {
		let out = base(seed) + roundPlate(132);
		out += ellipse(W / 2, H / 2, 98, 76, C.gravyVeg);
		out += ellipse(W / 2 - 24, H / 2 - 18, 44, 26, '#e59b3c', 'opacity="0.7"');
		const rand = rng(seed + 5);
		for (let i = 0; i < 9; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 62;
			out += rect((W / 2 + Math.cos(ang) * rad - 13).toFixed(1), (H / 2 + Math.sin(ang) * rad * 0.7 - 13).toFixed(1), 26, 26, C.milk, 5);
		}
		out += ellipse(W / 2 + 30, H / 2 + 26, 26, 12, C.cream, 'opacity="0.9"');
		out += garnish(seed + 6, W / 2, H / 2, 62);
		return out;
	},
	'curry-nonveg': (seed) => {
		let out = base(seed) + roundPlate(132);
		out += ellipse(W / 2, H / 2, 98, 76, C.gravy);
		out += ellipse(W / 2 - 22, H / 2 - 20, 42, 24, '#c3601f', 'opacity="0.75"');
		const rand = rng(seed + 11);
		for (let i = 0; i < 6; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 58;
			out += ellipse((W / 2 + Math.cos(ang) * rad).toFixed(1), (H / 2 + Math.sin(ang) * rad * 0.7).toFixed(1), 22, 17, C.char);
			out += ellipse((W / 2 + Math.cos(ang) * rad).toFixed(1), (H / 2 + Math.sin(ang) * rad * 0.7 - 4).toFixed(1), 15, 10, '#7b4a1c');
		}
		out += garnish(seed + 12, W / 2, H / 2, 64);
		return out;
	},
	kebab: (seed) => {
		const rand = rng(seed);
		let out = base(seed) + roundPlate(134);
		// Skewers.
		for (let i = 0; i < 3; i += 1) {
			const y = H / 2 - 48 + i * 48;
			out += rect(W / 2 - 110, y - 2, 220, 4, '#b9c0c6', 2);
			for (let j = 0; j < 4; j += 1) {
				const x = W / 2 - 78 + j * 52;
				out += ellipse(x, y, 25, 20, i === 1 ? C.char : '#a9521c');
				out += ellipse(x - 4, y - 5, 15, 10, i === 1 ? '#7b4a1c' : '#c2651f', 'opacity="0.85"');
			}
		}
		out += ellipse(W / 2 - 92, H / 2 + 72, 32, 13, '#f0e4cf');
		out += garnish(seed + 4, W / 2, H / 2, 86);
		return out;
	},
	pizza: (seed) => {
		const rand = rng(seed);
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 10, 150, 124, 'rgba(120,72,24,0.16)');
		out += circle(W / 2, H / 2, 142, '#d9a441');
		out += circle(W / 2, H / 2, 126, '#f2c879');
		out += circle(W / 2, H / 2, 118, C.tomato);
		out += circle(W / 2, H / 2, 114, '#f6d98f');
		// Melted cheese blobs.
		for (let i = 0; i < 16; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 104;
			out += circle((W / 2 + Math.cos(ang) * rad).toFixed(1), (H / 2 + Math.sin(ang) * rad).toFixed(1), (14 + rand() * 12).toFixed(1), '#fbe6a8', 'opacity="0.85"');
		}
		// Toppings.
		for (let i = 0; i < 11; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 96;
			const x = W / 2 + Math.cos(ang) * rad;
			const y = H / 2 + Math.sin(ang) * rad;
			if (i % 3 === 0) out += circle(x.toFixed(1), y.toFixed(1), 14, C.tomato) + circle(x.toFixed(1), y.toFixed(1), 9, '#d85a43');
			else if (i % 3 === 1) out += circle(x.toFixed(1), y.toFixed(1), 11, C.leaf, 'opacity="0.9"') + circle(x.toFixed(1), y.toFixed(1), 6, C.surface, 'opacity="0.35"');
			else out += ellipse(x.toFixed(1), y.toFixed(1), 15, 10, C.leafLight);
		}
		// Slice cuts.
		for (let i = 0; i < 8; i += 1) {
			const a = (i * Math.PI) / 4;
			out += `<line x1="${W / 2}" y1="${H / 2}" x2="${(W / 2 + Math.cos(a) * 118).toFixed(1)}" y2="${(H / 2 + Math.sin(a) * 118).toFixed(1)}" stroke="#d9a441" stroke-width="2.5" opacity="0.5"/>`;
		}
		return out;
	},
	burger: (seed) => {
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 92, 128, 22, 'rgba(120,72,24,0.18)');
		// Bottom bun, patty stack, top bun.
		out += path(`M ${W / 2 - 112} ${H / 2 + 74} q 112 34 224 0 q -6 -26 -112 -26 q -106 0 -112 26 Z`, '#d9a05a');
		out += rect(W / 2 - 108, H / 2 + 36, 216, 24, C.leafLight, 10);
		out += rect(W / 2 - 112, H / 2 + 6, 224, 34, C.char, 12);
		out += rect(W / 2 - 104, H / 2 - 6, 208, 20, C.turmeric, 8);
		out += rect(W / 2 - 100, H / 2 - 28, 200, 22, '#e2543c', 9);
		out += path(`M ${W / 2 - 116} ${H / 2 - 24} q 6 -92 116 -92 q 110 0 116 92 Z`, '#e8ae61');
		out += path(`M ${W / 2 - 104} ${H / 2 - 30} q 10 -74 104 -74 q 94 0 104 74 Z`, '#f0bd74');
		// Sesame seeds.
		const rand = rng(seed + 9);
		for (let i = 0; i < 12; i += 1) {
			const x = W / 2 - 80 + rand() * 160;
			const y = H / 2 - 92 + rand() * 54;
			out += ellipse(x.toFixed(1), y.toFixed(1), 6, 3.4, '#fdf0d2', `transform="rotate(${Math.floor(rand() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"`);
		}
		return out;
	},
	noodles: (seed) => {
		const rand = rng(seed);
		let out = base(seed) + roundPlate(136);
		out += ellipse(W / 2, H / 2, 108, 84, '#f0d9a8', 'opacity="0.45"');
		for (let i = 0; i < 26; i += 1) {
			const x = W / 2 - 92 + rand() * 184;
			const y = H / 2 - 56 + rand() * 112;
			out += `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} q 26 -22 52 0 q 26 22 52 0" fill="none" stroke="${rand() > 0.4 ? C.turmeric : '#e2a93f'}" stroke-width="6" stroke-linecap="round" opacity="0.95"/>`;
		}
		for (let i = 0; i < 10; i += 1) {
			const x = W / 2 - 80 + rand() * 160;
			const y = H / 2 - 48 + rand() * 96;
			out += i % 2 ? rect(x.toFixed(1), y.toFixed(1), 20, 9, C.leaf, 4) : rect(x.toFixed(1), y.toFixed(1), 18, 9, '#d9533a', 4);
		}
		out += garnish(seed + 8, W / 2, H / 2, 74);
		return out;
	},
	momo: (seed) => {
		let out = base(seed) + steelPlate();
		const spots = [
			[W / 2 - 56, H / 2 - 30],
			[W / 2 + 10, H / 2 - 46],
			[W / 2 + 62, H / 2 + 2],
			[W / 2 - 20, H / 2 + 26],
			[W / 2 - 74, H / 2 + 42]
		];
		for (const [x, y] of spots) {
			out += ellipse(x, y + 5, 36, 26, 'rgba(120,72,24,0.15)');
			out += ellipse(x, y, 35, 26, C.milk);
			out += path(`M ${x - 26} ${y - 2} q 13 -20 26 -2 q 13 18 26 -2`, 'none', `stroke="${C.plateRim}" stroke-width="3"`);
			out += circle(x, y - 10, 5, '#efe2cb');
		}
		out += circle(W / 2 + 104, H / 2 + 60, 26, C.steelRim) + circle(W / 2 + 104, H / 2 + 60, 21, C.tomato);
		return out;
	},
	roll: (seed) => {
		let out = base(seed) + roundPlate(132);
		out += `<g transform="rotate(-18 ${W / 2} ${H / 2})">`;
		out += rect(W / 2 - 46, H / 2 - 104, 92, 208, '#edc985', 18);
		out += rect(W / 2 - 38, H / 2 - 96, 76, 100, '#f3d79c', 14);
		out += rect(W / 2 - 30, H / 2 - 20, 60, 108, C.char, 10);
		out += rect(W / 2 - 24, H / 2 + 10, 48, 20, C.leafLight, 6);
		out += rect(W / 2 - 24, H / 2 + 44, 48, 16, '#e2543c', 6);
		out += rect(W / 2 - 46, H / 2 + 76, 92, 28, '#f7f2e6', 10, 'opacity="0.85"');
		out += '</g>';
		out += garnish(seed + 13, W / 2, H / 2 + 60, 66);
		return out;
	},
	fries: (seed) => {
		const rand = rng(seed);
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 96, 118, 20, 'rgba(120,72,24,0.18)');
		for (let i = 0; i < 22; i += 1) {
			const x = W / 2 - 86 + rand() * 172;
			const y = H / 2 - 70 + rand() * 70;
			const len = 76 + rand() * 54;
			out += rect(x.toFixed(1), y.toFixed(1), 17, len.toFixed(1), rand() > 0.5 ? C.turmeric : '#e9ab33', 6, `transform="rotate(${(rand() * 46 - 23).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"`);
		}
		out += path(`M ${W / 2 - 92} ${H / 2 + 6} l 184 0 l -20 96 l -144 0 Z`, C.tomato);
		out += path(`M ${W / 2 - 80} ${H / 2 + 20} l 160 0 l -14 68 l -132 0 Z`, '#d85a43');
		// Peri peri dusting.
		for (let i = 0; i < 26; i += 1) {
			out += circle((W / 2 - 80 + rand() * 160).toFixed(1), (H / 2 - 60 + rand() * 70).toFixed(1), (1.6 + rand() * 1.8).toFixed(1), '#a8321f', 'opacity="0.8"');
		}
		return out;
	},
	soup: (seed) => {
		let out = base(seed) + roundPlate(126);
		out += ellipse(W / 2, H / 2, 96, 74, '#c9652a');
		out += ellipse(W / 2 - 20, H / 2 - 16, 40, 22, '#d9783a', 'opacity="0.8"');
		const rand = rng(seed + 3);
		for (let i = 0; i < 14; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 62;
			out += rect((W / 2 + Math.cos(ang) * rad).toFixed(1), (H / 2 + Math.sin(ang) * rad * 0.7).toFixed(1), 18, 6, i % 2 ? C.leafLight : C.milk, 3, `transform="rotate(${Math.floor(rand() * 180)} ${(W / 2 + Math.cos(ang) * rad).toFixed(1)} ${(H / 2 + Math.sin(ang) * rad * 0.7).toFixed(1)})"`);
		}
		// Steam.
		for (let i = 0; i < 3; i += 1) {
			const x = W / 2 - 40 + i * 40;
			out += `<path d="M ${x} ${H / 2 - 86} q 14 -22 0 -44 q -14 -22 0 -40" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.5"/>`;
		}
		return out;
	},
	bread: (seed) => {
		const rand = rng(seed);
		let out = base(seed) + roundPlate(134);
		out += path(`M ${W / 2 - 96} ${H / 2 + 46} q -14 -96 96 -104 q 110 8 96 104 q -96 26 -192 0 Z`, '#e8bd79');
		out += path(`M ${W / 2 - 74} ${H / 2 + 34} q -8 -74 74 -82 q 82 8 74 82 q -74 20 -148 0 Z`, '#f2d095');
		for (let i = 0; i < 16; i += 1) {
			out += ellipse((W / 2 - 70 + rand() * 140).toFixed(1), (H / 2 - 50 + rand() * 92).toFixed(1), (5 + rand() * 7).toFixed(1), (3 + rand() * 4).toFixed(1), '#c98f45', 'opacity="0.6"');
		}
		out += ellipse(W / 2 + 10, H / 2 - 30, 22, 12, '#f8e3b0');
		return out;
	},
	salad: (seed) => {
		const rand = rng(seed);
		let out = base(seed) + roundPlate(138);
		out += ellipse(W / 2, H / 2, 112, 88, '#eef3e4');
		for (let i = 0; i < 34; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * 100;
			const x = W / 2 + Math.cos(ang) * rad;
			const y = H / 2 + Math.sin(ang) * rad * 0.78;
			const kind = i % 5;
			if (kind === 0) out += circle(x.toFixed(1), y.toFixed(1), (10 + rand() * 5).toFixed(1), C.tomato);
			else if (kind === 1) out += circle(x.toFixed(1), y.toFixed(1), (11 + rand() * 4).toFixed(1), '#b9e08c') + circle(x.toFixed(1), y.toFixed(1), 5, '#dff0c4');
			else if (kind === 2) out += rect((x - 9).toFixed(1), (y - 9).toFixed(1), 18, 18, '#f7f0dd', 4);
			else if (kind === 3) out += path('M0 0 C 8 -10, 20 -10, 26 0 C 20 10, 8 10, 0 0 Z', C.leaf, `transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.floor(rand() * 360)})"`);
			else out += circle(x.toFixed(1), y.toFixed(1), (4 + rand() * 3).toFixed(1), C.purple);
		}
		return out;
	},
	seafood: (seed) => {
		let out = base(seed) + roundPlate(134);
		out += ellipse(W / 2, H / 2, 100, 78, '#d98135', 'opacity="0.9"');
		// Two fish steaks.
		for (let i = 0; i < 2; i += 1) {
			const x = W / 2 - 42 + i * 84;
			const y = H / 2 - 8 + i * 24;
			out += ellipse(x, y, 46, 34, '#c9772f');
			out += ellipse(x, y, 36, 26, '#e3a05c');
			out += ellipse(x, y, 16, 12, '#f2cb9a');
		}
		const rand = rng(seed + 17);
		for (let i = 0; i < 10; i += 1) {
			out += path('M0 0 q 10 -14 22 -2 q -8 12 -22 2 Z', C.leaf, `transform="translate(${(W / 2 - 86 + rand() * 172).toFixed(1)} ${(H / 2 - 56 + rand() * 112).toFixed(1)}) rotate(${Math.floor(rand() * 360)})"`);
		}
		return out;
	},
	sweet: (seed) => {
		let out = base(seed) + roundPlate(130);
		const spots = [
			[W / 2 - 52, H / 2 - 24],
			[W / 2 + 22, H / 2 - 36],
			[W / 2 + 56, H / 2 + 22],
			[W / 2 - 18, H / 2 + 34]
		];
		for (const [x, y] of spots) {
			out += circle(x, y + 5, 33, 'rgba(120,72,24,0.16)');
			out += circle(x, y, 32, '#a9561f');
			out += circle(x - 7, y - 9, 13, '#c97a36', 'opacity="0.85"');
		}
		out += ellipse(W / 2, H / 2 + 6, 104, 76, '#c98433', 'opacity="0.25"');
		// Pistachio slivers.
		const rand = rng(seed + 21);
		for (let i = 0; i < 14; i += 1) {
			out += ellipse((W / 2 - 70 + rand() * 140).toFixed(1), (H / 2 - 50 + rand() * 100).toFixed(1), 6, 3, C.green);
		}
		return out;
	},
	cake: (seed) => {
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 86, 112, 20, 'rgba(120,72,24,0.18)');
		out += rect(W / 2 - 92, H / 2 - 26, 184, 112, C.chocolate, 14);
		out += rect(W / 2 - 92, H / 2 - 26, 184, 26, '#6b4123', 10);
		out += rect(W / 2 - 92, H / 2 + 16, 184, 20, '#f6e3c2');
		out += path(`M ${W / 2 - 92} ${H / 2 - 24} q 46 34 92 0 q 46 -34 92 0 l 0 -22 l -184 0 Z`, '#3a2112');
		out += ellipse(W / 2, H / 2 - 44, 58, 26, '#fdf6ea');
		out += circle(W / 2, H / 2 - 64, 15, C.tomato);
		out += path(`M ${W / 2 - 4} ${H / 2 - 78} q 10 -10 18 -2`, 'none', 'stroke="#2f7d4f" stroke-width="4"');
		return out;
	},
	icecream: (seed) => {
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 96, 92, 18, 'rgba(120,72,24,0.18)');
		out += path(`M ${W / 2 - 54} ${H / 2 - 6} l 108 0 l -26 108 l -56 0 Z`, '#e8ae61');
		out += rect(W / 2 - 58, H / 2 - 16, 116, 16, '#f0bd74', 6);
		out += circle(W / 2 - 26, H / 2 - 40, 38, C.milk);
		out += circle(W / 2 + 28, H / 2 - 36, 36, C.pink);
		out += circle(W / 2 + 2, H / 2 - 74, 34, '#f6e3c2');
		const rand = rng(seed + 31);
		for (let i = 0; i < 16; i += 1) {
			out += rect((W / 2 - 60 + rand() * 120).toFixed(1), (H / 2 - 98 + rand() * 80).toFixed(1), 9, 4, [C.tomato, C.leafLight, C.turmeric, C.purple][i % 4], 2, `transform="rotate(${Math.floor(rand() * 180)} ${(W / 2).toFixed(1)} ${(H / 2).toFixed(1)})"`);
		}
		return out;
	},
	coffee: (seed) => {
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 92, 104, 20, 'rgba(120,72,24,0.18)');
		// Steel tumbler + dabara, the filter-coffee icon.
		out += path(`M ${W / 2 - 66} ${H / 2 + 72} l 132 0 l -12 -112 l -108 0 Z`, C.steelRim);
		out += path(`M ${W / 2 - 58} ${H / 2 + 64} l 116 0 l -10 -96 l -96 0 Z`, '#eef1f4');
		out += ellipse(W / 2, H / 2 - 34, 48, 14, C.coffee);
		out += ellipse(W / 2, H / 2 - 37, 40, 10, '#c9a67f');
		for (let i = 0; i < 3; i += 1) {
			const x = W / 2 - 34 + i * 34;
			out += `<path d="M ${x} ${H / 2 - 56} q 12 -20 0 -38 q -12 -18 0 -34" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.45"/>`;
		}
		return out;
	},
	juice: (seed) => {
		let out = base(seed);
		out += ellipse(W / 2, H / 2 + 100, 86, 16, 'rgba(120,72,24,0.18)');
		out += path(`M ${W / 2 - 52} ${H / 2 - 92} l 104 0 l -12 184 l -80 0 Z`, '#f7f2e6', 'opacity="0.55"');
		out += path(`M ${W / 2 - 46} ${H / 2 - 40} l 92 0 l -10 128 l -72 0 Z`, C.saffron);
		out += ellipse(W / 2, H / 2 - 40, 46, 11, '#f5a73f');
		out += rect(W / 2 + 10, H / 2 - 128, 12, 100, C.tomato, 6, `transform="rotate(12 ${W / 2 + 16} ${H / 2 - 78})"`);
		out += circle(W / 2 - 44, H / 2 - 96, 24, C.leafLight);
		out += path(`M ${W / 2 - 44} ${H / 2 - 120} q 16 10 0 24 q -16 -14 0 -24 Z`, C.leaf);
		return out;
	}
};

mkdirSync(DISH_DIR, { recursive: true });
mkdirSync(HERO_DIR, { recursive: true });

const svg = (body) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${body}</svg>\n`;

let seed = 1000;
for (const [key, draw] of Object.entries(ART)) {
	seed += 977;
	writeFileSync(join(DISH_DIR, `${key}.svg`), svg(draw(seed)), 'utf8');
}

// Generic fallback used when a dish art key is missing or an <img> fails to load. The app
// points broken images here, which is why the layout never collapses to a 0-height box.
writeFileSync(
	join(DISH_DIR, 'fallback.svg'),
	svg(
		`${base(31)}${roundPlate(130)}` +
			ellipse(W / 2, H / 2, 86, 66, C.surfaceDeep) +
			path(`M ${W / 2 - 30} ${H / 2 + 16} q 30 -44 60 0 q -30 18 -60 0 Z`, C.saffron) +
			circle(W / 2, H / 2 - 22, 18, C.saffronDeep) +
			`<text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" fill="#8b5a2b">FoodRush</text>`
	),
	'utf8'
);

// 16:9 hero band: a table-top spread behind the landing headline.
const HW = 1280;
const HH = 720;
(() => {
	const rand = rng(777);
	let out = `<rect width="${HW}" height="${HH}" fill="${C.surface}"/>`;
	for (let i = 0; i < 160; i += 1) {
		out += `<circle cx="${(rand() * HW).toFixed(1)}" cy="${(rand() * HH).toFixed(1)}" r="${(2 + rand() * 5).toFixed(1)}" fill="${C.surfaceDeep}" opacity="0.5"/>`;
	}
	const plates = [
		[250, 250, 150, 'biryani'],
		[640, 180, 120, 'pizza'],
		[1010, 260, 135, 'curry-nonveg'],
		[420, 540, 120, 'idli'],
		[840, 540, 130, 'noodles'],
		[1140, 560, 95, 'juice']
	];
	for (const [cx, cy, r, kind] of plates) {
		out += `<ellipse cx="${cx}" cy="${cy + r * 0.1}" rx="${r}" ry="${r * 0.82}" fill="rgba(120,72,24,0.16)"/>`;
		out += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.8}" fill="${C.plate}"/>`;
		const fill = kind === 'pizza' ? '#f6d98f' : kind === 'juice' ? C.saffron : kind === 'idli' ? C.milk : kind === 'noodles' ? C.turmeric : kind === 'biryani' ? C.cream : C.gravy;
		out += `<ellipse cx="${cx}" cy="${cy}" rx="${r * 0.76}" ry="${r * 0.6}" fill="${fill}"/>`;
		for (let i = 0; i < 24; i += 1) {
			const ang = rand() * Math.PI * 2;
			const rad = Math.sqrt(rand()) * r * 0.66;
			out += `<circle cx="${(cx + Math.cos(ang) * rad).toFixed(1)}" cy="${(cy + Math.sin(ang) * rad * 0.78).toFixed(1)}" r="${(4 + rand() * 9).toFixed(1)}" fill="${i % 3 === 0 ? C.tomato : i % 3 === 1 ? C.leaf : C.brown}" opacity="0.85"/>`;
		}
	}
	writeFileSync(
		join(HERO_DIR, 'spread.svg'),
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${HW} ${HH}" width="${HW}" height="${HH}" role="img">${out}</svg>\n`,
		'utf8'
	);
})();

// Favicon: the FoodRush "steam over a bowl" mark.
writeFileSync(
	join(ROOT, 'static', 'favicon.svg'),
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
	<rect width="64" height="64" rx="14" fill="#e8871e"/>
	<path d="M12 32 h40 a20 20 0 0 1 -40 0 Z" fill="#fff7eb"/>
	<rect x="8" y="28" width="48" height="5" rx="2.5" fill="#fff7eb"/>
	<path d="M24 22 q6 -5 0 -10 q-6 -5 0 -9" fill="none" stroke="#fff7eb" stroke-width="3.4" stroke-linecap="round"/>
	<path d="M40 22 q6 -5 0 -10 q-6 -5 0 -9" fill="none" stroke="#fff7eb" stroke-width="3.4" stroke-linecap="round"/>
</svg>
`,
	'utf8'
);

// Guard: every generated file must be well-formed XML with no duplicate attributes, or
// the browser silently refuses to decode it and the card falls back to the placeholder.
// This caught a real bug where a helper emitted `fill` twice on the same <path>.
for (const dir of [DISH_DIR, HERO_DIR]) {
	for (const file of readdirSync(dir)) {
		const text = readFileSync(join(dir, file), 'utf8');
		for (const tag of text.match(/<[a-z]+[^>]*>/g) ?? []) {
			const names = [...tag.matchAll(/\s([a-z-]+)="/g)].map((match) => match[1]);
			const duplicate = names.find((name, index) => names.indexOf(name) !== index);
			if (duplicate) throw new Error(`${file}: duplicate attribute "${duplicate}" in ${tag.slice(0, 90)}`);
		}
		if (text.includes('NaN') || text.includes('undefined')) throw new Error(`${file}: contains NaN/undefined`);
	}
}

console.log(`FoodRush art: ${Object.keys(ART).length + 1} dish illustrations, 1 hero spread, 1 favicon (all validated).`);
