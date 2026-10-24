import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BIN, packageRoot } from './core/package.js';
import { UmlError, type Diagnostic } from './core/errors.js';
import { parseDocument, suggestKind, type ParsedDocument } from './model/parse.js';
import { kinds, findKind } from './model/registry.js';
import type { KindDefinition } from './model/kind.js';
import { renderChecked, selectBackend, type LayoutWarning, type OutputFormat } from './render.js';
import { exportDocument, formatFromExtension, formatSupport, importText, parseFormat, type FormatName } from './formats/index.js';

/**
 * The operations behind the commands, shared by the command line (src/cli.ts)
 * and the MCP server (src/mcp.ts). Each takes plain values and returns plain
 * values or throws a UmlError, so both front ends report the same results and
 * the same error objects.
 */

/** The version, binary name and install location come from the package itself (src/core/package.ts). */
export { BIN, VERSION, packageRoot } from './core/package.js';
export const SETUP_SCRIPT = fileURLToPath(new URL('scripts/setup-renderer.mjs', packageRoot));
/** The usage skill for agents, shipped in the package. */
export const SKILL_FILE = fileURLToPath(new URL(`skills/${BIN}/SKILL.md`, packageRoot));
export const SKILL_REFERENCE_FILE = fileURLToPath(new URL(`skills/${BIN}/reference.md`, packageRoot));

/** Every command of the command line, in help order. */
export const COMMANDS = ['render', 'validate', 'export', 'import', 'example', 'schema', 'kinds', 'guide', 'mcp', 'help'] as const;

/** The commands `diagramc mcp` (src/mcp.ts) offers as tools, each named `<binary>_<command>`. */
export const MCP_COMMANDS = ['kinds', 'example', 'schema', 'validate', 'render', 'export', 'import'] as const;
export type McpCommand = (typeof MCP_COMMANDS)[number];
export const mcpToolName = (command: McpCommand): string => `${BIN}_${command}`;
export const MCP_TOOLS: readonly string[] = MCP_COMMANDS.map(mcpToolName);

/** The kind named by `name`, or UNKNOWN_KIND with the nearest kind. */
export function kindArgument(name: string): KindDefinition {
  const kind = findKind(name);
  if (kind) return kind;
  const nearest = suggestKind(name);
  throw new UmlError(
    'UNKNOWN_KIND',
    `Unknown diagram kind ${JSON.stringify(name)}${nearest ? `; did you mean "${nearest}"?` : ''} Kinds: ${kinds.map(k => k.kind).join(', ')}`,
    2,
    { kind: name, available: kinds.map(k => k.kind), ...(nearest ? { suggestion: nearest } : {}) },
  );
}

export interface KindSummary {
  kind: string;
  title: string;
  summary: string;
  frameKeyword: string;
  backends: string[];
  exports: FormatName[];
  imports: FormatName[];
}

/** What `diagramc kinds` prints. */
export function kindSummaries(): KindSummary[] {
  return kinds.map(k => ({
    kind: k.kind,
    title: k.title,
    summary: k.summary,
    frameKeyword: k.frameKeyword,
    backends: k.backends.map(b => b.name),
    ...formatSupport(k.kind),
  }));
}

/** The minimal example model shipped for a kind (examples/<kind>/minimal.json), as text. */
export async function exampleText(name: string): Promise<string> {
  const kind = kindArgument(name);
  try {
    return await readFile(new URL(`examples/${kind.kind}/minimal.json`, packageRoot), 'utf8');
  } catch {
    throw new UmlError('INTERNAL_ERROR', `The example of ${kind.kind} is missing from this installation`, 3);
  }
}

/** The JSON Schema of a kind. */
export function schemaOf(name: string): object {
  return kindArgument(name).schema;
}

/** What `diagramc validate` prints for a valid document. */
export function validationResult(parsed: ParsedDocument): { valid: true; kind: string; version: number } {
  return { valid: true, kind: parsed.kind.kind, version: parsed.version };
}

/** Guide topics: the playbook itself, or the per-kind reference next to it. */
export const GUIDE_TOPICS = ['reference'] as const;

