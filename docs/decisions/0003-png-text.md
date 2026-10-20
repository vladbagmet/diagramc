# 0003: Text in PNG output (mixed scripts, emoji)

Status: accepted. Date: 2026-10-19.

Context: review findings A-18 (bold lost on mixed-script names in PNG) and O-10
(emoji drawn as a box in PNG).

## Problem

PNG output is rasterized with resvg-js 2.6.2 (`src/engine/png.ts`) using the pinned
Inter files plus system fonts for glyphs Inter lacks. Two resvg behaviours show up:

1. A `<text>` element containing any glyph Inter lacks (CJK, emoji) is drawn
   entirely in a fallback font. Its Latin part loses Inter and its weight: the class
   name **Kundin · Zoë 注文** came out regular in a system sans-serif. Splitting
   the line into `<tspan>`s does not help, the whole element is one font run.
2. Colour emoji fonts (Apple Color Emoji, Noto Color Emoji) are not drawn at all;
   once a text element contains one, every glyph of it is drawn as a box.

## Decision

- **Mixed scripts: fixed.** For own-engine SVGs, `rasterize` splits every text line
  that mixes covered and uncovered glyphs into one `<text>` element per run
  (`splitFallbackRuns`), placed at the widths the engine measures. Inter runs keep
  their weight and style; fallback runs use the system font. The SVG output is
  unchanged (browsers do per-glyph fallback themselves).
- **Emoji: documented, not bundled.** Each emoji is replaced by "□" (U+25A1) in PNG
  output only; SVG output keeps the emoji and every viewer draws it in colour.
  We do not bundle an emoji font for rasterization:
  - resvg cannot draw colour emoji fonts at all, so only a monochrome font would
    work (Noto Emoji, SIL OFL 1.1). Its outline font is about 2 MB, more than the
    four Inter files together, for a character class that UML names rarely use.
  - Installs are offline (`npm ci --offline`), so the font would have to live in the
    repository and the npm package, doubling the package's font payload.
  - A monochrome emoji next to colour emoji in the SVG of the same diagram would
    make the two outputs differ in a more surprising way than a clear box.

## Consequences

- PNG and SVG agree on fonts and weights for Latin text in every line.
- Fallback runs in PNG are placed with the engine's generous width estimates
  (decision 0001), so spacing around CJK can be a little looser than in a browser.
- Agents that need emoji in a raster image should render SVG and rasterize it with
  a browser. README ("Fonts") states the limitation.
