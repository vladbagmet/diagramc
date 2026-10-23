import { theme } from '../../core/theme.js';
import { fillFrameHeading } from '../../plantuml/frame.js';
import { padCanvas } from '../../plantuml/geometry.js';
import type { SequenceDiagram } from './model.js';
import { noteSpacers } from './to-plantuml.js';

const NUM = String.raw`(-?[\d.]+)`;

/**
 * UML 2.5.1 (17.3.4): a destruction occurrence ends its lifeline; nothing is drawn
 * below the X. PlantUML keeps drawing the dashed line to the bottom of the
 * diagram, so each lifeline that carries an X (two crossing diagonals of one square) is cut
 * at the X's centre. Only coordinates of existing elements change.
 */
export function endDestroyedLifelines(svg: string): string {
  const crosses: { x: number; y: number }[] = [];
  const cross = new RegExp(`<line style="stroke:${theme.color.edge};stroke-width:[12];" x1="${NUM}" x2="${NUM}" y1="${NUM}" y2="${NUM}"/><line style="stroke:${theme.color.edge};stroke-width:[12];" x1="${NUM}" x2="${NUM}" y1="${NUM}" y2="${NUM}"/>`, 'gu');
  const square = (m: RegExpMatchArray | string[]): { x: number; y: number } | undefined => {
    const [a1, a2, b1, b2, c1, c2, d1, d2] = m.slice(1, 9).map(Number) as [number, number, number, number, number, number, number, number];
    // Two diagonals of the same square: same x range, mirrored y.
    const ok = a1 === c1 && a2 === c2 && b1 === d2 && b2 === d1 && Math.abs(Math.abs(a2 - a1) - Math.abs(b2 - b1)) < 0.01 && Math.abs(a2 - a1) > 10;
    return ok ? { x: (a1 + a2) / 2, y: (b1 + b2) / 2 } : undefined;
  };
  for (const m of svg.matchAll(cross)) {
    const c = square(m);
    if (c) crosses.push(c);
  }
  if (crosses.length === 0) return svg;
  // The X of a destroy item is drawn 1px wide, the X after a delete message 2px: draw both alike.
  svg = svg.replace(cross, (m, ...groups: string[]) => square([m, ...groups]) ? m.replaceAll('stroke-width:1;', 'stroke-width:2;') : m);
  const lifeline = new RegExp(`(<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000" height=")${NUM}(" width="${NUM}" x="${NUM}" y=")${NUM}("/><line style="[^"]*" x1=")${NUM}(" x2=")${NUM}(" y1=")${NUM}(" y2=")${NUM}("/></g>)`, 'gu');
  return svg.replaceAll(lifeline, (match, open: string, height: string, mid: string, _w: string, _x: string, y: string, l1: string, x1: string, l2: string, x2: string, l3: string, y1: string, l4: string, y2: string, close: string) => {
    const x = Number(x1), top = Number(y1), bottom = Number(y2);
    if (Number(x2) !== x) return match;
    const end = crosses.filter(c => Math.abs(c.x - x) < 1 && c.y > top && c.y < bottom).map(c => c.y).sort((p, q) => p - q)[0];
    if (end === undefined) return match;
    const cut = (n: number): string => String(Math.round(n * 10_000) / 10_000);
    return `${open}${cut(Math.min(Number(height), end - Number(y)))}${mid}${y}${l1}${x1}${l2}${x2}${l3}${y1}${l4}${cut(end)}${close}`;
  });
}

/**
 * A self-message that opens a nested activation starts, in PlantUML, at the
 * column of the nested bar (5px right of the current bar) although that bar only
 * begins below the arrow, leaving a gap. The outgoing segment is extended back
 * to the border of the activation bar it leaves.
 */
