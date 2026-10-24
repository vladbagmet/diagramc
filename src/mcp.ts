import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { UmlError } from './core/errors.js';
import { readInput, writeOutput } from './core/io.js';
import { parseDocument } from './model/parse.js';
import {
  BIN,
  mcpToolName,
  VERSION,
  exampleText,
  exportFormat,
  exportText,
  importFormat,
  importModel,
  kindSummaries,
  renderFormat,
  renderText,
  schemaOf,
  usage,
  validationResult,
} from './commands.js';

/**
 * `diagramc mcp`: the commands as Model Context Protocol tools on stdio. Every tool
 * calls the same function as its command (src/commands.ts) and returns what the
 * command prints; a failure is a tool error whose text is the command's
 * {"error":{...}} object, so an agent reads the same diagnostics either way.
 */

const instructions = `${BIN} validates JSON models of UML 2.5.1 diagrams and draws them as SVG or PNG, offline.
Start with ${mcpToolName('kinds')}, then ${mcpToolName('example')} for a starting model and ${mcpToolName('schema')} for every property.
Write the model, call ${mcpToolName('validate')} until it returns {"valid":true}, then ${mcpToolName('render')}.
A failed call returns {"error":{"code","message","path","diagnostics"}}: fix every diagnostic at its JSON Pointer path,
using details.suggestion and details.swap where given, then call again.
A {"warnings":[...]} item after a result means the drawing or export succeeded with a layout defect or a loss; read its advice.`;

const kind = z.string().describe(`Diagram kind, as ${mcpToolName('kinds')} lists it, for example "class" or "sequence".`);
const model = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .optional()
  .describe('The model: a JSON object, or its JSON text. Give either model or file.');
const file = z.string().optional().describe('Path of a model file to read instead of model, relative to the server working directory.');
const output = z.string().optional().describe('Write the result to this file (its parent directory must exist) instead of returning it.');

/** One model input: inline (object or JSON text) or a file. */
async function modelText(args: { model?: string | Record<string, unknown> | undefined; file?: string | undefined }): Promise<string> {
  if ((args.model === undefined) === (args.file === undefined)) throw usage('Give exactly one of "model" (the JSON object or text) and "file" (a path)');
  if (args.file !== undefined) return readInput(args.file);
  return typeof args.model === 'string' ? args.model : JSON.stringify(args.model);
}

const text = (value: string): { type: 'text'; text: string } => ({ type: 'text', text: value });
const json = (value: unknown): { type: 'text'; text: string } => text(JSON.stringify(value));

/** The tool error the commands would print on stderr. */
function failure(error: unknown): CallToolResult {
  const failed = error instanceof UmlError ? error : new UmlError('INTERNAL_ERROR', 'Unexpected internal failure', 3);
  if (!(error instanceof UmlError) && process.env.UML_DEBUG)
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  return { isError: true, content: [json({ error: failed })] };
}

/** Runs a tool body and turns a thrown UmlError into the error result. */
async function run(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return failure(error);
  }
}

