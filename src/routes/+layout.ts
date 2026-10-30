// Static site: every route is prerendered at build time.
//
// SSR is ON for the prerender pass only (there is no server at runtime). That is what makes
// `build/index.html` carry the real <h1>, headings and description instead of an empty
// JS-only shell - better for SEO, for link previews, and for anyone who sees the page
// before the bundle arrives. All browser-only work (localStorage, geolocation, the shared
// clock, the catalog fetch) is guarded by `browser` / `onMount`, so the prerender pass
// emits the loading state and the client hydrates over it.
//
// `trailingSlash: 'always'` matches vercel.json and keeps deep links
// (/restaurant/?id=..., /order/?id=...) working identically on Vercel, Netlify, GitHub
// Pages and a plain `python3 -m http.server` run from inside the build folder.
export const prerender = true;
export const ssr = true;
export const trailingSlash = 'always';
