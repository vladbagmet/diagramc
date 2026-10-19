import { theme } from '../../core/theme.js';
import { inflate, overlapArea, segmentIntersectsRect, type Point, type Rect } from '../../engine/geometry.js';
import { CALL_BEHAVIOR_MARK } from '../../plantuml/skin.js';

/**
 * Fixes PlantUML's activity SVG where it deviates from UML 2.5.1 notation. Only
 * PlantUML's own drawing primitives are rewritten; no input text is touched.
 *
 * - Activity edges end in an open arrowhead (UML 15.2.4); PlantUML draws filled,
 *   notched heads. They become open arrowheads of the shared theme size.
 * - PlantUML adds direction arrowheads in the middle of long return lines;
 *   UML draws one arrowhead at the target only, so these are removed.
 * - Call behavior actions get the rake symbol in their lower right corner
 *   (UML 16.3.4). They are found by the marker stroke color the skin gives them.
 * - A guard label that PlantUML placed across a flow line (it happens beside
 *   narrow loops) is moved to the nearest free spot beside the same line; if
 *   there is none (a loop in a narrow swimlane), a column is opened for it.
 */
export function fixActivitySvg(svg: string): string {
  const ends: [number, number][] = [];
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/gu)) {
    const a = attrs(tag);
    ends.push([Number(a.x1), Number(a.y1)], [Number(a.x2), Number(a.y2)]);
  }
  const { edge } = theme.color;
  const { length, halfWidth } = theme.size.arrow;
  svg = svg.replace(/<polygon\b[^>]*>/gu, tag => {
    const a = attrs(tag);
    if (a.fill?.toUpperCase() !== edge.toUpperCase()) return tag;
    const n = (a.points ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
    if (n.length !== 8 || n.some(v => !Number.isFinite(v))) return tag;
    const tip = { x: n[2]!, y: n[3]! }, notch = { x: n[6]!, y: n[7]! };
    if (!ends.some(([x, y]) => Math.abs(x - tip.x) < 0.6 && Math.abs(y - tip.y) < 0.6)) return '';
    const d = Math.hypot(tip.x - notch.x, tip.y - notch.y) || 1;
    const u = { x: (tip.x - notch.x) / d, y: (tip.y - notch.y) / d };
    const at = (side: number) => `${fmt(tip.x - u.x * length - u.y * halfWidth * side)},${fmt(tip.y - u.y * length + u.x * halfWidth * side)}`;
    return `<polyline fill="none" points="${at(1)} ${fmt(tip.x)},${fmt(tip.y)} ${at(-1)}" style="stroke:${edge};stroke-width:${theme.stroke.edge};stroke-linejoin:miter;stroke-linecap:round;"/>`;
  });
  svg = svg.replace(/<rect\b[^>]*>/gu, tag => {
    if (!tag.includes(`stroke:${CALL_BEHAVIOR_MARK};`)) return tag;
    const a = attrs(tag);
    const x = Number(a.x), y = Number(a.y), w = Number(a.width), h = Number(a.height);
    const fixed = tag.replace(`stroke:${CALL_BEHAVIOR_MARK};`, `stroke:${theme.color.nodeStroke};`);
    const r = theme.size.rake, right = x + w - 10, bottom = y + h - 8;
    const cx = right - r.width / 2, left = right - r.width, top = bottom - r.height, bar = top + r.height / 2;
    const d = `M${fmt(cx)},${fmt(top)} V${fmt(bottom)} M${fmt(left)},${fmt(bottom)} V${fmt(bar)} H${fmt(right)} V${fmt(bottom)}`;
    return `${fixed}<path d="${d}" fill="none" style="stroke:${theme.color.nodeStroke};stroke-width:${theme.stroke.node};"/>`;
  });
  return moveCrossedLabels(svg, 0);
}

// Inter's ascent and descent per px of font size (assets/fonts, hhea table).
const ASCENT = 0.97, DESCENT = 0.25;

interface Segment { p: Point; q: Point; flow: boolean }

