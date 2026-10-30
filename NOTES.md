# FoodRush — build notes

Decisions, the bugs the test suites actually caught, and what is deliberately out of scope.

---

## Test results

| Suite | Command | Result |
| --- | --- | --- |
| Type check | `npm run check` | **0 errors**, 2 warnings (both suppressed-by-design, see below) |
| Unit | `npm run test` | **183 passed** / 183 |
| End-to-end (headless Chrome, real build) | `npm run probe` | **58 passed** / 58 |
| Accessibility (axe-core + keyboard) | `npm run probe:a11y` | **49 passed** / 49 |
| PDF glyph (OS PDF engine, pixel-level) | `npm run probe:glyph` | **1 passed** / 1 |
| Live site (deployed URL, anonymous) | `npm run probe:live` | **17 passed** / 17 |

Zero browser console errors across both browser suites — each collects every `console.error`
and `pageerror` for the whole run and asserts the list is empty as its final check.

Unit coverage by module: money 13, pricing 24, coupons 16, cart 21, catalog 31, orders 34,
storage 25, PDF font encoding 19.

The two remaining `svelte-check` warnings are `state_referenced_locally` in
`AddressForm.svelte`, explicitly suppressed with `svelte-ignore`: the form seeds `$state`
from its `initial` prop on purpose and re-seeds through an effect when the parent swaps in a
different address. A `$derived` cannot be used because the form must be editable.

---

## Bugs found by the suites and fixed at the root

These were all real defects in my own code, caught by automation rather than by looking:

1. **Invalid SVG artwork (duplicate attribute).** Two illustration helpers emitted `fill`
   twice on the same `<path>`, producing XML that Chrome refuses to decode — `cake.svg` and
   `momo.svg` silently fell back to the placeholder. Fixed the helpers, and added a
   validation pass to `make-art.mjs` that throws on any duplicate attribute, `NaN` or
   `undefined` in generated output, so it cannot regress.

2. **Add button was unclickable.** The ADD/stepper control is pulled up over the dish image
   with `-mt-5`, but its wrapper created no stacking context, so the *next* card's image
   painted over it and swallowed the click. Playwright reported `<img …> intercepts pointer
   events` on a real add. Fixed with `relative z-10`.

3. **Sticky bars ate scroll targets.** Jumping to a menu category parked the heading
   underneath the sticky header and category tabs. Fixed globally with `scroll-padding-top`
   / `scroll-padding-bottom` rather than per-call offsets.

4. **Filters updated the URL but not the list.** The biggest one. Two compounding causes:
   reading `page.url.searchParams` did not re-trigger the derived (the object identity is
   stable), and SvelteKit's shallow `replaceState()` rewrites the address bar *without*
   updating `page.url` at all. So the URL said `?q=biryani` while the list still showed all
   30 kitchens. Fixed by deriving from `page.url.search` (a string) and navigating with
   `goto(…, { replace: true, reset: false })`.

5. **Tablet header overflowed.** At 834 px the inline nav (`md:flex`) plus the location pill
   and two icon buttons exceeded the viewport, giving 150 px of horizontal scroll. The
   inline nav now appears at `lg` and the overflow menu covers everything below it.

6. **Back lost the scroll position.** Three layered causes: infinite scroll reset to 9 cards
   so the page was too short to scroll back into; the scroll was restored before the
   catalog-driven list had painted; and the scroll listener faithfully recorded the 0 that
   SvelteKit sets when navigating away, overwriting the position being saved. Fixed by
   remembering paging + offset per filter set in `sessionStorage`, restoring only once the
   list is tall enough, and freezing recording on `beforeNavigate`.

7. **Landing page shipped an empty shell.** `ssr = false` meant `build/index.html` contained
   no real markup — bad for SEO and link previews. Turned SSR on for the prerender pass and
   opted the three query-param routes out individually, since query params are unreadable
   during prerendering (`url_search_unavailable_prerender`).

8. **Rating average did not reproduce the catalog rating.** The star-distribution shape was
   a plausible bell, but bounding it to 1..5 truncates it asymmetrically, so a 4.4-star
   restaurant rendered as 4.2. Fixed by mixing the bell with a point mass at the nearest
   extreme using the factor that corrects the mean in closed form. A second test asserts it
   across eight target averages.

9. **Contrast failures in both themes.** axe found several: `#a89582` muted text at 2.88:1
   on white, `#857262` at 4.41:1 on the cream page, white-on-`#f5820b` buttons and offer
   tags at 2.59:1, the veg green as 12 px text at 4.44:1, and `#ef4444` danger text at
   4.37:1 on dark cards. All fixed by computing replacements with a contrast calculator, and
   by splitting the neutral ramp into light-mode text steps (`cocoa-400/500`) paired with
   `dark:text-cocoa-300`, with the original tints preserved as `-soft` for borders and
   decorative fills.

