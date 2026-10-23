import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { renderToSvg } from '../../dist/render.js';
import { ENGINE_ONLY_GATES, inspectSvg } from '../../dist/qa/index.js';
import { assertGates, budgetFactor, cli, plantUmlTest as test, root, workspace } from '../helpers.mjs';

// Real pinned PlantUML (npm run setup:renderer). Activity diagrams are drawn by
// PlantUML's activity engine; every QA gate, including the edge gates, is evaluated
// on its output (src/qa/plantuml-activity.ts) and none may be skipped.
const fixtures = name => readFile(join(root, 'test/fixtures/activity', name), 'utf8').then(JSON.parse);
const examples = async () =>
  (await readdir(join(root, 'examples/activity')))
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => join(root, 'examples/activity', f));
const svgOf = async doc => renderToSvg(parseDocument(typeof doc === 'string' ? doc : JSON.stringify(doc)));

async function allGates(doc, label) {
  const { report, svg, ms } = await assertGates(doc);
  assert.deepEqual(
    report.gates.filter(g => g.skipped && !ENGINE_ONLY_GATES.includes(g.gate)).map(g => g.gate),
    [],
    `${label}: no gate may be skipped`,
  );
  return { svg, ms };
}

test('activity: every positive fixture renders and passes every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await allGates(c.doc, c.name);
});

test('activity: every example renders through the CLI (SVG and PNG) and passes every QA gate', async t => {
  const dir = await workspace(t);
  for (const file of await examples()) {
    await allGates(await readFile(file, 'utf8'), file);
    for (const ext of ['svg', 'png']) {
      const result = cli(['render', file, '-o', join(dir, `out.${ext}`)]);
      assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    }
  }
});

test('activity: stress example (74 nodes, 3 partitions) renders within 5 s', async () => {
  const text = await readFile(join(root, 'examples/activity/stress.json'), 'utf8');
  assert.ok(JSON.parse(text).nodes.length >= 70);
  const { ms } = await allGates(text, 'stress');
  assert.ok(ms < 5000 * budgetFactor, `took ${ms} ms`);
});

test('activity: rendering is byte-identical across runs', async () => {
  const text = await readFile(join(root, 'examples/activity/order-handling.json'), 'utf8');
  assert.equal(await svgOf(text), await svgOf(text));
});

