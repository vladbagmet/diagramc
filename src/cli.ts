#!/usr/bin/env node
import { UmlError } from './core/errors.js';
import { readInput, writeOutput } from './core/io.js';
import { MAX_INPUT_BYTES } from './core/limits.js';
import { parseDocument } from './model/parse.js';
import { kinds } from './model/registry.js';
import { formatSupport, type FormatName } from './formats/index.js';
import {
  COMMANDS,
  BIN,
  SETUP_SCRIPT,
  SKILL_FILE,
  VERSION,
  exampleText,
  exportFormat,
  exportText,
  guideText,
  importFormat,
  importModel,
  kindArgument,
  kindSummaries,
  renderFormat,
  renderText,
  schemaOf,
  usage,
  validationResult,
} from './commands.js';
import { MCP_TOOLS, mcpToolName } from './commands.js';

/** The kind names, wrapped to the help text's 80 columns. */
const kindList = (): string => {
  const lines = [''];
  for (const { kind } of kinds) {
    const last = lines.length - 1,
      line = lines[last]!;
    if (line && line.length + kind.length > 74) {
      lines[last] = `${line},`;
      lines.push(kind);
    } else lines[last] = `${line}${line ? ', ' : ''}${kind}`;
  }
  return lines.join('\n  ');
};
/** Words wrapped to `width` columns, continuation lines indented by `indent`. */
const wrap = (text: string, indent: string, width = 80): string => {
  const lines = [''];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    const line = lines[last] ?? '';
    if (line && indent.length + line.length + word.length + 1 > width) lines.push(word);
    else lines[last] = `${line}${line ? ' ' : ''}${word}`;
  }
  return lines.join(`\n${indent}`);
};
/** Kinds that export to (or import from) a format, comma separated. */
const formatKinds = (direction: 'exports' | 'imports', format: FormatName): string =>
  kinds
    .filter(k => formatSupport(k.kind)[direction].includes(format))
    .map(k => k.kind)
    .join(', ');

const plantumlKinds = (): string =>
  kinds
    .filter(k => k.backends[0]?.name === 'plantuml')
    .map(k => k.kind)
    .join(', ');

const renderer = (): string => `PlantUML kinds (${plantumlKinds()}, and class with --backend
plantuml) need a local Java renderer, set up once with
  node ${SETUP_SCRIPT}
(npm run setup:renderer in a source checkout), or set both DIAGRAMC_JAVA and
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
                            both); the default is the first one listed by
                            ${BIN} kinds.`;

const help = (): string => `${BIN} ${VERSION} - validated JSON UML models to SVG or PNG, offline

${wrap(`Agents: run \`${BIN} guide\` first for the playbook (discovery, the write, validate and render loop, errors), or attach \`${BIN} mcp\` as an MCP server.`, '')}

Usage:
  ${BIN} render <model.json|-> -o <diagram.svg|diagram.png> [options]
  ${BIN} validate <model.json|->
  ${BIN} export <model.json|-> --to <plantuml|mermaid> [-o <file>]
  ${BIN} import <diagram.puml|diagram.mmd|-> [--from <plantuml|mermaid>] [-o <model.json>]
  ${BIN} example <kind>
  ${BIN} schema <kind>
  ${BIN} kinds
  ${BIN} guide [reference]
  ${BIN} mcp
  ${`${BIN} <command> --help`.padEnd(24)}  Details of one command
  ${BIN} --version

Commands:
  render     Validate, then draw the diagram and check its layout. Output format
             follows the -o extension (.svg or .png) unless --format is given.
  validate   Validate only. Prints {"valid":true,"kind":...,"version":...} on stdout.
  export     ${wrap(`Validate, then write the model as PlantUML (every kind) or Mermaid (${formatKinds('exports', 'mermaid')}) text.`, ' '.repeat(13))}
  import     ${wrap(`Read PlantUML (${formatKinds('imports', 'plantuml')}) or Mermaid (${formatKinds('imports', 'mermaid')}) text into a validated model.`, ' '.repeat(13))}
  example    Print a minimal valid model of a kind: a starting point to edit.
  schema     Print the JSON Schema of a kind (draft-07): every property, with
             descriptions and allowed values.
  kinds      Print the ${kinds.length} supported diagram kinds, their backends and
             the formats each exports to and imports from, as JSON.
  guide      ${wrap(`Print the usage guide for agents (the skill in skills/${BIN}/), or with "reference" the per-kind cheat sheet.`, ' '.repeat(13))}
  mcp        ${wrap(`Run an MCP server on stdin and stdout with the tools ${MCP_TOOLS.join(', ')}.`, ' '.repeat(13))}