function moveCrossedLabels(svg: string, depth: number): string {
  const segments: Segment[] = [];
  const obstacles: Rect[] = [];
  const bars = new Set<Rect>();
  const pairs = (s: string | undefined): number[] => (s ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
  for (const [element] of svg.matchAll(/<(?:line|rect|polygon|polyline|ellipse|path)\b[^>]*>/gu)) {
    const a = attrs(element);
    if (element.startsWith('<line')) {
      // Flow lines and swimlane borders.
      const flow = element.includes(`stroke:${theme.color.edge};`);
      if (flow || element.includes(`stroke:${theme.color.frameStroke};`)) segments.push({ p: { x: Number(a.x1), y: Number(a.y1) }, q: { x: Number(a.x2), y: Number(a.y2) }, flow });
    } else if (element.startsWith('<rect') && (a.fill === theme.color.nodeFill || a.fill === theme.color.edge)) {
      const r = { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
      obstacles.push(r);
      // Fork and join bars may be stretched by a new column.
      if (a.fill === theme.color.edge) bars.add(r);
    } else if (element.startsWith('<polyline') || (element.startsWith('<polygon') && a.fill === theme.color.nodeFill)) {
      obstacles.push(bounds(pairs(a.points)));
    } else if (element.startsWith('<ellipse')) {
      obstacles.push({ x: Number(a.cx) - Number(a.rx), y: Number(a.cy) - Number(a.ry), width: 2 * Number(a.rx), height: 2 * Number(a.ry) });
    } else if (element.startsWith('<path') && a.fill === theme.color.noteFill) {
      obstacles.push(bounds(pathCoordinates(a.d ?? '').flat()));
    }
  }
  const box = (a: Record<string, string>): Rect => {
    const size = Number(a['font-size']);
    return { x: Number(a.x), y: Number(a.y) - size * ASCENT, width: Number(a.textLength), height: size * (ASCENT + DESCENT) };
  };
  const texts = [...svg.matchAll(/<text\b[^>]*>/gu)].map(m => ({ tag: m[0], rect: box(attrs(m[0])) }));
  const crossing = (r: Rect, only?: (s: Segment) => boolean): Segment | undefined => segments.find(s => (!only || only(s)) && segmentIntersectsRect(s.p, s.q, inflate(r, 1)));
  const view = svg.match(/ viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u)?.slice(1).map(Number) ?? [0, 0, Infinity, Infinity];
  const inView = (r: Rect): boolean => r.x >= view[0]! + 2 && r.y >= view[1]! + 2 && r.x + r.width <= view[0]! + view[2]! - 2 && r.y + r.height <= view[1]! + view[3]! - 2;
  const free = (r: Rect, self: Rect): boolean => inView(r) && !crossing(r) && !obstacles.some(o => overlapArea(inflate(r, 2), o) > 0)
    && !texts.some(t => t.rect !== self && overlapArea(inflate(r, 2), t.rect) > 0);
  const moved = new Map<string, string>();
  const place = (tag: string, from: Rect, to: Rect): string => {
    const a = attrs(tag);
    return tag.replace(/ x="[^"]*"/u, ` x="${fmt(Number(a.x) + to.x - from.x)}"`).replace(/ y="[^"]*"/u, ` y="${fmt(Number(a.y) + to.y - from.y)}"`);
  };
  for (const t of texts) {
    if (!t.tag.includes(`fill="${theme.color.edgeText}"`) || !crossing(t.rect, s => s.flow)) continue;
    const candidates: Rect[] = [];
    for (let step = 1; step <= 12; step++) {
      for (const [dx, dy] of [[step * 4, 0], [-step * 4, 0], [0, -step * 3], [0, step * 3]] as const) candidates.push({ ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy });
    }
    const spot = candidates.find(c => free(c, t.rect));
    if (spot) {
      moved.set(t.tag, place(t.tag, t.rect, spot));
      t.rect = spot;
      continue;
    }
    // No room (a narrow loop inside a swimlane): open a column right of the
    // crossing vertical flow line and put the label there, beside that line.
    const line = crossing(t.rect, s => s.flow && s.p.x === s.q.x);
    if (!line || depth > 8) continue;
    const x0 = line.p.x + 0.5;
    const spans = (r: Rect): boolean => r.x < x0 && r.x + r.width > x0;
    // Texts that span the column keep their position; shapes would be torn apart.
    if (obstacles.some(o => spans(o) && !bars.has(o))) continue;
    const width = Math.ceil(t.rect.width + 10);
    const widened = insertColumn(svg, x0, width);
    const target = { ...t.rect, x: line.p.x + 5 };
    return moveCrossedLabels(widened.replace(t.tag, place(t.tag, t.rect, target)), depth + 1);
  }
  return moved.size ? svg.replace(/<text\b[^>]*>/gu, tag => moved.get(tag) ?? tag) : svg;
}

/** Shifts everything right of `x0` by `width` px, stretching what spans `x0` (frame, lines). */
function insertColumn(svg: string, x0: number, width: number): string {
  const shift = (x: number): number => x > x0 ? x + width : x;
  return svg.replace(/<(\w+)\b[^>]*>/gu, (tag, name: string) => {
    if (name === 'svg') {
      return tag.replace(/ width="([\d.]+)px"/u, (_, w: string) => ` width="${fmt(Number(w) + width)}px"`)
        .replace(/width:([\d.]+)px;/u, (_, w: string) => `width:${fmt(Number(w) + width)}px;`)
        .replace(/ viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u, (_, x: string, y: string, w: string, h: string) => ` viewBox="${x} ${y} ${fmt(Number(w) + width)} ${h}"`);
    }
    const a = attrs(tag);
    let out = tag;
    const set = (key: string, value: number): void => { out = out.replace(new RegExp(` ${key}="[^"]*"`, 'u'), ` ${key}="${fmt(value)}"`); };
    if (name === 'rect' || name === 'text') {
      const x = Number(a.x);
      if (name === 'rect' && x < x0 && x + Number(a.width) > x0) set('width', Number(a.width) + width);
      else set('x', shift(x));
    }
    if (name === 'line') { set('x1', shift(Number(a.x1))); set('x2', shift(Number(a.x2))); }
    if (name === 'ellipse') set('cx', shift(Number(a.cx)));
    if ((name === 'polygon' || name === 'polyline') && a.points) {
      const n = a.points.split(/[ ,]+/u).filter(Boolean).map(Number);
      const moved = [];
      for (let i = 0; i + 1 < n.length; i += 2) moved.push(`${fmt(shift(n[i]!))},${fmt(n[i + 1]!)}`);
      out = out.replace(/ points="[^"]*"/u, ` points="${moved.join(name === 'polygon' ? ',' : ' ')}"`);
    }
    if (name === 'path' && a.d) out = out.replace(/ d="[^"]*"/u, ` d="${shiftPath(a.d, shift)}"`);
    return out;
  });
}

/** Absolute M/L/H/V/A path data with every x coordinate passed through `shift`. */
function shiftPath(d: string, shift: (x: number) => number): string {
  return d.replace(/([MLHVA])([^MLHVAZz]*)/gu, (_, command: string, args: string) => {
    const n = args.split(/[ ,]+/u).filter(Boolean).map(Number);
    if (command === 'H') return `H${n.map(x => fmt(shift(x))).join(' ')} `;
    if (command === 'V') return `V${args}`;
    if (command === 'A') {
      const out: string[] = [];
      for (let i = 0; i + 6 < n.length; i += 7) out.push(`${n[i]},${n[i + 1]} ${n[i + 2]} ${n[i + 3]} ${n[i + 4]} ${fmt(shift(n[i + 5]!))},${n[i + 6]}`);
      return `A${out.join(' ')} `;
    }
    const out: string[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) out.push(`${fmt(shift(n[i]!))},${fmt(n[i + 1]!)}`);
    return `${command}${out.join(' ')} `;
  }).trim();
}

/** Coordinate pairs of absolute M/L/A path data (PlantUML's note outlines). */
function pathCoordinates(d: string): [number, number][] {
  const out: [number, number][] = [];
  for (const [, command, args] of d.matchAll(/([MLA])([^MLAZz]*)/gu)) {
    const n = args!.split(/[ ,]+/u).filter(Boolean).map(Number);
    if (command === 'A') { for (let i = 0; i + 6 < n.length; i += 7) out.push([n[i + 5]!, n[i + 6]!]); }
    else for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  }
  return out;
}

function bounds(n: number[]): Rect {
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([\w:-]+)="([^"]*)"/gu)) out[name!] = value!;
  return out;
}
