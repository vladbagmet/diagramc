#!/usr/bin/env node
import { UmlError } from './errors.js';
import { readInput, writeOutput } from './io.js';
import { parseModel } from './model.js';
import { toPlantUml } from './plantuml.js';
import { renderSvg, rendererOptions } from './renderer.js';

const help = `uml 0.1.0 - validated JSON class models to SVG

Usage:
  uml render model.json -o diagram.svg
  cat model.json | uml render - -o diagram.svg

Commands:
  render <input> -o <output.svg>   Render a class diagram locally
  --help                         Show this help
  --version                      Show version

Input: UTF-8 JSON matching schema/model-v1.schema.json (maximum 256 KiB).
Inheritance points from subclass to superclass. Associations are undirected.
Output is replaced atomically only after a successful render. Parent must exist.
Renderer: npm run setup:renderer, or trusted UML_JAVA / PLANTUML_JAR overrides.
Errors: one JSON object on stderr; exit 2 input/usage, 3 renderer, 4 file I/O.
Interruptions during rendering: exit 130 for SIGINT, 143 for SIGTERM.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if ((args.length === 1 && args[0] === '--help') ||
      (args.length === 2 && args[0] === 'render' && args[1] === '--help')) {
    process.stdout.write(help);
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write('0.1.0\n');
    return;
  }
  if (args.length !== 4 || args[0] !== 'render' || args[2] !== '-o' ||
      !args[1] || !args[3] || !args[3].endsWith('.svg') || (args[1] !== '-' && args[1].startsWith('-'))) {
    throw new UmlError('USAGE', 'Usage: uml render <model.json|-> -o <diagram.svg>. See uml --help');
  }
  const model = parseModel(await readInput(args[1]));
  // Never discover or launch a renderer until the entire input has been validated.
  const svg = await renderSvg(toPlantUml(model), await rendererOptions());
  await writeOutput(args[3], svg);
}

main().catch((error: unknown) => {
  const failure = error instanceof UmlError ? error : new UmlError('INTERNAL_ERROR', 'Unexpected internal failure', 3);
  process.stderr.write(JSON.stringify({ error: {
    code: failure.code, message: failure.message,
    ...(failure.details === undefined ? {} : { details: failure.details }),
  } }) + '\n');
  process.exitCode = failure.exitCode;
});
