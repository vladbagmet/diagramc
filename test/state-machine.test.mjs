import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { assertGates, cli, root, workspace } from './helpers.mjs';

// State machines are drawn by the own engine (see docs/decisions/0002-state-machine-and-use-case-backend.md).
const fixtures = name => readFile(join(root, 'test/fixtures/state-machine', name), 'utf8').then(JSON.parse);
const examples = async () => (await readdir(join(root, 'examples/state-machine'))).filter(f => f.endsWith('.json')).sort().map(f => join(root, 'examples/state-machine', f));
const svgOf = async doc => renderToSvg(parseDocument(typeof doc === 'string' ? doc : JSON.stringify(doc)));

test('state machine: negative fixtures fail with the exact code and JSON path', async () => {
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

test('state machine: positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('state machine: every example passes every QA gate and renders through the CLI as SVG and PNG', async t => {
  const dir = await workspace(t);
  for (const file of await examples()) {
    await assertGates(await readFile(file, 'utf8'));
    for (const ext of ['svg', 'png']) assert.equal(cli(['render', file, '-o', join(dir, `out.${ext}`)]).status, 0, file);
  }
});

test('state machine: stress example (4 composites, 40+ vertices) renders within 2 s', async () => {
  const text = await readFile(join(root, 'examples/state-machine/stress.json'), 'utf8');
  const started = performance.now();
  await svgOf(text);
  assert.ok(performance.now() - started < 2000);
});

test('state machine: rendering is byte-identical across runs', async () => {
  const text = await readFile(join(root, 'examples/state-machine/notation.json'), 'utf8');
  assert.equal(await svgOf(text), await svgOf(text));
});

test('state machine: UML 2.5.1 notation of states, pseudostates and transitions', async () => {
  const svg = await svgOf(await readFile(join(root, 'examples/state-machine/notation.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  const node = id => scene.nodes.find(n => n.id === id);
  const group = id => svg.match(new RegExp(`<g data-uml-role="node" data-uml-id="${id}"[^>]*>(.*?)</g>`))?.[1] ?? '';
  // States: rounded rectangles; behaviors as "entry / ...", internal transitions as "trigger / effect".
  assert.match(group('draft'), /<rect [^>]*rx="10"/);
  assert.equal(node('processing').type, 'composite-state');
  for (const text of ['entry / reserve stock', 'edit / updateLines', 'do / pick items', 'Invoice : Billing']) assert.ok(scene.texts.some(t => t.content === text), text);
  assert.equal(node('billing').type, 'submachine-state');
  // Orthogonal regions are separated by a dashed line; region names in italics.
  assert.equal((svg.match(/<line [^>]*stroke-dasharray="7 4"/g) ?? []).length, 1);
  assert.ok(scene.texts.find(t => t.content === 'payment').italic);
  // Pseudostates.
  assert.match(group('init'), /<circle [^>]*fill="#0F172A"/);
  assert.equal(node('init').shape, 'ellipse');
  assert.equal((group('pDone').match(/<circle/g) ?? []).length, 2, 'final state: bull\'s eye');
  assert.match(group('check'), /<circle [^>]*fill="#0F172A"/, 'junction: filled circle');
  assert.ok(node('check').bounds.width < node('init').bounds.width, 'junction is smaller than initial');
  assert.match(group('split'), /<rect [^>]*fill="#334155"/, 'fork: bar');
  assert.ok(scene.texts.some(t => t.content === 'H*' && t.node === 'deep'), 'deep history: H*');
  assert.match(group('kill'), /<path d="M[^"]+ L[^"]+ M[^"]+ L[^"]+"/, 'terminate: a cross');
  // Entry and exit points straddle the composite's border.
  const processing = node('processing').bounds;
  for (const [id, x] of [['resume', processing.x], ['aborted', processing.x + processing.width]]) {
    const b = node(id).bounds;
    assert.equal(node(id).borderOf, 'processing');
    assert.ok(Math.abs(b.x + b.width / 2 - x) < 0.5, `${id} centered on the border`);
  }
  assert.match(group('aborted'), /<path/, 'exit point: circle with a cross');
  // Transitions: solid lines, open arrowheads at the target, labels trigger [guard] / effect.
  for (const e of scene.edges.filter(e => e.type === 'transition')) {
    assert.equal(e.targetMarker, 'open-arrow', e.id);
    assert.equal(e.sourceMarker, 'none', e.id);
  }
  for (const label of ['autosave [dirty]', '[valid]', '/ createOrder', 'declined', '/ notifyCustomer']) assert.equal(scene.texts.find(t => t.content === label)?.role, 'label', label);
  const anchor = scene.edges.find(e => e.type === 'note-anchor');
  assert.equal(anchor.targetMarker, 'none');
  assert.match(svg, /data-uml-type="note-anchor"[^>]*><path [^>]*stroke-dasharray/);
  // Frame heading.
  assert.deepEqual(scene.texts.filter(t => t.role === 'frame-label').map(t => [t.content, t.bold]), [['stm ', true], ['Order lifecycle', false]]);
});

test('state machine: hostile text stays literal in every slot and creates no active SVG', async () => {
  for (const text of ['<script>alert(1)</script>', '" onload="x', '  spaced  ', '&amp; &lt; ]]> <![CDATA[', 'Unicode: 🚀 注文']) {
    const doc = {
      kind: 'state-machine', title: text,
      elements: [
        { id: 'i', type: 'initial' },
        { id: 's', type: 'state', name: text, entry: text, doActivity: text, exit: text, internal: [{ trigger: text, guard: text, effect: text }] },
        { id: 'c', type: 'state', name: text, connectionPoints: [{ id: 'en', type: 'entryPoint', name: text }], regions: [{ name: text, elements: [{ id: 'x', type: 'state', name: 'X' }] }, { elements: [{ id: 'y', type: 'state', name: 'Y', submachine: text }] }] },
        { id: 'n', type: 'note', text, attachedTo: ['s'] },
      ],
      transitions: [{ from: 'i', to: 's' }, { from: 's', to: 'en', trigger: text, guard: text, effect: text }, { from: 'en', to: 'x' }],
    };
    const { svg } = await assertGates(doc);
    assert.doesNotMatch(svg, /<script\b|<!\[CDATA/);
    assert.doesNotMatch(svg, /<[^>]*\son\w+\s*=\s*"/);
    const scene = await inspectSvg(svg);
    assert.ok(scene.texts.filter(t => t.content.includes(text)).length >= 8, JSON.stringify(text));
  }
});

// Layout regressions from reviewer models (test/fixtures/regression/state-machine-*.json).
const regression = name => readFile(join(root, 'test/fixtures/regression', name), 'utf8');

test('state machine layout: orthogonal regions side by side when that reads better', async () => {
  const svg = await svgOf(await readFile(join(root, 'examples/state-machine/stress.json'), 'utf8'));
  const { width, height } = (await inspectSvg(svg)).viewBox;
  // Stacked regions made it 891 x 5354 (1:6); side by side it is about 1:4.
  assert.ok(height / width < 4.5, `${width} x ${height}`);
  const vertical = [...svg.matchAll(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)" y2="[\d.]+" [^>]*stroke-dasharray="7 4"/g)].filter(m => m[1] === m[2]);
  assert.ok(vertical.length >= 2, 'region separators run top to bottom');
});

test('state machine layout: entry and exit points keep clear of corners and of the name compartment', async () => {
  const scene = await inspectSvg(await svgOf(await readFile(join(root, 'examples/state-machine/notation.json'), 'utf8')));
  const owner = scene.nodes.find(n => n.id === 'processing').bounds;
  for (const id of ['resume', 'aborted']) {
    const b = scene.nodes.find(n => n.id === id).bounds, cy = b.y + b.height / 2;
    assert.ok(cy - owner.y >= 60 && owner.y + owner.height - cy >= 18, `${id} at ${cy} on ${owner.y}..${owner.y + owner.height}`);
  }
});

test('state machine layout: incoming lines of a choice get their own arrowheads', async () => {
  const scene = await inspectSvg(await svgOf(await regression('state-machine-sm-elevator.json')));
  const into = scene.edges.filter(e => e.type === 'transition' && e.target === 'which').map(e => e.points.at(-1));
  assert.equal(into.length, 2);
  assert.ok(Math.hypot(into[0].x - into[1].x, into[0].y - into[1].y) > 10, JSON.stringify(into));
});

test('state machine layout: a simple cycle of states has straight lines, no jogs', async () => {
  const scene = await inspectSvg(await svgOf(await regression('state-machine-sm-traffic-light.json')));
  // The line back from Yellow to Red runs beside the chain; the others are straight.
  for (const e of scene.edges.filter(e => e.type === 'transition' && e.source !== 'yellow')) {
    assert.equal(e.points.length, 2, `${e.id}: ${JSON.stringify(e.points)}`);
  }
});
