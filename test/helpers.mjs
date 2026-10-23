import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import { renderAndCheck } from '../dist/qa/index.js';
import { rendererOptions } from '../dist/plantuml/runner.js';
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

/**
 * Factor applied to every time budget. Coverage instrumentation slows the code
 * down about threefold, and shared CI runners are slower than a laptop, so both
 * widen the budget instead of making the test flaky.
 */
export const budgetFactor = (process.env.NODE_V8_COVERAGE ? 3 : 1) * (process.env.CI ? 2 : 1);

/**
 * Runs `work` and asserts that it used less than `ms` of CPU time (user plus
 * system, times budgetFactor). CPU time rather than wall-clock time, so that a
 * machine busy with other test files does not fail a render that is itself fast.
 * Returns the result of `work` and the CPU time in ms.
 */
export async function assertCpuBudget(work, ms = 2000, label = 'stress render') {
  const start = process.cpuUsage();
  const result = await work();
  const used = process.cpuUsage(start);
  const cpuMs = (used.user + used.system) / 1000;
  const limit = ms * budgetFactor;
  assert.ok(cpuMs < limit, `${label} used ${cpuMs.toFixed(0)} ms of CPU time, budget ${limit} ms`);
  return { result, ms: cpuMs };
}

/** Whether the PlantUML runtime (npm run setup:renderer, or UML_JAVA and PLANTUML_JAR) is available. */
export const hasPlantUml = await rendererOptions().then(() => true, () => false);

/**
 * `test` for files that need the real PlantUML runtime. Without it every test
 * is reported as skipped with the reason, so a contributor without the runtime
 * still gets a green run. CI installs the runtime for the integration job.
 */
export const plantUmlTest = hasPlantUml
  ? nodeTest
  : (name, ...rest) => nodeTest(name, { skip: 'PlantUML runtime missing: run npm run setup:renderer' }, rest.at(-1));