Render options:
  -o, --output <path>       Output file; its parent directory must exist.
  --format <svg|png>        Output format (default: from the -o extension).
${backendOption}
  --scale <1-4>             PNG pixel density (default 2).
  --strict                  Fail (exit 5, LAYOUT_QUALITY) instead of warning when
                            the drawing fails a layout check; nothing is written.

Kinds:
  ${kindList()}.

${wrap(`Writing a model: start from \`${BIN} example <kind>\` and look up properties with \`${BIN} schema <kind>\`. Input is UTF-8 JSON, at most ${MAX_INPUT_BYTES / 1024} KiB:`, '')}
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
  render: () => `Usage: ${BIN} render <model.json|-> -o <diagram.svg|diagram.png> [options]

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
  validate: () => `Usage: ${BIN} validate <model.json|->

Validates the model ("-" reads it from stdin) against its kind's schema and
rules, without drawing it. On success prints one line on stdout, for example
{"valid":true,"kind":"class","version":2} (version 1 for the v1 class format).
${errorsAndExits}
`,
  export: () => `Usage: ${BIN} export <model.json|-> --to <plantuml|mermaid> [-o <file>]

Validates the model ("-" reads it from stdin) and writes it as PlantUML or
Mermaid text, on stdout or to the -o file (replaced atomically). The text is
plain and readable: model IDs become aliases ("-" in an ID becomes "_"), and
only characters that would change the meaning of a line are escaped (PlantUML
<U+XXXX>, Mermaid #NN;), so any text reads back unchanged.

Options:
  --to <plantuml|mermaid>   Target format (default: from the -o extension,
                            .puml/.plantuml or .mmd/.mermaid).
  -o, --output <path>       Output file; its parent directory must exist.

${wrap(`PlantUML: all ${kinds.length} kinds. Mermaid: ${formatKinds('exports', 'mermaid')}; the others fail with UNSUPPORTED_EXPORT (exit 2), naming the formats that work.`, '')}
Constructs the format cannot express are reported, the export still succeeds:
one JSON object on stderr,
{"warnings":[{"code":"EXPORT_LOSSY","path","message"}]}, where path is the
JSON Pointer of the construct. docs/formats.md has the full mapping.
${errorsAndExits}
`,
  import: () => `Usage: ${BIN} import <diagram.puml|diagram.mmd|-> [--from <plantuml|mermaid>] [-o <model.json>]

${wrap(`Reads PlantUML or Mermaid text ("-" reads stdin), converts it to a model and validates it like ${BIN} validate. Prints the model JSON on stdout, or writes it to the -o file (replaced atomically).`, '')}

Options:
  --from <plantuml|mermaid> Source format (default: from the file extension,
                            .puml/.plantuml/.pu/.iuml/.wsd or .mmd/.mermaid;
                            required for stdin).
  --kind <kind>             The diagram kind, when the text does not make it
                            clear (default: inferred from the content for
                            PlantUML, from the header for Mermaid).
  -o, --output <path>       Output file; its parent directory must exist.

${wrap(`PlantUML: ${formatKinds('imports', 'plantuml')}. Mermaid: ${formatKinds('imports', 'mermaid')} (classDiagram, sequenceDiagram, stateDiagram-v2).`, '')}
Only the part of each syntax that maps onto the model is read; nothing is
guessed. Every line that cannot be read is reported at once in "diagnostics",
each with code UNSUPPORTED_SYNTAX (valid in the format, but not in the model)
or MALFORMED_LINE, path "/lines/<n>" and details {"line","text"}. Lines that
only change presentation (skinparam, hide, style, classDef, ...) are skipped.
A model that reads but breaks a rule fails with IMPORT_INVALID; its
diagnostics point into the model, which is in details.model.
${errorsAndExits}
`,
  example: () => `Usage: ${BIN} example <kind>

Prints a minimal valid model of the kind on stdout, a starting point to edit.
Kinds:
  ${kindList()}.
An unknown kind fails with UNKNOWN_KIND (exit 2) and the nearest kind.
`,
  schema: () => `Usage: ${BIN} schema <kind>

Prints the JSON Schema (draft-07) of the kind on stdout: every property with its
description and allowed values. Properties the schema does not list are errors.
Kinds:
  ${kindList()}.
An unknown kind fails with UNKNOWN_KIND (exit 2) and the nearest kind.
`,
  guide: () => `Usage: ${BIN} guide [reference]

Prints the usage guide for agents on stdout: when to use ${BIN}, the discovery
commands, the write, validate and render loop, how to read errors and warnings,
export and import, the renderer setup and the limits. It is the Agent Skill
shipped in the package, which harnesses that read skills can load directly:
  ${SKILL_FILE}
With "reference" it prints the per-kind cheat sheet next to it: every kind's
top-level properties and the type values of its elements and relationships.
`,
  mcp: () => `Usage: ${BIN} mcp

Runs a Model Context Protocol server on stdin and stdout until stdin closes.
${wrap(`Tools: ${MCP_TOOLS.join(', ')}.`, '')}
${wrap(`They take the same inputs as the commands (a model as a JSON object, JSON text or a file path) and return the same output. A failure is a tool error whose text is the same {"error":{...}} object the commands print; warnings come as a second text item, {"warnings":[...]}. ${mcpToolName('render')} returns the SVG text or the PNG image, or writes the file and returns {"written":...} when "output" is given.`, '')}

Attach it to a harness, for example:
  claude mcp add ${BIN} -- ${BIN} mcp
  codex mcp add ${BIN} -- ${BIN} mcp
  {"mcpServers":{"${BIN}":{"command":"${BIN}","args":["mcp"]}}}
`,
  kinds: () => `Usage: ${BIN} kinds

Prints the ${kinds.length} supported diagram kinds as a JSON array on stdout, each
{"kind","title","summary","frameKeyword","backends","exports","imports"}. The
${wrap(`first backend is the default: "engine" is the built-in layout engine, "plantuml" the local PlantUML renderer (see ${BIN} --help). "exports" and "imports" list the text formats (plantuml, mermaid) of ${BIN} export and ${BIN} import.`, '')}
`,
};

function isInput(arg: string | undefined): arg is string {
  return !!arg && (arg === '-' || !arg.startsWith('-'));
}

async function render(args: string[]): Promise<void> {
  let input: string | undefined,
    output: string | undefined,
    format: string | undefined,
    backend: string | undefined,
    scale: number | undefined,
    strict = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || (next.startsWith('-') && next !== '-')) throw usage(`Missing value for ${arg}`);
      return next;
    };
    switch (arg) {
      case '-o':
      case '--output': {
        if (output !== undefined) throw usage('Duplicate -o');
        output = value();
        break;
      }
      case '--format': {
        format = value();
        if (format !== 'svg' && format !== 'png') throw usage('--format must be svg or png');
        break;
      }
      case '--backend': {
        backend = value();
        break;
      }
      case '--scale': {
        scale = Number(value());
        if (!Number.isFinite(scale) || scale < 1 || scale > 4) throw usage('--scale must be a number from 1 to 4');

        break;
      }
      case '--strict': {
        strict = true;
        break;
      }
      default:
        if (input === undefined && isInput(arg)) input = arg;
        else throw usage(`Unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  if (!input || !output) throw usage(`Usage: ${BIN} render <model.json|-> -o <diagram.svg|diagram.png>`);
  const resolved = renderFormat(output, format, scale);
  const { data, warnings } = await renderText(await readInput(input), { format: resolved, backend, scale, strict });
  await writeOutput(output, data);
  if (warnings.length > 0) process.stderr.write(JSON.stringify({ warnings }) + '\n');
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
    if (arg === '-o' || arg === '--output') {
      if (output !== undefined) throw usage('Duplicate -o');
      output = value();
    } else if (named.includes(arg)) {
      if (values.has(arg)) throw usage(`Duplicate ${arg}`);
      values.set(arg, value());
    } else if (input === undefined && isInput(arg)) input = arg;
    else throw usage(`Unexpected argument ${JSON.stringify(arg)}`);
  }
  return { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }), values };
}

