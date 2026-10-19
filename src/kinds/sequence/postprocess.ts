import { theme } from '../../core/theme.js';
import { fillFrameHeading } from '../../plantuml/frame.js';

const NUM = '(-?[\\d.]+)';

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
  if (!crosses.length) return svg;
  // The X of a destroy item is drawn 1px wide, the X after a delete message 2px: draw both alike.
  svg = svg.replace(cross, (m, ...groups: string[]) => square([m, ...groups]) ? m.replaceAll('stroke-width:1;', 'stroke-width:2;') : m);
  const lifeline = new RegExp(`(<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000" height=")${NUM}(" width="${NUM}" x="${NUM}" y=")${NUM}("/><line style="[^"]*" x1=")${NUM}(" x2=")${NUM}(" y1=")${NUM}(" y2=")${NUM}("/></g>)`, 'gu');
  return svg.replace(lifeline, (match, open: string, height: string, mid: string, _w: string, _x: string, y: string, l1: string, x1: string, l2: string, x2: string, l3: string, y1: string, l4: string, y2: string, close: string) => {
    const x = Number(x1), top = Number(y1), bottom = Number(y2);
    if (Number(x2) !== x) return match;
    const end = crosses.filter(c => Math.abs(c.x - x) < 1 && c.y > top && c.y < bottom).map(c => c.y).sort((p, q) => p - q)[0];
    if (end === undefined) return match;
    const cut = (n: number): string => String(Math.round(n * 10000) / 10000);
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
  const bar = new RegExp(`<rect fill="${theme.color.nodeFill}" height="${NUM}" style="stroke:${theme.color.edge};stroke-width:[\\d.]+;" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu');
  for (const m of svg.matchAll(bar)) {
    const [h, w, x, y] = m.slice(1).map(Number) as [number, number, number, number];
    bars.push({ left: x, right: x + w, top: y, bottom: y + h });
  }
  const self = new RegExp(`(<g class="message" data-participant-1="([\\w]+)" data-participant-2="\\2"><line style="[^"]*" x1=")${NUM}(" x2="${NUM}" y1=")${NUM}(" y2=")${NUM}"`, 'gu');
  return svg.replace(self, (match, open: string, _id: string, x1: string, mid: string, x2: string, y1: string, sep: string, y2: string) => {
    const x = Number(x1), y = Number(y1);
    if (y !== Number(y2) || Number(x2) <= x) return match;
    const edge = bars.filter(b => y >= b.top - 0.5 && y <= b.bottom + 0.5 && b.right < x && x - b.right <= 5.01).map(b => b.right).sort((p, q) => q - p)[0];
    return edge === undefined ? match : `${open}${edge}${mid}${y1}${sep}${y2}"`;
  });
}

interface Box { x: number; y: number; width: number; height: number }
/** Gap kept between a moved label and the lifeline or bar it avoids. */
export const LABEL_CLEARANCE = 4;

const attr = (tag: string, name: string): number => Number(tag.match(new RegExp(`\\s${name}="(-?[\\d.]+)"`, 'u'))?.[1] ?? NaN);
const round = (n: number): string => String(Math.round(n * 10000) / 10000);
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
  texts.replace(/(<text [^>]* x=")(-?[\d.]+)(")/gu, (_m, a: string, x: string, b: string) => `${a}${round(Number(x) + dx)}${b}`);
const halo = (b: Box): string =>
  `<rect fill="${theme.color.labelHalo}" height="${round(b.height)}" width="${round(b.width + 4)}" x="${round(b.x - 2)}" y="${round(b.y)}"/>`;

/**
 * PlantUML writes message labels from the sending end and guards right after the
 * operator pentagon, without looking at the lifelines and activation bars under
 * them, so a label can be crossed by a lifeline it passes. Each crossed label or
 * guard is moved horizontally to the nearest position within its arrow (labels)
 * or fragment (guards) where nothing runs through it; when there is none, a halo
 * in the background color is painted behind it, as the own engine does for edge
 * labels. Deterministic; only x coordinates change and fixed rects are added.
 */
export function clearLabels(svg: string): string {
  const lifelines: { x: number; top: number; bottom: number }[] = [];
  for (const m of svg.matchAll(new RegExp(`<g><title>[^<]*</title><rect fill="#000000" fill-opacity="0.00000"[^>]*/><line style="[^"]*" x1="${NUM}" x2="\\1" y1="${NUM}" y2="${NUM}"/></g>`, 'gu'))) {
    lifelines.push({ x: Number(m[1]), top: Number(m[2]), bottom: Number(m[3]) });
  }
  const bars: Box[] = [];
  for (const m of svg.matchAll(new RegExp(`<rect fill="${theme.color.nodeFill}" height="${NUM}" style="stroke:${theme.color.edge};stroke-width:[\\d.]+;" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu'))) {
    const b = { height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
    if (!bars.some(o => o.x === b.x && o.y === b.y && o.width === b.width && o.height === b.height)) bars.push(b);
  }
  const crossed = (b: Box): boolean =>
    lifelines.some(l => l.x > b.x - LABEL_CLEARANCE && l.x < b.x + b.width + LABEL_CLEARANCE && l.bottom > b.y && l.top < b.y + b.height)
    || bars.some(r => r.x < b.x + b.width + LABEL_CLEARANCE && r.x + r.width > b.x - LABEL_CLEARANCE && r.y < b.y + b.height && r.y + r.height > b.y);
  /** Nearest free left edge within [min, max], trying positions just beside every obstacle. */
  const place = (b: Box, min: number, max: number): number | undefined => {
    if (!crossed(b)) return b.x;
    const edges = [
      ...lifelines.flatMap(l => [l.x + LABEL_CLEARANCE + 0.5, l.x - LABEL_CLEARANCE - 0.5 - b.width]),
      ...bars.flatMap(r => [r.x + r.width + LABEL_CLEARANCE + 0.5, r.x - LABEL_CLEARANCE - 0.5 - b.width]),
    ].filter(x => x >= min && x <= max).sort((p, q) => Math.abs(p - b.x) - Math.abs(q - b.x) || p - q);
    return edges.find(x => !crossed({ ...b, x }));
  };

  // Message labels: within the horizontal extent of their arrow.
  let out = svg.replace(/(<g class="message"[^>]*>)((?:(?!<\/g>).)*?)((?:<text [^>]*>[^<]*<\/text>)+)(<\/g>)/gsu, (match, open: string, shapes: string, texts: string, close: string) => {
    const tags = [...texts.matchAll(/<text [^>]*>/gu)].map(t => t[0]);
    const block = textBlock(tags);
    const xs = [...shapes.matchAll(/<line [^>]*x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="\3"\/>/gu)].flatMap(l => [Number(l[1]), Number(l[2])]);
    if (!xs.length || !crossed(block)) return match;
    const x = place(block, Math.min(...xs) + LABEL_CLEARANCE, Math.max(...xs) - LABEL_CLEARANCE - block.width);
    return x === undefined ? `${open}${shapes}${halo(block)}${texts}${close}` : `${open}${shapes}${moveTexts(texts, x - block.x)}${close}`;
  });

  // Guards: bold "[...]" texts, within their fragment's frame.
  const frames: Box[] = [...out.matchAll(new RegExp(`<rect fill="none" height="${NUM}" style="stroke:${theme.color.frameStroke};[^"]*" width="${NUM}" x="${NUM}" y="${NUM}"/>`, 'gu'))]
    .map(m => ({ height: Number(m[1]), width: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }));
  out = out.replace(/<text [^>]*font-weight="bold"[^>]*>\[[^<]*\]<\/text>/gu, guard => {
    const tag = guard.match(/<text [^>]*>/u)![0];
    const block = textBlock([tag]);
    if (!crossed(block)) return guard;
    const frame = frames.filter(f => block.x >= f.x && block.x <= f.x + f.width && block.y >= f.y && block.y <= f.y + f.height)
      .sort((p, q) => p.width * p.height - q.width * q.height)[0];
    const x = frame ? place(block, block.x, frame.x + frame.width - LABEL_CLEARANCE - block.width) : undefined;
    return x === undefined ? `${halo(block)}${guard}` : moveTexts(guard, x - block.x);
  });
  return out;
}

/** All fix-ups applied to PlantUML's sequence SVG. */
export function postProcessSequence(svg: string): string {
  return clearLabels(attachSelfMessages(endDestroyedLifelines(fillFrameHeading(svg))));
}
