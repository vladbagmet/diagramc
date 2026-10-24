import { theme } from '../core/theme.js';
import { fontFaceCss, styleKey, type FontMetrics, type FontStyleKey, type TextStyle } from './fonts.js';
import { round2, type Point } from './geometry.js';

/**
 * A small, escaping-safe SVG writer. Only presentation elements and a fixed set of
 * attributes can be written: no scripts, links, foreignObject, images, external
 * references or event handlers, whatever the input text is. Display text only
 * ever reaches the output through `escapeText`/`escapeAttribute`.
 */

const TAGS = new Set(['svg', 'g', 'rect', 'path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'text', 'tspan', 'title', 'style']);
const ATTRIBUTES = new Set([
  'xmlns',
  'xml:space',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linejoin',
  'stroke-linecap',
  'fill-rule',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'paint-order',
  'role',
  'aria-label',
  'opacity',
]);

export type Attributes = Record<string, string | number | undefined>;

export function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
export function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Formats a coordinate: two decimals at most, no trailing zeros, never "-0". */
export function num(n: number): string {
  if (!Number.isFinite(n)) throw new TypeError(`Non-finite coordinate ${n}`);
  return String(round2(n));
}
export function pointsAttr(points: readonly Point[]): string {
  return points.map(p => `${num(p.x)},${num(p.y)}`).join(' ');
}

function attributes(attrs: Attributes): string {
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (!ATTRIBUTES.has(name) && !/^data-uml-[a-z]+(?:-[a-z]+)*$/u.test(name)) throw new Error(`SVG attribute not allowed: ${name}`);
    out += ` ${name}="${escapeAttribute(typeof value === 'number' ? num(value) : value)}"`;
  }
  return out;
}

/** One element. `children` must come from `el`/`Canvas.text` (already safe markup). */
export function el(tag: string, attrs: Attributes = {}, children: readonly string[] = []): string {
  if (!TAGS.has(tag)) throw new Error(`SVG element not allowed: ${tag}`);
  return children.length > 0 ? `<${tag}${attributes(attrs)}>${children.join('')}</${tag}>` : `<${tag}${attributes(attrs)}/>`;
}

export interface TextOptions extends TextStyle {
  /** Text color; the theme's text color when absent or undefined. */
  fill?: string | undefined;
  /** QA role, e.g. "text" (inside a node), "label" (edge label), "frame-label". */
  role: string;
  /** ID of the element or relationship this text belongs to. */
  owner?: string;
  /** Extra data-uml-* attributes. */
  data?: Attributes;
  /** Paint a background-colored halo behind the glyphs (edge labels). */
  halo?: boolean;
}

/**
 * Collects drawing layers and the characters drawn per font style, then writes the
 * final document with the embedded font subset.
 */
export class Canvas {
  readonly frame: string[] = [];
  readonly edges: string[] = [];
  readonly nodes: string[] = [];
  readonly labels: string[] = [];
  private readonly usage = new Map<FontStyleKey, string>();

  constructor(readonly metrics: FontMetrics) {}

  /** Single-line text with its baseline at `y` and left edge at `x` (start-anchored). */
  text(content: string, x: number, y: number, options: TextOptions): string {
    const key = styleKey(options);
    this.usage.set(key, (this.usage.get(key) ?? '') + content);
    return `<text${attributes({
      x,
      y,
      'font-size': options.size,
      'font-weight': options.bold ? theme.font.weight.bold : undefined,
      'font-style': options.italic ? 'italic' : undefined,
      fill: options.fill ?? theme.color.text,
      stroke: options.halo ? theme.color.labelHalo : undefined,
      'stroke-width': options.halo ? 3 : undefined,
      'stroke-linejoin': options.halo ? 'round' : undefined,
      'paint-order': options.halo ? 'stroke' : undefined,
      'data-uml-role': options.role,
      'data-uml-owner': options.owner,
      ...options.data,
    })}>${escapeText(content)}</text>`;
  }

  /**
   * Multi-line text as one <text> element with one <tspan> per line, so the
   * element's text content equals the original string. `x` is per line (for centering).
   */
  lines(lines: readonly string[], xs: readonly number[], firstBaseline: number, lineHeight: number, options: TextOptions): string {
    if (lines.length === 1) return this.text(lines[0]!, xs[0]!, firstBaseline, options);
    const key = styleKey(options);
    this.usage.set(key, (this.usage.get(key) ?? '') + lines.join(''));
    const spans = lines.map((line, i) => `<tspan${attributes({ x: xs[i]!, y: firstBaseline + i * lineHeight })}>${escapeText(line)}</tspan>`);
    return `<text${attributes({
      'font-size': options.size,
      'font-weight': options.bold ? theme.font.weight.bold : undefined,
      'font-style': options.italic ? 'italic' : undefined,
      fill: options.fill ?? theme.color.text,
      stroke: options.halo ? theme.color.labelHalo : undefined,
      'stroke-width': options.halo ? 3 : undefined,
      'stroke-linejoin': options.halo ? 'round' : undefined,
      'paint-order': options.halo ? 'stroke' : undefined,
      'data-uml-role': options.role,
      'data-uml-owner': options.owner,
      ...options.data,
    })}>${spans.join('')}</text>`;
  }

  async finish(options: { width: number; height: number; kind: string; title?: string | undefined }): Promise<string> {
    const width = Math.ceil(options.width),
      height = Math.ceil(options.height);
    const css = `${await fontFaceCss(this.usage)}text{white-space:pre}`;
    const label = options.title === undefined ? `${options.kind} diagram` : `${options.kind} diagram ${options.title}`;
    return (
      `<svg${attributes({
        xmlns: 'http://www.w3.org/2000/svg',
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        'xml:space': 'preserve',
        'font-family': theme.font.fallback,
        role: 'img',
        'aria-label': label,
        'data-uml-kind': options.kind,
        'data-uml-renderer': 'engine',
      })}>${el('title', {}, [escapeText(label)])}<style>${css}</style>` +
      el('rect', { width, height, fill: theme.color.background, 'data-uml-role': 'background' }) +
      this.frame.join('') +
      this.edges.join('') +
      this.nodes.join('') +
      this.labels.join('') +
      '</svg>\n'
    );
  }
}