export function attachSelfMessages(svg: string): string {
  const bars: { left: number; right: number; top: number; bottom: number }[] = [];
  const bar = new RegExp(String.raw`<rect fill="${theme.color.nodeFill}" height="${NUM}" style="stroke:${theme.color.edge};stroke-width:[\d.]+;" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu');
  for (const m of svg.matchAll(bar)) {
    const [h, w, x, y] = m.slice(1).map(Number) as [number, number, number, number];
    bars.push({ left: x, right: x + w, top: y, bottom: y + h });
  }
  const self = new RegExp(String.raw`(<g class="message" data-participant-1="([\w]+)" data-participant-2="\2"><line style="[^"]*" x1=")${NUM}(" x2="${NUM}" y1=")${NUM}(" y2=")${NUM}"`, 'gu');
  return svg.replaceAll(self, (match, open: string, _id: string, x1: string, mid: string, x2: string, y1: string, sep: string, y2: string) => {
    const x = Number(x1), y = Number(y1);
    if (y !== Number(y2) || Number(x2) <= x) return match;
    const edge = bars.filter(b => y >= b.top - 0.5 && y <= b.bottom + 0.5 && b.right < x && x - b.right <= 5.01).map(b => b.right).sort((p, q) => q - p)[0];
    return edge === undefined ? match : `${open}${edge}${mid}${y1}${sep}${y2}"`;
  });
}

interface Box { x: number; y: number; width: number; height: number }
/** Gap kept between a moved label and the lifeline or bar it avoids. */
export const LABEL_CLEARANCE = 4;

const attr = (tag: string, name: string): number => Number((new RegExp(String.raw`\s${name}="(-?[\d.]+)"`, 'u').exec(tag))?.[1] ?? Number.NaN);
const round = (n: number): string => String(Math.round(n * 10_000) / 10_000);
/** Box of a run of <text> tags (each line: baseline y, font-size, textLength). */
function textBlock(tags: readonly string[]): Box {
  const boxes = tags.map(t => {
    const size = attr(t, 'font-size');
    return { x: attr(t, 'x'), y: attr(t, 'y') - size * 0.95, width: attr(t, 'textLength'), height: size * 1.2 };
  });
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}
const moveTexts = (texts: string, dx: number): string =>
  texts.replaceAll(/(<text [^>]* x=")(-?[\d.]+)(")/gu, (_m, a: string, x: string, b: string) => `${a}${round(Number(x) + dx)}${b}`);
/** Clear space a halo leaves around the text it shields from crossing lines. */
export const HALO_PAD = 4;
const halo = (b: Box): string =>
  `<rect fill="${theme.color.labelHalo}" height="${round(b.height + 2)}" rx="3" ry="3" width="${round(b.width + 2 * HALO_PAD)}" x="${round(b.x - HALO_PAD)}" y="${round(b.y - 1)}"/>`;

/**
 * PlantUML writes message labels from the sending end and guards right after the
 * operator pentagon, without looking at the lifelines and activation bars under
 * them, so a label can be crossed by a lifeline it passes. Each crossed label or
 * guard is moved horizontally to the nearest position within its arrow (labels)
 * or fragment (guards) where nothing runs through it; when there is none, to the
 * nearest position off every activation bar, with a halo in the background color
 * painted behind it that hides the dashed lifelines under it, as the own engine
 * does for edge labels. Deterministic; only x coordinates change and fixed rects
 * are added.
 */
