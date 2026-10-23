#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UmlError } from './core/errors.js';
import { readInput, writeOutput } from './core/io.js';
import { MAX_INPUT_BYTES } from './core/limits.js';
import { parseDocument, suggestKind } from './model/parse.js';
import { kinds, findKind } from './model/registry.js';
import type { KindDefinition } from './model/kind.js';
import { renderChecked, selectBackend, type OutputFormat } from './render.js';
import { exportDocument, formatFromExtension, formatSupport, importText, parseFormat, type FormatName } from './formats/index.js';

/** The version and install location come from the package itself, so they never drift. */
const packageRoot = new URL('../', import.meta.url);
const VERSION = (JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as { version: string }).version;
const SETUP_SCRIPT = fileURLToPath(new URL('scripts/setup-renderer.mjs', packageRoot));

/** The kind names, wrapped to the help text's 80 columns. */
const kindList = (): string => {
  const lines = [''];
  for (const { kind } of kinds) {
    const last = lines.length - 1;
    if (lines[last] && lines[last]!.length + kind.length > 74) { lines[last] += ','; lines.push(kind); }
    else lines[last] += `${lines[last] ? ', ' : ''}${kind}`;
  }
  return lines.join('\n  ');
};
const plantumlKinds = (): string => kinds.filter(k => k.backends[0]?.name === 'plantuml').map(k => k.kind).join(', ');

const renderer = (): string => `PlantUML kinds (${plantumlKinds()}, and class with --backend
plantuml) need a local Java renderer, set up once with
  node ${SETUP_SCRIPT}
(npm run setup:renderer in a source checkout), or set both UML_JAVA and
PLANTUML_JAR to a trusted Java and PlantUML jar. The other kinds need nothing.`;

const warningLine = '{"warnings":[{"code":"LAYOUT_QUALITY","gate","message","count","problems","advice"}]}';

const errorsAndExits = `Errors: one JSON object on stderr, {"error":{"code","message","path"?,"details"?,
"diagnostics"?}}, and no output is written. "diagnostics" lists every problem
with its JSON Pointer path, "message" summarises them, and corrections are in
each diagnostic's details (suggestion, swap).
Exit codes: 0 success (warnings possible), 2 invalid input or usage, 3 renderer,
4 file I/O, 5 layout check failed under --strict, 130/143 interrupted.`;

const backendOption = `  --backend <engine|plantuml>
                            Renderer, when a kind has several (only class has
                            both); the default is the first one uml kinds lists.`;

const help = (): string => `uml ${VERSION} - validated JSON UML models to SVG or PNG, offline

Usage:
  uml render <model.json|-> -o <diagram.svg|diagram.png> [options]
  uml validate <model.json|->
  uml export <model.json|-> --to <plantuml|mermaid> [-o <file>]
  uml import <diagram.puml|diagram.mmd|-> [--from <plantuml|mermaid>] [-o <model.json>]
  uml example <kind>
  uml schema <kind>
  uml kinds
  uml <command> --help      Details of one command
  uml --version

Commands:
  render     Validate, then draw the diagram and check its layout. Output format
             follows the -o extension (.svg or .png) unless --format is given.
  validate   Validate only. Prints {"valid":true,"kind":...,"version":...} on stdout.
  export     Validate, then write the model as PlantUML (every kind) or Mermaid
             text (class, sequence, state-machine, activity, use-case).
  import     Read PlantUML (class, sequence, state-machine, use-case, activity)
             or Mermaid (class, sequence, state-machine) text into a validated
             model.
  example    Print a minimal valid model of a kind: a starting point to edit.
  schema     Print the JSON Schema of a kind (draft-07): every property, with
             descriptions and allowed values.
  kinds      Print the ${kinds.length} supported diagram kinds, their backends and
             the formats each exports to and imports from, as JSON.

Render options:
  -o, --output <path>       Output file; its parent directory must exist.
  --format <svg|png>        Output format (default: from the -o extension).
${backendOption}
  --scale <1-4>             PNG pixel density (default 2).
  --strict                  Fail (exit 5, LAYOUT_QUALITY) instead of warning when
                            the drawing fails a layout check; nothing is written.

Kinds:
  ${kindList()}.

Writing a model: start from \`uml example <kind>\` and look up properties with
\`uml schema <kind>\`. Input is UTF-8 JSON, at most ${MAX_INPUT_BYTES / 1024} KiB:
{ "kind": "<kind>", "title"?: "...", ... }. Elements and relationships refer to
each other by "id"; relationships go "from" one element "to" another (for a
generalization, from the specific to the general element). Text is drawn
literally; write keywords without guillemets and guards without brackets.
Documents without "kind" in the v1 format (classes + relationships) are class diagrams.

Output is replaced atomically only after a successful render (an existing device
or pipe such as /dev/null is written directly). On success render prints
nothing, or, when the drawing fails a layout check, one JSON object on stderr
(the file is still written and the exit code is 0):
${warningLine}
${errorsAndExits}

${renderer()}
`;

