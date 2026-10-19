#!/usr/bin/env node
import { UmlError } from './core/errors.js';
import { readInput, writeOutput } from './core/io.js';
import { MAX_INPUT_BYTES } from './core/limits.js';
import { parseDocument } from './model/parse.js';
import { kinds, findKind } from './model/registry.js';
import { renderDocument, selectBackend, type OutputFormat } from './render.js';

const VERSION = '0.2.0';

const help = `uml ${VERSION} - validated JSON UML models to SVG or PNG, offline

Usage:
  uml render <model.json|-> -o <diagram.svg|diagram.png> [options]
  uml validate <model.json|->
  uml schema <kind>
  uml kinds

Commands:
  render     Validate, then draw the diagram. Output format follows the -o
             extension (.svg or .png) unless --format is given.
  validate   Validate only. Prints {"valid":true,...} on stdout.
  schema     Print the JSON Schema of a diagram kind (draft-07).
  kinds      Print the supported diagram kinds as JSON.

Render options:
  -o, --output <path>       Output file; its parent directory must exist.
  --format <svg|png>        Output format (default: from the -o extension).
  --backend <name>          Renderer, when a kind has several (see uml kinds).
  --scale <1-4>             PNG pixel density (default 2).

Input: UTF-8 JSON, at most ${MAX_INPUT_BYTES / 1024} KiB: { "kind": "<kind>", "title"?: "...", ... }.
Documents without "kind" in the v1 format (classes + relationships) are class diagrams.
Generalization points from the specific to the general classifier.

Output is replaced atomically only after a successful render.
Errors: one JSON object on stderr, {"error":{"code","message","path"?,...}};
exit 2 input/usage, 3 renderer, 4 file I/O, 130/143 interrupted (SIGINT/SIGTERM).
PlantUML kinds need: npm run setup:renderer, or trusted UML_JAVA and PLANTUML_JAR.
`;

const usage = (message: string): UmlError => new UmlError('USAGE', `${message}. See uml --help`);

function isInput(arg: string | undefined): arg is string {
  return !!arg && (arg === '-' || !arg.startsWith('-'));
}

async function render(args: string[]): Promise<void> {
  let input: string | undefined, output: string | undefined, format: OutputFormat | undefined, backend: string | undefined, scale: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || (next.startsWith('-') && next !== '-')) throw usage(`Missing value for ${arg}`);
      return next;
    };
    if (arg === '-o' || arg === '--output') { if (output !== undefined) throw usage('Duplicate -o'); output = value(); }
    else if (arg === '--format') {
      const f = value();
      if (f !== 'svg' && f !== 'png') throw usage('--format must be svg or png');
      format = f;
    } else if (arg === '--backend') backend = value();
    else if (arg === '--scale') {
      scale = Number(value());
      if (!Number.isFinite(scale) || scale < 1 || scale > 4) throw usage('--scale must be a number from 1 to 4');
    } else if (input === undefined && isInput(arg)) input = arg;
    else throw usage(`Unexpected argument ${JSON.stringify(arg)}`);
  }
  if (!input || !output) throw usage('Usage: uml render <model.json|-> -o <diagram.svg|diagram.png>');
  const extension = /\.(svg|png)$/iu.exec(output)?.[1]?.toLowerCase() as OutputFormat | undefined;
  format ??= extension;
  if (!format) throw usage('Output must end in .svg or .png, or pass --format');
  if (format === 'svg' && scale !== undefined) throw usage('--scale only applies to PNG output');
  const parsed = parseDocument(await readInput(input));
  selectBackend(parsed, backend);
  // Never discover or launch a renderer until the entire input has been validated.
  const data = await renderDocument(parsed, format, { backend, ...(scale === undefined ? {} : { scale }) });
  await writeOutput(output, data);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, ...rest] = args;
  if (command === undefined) throw usage('Missing command');
  if (command === '--help' || command === '-h' || command === 'help' || rest.includes('--help') || rest.includes('-h')) {
    if (args.length > 1 && !['render', 'validate', 'schema', 'kinds', 'help'].includes(command)) throw usage(`Unknown command ${JSON.stringify(command)}`);
    process.stdout.write(help);
    return;
  }
  if (command === '--version') {
    if (rest.length) throw usage('--version takes no arguments');
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  switch (command) {
    case 'render':
      return render(rest);
    case 'validate': {
      if (rest.length !== 1 || !isInput(rest[0])) throw usage('Usage: uml validate <model.json|->');
      const parsed = parseDocument(await readInput(rest[0]));
      process.stdout.write(JSON.stringify({ valid: true, kind: parsed.kind.kind, version: parsed.version }) + '\n');
      return;
    }
    case 'schema': {
      if (rest.length !== 1) throw usage('Usage: uml schema <kind>');
      const kind = findKind(rest[0]!);
      if (!kind) throw new UmlError('UNKNOWN_KIND', `Unknown diagram kind ${JSON.stringify(rest[0])}; run \`uml kinds\``, 2, { kind: rest[0], available: kinds.map(k => k.kind) });
      process.stdout.write(JSON.stringify(kind.schema, null, 2) + '\n');
      return;
    }
    case 'kinds': {
      if (rest.length) throw usage('Usage: uml kinds');
      process.stdout.write(JSON.stringify(kinds.map(k => ({
        kind: k.kind, title: k.title, summary: k.summary, frameKeyword: k.frameKeyword, backends: k.backends.map(b => b.name),
      })), null, 2) + '\n');
      return;
    }
    default:
      throw usage(`Unknown command ${JSON.stringify(command)}`);
  }
}

main().catch((error: unknown) => {
  const failure = error instanceof UmlError ? error : new UmlError('INTERNAL_ERROR', 'Unexpected internal failure', 3);
  if (!(error instanceof UmlError) && process.env.UML_DEBUG) process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.stderr.write(JSON.stringify({ error: failure }) + '\n');
  process.exitCode = failure.exitCode;
});
