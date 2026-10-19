import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { assertGates, root } from './helpers.mjs';

/** Shared checks for own-engine kinds: fixtures, examples, budget, determinism. */
export const fixtures = (kind, name) => readFile(join(root, 'test/fixtures', kind, name), 'utf8').then(JSON.parse);
export const exampleFiles = async kind => (await readdir(join(root, 'examples', kind))).filter(f => f.endsWith('.json')).sort().map(f => join(root, 'examples', kind, f));

export async function assertNegativeFixtures(kind, minimum) {
  const cases = await fixtures(kind, 'invalid.json');
  assert.ok(cases.length >= minimum, `at least ${minimum} negative fixtures`);
  for (const c of cases) {
    assert.throws(() => parseDocument(JSON.stringify(c.doc)), error => {
      assert.equal(error.code, c.expect.code, `${c.name}: ${error.message}`);
      assert.equal(error.path, c.expect.path, `${c.name}: ${error.message}`);
      return true;
    }, c.name);
  }
}

export async function assertPositiveFixtures(kind) {
  for (const c of await fixtures(kind, 'valid.json')) {
    try { await assertGates(c.doc); } catch (error) { error.message = `${c.name}: ${error.message}`; throw error; }
  }
}

export async function assertExamples(kind) {
  const files = await exampleFiles(kind);
  assert.ok(files.length >= 3, 'at least three examples');
  for (const name of ['minimal.json', 'stress.json']) assert.ok(files.some(f => f.endsWith(name)), `example ${name}`);
  for (const file of files) await assertGates(await readFile(file, 'utf8'));
}

/** Renders a document (object or JSON text) and returns the SVG and its inspected scene. */
export async function render(document) {
  const svg = await renderToSvg(parseDocument(typeof document === 'string' ? document : JSON.stringify(document)));
  return { svg, scene: await inspectSvg(svg) };
}

export async function renderExample(kind, name) {
  return render(await readFile(join(root, 'examples', kind, `${name}.json`), 'utf8'));
}

/** True when the edge group of `id` draws a dashed line. */
export function dashed(svg, id) {
  const group = svg.match(new RegExp(`<g data-uml-role="edge" data-uml-id="${id.replaceAll('>', '&gt;')}"[^>]*><path [^>]*>`));
  assert.ok(group, `edge ${id} drawn`);
  return /stroke-dasharray/.test(group[0]);
}

/** Underline segments (`<line ... stroke-width="0.9"/>`) as [x1, y1, x2]. */
export function underlines(svg) {
  return [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="[\d.]+" stroke="#[0-9A-F]{6}" stroke-width="0.9"\/>/g)].map(m => m.slice(1, 4).map(Number));
}

/** True when a text's bounds have an underline directly beneath them. */
export function isUnderlined(svg, text) {
  return underlines(svg).some(([x1, y1, x2]) => Math.abs(x1 - text.bounds.x) < 0.5 && Math.abs(x2 - (text.bounds.x + text.bounds.width)) < 1 && y1 > text.bounds.y && y1 < text.bounds.y + text.bounds.height + 3);
}

export async function assertBudget(kind, ms = 2000) {
  const text = await readFile(join(root, 'examples', kind, 'stress.json'), 'utf8');
  const started = performance.now();
  await renderToSvg(parseDocument(text));
  const took = performance.now() - started;
  assert.ok(took < ms, `stress render took ${took.toFixed(0)} ms`);
}

export async function assertDeterministic(kind, name) {
  const parsed = parseDocument(await readFile(join(root, 'examples', kind, `${name}.json`), 'utf8'));
  assert.equal(await renderToSvg(parsed), await renderToSvg(parsed));
}

export async function assertHostileTextIsLiteral(document, literal) {
  const { svg } = await assertGates(document);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
  assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
  const scene = await inspectSvg(svg);
  for (const text of literal) assert.ok(scene.texts.some(t => t.content.includes(text)), `literal ${JSON.stringify(text)}`);
  return svg;
}