10. **`opacity` on containers broke contrast.** Dimming an out-of-stock dish or an
    inapplicable coupon with `opacity-60` / `opacity-80` multiplies its *text* against the
    page behind it, pushing already-AA colours down to 4.19:1 and 3.83:1. Replaced with an
    `fr-dimmed` utility that mutes the surface and drops saturation while leaving every
    glyph at full opacity.

11. **Dark mode could be silently discarded.** `app.html` applies the saved theme before
    first paint, but on a first visit (or after a corrupted payload) the store's own default
    is `'system'`, and `#syncTheme()` then re-derived the class from the media query and
    threw away an explicit earlier choice. The store now reads the standalone theme key back
    during hydrate.

12. **Scrollable rails had no keyboard access**, and the first fix broke list semantics.
    `role="group"` on the `<ul>` strips the list role from its `<li>`s (axe: `listitem`), so
    the focusable scroll region is now a wrapper *around* the list.

13. **Duplicate accessible names.** "Remove" appeared on both the coupon and the cart line;
    "Cancel order" on both the page button and the dialog's confirm; the stepper's minus
    announced itself as "Remove X from cart" at quantity 1, colliding with the real remove
    button. All given distinct, specific labels — better for screen readers, and
    unambiguous for automation.

14. **Awkward validation copy.** Required-option errors read "Pick a choose size." Group
    names are already written as instructions, so the message now reuses them verbatim:
    "Choose size to continue."

## Printing ₹ in the PDF invoice

The invoice used to print "Rs." because the PDF base-14 fonts are WinAnsi-encoded and have
no U+20B9 glyph; emitting the character against them paints a blank box. Fixing it properly
meant embedding a font, which is a bigger change than it sounds:

- **Font choice.** Noto Sans, because it has the glyph and is under the SIL OFL so it can be
  redistributed. Sourced from `@expo-google-fonts/noto-sans`, which ships real `.ttf` files -
  most npm font packages ship only `woff2`, which a PDF cannot embed at all (PDF needs
  TrueType or CFF outlines). The TTFs are committed under `vendor/fonts/`; nothing is
  fetched from a CDN.
- **Subsetting.** Embedding both full weights would add 1.26 MB to every generated invoice,
  so `scripts/make-fonts.mjs` subsets them to ~206 glyphs (~15 KB each). It keeps `.notdef`
  at glyph 0, remaps the survivors to a dense range, **rewrites composite-glyph component
  indices** (otherwise accented characters render empty), rebuilds `loca` in long format and
  `hmtx` as full long metrics, and emits a valid sfnt directory with per-table checksums. It
  throws if the rupee glyph is absent, so swapping in a wrong font fails the build.
- **Embedding.** CIDFontType2 + Identity-H, so content-stream text is 2-byte glyph ids
  rather than characters. That moved text encoding into `pdf-font.ts`, where `encode()` and
  `widthOf()` must agree exactly or right-aligned columns drift - there is a test for that.
- **Searchability.** A `/ToUnicode` CMap per weight maps the glyph ids back to characters.
  Without it the PDF renders fine but selecting "₹1,250" yields glyph indices.
- **Binary assembly.** The writer previously built the PDF as a latin-1 string; font streams
  are binary, so it now assembles `Uint8Array` chunks and computes xref offsets in BYTES.
- **Fallback.** Characters outside the subset become `?`, never glyph 0.
- **Async.** `invoicePdf()` is now async (it fetches the font once, then caches). The
  Orders page shows "Building PDF...", blocks re-entry, and surfaces a font-load failure as
  a toast rather than silently emitting a document full of empty boxes.

### How it was verified

Proving "the ₹ is not a blank box" needed more than a string check, and two cheaper attempts
were thrown away for being unsound:

1. **Ink volume** - comparing total dark pixels against a `.notdef` control. Rejected: Noto's
   `.notdef` is a hollow rectangle whose ink is within ~10% of the rupee's, so the signal was
   113 pixels out of ~38,000. It technically passed while proving nothing.
2. **Correlating against a browser-rendered reference** - rejected because the browser may
   silently substitute a different font, so a pass could reflect the fallback rather than the
   embedded subset.

The check that shipped (`probes/glyph.probe.ts`) parses glyph 204's quadratic outline
directly out of the subset TTF, redraws it from those raw coordinates via `Path2D`, and
correlates it against the same glyph rendered by the **operating system's** PDF engine
(`qlmanage`/PDFKit - an independent renderer, not the code under test). Result: **0.998**
against the correct outline and **-0.04** against `.notdef`, with a reversed control proving
the comparison can tell them apart. It skips automatically off macOS, where the rest of the
suite still covers the semantics.

The e2e suite additionally seeds orders at **₹49, ₹1,250 and ₹1,00,000**, clicks the real
Invoice buttons, and decodes each downloaded PDF back through its own embedded CMap -
asserting the amount appears with lakh grouping, that "Rs." is gone, that no glyph fell
through to `.notdef`, and that both embedded programs are real TrueType. A separate probe
confirms the fonts are served as real files (sfnt magic bytes, not the SPA HTML fallback),
and the sub-path hosting check was re-run to confirm the invoice still works when the app is
served from `/foodrush/`.

