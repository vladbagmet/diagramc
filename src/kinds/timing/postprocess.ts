import { theme } from '../../core/theme.js';
import { fillFrameHeading } from '../../plantuml/frame.js';
import { padCanvas } from '../../plantuml/geometry.js';
import type { TimingDiagram } from './model.js';
import { fixTimingRows } from './rows.js';
import { overlapArea, segmentIntersectsRect, type Point } from '../../engine/geometry.js';

const NUM = String.raw`(-?[\d.]+)`;
const round = (n: number): string => String(Math.round(n * 10_000) / 10_000);

/** Vertical shift of duration-constraint arrows, away from the state line they would otherwise hug. */
export const CONSTRAINT_LIFT = 6;

/**
 * PlantUML draws a duration constraint 5px above the robust state line it
 * measures, which reads as a doubled line. The arrow (line and both heads) and
 * its {min..max} label are lifted by CONSTRAINT_LIFT px. Only y coordinates change.
 */
export function liftConstraints(svg: string): string {
  const edge = theme.color.edge;
  const pattern = new RegExp(
    String.raw`<line style="stroke:${edge};stroke-width:[\d.]+;" x1="${NUM}" x2="${NUM}" y1="${NUM}" y2="\3"/>(<polygon fill="${edge}" points="[^"]*" style="[^"]*"/>)(<polygon fill="${edge}" points="[^"]*" style="[^"]*"/>)(<text [^>]* y=")${NUM}(">[^<]*</text>)`,
    'gu',
  );
  return svg.replace(pattern, (match, x1: string, x2: string, y: string, p1: string, p2: string, textOpen: string, ty: string, textClose: string) => {
    const shift = (polygon: string): string =>
      polygon.replace(
        /points="([^"]*)"/u,
        (_, pts: string) =>
          `points="${pts
            .split(',')
            .map((v, i) => (i % 2 ? round(Number(v) - CONSTRAINT_LIFT) : v))
            .join(',')}"`,
      );
    // Both heads must sit on this line's ends (a double-headed arrow), otherwise leave it alone.
    const tips = [p1, p2].map(p => /points="([^"]*)"/u.exec(p)![1]!.split(',').map(Number));
    const ys = tips.flatMap(t => t.filter((_, i) => i % 2));
    if (
      ys.some(v => Math.abs(v - Number(y)) > 6) ||
      tips.some(t => t.every((v, i) => !(i % 2 === 0 && (Math.abs(v - Number(x1)) < 0.01 || Math.abs(v - Number(x2)) < 0.01))))
    )
      return match;
    const line = match
      .slice(0, match.indexOf('/>') + 2)
      .replace(/ y1="[^"]*" y2="[^"]*"/u, () => ` y1="${round(Number(y) - CONSTRAINT_LIFT)}" y2="${round(Number(y) - CONSTRAINT_LIFT)}"`);
    return `${line}${shift(p1)}${shift(p2)}${textOpen}${round(Number(ty) - CONSTRAINT_LIFT)}${textClose}`;
  });
}

/**
 * PlantUML sizes the mainframe without the footer that carries the time unit, so
 * the frame's bottom edge runs through it. The frame (and, if needed, the SVG
 * canvas) is extended to enclose the footer with the theme's frame padding.
 */
