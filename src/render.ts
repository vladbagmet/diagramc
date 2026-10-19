import { UmlError } from './core/errors.js';
import { MAX_OUTPUT_BYTES } from './core/limits.js';
import { rasterize } from './engine/png.js';
import type { Backend } from './model/kind.js';
import type { ParsedDocument } from './model/parse.js';
import { embedFonts } from './plantuml/fonts.js';
import { renderSvg, rendererOptions, type RendererOptions } from './plantuml/runner.js';

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
    throw new UmlError('UNSUPPORTED_BACKEND', `Kind "${parsed.kind.kind}" supports backends: ${backends.map(b => b.name).join(', ')}`, 2,
      { kind: parsed.kind.kind, backend: name, available: backends.map(b => b.name) });
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
    const runner = options.plantuml ?? await rendererOptions();
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