/** The usage skill (without its YAML front matter), or its per-kind reference. */
export async function guideText(topic?: string): Promise<string> {
  if (topic !== undefined && !(GUIDE_TOPICS as readonly string[]).includes(topic))
    throw new UmlError('USAGE', `Unknown guide topic ${JSON.stringify(topic)}; topics: ${GUIDE_TOPICS.join(', ')}. See ${BIN} guide --help`);
  const file = topic === 'reference' ? SKILL_REFERENCE_FILE : SKILL_FILE;
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new UmlError('INTERNAL_ERROR', `The usage guide ${file} is missing from this installation`, 3);
  }
  return text.replace(/^---\n[\s\S]*?\n---\n+/u, '');
}

/** The output format of a render: --format, or the output file's extension. */
export function renderFormat(output: string | undefined, format: string | undefined, scale: number | undefined): OutputFormat {
  if (format !== undefined && format !== 'svg' && format !== 'png') throw usage('--format must be svg or png');
  const extension = output === undefined ? undefined : (/\.(svg|png)$/iu.exec(output)?.[1]?.toLowerCase() as OutputFormat | undefined);
  if (format && extension && format !== extension)
    throw usage(`--format ${format} does not match the .${extension} extension of ${JSON.stringify(output)}; use a .${format} file name or drop --format`);
  const result = format ?? extension;
  if (!result) throw usage('Output must end in .svg or .png, or pass --format');
  if (scale !== undefined && (!Number.isFinite(scale) || scale < 1 || scale > 4)) throw usage('--scale must be a number from 1 to 4');
  if (result === 'svg' && scale !== undefined) throw usage('--scale only applies to PNG output');
  return result;
}

export interface RenderRequest {
  format: OutputFormat;
  backend?: string | undefined;
  scale?: number | undefined;
  /** Turn layout warnings into a LAYOUT_QUALITY error (exit 5). */
  strict?: boolean | undefined;
}

/** Validates the model text, draws it and runs the layout checks. */
export async function renderText(text: string, request: RenderRequest): Promise<{ data: Buffer; warnings: LayoutWarning[] }> {
  const parsed = parseDocument(text);
  selectBackend(parsed, request.backend);
  // Never discover or launch a renderer until the entire input has been validated.
  const result = await renderChecked(parsed, request.format, {
    backend: request.backend,
    ...(request.scale === undefined ? {} : { scale: request.scale }),
  });
  if (request.strict && result.warnings.length > 0) {
    const { warnings } = result;
    throw new UmlError(
      'LAYOUT_QUALITY',
      `The drawing fails ${warnings.length} layout check${warnings.length === 1 ? '' : 's'} (nothing was written): ${warnings.map(w => w.message).join(' ')}`,
      5,
      { warnings },
    );
  }
  return result;
}

/** The export format: the named one, or the one the output file's extension names. */
export function exportFormat(to: string | undefined, output: string | undefined): FormatName {
  const format = to === undefined ? (output === undefined ? undefined : formatFromExtension(output)) : parseFormat(to, '--to');
  if (!format) throw usage('Missing --to plantuml or --to mermaid (or an -o file ending in .puml or .mmd)');
  return format;
}

/** Validates the model text and writes it as PlantUML or Mermaid text. */
export function exportText(text: string, format: FormatName): { text: string; warnings: Diagnostic[] } {
  return exportDocument(parseDocument(text), format);
}

/** The import format: the named one, or the one the input file's extension names. */
export function importFormat(from: string | undefined, input: string | undefined): FormatName {
  const format = from === undefined ? (input === undefined || input === '-' ? undefined : formatFromExtension(input)) : parseFormat(from, '--from');
  if (!format)
    throw usage(
      input === undefined
        ? 'Text without a file name needs --from plantuml or --from mermaid'
        : input === '-'
          ? 'Reading stdin needs --from plantuml or --from mermaid'
          : `Cannot tell the format of ${JSON.stringify(input)} from its extension; pass --from plantuml or --from mermaid`,
    );
  return format;
}

/** Reads PlantUML or Mermaid text into a validated model. */
export function importModel(text: string, format: FormatName, kind?: string): Record<string, unknown> {
  if (kind !== undefined) kindArgument(kind);
  return importText(text, format, kind).model;
}

export function usage(message: string): UmlError {
  return new UmlError('USAGE', `${message}${message.endsWith('?') ? '' : '.'} See ${BIN} --help`);
}
