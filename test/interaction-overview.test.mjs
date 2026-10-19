import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { assertGates, root } from './helpers.mjs';

const fixtures = name => readFile(join(root, 'test/fixtures/interaction-overview', name), 'utf8').then(JSON.parse);
const example = name => readFile(join(root, 'examples/interaction-overview', name), 'utf8');
const render = async text => renderToSvg(parseDocument(typeof text === 'string' ? text : JSON.stringify(text)));
const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test('interaction overview: negative fixtures fail with the exact code and JSON path', async () => {
  const cases = await fixtures('invalid.json');
  assert.ok(cases.length >= 25);
  for (const c of cases) {
    assert.throws(() => parseDocument(JSON.stringify(c.doc)), error => {
      assert.equal(error.code, c.expect.code, `${c.name}: ${error.message}`);
      assert.equal(error.path, c.expect.path, `${c.name}: ${error.message}`);
      return true;
    }, c.name);
  }
});

test('interaction overview: positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('interaction overview: every example passes every QA gate', async () => {
  const files = (await readdir(join(root, 'examples/interaction-overview'))).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 4);
  for (const file of files) await assertGates(await example(file));
});

test('interaction overview: stress example (50+ nodes, 70 flows) renders within 2 s', async () => {
  const text = await example('stress.json');
  const doc = JSON.parse(text);
  assert.ok(doc.nodes.length >= 50 && doc.flows.length >= 70);
  const started = performance.now();
  await render(text);
  assert.ok(performance.now() - started < 2000, 'stress render took longer than 2 s');
});

test('interaction overview: rendering is byte-identical across runs', async () => {
  const text = await example('withdraw-cash.json');
  assert.equal(await render(text), await render(text));
});

test('interaction overview: UML notation of control nodes, frames and flows', async () => {
  const svg = await render(await example('notation.json'));
  const scene = await inspectSvg(svg);
  const node = id => scene.nodes.find(n => n.id === id);
  const group = id => svg.match(new RegExp(`<g data-uml-role="node" data-uml-id="${id}"[^>]*>.*?</g>`))[0];
  // Initial: filled circle. Activity final: circle around a filled circle. Flow final: circle with an X.
  assert.match(group('start'), /<circle [^>]*fill="#334155"\/>/);
  assert.equal(group('end').match(/<circle /g).length, 2);
  assert.match(group('stop'), /<circle [^>]*fill="#FFFFFF"[^>]*\/><path d="M[^"]+ L[^"]+ M[^"]+ L[^"]+"/);
  // Decision and merge: diamonds; fork: filled bar wider than tall.
  for (const id of ['again', 'state']) assert.match(group(id), /<polygon /);
  assert.ok(node('fan').bounds.width > 5 * node('fan').bounds.height);
  assert.match(group('fan'), /<rect [^>]*fill="#334155"/);
  // Interaction use: frame with the ref keyword and the name; inline interaction: sd frame.
  for (const [id, keyword] of [['fetch', 'ref'], ['poll', 'sd ']]) {
    assert.ok(scene.texts.some(t => t.node === id && t.content === keyword && t.bold), `${id} has ${keyword}`);
  }
  assert.ok(scene.texts.some(t => t.node === 'wait' && t.content === 'Wait(5 s)'));
  // Control flows: solid lines, open arrowhead at the target.
  const flows = scene.edges.filter(e => e.type === 'control-flow');
  assert.equal(flows.length, 13);
  assert.ok(flows.every(e => e.sourceMarker === 'none' && e.targetMarker === 'open-arrow'));
  // Guards in brackets near their decision.
  for (const guard of ['[running]', '[done]', '[failed]']) {
    const label = scene.texts.find(t => t.content === guard);
    assert.ok(label && label.role === 'label' && label.end === 'source', guard);
  }
  // Flows meet diamonds at their vertices and circles at their top/bottom.
  for (const e of flows) {
    for (const [id, p] of [[e.source, e.points[0]], [e.target, e.points.at(-1)]]) {
      const n = node(id);
      if (!['decision', 'merge', 'initial', 'final', 'flow-final'].includes(n.type)) continue;
      const c = center(n.bounds);
      const vertex = [[c.x, n.bounds.y], [c.x, n.bounds.y + n.bounds.height], [n.bounds.x, c.y], [n.bounds.x + n.bounds.width, c.y]]
        .some(([x, y]) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5);
      assert.ok(vertex, `${e.id} meets ${id} at a vertex`);
    }
  }
  // The loop back to the merge enters it from the side, the main flow from above.
  const loop = flows.find(e => e.source === 'wait' && e.target === 'again');
  assert.ok(Math.abs(loop.points.at(-1).y - center(node('again').bounds).y) < 0.5);
  // Top-down: the initial node is above everything else.
  assert.ok(scene.nodes.filter(n => !n.parent && n.id !== 'start').every(n => n.bounds.y > node('start').bounds.y));
});

