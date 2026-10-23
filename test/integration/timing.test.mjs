import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { renderToSvg } from '../../dist/render.js';
import { inspectSvg, renderAndCheck } from '../../dist/qa/index.js';
import { assertGates, budgetFactor, cli, plantUmlTest as test, root, workspace } from '../helpers.mjs';

// Real pinned PlantUML (npm run setup:renderer): every gate on every fixture and example.
const fixtures = name => readFile(join(root, 'test/fixtures/timing', name), 'utf8').then(JSON.parse);
const T = (id, notation, states, changes, extra = {}) => ({ id, name: id, notation, states, changes: changes.map(([at, state]) => ({ at, state })), ...extra });

test('positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('every timing example passes every QA gate', async () => {
  const files = (await readdir(join(root, 'examples/timing'))).filter(f => f.endsWith('.json')).sort();
  for (const f of files) await assertGates(await readFile(join(root, 'examples/timing', f), 'utf8'));
});

test('stress example (8 lifelines, 100 changes, 20 messages) renders within 5 s cold', async () => {
  const text = await readFile(join(root, 'examples/timing/stress.json'), 'utf8');
  const doc = JSON.parse(text);
  assert.equal(doc.lifelines.length, 8);
  assert.ok(doc.lifelines.reduce((n, l) => n + l.changes.length, 0) >= 80);
  assert.equal(doc.messages.length, 20);
  const { ms } = await renderAndCheck(text);
  assert.ok(ms < 5000 * budgetFactor, `took ${ms} ms`);
});

test('rendering is byte-identical across runs', async () => {
  const parsed = parseDocument(await readFile(join(root, 'examples/timing/door.json'), 'utf8'));
  assert.equal(await renderToSvg(parsed), await renderToSvg(parsed));
});

test('UML notation: robust states top to bottom in declared order, concise values in bands, sd frame, time unit', async () => {
  const { svg } = await assertGates({ kind: 'timing', title: 'Lamp', timeUnit: 'ms', lifelines: [
    T('r', 'robust', ['High', 'Mid', 'Low'], [[0, 'Low'], [10, 'High'], [20, 'Mid']]),
    T('c', 'concise', ['Off', 'On'], [[0, 'Off'], [10, 'On']]),
  ] });
  const scene = await inspectSvg(svg);
  const y = name => scene.texts.find(t => t.content === name).bounds.y;
  assert.ok(y('High') < y('Mid') && y('Mid') < y('Low'), 'declared order top to bottom');
  // The state line sits at the row of the current state: at t=0 (Low), then High, then Mid.
  const rows = scene.edges.filter(e => e.type === 'waveform').map(e => ({ a: e.points[0], b: e.points[1] })).filter(w => w.a.y === w.b.y && w.a.x !== w.b.x).sort((p, q) => p.a.x - q.a.x);
  const centre = name => y(name) + scene.texts.find(t => t.content === name).bounds.height / 2;
  assert.ok(Math.abs(rows[0].a.y - centre('Low')) < 8 && Math.abs(rows[1].a.y - centre('High')) < 8 && Math.abs(rows[2].a.y - centre('Mid')) < 8);
  for (const v of ['Off', 'On']) assert.ok(scene.texts.some(t => t.content === v && t.role === 'text' && t.node.startsWith('value')), `${v} inside its band`);
  assert.deepEqual(scene.texts.filter(t => t.role === 'frame-label').map(t => [t.content, t.bold]), [['sd', true], ['Lamp', false]]);
  assert.ok(scene.texts.some(t => t.content === 'time (ms)'), 'time unit shown with the axis');
});

test('UML notation: messages run between state lines; duration constraint arrows have two heads and {min..max}', async () => {
  const { svg } = await assertGates(JSON.parse(await readFile(join(root, 'examples/timing/door.json'), 'utf8')));
  const scene = await inspectSvg(svg);
  assert.equal(scene.interaction.messages.length, 2);
  for (const m of scene.interaction.messages) assert.equal(m.head.style, 'filled');
  const constraint = scene.edges.find(e => e.type === 'duration-constraint');
  assert.ok(constraint);
  assert.ok(scene.texts.some(t => t.content === '{0..60}' && t.owner === constraint.id));
  assert.ok(scene.texts.some(t => t.content === '{30..50}'), 'time constraint window label');
});

