import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { renderDocument } from '../../dist/render.js';
import { rendererOptions } from '../../dist/plantuml/runner.js';
import { exportDocument } from '../../dist/formats/index.js';
import { kinds } from '../../dist/model/registry.js';
import { ROUND_TRIP, examples, roundTrip } from '../format-helpers.mjs';
import { LIMITS } from '../format-losses.mjs';
import { plantUmlTest as test, root, workspace } from '../helpers.mjs';

// Exported PlantUML must be real PlantUML: every example of every kind is
// exported and rendered by the pinned PlantUML, all in one run. Graph layouts
// use Smetana, PlantUML's built-in layout (the exported text leaves the choice
// to the reader, who usually has Graphviz).

test('every example of every kind exports to PlantUML that PlantUML renders without an error', async t => {
  const dir = await workspace(t);
  const files = [];
  for (const { kind } of kinds) {
    for (const { name, text } of await examples(kind)) {
      const { text: puml } = exportDocument(parseDocument(text), 'plantuml');
      const file = join(dir, `${name.replaceAll(/[/.]/gu, '-')}.puml`);
      await writeFile(file, puml.replace(/^@startuml\n/u, '@startuml\n!pragma layout smetana\n'));
      files.push(file);
    }
  }
  assert.ok(files.length >= 50, `only ${files.length} examples`);
  const { java, jar } = await rendererOptions();
  const result = spawnSync(
    java,
    [
      '-Djava.awt.headless=true',
      '-jar',
      jar,
      '-tsvg',
      '-failfast2',
      '-charset',
      'UTF-8' /* eslint-disable-line unicorn/text-encoding-identifier-case -- Java's name for the charset */,
      ...files,
    ],
    {
      encoding: 'utf8',
      timeout: 300_000,
      env: { ...process.env, PLANTUML_SECURITY_PROFILE: 'SECURE' },
    },
  );
  assert.equal(result.status, 0, `PlantUML failed: ${result.stdout}${result.stderr}`);
  const svgs = (await readdir(dir)).filter(f => f.endsWith('.svg'));
  assert.equal(svgs.length, files.length, 'one drawing per exported example');
  for (const svg of svgs) {
    const content = await readFile(join(dir, svg), 'utf8');
    assert.match(content, /^<svg\b/u, svg);
    assert.doesNotMatch(content, /Syntax Error|Cannot find Graphviz/u, svg);
  }
});

// An imported model is a normal model: it validates (importText already ran
// diagramc validate's checks) and renders with its kind's backend.

for (const [format, list] of Object.entries(ROUND_TRIP)) {
  test(`every ${format} round trip of the examples renders (${list.join(', ')})`, async () => {
    for (const kind of list) {
      for (const { name, text } of await examples(kind)) {
        if (LIMITS[`${format} ${name}`]) continue;
        const { imported } = roundTrip(text, format);
        const svg = await renderDocument(parseDocument(JSON.stringify(imported)), 'svg');
        assert.ok(svg.length > 500 && svg.toString('utf8').includes('<svg'), `${name} via ${format}`);
      }
    }
  });
}

test('the CLI round trip: export to a .puml file, import it back and render it', async t => {
  const dir = await workspace(t);
  const run = args => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  let r = run(['export', join(root, 'examples/sequence/checkout.json'), '-o', join(dir, 'checkout.puml')]);
  assert.equal(r.status, 0, r.stderr);
  r = run(['import', join(dir, 'checkout.puml'), '-o', join(dir, 'checkout.json')]);
  assert.equal(r.status, 0, r.stderr);
  r = run(['render', join(dir, 'checkout.json'), '-o', join(dir, 'checkout.svg')]);
  assert.equal(r.status, 0, r.stderr);
});
