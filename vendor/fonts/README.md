# Vendored fonts

These are the **source** fonts for the PDF invoice. They are committed to the repository on
purpose: nothing in FoodRush is fetched from a CDN, at build time or at runtime.

| File | What it is |
| --- | --- |
| `NotoSans-Regular.ttf` | Noto Sans Regular, full TrueType (629 KB) |
| `NotoSans-Bold.ttf` | Noto Sans Bold, full TrueType (631 KB) |
| `OFL.txt` | SIL Open Font License 1.1 — the licence these are distributed under |

Obtained from the `@expo-google-fonts/noto-sans` package (`400Regular` and `700Bold`),
which redistributes the upstream Noto Sans builds as real `.ttf` files. Most font packages
on npm ship only `woff2`, which a PDF cannot embed — PDF needs TrueType or CFF outlines.

## Why Noto Sans

It contains **U+20B9, the Indian rupee sign (₹)**. The PDF base-14 fonts (Helvetica,
Times, Courier) are WinAnsi-encoded and have no rupee glyph, so the invoice previously fell
back to printing "Rs."; emitting the character anyway renders a blank box in the reader.

## These files are not what ships

`npm run fonts` (`scripts/make-fonts.mjs`) subsets them to the ~206 glyphs an invoice can
actually print and writes the result to `static/fonts/`:

```
noto-sans-invoice-regular.ttf   ~15 KB
noto-sans-invoice-bold.ttf      ~15 KB
noto-sans-invoice.json          cmap + advance widths for the PDF writer
```

Embedding the full 1.2 MB of both weights to typeset one page would be the wrong trade; the
subsets are ~2.5% of that. The subsetter keeps `.notdef` at glyph 0, remaps the kept glyphs
to a dense range, rewrites composite-glyph component indices, and rebuilds `loca`/`hmtx`
with a valid sfnt directory and checksums. It throws if the rupee glyph is ever missing, so
a wrong font cannot slip through silently.

`static/fonts/` is generated output and is gitignored; these source files are the input.
