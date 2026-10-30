/**
 * Path helpers.
 *
 * SvelteKit 3 removed the `base` export from `$app/paths` in favour of `resolve()` and
 * `asset()`, both of which prefix the configured base path. Routing every link and data
 * fetch through here is what makes the build work unchanged on a GitHub Pages sub-path as
 * well as at a domain root on Vercel or Netlify.
 */

import { asset, resolve } from '$app/paths';

type AssetPath = Parameters<typeof asset>[0];

// `resolve` is typed as a union of single-route overloads, which cannot accept a value
// narrowed only at runtime. Call sites use the known FoodRush route table, so one local
// signature keeps the helper honest without widening the route types themselves.
const resolvePath = resolve as unknown as (pathname: string) => string;

/** Resolve an app route to an href, with the trailing slash the adapter expects. */
export function href(route: string): string {
	const [pathname, query] = route.split('?');
	const clean = pathname.endsWith('/') ? pathname : `${pathname}/`;
	const resolved = resolvePath(clean);
	return query ? `${resolved}?${query}` : resolved;
}

/** Resolve a file in `static/` - used for the catalog JSON and the food artwork. */
export function assetUrl(file: string): string {
	return asset(file as AssetPath);
}

/** URL of a dish illustration, falling back to the generic plate art. */
export function dishArt(art: string | undefined | null): string {
	const key = art && /^[a-z0-9-]+$/.test(art) ? art : 'fallback';
	return assetUrl(`/img/dish/${key}.svg`);
}

/** The fallback illustration, used by the <img> onerror handler. */
export function fallbackArt(): string {
	return assetUrl('/img/dish/fallback.svg');
}
