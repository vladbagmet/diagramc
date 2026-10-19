import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access, mkdir, readdir, watch } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseModel, MAX_INPUT_BYTES } from '../dist/model.js';
import { toPlantUml, displayText } from '../dist/plantuml.js';
import { renderSvg, rendererOptions } from '../dist/renderer.js';
import { writeOutput } from '../dist/io.js';
import { cli, workspace, fakeJava, minimal, fakeSvg } from './helpers.mjs';

const parse = model => parseModel(JSON.stringify(model));
const fails = (model, code) => assert.throws(() => parse(model), { code });

test('valid minimal, Unicode and display-only members', () => {
  assert.deepEqual(parse(minimal), minimal);
  const model = { classes: [{ id: 'z', name: 'Zoë · 注文 🚀', attributes: ['+f(): T', 'List<T>'], methods: ['not parsed as code'] }], relationships: [] };
  assert.deepEqual(parse(model), model);
});
test('schema rejects unknown fields at every level, unsupported types and nonstrings', () => {
  for (const model of [
    { ...minimal, layout: 'LR' },
    { ...minimal, classes: [{ ...minimal.classes[0], color: 'red' }] },
    { ...minimal, relationships: [{ type: 'association', from: 'a', to: 'a', color: 'red' }] },
    { ...minimal, relationships: [{ type: 'composition', from: 'a', to: 'a' }] },
    { ...minimal, classes: [{ id: 'a', name: 3 }] },
    { classes: [] },
  ]) fails(model, 'SCHEMA_INVALID');
});
test('bounds and stable ID syntax', () => {
  for (const name of ['', 'x'.repeat(101)]) fails({ ...minimal, classes: [{ id: 'a', name }] }, 'SCHEMA_INVALID');
  parse({ ...minimal, classes: [{ id: 'a', name: '🚀'.repeat(100) }] });
  fails({ ...minimal, classes: [{ id: 'a', name: '🚀'.repeat(101) }] }, 'SCHEMA_INVALID');
  fails({ ...minimal, classes: Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, name: 'C' })) }, 'SCHEMA_INVALID');
  fails({ ...minimal, classes: [{ id: 'a', name: 'A', attributes: Array(21).fill('x') }] }, 'SCHEMA_INVALID');
  fails({ ...minimal, classes: [{ id: 'a', name: 'A', methods: ['x'.repeat(181)] }] }, 'SCHEMA_INVALID');
  fails({ ...minimal, relationships: Array(101).fill({ type: 'association', from: 'a', to: 'a' }) }, 'SCHEMA_INVALID');
  for (const id of ['!include', 'a\nb', 'a\n', 'a\r', 'x'.repeat(65), 'a" {}']) fails({ ...minimal, classes: [{ id, name: 'A' }] }, 'SCHEMA_INVALID');
  assert.throws(() => parseModel(' '.repeat(MAX_INPUT_BYTES + 1)), { code: 'INPUT_TOO_LARGE' });
  assert.throws(() => parseModel('{'), { code: 'INVALID_JSON' });
});
test('duplicate IDs, missing references and prototype-like IDs', () => {
  fails({ ...minimal, classes: [minimal.classes[0], minimal.classes[0]] }, 'DUPLICATE_ID');
  for (const r of [{ from: 'a', to: 'missing' }, { from: 'missing', to: 'a' }]) {
    fails({ ...minimal, relationships: [{ type: 'association', ...r }] }, 'MISSING_REFERENCE');
  }
  parse({ classes: [{ id: 'constructor', name: 'Constructor' }, { id: 'toString', name: 'ToString' }], relationships: [{ type: 'inheritance', from: 'constructor', to: 'toString' }] });
});
test('inheritance direction, cycles, self-inheritance and legal association cycles', () => {
  const model = { classes: [{ id: 'a', name: 'Child' }, { id: 'b', name: 'Parent' }], relationships: [{ type: 'inheritance', from: 'a', to: 'b' }] };
  assert.match(toPlantUml(parse(model)), /uml_c0 --\|> uml_c1/);
  fails({ ...minimal, relationships: [{ type: 'inheritance', from: 'a', to: 'a' }] }, 'INHERITANCE_CYCLE');
  fails({ ...model, relationships: [...model.relationships, { type: 'inheritance', from: 'b', to: 'a' }] }, 'INHERITANCE_CYCLE');
  parse({ ...model, relationships: [{ type: 'association', from: 'a', to: 'b' }, { type: 'association', from: 'b', to: 'a' }] });
});
test('rejects line breaks, controls, blank text, bidi controls, invalid XML characters and unpaired surrogates', () => {
  for (const text of ['A\n@enduml', 'A\n', 'A\r', 'A\r\n', 'A\u2028', 'A\u2029', 'x\r!include a', 'x\tY', '\0', '\u0085', '\u2028', '\u2029', '\ufffe', '\uffff']) {
    for (const field of ['name', 'attributes', 'methods']) {
      fails({ ...minimal, classes: [{ id: 'a', name: 'A', [field]: field === 'name' ? text : [text] }] }, 'SCHEMA_INVALID');
    }
    fails({ ...minimal, relationships: [{ type: 'association', from: 'a', to: 'a', label: text }] }, 'SCHEMA_INVALID');
  }
  for (const name of [' ', '\ud800', '\u202eEvil']) fails({ ...minimal, classes: [{ id: 'a', name }] }, 'INVALID_TEXT');
});
test('hostile display text is encoded, never used as source syntax or IDs', () => {
  const text = '" } !include https://evil.invalid <img:x> [[url]] **bold** \\n @enduml';
  const model = { classes: [{ id: 'private_id', name: text, attributes: [text], methods: [text] }], relationships: [{ type: 'association', from: 'private_id', to: 'private_id', label: text }] };
  const source = toPlantUml(parse(model));
  assert.ok(!source.includes(text));
  assert.ok(!source.includes('private_id'));
  assert.equal(source.split('\n').filter(x => x === '@enduml').length, 1);
  assert.match(displayText('"{}<>\\'), /^\u200b(<U\+[0-9A-F]+>)+\u200b$/);
  assert.equal(source, toPlantUml(parse(model)));
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
test('renderer reports spawn, failure, malformed output, timeout and output limits', async t => {
  const dir = await workspace(t);
  await assert.rejects(renderSvg('x', { java: join(dir, 'missing'), jar: 'x' }), { code: 'RENDER_START_FAILED' });
  for (const [body, code, opts] of [
    ['process.exit(7)', 'RENDER_FAILED', {}],
    ['process.stdout.write("not svg")', 'RENDER_INVALID_OUTPUT', {}],
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
  assert.match(cli(['render', '--help']).stdout, /subclass to superclass/);
  assert.equal(cli(['--version']).stdout, '0.1.0\n');
  for (const [args, options, code, status] of [
    [[], {}, 'USAGE', 2],
    [['render', '-', '--unknown', 'x.svg'], {}, 'USAGE', 2],
    [['render', '-o', '-o', 'x.svg'], {}, 'USAGE', 2],
    [['render', '-', '-o', 'x.png'], {}, 'USAGE', 2],
    [['render', '/does/not/exist', '-o', 'x.svg'], {}, 'INPUT_READ_FAILED', 4],
    [['render', '-', '-o', 'x.svg'], { input: '{' }, 'INVALID_JSON', 2],
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
test('invalid input never spawns renderer or creates/replaces output', async t => {
  const dir = await workspace(t), out = join(dir, 'out.svg'), marker = join(dir, 'spawned');
  const java = await fakeJava(dir, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned');`);
  const env = { ...process.env, UML_JAVA: java, PLANTUML_JAR: 'unused' };
  const invalid = JSON.stringify({ ...minimal, relationships: [{ type: 'inheritance', from: 'a', to: 'missing' }] });
  assert.equal(cli(['render', '-', '-o', out], { input: invalid, env }).status, 2);
  await assert.rejects(access(out));
  await writeFile(out, 'keep me');
  for (const [input, code] of [
    [invalid, 'MISSING_REFERENCE'],
    ['{', 'INVALID_JSON'],
    [JSON.stringify({ ...minimal, extra: true }), 'SCHEMA_INVALID'],
    [JSON.stringify({ ...minimal, classes: [minimal.classes[0], minimal.classes[0]] }), 'DUPLICATE_ID'],
    [JSON.stringify({ ...minimal, classes: [{ id: 'a', name: '\ufffe' }] }), 'SCHEMA_INVALID'],
    [JSON.stringify({ ...minimal, classes: [{ id: 'a', name: '\ud800' }] }), 'INVALID_TEXT'],
    [JSON.stringify({ ...minimal, relationships: [{ type: 'inheritance', from: 'a', to: 'a' }] }), 'INHERITANCE_CYCLE'],
  ]) {
    const result = cli(['render', '-', '-o', out], { input, env });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stderr).error.code, code);
    assert.equal(await readFile(out, 'utf8'), 'keep me');
  }
  await assert.rejects(access(marker));
});
test('CLI runtime failures preserve output, success supports stdin and atomic replacement', async t => {
  const dir = await workspace(t), out = join(dir, 'out.svg');
  await writeFile(out, 'original');
  const env = { ...process.env, UML_JAVA: join(dir, 'missing'), PLANTUML_JAR: 'unused' };
  let result = cli(['render', '-', '-o', out], { input: JSON.stringify(minimal), env });
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
    result = cli(['render', '-', '-o', out], { input: JSON.stringify(minimal), env });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stderr).error.code, code);
    assert.equal(await readFile(out, 'utf8'), 'original');
  }
  env.UML_JAVA = await fakeJava(dir, `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(fakeSvg)}));`);
  result = cli(['render', '-', '-o', out], { input: JSON.stringify(minimal), env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(await readFile(out, 'utf8'), fakeSvg);
  await assert.rejects(writeOutput(join(dir, 'missing', 'out.svg'), Buffer.from(fakeSvg)), { code: 'OUTPUT_WRITE_FAILED' });
  const directoryOutput = join(dir, 'directory.svg');
  await mkdir(directoryOutput);
  await writeFile(join(directoryOutput, 'keep'), 'original directory');
  await assert.rejects(writeOutput(directoryOutput, Buffer.from(fakeSvg)), { code: 'OUTPUT_WRITE_FAILED' });
  assert.equal(await readFile(join(directoryOutput, 'keep'), 'utf8'), 'original directory');
  assert.ok(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
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

test('SIGINT and SIGTERM stop the renderer, return structured errors and preserve output', { timeout: 10_000 }, async t => {
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
    const child = spawn(process.execPath, [join(import.meta.dirname, '../dist/cli.js'), 'render', '-', '-o', out], {
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
