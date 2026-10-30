// This route reads its target from the QUERY STRING (?id= / ?q= / filters), and query
// params are not available during prerendering - SvelteKit throws
// `url_search_unavailable_prerender` if a prerendered page touches them. So this page
// opts out of the prerender render pass and renders in the browser instead.
//
// The route is still PRERENDERED as a file (so a hard refresh and a deep link resolve to
// real HTML on any static host); only its server-side render pass is skipped.
export const ssr = false;
