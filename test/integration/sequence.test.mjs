import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { renderToSvg } from '../../dist/render.js';
import { inspectSvg, renderAndCheck } from '../../dist/qa/index.js';
import { assertGates, cli, root, workspace } from '../helpers.mjs';

// Real pinned PlantUML (npm run setup:renderer): every gate on every fixture and example.
const fixtures = name => readFile(join(root, 'test/fixtures/sequence', name), 'utf8').then(JSON.parse);
const examples = async () => (await readdir(join(root, 'examples/sequence'))).filter(f => f.endsWith('.json')).sort().map(f => join(root, 'examples/sequence', f));
const render = async doc => { const { svg } = await assertGates(doc); return { svg, scene: await inspectSvg(svg) }; };
const L = (...ids) => ids.map(id => ({ id, name: id }));

test('positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('every sequence example passes every QA gate', async () => {
  for (const file of await examples()) await assertGates(await readFile(file, 'utf8'));
});

test('stress example (40+ messages, nested fragments) renders within 5 s cold', async () => {
  const { ms } = await renderAndCheck(await readFile(join(root, 'examples/sequence/stress.json'), 'utf8'));
  assert.ok(ms < 5000, `took ${ms} ms`);
});

test('rendering is byte-identical across runs', async () => {
  const parsed = parseDocument(await readFile(join(root, 'examples/sequence/notation.json'), 'utf8'));
  assert.equal(await renderToSvg(parsed), await renderToSvg(parsed));
});

test('UML notation: arrowheads and line styles per message sort; found and lost circles; destruction ends the lifeline', async () => {
  const { scene } = await render({ kind: 'sequence', lifelines: L('a', 'b', 'c'), items: [
    { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'sync', activate: true },
    { type: 'message', sort: 'reply', from: 'b', to: 'a', name: 'sync', deactivate: true },
    { type: 'message', sort: 'asynchronous', from: 'a', to: 'b', name: 'async' },
    { type: 'message', sort: 'create', from: 'a', to: 'c', name: 'C' },
    { type: 'message', sort: 'delete', from: 'b', to: 'c', name: 'drop' },
    { type: 'found', sort: 'synchronous', to: 'a', name: 'found' },
    { type: 'lost', sort: 'asynchronous', from: 'b', name: 'lost' },
  ] });
  const m = scene.interaction.messages;
  const expect = [['filled', false], ['open', true], ['open', false], ['open', true], ['filled', false], ['filled', false], ['open', false]];
  expect.forEach(([head, dashed], i) => {
    assert.equal(m[i].head.style, head, `message ${i} head`);
    assert.equal(m[i].dashed, dashed, `message ${i} dashed`);
  });
  // Synchronous and asynchronous arrows point at the receiver (right), the reply back (left).
  assert.ok(m[0].head.direction.x > 0.99 && m[1].head.direction.x < -0.99 && m[2].head.direction.x > 0.99);
  // Create ends on the created head's border; the head sits at the message's height.
  const head = scene.interaction.createdHeads.get(m[3].target);
  assert.ok(head && Math.abs(m[3].head.tip.x - head.x) < 3 && m[3].head.tip.y > head.y && m[3].head.tip.y < head.y + head.height);
  // Found: circle at the start; lost: circle at the end.
  assert.ok(m[5].source === undefined && Math.abs(m[5].circle.x - m[5].points[0].x) < 8);
  assert.ok(m[6].target === undefined && m[6].circle.x > m[6].points.at(-1).x);
  // The destroyed lifeline ends at the X.
  const cross = scene.markers.find(k => k.marker === 'cross');
  const lifeline = scene.interaction.lifelines.find(l => l.id === m[4].target);
  assert.ok(cross && Math.abs(lifeline.bottom - cross.tip.y) < 0.5 && Math.abs(lifeline.x - cross.tip.x) < 1);
  assert.ok(Math.abs(cross.tip.y - m[4].head.tip.y) < 1, 'X at the delete message');
});

