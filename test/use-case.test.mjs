import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { distanceToEllipse } from '../dist/engine/geometry.js';
import { assertGates, cli, root, workspace } from './helpers.mjs';

// Use case diagrams are drawn by the own engine (see docs/decisions/0002-state-machine-and-use-case-backend.md).
const fixtures = name => readFile(join(root, 'test/fixtures/use-case', name), 'utf8').then(JSON.parse);
const examples = async () => (await readdir(join(root, 'examples/use-case'))).filter(f => f.endsWith('.json')).sort().map(f => join(root, 'examples/use-case', f));
const svgOf = async doc => renderToSvg(parseDocument(typeof doc === 'string' ? doc : JSON.stringify(doc)));

test('use case: negative fixtures fail with the exact code and JSON path', async () => {
  const cases = await fixtures('invalid.json');
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    assert.throws(() => parseDocument(JSON.stringify(c.doc)), error => {
      assert.equal(error.code, c.expect.code, `${c.name}: ${error.message}`);
      assert.equal(error.path, c.expect.path, `${c.name}: ${error.message}`);
      return true;
    }, c.name);
  }
});

test('use case: positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('use case: every example passes every QA gate and renders through the CLI as SVG and PNG', async t => {
  const dir = await workspace(t);
  for (const file of await examples()) {
    await assertGates(await readFile(file, 'utf8'));
    for (const ext of ['svg', 'png']) assert.equal(cli(['render', file, '-o', join(dir, `out.${ext}`)]).status, 0, file);
  }
});

test('use case: stress example (40 use cases, 9 actors, 2 subjects) renders within 2 s', async () => {
  const text = await readFile(join(root, 'examples/use-case/stress.json'), 'utf8');
  assert.equal(JSON.parse(text).elements.filter(e => e.type === 'useCase').length, 40);
  const started = performance.now();
  await svgOf(text);
  assert.ok(performance.now() - started < 2000);
});

test('use case: rendering is byte-identical across runs', async () => {
  const text = await readFile(join(root, 'examples/use-case/online-shop.json'), 'utf8');
  assert.equal(await svgOf(text), await svgOf(text));
});

test('use case: UML 2.5.1 notation of actors, use cases, subjects and relationships', async () => {
  const svg = await svgOf(await readFile(join(root, 'examples/use-case/notation.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  const node = id => scene.nodes.find(n => n.id === id);
  const group = id => svg.match(new RegExp(`<g data-uml-role="node" data-uml-id="${id}"[^>]*>(.*?)</g>`))?.[1] ?? '';
  const edge = (type, from, to) => scene.edges.find(e => e.type === type && e.source === from && e.target === to);
  // Actor: stick figure with its name below; use case: ellipse; subject: rectangle containing its use cases, name on top.
  assert.match(group('user'), /<circle/);
  const caption = scene.texts.find(t => t.content === 'Library user');
  assert.ok(caption.bounds.y >= node('user').bounds.y + node('user').bounds.height, 'actor name under the figure');
  assert.match(group('borrow'), /<ellipse/);
  assert.equal(node('borrow').shape, 'ellipse');
  for (const id of ['borrow', 'borrowBook', 'reserve', 'identify']) assert.equal(node(id).parent, 'lib');
  assert.equal(node('search').parent, undefined, 'use case outside the subject');
  const subject = node('lib').bounds, title = scene.texts.find(t => t.content === 'Lending desk');
  assert.ok(title.bold && title.bounds.y < subject.y + 40, 'subject name at the top');
  assert.ok(scene.texts.some(t => t.content === '«subsystem»'));
  assert.ok(scene.texts.some(t => t.content === '«system»'));
  // Extension points compartment: a line across the ellipse, heading and points.
  assert.match(group('borrow'), /<line /);
  assert.ok(scene.texts.some(t => t.content === 'extension points' && t.node === 'borrow'));
  assert.ok(scene.texts.some(t => t.content === 'no copy available' && t.node === 'borrow'));
  // «include»: base to included; «extend»: extension to base; dashed, open arrowheads at the target.
  const include = edge('include', 'borrow', 'identify'), extend = edge('extend', 'reserve', 'borrow');
  for (const e of [include, extend]) {
    assert.equal(e.targetMarker, 'open-arrow');
    assert.equal(e.sourceMarker, 'none');
    assert.match(svg, new RegExp(`data-uml-id="${e.id.replace('/', '\\/')}"[^>]*><path [^>]*stroke-dasharray`));
    assert.ok(distanceToEllipse(e.points.at(-1), node(e.target).bounds) < 1, 'line ends on the ellipse');
  }
  assert.ok(scene.texts.some(t => t.content === '«include»' && t.role === 'label'));
  assert.ok(scene.texts.some(t => t.content === '«extend»' && t.role === 'label'));
  // Condition note attached to the «extend» line itself.
  assert.ok(scene.texts.some(t => t.content.includes('Condition: {all copies on loan}') && t.content.includes('extension point: no copy available')));
  const anchor = scene.edges.find(e => e.type === 'note-anchor' && e.target === extend.id);
  assert.ok(anchor, 'condition note anchored to the extend relationship');
  // Generalization: solid line, hollow triangle at the general element.
  for (const [from, to] of [['student', 'user'], ['borrowBook', 'borrow']]) assert.equal(edge('generalization', from, to).targetMarker, 'hollow-triangle');
  // Association: solid, no arrowheads, multiplicities at the ends.
  const association = edge('association', 'user', 'borrow');
  assert.deepEqual([association.sourceMarker, association.targetMarker], ['none', 'none']);
  assert.equal(scene.texts.find(t => t.content === '0..*').end, 'target');
  assert.equal(scene.texts.find(t => t.content === '1' && t.role === 'label').end, 'source');
  assert.deepEqual(scene.texts.filter(t => t.role === 'frame-label').map(t => [t.content, t.bold]), [['uc ', true], ['Library', false]]);
});

test('use case: hostile text stays literal in every slot and creates no active SVG', async () => {
  for (const text of ['<script>alert(1)</script>', '" onload="x', '  spaced  ', '&amp; ]]> <![CDATA[', 'Unicode: 🚀 注文']) {
    const doc = {
      kind: 'use-case', title: text,
      elements: [
        { id: 'a', type: 'actor', name: text, stereotypes: [text] },
        { id: 's', type: 'subject', name: text, stereotypes: [text] },
        { id: 'u', type: 'useCase', name: text, subject: 's', extensionPoints: [text] },
        { id: 'w', type: 'useCase', name: 'W', subject: 's' },
        { id: 'n', type: 'note', text, attachedTo: ['u'] },
      ],
      relationships: [
        { type: 'association', from: 'a', to: 'u', name: text },
        { type: 'extend', from: 'w', to: 'u', extensionPoint: text, condition: text },
      ],
    };
    const { svg } = await assertGates(doc);
    assert.doesNotMatch(svg, /<script\b|<!\[CDATA/);
    assert.doesNotMatch(svg, /<[^>]*\son\w+\s*=\s*"/);
    const scene = await inspectSvg(svg);
    assert.ok(scene.texts.filter(t => t.content.includes(text)).length >= 7, JSON.stringify(text));
  }
});
