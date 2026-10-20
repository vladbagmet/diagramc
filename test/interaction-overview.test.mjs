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

test('interaction overview: branches of a decision part right below it and each guard sits at its own line', async () => {
  for (const [name, text] of [['stress', await example('stress.json')], ['notation', await example('notation.json')], ['i2-awkward', await readFile(join(root, 'test/fixtures/regression/interaction-overview-i2-awkward.json'), 'utf8')]]) {
    const scene = await inspectSvg(await render(text));
    const decisions = new Set(scene.nodes.filter(n => n.type === 'decision').map(n => n.id));
    const segments = e => e.points.slice(1).map((q, k) => [e.points[k], q]);
    const overlap = ([a, b], [c, d]) => {
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5 && Math.abs(a.x - c.x) < 0.5) return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5 && Math.abs(a.y - c.y) < 0.5) return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
      return 0;
    };
    const branches = scene.edges.filter(e => decisions.has(e.source));
    // Branches of one decision share at most the short trunk at its vertex and the
    // line they part along, 14 px off the diamond.
    const onSplit = ([a, b], r) => (Math.abs(a.y - b.y) < 0.5 && (Math.abs(a.y - r.y - r.height - 14) < 0.5 || Math.abs(r.y - a.y - 14) < 0.5))
      || (Math.abs(a.x - b.x) < 0.5 && (Math.abs(a.x - r.x - r.width - 14) < 0.5 || Math.abs(r.x - a.x - 14) < 0.5));
    for (const [i, e] of branches.entries()) for (const f of branches.slice(i + 1)) {
      if (e.source !== f.source) continue;
      const r = scene.nodes.find(n => n.id === e.source).bounds;
      for (const s of segments(e)) for (const t of segments(f)) {
        if (onSplit(s, r)) continue;
        assert.ok(overlap(s, t) <= 15, `${name}: ${e.id} and ${f.id} share ${overlap(s, t).toFixed(0)} px`);
      }
    }
    for (const label of scene.texts.filter(t => t.role === 'label' && t.content.startsWith('['))) {
      const edge = scene.edges.find(e => e.id === label.owner);
      const [a, b] = edge.points;
      const box = label.bounds;
      // Within reach of the start of the branch (after a trunk: where it parts from
      // the trunk, the second or third point), not near its far end.
      const from = p => Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.width), Math.max(box.y - p.y, 0, p.y - box.y - box.height));
      const d = Math.min(...edge.points.slice(0, label.end ? 1 : 3).map(from));
      assert.ok(d <= 24, `${name}: guard ${label.content} is ${d.toFixed(0)} px from the start of ${edge.id}`);
      // Guards at a vertex: above a line leaving sideways, right of a line going down.
      if (!label.end) continue;
      if (Math.abs(a.y - b.y) < 0.5) assert.ok(box.y + box.height <= a.y + 0.5, `${name}: guard ${label.content} is not above its line`);
      else if (b.y > a.y) assert.ok(box.x >= a.x - 0.5, `${name}: guard ${label.content} is not right of its line`);
    }
  }
});

test('interaction overview: a loop-back leaves its interaction from the east side', async () => {
  const scene = await inspectSvg(await render(await example('notation.json')));
  const loop = scene.edges.find(e => e.source === 'wait');
  const wait = scene.nodes.find(n => n.id === 'wait').bounds;
  assert.ok(Math.abs(loop.points[0].x - (wait.x + wait.width)) < 0.5, `loop starts at ${JSON.stringify(loop.points[0])}`);
});

test('interaction overview: flows never share a sideways run or the last segment into a final node; loops return without crossing (F-B-15, F-B-16)', async () => {
  const segments = e => e.points.slice(1).map((q, k) => [e.points[k], q]);
  const horizontalOverlap = ([a, b], [c, d]) => Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5 && Math.abs(a.y - c.y) < 0.5
    ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : 0;
  const verticalOverlap = ([a, b], [c, d]) => Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5 && Math.abs(a.x - c.x) < 0.5
    ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) : 0;
  const docs = [['withdraw-cash', await example('withdraw-cash.json')], ['notation', await example('notation.json')], ['stress', await example('stress.json')],
    ['i2-awkward', await readFile(join(root, 'test/fixtures/regression/interaction-overview-i2-awkward.json'), 'utf8')]];
  for (const [name, text] of docs) {
    const scene = await inspectSvg(await render(text));
    for (const [i, e] of scene.edges.entries()) for (const f of scene.edges.slice(i + 1)) {
      for (const s of segments(e)) for (const t of segments(f)) {
        assert.ok(horizontalOverlap(s, t) <= 1, `${name}: ${e.id} and ${f.id} share a sideways run`);
        if (e.target === f.target && scene.nodes.find(n => n.id === e.target)?.type?.includes('final')) assert.ok(verticalOverlap(s, t) <= 1, `${name}: ${e.id} and ${f.id} share their way into ${e.target}`);
      }
    }
  }
  const stress = await inspectSvg(await render(await example('stress.json')));
  const { countCrossings } = await import('../dist/engine/aspect.js');
  assert.equal(countCrossings(stress.edges.map(e => e.points)), 0, 'no flow crosses another');
});

test('interaction overview: inline message labels cover the lifelines they cross; anonymous heads read like the heading (F-B-17, F-B-29)', async () => {
  const svg = await render(await readFile(join(root, 'test/fixtures/regression/interaction-overview-iod-awk.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  const label = scene.texts.find(t => t.content === 'availability(sku, quantity)');
  assert.ok(label, 'message label drawn');
  // A filled background box under the label (the lifelines are drawn before it).
  const box = label.lines[0];
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="[^"]+"\/>/g)].map(m => m.slice(1).map(Number));
  assert.ok(rects.some(([x, y, w, h]) => x <= box.x && x + w >= box.x + box.width && y <= box.y + box.height / 2 && y + h >= box.y + box.height / 2), 'label background');
  const cash = await inspectSvg(await render(await example('withdraw-cash.json')));
  assert.ok(cash.texts.some(t => t.content === ':Customer' && t.role === 'text'), 'head written :Customer, as in "lifelines :Customer, ..."');
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
