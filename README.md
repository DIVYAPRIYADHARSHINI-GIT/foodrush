# FoodRush — "Hungry? Order in minutes."

A polished, browser-only food ordering and delivery demo for Indian cities: browse
neighbourhood restaurants, filter veg/non-veg, customise dishes, build a cart, apply
coupons, check out, track the rider live, rate the food, reorder, and flip into a simple
restaurant-owner console.

Everything is simulated. There is no server, no account, no database and no payment
processing — the catalog ships as real JSON files and all of your cart, orders, addresses,
reviews and favourites live in `localStorage`.

---

## Quick start

```bash
npm install
npm run dev        # dev server (regenerates artwork + catalog first)
npm run build      # production build -> ./build
npm run preview    # preview the production build
```

**Build output folder: `build/`** — it contains `index.html` at its root and is a plain
static site. It works unchanged from:

```bash
cd build && python3 -m http.server 8000
```

…as well as Vercel, Netlify and a GitHub Pages sub-path (all asset and data URLs are
relative, verified by a probe that serves the build under `/foodrush/`).

### Tests

```bash
npm run check       # svelte-check / TypeScript
npm run test        # 183 unit tests (pure logic, storage, PDF font encoding)
npm run probe       # 58 end-to-end checks in headless Chrome, against the real build
npm run probe:a11y  # 49 accessibility + keyboard checks (axe-core)
npm run probe:glyph # pixel proof that the PDF draws a real ₹ (macOS PDF engine)
npm run test:all    # all five, in order
```

---

## Design identity

One bold accent: **marigold saffron `#f5820b`**, deliberately neither Swiggy orange
(`#FC8019`) nor Zomato red (`#E23744`) — it sits between them on the wheel and runs deeper.
It is paired with a warm charcoal-cocoa neutral ramp and a cream "paper" page surface so
food artwork is the brightest thing on screen. Type is Plus Jakarta Sans.

- Light-first with a full dark theme, applied before first paint so there is no flash
- Mobile-first: bottom tab bar, sticky cart bar, 44 px minimum tap targets
- Skeleton loaders, friendly empty states, rounded cards, subtle motion (respects
  `prefers-reduced-motion`)
- Veg/non-veg marks are the regulated Indian symbols — a green dot in a green square and a
  red triangle in a red square — and are the one pair of colours theming never touches.
  They differ in **shape** as well as colour, and each carries an explicit ARIA label.

### Original artwork, no stock photos

All 23 dish illustrations, the hero spread and the favicon are generated as SVG from
primitives by `scripts/make-art.mjs` — zero third-party image licences, and exact intrinsic
dimensions (4:3 dishes, 16:9 hero) so cards never shift while images load. A broken or slow
image falls back to a generic plate illustration inside a correctly-sized box.

---

## The invoice PDF and the rupee sign

The invoice is generated in the browser by a dependency-free PDF writer, and it prints real
**₹** signs. That requires an embedded font: the PDF base-14 fonts (Helvetica, Times,
Courier) are WinAnsi-encoded and have no U+20B9 glyph, so emitting the character against
them renders a blank box - which is why an earlier revision fell back to "Rs.".

- **Font:** Noto Sans, under the SIL Open Font License, vendored as real `.ttf` files in
  [`vendor/fonts/`](vendor/fonts/README.md). Nothing is loaded from a CDN, at build time or
  at runtime.
- **Subset:** `npm run fonts` reduces both weights from 629 KB/631 KB to ~15 KB each,
  keeping the ~206 glyphs an invoice can print. It rebuilds `loca`/`hmtx`, remaps composite
  component indices, and **throws if the rupee glyph is ever missing**.
- **Embedding:** CIDFontType2 with Identity-H encoding, so content-stream text is 2-byte
  glyph ids. A `/ToUnicode` CMap is included, so the PDF stays searchable and copy-pasteable
  rather than yielding raw glyph indices on selection.
- **Fallback:** any character outside the subset becomes `?`, never glyph 0 - the empty box
  is exactly what this design eliminates.
- Indian lakh/crore grouping is untouched; it still comes from `formatPaise`.

