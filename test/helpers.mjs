import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { renderAndCheck } from '../dist/qa/index.js';
import { judgementMessage } from './known-gate-failures.mjs';

export const root = resolve(import.meta.dirname, '..');
export async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uml-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
export async function fakeJava(dir, code, name = 'java') {
  const path = join(dir, name);
  await writeFile(path, `#!${process.execPath}\n${code}\n`);
  await chmod(path, 0o755);
  return path;
}
export function cli(args, options = {}) {
  return spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 60_000, ...options,
  });
}
/** Smallest valid v1 document (MVP format). */
export const minimal = { classes: [{ id: 'a', name: 'A' }], relationships: [] };
/** Smallest valid v2 class document. */
export const minimalV2 = { kind: 'class', elements: [{ id: 'a', type: 'class', name: 'A' }] };
export const fakeSvg = '<svg xml:space="preserve" data-diagram-type="CLASS"></svg>';

/**
 * Renders a document (own engine by default) and asserts that every QA gate
 * passes, apart from the problems listed for it in KNOWN_GATE_FAILURES
 * (test/known-gate-failures.mjs). Returns the SVG, the gate report and the render
 * time in ms.
 */
export async function assertGates(document, options = {}) {
  const result = await renderAndCheck(document, options);
  const failures = result.report.gates.filter(g => !g.ok).map(g => ({ gate: g.gate, problems: g.failures }));
  const message = judgementMessage(document, failures);
  assert.ok(!message, message);
  return result;
}