test('constraints belong to their lifeline; rows have room; one border; labels aligned (review C-12, C-13, C-15, C-43, C-44)', async () => {
  const { svg } = await assertGates(JSON.parse(await readFile(join(root, 'examples/timing/door.json'), 'utf8')));
  const scene = await inspectSvg(svg);
  const text = content => scene.texts.find(t => t.content === content);
  const separators = scene.edges.filter(e => e.type === 'separator').map(e => e.points[0].y).sort((a, b) => a - b);
  const rowOf = y => separators.filter(s => s <= y).length - 1;
  // The time constraint {30..50} of "door" is labelled and shaded inside the door row only.
  const doorRow = rowOf(text('door : Door').bounds.y);
  assert.equal(rowOf(text('{30..50}').bounds.y), doorRow, 'time constraint label in the constrained row');
  const window = [...svg.matchAll(/<rect fill="#F1F5F9" height="([\d.]+)" [^>]*y="([\d.]+)"/g)].map(m => ({ y: Number(m[2]), h: Number(m[1]) }));
  assert.equal(window.length, 1);
  assert.ok(window[0].y >= separators[doorRow] && rowOf(window[0].y + window[0].h - 1) === doorRow, 'window confined to the door row');
  // The duration constraint arrow of "lock" runs above its top state line, not between states.
  const arrow = scene.edges.find(e => e.type === 'duration-constraint');
  assert.ok(arrow.points[0].y < text('Locked').bounds.y - 4, 'duration constraint above the state rows');
  assert.equal(rowOf(arrow.points[0].y), rowOf(text('lock : Lock').bounds.y));
  // Name tab and first state label never touch; state levels at least 24 px apart; labels left-aligned.
  const tabBottom = name => text(name).bounds.y + text(name).bounds.height;
  assert.ok(text('Open').bounds.y - tabBottom('door : Door') >= 6);
  assert.ok(text('Ajar').bounds.y - text('Open').bounds.y >= 24 && text('Closed').bounds.y - text('Ajar').bounds.y >= 24);
  assert.deepEqual(new Set(['Locked', 'Unlocked', 'Open', 'Ajar', 'Closed'].map(n => text(n).bounds.x)).size, 1, 'state labels share one x');
  // No inner box: the only vertical solid lines at the far left are the frame's.
  assert.doesNotMatch(svg, /<line style="stroke:#334155;stroke-width:1.25;" x1="20" x2="20"/, 'no second border inside the frame');
  // Time grid lines stop at the name tabs.
  const tab = text('reader : CardReader').bounds;
  for (const m of svg.matchAll(/<line style="[^"]*dasharray:3,5;[^"]*" x1="([\d.]+)" x2="\1" y1="([\d.]+)" y2="([\d.]+)"/g)) {
    const [x, y1, y2] = m.slice(1).map(Number);
    assert.ok(!(x > tab.x && x < tab.x + tab.width && y1 < tab.y + tab.height && y2 > tab.y), `grid line at x=${x} crosses a name tab`);
  }
});

test('review fixtures: dense timing input is rejected precisely; readable inputs keep a readable aspect ratio', async () => {
  const review = name => readFile(join(root, 'test/fixtures/review', name), 'utf8');
  const awkward = await review('tim-awkward.json');
  assert.throws(() => parseDocument(awkward), e => e.code === 'TIMELINE_TOO_DENSE' && e.diagnostics.length > 1 && e.diagnostics.every(d => /needs about \d+ px/.test(d.message)));
  for (const name of ['tim-traffic.json', 'tim-llm2.json']) {
    const { svg } = await assertGates(await review(name));
    const [w, h] = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/).slice(3).map(Number);
    assert.ok(w / h < 4, `${name}: aspect ratio ${(w / h).toFixed(1)} (was 12.9 for tim-llm2)`);
  }
});

test('hostile, markup-like and Unicode text stays literal in every slot', async () => {
  const hostile = String.raw`" } !include https://evil.invalid <b>x</b> [[link]] **x** \n @enduml`;
  for (const text of [hostile, '  spaced  ', '<svg onload="alert(1)">', 'Unicode: 🚀 𠀀 \u{10FFFD} 漢字']) {
    const doc = { kind: 'timing', title: text, timeUnit: text.slice(0, 40), lifelines: [
      T('r', 'robust', [text, 'Off'], [[0, text], [10, 'Off']], { name: text, classifier: 'R' }),
      T('c', 'concise', [text, 'B'], [[0, 'B'], [20, text]], { name: text }),
    ], messages: [{ from: 'r', fromTime: 10, to: 'c', toTime: 20, name: text }],
    durationConstraints: [{ lifeline: 'r', from: 0, to: 10, min: text.slice(0, 40), max: 'x' }],
    highlights: [{ from: 30, to: 40, label: text }],
    notes: [{ lifeline: 'c', at: 0, text }] };
    const { svg } = await assertGates(doc);
    assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
    assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
    const scene = await inspectSvg(svg);
    assert.ok(scene.texts.some(t => t.content === text), `literal ${JSON.stringify(text)}`);
  }
});

test('CLI renders timing diagrams to SVG and PNG', async t => {
  const dir = await workspace(t);
  for (const format of ['svg', 'png']) {
    const out = join(dir, `a.${format}`);
    const result = cli(['render', join(root, 'examples/timing/minimal.json'), '-o', out]);
    assert.equal(result.status, 0, result.stderr);
    const bytes = await readFile(out);
    if (format === 'png') assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4E, 0x47]);
    else assert.match(bytes.toString(), /data-diagram-type="TIMING"/);
  }
});