/** Results with the warnings, when there are any, as a second item. */
function withWarnings(content: CallToolResult['content'], warnings: readonly unknown[]): CallToolResult {
  return { content: warnings.length > 0 ? [...content, json({ warnings })] : content };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: BIN, version: VERSION }, { instructions });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    mcpToolName('kinds'),
    {
      title: 'List diagram kinds',
      description: `The supported UML diagram kinds, each with its title, summary, backends (the first is the default) and the text formats it exports to and imports from. Same as \`${BIN} kinds\`.`,
      annotations: readOnly,
    },
    () => run(() => Promise.resolve({ content: [json(kindSummaries())] })),
  );

  server.registerTool(
    mcpToolName('example'),
    {
      title: 'Minimal example model',
      description: `A minimal valid model of a kind, as JSON text: the starting point to edit. Same as \`${BIN} example <kind>\`.`,
      inputSchema: { kind },
      annotations: readOnly,
    },
    args => run(async () => ({ content: [text(await exampleText(args.kind))] })),
  );

  server.registerTool(
    mcpToolName('schema'),
    {
      title: 'JSON Schema of a kind',
      description: `The JSON Schema (draft-07) of a kind: every property with its description and allowed values. Properties it does not list are errors. Same as \`${BIN} schema <kind>\`.`,
      inputSchema: { kind },
      annotations: readOnly,
    },
    args => run(() => Promise.resolve({ content: [json(schemaOf(args.kind))] })),
  );

  server.registerTool(
    mcpToolName('validate'),
    {
      title: 'Validate a model',
      description: `Validates a model against its kind's schema and rules without drawing it. Returns {"valid":true,"kind","version"}, or an error listing every problem in "diagnostics" with its JSON Pointer path and a suggested fix where one is clear. Same as \`${BIN} validate\`.`,
      inputSchema: { model, file },
      annotations: readOnly,
    },
    args => run(async () => ({ content: [json(validationResult(parseDocument(await modelText(args))))] })),
  );

  server.registerTool(
    mcpToolName('render'),
    {
      title: 'Render a model',
      description: `Validates a model, draws it and runs the layout checks. Returns the SVG text, or the PNG as an image; with "output" it writes the file and returns {"written","format","bytes"}. Failed layout checks come as a second item {"warnings":[{"code":"LAYOUT_QUALITY","gate","advice",...}]}; with strict they are an error (LAYOUT_QUALITY) and nothing is written. Sequence, timing and activity need the PlantUML renderer (RENDERER_MISSING names its setup command). Same as \`${BIN} render\`.`,
      inputSchema: {
        model,
        file,
        output,
        format: z.enum(['svg', 'png']).optional().describe('Output format; default from the output extension, else svg.'),
        backend: z.string().optional().describe('Renderer, when the kind has several (only class has engine and plantuml).'),
        scale: z.number().optional().describe('PNG pixel density, 1 to 4 (default 2).'),
        strict: z.boolean().optional().describe('Fail with LAYOUT_QUALITY instead of warning when a layout check fails.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    args =>
      run(async () => {
        const format = renderFormat(args.output, args.format ?? (args.output === undefined ? 'svg' : undefined), args.scale);
        const { data, warnings } = await renderText(await modelText(args), { format, backend: args.backend, scale: args.scale, strict: args.strict });
        if (args.output !== undefined) {
          await writeOutput(args.output, data);
          return withWarnings([json({ written: args.output, format, bytes: data.length })], warnings);
        }
        return withWarnings(
          format === 'png' ? [{ type: 'image', data: data.toString('base64'), mimeType: 'image/png' }] : [text(data.toString('utf8'))],
          warnings,
        );
      }),
  );

  server.registerTool(
    mcpToolName('export'),
    {
      title: 'Export to PlantUML or Mermaid',
      description: `Validates a model and returns it as PlantUML or Mermaid text (or writes it to "output"). Constructs the format cannot express come as a second item {"warnings":[{"code":"EXPORT_LOSSY","path","message"}]}; a kind the format cannot draw fails with UNSUPPORTED_EXPORT. Same as \`${BIN} export\`.`,
      inputSchema: {
        model,
        file,
        to: z.enum(['plantuml', 'mermaid']).optional().describe('Target format; default from the output extension (.puml or .mmd).'),
        output,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    args =>
      run(async () => {
        const format = exportFormat(args.to, args.output);
        const result = exportText(await modelText(args), format);
        if (args.output === undefined) return withWarnings([text(result.text)], result.warnings);
        await writeOutput(args.output, Buffer.from(result.text, 'utf8'));
        return withWarnings([json({ written: args.output, format })], result.warnings);
      }),
  );

  server.registerTool(
    mcpToolName('import'),
    {
      title: 'Import PlantUML or Mermaid',
      description: `Reads PlantUML or Mermaid text into a validated model and returns the model JSON (or writes it to "output"). Every line that cannot be read is reported at once (UNSUPPORTED_SYNTAX, MALFORMED_LINE, path /lines/<n>). Same as \`${BIN} import\`.`,
      inputSchema: {
        text: z.string().optional().describe('The PlantUML or Mermaid text. Give either text or file.'),
        file: z.string().optional().describe('Path of a .puml or .mmd file to read instead of text.'),
        from: z.enum(['plantuml', 'mermaid']).optional().describe('Source format; required with text, else from the file extension.'),
        kind: z.string().optional().describe('The diagram kind, when the text does not make it clear.'),
        output,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    args =>
      run(async () => {
        if ((args.text === undefined) === (args.file === undefined)) throw usage('Give exactly one of "text" (the diagram source) and "file" (a path)');
        const format = importFormat(args.from, args.file);
        const imported = importModel(args.file === undefined ? (args.text ?? '') : await readInput(args.file), format, args.kind);
        const result = JSON.stringify(imported, null, 2) + '\n';
        if (args.output === undefined) return { content: [text(result)] };
        await writeOutput(args.output, Buffer.from(result, 'utf8'));
        return { content: [json({ written: args.output, kind: imported.kind })] };
      }),
  );

  return server;
}

/** Serves the tools on `transport` (stdio by default) until it closes. */
export async function serveMcp(transport: Transport = new StdioServerTransport()): Promise<void> {
  const server = createServer();
  const closed = new Promise<void>(accept => {
    // The SDK reports the end of the session through this callback property; it is not an EventTarget.
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    server.server.onclose = accept;
  });
  await server.connect(transport);
  await closed;
}
