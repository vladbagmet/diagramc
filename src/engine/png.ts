import { UmlError } from '../core/errors.js';
import { theme } from '../core/theme.js';
import { fontFiles, loadFonts, type FontMetrics } from './fonts.js';
import { escapeText, num } from './svg.js';

/**
 * Rasterizes an SVG with resvg (no browser). The pinned Inter files are loaded
 * explicitly; system fonts are only consulted for glyphs Inter lacks (CJK).
 *
 * Two resvg-js 2.6.2 limitations are handled here (docs/decisions/0003-png-text.md):
 * - A text element that contains any glyph Inter lacks is drawn entirely in the
 *   fallback font, losing Inter and bold for its Latin part. Own-engine lines that
 *   mix covered and uncovered text are therefore split into one text element per
 *   run, placed with the measured run widths.
 * - Colour emoji fonts are not supported: every glyph of a text element is drawn
 *   as a box once it contains a colour emoji. Each emoji is replaced by "□"
 *   (U+25A1) in PNG output; the SVG output keeps the emoji.
 */
const EMOJI = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:\p{Emoji_Modifier}|️|‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?))*/gu;

const unescape = (s: string): string => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
const attribute = (attrs: string, name: string): string | undefined => (new RegExp(String.raw`\s${name}="([^"]*)"`, 'u').exec(attrs))?.[1];

/** Splits own-engine text lines that mix glyphs Inter has and lacks into separate text elements. */
export function splitFallbackRuns(svg: string, metrics: FontMetrics): string {
  return svg.replaceAll(/<text([^>]*)>([\s\S]*?)<\/text>/gu, (whole, attrs: string, content: string) => {
    const style = { size: Number(attribute(attrs, 'font-size') ?? theme.font.size.body), bold: attribute(attrs, 'font-weight') === String(theme.font.weight.bold), italic: attribute(attrs, 'font-style') === 'italic' };
    const lines = content.includes('<tspan')
      ? [...content.matchAll(/<tspan x="([^"]*)" y="([^"]*)">([^<]*)<\/tspan>/gu)].map(m => ({ x: Number(m[1]), y: m[2]!, text: unescape(m[3]!) }))
      : [{ x: Number(attribute(attrs, 'x')), y: attribute(attrs, 'y') ?? '0', text: unescape(content) }];
    const runs = lines.map(line => metrics.runs(line.text, style));
    if (runs.every(r => r.length < 2) || lines.some(l => Number.isNaN(l.x))) return whole;
    const base = attrs.replaceAll(/\s(?:x|y)="[^"]*"/gu, '');
    return lines.map((line, i) => {
      let x = line.x;
      return runs[i]!.map(run => {
        const element = `<text${base} x="${num(x)}" y="${line.y}">${escapeText(run.text)}</text>`;
        x += metrics.measure(run.text, style);
        return element;
      }).join('');
    }).join('');
  });
}

export async function rasterize(svg: string, scale = 2): Promise<Buffer> {
  svg = svg.replaceAll(EMOJI, '□');
  if (svg.includes('data-uml-renderer="engine"')) svg = splitFallbackRuns(svg, await loadFonts());
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: scale },
      background: theme.color.background,
      font: { fontFiles: [...fontFiles], loadSystemFonts: true, defaultFontFamily: theme.font.family, sansSerifFamily: theme.font.family },
    });
    return Buffer.from(resvg.render().asPng());
  } catch {
    throw new UmlError('RASTERIZE_FAILED', 'Could not convert the SVG to PNG', 3);
  }
}