export function clearLabels(svg: string): string {
  const lifelines: { x: number; top: number; bottom: number }[] = [];
  for (const m of svg.matchAll(new RegExp(String.raw`<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000"[^>]*/><line style="[^"]*" x1="${NUM}" x2="\1" y1="${NUM}" y2="${NUM}"/></g>`, 'gu'))) {
    lifelines.push({ x: Number(m[1]), top: Number(m[2]), bottom: Number(m[3]) });
  }
  const bars: Box[] = [];
  for (const m of svg.matchAll(new RegExp(String.raw`<rect fill="${theme.color.nodeFill}" height="${NUM}" style="stroke:${theme.color.edge};stroke-width:[\d.]+;" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu'))) {
    const b = { height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
    if (!bars.some(o => o.x === b.x && o.y === b.y && o.width === b.width && o.height === b.height)) bars.push(b);
  }
  const onLifeline = (b: Box): boolean => lifelines.some(l => l.x > b.x - LABEL_CLEARANCE && l.x < b.x + b.width + LABEL_CLEARANCE && l.bottom > b.y && l.top < b.y + b.height);
  const onBar = (b: Box): boolean => bars.some(r => r.x < b.x + b.width + LABEL_CLEARANCE && r.x + r.width > b.x - LABEL_CLEARANCE && r.y < b.y + b.height && r.y + r.height > b.y);
  const crossed = (b: Box): boolean => onLifeline(b) || onBar(b);
  /**
   * Nearest left edge within [min, max] where nothing runs through the text,
   * trying positions just beside every obstacle; else the nearest where only
   * dashed lifelines do (hidden by a halo, `halo: true`). Activation bars are
   * drawn over halos, so a text never stays on a bar when it can move off it.
   */
  const place = (b: Box, min: number, max: number): { x: number; halo: boolean } | undefined => {
    if (!crossed(b)) return { x: b.x, halo: false };
    const edges = [b.x,
      ...lifelines.flatMap(l => [l.x + LABEL_CLEARANCE + 0.5, l.x - LABEL_CLEARANCE - 0.5 - b.width]),
      ...bars.flatMap(r => [r.x + r.width + LABEL_CLEARANCE + 0.5, r.x - LABEL_CLEARANCE - 0.5 - b.width]),
    ].filter(x => x >= min && x <= max).sort((p, q) => Math.abs(p - b.x) - Math.abs(q - b.x) || p - q);
    const free = edges.find(x => !crossed({ ...b, x }));
    if (free !== undefined) return { x: free, halo: false };
    const offBars = edges.find(x => !onBar({ ...b, x }));
    return offBars === undefined ? undefined : { x: offBars, halo: true };
  };
  /** The text moved to `spot` (with a halo when lifelines still pass under it), or haloed in place. */
  const settle = (texts: string, block: Box, spot: { x: number; halo: boolean } | undefined): string => {
    if (!spot) return `${halo(block)}${texts}`;
    const moved = moveTexts(texts, spot.x - block.x);
    return spot.halo ? `${halo({ ...block, x: spot.x })}${moved}` : moved;
  };

  // Message labels: within the horizontal extent of their arrow.
  let out = svg.replaceAll(/(<g class="message"[^>]*>)((?:(?!<\/g>).)*?)((?:<text [^>]*>[^<]*<\/text>)+)(<\/g>)/gsu, (match, open: string, shapes: string, texts: string, close: string) => {
    const tags = [...texts.matchAll(/<text [^>]*>/gu)].map(t => t[0]);
    const block = textBlock(tags);
    const xs = [...shapes.matchAll(/<line [^>]*x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="\3"\/>/gu)].flatMap(l => [Number(l[1]), Number(l[2])]);
    if (xs.length === 0 || !crossed(block)) return match;
    const spot = place(block, Math.min(...xs) + LABEL_CLEARANCE, Math.max(...xs) - LABEL_CLEARANCE - block.width);
    return `${open}${shapes}${settle(texts, block, spot)}${close}`;
  });

  // Guards: bold "[...]" texts, within their fragment's frame.
  const frames: Box[] = [...out.matchAll(new RegExp(`<rect fill="none" height="${NUM}" style="stroke:${theme.color.frameStroke};[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu'))]
    .map(m => ({ height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }));
  out = out.replaceAll(/<text [^>]*font-weight="bold"[^>]*>\[[^<]*\]<\/text>/gu, guard => {
    const tag = /<text [^>]*>/u.exec(guard)![0];
    const block = textBlock([tag]);
    if (!crossed(block)) return guard;
    const frame = frames.filter(f => block.x >= f.x && block.x <= f.x + f.width && block.y >= f.y && block.y <= f.y + f.height)
      .sort((p, q) => p.width * p.height - q.width * q.height)[0];
    return settle(guard, block, frame ? place(block, block.x, frame.x + frame.width - LABEL_CLEARANCE - block.width) : undefined);
  });
  return out;
}

/** Padding left of a note's text, and the room right of it (padding plus folded corner), as PlantUML draws notes. */
const NOTE_LEFT = 10, NOTE_RIGHT = 19;
/** A note over lifelines extends at least this far beyond the outermost lifeline it covers. */
export const NOTE_OVERHANG = 16;

/**
 * PlantUML stretches a note over several lifelines between them and centres its
 * wrapped text block, leaving a narrow block with wide padding on both sides.
 * The note is narrowed to its text (it still covers every lifeline it was over,
 * by NOTE_OVERHANG px, and stays within its old box) and the text starts at the
 * usual left padding; a note that cannot narrow keeps its box.
 */
export function tightenNotes(svg: string): string {
  const lifelines = [...svg.matchAll(new RegExp(String.raw`<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000"[^>]*/><line style="[^"]*" x1="${NUM}" x2="\1" y1="${NUM}" y2="${NUM}"/></g>`, 'gu'))]
    .map(m => ({ x: Number(m[1]), top: Number(m[2]), bottom: Number(m[3]) }));
  const fill = theme.color.noteFill;
  const note = new RegExp(String.raw`<path d="M${NUM},${NUM} L\1,${NUM} L${NUM},\3 L\4,${NUM} L${NUM},\2 L\1,\2" fill="${fill}"([^>]*)/><path d="M\6,\2 L\6,\5 L\4,\5 L\6,\2" fill="${fill}"([^>]*)/>((?:<text [^>]*>[^<]*</text>)+)`, 'gu');
  return svg.replace(note, (match, left: string, top: string, bottom: string, right: string, foldY: string, cornerX: string, s1: string, s2: string, texts: string) => {
    const l = Number(left), r = Number(right), t = Number(top), b = Number(bottom);
    const block = textBlock([...texts.matchAll(/<text [^>]*>/gu)].map(m => m[0]));
    if (block.x - l <= NOTE_LEFT + 2) return match;
    const covered = lifelines.filter(x => x.x > l && x.x < r && x.top < b && x.bottom > t).map(x => x.x);
    const width = Math.max(block.width + NOTE_LEFT + NOTE_RIGHT, covered.length > 0 ? Math.max(...covered) - Math.min(...covered) + 2 * NOTE_OVERHANG : 0);
    // Without room to narrow it, the note keeps its box and its text moves to the usual padding.
    const keep = moveTexts(texts, l + NOTE_LEFT - block.x);
    const narrowed = (): string => match.slice(0, match.indexOf('<text ')) + keep;
    if (width >= r - l - 1) return narrowed();
    const middle = covered.length > 0 ? (Math.min(...covered) + Math.max(...covered)) / 2 : (l + r) / 2;
    const nl = Math.min(Math.max(l, middle - width / 2), r - width), nr = nl + width;
    if (covered.length > 0 && (Math.min(...covered) - nl < NOTE_OVERHANG - 0.5 || nr - Math.max(...covered) < NOTE_OVERHANG - 0.5)) return narrowed();
    const L = round(nl), R = round(nr), C = round(nr - (r - Number(cornerX)));
    return `<path d="M${L},${top} L${L},${bottom} L${R},${bottom} L${R},${foldY} L${C},${top} L${L},${top}" fill="${fill}"${s1}/>`
      + `<path d="M${C},${top} L${C},${foldY} L${R},${foldY} L${C},${top}" fill="${fill}"${s2}/>`
      + moveTexts(texts, nl + NOTE_LEFT - block.x);
  });
}

/** Step between the right borders of nested combined fragments, as PlantUML steps their left borders. */
export const FRAGMENT_INSET = 10;

/**
 * PlantUML ends nested combined fragments that reach the same rightmost element
 * at one x, so their right borders are drawn on top of each other and a reader
 * cannot tell which fragment a border closes. Each fragment is widened to reach
 * FRAGMENT_INSET px beyond the fragments nested in it (with its operand
 * separators); the diagram frame and canvas grow when needed.
 */
export function separateFragmentEdges(svg: string): string {
  const pattern = new RegExp(`<rect fill="none" height="${NUM}" style="stroke:${theme.color.frameStroke};[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu');
  const frames = new Map<string, Box>();
  for (const m of svg.matchAll(pattern)) {
    const b = { height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
    frames.set(`${m[2]},${m[3]},${m[4]},${m[1]}`, b);
  }
  const list = [...frames.values()];
  const inside = (a: Box, b: Box): boolean => a !== b && a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
  const right = new Map<Box, number>();
  const reach = (f: Box): number => {
    const known = right.get(f);
    if (known !== undefined) return known;
    const children = list.filter(c => inside(c, f));
    const r = Math.max(f.x + f.width, ...children.map(c => reach(c) + FRAGMENT_INSET));
    right.set(f, r);
    return r;
  };
  let grow = 0;
  for (const f of list) grow = Math.max(grow, reach(f) - (f.x + f.width));
  if (grow < 0.01) return svg;
  svg = svg.replace(pattern, (match, h: string, w: string, x: string, y: string) => {
    const f = frames.get(`${w},${x},${y},${h}`)!;
    const r = right.get(f)!;
    return r - (f.x + f.width) < 0.01 ? match : match.replace(` width="${w}"`, ` width="${round(r - f.x)}"`);
  });
  // Operand separators run across their fragment: from its left to its right border.
  svg = svg.replaceAll(new RegExp(String.raw`(<line style="stroke:${theme.color.frameStroke};[^"]*stroke-dasharray[^"]*" x1="${NUM}" x2=")${NUM}(" y1="${NUM}" y2="\5"/>)`, 'gu'), (match, a: string, x1: string, x2: string, b: string, y: string) => {
    const f = list.filter(o => Math.abs(o.x - Number(x1)) < 0.5 && Math.abs(o.x + o.width - Number(x2)) < 0.5 && Number(y) > o.y && Number(y) < o.y + o.height)
      .sort((p, q) => p.height - q.height)[0];
    return f ? `${a}${round(right.get(f)!)}${b}` : match;
  });
  // The diagram frame (and the canvas) keep their margin right of every fragment.
  const widest = Math.max(...list.map(f => right.get(f)!));
  const outer = new RegExp(`<rect fill="${theme.color.background}" height="${NUM}" style="stroke:${theme.color.frameStroke};[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'u').exec(svg);
  const view = Number((/ viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /u.exec(svg))?.[1] ?? Infinity);
  const extra = Math.max(0, widest + FRAGMENT_INSET - (outer ? Number(outer[3]) + Number(outer[2]) : view));
  if (extra < 0.01) return svg;
  if (outer) svg = svg.replace(outer[0], outer[0].replace(` width="${outer[2]}"`, ` width="${round(Number(outer[2]) + extra)}"`));
  return svg.replace(/<svg\s[^>]*>/u, root => root
    .replace(/ width="([\d.]+)px"/u, (_, v: string) => ` width="${Math.ceil(Number(v) + extra)}px"`)
    .replace(/width:([\d.]+)px;/u, (_, v: string) => `width:${Math.ceil(Number(v) + extra)}px;`)
    .replace(/ viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u, (_, x: string, y: string, w: string, h: string) => ` viewBox="${x} ${y} ${Math.ceil(Number(w) + extra)} ${h}"`));
}

/**
 * PlantUML centres a state invariant on its lifeline even while an activation
 * bar runs there, so the invariant's opaque box cuts the bar in two. Such an
 * invariant is moved right until its box starts at the bar's right border: the
 * constraint stays at its place on the lifeline's execution and the bar stays
 * whole. Kept in place when that spot is taken by another text or bar.
 */
export function invariantsBesideBars(svg: string): string {
  const bars: Box[] = [...svg.matchAll(new RegExp(String.raw`<rect fill="${theme.color.nodeFill}" height="${NUM}" style="stroke:${theme.color.edge};stroke-width:[\d.]+;" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu'))]
    .map(m => ({ height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }));
  if (bars.length === 0) return svg;
  const texts = [...svg.matchAll(/<text [^>]*>/gu)].map(m => ({ tag: m[0], box: textBlock([m[0]]) }));
  const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const bg = theme.color.background;
  return svg.replaceAll(new RegExp(String.raw`<rect fill="${bg}" height="${NUM}" style="stroke:${bg};stroke-width:[\d.]+;" width="${NUM}" x="${NUM}" y="${NUM}"/>((?:<text [^>]*>[^<]*</text>)+)`, 'gu'), (match, h: string, w: string, x: string, y: string, inner: string) => {
    const box = { height: Number(h), width: Number(w), x: Number(x), y: Number(y) };
    const under = bars.filter(b => overlaps(b, box));
    if (under.length === 0) return match;
    const dx = Math.max(...under.map(b => b.x + b.width)) + 2 - box.x;
    const moved = { ...box, x: box.x + dx };
    const own = new Set([...inner.matchAll(/<text [^>]*>/gu)].map(m => m[0]));
    if (bars.some(b => !under.includes(b) && overlaps(b, moved)) || texts.some(t => !own.has(t.tag) && overlaps(t.box, moved))) return match;
    return match.replaceAll(/ x="(-?[\d.]+)"/gu, (_m, v: string) => ` x="${round(Number(v) + dx)}"`);
  });
}

/** Distance lifelines run on below the last drawn element, as PlantUML leaves it without spacer rows. */
export const LIFELINE_TAIL = 16;

/**
 * Removes the empty rows the hidden spacer messages (to-plantuml.ts) add at the
 * bottom: lifelines end LIFELINE_TAIL px below the lowest drawn element and
 * the frame and canvas shrink by the same amount.
 */
export function cropSpacerRows(svg: string): string {
  const lifeline = new RegExp(String.raw`<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000" height="${NUM}" width="${NUM}" x="${NUM}" y="${NUM}"/><line style="[^"]*" x1="${NUM}" x2="\5" y1="${NUM}" y2="${NUM}"/></g>`, 'gu');
  const lines = [...svg.matchAll(lifeline)];
  if (lines.length === 0) return svg;
  const bottom = Math.max(...lines.map(m => Number(m[7])));
  // Lowest point of everything else: the lifelines and the frame are removed before measuring.
  const rest = svg.replaceAll(lifeline, '').replace(/<rect fill="#FFFFFF"[^>]*\/>/u, '').replace(/<g class="footer"[\s\S]*?<\/g>/u, '');
  let content = 0;
  for (const [tag] of rest.matchAll(/<(?:line|rect|polygon|polyline|path|ellipse|text)\b[^>]*>/gu)) {
    const ys = [...tag.matchAll(/\s(?:y|y1|y2|cy)="(-?[\d.]+)"/gu)].map(m => Number(m[1]));
    const h = Number((/\sheight="([\d.]+)"/u.exec(tag))?.[1] ?? 0);
    const pts = ((/\s(?:points|d)="([^"]*)"/u.exec(tag))?.[1]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    const r = tag.startsWith('<ellipse') ? Number((/\sry="([\d.]+)"/u.exec(tag))?.[1] ?? 0) : 0;
    content = Math.max(content, ...ys.map(y => y + (tag.startsWith('<rect') ? h : r)), ...pts);
  }
  const cut = bottom - (content + LIFELINE_TAIL);
  if (cut <= 0.5) return svg;
  const keep = (n: number): string => String(Math.round(n * 10_000) / 10_000);
  svg = svg.replaceAll(lifeline, (m, h: string, _w: string, _x: string, y: string, _lx: string, y1: string, y2: string) => {
    if (Number(y2) < bottom - 0.01) return m;
    return m.replace(`height="${h}"`, `height="${keep(Number(h) - cut)}"`).replace(`y2="${y2}"`, `y2="${keep(Number(y2) - cut)}"`);
  });
  svg = svg.replace(/<rect fill="#FFFFFF" height="([\d.]+)"/u, (_, h: string) => `<rect fill="#FFFFFF" height="${keep(Number(h) - cut)}"`);
  return svg.replace(/<svg\s[^>]*>/u, root => root
    .replace(/ height="([\d.]+)px"/u, (_, h: string) => ` height="${Math.ceil(Number(h) - cut)}px"`)
    .replace(/height:([\d.]+)px;/u, (_, h: string) => `height:${Math.ceil(Number(h) - cut)}px;`)
    .replace(/ viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u, (_, x: string, y: string, w: string, h: string) => ` viewBox="${x} ${y} ${w} ${Math.ceil(Number(h) - cut)}"`));
}

/**
 * UML bolds only the operator of a combined fragment (17.6.4); PlantUML also
 * bolds the guards. Guards are drawn in the regular weight.
 */
export function regularGuards(svg: string): string {
  return svg.replaceAll(/<text [^>]*font-weight="bold"[^>]*>\[[^<]*\]<\/text>/gu, guard => guard.replace(' font-weight="bold"', ''));
}

/** Distance kept between a found or lost message's circle and the fragment border it stays inside. */
export const CIRCLE_INSET = 14;

/**
 * PlantUML draws lost messages to the right edge of the diagram and found
 * messages from its left edge, through the borders of the fragments they are
 * in. The open end (circle and line, with its arrowhead for a lost message) is
 * pulled in to CIRCLE_INSET px inside the innermost fragment around the known end.
 */
export function keepFoundAndLostInside(svg: string): string {
  const frames: Box[] = [...svg.matchAll(new RegExp(`<rect fill="none" height="${NUM}" style="stroke:${theme.color.frameStroke};[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu'))]
    .map(m => ({ height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }));
  if (frames.length === 0) return svg;
  const innermost = (x: number, y: number): Box | undefined => frames
    .filter(f => x > f.x && x < f.x + f.width && y > f.y && y < f.y + f.height)
    .sort((p, q) => p.width * p.height - q.width * q.height)[0];
  return svg.replaceAll(/<g class="message"[^>]*>(?:(?!<\/g>).)*?<\/g>/gsu, group => {
    const ellipse = /<ellipse cx="(-?[\d.]+)" cy="(-?[\d.]+)"/u.exec(group);
    if (!ellipse) return group;
    const cx = Number(ellipse[1]), cy = Number(ellipse[2]);
    const lines = [...group.matchAll(/<line style="[^"]*" x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu)].map(m => ({ tag: m[0], x1: Number(m[1]), x2: Number(m[2]), y1: Number(m[3]), y2: Number(m[4]) }));
    const main = lines.filter(l => l.y1 === l.y2).sort((p, q) => Math.abs(q.x2 - q.x1) - Math.abs(p.x2 - p.x1))[0];
    if (!main) return group;
    const left = Math.min(main.x1, main.x2), right = Math.max(main.x1, main.x2);
    const lost = Math.abs(cx - right) < Math.abs(cx - left);
    // The known end decides which fragment the message is in.
    const frame = innermost(lost ? left + 1 : right - 1, cy);
    if (!frame) return group;
    let dx = 0;
    if (cx > (left + right) / 2 && cx > frame.x + frame.width - CIRCLE_INSET) dx = frame.x + frame.width - CIRCLE_INSET - cx;
    else if (cx < (left + right) / 2 && cx < frame.x + CIRCLE_INSET) dx = frame.x + CIRCLE_INSET - cx;
    // Never shorter than 24 px.
    if (!dx || (right - left) - Math.abs(dx) < 24) return group;
    // Circle, arrowhead and line end lie within 18 px of the circle center.
    const near = (x: number): boolean => Math.abs(x - cx) < 20;
    const shift = (x: number): string => round(near(x) ? x + dx : x);
    let out = group.replace(/<ellipse cx="(-?[\d.]+)"/u, (_, x: string) => `<ellipse cx="${round(Number(x) + dx)}"`);
    out = out.replaceAll(/(<line style="[^"]*" x1=")(-?[\d.]+)(" x2=")(-?[\d.]+)(")/gu, (_m, a: string, x1: string, b: string, x2: string, c: string) => `${a}${shift(Number(x1))}${b}${shift(Number(x2))}${c}`);
    out = out.replaceAll(/<polygon fill="([^"]*)" points="([^"]*)"/gu, (_m, fill: string, pts: string) => `<polygon fill="${fill}" points="${pts.split(',').map((v, i) => i % 2 === 0 && near(Number(v)) ? round(Number(v) + dx) : v).join(',')}"`);
    // A found message's label starts next to its circle and moves with it.
    if (!lost) out = out.replaceAll(/(<text [^>]* x=")(-?[\d.]+)(")/gu, (_m, a: string, x: string, b: string) => `${a}${round(Number(x) + dx)}${b}`);
    return out;
  });
}

/**
 * Lifeline heads drawn as a stereotype icon (actor, boundary, control, entity)
 * carry their name below the icon; rectangle heads center it in the box, higher
 * up. Rectangle heads in the top row are moved down so every name in the row
 * sits on one baseline, and their lifelines start at the moved box.
 */
export function alignHeads(svg: string): string {
  const heads = [...svg.matchAll(/<g class="participant participant-head" data-participant="([^"]+)">((?:(?!<\/g>).)*)<\/g>/gsu)].map(m => ({
    whole: m[0], body: m[2]!,
    rect: /^<rect fill="[^"]*" height="(-?[\d.]+)" style="[^"]*" width="(-?[\d.]+)" x="(-?[\d.]+)" y="(-?[\d.]+)"\/>/u.exec((m[2]!)),
    baseline: Math.max(...[...m[2]!.matchAll(/<text [^>]* y="(-?[\d.]+)"/gu)].map(t => Number(t[1]))),
  }));
  const icons = heads.filter(h => !h.rect);
  if (icons.length === 0 || icons.length === heads.length) return svg;
  const row = Math.max(...icons.map(h => h.baseline));
  for (const h of heads) {
    if (!h.rect || Number(h.rect[4]) > row || h.baseline >= row - 0.5) continue;
    const dy = row - h.baseline;
    const moved = h.body.replaceAll(/(<(?:rect|text) [^>]* y=")(-?[\d.]+)(")/gu, (_m, a: string, y: string, b: string) => `${a}${round(Number(y) + dy)}${b}`);
    svg = svg.replace(h.whole, h.whole.replace(h.body, moved));
    const center = Number(h.rect[3]) + Number(h.rect[2]) / 2, bottom = Number(h.rect[4]) + Number(h.rect[1]) + dy;
    svg = svg.replaceAll(new RegExp(String.raw`(<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000" height=")${NUM}(" width="${NUM}" x="${NUM}" y=")${NUM}("/><line style="[^"]*" x1=")${NUM}(" x2="\6" y1=")${NUM}(" y2=")${NUM}("/></g>)`, 'gu'),
      (m, a: string, height: string, b: string, _w: string, _x: string, y: string, c: string, x1: string, d: string, y1: string, e: string, y2: string, f: string) => {
        if (Math.abs(Number(x1) - center) > 2 || Number(y1) >= bottom) return m;
        return `${a}${round(Number(y2) - bottom)}${b}${round(bottom)}${c}${x1}${d}${round(bottom)}${e}${y2}${f}`;
      });
  }
  return svg;
}

/** All fix-ups applied to PlantUML's sequence SVG. */
export function postProcessSequence(svg: string, model?: SequenceDiagram): string {
  const cropped = model && noteSpacers(model).size > 0 ? cropSpacerRows(svg) : svg;
  const fixed = regularGuards(clearLabels(tightenNotes(invariantsBesideBars(keepFoundAndLostInside(separateFragmentEdges(attachSelfMessages(endDestroyedLifelines(alignHeads(fillFrameHeading(cropped))))))))));
  // Without a title there is no frame: give the drawing the own engine's canvas margin.
  return model && model.title === undefined ? padCanvas(fixed, theme.spacing.canvas) : fixed;
}
