import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { compareSequence, messageLabel, lifelineLabel } from '../dist/kinds/communication/format.js';
import { assertCpuBudget, assertGates, root } from './helpers.mjs';

const fixtures = name => readFile(join(root, 'test/fixtures/communication', name), 'utf8').then(JSON.parse);
const example = name => readFile(join(root, 'examples/communication', name), 'utf8');
const render = async text => renderToSvg(parseDocument(typeof text === 'string' ? text : JSON.stringify(text)));

test('communication: negative fixtures fail with the exact code and JSON path', async () => {
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

test('communication: positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('communication: every example passes every QA gate', async () => {
  const files = (await readdir(join(root, 'examples/communication'))).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 4);
  for (const file of files) await assertGates(await example(file));
});

test('communication: stress example (24 lifelines, 50+ messages) renders within 2 s', async () => {
  const text = await example('stress.json');
  const doc = JSON.parse(text);
  assert.equal(doc.lifelines.length, 24);
  assert.ok(doc.messages.length >= 50);
  await assertCpuBudget(() => render(text));
});

test('communication: rendering is byte-identical across runs', async () => {
  const text = await example('notation.json');
  assert.equal(await render(text), await render(text));
});

test('communication: label formats follow UML 2.5.1 (lifeline idents, sequence expressions, signatures)', () => {
  assert.equal(lifelineLabel({ id: 'x', name: 'w', selector: 'k', type: 'Worker' }), 'w[k] : Worker');
  assert.equal(lifelineLabel({ id: 'x', type: 'Cache' }), ': Cache');
  assert.equal(lifelineLabel({ id: 'x', name: 'session' }), 'session');
  const m = (extra) => messageLabel({ sequence: '1.2', from: 'a', to: 'b', name: 'op', ...extra });
  assert.equal(m({}), '1.2: op');
  assert.equal(m({ arguments: [] }), '1.2: op()');
  assert.equal(m({ arguments: ['a', 'b'], assignTo: 'x' }), '1.2: x = op(a, b)');
  assert.equal(m({ guard: 'x > 0' }), '1.2 [x > 0]: op');
  assert.equal(m({ iteration: 'i=1..n' }), '1.2 *[i=1..n]: op');
  assert.equal(m({ iteration: 'i=1..n', parallel: true }), '1.2 *||[i=1..n]: op');
  assert.equal(m({ sort: 'reply', returnValue: 'r' }), '1.2: op: r');
  const ordered = ['2', '1.10', '1.2', '1', '2b', '1.2.1', '2a'].sort(compareSequence);
  assert.deepEqual(ordered, ['1', '1.2', '1.2.1', '1.10', '2', '2a', '2b']);
});

test('communication: UML notation of lifelines, links and message arrows', async () => {
  const svg = await render(await example('notation.json'));
  const scene = await inspectSvg(svg);
  // Links are solid lines without arrowheads.
  assert.ok(scene.edges.length === 6 && scene.edges.every(e => e.type === 'link' && e.sourceMarker === 'none' && e.targetMarker === 'none'));
  for (const id of scene.edges.map(e => e.id)) {
    assert.doesNotMatch(svg.match(new RegExp(`<g data-uml-role="edge" data-uml-id="${id}"[^>]*><path [^>]*>`))[0], /stroke-dasharray/, `${id} solid`);
  }
  // One arrow per (link, direction, sort): sync filled, async open, reply dashed open.
  const arrow = group => scene.arrows.find(a => a.group === group);
  assert.deepEqual([arrow('ui-session::forward-synchronous').marker, arrow('ui-session::forward-synchronous').dashed], ['filled-triangle', false]);
  assert.deepEqual([arrow('ui-session::backward-asynchronous').marker, arrow('ui-session::backward-asynchronous').dashed], ['open-arrow', false]);
  assert.deepEqual([arrow('ui-session::backward-reply').marker, arrow('ui-session::backward-reply').dashed], ['open-arrow', true]);
  assert.equal(scene.arrows.filter(a => a.owner === 'ui-session').length, 3);
  // Arrows point from sender to receiver.
  const sync = arrow('ui-session::forward-synchronous');
  assert.deepEqual([sync.source, sync.target], ['ui', 'session']);
  // Messages of one group are stacked in sequence order.
  const texts = scene.texts.filter(t => t.group === 'ui-session::forward-synchronous');
  assert.deepEqual(texts.map(t => t.content), ['1: s = open(user)', '2: refresh()']);
  assert.ok(texts[0].bounds.y < texts[1].bounds.y);
  for (const t of ['1.3 *||[i=1..n]: warmUp(n)', '1.4 [not hit]: store(user)', '1.5: open: s', '1.1: checkQuota()', 'w[k] : Worker', ': Cache', 'session']) {
    assert.ok(scene.texts.some(x => x.content === t), `missing ${t}`);
  }
  // Self-link: a loop from and back to the same lifeline, its arrow along the loop.
  const self = scene.edges.find(e => e.id === 'session-self');
  assert.equal(self.source, 'session');
  assert.equal(self.target, 'session');
  assert.ok(self.points.length === 5);
  // Multi-object: stacked rectangles inside one node.
  assert.equal(scene.nodes.find(n => n.id === 'pool').type, 'multi-object');
  assert.equal(svg.match(/<g data-uml-role="node" data-uml-id="pool"[^>]*>(?:<rect [^>]*>){2}/g)?.length, 1, 'two rectangles');
  // Lifeline names are not underlined (UML 2 lifelines, not UML 1 objects).
  assert.doesNotMatch(svg, /stroke-width="0.9"/);
  assert.ok(scene.frameHeading && scene.texts.some(t => t.content === 'sd ') && scene.texts.some(t => t.content === 'Notation reference'));
});

