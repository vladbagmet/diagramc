#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UmlError } from './core/errors.js';
import { readInput, writeOutput } from './core/io.js';
import { MAX_INPUT_BYTES } from './core/limits.js';
import { parseDocument, suggestKind } from './model/parse.js';
import { kinds, findKind } from './model/registry.js';
import type { KindDefinition } from './model/kind.js';
import { renderChecked, selectBackend, type OutputFormat } from './render.js';

const VERSION = '0.2.0';

const help = `uml ${VERSION} - validated JSON UML models to SVG or PNG, offline

Usage:
  uml render <model.json|-> -o <diagram.svg|diagram.png> [options]
  uml validate <model.json|->
  uml example <kind>
  uml schema <kind>
  uml kinds

Commands:
  render     Validate, then draw the diagram and check its layout. Output format
             follows the -o extension (.svg or .png) unless --format is given.
  validate   Validate only. Prints {"valid":true,"kind":...,"version":...} on stdout.
  example    Print a minimal valid model of a kind: a starting point to edit.
  schema     Print the JSON Schema of a kind (draft-07): every property, with
             descriptions and allowed values.
  kinds      Print the 14 supported diagram kinds as JSON.

Render options:
  -o, --output <path>       Output file; its parent directory must exist.
  --format <svg|png>        Output format (default: from the -o extension).
  --backend <name>          Renderer, when a kind has several (see uml kinds).
  --scale <1-4>             PNG pixel density (default 2).
  --strict                  Fail (exit 5, LAYOUT_QUALITY) instead of warning when
                            the drawing fails a layout check; nothing is written.

Writing a model: start from \`uml example <kind>\` and look up properties with
\`uml schema <kind>\`. Input is UTF-8 JSON, at most ${MAX_INPUT_BYTES / 1024} KiB:
{ "kind": "<kind>", "title"?: "...", ... }. Elements and relationships refer to
each other by "id"; relationships go "from" one element "to" another (for a
generalization, from the specific to the general element). Text is drawn
literally; write keywords without guillemets and guards without brackets.
Documents without "kind" in the v1 format (classes + relationships) are class diagrams.

Output is replaced atomically only after a successful render (an existing device
or pipe such as /dev/null is written directly). On success render
prints nothing, or, when the drawing fails a layout check, one JSON object on
stderr: {"warnings":[{"code":"LAYOUT_QUALITY","gate","message","count","problems",
"advice"}]}.
Errors: one JSON object on stderr, {"error":{"code","message","path"?,"details"?,
"diagnostics"?}}; "diagnostics" lists every problem with its JSON Pointer path,
the message summarises them, and suggestions are in each diagnostic's details.
Exit codes: 0 success (warnings possible), 2 invalid input or usage, 3 renderer,
4 file I/O, 5 layout check failed under --strict, 130/143 interrupted.
PlantUML kinds need: npm run setup:renderer, or trusted UML_JAVA and PLANTUML_JAR.
`;

const usage = (message: string): UmlError => new UmlError('USAGE', `${message}${message.endsWith('?') ? '' : '.'} See uml --help`);

function isInput(arg: string | undefined): arg is string {
  return !!arg && (arg === '-' || !arg.startsWith('-'));
}

/** The kind named on the command line, or UNKNOWN_KIND with the nearest kind. */
function kindArgument(name: string): KindDefinition {
  const kind = findKind(name);
  if (kind) return kind;
  const nearest = suggestKind(name);
  throw new UmlError('UNKNOWN_KIND', `Unknown diagram kind ${JSON.stringify(name)}${nearest ? `; did you mean "${nearest}"?` : ''} Kinds: ${kinds.map(k => k.kind).join(', ')}`, 2,
    { kind: name, available: kinds.map(k => k.kind), ...(nearest ? { suggestion: nearest } : {}) });
}

