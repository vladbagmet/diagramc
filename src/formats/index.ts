import { UmlError, failValidation, type Diagnostic } from '../core/errors.js';
import { BIN } from '../core/package.js';
import { parseDocument, type ParsedDocument } from '../model/parse.js';
import { kinds } from '../model/registry.js';
import { readMermaid } from './mermaid/text.js';
import { mermaidFormats } from './mermaid/index.js';
import { plantumlFormats } from './plantuml/index.js';
import { readPlantUml } from './plantuml/text.js';
import { FORMATS, Losses, Problems, type FormatName, type KindFormat, type SourceLine } from './types.js';

export { FORMATS, type FormatName } from './types.js';

/** Every kind mapping, per format. A kind missing from a list cannot be exported to that format. */
const registry: Record<FormatName, readonly KindFormat[]> = { plantuml: plantumlFormats, mermaid: mermaidFormats };

const formatTitle: Record<FormatName, string> = { plantuml: 'PlantUML', mermaid: 'Mermaid' };

/** Formats a kind exports to and imports from, for `diagramc kinds`. */
export function formatSupport(kind: string): { exports: FormatName[]; imports: FormatName[] } {
  return {
    exports: FORMATS.filter(f => registry[f].some(k => k.kind === kind)),
    imports: FORMATS.filter(f => registry[f].some(k => k.kind === kind && k.import !== undefined)),
  };
}

/** File extensions that name a format. */
export function formatFromExtension(path: string): FormatName | undefined {
  const extension = /\.([A-Za-z]+)$/u.exec(path)?.[1]?.toLowerCase();
  if (extension === 'puml' || extension === 'plantuml' || extension === 'pu' || extension === 'iuml' || extension === 'wsd') return 'plantuml';
  if (extension === 'mmd' || extension === 'mermaid') return 'mermaid';
  return undefined;
}

export function parseFormat(value: string, option: string): FormatName {
  const name = value.toLowerCase();
  if (name === 'plantuml' || name === 'mermaid') return name;
  throw new UmlError('USAGE', `${option} must be plantuml or mermaid, not ${JSON.stringify(value)}. See ${BIN} --help`);
}

/** A validated model as text in `format`, with a warning for every construct the format cannot carry. */
export function exportDocument(parsed: ParsedDocument, format: FormatName): { text: string; warnings: Diagnostic[] } {
  const mapping = registry[format].find(k => k.kind === parsed.kind.kind);
  if (!mapping) {
    const working = FORMATS.filter(f => registry[f].some(k => k.kind === parsed.kind.kind));
    throw new UmlError(
      'UNSUPPORTED_EXPORT',
      `${formatTitle[format]} cannot express a ${parsed.kind.title.toLowerCase()} faithfully, so ${parsed.kind.kind} models are not exported to ${format}; ${working.length > 0 ? `export it with --to ${working.join(' or --to ')}` : 'no text format supports this kind'}`,
      2,
      { kind: parsed.kind.kind, format, formats: working },
    );
  }
  const losses = new Losses(format);
  const text = mapping.export(parsed.model, losses);
  return { text, warnings: losses.warnings };
}

/** Kinds `format` can import, in `diagramc kinds` order. */
const importable = (format: FormatName): KindFormat[] => registry[format].filter(k => k.import !== undefined);

/**
 * Text in `format` -> a validated model document. Every unsupported or malformed
 * line is reported at once (UNSUPPORTED_SYNTAX, MALFORMED_LINE with the line
 * number); the resulting model then passes the same validation as `diagramc validate`.
 */
export function importText(text: string, format: FormatName, kindName?: string): { model: Record<string, unknown>; parsed: ParsedDocument } {
  const problems = new Problems();
  const read = format === 'plantuml' ? readPlantUml(text, problems) : readMermaid(text, problems);
  const candidates = importable(format);
  let mapping: KindFormat | undefined;
  if (kindName === undefined) {
    mapping = detect(read, format, candidates, problems);
  } else {
    mapping = candidates.find(k => k.kind === kindName);
    if (!mapping) {
      const known = kinds.some(k => k.kind === kindName);
      throw new UmlError(
        known ? 'UNSUPPORTED_IMPORT' : 'UNKNOWN_KIND',
        known
          ? `${kindName} models are not imported from ${format}; ${format} imports ${candidates.map(k => k.kind).join(', ')}`
          : `Unknown diagram kind ${JSON.stringify(kindName)}; ${format} imports ${candidates.map(k => k.kind).join(', ')}`,
        2,
        { kind: kindName, format, kinds: candidates.map(k => k.kind) },
      );
    }
  }
  if (!mapping) {
    if (problems.list.length > 0) failValidation(problems.list);
    throw new UmlError(
      'UNSUPPORTED_IMPORT',
      `Could not tell which diagram kind this ${formatTitle[format]} text is; ${format} imports ${candidates.map(k => k.kind).join(', ')}. Pass --kind <kind>`,
      2,
      { format, kinds: candidates.map(k => k.kind) },
    );
  }
  const model = mapping.import!(read, problems);
  if (problems.list.length > 0) failValidation(problems.list);
  try {
    return { model, parsed: parseDocument(JSON.stringify(model)) };
  } catch (error) {
    if (!(error instanceof UmlError) || !error.diagnostics) throw error;
    // Paths point into the imported model, which the error carries so they can be followed.
    throw new UmlError(
      'IMPORT_INVALID',
      `The ${formatTitle[format]} text was read, but the ${mapping.kind} model it describes is not valid: ${error.message}`,
      2,
      { kind: mapping.kind, model },
      error.path,
      error.diagnostics,
    );
  }
}

function detect(lines: readonly SourceLine[], format: FormatName, candidates: readonly KindFormat[], problems: Problems): KindFormat | undefined {
  if (format === 'mermaid') {
    // The header names the diagram type; readMermaid reports a missing or unknown header.
    const header = lines[0]?.text.split(/\s/u, 1)[0];
    const found = candidates.find(k => k.detect!(lines.slice(0, 1)) > 0);
    if (!found && header !== undefined) unsupportedHeader(lines[0]!, header, problems, candidates);
    return found;
  }
  const scored = candidates
    .map(k => ({ k, score: k.detect!(lines) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return undefined;
  return scored[0]!.k;
}

function unsupportedHeader(line: SourceLine, header: string, problems: Problems, candidates: readonly KindFormat[]): void {
  problems.unsupported(
    line,
    `"${header}" diagrams are not imported; Mermaid import reads ${candidates.map(k => k.kind).join(', ')} (classDiagram, sequenceDiagram, stateDiagram-v2)`,
  );
}
