import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { renderChecked } from '../../dist/render.js';
import { cli, root, workspace } from '../helpers.mjs';

// `uml render` runs the QA gates on every drawing: no example, regression or
// review model may produce a layout warning, so `--strict` passes on all of them.
const jsonFiles = async dir => (await readdir(join(root, dir))).filter(f => f.endsWith('.json')).sort().map(f => join(root, dir, f));

test('every example and regression model renders without layout warnings (--strict passes)', async () => {
  const kinds = (await readdir(join(root, 'examples'))).filter(d => !d.includes('.'));
  const files = [...(await Promise.all(kinds.map(k => jsonFiles(`examples/${k}`)))).flat(), ...await jsonFiles('test/fixtures/regression')];
  assert.ok(files.length >= 60);
  for (const file of files) {
    const parsed = parseDocument(await readFile(file, 'utf8'));
    const { warnings } = await renderChecked(parsed, 'svg');
    assert.deepEqual(warnings, [], `${file}: ${warnings.map(w => w.message).join(' ')}`);
  }
});

test('--strict through the CLI: exit 0 and no stderr for an example; exit 5 for a drawing that fails a gate', async t => {
  const dir = await workspace(t);
  let result = cli(['render', join(root, 'examples/activity/order-handling.json'), '-o', join(dir, 'a.svg'), '--strict']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  // The reviewers' deeply nested cross-swimlane activity still has lines through decisions.
  const awkward = join(root, 'test/fixtures/review/act-awkward.json');
  result = cli(['render', awkward, '-o', join(dir, 'b.svg')]);
  assert.equal(result.status, 0);
  const { warnings } = JSON.parse(result.stderr);
  assert.ok(warnings.length >= 1 && warnings.every(w => w.code === 'LAYOUT_QUALITY' && w.gate && w.count >= 1 && w.problems.length && w.advice));
  result = cli(['render', awkward, '-o', join(dir, 'c.svg'), '--strict']);
  assert.equal(result.status, 5);
  assert.equal(JSON.parse(result.stderr).error.code, 'LAYOUT_QUALITY');
  await assert.rejects(readFile(join(dir, 'c.svg')), 'nothing is written under --strict');
});