const commandHelp: Record<string, () => string> = {
  render: () => `Usage: uml render <model.json|-> -o <diagram.svg|diagram.png> [options]

Validates the model ("-" reads it from stdin), draws it with the kind's backend,
runs the layout checks on the drawing and writes the output.

Options:
  -o, --output <path>       Output file (required); its parent directory must
                            exist. It is replaced atomically, only after a
                            successful render; an existing device or pipe
                            (/dev/null, /dev/stdout) is written directly.
  --format <svg|png>        Output format (default: from the -o extension, which
                            must then be .svg or .png).
${backendOption}
  --scale <1-4>             PNG pixel density (default 2); PNG output only.
  --strict                  Fail (exit 5, LAYOUT_QUALITY, the findings in
                            details.warnings) instead of warning when the drawing
                            fails a layout check; nothing is written.

On success nothing is printed on stdout. When the drawing fails a layout check,
the file is still written, the exit code is 0, and stderr carries one JSON object:
${warningLine}
${errorsAndExits}

${renderer()}
`,
  validate: () => `Usage: uml validate <model.json|->

Validates the model ("-" reads it from stdin) against its kind's schema and
rules, without drawing it. On success prints one line on stdout, for example
{"valid":true,"kind":"class","version":2} (version 1 for the v1 class format).
${errorsAndExits}
`,
  export: () => `Usage: uml export <model.json|-> --to <plantuml|mermaid> [-o <file>]

Validates the model ("-" reads it from stdin) and writes it as PlantUML or
Mermaid text, on stdout or to the -o file (replaced atomically). The text is
plain and readable: model IDs become aliases ("-" in an ID becomes "_"), and
only characters that would change the meaning of a line are escaped (PlantUML
<U+XXXX>, Mermaid #NN;), so any text reads back unchanged.

Options:
  --to <plantuml|mermaid>   Target format (default: from the -o extension,
                            .puml/.plantuml or .mmd/.mermaid).
  -o, --output <path>       Output file; its parent directory must exist.

PlantUML: all ${kinds.length} kinds. Mermaid: ${kinds.filter(k => formatSupport(k.kind).exports.includes('mermaid')).map(k => k.kind).join(', ')};
the others fail with UNSUPPORTED_EXPORT (exit 2), naming the formats that work.
Constructs the format cannot express are reported, the export still succeeds:
one JSON object on stderr,
{"warnings":[{"code":"EXPORT_LOSSY","path","message"}]}, where path is the
JSON Pointer of the construct. docs/formats.md has the full mapping.
${errorsAndExits}
`,
  import: () => `Usage: uml import <diagram.puml|diagram.mmd|-> [--from <plantuml|mermaid>] [-o <model.json>]

Reads PlantUML or Mermaid text ("-" reads stdin), converts it to a model and
validates it like uml validate. Prints the model JSON on stdout, or writes it to
the -o file (replaced atomically).

Options:
  --from <plantuml|mermaid> Source format (default: from the file extension,
                            .puml/.plantuml/.pu/.iuml/.wsd or .mmd/.mermaid;
                            required for stdin).
  --kind <kind>             The diagram kind, when the text does not make it
                            clear (default: inferred from the content for
                            PlantUML, from the header for Mermaid).
  -o, --output <path>       Output file; its parent directory must exist.

PlantUML: class, sequence, state-machine, use-case, activity. Mermaid: class
(classDiagram), sequence (sequenceDiagram), state-machine (stateDiagram-v2).
Only the part of each syntax that maps onto the model is read; nothing is
guessed. Every line that cannot be read is reported at once in "diagnostics",
each with code UNSUPPORTED_SYNTAX (valid in the format, but not in the model)
or MALFORMED_LINE, path "/lines/<n>" and details {"line","text"}. Lines that
only change presentation (skinparam, hide, style, classDef, ...) are skipped.
A model that reads but breaks a rule fails with IMPORT_INVALID; its
diagnostics point into the model, which is in details.model.
${errorsAndExits}
`,
  example: () => `Usage: uml example <kind>

Prints a minimal valid model of the kind on stdout, a starting point to edit.
Kinds:
  ${kindList()}.
An unknown kind fails with UNKNOWN_KIND (exit 2) and the nearest kind.
`,
  schema: () => `Usage: uml schema <kind>

Prints the JSON Schema (draft-07) of the kind on stdout: every property with its
description and allowed values. Properties the schema does not list are errors.
Kinds:
  ${kindList()}.
An unknown kind fails with UNKNOWN_KIND (exit 2) and the nearest kind.
`,
  kinds: () => `Usage: uml kinds

Prints the ${kinds.length} supported diagram kinds as a JSON array on stdout, each
{"kind","title","summary","frameKeyword","backends","exports","imports"}. The
first backend is the default: "engine" is the built-in layout engine,
"plantuml" the local PlantUML renderer (see uml --help). "exports" and
"imports" list the text formats (plantuml, mermaid) of uml export and uml import.
`,
};

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