test('communication: horizontal and vertical links dominate the grid layout', async () => {
  const scene = await inspectSvg(await render(await example('place-order.json')));
  const axis = scene.edges.filter(e => e.points.length === 2 && (Math.abs(e.points[0].x - e.points[1].x) < 0.01 || Math.abs(e.points[0].y - e.points[1].y) < 0.01));
  assert.ok(axis.length >= 5, `${axis.length} of ${scene.edges.length} links are axis-aligned`);
});

test('communication: a crossing costs more than a slightly larger grid (F-B-21)', async () => {
  const { countCrossings } = await import('../dist/engine/aspect.js');
  const svg = await render(await readFile(join(root, 'test/fixtures/regression/communication-com-awk.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  assert.equal(countCrossings(scene.edges.filter(e => e.type === 'link').map(e => e.points)), 0, 'no link crosses another');
  const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg).map(Number);
  assert.ok(w / h <= 2.5, `${w}x${h}`);
});

test('communication: hostile and markup-like text stays literal and cannot create active SVG', async () => {
  const hostile = String.raw`" } <b>bold</b> [[https://evil.invalid]] **x** \n @enduml`;
  const doc = {
    kind: 'communication', title: '<script>x</script>',
    lifelines: [{ id: 'a', name: hostile, type: '<svg onload="alert(1)">' }, { id: 'b', name: '  spaced  ', type: '&amp;' }],
    links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'b' }],
    messages: [
      { sequence: '1', from: 'a', to: 'b', name: '<a href="x">', arguments: ['url(https://evil.invalid)'], guard: '<foreignObject>' },
      { sequence: '1.1', from: 'b', to: 'b', name: '🚀 𠀀', sort: 'asynchronous' },
    ],
  };
  const { svg } = await assertGates(doc);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
  // Attribute values are escaped text; only real attribute names matter.
  assert.doesNotMatch(svg.replaceAll(/"[^"]*"/g, '""'), /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
  const scene = await inspectSvg(svg);
  assert.ok(scene.texts.some(t => t.content === `${hostile} : <svg onload="alert(1)">`));
  assert.ok(scene.texts.some(t => t.content === '  spaced   : &amp;'), 'boundary spaces preserved');
  assert.ok(scene.texts.some(t => t.content === '1 [<foreignObject>]: <a href="x">(url(https://evil.invalid))'));
});

test('communication: the published schema describes the contract', async () => {
  const { communicationKind } = await import('../dist/kinds/communication/index.js');
  const schema = communicationKind.schema;
  assert.equal(schema.properties.kind.const, 'communication');
  assert.deepEqual(schema.required, ['kind', 'lifelines']);
  assert.deepEqual(schema.definitions.message.properties.sort.enum, ['synchronous', 'asynchronous', 'reply']);
  assert.equal(communicationKind.frameKeyword, 'sd');
});