async function exportCommand(args: string[]): Promise<void> {
  const { input, output, values } = exchangeArgs(args, ['--to']);
  if (!input) throw usage(`Usage: ${BIN} export <model.json|-> --to <plantuml|mermaid> [-o <file>]`);
  const format = exportFormat(values.get('--to'), output);
  const { text, warnings } = exportText(await readInput(input), format);
  if (output === undefined) process.stdout.write(text);
  else await writeOutput(output, Buffer.from(text, 'utf8'));
  if (warnings.length > 0) process.stderr.write(JSON.stringify({ warnings }) + '\n');
}

async function importCommand(args: string[]): Promise<void> {
  const { input, output, values } = exchangeArgs(args, ['--from', '--kind']);
  if (!input) throw usage(`Usage: ${BIN} import <diagram.puml|diagram.mmd|-> [--from <plantuml|mermaid>] [-o <model.json>]`);
  const format = importFormat(values.get('--from'), input);
  const kind = values.get('--kind');
  if (kind !== undefined) kindArgument(kind);
  const model = importModel(await readInput(input), format, kind);
  const text = JSON.stringify(model, null, 2) + '\n';
  if (output === undefined) process.stdout.write(text);
  else await writeOutput(output, Buffer.from(text, 'utf8'));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, ...rest] = args;
  if (command === undefined) throw usage('Missing command');
  const commands: readonly string[] = COMMANDS;
  const asksHelp = command === '--help' || command === '-h' || command === 'help';
  if (asksHelp || rest.includes('--help') || rest.includes('-h')) {
    // `diagramc help render`, `diagramc --help render` and `diagramc render --help` show the render help.
    const topic = asksHelp ? rest[0] : command;
    if (asksHelp && rest.length > 1) throw usage(`Usage: ${BIN} help [command]`);
    if (topic !== undefined && !commands.includes(topic)) throw usage(`Unknown command ${JSON.stringify(topic)}`);
    const specific = topic === undefined ? undefined : commandHelp[topic];
    process.stdout.write(specific ? specific() : help());
    return;
  }
  if (command === '--version') {
    if (rest.length > 0) throw usage('--version takes no arguments');
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
      if (rest.length !== 1 || !isInput(rest[0])) throw usage(`Usage: ${BIN} validate <model.json|->`);
      process.stdout.write(JSON.stringify(validationResult(parseDocument(await readInput(rest[0])))) + '\n');
      return;
    }
    case 'example': {
      if (rest.length !== 1) throw usage(`Usage: ${BIN} example <kind>; kinds: ${kinds.map(k => k.kind).join(', ')}`);
      process.stdout.write(await exampleText(rest[0]!));
      return;
    }
    case 'schema': {
      if (rest.length !== 1) throw usage(`Usage: ${BIN} schema <kind>`);
      process.stdout.write(JSON.stringify(schemaOf(rest[0]!), null, 2) + '\n');
      return;
    }
    case 'kinds': {
      if (rest.length > 0) throw usage(`Usage: ${BIN} kinds`);
      process.stdout.write(JSON.stringify(kindSummaries(), null, 2) + '\n');
      return;
    }
    case 'guide': {
      if (rest.length > 1) throw usage(`Usage: ${BIN} guide [reference]`);
      process.stdout.write(await guideText(rest[0]));
      return;
    }
    case 'mcp': {
      if (rest.length > 0) throw usage(`Usage: ${BIN} mcp`);
      // Loaded only here, so the other commands do not pay for the MCP SDK at start-up.
      await (await import('./mcp.js')).serveMcp();
      return;
    }
    default: {
      const nearest = commands.find(c => c.startsWith(command.toLowerCase().slice(0, 3)));
      throw usage(`Unknown command ${JSON.stringify(command)}${nearest ? `; did you mean "${nearest}"?` : ''}`);
    }
  }
}

try {
  await main();
} catch (error: unknown) {
  const failure = error instanceof UmlError ? error : new UmlError('INTERNAL_ERROR', 'Unexpected internal failure', 3);
  if (!(error instanceof UmlError) && process.env.UML_DEBUG)
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.stderr.write(JSON.stringify({ error: failure }) + '\n');
  process.exitCode = failure.exitCode;
}
