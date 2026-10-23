import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { findKind } from '../dist/model/registry.js';
import { assertGates, plantUmlTest, root } from './helpers.mjs';

// Models written by reviewers who had never seen the engine (awkward names, deep
// nesting, parallel relationships, self-loops, notes on many targets). Each one
// exposed layout defects that the gates now catch; all must pass every gate.
const dir = join(root, 'test/fixtures/regression');

for (const file of (await readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
  const text = await readFile(join(dir, file), 'utf8');
  // Kinds whose default renderer is PlantUML need its runtime and skip without it.
  const plantUml = findKind(JSON.parse(text).kind ?? 'class')?.backends[0]?.name === 'plantuml';
  (plantUml ? plantUmlTest : test)(`regression model ${file} passes every QA gate`, async () => {
    await assertGates(text);
  });
}