---

### Probe bugs fixed in the probes (the app was right)

Worth recording so they are not mistaken for app behaviour: the tip assertion treated
rupee-formatted digits as paise; FREEDEL was asserted on a ₹129 cart that is legitimately
below its ₹149 minimum; corrupt-data probes wrote to `localStorage` from a loaded page,
where the app's own `pagehide` flush (which protects the cart on refresh) correctly
overwrote them before the reload — they now inject via `addInitScript`; and the scroll probe
clicked a card above the fold, so Playwright scrolled up first and the probe was measuring
its own auto-scroll.

---

## Deliberate decisions

- **No coupon stacking.** At most one coupon per order. Stacking free-delivery with a
  percentage discount is where double-discount bugs live; `rankCoupons` instead surfaces the
  single best option and shows honest reasons for every coupon that does not apply.
- **Discounts never touch fees or taxes.** A coupon reduces the item total only, then tax is
  charged on the discounted food. This matches real aggregator bills and keeps the
  government's share from being discounted twice.
- **Compressed delivery clock.** Delivered lands ~150 s after placing so the whole flow is
  demonstrable; the ETA shown still uses each restaurant's real estimate.
- **Illustrated tracking map.** A demo app has no business loading a tile provider, and an
  illustrated route is honest about being simulated. The rider rides the drawn cubic curve
  by de Casteljau subdivision, so the marker is always exactly on the line.
- **Query params over route segments** for restaurant/order ids, so every route prerenders
  to a real file and deep links survive a hard refresh on any static host.
- **Dependency-free PDF.** A one-page A4 invoice is a few text runs; pulling in ~400 KB of
  pdf-lib for that is the wrong trade. The writer emits a valid PDF 1.4 with a real xref
  table, verified in the e2e suite by magic bytes and `%%EOF`.
- **Hand-written SVG artwork** rather than stock photography: no licences, and exact
  intrinsic dimensions so the layout cannot jump.
- **`200.html`, not `index.html`, as the SPA fallback.** Naming it `index.html` makes the
  adapter overwrite the prerendered landing page with a bare JS shell, costing the real
  `<h1>` and description in the served markup.

---

## Verified by hand in a real browser

Location choice → filter restaurants → open a menu → veg toggle → customise a dish → add to
cart → apply and remove a coupon → change quantities → add an address → place an order →
watch tracking through to delivery → rate the order → reorder from history → favourite a
restaurant → owner view marks a dish out of stock (and it vanishes from the customer menu
and the cart) → theme switch → refresh on every page. Checked at 390 px, 834 px and 1440 px.
Each of those steps also exists as an automated probe.

Static-hosting checks performed:

- `cd build && python3 -m http.server` — index, deep routes, data files and SVGs all 200
- served under `/foodrush/` in a real browser — 12 cards rendered, zero failed requests,
  confirming relative asset and data URLs work on a GitHub Pages sub-path

---

## Deployment verification

The live site was checked the same way the local build is: `probes/live.probe.ts` drives the
**deployed** URL in a fresh, cookie-less browser context and fails on any console error. 17
checks cover the public-ness of the alias, the catalog JSON and invoice fonts being served as
real files (asserted on `Content-Type` and on the sfnt magic bytes, so an HTML fallback could
not pass), every deep link resolving while a genuinely missing asset still 404s, and then the
full journey: location, filters, veg toggle, customisation with live pricing, cart, coupon
apply/reject/remove, address validation, order placement, tracking through to Delivered with a
mid-flight refresh proving the order resumes, rating, reorder, PDF invoice download decoded
back through its own embedded CMap to confirm the rupee glyph, owner view out-of-stock, dark
mode across a reload, and no horizontal overflow at 390/834/1440 px.

One genuine surprise during deployment: `vercel link` appends `.env*` to `.gitignore`, which
would have silently cancelled this project's existing `!.env.example` exception. It was
replaced with explicit `.vercel/` and `.env.local` patterns.

---

## Known limitations

- Demo auth/payments do not exist at all; there are no accounts, so "your data" means this
  browser's `localStorage`
- The owner console trusts whoever opens it — there is no restaurant login
- The catalog is static: new restaurants or dishes require re-running `npm run data`
- Reviews only ever come from this browser, so the rating breakdown blends the user's own
  reviews with the catalog's baseline count rather than showing a real review corpus
- No service worker, so the app needs a network round-trip for its data files on first load
- Deployed to Vercel at https://foodrush-zeta.vercel.app from
  https://github.com/DIVYAPRIYADHARSHINI-GIT/foodrush. Deployment Protection sits at its
  default scope (`all_except_custom_domains`), so the production alias is public while raw
  per-deployment URLs return 302 to anonymous visitors - share the alias, not the hashed URL.