Verified at **₹49**, **₹1,250** and **₹1,00,000** (the lakh case) by decoding the generated
PDFs back through their own embedded CMap, and by a pixel probe that renders a 200pt glyph
with the operating system's PDF engine and correlates it against the outline parsed from the
font file: **0.998 against the real rupee outline, -0.04 against `.notdef`**. Rendered proof:
[`probes/screenshots/invoice-pdf-rupee-lakh.png`](probes/screenshots/invoice-pdf-rupee-lakh.png).

---

## The data

Generated deterministically by `scripts/build-data.mjs` into `static/data/`:

| File | Contents |
| --- | --- |
| `restaurants.json` | **30 restaurants** across 11 Bengaluru areas |
| `menus.json` | **414 dishes**, minimum 9 per restaurant |
| `coupons.json` | 7 coupons incl. `WELCOME50`, `FREEDEL`, `SAVE20`, `BROS40` (restaurant-specific) and one deliberately expired |
| `areas.json` | 11 delivery areas with real pin codes |
| `categories.json` | 11 cuisine categories |

Cuisines: South Indian, North Indian, Chinese, Biryani, Pizza, Burgers, Desserts, Healthy,
Beverages, Street Food, Coastal. Fictional restaurant names written the way neighbourhood
restaurants actually name themselves (Dosa Darbar, Nizam's Dum House, Crust Culture, Mithai
Mahal), real dishes, real menu-board descriptions, and 2026 mid-range Bengaluru prices.
Biryani Bros. ships one dish out of stock on purpose so the unavailable/reorder/owner flows
have real data on first load.

---

## Architecture

### One store, one pricing function

`src/lib/stores/app.svelte.ts` is the single source of truth for restaurants, menus, cart,
coupons, addresses, orders, reviews, favourites, availability and settings. No view keeps
its own copy of anything — the listing, menu, sticky bar, cart, checkout, tracking, history,
ratings and owner console all read from it and all write through its methods.

`priceCart()` in `src/lib/logic/pricing.ts` is the **only** thing that computes money. Cart,
sticky bar, checkout, receipt and reorder all render its single result, so no two screens
can disagree. Order of operations is fixed and tested:

1. item total = Σ (base + options) × quantity
2. packaging = per-line charge, capped
3. delivery fee = distance slabs (flat < 2 km, then per-km beyond 10 km)
4. coupon discount, applied to the **item total only**
5. taxes = 5% GST on discounted food + 18% on the delivery fee
6. tip, added last — never taxed, never discounted
7. total, floored at zero

**All money is integer paise.** Every monetary field is suffixed `Paise`; no float rupee
value is ever stored, summed or compared. Rounding happens in exactly two places — one
round-half-up helper for percentages, and the display formatter. Output uses Indian
lakh/crore grouping (`₹1,23,456`).

### Derived, never cached

Totals, cart problems, coupon eligibility, live ratings, order status and availability are
all `$derived` or pure functions over raw state. Editing anything corrects every dependent
view automatically: adding an item updates the dish stepper, sticky bar and cart together;
a new review moves the restaurant's average; marking a dish out of stock in the owner view
removes it from the customer menu **and** from the live cart, with a message.

### Time, not timers

Order status is a pure function of `now - placedAt` (`logic/orders.ts`), clamped against the
highest status already recorded so it can never move backwards. That means refreshing during
tracking resumes exactly where it was, a throttled background tab cannot drift, and there is
one shared 1-second clock in the store rather than a timer per page.

### Storage safety

Every read and write is wrapped — nothing in `stores/storage.ts` throws. Saved data carries
a version; newer data is **refused** rather than mangled, older data walks a migration list,
and structurally broken data is parked under `foodrush:data:unreadable` so a corrupted file
is never destroyed by the first autosave. Malformed cart lines are dropped individually
rather than costing the whole order history.

### Routing

Deep links use query params (`/restaurant/?id=…`, `/order/?id=…`) so every route prerenders
to a real file and a hard refresh resolves on any static host. Listing filters live in the
URL, which is what makes "filters kept when navigating back" work with no snapshot code, and
paging + scroll position are remembered per filter set so Back lands where you left.

---

## Pages

