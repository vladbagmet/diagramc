import { fontFaceCss, type FontStyleKey } from '../engine/fonts.js';

/** Decodes the XML entities PlantUML writes in text content. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

/**
 * Embeds a subset of the pinned Inter font into a PlantUML SVG, covering exactly
 * the characters it draws, so viewers show the font PlantUML measured with (the
 * setup script installs Inter into the pinned Java runtime). Only a fixed
 * <style> element with data: URLs is added; nothing from the input is interpreted.
 */
export async function embedFonts(svg: string): Promise<string> {
  const usage = new Map<FontStyleKey, string>();
  for (const [, attributes, content] of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/gu)) {
    const bold = /font-weight="(?:bold|[6-9]00)"/u.test(attributes!);
    const italic = /font-style="italic"/u.test(attributes!);
    const key: FontStyleKey = bold ? (italic ? 'bold-italic' : 'bold') : (italic ? 'italic' : 'regular');
    usage.set(key, (usage.get(key) ?? '') + decodeEntities(content!));
  }
  if (!usage.size) return svg;
  const css = await fontFaceCss(usage);
  return svg.replace(/<svg\b[^>]*>/u, root => `${root}<style>${css}</style>`);
}