test('UML notation: no footbox, nested activations offset, frame heading "sd <name>"', async () => {
  const { svg, scene } = await render({ kind: 'sequence', title: 'Nest', lifelines: L('a', 'b'), items: [
    { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'outer', activate: true },
    { type: 'message', sort: 'synchronous', from: 'b', to: 'b', name: 'inner', activate: true },
    { type: 'deactivate', lifeline: 'b' },
    { type: 'message', sort: 'reply', from: 'b', to: 'a', name: 'outer', deactivate: true },
  ] });
  assert.equal(scene.nodes.filter(n => n.type === 'lifeline-head').length, 2);
  assert.doesNotMatch(svg, /participant-tail/);
  const bars = scene.interaction.bars.filter(b => b.lifeline === 'uml_l1');
  const xs = [...new Set(bars.map(b => b.x))].sort((p, q) => p - q);
  assert.equal(xs.length, 2, 'two bar columns');
  assert.ok(xs[1] - xs[0] > 3 && xs[1] - xs[0] < 10, 'nested bar offset to the right');
  const frame = scene.texts.filter(t => t.role === 'frame-label');
  assert.deepEqual(frame.map(t => [t.content, t.bold]), [['sd', true], ['Nest', false]]);
  assert.match(svg, /<path d="M[\d.,]+ L[^"]+ Z" fill="#F1F5F9"/, 'filled pentagon heading');
});

test('UML notation: fragments, guards, interaction use and state invariant text', async () => {
  const { scene } = await render(JSON.parse(await readFile(join(root, 'examples/sequence/notation.json'), 'utf8')));
  const texts = scene.texts.map(t => t.content);
  for (const t of ['alt', 'opt', 'loop(1,3)', 'break', 'par', 'critical', 'neg', 'ref', 'FindUser(name)', '{open}']) assert.ok(texts.includes(t), `missing ${t}`);
  for (const g of ['user found', 'else', 'remember me', 'attempts < 3', 'locked']) assert.ok(texts.some(t => t === `[​${g}​]` || t === `[${g}]`), `missing guard [${g}]`);
  assert.ok(scene.texts.find(t => t.content === 'alt').bold, 'operator in bold');
});

test('hostile, markup-like and Unicode text stays literal in every slot', async () => {
  const hostile = '" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \\n @enduml';
  const samples = [hostile, '  spaced  ', '<svg onload="alert(1)">', 'Unicode: 🚀 𠀀 \u{10FFFD} 漢字'];
  for (const text of samples) {
    const doc = { kind: 'sequence', title: text, lifelines: [{ id: 'a', name: text, classifier: text, symbol: 'actor' }, { id: 'b', name: text }, { id: 'c', name: 'c' }], items: [
      { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: text, arguments: [text], activate: true },
      { type: 'message', sort: 'reply', from: 'b', to: 'a', assignment: text, name: 'get', returnValue: text, deactivate: true },
      { type: 'fragment', operator: 'alt', operands: [{ guard: text, items: [{ type: 'found', sort: 'asynchronous', to: 'b', name: text }] }, { guard: 'else', items: [{ type: 'lost', sort: 'asynchronous', from: 'b', name: text }] }] },
      { type: 'fragment', operator: 'loop', min: 1, max: 2, operands: [{ guard: text, items: [{ type: 'message', sort: 'asynchronous', from: 'b', to: 'c', name: 'x' }] }] },
      { type: 'stateInvariant', lifeline: 'b', constraint: text },
      { type: 'note', position: 'over', lifelines: ['a', 'b'], text },
      { type: 'note', position: 'right', lifelines: ['c'], text },
      { type: 'ref', covered: ['a', 'b'], name: text, arguments: [text] },
    ] };
    const { svg, scene } = await render(doc);
    assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
    assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
    assert.ok(scene.texts.some(t => t.content === text), `literal ${JSON.stringify(text)}`);
  }
});

test('CLI renders sequence diagrams to SVG and PNG', async t => {
  const dir = await workspace(t);
  for (const format of ['svg', 'png']) {
    const out = join(dir, `a.${format}`);
    const result = cli(['render', join(root, 'examples/sequence/minimal.json'), '-o', out]);
    assert.equal(result.status, 0, result.stderr);
    const bytes = await readFile(out);
    if (format === 'png') assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    else assert.match(bytes.toString(), /data-diagram-type="SEQUENCE"/);
  }
});