test('activity: UML 2.5.1 notation of every construct', async () => {
  const svg = await svgOf(await readFile(join(root, 'examples/activity/notation.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  const count = type => scene.nodes.filter(n => n.type === type).length;
  // The lines of a node are read as one text: "Result" and "[complete]" become "Result[complete]".
  const owner = text => scene.nodes.find(n => n.id === scene.texts.find(t => t.node && (t.content === text || t.content.startsWith(`${text}[`)))?.node);
  // Actions are rounded rectangles; object nodes square rectangles.
  for (const action of ['Validate request', 'Log rejection', 'Audit', 'Back off', 'Poll status']) assert.equal(owner(action)?.type, 'action', action);
  for (const object of ['Request', 'Result']) assert.equal(owner(object)?.type, 'object', object);
  assert.ok(
    scene.texts.some(t => t.content === 'Result[complete]' && t.node === owner('Result').id && t.lines.length === 2),
    'object state in brackets under the name',
  );
  // Send signal (convex pentagon) and accept event (concave notch) are five-sided.
  for (const signal of ['Notify backend', 'Request received']) assert.equal(owner(signal)?.type, 'signal', signal);
  assert.match(svg, /<polygon fill="#F8FAFC" points="([\d.]+,[\d.]+,){4}[\d.]+,[\d.]+"/, 'pentagon');
  // Accept event: the concave notch is on the left (UML 16.10.4): its fifth point lies inside the left edge.
  const pentagons = [...svg.matchAll(/<polygon fill="#F8FAFC" points="([^"]+)"/g)].map(m => m[1].split(',').map(Number)).filter(n => n.length === 10);
  const accept = pentagons.find(n => n[8] > n[0] && n[8] < n[2]);
  assert.ok(accept, 'accept event pentagon with the notch on the left');
  assert.ok(
    pentagons.some(n => n[4] > n[2]),
    'send signal pentagon with the point on the right',
  );
  // Call behavior action: the rake symbol.
  assert.match(svg, /<path d="M[\d.]+,[\d.]+ V[\d.]+ M[\d.]+,[\d.]+ V[\d.]+ H[\d.]+ V[\d.]+" fill="none"/);
  // Decision/merge diamonds, fork/join bars, initial, activity final and flow final circles.
  assert.ok(count('diamond') >= 5);
  assert.equal(count('bar'), 2);
  assert.equal(count('circle'), 3);
  assert.equal((svg.match(/<ellipse[^>]*fill="#0F172A"[^>]*rx="10"/g) ?? []).length, 1, 'initial node: one filled circle');
  assert.equal((svg.match(/<ellipse[^>]*rx="6"/g) ?? []).length, 1, "activity final: bull's eye");
  // Every flow ends in an open arrowhead at its target, on the node border; guards in brackets.
  assert.ok(scene.edges.length >= 25);
  for (const e of scene.edges) assert.equal(e.targetMarker, 'open-arrow', e.id);
  assert.doesNotMatch(svg, /<polygon fill="#334155"/, 'no filled arrowheads');
  for (const guard of ['[invalid]', '[valid]', '[no reply]', '[acknowledged]', '[priority]', '[else]', '[pending]', '[done]']) {
    assert.equal(scene.texts.find(t => t.content === guard)?.role, 'label', guard);
  }
  // Note: rectangle with folded corner, attached to its action.
  assert.equal(count('note'), 1);
  // UML 7.2.4: the note is attached by a dashed line, not by a speech-bubble pointer.
  const note = scene.nodes.find(n => n.type === 'note');
  assert.match(
    svg,
    new RegExp(String.raw`<line x1="${note.bounds.x}" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" style="[^"]*stroke-dasharray`),
    'dashed anchor from the note',
  );
  assert.ok(note.bounds.width > 100 && scene.extents.length > 0);
  // Fork and join bars span their flows, not the whole block.
  for (const bar of scene.nodes.filter(n => n.type === 'bar')) {
    const flows = scene.edges
      .flatMap(e => [e.points[0], e.points.at(-1)])
      .filter(p => Math.abs(p.y - bar.bounds.y) < 2 || Math.abs(p.y - (bar.bounds.y + bar.bounds.height)) < 2)
      .map(p => p.x)
      .filter(x => x >= bar.bounds.x && x <= bar.bounds.x + bar.bounds.width);
    assert.ok(Math.min(...flows) - bar.bounds.x <= 16.5 && bar.bounds.x + bar.bounds.width - Math.max(...flows) <= 16.5, 'bar overhang at most 16 px');
  }
  // Frame heading: bold keyword "act" and the name.
  const heading = scene.texts.filter(t => t.role === 'frame-label');
  assert.deepEqual(
    heading.map(t => [t.content, t.bold]),
    [
      ['act', true],
      ['Notation', false],
    ],
  );
});

test('activity: partitions are swimlanes in input order with bold names', async () => {
  const scene = await inspectSvg(await svgOf(await readFile(join(root, 'examples/activity/order-handling.json'), 'utf8')));
  const lanes = scene.texts.filter(t => t.role === 'partition-label');
  assert.deepEqual(
    lanes.map(t => t.content),
    ['Customer', 'Shop', 'Warehouse'],
  );
  assert.ok(lanes.every(t => t.bold));
  assert.ok(lanes[0].bounds.x < lanes[1].bounds.x && lanes[1].bounds.x < lanes[2].bounds.x);
});

test('activity: hostile text stays literal in every text slot and creates no active SVG', async () => {
  const samples = [
    String.raw`" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \n @enduml`,
    '<svg onload="alert(1)">',
    '  spaced  ',
    'Unicode: 🚀 注文 \u{1F600}',
    '|lane| :act; <<object>> end',
  ];
  for (const text of samples) {
    const doc = {
      kind: 'activity',
      title: text,
      partitions: [{ id: 'p', name: text }],
      nodes: [
        { id: 'i', type: 'initial', partition: 'p' },
        { id: 'a', type: 'action', name: text, note: text, partition: 'p' },
        { id: 'o', type: 'object', name: text, state: text, partition: 'p' },
        { id: 'c', type: 'callBehavior', name: text, partition: 'p' },
        { id: 's', type: 'sendSignal', name: text, partition: 'p' },
        { id: 'r', type: 'acceptEvent', name: text, partition: 'p' },
        { id: 'd', type: 'decision', partition: 'p' },
        { id: 'f', type: 'activityFinal', partition: 'p' },
        { id: 'g', type: 'flowFinal', partition: 'p' },
      ],
      edges: [
        { type: 'control', from: 'i', to: 'a' },
        { type: 'object', from: 'a', to: 'o' },
        { type: 'object', from: 'o', to: 'c' },
        { type: 'control', from: 'c', to: 's' },
        { type: 'control', from: 's', to: 'r' },
        { type: 'control', from: 'r', to: 'd' },
        { type: 'control', from: 'd', to: 'f', guard: text },
        { type: 'control', from: 'd', to: 'g', guard: 'else' },
      ],
    };
    const { svg } = await allGates(doc, text);
    const scene = await inspectSvg(svg);
    const literal = scene.texts.map(t => t.content);
    for (const expected of [text, `[${text}]`])
      assert.ok(
        literal.some(c => c.includes(expected)),
        `${JSON.stringify(text)}: ${expected}`,
      );
    assert.ok(literal.filter(c => c === text).length >= 5, `${JSON.stringify(text)} in name slots`);
    assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject)\b/);
    assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
  }
});

test('activity: nodes, notes and texts keep 12 px from every swimlane border; fork branches leave their bar straight', async () => {
  const files = [...(await examples()), join(root, 'test/fixtures/regression/activity-act-awk.json'), join(root, 'test/fixtures/review/act-ci.json')];
  for (const file of files) {
    const svg = await svgOf(await readFile(file, 'utf8'));
    const scene = await inspectSvg(svg);
    const borders = [...svg.matchAll(/<line style="stroke:#475569;[^"]*" x1="([\d.]+)" x2="\1" y1="([\d.]+)" y2="([\d.]+)"\/>/gu)].map(m => ({
      x: Number(m[1]),
      y0: Number(m[2]),
      y1: Number(m[3]),
    }));
    const boxes = [
      ...scene.nodes.filter(n => n.type !== 'bar').map(n => ({ what: n.id, r: n.bounds })),
      ...scene.texts.filter(t => t.role !== 'frame-label').map(t => ({ what: t.content, r: t.bounds })),
    ];
    for (const b of borders)
      for (const { what, r } of boxes) {
        if (r.y > b.y1 || r.y + r.height < b.y0) continue;
        const gap = r.x >= b.x ? r.x - b.x : b.x - r.x - r.width;
        assert.ok(gap >= 11.75 || (r.x < b.x && r.x + r.width > b.x), `${file}: ${what} is ${gap.toFixed(1)} px from the swimlane border at x=${b.x}`);
      }
    if (file.endsWith('act-awk.json')) assert.ok(borders.length >= 5 && scene.nodes.filter(n => n.type === 'bar').length === 2);
    // Every branch of a fork or join leaves or enters its bar straight: a vertical
    // segment of at least 15 px, not a stub and a jog.
    for (const bar of scene.nodes.filter(n => n.type === 'bar')) {
      const all = scene.edges.flatMap(e => [
        ...(e.source === bar.id ? [[e.points[0], e.points[1]]] : []),
        ...(e.target === bar.id ? [[e.points.at(-1), e.points.at(-2)]] : []),
      ]);
      const below = ([p]) => p.y > bar.bounds.y + bar.bounds.height / 2;
      const many = all.filter(below).length > 1;
      for (const [p, q] of all.filter(end => below(end) === many))
        assert.ok(
          Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) >= 15,
          `${file}: a branch meets ${bar.id} at (${p.x}, ${p.y}) with a ${Math.abs(p.y - q.y).toFixed(1)} px stub`,
        );
    }
  }
});