async function render(args: string[]): Promise<void> {
  let input: string | undefined, output: string | undefined, format: OutputFormat | undefined, backend: string | undefined, scale: number | undefined, strict = false;
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
    } else if (arg === '--strict') strict = true;
    else if (input === undefined && isInput(arg)) input = arg;
    else throw usage(`Unexpected argument ${JSON.stringify(arg)}`);
  }
  if (!input || !output) throw usage('Usage: uml render <model.json|-> -o <diagram.svg|diagram.png>');
  const extension = /\.(svg|png)$/iu.exec(output)?.[1]?.toLowerCase() as OutputFormat | undefined;
  if (format && extension && format !== extension) throw usage(`--format ${format} does not match the .${extension} extension of ${JSON.stringify(output)}; use a .${format} file name or drop --format`);
  format ??= extension;
  if (!format) throw usage('Output must end in .svg or .png, or pass --format');
  if (format === 'svg' && scale !== undefined) throw usage('--scale only applies to PNG output');
  const parsed = parseDocument(await readInput(input));
  selectBackend(parsed, backend);
  // Never discover or launch a renderer until the entire input has been validated.
  const { data, warnings } = await renderChecked(parsed, format, { backend, ...(scale === undefined ? {} : { scale }) });
  if (strict && warnings.length) {
    throw new UmlError('LAYOUT_QUALITY', `The drawing fails ${warnings.length} layout check${warnings.length === 1 ? '' : 's'} (nothing was written): ${warnings.map(w => w.message).join(' ')}`, 5, { warnings });
  }
  await writeOutput(output, data);
  if (warnings.length) process.stderr.write(JSON.stringify({ warnings }) + '\n');
}

/** The minimal example model shipped for a kind (examples/<kind>/minimal.json). */
async function example(name: string): Promise<string> {
  const kind = kindArgument(name);
  const file = fileURLToPath(new URL(`../examples/${kind.kind}/minimal.json`, import.meta.url));
  try { return await readFile(file, 'utf8'); }
  catch { throw new UmlError('INTERNAL_ERROR', `The example of ${kind.kind} is missing from this installation`, 3); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, ...rest] = args;
  if (command === undefined) throw usage('Missing command');
  const commands = ['render', 'validate', 'example', 'schema', 'kinds', 'help'];
  if (command === '--help' || command === '-h' || command === 'help' || rest.includes('--help') || rest.includes('-h')) {
    if (args.length > 1 && !commands.includes(command)) throw usage(`Unknown command ${JSON.stringify(command)}`);
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
    case 'example': {
      if (rest.length !== 1) throw usage(`Usage: uml example <kind>; kinds: ${kinds.map(k => k.kind).join(', ')}`);
      process.stdout.write(await example(rest[0]!));
      return;
    }
    case 'schema': {
      if (rest.length !== 1) throw usage('Usage: uml schema <kind>');
      process.stdout.write(JSON.stringify(kindArgument(rest[0]!).schema, null, 2) + '\n');
      return;
    }
    case 'kinds': {
      if (rest.length) throw usage('Usage: uml kinds');
      process.stdout.write(JSON.stringify(kinds.map(k => ({
        kind: k.kind, title: k.title, summary: k.summary, frameKeyword: k.frameKeyword, backends: k.backends.map(b => b.name),
      })), null, 2) + '\n');
      return;
    }
    default: {
      const nearest = commands.find(c => c.startsWith(command.toLowerCase().slice(0, 3)));
      throw usage(`Unknown command ${JSON.stringify(command)}${nearest ? `; did you mean "${nearest}"?` : ''}`);
    }
  }
}

main().catch((error: unknown) => {
  const failure = error instanceof UmlError ? error : new UmlError('INTERNAL_ERROR', 'Unexpected internal failure', 3);
  if (!(error instanceof UmlError) && process.env.UML_DEBUG) process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.stderr.write(JSON.stringify({ error: failure }) + '\n');
  process.exitCode = failure.exitCode;
});
