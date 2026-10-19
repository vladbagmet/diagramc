# 0001: One pinned font, measured with HarfBuzz, embedded as a subset

Status: accepted (chunk 0). Date: 2026-10-19.

## Problem

The own engine sizes every box and places every label from text widths it computes
itself. If the viewer draws the text with a different font than the one measured,
text overflows boxes or labels collide. The MVP depended on whatever fonts Java and
the viewer found on the machine.

## Decision

- **Font:** Inter 4.1 (SIL Open Font License 1.1), static TTFs Regular, Italic,
  Bold and Bold Italic, committed in `assets/fonts/` with `OFL.txt`. Source: the
  official release `Inter-4.1.zip`, SHA-256
  `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`
  (files from `extras/ttf/`). Bold, not SemiBold, so both backends use the same faces.
- **Measurement:** `src/engine/fonts.ts` shapes text with HarfBuzz (`harfbuzzjs`
  1.6.2, WebAssembly) using default features, which is what Chrome (HarfBuzz) and
  resvg (rustybuzz) do. Widths include kerning and contextual alternates.
- **Embedding:** every own-engine SVG carries an `@font-face` per used style whose
  source is a WOFF2 subset (`subset-font` 2.9.0, HarfBuzz hb-subset) containing only
  the characters drawn, as a `data:` URL. The subset keeps the default shaping
  features (`kern`, `liga`, `calt`, `ccmp`, `locl`, `mark`, `mkmk`, `clig`, `rlig`,
  `rclt`, `curs`, `dist`), so the browser shapes exactly what was measured.
  Typical cost: 5 to 15 KB per style.
- **PNG:** `src/engine/png.ts` gives resvg the same four TTF files.
- **PlantUML kinds:** `npm run setup:renderer` copies the four TTFs into the pinned
  Java runtime's `lib/fonts/`, PlantUML is configured with `defaultFontName Inter`,
  and `src/plantuml/fonts.ts` embeds the same subset into PlantUML's SVG. PlantUML
  (Java2D) and the engine (HarfBuzz) then agree within about 1 to 2 % (Java does not
  kern); PlantUML also writes `textLength`, so its own layout stays consistent.

## Verification

- Chrome (headless, `getComputedTextLength()` on the embedded subset) against the
  engine's measurement for all 533 text runs of the class gallery: **largest
  deviation 0.20 %**, average far below. First probe, 13 px: `Customer` 59.83 vs
  59.83, `placeOrder(): Order` 120.40 vs 120.41,
  `shippingAddress : Address [0..1] = "x"` 233.00 vs 233.02.
- resvg (anchor-based advance probe, integer bounding boxes) on the same strings:
  within 1 px (`Customer` 60, `WWWWWWWW` 105 vs 104.70).
- Java with Inter installed: `placeOrder(): Order` at 14 px is 130.13 vs HarfBuzz
  129.66 (0.4 %); the integration test asserts below 3 %.
- `test/engine.test.mjs` pins reference widths, so a font or shaping change fails CI.

## Consequences and limits

- **Glyphs Inter lacks** (CJK, emoji, rare scripts) are drawn by the viewer's
  fallback fonts. The engine measures them with deliberately generous estimates
  (CJK 1.02 em, emoji 1.3 em, other 0.7 em), so text fits but spacing can be
  slightly loose. The SVG `font-family` lists common CJK and emoji families.
- **resvg PNG limits** (resvg-js 2.6.2): a text run containing a colour emoji is
  drawn entirely as boxes, so PNG export replaces each emoji with "□" (SVG keeps the
  emoji). A run with a CJK fallback glyph is drawn entirely in the fallback font, so
  bold or italic can be lost in that run in PNG only.
- SVGs are self-contained and render identically on machines without Inter.
- Repository size grows by about 1.7 MB of font files; npm package by the same.
