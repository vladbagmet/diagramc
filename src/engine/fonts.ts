import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { theme } from '../core/theme.js';

/**
 * Text measurement with the pinned Inter font (assets/fonts, SIL OFL 1.1), shaped
 * by HarfBuzz with default features, which is what Chrome and resvg do. Rendered
 * SVGs embed a subset of the same font, so measured and displayed widths agree
 * (see docs/decisions/0001-fonts.md for the verification).
 */

export type FontStyleKey = 'regular' | 'italic' | 'bold' | 'bold-italic';
export interface TextStyle {
  size: number;
  bold?: boolean;
  italic?: boolean;
}

const files: Record<FontStyleKey, string> = {
  regular: 'Inter-Regular.ttf',
  italic: 'Inter-Italic.ttf',
  bold: 'Inter-Bold.ttf',
  'bold-italic': 'Inter-BoldItalic.ttf',
};
const fontDirectory = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));

/** Absolute paths of the pinned font files (for resvg and the PlantUML runtime). */
export const fontFiles: readonly string[] = Object.values(files).map(name => fontDirectory + name);

/** Layout features kept in embedded subsets: the ones HarfBuzz applies by default to Latin text. */
const SHAPING_FEATURES = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'clig', 'rlig', 'rclt', 'curs', 'dist'];

export function styleKey(style: { bold?: boolean | undefined; italic?: boolean | undefined }): FontStyleKey {
  return style.bold ? (style.italic ? 'bold-italic' : 'bold') : style.italic ? 'italic' : 'regular';
}

type HarfBuzz = typeof import('harfbuzzjs');
interface LoadedFace {
  font: InstanceType<HarfBuzz['Font']>;
  upem: number;
  coverage: Set<number>;
  ascender: number;
  descender: number;
}

export interface FontMetrics {
  /** Advance width in px of a single line of text. */
  measure(text: string, style: TextStyle): number;
  /** Distance from baseline to the top of the line box content (px). */
  ascent(size: number): number;
  /** Distance from baseline to the bottom of the line box content (px). */
  descent(size: number): number;
  /** Line advance for multi-line text (px). */
  lineHeight(size: number): number;
  /** The text split into runs the pinned font draws (covered) and runs it lacks (CJK, emoji). */
  runs(text: string, style: TextStyle): { text: string; covered: boolean }[];
}

let loading: Promise<FontMetrics> | undefined;

/** Loads HarfBuzz (WebAssembly) and the four pinned faces once per process. */
export function loadFonts(): Promise<FontMetrics> {
  loading ??= (async () => {
    const hb: HarfBuzz = await import('harfbuzzjs');
    const faces = {} as Record<FontStyleKey, LoadedFace>;
    for (const [key, name] of Object.entries(files) as [FontStyleKey, string][]) {
      const face = new hb.Face(new hb.Blob(readFileSync(fontDirectory + name)));
      const font = new hb.Font(face);
      const extents = font.hExtents();
      faces[key] = { font, upem: face.upem, coverage: new Set(face.collectUnicodes()), ascender: extents.ascender, descender: -extents.descender };
    }
    const cache = new Map<string, number>();
    const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const shape = (face: LoadedFace, run: string): number => {
      const buffer = new hb.Buffer();
      buffer.addText(run);
      buffer.guessSegmentProperties();
      hb.shape(face.font, buffer);
      let width = 0;
      for (const position of buffer.getGlyphPositions()) width += position.xAdvance;
      return width / face.upem;
    };
    const regular = faces.regular;
    return {
      measure(text, style) {
        const key = `${styleKey(style)}\0${text}`;
        let em = cache.get(key);
        if (em === undefined) {
          const face = faces[styleKey(style)];
          em = 0;
          let run = '';
          for (const { segment } of graphemes.segment(text)) {
            if ([...segment].every(c => face.coverage.has(c.codePointAt(0)!) || DEFAULT_IGNORABLE.test(c))) {
              run += segment;
              continue;
            }
            if (run) {
              em += shape(face, run);
              run = '';
            }
            em += fallbackWidth(segment);
          }
          if (run) em += shape(face, run);
          cache.set(key, em);
        }
        return em * style.size;
      },
      ascent: size => (size * regular.ascender) / regular.upem,
      descent: size => (size * regular.descender) / regular.upem,
      lineHeight: size => Math.round(size * theme.font.lineHeight),
      runs(text, style) {
        const face = faces[styleKey(style)];
        const out: { text: string; covered: boolean }[] = [];
        for (const { segment } of graphemes.segment(text)) {
          const covered = [...segment].every(c => face.coverage.has(c.codePointAt(0)!) || DEFAULT_IGNORABLE.test(c));
          const last = out.at(-1);
          if (last?.covered === covered) last.text += segment;
          else out.push({ text: segment, covered });
        }
        return out;
      },
    };
  })();
  return loading;
}

const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u{3000}-〿！-｠￠-￦]/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * Width in em of a grapheme the pinned font cannot draw. The viewer substitutes a
 * system font, so this is a deliberately generous estimate: full width for CJK,
 * wider for emoji, and a wide Latin-like glyph for everything else.
 */
function fallbackWidth(grapheme: string): number {
  if (EMOJI.test(grapheme)) return 1.3;
  return WIDE.test(grapheme) ? 1.02 : 0.7;
}

/**
 * CSS @font-face rules embedding a subset of each used style (WOFF2, base64 data
 * URL), covering exactly the characters in `usage`. Deterministic for equal input.
 */
export async function fontFaceCss(usage: ReadonlyMap<FontStyleKey, string>): Promise<string> {
  const { default: subsetFont } = await import('subset-font');
  const rules: string[] = [];
  for (const key of Object.keys(files) as FontStyleKey[]) {
    const text = usage.get(key);
    if (!text) continue;
    const characters = [...new Set([...text, ' '])].sort().join('');
    const subset = await subsetFont(readFileSync(fontDirectory + files[key]), characters, { targetFormat: 'woff2', keepFeatures: SHAPING_FEATURES });
    const bold = key.startsWith('bold'),
      italic = key.endsWith('italic');
    rules.push(
      `@font-face{font-family:"${theme.font.family}";font-style:${italic ? 'italic' : 'normal'};font-weight:${bold ? theme.font.weight.bold : theme.font.weight.regular};src:url(data:font/woff2;base64,${subset.toString('base64')}) format("woff2")}`,
    );
  }
  return rules.join('');
}
