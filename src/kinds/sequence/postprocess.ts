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

/** All fix-ups applied to PlantUML's sequence SVG. */
export function postProcessSequence(svg: string): string {
  return attachSelfMessages(endDestroyedLifelines(fillFrameHeading(svg)));
}
