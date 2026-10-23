/**
 * Coordinate rewriting of PlantUML's flat SVG output (absolute coordinates, no
 * transforms): every shape and text is moved through mapping functions, so the
 * QA readers see the same geometry the viewer does. Only numbers change; no
 * element or text is introduced.
 */

const NUM = String.raw`-?[\d.]+`;
const round = (n: number): string => String(Math.round(n * 1000) / 1000);
const num = (tag: string, name: string): number => Number((new RegExp(String.raw`\s${name}="(${NUM})"`, 'u').exec(tag))?.[1] ?? Number.NaN);
const setAttr = (tag: string, name: string, value: number): string => tag.replace(new RegExp(String.raw`(\s${name}=")${NUM}(")`, 'u'), `$1${round(value)}$2`);

export interface Mapping {
  x?: (x: number) => number;
  y?: (y: number) => number;
}

/**
 * Applies `map` to every coordinate of lines, rectangles (both corners),
 * polygons, polylines, paths (M, L, A, H, V, absolute), texts (start point) and
 * ellipses (center).
 */
export function mapCoordinates(svg: string, map: Mapping): string {
  const fx = map.x ?? ((v: number) => v), fy = map.y ?? ((v: number) => v);
  return svg.replaceAll(/<(line|rect|polygon|polyline|path|text|ellipse)\b[^>]*>/gu, (tag, name: string) => {
    switch (name) {
      case 'line': return setAttr(setAttr(setAttr(setAttr(tag, 'x1', fx(num(tag, 'x1'))), 'x2', fx(num(tag, 'x2'))), 'y1', fy(num(tag, 'y1'))), 'y2', fy(num(tag, 'y2')));
      case 'rect': {
        const x = num(tag, 'x'), y = num(tag, 'y'), w = num(tag, 'width'), h = num(tag, 'height');
        return setAttr(setAttr(setAttr(setAttr(tag, 'x', fx(x)), 'width', fx(x + w) - fx(x)), 'y', fy(y)), 'height', fy(y + h) - fy(y));
      }
      case 'text': return setAttr(setAttr(tag, 'x', fx(num(tag, 'x'))), 'y', fy(num(tag, 'y')));
      case 'ellipse': return setAttr(setAttr(tag, 'cx', fx(num(tag, 'cx'))), 'cy', fy(num(tag, 'cy')));
      case 'polygon': case 'polyline':
        return tag.replace(/ points="([^"]*)"/u, (_, p: string) => {
          const n = p.split(/[ ,]+/u).filter(Boolean).map(Number);
          const out: string[] = [];
          for (let i = 0; i + 1 < n.length; i += 2) out.push(`${round(fx(n[i]!))},${round(fy(n[i + 1]!))}`);
          return ` points="${out.join(name === 'polygon' ? ',' : ' ')}"`;
        });
      case 'path':
        return tag.replace(/ d="([^"]*)"/u, (_, d: string) => ` d="${d.replaceAll(/([MLAHVZz])([^MLAHVZz]*)/gu, (_m, c: string, args: string) => {
          const n = args.trim().split(/[ ,]+/u).filter(Boolean).map(Number);
          if (c === 'Z' || c === 'z') return `${c} `;
          if (c === 'H') return `H${n.map(v => round(fx(v))).join(' ')} `;
          if (c === 'V') return `V${n.map(v => round(fy(v))).join(' ')} `;
          if (c === 'A') {
            const parts: string[] = [];
            for (let i = 0; i + 6 < n.length; i += 7) parts.push(`${n[i]},${n[i + 1]} ${n[i + 2]} ${n[i + 3]} ${n[i + 4]} ${round(fx(n[i + 5]!))},${round(fy(n[i + 6]!))}`);
            return `A${parts.join(' ')} `;
          }
          const pts: string[] = [];
          for (let i = 0; i + 1 < n.length; i += 2) pts.push(`${round(fx(n[i]!))},${round(fy(n[i + 1]!))}`);
          return `${c}${pts.join(' ')} `;
        }).trim()}"`);
      default: return tag;
    }
  });
}

/** Sets the canvas size (root width, height, style and viewBox). */
export function setCanvas(svg: string, width: number, height: number): string {
  const w = Math.ceil(width), h = Math.ceil(height);
  return svg.replace(/<svg\s[^>]*>/u, root => root
    .replace(/ width="[\d.]+px"/u, ` width="${w}px"`).replace(/ height="[\d.]+px"/u, ` height="${h}px"`)
    .replace(/width:[\d.]+px;/u, `width:${w}px;`).replace(/height:[\d.]+px;/u, `height:${h}px;`)
    .replace(/ viewBox="([-\d.]+) ([-\d.]+) [\d.]+ [\d.]+"/u, ` viewBox="$1 $2 ${w} ${h}"`));
}

/** Canvas size from the root viewBox. */
export function canvasSize(svg: string): { width: number; height: number } | undefined {
  const m = /<svg\s[^>]*viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/u.exec(svg);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** Bounding box of every drawn coordinate (texts: their start point and length). */
export function drawingBounds(svg: string): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const [tag, name] of svg.matchAll(/<(line|rect|polygon|polyline|path|text|ellipse)\b[^>]*>/gu)) {
    switch (name) {
    case 'line': { add(num(tag, 'x1'), num(tag, 'y1')); add(num(tag, 'x2'), num(tag, 'y2')); 
    break;
    }
    case 'rect': { const x = num(tag, 'x'), y = num(tag, 'y'); add(x, y); add(x + num(tag, 'width'), y + num(tag, 'height')); 
    break;
    }
    case 'text': { const x = num(tag, 'x'), y = num(tag, 'y'), s = num(tag, 'font-size') || 12; add(x, y - s); add(x + (num(tag, 'textLength') || 0), y + s * 0.3); 
    break;
    }
    case 'ellipse': { const cx = num(tag, 'cx'), cy = num(tag, 'cy'), rx = num(tag, 'rx'), ry = num(tag, 'ry'); add(cx - rx, cy - ry); add(cx + rx, cy + ry); 
    break;
    }
    case 'path': {
      for (const [, c, args] of ((/\sd="([^"]*)"/u.exec(tag))?.[1] ?? '').matchAll(/([MLA])([^MLAHVZz]*)/gu)) {
        const n = args!.trim().split(/[ ,]+/u).filter(Boolean).map(Number);
        if (c === 'A') { for (let i = 0; i + 6 < n.length; i += 7) add(n[i + 5]!, n[i + 6]!); }
        else for (let i = 0; i + 1 < n.length; i += 2) add(n[i]!, n[i + 1]!);
      }
    
    break;
    }
    default: {
      const n = ((/\spoints="([^"]*)"/u.exec(tag))?.[1] ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) add(n[i]!, n[i + 1]!);
    }
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Gives an untitled (frameless) PlantUML drawing the same empty margin as the
 * own engine (theme.spacing.canvas): everything is moved so the drawing starts
 * `margin` px from the top left, and the canvas leaves `margin` px on the right
 * and at the bottom.
 */
export function padCanvas(svg: string, margin: number): string {
  const b = drawingBounds(svg);
  if (!Number.isFinite(b.minX)) return svg;
  const dx = margin - b.minX, dy = margin - b.minY;
  const moved = Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? svg : mapCoordinates(svg, { x: v => v + dx, y: v => v + dy });
  return setCanvas(moved, b.maxX + dx + margin, b.maxY + dy + margin);
}
