import { theme } from '../../core/theme.js';
import { fillFrameHeading } from '../../plantuml/frame.js';
import { overlapArea, segmentIntersectsRect, type Point } from '../../engine/geometry.js';

const NUM = '(-?[\\d.]+)';
const round = (n: number): string => String(Math.round(n * 10000) / 10000);

/** Vertical shift of duration-constraint arrows, away from the state line they would otherwise hug. */
export const CONSTRAINT_LIFT = 6;

/**
 * PlantUML draws a duration constraint 5px above the robust state line it
 * measures, which reads as a doubled line. The arrow (line and both heads) and
 * its {min..max} label are lifted by CONSTRAINT_LIFT px. Only y coordinates change.
 */
export function liftConstraints(svg: string): string {
  const edge = theme.color.edge;
  const pattern = new RegExp(`<line style="stroke:${edge};stroke-width:[\\d.]+;" x1="${NUM}" x2="${NUM}" y1="${NUM}" y2="\\3"/>(<polygon fill="${edge}" points="[^"]*" style="[^"]*"/>)(<polygon fill="${edge}" points="[^"]*" style="[^"]*"/>)(<text [^>]* y=")${NUM}(">[^<]*</text>)`, 'gu');
  return svg.replace(pattern, (match, x1: string, x2: string, y: string, p1: string, p2: string, textOpen: string, ty: string, textClose: string) => {
    const shift = (polygon: string): string => polygon.replace(/points="([^"]*)"/u, (_, pts: string) =>
      `points="${pts.split(',').map((v, i) => i % 2 ? round(Number(v) - CONSTRAINT_LIFT) : v).join(',')}"`);
    // Both heads must sit on this line's ends (a double-headed arrow), otherwise leave it alone.
    const tips = [p1, p2].map(p => p.match(/points="([^"]*)"/u)![1]!.split(',').map(Number));
    const ys = tips.flatMap(t => t.filter((_, i) => i % 2));
    if (ys.some(v => Math.abs(v - Number(y)) > 6) || !tips.every(t => t.some((v, i) => i % 2 === 0 && (Math.abs(v - Number(x1)) < 0.01 || Math.abs(v - Number(x2)) < 0.01)))) return match;
    const line = match.slice(0, match.indexOf('/>') + 2).replace(/ y1="[^"]*" y2="[^"]*"/u, ` y1="${round(Number(y) - CONSTRAINT_LIFT)}" y2="${round(Number(y) - CONSTRAINT_LIFT)}"`);
    return `${line}${shift(p1)}${shift(p2)}${textOpen}${round(Number(ty) - CONSTRAINT_LIFT)}${textClose}`;
  });
}

/**
 * PlantUML sizes the mainframe without the footer that carries the time unit, so
 * the frame's bottom edge runs through it. The frame (and, if needed, the SVG
 * canvas) is extended to enclose the footer with the theme's frame padding.
 */
