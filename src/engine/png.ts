import { UmlError } from '../core/errors.js';
import { theme } from '../core/theme.js';
import { fontFiles } from './fonts.js';

/**
 * Rasterizes an SVG with resvg (no browser). The pinned Inter files are loaded
 * explicitly; system fonts are only consulted for glyphs Inter lacks (CJK).
 *
 * Known limitation: resvg-js 2.6.2 draws every glyph of a text element as a box
 * once it contains a colour emoji. PNG output therefore shows each emoji as "□"
 * (U+25A1); the SVG output keeps the emoji.
 */
const EMOJI = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F?))*/gu;

export async function rasterize(svg: string, scale = 2): Promise<Buffer> {
  svg = svg.replace(EMOJI, '\u25A1');
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
