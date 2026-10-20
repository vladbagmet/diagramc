import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access, mkdir, readdir, watch } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { MAX_INPUT_BYTES } from '../dist/core/limits.js';
import { displayText } from '../dist/plantuml/encode.js';
import { classToPlantUml } from '../dist/kinds/class/to-plantuml.js';
import { renderSvg, rendererOptions } from '../dist/plantuml/runner.js';
import { writeOutput } from '../dist/core/io.js';
import { cli, root, workspace, fakeJava, minimal, minimalV2, fakeSvg } from './helpers.mjs';

const parse = model => parseDocument(JSON.stringify(model));
const fails = (model, code, path) => assert.throws(() => parse(model), error => {
  assert.equal(error.code, code, error.message);
  if (path !== undefined) assert.equal(error.path, path);
  return true;
});
const plantuml = ['--backend', 'plantuml'];

test('v1 documents (no kind) are class diagrams; Unicode and display-only members are accepted', () => {
  const parsed = parse(minimal);
  assert.equal(parsed.kind.kind, 'class');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.model.elements, [{ id: 'a', type: 'class', name: 'A', attributes: [], operations: [] }]);
  const model = { classes: [{ id: 'z', name: 'Zoë · 注文 🚀', attributes: ['+f(): T', 'List<T>'], methods: ['not parsed as code'] }], relationships: [] };
  assert.deepEqual(parse(model).model.elements[0].attributes, [{ text: '+f(): T' }, { text: 'List<T>' }]);
  assert.equal(parse(minimalV2).version, 2);
});
test('v1 schema rejects unknown fields at every level, unsupported types and nonstrings', () => {
  for (const [model, path] of [
    [{ ...minimal, layout: 'LR' }, '/layout'],
    [{ ...minimal, classes: [{ ...minimal.classes[0], color: 'red' }] }, '/classes/0/color'],
    [{ ...minimal, relationships: [{ type: 'association', from: 'a', to: 'a', color: 'red' }] }, '/relationships/0/color'],
    [{ ...minimal, relationships: [{ type: 'composition', from: 'a', to: 'a' }] }, '/relationships/0/type'],
    [{ ...minimal, classes: [{ id: 'a', name: 3 }] }, '/classes/0/name'],
    [{ classes: [], relationships: [] }, '/classes'],
    [{ classes: [{ id: 'a', name: 'A' }] }, '/relationships'],
  ]) fails(model, 'SCHEMA_INVALID', path);
  fails([], 'SCHEMA_INVALID', '');
  fails({ elements: [] }, 'SCHEMA_INVALID', '/kind');
});
test('bounds and stable ID syntax', () => {
  for (const name of ['', 'x'.repeat(101)]) fails({ ...minimal, classes: [{ id: 'a', name }] }, 'SCHEMA_INVALID');
  parse({ ...minimal, classes: [{ id: 'a', name: '🚀'.repeat(100) }] });
  fails({ ...minimal, classes: [{ id: 'a', name: '🚀'.repeat(101) }] }, 'SCHEMA_INVALID');
  fails({ ...minimal, classes: Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, name: 'C' })) }, 'SCHEMA_INVALID');
  fails({ ...minimal, classes: [{ id: 'a', name: 'A', attributes: Array(21).fill('x') }] }, 'SCHEMA_INVALID');
  fails({ ...minimal, classes: [{ id: 'a', name: 'A', methods: ['x'.repeat(181)] }] }, 'SCHEMA_INVALID');
  fails({ ...minimal, relationships: Array(101).fill({ type: 'association', from: 'a', to: 'a' }) }, 'SCHEMA_INVALID');
  for (const id of ['!include', 'a\nb', 'a\n', 'a\r', 'x'.repeat(65), 'a" {}']) {
    fails({ ...minimal, classes: [{ id, name: 'A' }] }, 'SCHEMA_INVALID');
    fails({ ...minimalV2, elements: [{ id, type: 'class', name: 'A' }] }, 'SCHEMA_INVALID', '/elements/0/id');
  }
  fails({ ...minimalV2, elements: Array.from({ length: 151 }, (_, i) => ({ id: `c${i}`, type: 'class', name: 'C' })) }, 'SCHEMA_INVALID', '/elements');
  assert.throws(() => parseDocument(' '.repeat(MAX_INPUT_BYTES + 1)), { code: 'INPUT_TOO_LARGE' });
  assert.throws(() => parseDocument('{'), { code: 'INVALID_JSON' });
});
test('v1 duplicate IDs, missing references (with v1 paths) and prototype-like IDs', () => {
  fails({ ...minimal, classes: [minimal.classes[0], minimal.classes[0]] }, 'DUPLICATE_ID', '/classes/1/id');
  fails({ ...minimal, relationships: [{ type: 'association', from: 'a', to: 'missing' }] }, 'MISSING_REFERENCE', '/relationships/0/to');
  fails({ ...minimal, relationships: [{ type: 'association', from: 'missing', to: 'a' }] }, 'MISSING_REFERENCE', '/relationships/0/from');
  assert.throws(() => parse({ ...minimal, relationships: [{ type: 'association', from: 'a', to: 'missing' }] }), e => e.details === undefined && e.diagnostics[0].details.from === 'a' && e.diagnostics[0].details.to === 'missing');
  parse({ classes: [{ id: 'constructor', name: 'Constructor' }, { id: 'toString', name: 'ToString' }], relationships: [{ type: 'inheritance', from: 'constructor', to: 'toString' }] });
});
test('inheritance direction, cycles, self-inheritance and legal association cycles', () => {
  const model = { classes: [{ id: 'a', name: 'Child' }, { id: 'b', name: 'Parent' }], relationships: [{ type: 'inheritance', from: 'a', to: 'b' }] };
  assert.match(classToPlantUml(parse(model).model), /uml_e0 --\|> uml_e1/);
  fails({ ...minimal, relationships: [{ type: 'inheritance', from: 'a', to: 'a' }] }, 'INHERITANCE_CYCLE', '/relationships/0');
  fails({ ...model, relationships: [...model.relationships, { type: 'inheritance', from: 'b', to: 'a' }] }, 'INHERITANCE_CYCLE', '/relationships/1');
  parse({ ...model, relationships: [{ type: 'association', from: 'a', to: 'b' }, { type: 'association', from: 'b', to: 'a' }] });
});
test('rejects line breaks, controls, blank text, bidi controls, invalid XML characters and unpaired surrogates', () => {
  for (const text of ['A\n@enduml', 'A\n', 'A\r', 'A\r\n', 'A ', 'A ', 'x\r!include a', 'x\tY', '\0', '\u0085', ' ', ' ', '￾', '￿']) {
    for (const field of ['name', 'attributes', 'methods']) {
      fails({ ...minimal, classes: [{ id: 'a', name: 'A', [field]: field === 'name' ? text : [text] }] }, 'SCHEMA_INVALID');
    }
    fails({ ...minimal, relationships: [{ type: 'association', from: 'a', to: 'a', label: text }] }, 'SCHEMA_INVALID');
    fails({ ...minimalV2, elements: [{ id: 'a', type: 'class', name: 'A', attributes: [{ name: 'x', type: text }] }] }, 'SCHEMA_INVALID', '/elements/0/attributes/0/type');
  }
  for (const name of [' ', '\ud800', '‮Evil']) {
    fails({ ...minimal, classes: [{ id: 'a', name }] }, 'INVALID_TEXT', '/classes/0/name');
    fails({ ...minimalV2, title: name }, 'INVALID_TEXT', '/title');
  }
});
test('every validation error carries all diagnostics with JSON paths', () => {
  try {
    parse({ kind: 'class', elements: [{ id: 'a', type: 'class', name: 'A' }, { id: 'a', type: 'class', name: 'B' }], relationships: [{ type: 'association', from: 'a', to: 'x' }] });
    assert.fail('expected an error');
  } catch (error) {
    assert.deepEqual(error.diagnostics.map(d => [d.code, d.path]), [['DUPLICATE_ID', '/elements/1/id'], ['MISSING_REFERENCE', '/relationships/0/to']]);
  }
});
test('hostile display text is encoded, never used as PlantUML source syntax or IDs', () => {
  const text = '" } !include https://evil.invalid <img:x> [[url]] **bold** \\n @enduml';
  const model = { classes: [{ id: 'private_id', name: text, attributes: [text], methods: [text] }], relationships: [{ type: 'association', from: 'private_id', to: 'private_id', label: text }] };
  const source = classToPlantUml(parse(model).model);
  assert.ok(!source.includes(text));
  assert.ok(!source.includes('private_id'));
  assert.equal(source.split('\n').filter(x => x === '@enduml').length, 1);
  assert.match(displayText('"{}<>\\'), /^​(<U\+[0-9A-F]+>)+​$/);
  assert.equal(source, classToPlantUml(parse(model).model));
});