export function encloseFooter(svg: string): string {
  const footer = svg.match(new RegExp(`<g class="footer"[^>]*><text [^>]*font-size="${NUM}"[^>]* y="${NUM}"`, 'u'));
  const frame = svg.match(new RegExp(`<g><rect fill="#FFFFFF" height="${NUM}" style="[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'u'));
  if (!footer || !frame) return svg;
  const size = Number(footer[1]), baseline = Number(footer[2]);
  const top = Number(frame[4]), height = Number(frame[1]);
  const needed = baseline + size * 0.35 + theme.spacing.frame / 2 - top;
  if (needed <= height) return svg;
  const grow = needed - height;
  let out = svg.replace(frame[0], frame[0].replace(`height="${frame[1]}"`, `height="${round(needed)}"`));
  out = out.replace(/<svg\s[^>]*>/u, root => root
    .replace(/ height="([\d.]+)px"/u, (_, h: string) => ` height="${Math.ceil(Number(h) + grow)}px"`)
    .replace(/height:([\d.]+)px;/u, (_, h: string) => `height:${Math.ceil(Number(h) + grow)}px;`)
    .replace(/ viewBox="0 0 ([\d.]+) ([\d.]+)"/u, (_, w: string, h: string) => ` viewBox="0 0 ${w} ${Math.ceil(Number(h) + grow)}"`));
  return out;
}

/** Gap between a message line and its label. */
export const MESSAGE_LABEL_GAP = 4;

interface Box { x: number; y: number; width: number; height: number }
const attr = (tag: string, name: string): number => Number(tag.match(new RegExp(`\\s${name}="(-?[\\d.]+)"`, 'u'))?.[1] ?? NaN);
const textBox = (tag: string): Box => {
  const size = attr(tag, 'font-size');
  return { x: attr(tag, 'x'), y: attr(tag, 'y') - size * 0.95, width: attr(tag, 'textLength'), height: size * 1.2 };
};

/**
 * PlantUML writes a timing message's label at the arrow's tip, where it covers
 * the receiving lifeline (a concise value band or a grid line). Each label is
 * moved next to its arrow instead: candidate positions along the arrow, to its
 * right and on the side the line does not run to, are tried in a fixed order and
 * the first one that crosses no solid line, text, value band or note is taken
 * (the middle of the arrow when none is free). Deterministic; only x/y change.
 */
export function placeMessageLabels(svg: string): string {
  const edge = theme.color.edge;
  const pattern = new RegExp(`(<line style="stroke:${edge};stroke-width:[\\d.]+;" x1="${NUM}" x2="${NUM}" y1="${NUM}" y2="${NUM}"/><polygon fill="${edge}" points="${NUM},${NUM},${NUM},${NUM},${NUM},${NUM}" style="[^"]*"/>)((?:<text [^>]*>[^<]*</text>)+)`, 'gu');
  const messages = [...svg.matchAll(pattern)];
  if (!messages.length) return svg;
  const labelTags = new Set(messages.flatMap(m => [...m[12]!.matchAll(/<text [^>]*>/gu)].map(t => t.index! + m.index! + m[1]!.length)));
  // Obstacles: solid lines, other texts, concise value shapes and notes.
  const segments: { a: Point; b: Point }[] = [];
  for (const m of svg.matchAll(/<line style="([^"]*)" x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu)) {
    if (m[1]!.includes('dasharray')) continue;
    segments.push({ a: { x: Number(m[2]), y: Number(m[4]) }, b: { x: Number(m[3]), y: Number(m[5]) } });
  }
  const boxes: Box[] = [];
  for (const m of svg.matchAll(/<text [^>]*>/gu)) if (!labelTags.has(m.index!)) boxes.push(textBox(m[0]));
  for (const [shape] of svg.matchAll(/<(?:polygon|path)\b[^>]*>/gu)) {
    const fill = shape.match(/ fill="(#[0-9A-F]{6})"/u)?.[1];
    if (fill !== theme.color.nodeHeaderFill && fill !== theme.color.noteFill) continue;
    const n = (shape.match(/ (?:points|d)="([^"]*)"/u)?.[1]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    boxes.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
  }
  const right = Math.max(...segments.map(s => Math.max(s.a.x, s.b.x)));

  let index = 0;
  return svg.replace(pattern, (match, open: string, ...rest: string[]) => {
    const own = messages[index++]!;
    const [x1, x2, y1, y2] = rest.slice(0, 4).map(Number) as [number, number, number, number];
    const texts = rest[10]!;
    const tags = [...texts.matchAll(/<text [^>]*>/gu)].map(t => t[0]);
    if (!tags.length || own[0] !== match) return match;
    const first = textBox(tags[0]!);
    const size = attr(tags[0]!, 'font-size');
    const pitch = tags.length > 1 ? attr(tags[1]!, 'y') - attr(tags[0]!, 'y') : size * 1.2;
    const width = Math.max(...tags.map(t => attr(t, 'textLength')));
    const height = (tags.length - 1) * pitch + size * 1.2;
    const leftEnd = x1 <= x2 ? { x: x1, y: y1 } : { x: x2, y: y2 };
    const rightEnd = x1 <= x2 ? { x: x2, y: y2 } : { x: x1, y: y1 };
    // Screen y grows downwards: a rising arrow has its line above-right of any point on it.
    const below = rightEnd.y < leftEnd.y;
    const own_ = { a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
    const free = (b: Box): boolean => b.x + b.width <= right
      && !segments.some(s => !(s.a.x === own_.a.x && s.a.y === own_.a.y && s.b.x === own_.b.x && s.b.y === own_.b.y) && segmentIntersectsRect(s.a, s.b, b))
      && !segmentIntersectsRect(own_.a, own_.b, b)
      && !boxes.some(o => overlapArea(o, b) > 0);
    const at = (t: number): Box => {
      const p = { x: leftEnd.x + (rightEnd.x - leftEnd.x) * t, y: leftEnd.y + (rightEnd.y - leftEnd.y) * t };
      return { x: p.x + MESSAGE_LABEL_GAP, y: below ? p.y + MESSAGE_LABEL_GAP : p.y - MESSAGE_LABEL_GAP - height, width, height };
    };
    const chosen = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1].map(at).find(free) ?? at(0.5);
    boxes.push(chosen);
    const dx = chosen.x - first.x, dy = chosen.y - first.y;
    const moved = texts.replace(/(<text [^>]* x=")(-?[\d.]+)(" y=")(-?[\d.]+)(")/gu, (_m, a: string, x: string, b: string, y: string, c: string) =>
      `${a}${round(Number(x) + dx)}${b}${round(Number(y) + dy)}${c}`);
    return `${open}${moved}`;
  });
}

/** All fix-ups applied to PlantUML's timing SVG. */
export function postProcessTiming(svg: string): string {
  return encloseFooter(placeMessageLabels(liftConstraints(fillFrameHeading(svg))));
}