/** Options of export and import: one input, -o, and the named options with a value. */
function exchangeArgs(args: string[], named: readonly string[]): { input?: string; output?: string; values: Map<string, string> } {
  let input: string | undefined, output: string | undefined;
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || (next.startsWith('-') && next !== '-')) throw usage(`Missing value for ${arg}`);
      return next;
    };
    if (arg === '-o' || arg === '--output') { if (output !== undefined) throw usage('Duplicate -o'); output = value(); }
    else if (named.includes(arg)) { if (values.has(arg)) throw usage(`Duplicate ${arg}`); values.set(arg, value()); }
    else if (input === undefined && isInput(arg)) input = arg;
    else throw usage(`Unexpected argument ${JSON.stringify(arg)}`);
  }
  return { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }), values };
}

async function exportCommand(args: string[]): Promise<void> {
  const { input, output, values } = exchangeArgs(args, ['--to']);
  if (!input) throw usage('Usage: uml export <model.json|-> --to <plantuml|mermaid> [-o <file>]');
  const named = values.get('--to');
  const format: FormatName | undefined = named === undefined ? (output === undefined ? undefined : formatFromExtension(output)) : parseFormat(named, '--to');
  if (!format) throw usage('Missing --to plantuml or --to mermaid (or an -o file ending in .puml or .mmd)');
  const parsed = parseDocument(await readInput(input));
  const { text, warnings } = exportDocument(parsed, format);
  if (output === undefined) process.stdout.write(text);
  else await writeOutput(output, Buffer.from(text, 'utf8'));
  if (warnings.length) process.stderr.write(JSON.stringify({ warnings }) + '\n');
}

async function importCommand(args: string[]): Promise<void> {
  const { input, output, values } = exchangeArgs(args, ['--from', '--kind']);
  if (!input) throw usage('Usage: uml import <diagram.puml|diagram.mmd|-> [--from <plantuml|mermaid>] [-o <model.json>]');
  const named = values.get('--from');
  const format: FormatName | undefined = named === undefined ? formatFromExtension(input) : parseFormat(named, '--from');
  if (!format) throw usage(input === '-' ? 'Reading stdin needs --from plantuml or --from mermaid' : `Cannot tell the format of ${JSON.stringify(input)} from its extension; pass --from plantuml or --from mermaid`);
  const kind = values.get('--kind');
  if (kind !== undefined) kindArgument(kind);
  const { model } = importText(await readInput(input), format, kind);
  const text = JSON.stringify(model, null, 2) + '\n';
  if (output === undefined) process.stdout.write(text);
  else await writeOutput(output, Buffer.from(text, 'utf8'));
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
  const commands = ['render', 'validate', 'export', 'import', 'example', 'schema', 'kinds', 'help'];
  const asksHelp = command === '--help' || command === '-h' || command === 'help';
  if (asksHelp || rest.includes('--help') || rest.includes('-h')) {
    // `uml help render`, `uml --help render` and `uml render --help` show the render help.
    const topic = asksHelp ? rest[0] : command;
    if (asksHelp && rest.length > 1) throw usage('Usage: uml help [command]');
    if (topic !== undefined && !commands.includes(topic)) throw usage(`Unknown command ${JSON.stringify(topic)}`);
    const specific = topic === undefined ? undefined : commandHelp[topic];
    process.stdout.write(specific ? specific() : help());
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
    case 'export':
      return exportCommand(rest);
    case 'import':
      return importCommand(rest);
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
        ...formatSupport(k.kind),
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