| Route | What it does |
| --- | --- |
| `/` | Hero, location picker (permission-aware "use current location" + popular areas), category rail, offers carousel, top-rated and fastest sections |
| `/restaurants` | Search (restaurants **and** dishes), 5 sort modes, veg/rating/fast/offers/cuisine/price filters, active chips + clear all, infinite scroll |
| `/restaurant/?id=` | Header with rating/time/offers/address/hours, veg-non-veg toggle, menu search, scroll-spy category tabs, bestseller + recommended tags, customisation dialog, replace-cart confirmation, rating breakdown and reviews |
| `/cart` | Lines with steppers and customisations, per-item notes, cart problems (gone / out of stock / price changed), coupon box + offers sheet, tip selector, full bill |
| `/checkout` | Saved addresses with add/edit/delete/default, delivery now or scheduled slots, UPI/card/wallet/COD with validation (clearly marked demo), order review, double-submit-proof Place order |
| `/order/?id=` | Live status timeline, ETA countdown, illustrated route with a moving rider, delivery-partner card, cancel window with honest refusal afterwards, items + receipt, rating prompt |
| `/orders` | Past orders with status, items, totals, reorder (warns about unavailable items and price changes) and a real PDF invoice |
| `/offers` | Coupon wallet showing each coupon's true status against the current cart |
| `/favourites` | Favourite restaurants and dishes |
| `/profile` | Details, order stats, addresses, theme, veg default, reduced motion, language setting, JSON backup/restore, start fresh |
| `/owner` | Restaurant console: accept → preparing → ready → delivered, and per-dish availability toggles that hit the customer app instantly |

---

## Accessibility

49 automated checks pass, including **axe-core across 10 pages × 2 themes × 2 widths** with
zero serious or critical violations, plus explicit keyboard probes:

- Skip link is the first tab stop; every interactive control is reachable and named
- Dialogs trap Tab/Shift+Tab, close on Escape and restore focus to the opener
- Every focused element paints a visible ring (asserted on real computed styles)
- Every image has `alt` plus fixed `width`/`height`
- Star ratings are real radiogroups driven by arrow keys

Several real contrast bugs were found and fixed by those probes rather than by eye — see
NOTES.md.

---

## Project layout

```
foodrush/
├── scripts/            build-data.mjs (catalog), make-art.mjs (artwork), make-fonts.mjs (PDF font subset)
├── src/
│   ├── app.css         design tokens + component utilities
│   ├── app.html        pre-paint theme script
│   ├── lib/
│   │   ├── components/ FoodImage, VegBadge, Stepper, Dialog, Stars, cards, bill, map…
│   │   ├── export/     dependency-free PDF invoice writer + embedded-font encoder
│   │   ├── logic/      money, pricing, coupons, cart, catalog, orders (+ tests)
│   │   └── stores/     app.svelte.ts (the store), storage.ts (+ tests)
│   └── routes/         one folder per page
├── probes/             headless-Chrome e2e + axe suites, screenshots
├── static/             generated data/, img/ and fonts/ (rebuilt by prebuild)
├── vendor/fonts/       OFL-licensed Noto Sans source TTFs (committed, not fetched)
├── vercel.json         output dir, SPA rewrite, hashed-asset caching
└── NOTES.md            decisions, bugs found, limitations
```

---

## Deployment

`vercel.json` sets `outputDirectory: build`, rewrites unmatched routes to `200.html` (real
files and asset extensions are excluded so data files never return HTML), and sets
`immutable` caching on hashed assets. Nothing needs environment variables.

---

## Limitations (deliberate)

- Payments, riders, restaurants and ETAs are simulated; the tracking map is an illustrated
  route, not a tile provider
- The demo delivery clock is compressed (delivered ≈ 2.5 minutes) so the whole flow is
  watchable; the displayed ETA still uses each restaurant's real estimate
- "Use current location" maps to the nearest listed serviceable area and says so — there is
  no reverse geocoder
- Only English ships, though the language setting is persisted so more can be added without
  a data migration
- The PDF invoice embeds a subset of Noto Sans so it can print real `₹` signs; the
  vendored source fonts add ~1.2 MB to the repository (but only ~31 KB to the build)