test('renderer invokes without shell, enforces SECURE profile and removes Java injection variables', async t => {
  const dir = await workspace(t);
  const java = await fakeJava(dir, `
    const args = process.argv.slice(2);
    if (!args.includes('-DPLANTUML_SECURITY_PROFILE=SECURE') || process.env.PLANTUML_SECURITY_PROFILE !== 'SECURE' || ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'].some(key => process.env[key])) process.exit(5);
    process.stdin.resume();
    process.stdin.on('end', () => process.stdout.write(${JSON.stringify(fakeSvg.replace(' xml:space="preserve"', ''))}));
  `, 'java with spaces;literal');
  const variables = ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'];
  const saved = variables.map(key => process.env[key]);
  for (const key of variables) process.env[key] = 'hostile setting';
  try { assert.equal((await renderSvg('source', { java, jar: 'literal path;no shell.jar' })).toString(), fakeSvg); }
  finally { variables.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
});
test('renderer reports spawn, failure, malformed output, wrong diagram type, timeout and output limits', async t => {
  const dir = await workspace(t);
  await assert.rejects(renderSvg('x', { java: join(dir, 'missing'), jar: 'x' }), { code: 'RENDER_START_FAILED' });
  for (const [body, code, opts] of [
    ['process.exit(7)', 'RENDER_FAILED', {}],
    ['process.stdout.write("not svg")', 'RENDER_INVALID_OUTPUT', {}],
    [`process.stdout.write(${JSON.stringify(fakeSvg)})`, 'RENDER_INVALID_OUTPUT', { diagramType: 'SEQUENCE' }],
    ['setInterval(() => {}, 1000)', 'RENDER_TIMEOUT', { timeoutMs: 100 }],
    ['process.stdout.write("x".repeat(4096))', 'RENDER_OUTPUT_LIMIT', { maxOutputBytes: 128 }],
    ['process.stderr.write("x".repeat(70000))', 'RENDER_OUTPUT_LIMIT', {}],
    [`process.stdout.write(${JSON.stringify(fakeSvg.replace(' xml:space="preserve"', ''))})`, 'RENDER_OUTPUT_LIMIT', { maxOutputBytes: fakeSvg.length - 1 }],
  ]) {
    const java = await fakeJava(dir, body);
    await assert.rejects(renderSvg('x', { java, jar: 'x', ...opts }), { code });
  }
});
test('renderer expands the viewport for clipped self-association paths and labels', async t => {
  const dir = await workspace(t);
  const source = '<svg data-diagram-type="CLASS" height="100px" style="width:100px;height:100px;" viewBox="0 0 100 100"><g class="link" data-entity-1="uml_c0" data-entity-2="uml_c0"><path d="M1,10 C2,-6 3,-6 4,10"/><text font-size="12" x="1" y="-14.3984">loop</text></g></svg>';
  const java = await fakeJava(dir, `process.stdout.write(${JSON.stringify(source)});`);
  const svg = (await renderSvg('source', { java, jar: 'unused' })).toString();
  assert.match(svg, /viewBox="0 -31 100 131"/);
  assert.match(svg, /height="131px"/);
  assert.match(svg, /style="width:100px;height:131px;"/);
  assert.match(svg, /<text style="white-space:pre"/);
  assert.match(svg, /<path d="M1,10 C2,-6 3,-6 4,10"\/>/);
});
test('CLI help, version, usage and machine-readable read/parse/encoding failures', () => {
  assert.equal(cli(['--help']).status, 0);
  for (const command of ['render', 'validate', 'example', 'schema', 'kinds']) {
    for (const args of [[command, '--help'], ['help', command], ['--help', command]]) {
      const result = cli(args);
      assert.equal(result.status, 0, args.join(' '));
      assert.match(result.stdout, new RegExp(`^Usage: uml ${command}\\b`), args.join(' '));
    }
  }
  assert.match(cli(['help']).stdout, /uml render <model\.json\|->/);
  assert.match(cli(['--help']).stdout, /specific to the general/);
  assert.match(cli(['--help']).stdout, /setup-renderer\.mjs/);
  for (const flag of ['--format', '--backend', '--scale', '--strict', '-o, --output']) assert.ok(cli(['render', '--help']).stdout.includes(flag), flag);
  assert.equal(cli(['help', 'draw']).status, 2);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(version, '1.0.0');
  assert.equal(cli(['--version']).stdout, `${version}\n`);
  for (const [args, options, code, status] of [
    [[], {}, 'USAGE', 2],
    [['draw'], {}, 'USAGE', 2],
    [['render', '-', '--unknown', 'x.svg'], {}, 'USAGE', 2],
    [['render', '-o', '-o', 'x.svg'], {}, 'USAGE', 2],
    [['render', '-', '-o', 'x.txt'], {}, 'USAGE', 2],
    [['render', '-', '-o', 'x.svg', '--format', 'pdf'], {}, 'USAGE', 2],
    [['render', '-', '-o', 'x.svg', '--scale', '2'], {}, 'USAGE', 2],
    [['render', '-', '-o', 'x.png', '--scale', '9'], {}, 'USAGE', 2],
    [['render', '-', '-o', 'x.svg', '--backend', 'graphviz'], { input: JSON.stringify(minimalV2) }, 'UNSUPPORTED_BACKEND', 2],
    [['schema'], {}, 'USAGE', 2],
    [['schema', 'nope'], {}, 'UNKNOWN_KIND', 2],
    [['kinds', 'x'], {}, 'USAGE', 2],
    [['validate'], {}, 'USAGE', 2],
    [['render', '/does/not/exist', '-o', 'x.svg'], {}, 'INPUT_READ_FAILED', 4],
    [['render', '-', '-o', 'x.svg'], { input: '{' }, 'INVALID_JSON', 2],
    [['validate', '-'], { input: '{' }, 'INVALID_JSON', 2],
    [['render', '-', '-o', 'x.svg'], { input: Buffer.from([0xff]) }, 'INVALID_ENCODING', 2],
    [['render', '-', '-o', 'x.svg'], { input: ' '.repeat(MAX_INPUT_BYTES + 1) }, 'INPUT_TOO_LARGE', 2],
  ]) {
    const result = cli(args, options);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, code);
    assert.equal(result.stderr.trim().split('\n').length, 1);
  }
});
test('CLI validate, schema and kinds print JSON on stdout', async () => {
  let result = cli(['validate', '-'], { input: JSON.stringify(minimalV2) });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { valid: true, kind: 'class', version: 2 });
  result = cli(['validate', '-'], { input: JSON.stringify(minimal) });
  assert.deepEqual(JSON.parse(result.stdout), { valid: true, kind: 'class', version: 1 });
  result = cli(['validate', '-'], { input: JSON.stringify({ kind: 'class', elements: [{ id: 'a', type: 'class', name: 'A' }], relationships: [{ type: 'association', from: 'a', to: 'b' }] }) });
  assert.equal(result.status, 2);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'MISSING_REFERENCE');
  assert.equal(error.path, '/relationships/0/to');
  assert.equal(error.diagnostics.length, 1);
  result = cli(['schema', 'class']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).properties.kind.const, 'class');
  result = cli(['kinds']);
  const listed = JSON.parse(result.stdout);
  assert.equal(listed[0].kind, 'class');
  assert.deepEqual(listed[0].backends, ['engine', 'plantuml']);
  for (const kind of ['object', 'package', 'profile']) assert.ok(listed.some(k => k.kind === kind), kind);
  for (const kind of ['communication', 'interaction-overview', 'component', 'deployment', 'composite-structure']) {
    assert.deepEqual(listed.find(k => k.kind === kind)?.backends, ['engine'], kind);
    assert.equal(JSON.parse(cli(['schema', kind]).stdout).properties.kind.const, kind);
  }
  assert.deepEqual(listed.find(k => k.kind === 'activity')?.backends, ['plantuml']);
  for (const kind of ['state-machine', 'use-case']) assert.deepEqual(listed.find(k => k.kind === kind)?.backends, ['engine'], kind);
  for (const kind of ['activity', 'state-machine', 'use-case']) assert.equal(JSON.parse(cli(['schema', kind]).stdout).properties.kind.const, kind);
});
test('invalid input never spawns renderer or creates/replaces output', async t => {
  const dir = await workspace(t), out = join(dir, 'out.svg'), marker = join(dir, 'spawned');
  const java = await fakeJava(dir, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned');`);
  const env = { ...process.env, UML_JAVA: java, PLANTUML_JAR: 'unused' };
  const invalid = JSON.stringify({ ...minimal, relationships: [{ type: 'inheritance', from: 'a', to: 'missing' }] });
  assert.equal(cli(['render', '-', '-o', out, ...plantuml], { input: invalid, env }).status, 2);
  await assert.rejects(access(out));
  await writeFile(out, 'keep me');
  for (const [input, code] of [
    [invalid, 'MISSING_REFERENCE'],
    ['{', 'INVALID_JSON'],
    [JSON.stringify({ ...minimal, extra: true }), 'SCHEMA_INVALID'],
    [JSON.stringify({ ...minimal, classes: [minimal.classes[0], minimal.classes[0]] }), 'DUPLICATE_ID'],
    [JSON.stringify({ ...minimal, classes: [{ id: 'a', name: '￾' }] }), 'SCHEMA_INVALID'],
    [JSON.stringify({ ...minimal, classes: [{ id: 'a', name: '\ud800' }] }), 'INVALID_TEXT'],
    [JSON.stringify({ ...minimal, relationships: [{ type: 'inheritance', from: 'a', to: 'a' }] }), 'INHERITANCE_CYCLE'],
    [JSON.stringify({ ...minimalV2, kind: 'nope' }), 'UNKNOWN_KIND'],
  ]) {
    for (const extra of [plantuml, []]) {
      const result = cli(['render', '-', '-o', out, ...extra], { input, env });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stderr).error.code, code);
      assert.equal(await readFile(out, 'utf8'), 'keep me');
    }
  }
  await assert.rejects(access(marker));
});
test('CLI renders SVG and PNG with the own engine without Java', async t => {
  const dir = await workspace(t);
  const env = { ...process.env, UML_JAVA: join(dir, 'missing-java'), PLANTUML_JAR: 'unused' };
  let result = cli(['render', '-', '-o', join(dir, 'a.svg')], { input: JSON.stringify(minimalV2), env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout + result.stderr, '');
  assert.match(await readFile(join(dir, 'a.svg'), 'utf8'), /^<svg [^>]*data-uml-renderer="engine"/);
  result = cli(['render', '-', '-o', join(dir, 'a.png')], { input: JSON.stringify(minimal), env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([...(await readFile(join(dir, 'a.png'))).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  result = cli(['render', '-', '-o', join(dir, 'b.out'), '--format', 'png', '--scale', '1'], { input: JSON.stringify(minimal), env });
  assert.equal(result.status, 0, result.stderr);
});
test('CLI runtime failures preserve output, success supports stdin and atomic replacement', async t => {
  const dir = await workspace(t), out = join(dir, 'out.svg');
  await writeFile(out, 'original');
  const env = { ...process.env, UML_JAVA: join(dir, 'missing'), PLANTUML_JAR: 'unused' };
  let result = cli(['render', '-', '-o', out, ...plantuml], { input: JSON.stringify(minimal), env });
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stderr).error.code, 'RENDER_START_FAILED');
  assert.equal(await readFile(out, 'utf8'), 'original');
  for (const [body, code] of [
    ['process.exit(7)', 'RENDER_FAILED'],
    ['process.stdout.write("not svg")', 'RENDER_INVALID_OUTPUT'],
    ['process.stderr.write("x".repeat(70000))', 'RENDER_OUTPUT_LIMIT'],
    ['process.stdout.write("x".repeat(8 * 1024 * 1024 + 1))', 'RENDER_OUTPUT_LIMIT'],
  ]) {
    env.UML_JAVA = await fakeJava(dir, body);
    result = cli(['render', '-', '-o', out, ...plantuml], { input: JSON.stringify(minimal), env });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stderr).error.code, code);
    assert.equal(await readFile(out, 'utf8'), 'original');
  }
  env.UML_JAVA = await fakeJava(dir, `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(fakeSvg)}));`);
  // The fake renderer's empty drawing fails the literal-text gate: --strict refuses it and keeps the old output...
  result = cli(['render', '-', '-o', out, '--strict', ...plantuml], { input: JSON.stringify(minimal), env });
  assert.equal(result.status, 5, result.stderr);
  assert.equal(JSON.parse(result.stderr).error.code, 'LAYOUT_QUALITY');
  assert.equal(JSON.parse(result.stderr).error.details.warnings[0].gate, 'literal-text');
  assert.equal(await readFile(out, 'utf8'), 'original');
  // ...and without --strict the drawing is written, exit 0, with one JSON warnings object on stderr.
  result = cli(['render', '-', '-o', out, ...plantuml], { input: JSON.stringify(minimal), env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const { warnings } = JSON.parse(result.stderr);
  assert.deepEqual(warnings.map(w => [w.code, w.gate, w.count]), [['LAYOUT_QUALITY', 'literal-text', 1]]);
  assert.match(warnings[0].message, /input text "A" is not drawn literally/);
  assert.ok(warnings[0].advice);
  assert.equal(await readFile(out, 'utf8'), fakeSvg);
  await assert.rejects(writeOutput(join(dir, 'missing', 'out.svg'), Buffer.from(fakeSvg)), { code: 'OUTPUT_WRITE_FAILED' });
  const directoryOutput = join(dir, 'directory.svg');
  await mkdir(directoryOutput);
  await writeFile(join(directoryOutput, 'keep'), 'original directory');
  await assert.rejects(writeOutput(directoryOutput, Buffer.from(fakeSvg)), { code: 'OUTPUT_WRITE_FAILED' });
  assert.equal(await readFile(join(directoryOutput, 'keep'), 'utf8'), 'original directory');
  assert.ok(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
  // Existing targets that are not regular files are written directly (no rename over a device).
  await writeOutput('/dev/null', Buffer.from(fakeSvg));
  result = cli(['render', join(root, 'examples/class/ordering.json'), '-o', '/dev/null', '--format', 'svg']);
  assert.equal(result.status, 0, result.stderr);
  result = cli(['render', join(root, 'examples/class/ordering.json'), '-o', '/dev/stdout', '--format', 'svg']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^<svg /u);
});

test('missing or malformed manifests and partial overrides report RENDERER_MISSING', async t => {
  const dir = await workspace(t), saved = { java: process.env.UML_JAVA, jar: process.env.PLANTUML_JAR };
  delete process.env.UML_JAVA;
  delete process.env.PLANTUML_JAR;
  try {
    await assert.rejects(rendererOptions(dir), { code: 'RENDERER_MISSING' });
    for (const content of ['{', 'null', '[]', '{}', '{"java":3,"jar":{}}', '{"java":"","jar":"x"}', JSON.stringify({ java: 'x\0y', jar: 'x' })]) {
      await writeFile(join(dir, 'renderer.json'), content);
      await assert.rejects(rendererOptions(dir), { code: 'RENDERER_MISSING' });
    }
    await writeFile(join(dir, 'renderer.json'), JSON.stringify({ java: 'bin/java', jar: 'plantuml.jar' }));
    assert.deepEqual(await rendererOptions(dir), { java: join(dir, 'bin/java'), jar: join(dir, 'plantuml.jar') });
    process.env.UML_JAVA = '/trusted/java';
    await assert.rejects(rendererOptions(dir), { code: 'RENDERER_MISSING' });
    process.env.PLANTUML_JAR = '/trusted/tool.jar';
    assert.deepEqual(await rendererOptions(dir), { java: '/trusted/java', jar: '/trusted/tool.jar' });
  } finally {
    for (const [key, value] of [['UML_JAVA', saved.java], ['PLANTUML_JAR', saved.jar]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('SIGINT and SIGTERM stop the renderer, return structured errors and preserve output', { timeout: 20_000 }, async t => {
  const dir = await workspace(t), out = join(dir, 'out.svg');
  for (const [signal, expected] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const pidFile = join(dir, `pid-${signal}`);
    await writeFile(out, 'keep');
    const java = await fakeJava(dir, `
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      process.stdin.resume();
      setInterval(() => {}, 1000);
    `);
    const events = watch(dir);
    const child = spawn(process.execPath, [join(import.meta.dirname, '../dist/cli.js'), 'render', '-', '-o', out, ...plantuml], {
      env: { ...process.env, UML_JAVA: java, PLANTUML_JAR: 'unused' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => { child.kill('SIGKILL'); events.return(); });
    let stderr = '', stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => { stdout += chunk; });
    const closed = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    child.stdin.end(JSON.stringify(minimal));
    for await (const event of events) if (event.filename === `pid-${signal}`) break;
    const pid = Number(await readFile(pidFile, 'utf8'));
    child.kill(signal);
    assert.equal(await closed, expected);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).error.code, 'RENDER_INTERRUPTED');
    assert.equal(await readFile(out, 'utf8'), 'keep');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});
