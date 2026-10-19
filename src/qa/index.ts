import { parseDocument } from '../model/parse.js';
import { renderToSvg, type RenderOptions } from '../render.js';
import { checkSvg, type QaReport } from './gates.js';

export { checkSvg, runGates, formatReport, GATES, ENGINE_ONLY_GATES, type QaReport, type GateResult } from './gates.js';
export { inspectSvg, type Scene } from './inspect.js';

/**
 * Parses, validates and renders a document, then runs every QA gate on the
 * result. The one call tests and the gallery use for each fixture.
 */
export async function renderAndCheck(document: unknown, options: RenderOptions = {}): Promise<{ svg: string; report: QaReport; ms: number }> {
  const parsed = parseDocument(typeof document === 'string' ? document : JSON.stringify(document));
  const started = performance.now();
  const svg = await renderToSvg(parsed, options);
  const ms = performance.now() - started;
  return { svg, ms, report: await checkSvg(svg, parsed.texts.map(t => t.text)) };
}
