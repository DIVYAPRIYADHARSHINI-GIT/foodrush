import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// FoodRush is a plain static site: no server, no env vars, no database. Restaurants,
// menus and coupons are real JSON files in `static/data/`; cart, addresses, orders,
// ratings and favourites live in localStorage. adapter-static + prerender means `build/`
// can be dropped on GitHub Pages (including a sub-path), Vercel or Netlify unchanged, and
// served by `python3 -m http.server` from inside the folder.
//
// The SPA fallback is `200.html`, NOT `index.html`: naming it index.html makes the adapter
// overwrite the prerendered landing page with a bare JS-only shell, costing the real
// <h1>/description in the served markup. Hosts rewrite unmatched paths to 200.html (see
// vercel.json). `index.html` still exists at the build root - required by the brief -
// because `/` is prerendered.
//
// Deep links use query params (`/restaurant/?id=...`, `/order/?id=...`) rather than
// `[id]` route segments, so every route is prerenderable and a hard refresh on any page
// resolves to a real file instead of relying on the host's rewrite.
export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ fallback: '200.html', strict: false })
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	}
});