export function encloseFooter(svg: string): string {
  const footer = new RegExp(`<g class="footer"[^>]*><text [^>]*font-size="${NUM}"[^>]* y="${NUM}"`, 'u').exec(svg);
  const frame = new RegExp(`<g><rect fill="#FFFFFF" height="${NUM}" style="[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'u').exec(svg);
  if (!footer || !frame) return svg;
  const size = Number(footer[1]),
    baseline = Number(footer[2]);
  const top = Number(frame[4]),
    height = Number(frame[1]);
  const needed = baseline + size * 0.35 + theme.spacing.frame / 2 - top;
  if (needed <= height) return svg;
  const grow = needed - height;
  let out = svg.replace(frame[0], () => frame[0].replace(`height="${frame[1]}"`, () => `height="${round(needed)}"`));
  out = out.replace(/<svg\s[^>]*>/u, root =>
    root
      .replace(/ height="([\d.]+)px"/u, (_, h: string) => ` height="${Math.ceil(Number(h) + grow)}px"`)
      .replace(/height:([\d.]+)px;/u, (_, h: string) => `height:${Math.ceil(Number(h) + grow)}px;`)
      .replace(/ viewBox="0 0 ([\d.]+) ([\d.]+)"/u, (_, w: string, h: string) => ` viewBox="0 0 ${w} ${Math.ceil(Number(h) + grow)}"`),
  );
  return out;
}

/** Offsets tried, in order, for a message that would run along another vertical line. */
export const MESSAGE_NUDGES = [8, -8, 12, -12, 16, -16, 24, -24];

interface Seg {
  a: Point;
  b: Point;
}
const pairs = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);

/** State lines a message may start or end on: robust lines and the edges of concise value bands. */
function waveSegments(svg: string): Seg[] {
  const robust = theme.stroke.node + 0.25;
  const out: Seg[] = [];
  for (const m of svg.matchAll(/<line style="stroke:[^;]*;stroke-width:([\d.]+);" x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu)) {
    if (Number(m[1]) === robust) out.push({ a: { x: Number(m[2]), y: Number(m[4]) }, b: { x: Number(m[3]), y: Number(m[5]) } });
  }
  for (const [shape] of svg.matchAll(/<(?:polygon|path)\b[^>]*>/gu)) {
    if (!shape.includes(`fill="${theme.color.nodeHeaderFill}"`)) continue;
    const n = pairs(/ (?:points|d)="([^"]*)"/u.exec(shape)?.[1] ?? '');
    const pts: Point[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i]!, y: n[i + 1]! });
    for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1]!, b: pts[i]! });
  }
  return out;
}

/**
 * A message between two lifelines at one instant is a vertical line at that
 * time, where PlantUML also draws the state changes of the lifelines it passes,
 * highlight borders and constraint extension lines: the lines merge and the
 * arrow can no longer be told apart. Such a message is moved sideways by the
 * first of MESSAGE_NUDGES that keeps it off every other vertical line, with both
 * ends moved onto the state lines at the new x. Messages that run along nothing
 * keep their place.
 */
export function nudgeMessages(svg: string): string {
  const edge = theme.color.edge;
  const pattern = new RegExp(
    String.raw`<line style="stroke:${edge};stroke-width:([\d.]+);" x1="${NUM}" x2="\2" y1="${NUM}" y2="${NUM}"/><polygon fill="${edge}" points="([^"]*)" style="([^"]*)"/>(?=<text)`,
    'gu',
  );
  const waves = waveSegments(svg);
  // Every vertical line: state steps, highlight and extension lines (not the time grid), messages.
  const verticals: { x: number; y0: number; y1: number }[] = [];
  for (const m of svg.matchAll(/<line style="([^"]*)" x1="(-?[\d.]+)" x2="\2" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu)) {
    if (m[1]!.includes('dasharray:3,5')) continue;
    verticals.push({ x: Number(m[2]), y0: Math.min(Number(m[3]), Number(m[4])), y1: Math.max(Number(m[3]), Number(m[4])) });
  }
  for (const w of waves) if (Math.abs(w.a.x - w.b.x) < 0.01) verticals.push({ x: w.a.x, y0: Math.min(w.a.y, w.b.y), y1: Math.max(w.a.y, w.b.y) });
  const clash = (x: number, y0: number, y1: number, self: { x: number; y0: number; y1: number } | undefined): boolean =>
    verticals.some(v => v !== self && Math.abs(v.x - x) < 3 && Math.min(v.y1, y1) - Math.max(v.y0, y0) > 2);
  /**
   * The state line under x nearest to y (within 40 px) on the side `toward`
   * points to (a value band's edge that faces the other end), or undefined.
   */
  const landing = (x: number, y: number, toward: number): number | undefined => {
    let best: number | undefined;
    for (const w of waves) {
      const lo = Math.min(w.a.x, w.b.x),
        hi = Math.max(w.a.x, w.b.x);
      if (hi - lo < 0.01 || x < lo + 0.5 || x > hi - 0.5) continue;
      const wy = w.a.y + ((w.b.y - w.a.y) * (x - w.a.x)) / (w.b.x - w.a.x);
      if ((wy - y) * toward < -1) continue;
      if (Math.abs(wy - y) <= 40 && (best === undefined || Math.abs(wy - y) < Math.abs(best - y))) best = wy;
    }
    return best;
  };
  return svg.replace(pattern, (match, width: string, x: string, y1: string, y2: string, points: string, style: string) => {
    const x0 = Number(x),
      a = Number(y1),
      b = Number(y2);
    const self = verticals.find(v => v.x === x0 && v.y0 === Math.min(a, b) && v.y1 === Math.max(a, b));
    if (!clash(x0, Math.min(a, b), Math.max(a, b), self)) return match;
    const n = pairs(points);
    // The tip is the head's point nearest the line's end y2.
    const tipIndex = [0, 1, 2].sort((i, j) => Math.abs(n[2 * i + 1]! - b) - Math.abs(n[2 * j + 1]! - b))[0]!;
    const tipY = n[2 * tipIndex + 1]!;
    for (const d of MESSAGE_NUDGES) {
      const nx = x0 + d;
      const dir = Math.sign(tipY - a);
      // A robust lifeline that changes at this instant is met at its new level.
      const na = landing(nx, a, dir),
        nt = landing(nx, tipY, -dir) ?? landing(nx, tipY, dir);
      if (na === undefined || nt === undefined || Math.sign(nt - na) !== Math.sign(tipY - a)) continue;
      const nb = b + (nt - tipY);
      if (clash(nx, Math.min(na, nb), Math.max(na, nb), self)) continue;
      if (self) {
        self.x = nx;
        self.y0 = Math.min(na, nb);
        self.y1 = Math.max(na, nb);
      }
      const head = [0, 1, 2].map(i => `${round(n[2 * i]! + d)},${round(n[2 * i + 1]! + nt - tipY)}`).join(',');
      return `<line style="stroke:${edge};stroke-width:${width};" x1="${round(nx)}" x2="${round(nx)}" y1="${round(na)}" y2="${round(nb)}"/><polygon fill="${edge}" points="${head}" style="${style}"/>`;
    }
    return match;
  });
}

/**
 * Highlight borders and constraint extension lines are drawn over notes and
 * value texts. They are cut where they would run through a text or a note body
 * (2 px clear), as a dashed guide behind them.
 */
export function cutGuides(svg: string): string {
  const boxes: Box[] = [...svg.matchAll(/<text [^>]*>/gu)].map(m => textBox(m[0]));
  for (const [shape] of svg.matchAll(/<path\b[^>]*>/gu)) {
    if (!shape.includes(`fill="${theme.color.noteFill}"`)) continue;
    const n = pairs(/ d="([^"]*)"/u.exec(shape)?.[1] ?? '');
    const xs = n.filter((_, i) => i % 2 === 0),
      ys = n.filter((_, i) => i % 2 === 1);
    boxes.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
  }
  return svg.replaceAll(
    /<line style="([^"]*dasharray:(?:4,4|2,2);[^"]*)" x1="(-?[\d.]+)" x2="\2" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu,
    (tag, style: string, gx: string, y1: string, y2: string) => {
      const x = Number(gx),
        top = Math.min(Number(y1), Number(y2)),
        bottom = Math.max(Number(y1), Number(y2));
      const cuts = boxes
        .filter(b => x > b.x - 2 && x < b.x + b.width + 2 && b.y - 2 < bottom && b.y + b.height + 2 > top)
        .map(b => [b.y - 2, b.y + b.height + 2] as const)
        .sort((p, q) => p[0] - q[0]);
      if (cuts.length === 0) return tag;
      const parts: string[] = [];
      let from = top;
      for (const [c0, c1] of cuts) {
        if (c0 - from > 1) parts.push(`<line style="${style}" x1="${gx}" x2="${gx}" y1="${round(from)}" y2="${round(c0)}"/>`);
        from = Math.max(from, c1);
      }
      if (bottom - from > 1) parts.push(`<line style="${style}" x1="${gx}" x2="${gx}" y1="${round(from)}" y2="${round(bottom)}"/>`);
      return parts.join('');
    },
  );
}

/** Gap between a message line and its label. */
export const MESSAGE_LABEL_GAP = 4;
/** Least distance between two message labels. */
export const LABEL_SPACING = 8;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const attr = (tag: string, name: string): number => Number(new RegExp(String.raw`\s${name}="(-?[\d.]+)"`, 'u').exec(tag)?.[1] ?? NaN);
const textBox = (tag: string): Box => {
  const size = attr(tag, 'font-size');
  return { x: attr(tag, 'x'), y: attr(tag, 'y') - size * 0.95, width: attr(tag, 'textLength'), height: size * 1.2 };
};

/**
 * PlantUML writes a timing message's label at the arrow's tip, where it covers
 * the receiving lifeline (a concise value band or a grid line). Each label is
 * moved next to its arrow instead: candidate positions along the arrow, right
 * then left of it and on the side the line does not run to, are tried in a fixed order and
 * the first one that crosses no solid line, text, value band or note is taken
 * (the middle of the arrow when none is free). Deterministic; only x/y change.
 */
export function placeMessageLabels(svg: string): string {
  const edge = theme.color.edge;
  const pattern = new RegExp(
    String.raw`(<line style="stroke:${edge};stroke-width:[\d.]+;" x1="${NUM}" x2="${NUM}" y1="${NUM}" y2="${NUM}"/><polygon fill="${edge}" points="${NUM},${NUM},${NUM},${NUM},${NUM},${NUM}" style="[^"]*"/>)((?:<text [^>]*>[^<]*</text>)+)`,
    'gu',
  );
  const messages = [...svg.matchAll(pattern)];
  if (messages.length === 0) return svg;
  const labelTags = new Set(messages.flatMap(m => [...m[12]!.matchAll(/<text [^>]*>/gu)].map(t => t.index + m.index + m[1]!.length)));
  // Obstacles: solid lines, other texts, concise value shapes and notes.
  const segments: { a: Point; b: Point }[] = [];
  for (const m of svg.matchAll(/<line style="([^"]*)" x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu)) {
    // Time grid lines (3,5 dashes) may run under labels; highlight borders (4,4) may not.
    if (m[1]!.includes('dasharray') && !m[1]!.includes('dasharray:4,4')) continue;
    segments.push({ a: { x: Number(m[2]), y: Number(m[4]) }, b: { x: Number(m[3]), y: Number(m[5]) } });
  }
  const boxes: Box[] = [];
  for (const m of svg.matchAll(/<text [^>]*>/gu)) if (!labelTags.has(m.index)) boxes.push(textBox(m[0]));
  for (const [shape] of svg.matchAll(/<(?:polygon|path)\b[^>]*>/gu)) {
    const fill = / fill="(#[0-9A-F]{6})"/u.exec(shape)?.[1];
    if (fill !== theme.color.nodeHeaderFill && fill !== theme.color.noteFill) continue;
    const n = (/ (?:points|d)="([^"]*)"/u.exec(shape)?.[1]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0),
      ys = n.filter((_, i) => i % 2 === 1);
    boxes.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
  }
  const right = Math.max(...segments.map(s => Math.max(s.a.x, s.b.x)));
  const left = Math.min(...segments.map(s => Math.min(s.a.x, s.b.x)));
  // Lifeline bands: between the full-width separators (the last one is the time axis).
  const width = right - left;
  const cuts = [...new Set(segments.filter(s => s.a.y === s.b.y && Math.abs(s.b.x - s.a.x) > width / 2).map(s => s.a.y))].sort((p, q) => p - q);
  const band = (y: number): [number, number] | undefined => {
    const k = cuts.findIndex((c, i) => i + 1 < cuts.length && y >= c - 0.5 && y <= cuts[i + 1]! + 0.5);
    return k === -1 ? undefined : [cuts[k]!, cuts[k + 1]!];
  };

  let index = 0;
  return svg.replace(pattern, (match, open: string, ...rest: string[]) => {
    const own = messages[index++]!;
    const [x1, x2, y1, y2] = rest.slice(0, 4).map(Number) as [number, number, number, number];
    const texts = rest[10]!;
    const tags = [...texts.matchAll(/<text [^>]*>/gu)].map(t => t[0]);
    if (tags.length === 0 || own[0] !== match) return match;
    const first = textBox(tags[0]!);
    const size = attr(tags[0]!, 'font-size');
    const pitch = tags.length > 1 ? attr(tags[1]!, 'y') - attr(tags[0]!, 'y') : size * 1.2;
    const width_ = Math.max(...tags.map(t => attr(t, 'textLength')));
    const height = (tags.length - 1) * pitch + size * 1.2;
    const leftEnd = x1 <= x2 ? { x: x1, y: y1 } : { x: x2, y: y2 };
    const rightEnd = x1 <= x2 ? { x: x2, y: y2 } : { x: x1, y: y1 };
    // Screen y grows downwards: a rising arrow has its line above-right of any point on it.
    const below = rightEnd.y < leftEnd.y;
    const own_ = { a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
    const free = (b: Box): boolean =>
      b.x + b.width <= right &&
      b.x >= left &&
      segments.every(s => (s.a.x === own_.a.x && s.a.y === own_.a.y && s.b.x === own_.b.x && s.b.y === own_.b.y) || !segmentIntersectsRect(s.a, s.b, b)) &&
      !segmentIntersectsRect(own_.a, own_.b, b) &&
      boxes.every(o => !(overlapArea(o, b) > 0));
    // Right of the point, the line runs up for a rising arrow: the label goes below; left of it, above (and vice versa).
    const at = (t: number, side: 'right' | 'left'): Box => {
      const p = { x: leftEnd.x + (rightEnd.x - leftEnd.x) * t, y: leftEnd.y + (rightEnd.y - leftEnd.y) * t };
      const down = side === 'right' ? below : !below;
      return {
        x: side === 'right' ? p.x + MESSAGE_LABEL_GAP : p.x - MESSAGE_LABEL_GAP - width_,
        y: down ? p.y + MESSAGE_LABEL_GAP : p.y - MESSAGE_LABEL_GAP - height,
        width: width_,
        height,
      };
    };
    // A label belongs to the band of its sender or its receiver, not to a band the
    // arrow only passes: positions along the arrow inside the sender's band first,
    // then inside the receiver's, from the middle of that stretch outwards.
    const start = { x: x1, y: y1 },
      end = { x: x2, y: y2 };
    const along = (t: number): Point => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    const toLeft = (t: number): number => (along(t).x - leftEnd.x) / (rightEnd.x - leftEnd.x || 1);
    const stretch = (b: [number, number] | undefined): number[] => {
      if (!b) return [];
      const inside = Array.from({ length: 41 }, (_, i) => i / 40).filter(t => {
        const y = along(t).y;
        return y > b[0] + 2 && y < b[1] - 2;
      });
      if (inside.length === 0) return [];
      const mid = (inside[0]! + inside.at(-1)!) / 2;
      return inside.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
    };
    const sameBand = (p: Point, q: Point): boolean => {
      const a = band(p.y),
        b = band(q.y);
      return !!a && !!b && a[0] === b[0];
    };
    const across = !sameBand(start, end) && cuts.length > 1;
    const ts = across ? [...stretch(band(start.y)), ...stretch(band(end.y))] : [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1];
    const ends = [band(start.y), band(end.y)];
    // A vertical arrow (one instant) may carry its label anywhere beside it within those bands.
    const beside = (r: [number, number] | undefined, from: number): Box[] => {
      if (!r || Math.abs(x2 - x1) > 0.01) return [];
      const ys: number[] = [];
      for (let y = r[0] + 3; y + height <= r[1] - 3; y += 3) ys.push(y);
      ys.sort((p, q) => Math.abs(p + height / 2 - from) - Math.abs(q + height / 2 - from) || p - q);
      return ys.flatMap(y => [
        { x: x1 + MESSAGE_LABEL_GAP, y, width: width_, height },
        { x: x1 - MESSAGE_LABEL_GAP - width_, y, width: width_, height },
      ]);
    };
    const candidates = [
      ...ts.flatMap(t => [at(toLeft(t), 'right'), at(toLeft(t), 'left')]),
      ...(across ? [...beside(ends[0], y1), ...beside(ends[1], y2)] : []),
    ].filter(b => !across || ends.some(r => r && b.y >= r[0] && b.y + b.height <= r[1]));
    const chosen = candidates.find(free) ?? candidates[0] ?? at(0.5, 'right');
    // Labels keep LABEL_SPACING px apart, so two never read as one block.
    boxes.push({
      x: chosen.x - LABEL_SPACING,
      y: chosen.y - LABEL_SPACING,
      width: chosen.width + 2 * LABEL_SPACING,
      height: chosen.height + 2 * LABEL_SPACING,
    });
    const dx = chosen.x - first.x,
      dy = chosen.y - first.y;
    const moved = texts.replaceAll(
      /(<text [^>]* x=")(-?[\d.]+)(" y=")(-?[\d.]+)(")/gu,
      (_m, a: string, x: string, b: string, y: string, c: string) => `${a}${round(Number(x) + dx)}${b}${round(Number(y) + dy)}${c}`,
    );
    return `${open}${moved}`;
  });
}

/** All fix-ups applied to PlantUML's timing SVG. */
export function postProcessTiming(svg: string, model?: TimingDiagram): string {
  const framed = fillFrameHeading(svg);
  // With the model, constraints are redrawn in their own bands (rows.ts); without it, only lifted.
  const fixed = encloseFooter(cutGuides(placeMessageLabels(nudgeMessages(model ? fixTimingRows(framed, model) : liftConstraints(framed)))));
  return model && model.title === undefined ? padCanvas(fixed, theme.spacing.canvas) : fixed;
}
