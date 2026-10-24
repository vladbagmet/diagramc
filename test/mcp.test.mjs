import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN, MCP_TOOLS, mcpToolName } from '../dist/commands.js';
import { kinds } from '../dist/model/registry.js';
import { cli, fakeJava, fakeSvg, minimal, root, workspace } from './helpers.mjs';
import { call, mcpClient } from './mcp-helpers.mjs';

// `uml mcp` over stdio, driven by the MCP SDK client as a harness would drive
// it. Each tool must return what its command prints, and a failure must carry
// the same {"error":...} object the command prints on stderr.

const tool = mcpToolName;
const classExample = join(root, 'examples/class/minimal.json');
const invalid = {
  kind: 'class',
  elements: [{ id: 'a', type: 'class', name: 'A', methods: [] }],
  relationships: [{ type: 'inheritance', from: 'a', to: 'c' }],
};

test('the server lists every tool with a description and an input schema', async t => {
  const client = await mcpClient(t);
  assert.equal(client.getServerVersion().name, BIN);
  assert.match(client.getInstructions(), new RegExp(tool('validate'), 'u'));
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map(t => t.name),
    [...MCP_TOOLS],
  );
  for (const t of tools) {
    assert.ok(t.description.length > 40, `${t.name} has a description`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('kinds, example and schema return what the commands print', async t => {
  const client = await mcpClient(t);
  let result = await call(client, tool('kinds'));
  assert.ok(!result.isError);
  assert.deepEqual(result.parsed[0], JSON.parse(cli(['kinds']).stdout));
  assert.equal(result.parsed[0].length, kinds.length);

  result = await call(client, tool('example'), { kind: 'sequence' });
  assert.equal(result.content[0].text, cli(['example', 'sequence']).stdout);

  result = await call(client, tool('schema'), { kind: 'use-case' });
  assert.deepEqual(result.parsed[0], JSON.parse(cli(['schema', 'use-case']).stdout));

  result = await call(client, tool('schema'), { kind: 'sequense' });
  assert.equal(result.isError, true);
  assert.deepEqual(result.parsed[0], JSON.parse(cli(['schema', 'sequense']).stderr));
  assert.equal(result.parsed[0].error.details.suggestion, 'sequence');
});

test('validate accepts an object, JSON text or a file, and returns the same diagnostics as the CLI', async t => {
  const dir = await workspace(t);
  const client = await mcpClient(t);
  const valid = { valid: true, kind: 'class', version: 2 };
  assert.deepEqual((await call(client, tool('validate'), { model: JSON.parse(await readFile(classExample, 'utf8')) })).parsed[0], valid);
  assert.deepEqual((await call(client, tool('validate'), { model: await readFile(classExample, 'utf8') })).parsed[0], valid);
  assert.deepEqual((await call(client, tool('validate'), { file: classExample })).parsed[0], valid);
  assert.deepEqual((await call(client, tool('validate'), { model: minimal })).parsed[0], { valid: true, kind: 'class', version: 1 });

  const file = join(dir, 'invalid.json');
  await writeFile(file, JSON.stringify(invalid));
  const result = await call(client, tool('validate'), { model: invalid });
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 1);
  assert.deepEqual(result.parsed[0], JSON.parse(cli(['validate', file]).stderr), 'the tool error is the object the CLI prints');
  assert.deepEqual(
    result.parsed[0].error.diagnostics.map(d => [d.code, d.path, d.details.suggestion]),
    [
      ['SCHEMA_INVALID', '/elements/0/methods', 'operations'],
      ['SCHEMA_INVALID', '/relationships/0/type', 'generalization'],
      ['MISSING_REFERENCE', '/relationships/0/to', 'a'],
    ],
  );

  for (const [args, code] of [
    [{ model: '{"kind": "class",' }, 'INVALID_JSON'],
    [{}, 'USAGE'],
    [{ model: minimal, file: classExample }, 'USAGE'],
    [{ file: join(dir, 'missing.json') }, 'INPUT_READ_FAILED'],
  ]) {
    const failure = await call(client, tool('validate'), args);
    assert.equal(failure.isError, true);
    assert.equal(failure.parsed[0].error.code, code);
  }
});

test('render returns SVG text or a PNG image, or writes the file byte-identical to the CLI', async t => {
  const dir = await workspace(t);
  const client = await mcpClient(t);
  const cliSvg = join(dir, 'cli.svg');
  assert.equal(cli(['render', classExample, '-o', cliSvg]).status, 0);

  let result = await call(client, tool('render'), { file: classExample });
  assert.ok(!result.isError);
  assert.equal(result.content.length, 1, 'no warnings');
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text, await readFile(cliSvg, 'utf8'));

  result = await call(client, tool('render'), { file: classExample, format: 'png', scale: 1 });
  assert.equal(result.content[0].type, 'image');
  assert.equal(result.content[0].mimeType, 'image/png');
  assert.deepEqual([...Buffer.from(result.content[0].data, 'base64').subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const output = join(dir, 'mcp.png');
  result = await call(client, tool('render'), { file: classExample, output });
  assert.deepEqual(Object.keys(result.parsed[0]), ['written', 'format', 'bytes']);
  assert.equal(result.parsed[0].format, 'png');
  const cliPng = join(dir, 'cli.png');
  assert.equal(cli(['render', classExample, '-o', cliPng]).status, 0);
  assert.deepEqual(await readFile(output), await readFile(cliPng));

  for (const [args, code] of [
    [{ file: classExample, format: 'svg', scale: 2 }, 'USAGE'],
    [{ file: classExample, output: join(dir, 'x.svg'), format: 'png' }, 'USAGE'],
    [{ file: classExample, output: join(dir, 'x.gif') }, 'USAGE'],
    [{ file: classExample, backend: 'graphviz' }, 'UNSUPPORTED_BACKEND'],
    [{ model: invalid }, 'SCHEMA_INVALID'],
    [{ file: classExample, output: join(dir, 'missing', 'x.svg') }, 'OUTPUT_WRITE_FAILED'],
  ]) {
    const failure = await call(client, tool('render'), args);
    assert.equal(failure.isError, true, JSON.stringify(args));
    assert.equal(failure.parsed[0].error.code, code);
  }
});

test('render: layout warnings come as a second item, --strict makes them the error; RENDERER_MISSING names the setup', async t => {
  const dir = await workspace(t);
  // A fake PlantUML that returns an empty drawing fails the literal-text layout check.
  const java = await fakeJava(dir, `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(fakeSvg)}));`);
  const client = await mcpClient(t, { UML_JAVA: java, PLANTUML_JAR: join(dir, 'fake.jar') });
  let result = await call(client, tool('render'), { model: minimal, backend: 'plantuml' });
  assert.ok(!result.isError);
  assert.equal(result.content.length, 2);
  assert.deepEqual(
    result.parsed[1].warnings.map(w => [w.code, w.gate]),
    [['LAYOUT_QUALITY', 'literal-text']],
  );
  const output = join(dir, 'strict.svg');
  result = await call(client, tool('render'), { model: minimal, backend: 'plantuml', strict: true, output });
  assert.equal(result.isError, true);
  assert.equal(result.parsed[0].error.code, 'LAYOUT_QUALITY');
  assert.equal(result.parsed[0].error.details.warnings[0].gate, 'literal-text');
  await assert.rejects(readFile(output), 'nothing is written under strict');

  const missing = await mcpClient(t, { UML_JAVA: java, PLANTUML_JAR: '' });
  result = await call(missing, tool('render'), { file: join(root, 'examples/sequence/minimal.json') });
  assert.equal(result.isError, true);
  assert.equal(result.parsed[0].error.code, 'RENDERER_MISSING');
  assert.match(result.parsed[0].error.details.setup, /setup-renderer\.mjs/u);
});

test('export returns the text with lossy constructs as warnings; import reads text or a file', async t => {
  const dir = await workspace(t);
  const client = await mcpClient(t);
  const useCase = join(root, 'examples/use-case/notation.json');
  const exported = cli(['export', useCase, '--to', 'mermaid']);

  let result = await call(client, tool('export'), { file: useCase, to: 'mermaid' });
  assert.ok(!result.isError);
  assert.equal(result.content[0].text, exported.stdout);
  assert.deepEqual(result.parsed[1], JSON.parse(exported.stderr), 'the EXPORT_LOSSY warnings the CLI prints');
  assert.ok(result.parsed[1].warnings.every(w => w.code === 'EXPORT_LOSSY' && w.path.startsWith('/')));

  const puml = join(dir, 'model.puml');
  result = await call(client, tool('export'), { file: classExample, output: puml });
  assert.deepEqual(result.parsed, [{ written: puml, format: 'plantuml' }]);
  assert.equal(await readFile(puml, 'utf8'), cli(['export', classExample, '--to', 'plantuml']).stdout);

  result = await call(client, tool('export'), { file: join(root, 'examples/timing/door.json'), to: 'mermaid' });
  assert.equal(result.isError, true);
  assert.equal(result.parsed[0].error.code, 'UNSUPPORTED_EXPORT');
  result = await call(client, tool('export'), { file: classExample });
  assert.equal(result.parsed[0].error.code, 'USAGE');

  result = await call(client, tool('import'), { file: puml });
  assert.ok(!result.isError);
  assert.equal(result.content[0].text, cli(['import', puml]).stdout);
  result = await call(client, tool('import'), { text: await readFile(puml, 'utf8'), from: 'plantuml' });
  assert.equal(result.content[0].text, cli(['import', puml]).stdout);
  const output = join(dir, 'imported.json');
  result = await call(client, tool('import'), { text: 'classDiagram\n  class A\n', from: 'mermaid', output });
  assert.deepEqual(result.parsed, [{ written: output, kind: 'class' }]);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).kind, 'class');

  result = await call(client, tool('import'), { text: 'classDiagram\n  class A {\n  struct B\n', from: 'mermaid' });
  assert.equal(result.isError, true);
  assert.ok(result.parsed[0].error.diagnostics.every(d => d.path.startsWith('/lines/')));
  for (const [args, code] of [
    [{ text: 'classDiagram\n' }, 'USAGE'],
    [{}, 'USAGE'],
    [{ text: 'classDiagram\n  class A\n', from: 'mermaid', kind: 'timing' }, 'UNSUPPORTED_IMPORT'],
    [{ text: 'classDiagram\n  class A\n', from: 'mermaid', kind: 'clas' }, 'UNKNOWN_KIND'],
  ]) {
    const failure = await call(client, tool('import'), args);
    assert.equal(failure.isError, true, JSON.stringify(args));
    assert.equal(failure.parsed[0].error.code, code);
  }
});
