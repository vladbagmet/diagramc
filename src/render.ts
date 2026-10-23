import { UmlError } from './core/errors.js';
import { adviceForAll } from './qa/advice.js';
import { MAX_OUTPUT_BYTES } from './core/limits.js';
import { rasterize } from './engine/png.js';
import type { Backend } from './model/kind.js';
import type { ParsedDocument } from './model/parse.js';
import { embedFonts } from './plantuml/fonts.js';
import { renderSvg, rendererOptions, type RendererOptions } from './plantuml/runner.js';
import { checkSvg } from './qa/gates.js';

export type OutputFormat = 'svg' | 'png';

export interface RenderOptions {
  /** Backend name; the kind's first backend when omitted. */
  backend?: string | undefined;
  /** Overrides for the PlantUML runner (tests). */
  plantuml?: RendererOptions;
}

export function selectBackend(parsed: ParsedDocument, name?: string): Backend<unknown> {
  const backends = parsed.kind.backends;
  const backend = name === undefined ? backends[0] : backends.find(b => b.name === name);
  if (!backend) {
    throw new UmlError('UNSUPPORTED_BACKEND', `Kind "${parsed.kind.kind}" supports backends: ${backends.map(b => b.name).join(', ')}`, 2, {
      kind: parsed.kind.kind,
      backend: name,
      available: backends.map(b => b.name),
    });
  }
  return backend;
}

/** Renders a validated document to SVG text with the selected backend. */
export async function renderToSvg(parsed: ParsedDocument, options: RenderOptions = {}): Promise<string> {
  const backend = selectBackend(parsed, options.backend);
  let svg: string;
  if (backend.name === 'engine') {
    svg = await backend.render(parsed.model);
  } else {
    // Only now, after full validation, is the Java renderer discovered and started.
    const source = await backend.toPlantUml(parsed.model);
    const runner = options.plantuml ?? (await rendererOptions());
    const raw = (await renderSvg(source, { ...runner, diagramType: backend.diagramType })).toString('utf8');
    svg = await embedFonts(backend.postProcess ? backend.postProcess(raw, parsed.model) : raw);
  }
  if (Buffer.byteLength(svg, 'utf8') > MAX_OUTPUT_BYTES) throw new UmlError('RENDER_OUTPUT_LIMIT', 'Rendered SVG exceeds the byte limit', 3);
  return svg;
}

export async function renderDocument(parsed: ParsedDocument, format: OutputFormat, options: RenderOptions & { scale?: number } = {}): Promise<Buffer> {
  const svg = await renderToSvg(parsed, options);
  return format === 'png' ? rasterize(svg, options.scale) : Buffer.from(svg, 'utf8');
}

/**
 * A QA gate (src/qa/gates.ts) that the rendered drawing does not pass: the
 * diagram is still written, but it has a layout defect (for example a label on a
 * line) that a reader may notice. `uml render --strict` turns these into an error.
 */
export interface LayoutWarning {
  code: 'LAYOUT_QUALITY';
  gate: string;
  message: string;
  /** How many problems the gate found. */
  count: number;
  /** The first problems, as the gate reports them. */
  problems: string[];
  /** What usually helps, in terms of the model, for the kinds of problem found (src/qa/advice.ts). */
  advice: string;
}

/** Most problems listed per gate in a warning. */
const MAX_PROBLEMS = 5;

/** Runs every QA gate on a rendered SVG and turns failed gates into warnings. */
export async function layoutWarnings(svg: string, parsed: ParsedDocument, backend?: Backend<unknown>): Promise<LayoutWarning[]> {
  const report = await checkSvg(
    svg,
    parsed.texts.map(t => t.text),
  );
  const held = backend?.name === 'plantuml' ? backend.gates : undefined;
  return report.gates
    .filter(g => !g.ok && (!held || held.includes(g.gate)))
    .map(g => ({
      code: 'LAYOUT_QUALITY',
      gate: g.gate,
      message: `Layout check "${g.gate}" found ${g.failures.length} problem${g.failures.length === 1 ? '' : 's'}: ${g.failures[0]}${g.failures.length > 1 ? ` (and ${g.failures.length - 1} more)` : ''}`,
      count: g.failures.length,
      problems: g.failures.slice(0, MAX_PROBLEMS),
      advice: adviceForAll(g.gate, g.failures),
    }));
}

/** Renders like renderDocument and runs the QA gates on the drawing (a few ms). */
export async function renderChecked(
  parsed: ParsedDocument,
  format: OutputFormat,
  options: RenderOptions & { scale?: number } = {},
): Promise<{ data: Buffer; warnings: LayoutWarning[] }> {
  const svg = await renderToSvg(parsed, options);
  const warnings = await layoutWarnings(svg, parsed, selectBackend(parsed, options.backend));
  return { data: format === 'png' ? await rasterize(svg, options.scale) : Buffer.from(svg, 'utf8'), warnings };
}