test('interaction overview: inline sd fragments draw lifelines and messages in our engine', async () => {
  const svg = await render(await example('withdraw-cash.json'));
  const scene = await inspectSvg(svg);
  const select = scene.nodes.find(n => n.id === 'select');
  const heads = scene.nodes.filter(n => n.parent === 'select' && n.type === 'lifeline');
  const lines = scene.nodes.filter(n => n.parent === 'select' && n.type === 'lifeline-line');
  assert.equal(heads.length, 3);
  assert.equal(lines.length, 3);
  for (const n of [...heads, ...lines]) assert.ok(n.bounds.x >= select.bounds.x && n.bounds.x + n.bounds.width <= select.bounds.x + select.bounds.width);
  const messages = scene.edges.filter(e => e.type === 'message' && e.source.endsWith('::line') && ['customer1', 'atm1', 'bank1'].some(id => e.source.startsWith(id)));
  assert.equal(messages.length, 4);
  // In list order, top to bottom, horizontal, from sender to receiver line.
  const ys = messages.map(e => e.points[0].y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys);
  for (const e of messages) assert.equal(e.points[0].y, e.points.at(-1).y);
  const sorts = messages.map(e => e.targetMarker);
  assert.deepEqual(sorts, ['open-arrow', 'open-arrow', 'filled-triangle', 'open-arrow']);
  assert.match(svg.match(/<g data-uml-role="edge" data-uml-id="select\/messages\/3"[^>]*><path [^>]*>/)[0], /stroke-dasharray/, 'reply is dashed');
  // Labels sit above their arrows and are readable (theme label size).
  const label = scene.texts.find(t => t.content === 'debit(account, amount)');
  assert.ok(label.size >= 11 && label.bounds.y + label.bounds.height <= messages[2].points[0].y);
  // Frame heading with the lifelines list.
  assert.ok(scene.texts.some(t => t.role === 'frame-label' && t.content === 'WithdrawCash lifelines :Customer, :ATM, :Bank'));
});

test('interaction overview: hostile and markup-like text stays literal and cannot create active SVG', async () => {
  const hostile = '" } <b>bold</b> [[https://evil.invalid]] **x** \\n @enduml';
  const doc = {
    kind: 'interaction-overview', title: '<script>x</script>', lifelines: ['<svg onload="alert(1)">'],
    nodes: [
      { id: 's', type: 'initial' },
      { id: 'd', type: 'decision' },
      { id: 'r', type: 'interaction-use', name: hostile, arguments: ['<a href="x">'] },
      { id: 'i', type: 'interaction', name: '<foreignObject>', lifelines: [{ id: 'l', name: '  spaced  ', type: '&amp;' }], messages: [{ from: 'l', to: 'l', name: 'url(https://evil.invalid)' }] },
      { id: 'e', type: 'final' },
    ],
    flows: [{ from: 's', to: 'd' }, { from: 'd', to: 'r', guard: '<image href="x"/>' }, { from: 'd', to: 'i', guard: '🚀 𠀀' }, { from: 'r', to: 'e' }, { from: 'i', to: 'e' }],
  };
  const { svg } = await assertGates(doc);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
  // Attribute values are escaped text; only real attribute names matter.
  assert.doesNotMatch(svg.replace(/"[^"]*"/g, '""'), /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
  const scene = await inspectSvg(svg);
  assert.ok(scene.texts.some(t => t.content === `${hostile}(<a href="x">)`));
  assert.ok(scene.texts.some(t => t.content === '  spaced   : &amp;'), 'boundary spaces preserved');
  assert.ok(scene.texts.some(t => t.content === '[<image href="x"/>]'));
});

test('interaction overview: the published schema describes the contract', async () => {
  const { interactionOverviewKind } = await import('../dist/kinds/interaction-overview/index.js');
  const schema = interactionOverviewKind.schema;
  assert.equal(schema.properties.kind.const, 'interaction-overview');
  assert.deepEqual(schema.definitions.node.oneOf.map(b => b.properties.type.const),
    ['initial', 'final', 'flow-final', 'decision', 'merge', 'fork', 'join', 'interaction-use', 'interaction']);
});
