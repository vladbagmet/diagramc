// Shared helpers for the structural kinds' tests (component, deployment, composite structure).
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { contains } from '../dist/engine/geometry.js';
import { assertGates, root } from './helpers.mjs';

export const fixtures = (kind, name) => readFile(join(root, 'test/fixtures', kind, name), 'utf8').then(JSON.parse);
export const examples = async kind => (await readdir(join(root, 'examples', kind))).filter(f => f.endsWith('.json')).sort().map(f => join(root, 'examples', kind, f));

/** Renders a document and returns its SVG and inspected scene. */
export async function scene(doc) {
  const svg = await renderToSvg(parseDocument(typeof doc === 'string' ? doc : JSON.stringify(doc)));
  return { svg, scene: await inspectSvg(svg) };
}

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

export async function assertExamples(kind, minimum = 3) {
  const files = await examples(kind);
  assert.ok(files.length >= minimum, `at least ${minimum} examples`);
  for (const file of files) {
    try { await assertGates(await readFile(file, 'utf8')); } catch (error) { error.message = `${file}: ${error.message}`; throw error; }
  }
}

/** The stress example renders within the own-engine budget (2 s). */
export async function assertBudget(kind) {
  const text = await readFile(join(root, 'examples', kind, 'stress.json'), 'utf8');
  const parsed = parseDocument(text);
  const started = performance.now();
  await renderToSvg(parsed);
  const ms = performance.now() - started;
  assert.ok(ms < 2000, `stress render took ${ms.toFixed(0)} ms`);
  return { doc: JSON.parse(text), ms };
}

export async function assertDeterministic(file) {
  const parsed = parseDocument(await readFile(join(root, file), 'utf8'));
  assert.equal(await renderToSvg(parsed), await renderToSvg(parsed));
}

/** Hostile text stays literal: no active markup, every string drawn as given. */
export async function assertHostile(doc, strings) {
  const { svg } = await assertGates(doc);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
  // Attributes are checked by parsing (the safe-markup gate): escaped text inside
  // aria-label or <title> may legitimately contain "onload=" literally.
  const s = await inspectSvg(svg);
  assert.deepEqual(s.unsafe, []);
  for (const text of strings) assert.ok(s.texts.some(t => t.content.includes(text)), `missing literal ${JSON.stringify(text)}`);
  return s;
}

export const text = (s, content) => s.texts.find(t => t.content === content);
/** A text element containing `content` (multi-line labels are one element with one tspan per line). */
export const textIncluding = (s, content) => s.texts.find(t => t.content.includes(content));
export const node = (s, id) => s.nodes.find(n => n.id === id);
export const edgeGroup = (svg, id) => svg.match(new RegExp(`<g data-uml-role="edge" data-uml-id="${id.replace(/[/:]/g, m => `\\${m}`)}"[^>]*><path [^>]*>`))?.[0];
export const dashed = (svg, id) => /stroke-dasharray/.test(edgeGroup(svg, id) ?? '');
export const nodeGroup = (svg, id) => {
  const start = svg.indexOf(`data-uml-id="${id}"`);
  return start < 0 ? '' : svg.slice(svg.lastIndexOf('<g', start), svg.indexOf('</g>', start));
};
export const inside = (outer, inner) => contains(outer.bounds, inner.bounds);
