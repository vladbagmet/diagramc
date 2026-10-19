import { theme } from '../core/theme.js';

/**
 * PlantUML draws the `mainframe` heading as an open polyline without a fill. The
 * own engine fills the pentagon (theme.color.frameHeadingFill); this closes and
 * fills PlantUML's heading the same way so both backends look alike. Only the
 * first top-level path directly after the frame rectangle is touched, and only
 * when it has the exact four-point heading shape PlantUML emits.
 */
export function fillFrameHeading(svg: string): string {
  return svg.replace(
    /(<g><rect fill="#FFFFFF" height="[\d.]+" style="[^"]*" width="[\d.]+" x="([\d.]+)" y="([\d.]+)"\/>)<path d="M([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+)" fill="none"/u,
    (match, rect: string, rx: string, ry: string, ax: string, ay: string, bx: string, by: string, cx: string, cy: string, dx: string, dy: string) => {
      if (dx !== rx || ay !== ry || ax !== bx || by === cy || cy !== dy) return match;
      return `${rect}<path d="M${rx},${ry} L${ax},${ay} L${bx},${by} L${cx},${cy} L${dx},${dy} Z" fill="${theme.color.frameHeadingFill}"`;
    },
  );
}
