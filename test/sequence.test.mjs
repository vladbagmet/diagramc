import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { sequenceToPlantUml } from '../dist/kinds/sequence/to-plantuml.js';
import { attachSelfMessages, clearLabels, endDestroyedLifelines, invariantsBesideBars, separateFragmentEdges } from '../dist/kinds/sequence/postprocess.js';
import { checkSvg, inspectSvg } from '../dist/qa/index.js';
import { cli, root } from './helpers.mjs';

// Java-free tests of the sequence kind: validation, generated PlantUML source and
// the QA reader on a stored render. Real renders are in test/integration/sequence.test.mjs.
const fixtures = name => readFile(join(root, 'test/fixtures/sequence', name), 'utf8').then(JSON.parse);
const examples = async () => (await readdir(join(root, 'examples/sequence'))).filter(f => f.endsWith('.json')).sort().map(f => join(root, 'examples/sequence', f));
const source = doc => sequenceToPlantUml(parseDocument(JSON.stringify(doc)).model);
const body = doc => { const lines = source(doc).split('\n'); return lines.slice(lines.indexOf('</style>') + 1).filter(l => l && l !== '@enduml'); };
const decode = s => s.replaceAll(/<U\+([0-9A-F]{4})>/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16))).replaceAll('​', '');
const L = (...ids) => ids.map(id => ({ id, name: id }));

test('negative fixtures fail with the exact code and JSON path', async () => {
  const cases = await fixtures('invalid.json');
  assert.ok(cases.length >= 45);
  for (const c of cases) {
    assert.throws(() => parseDocument(JSON.stringify(c.doc)), error => {
      assert.equal(error.code, c.expect.code, `${c.name}: ${error.message}`);
      assert.equal(error.path, c.expect.path, `${c.name}: ${error.message}`);
      return true;
    }, c.name);
  }
});

test('more than 400 items in total fail with TOO_MANY_ITEMS at the first item over the limit', () => {
  const messages = n => Array.from({ length: n }, () => ({ type: 'message', sort: 'asynchronous', from: 'a', to: 'b', name: 'm' }));
  const doc = { kind: 'sequence', lifelines: L('a', 'b'), items: [
    { type: 'fragment', operator: 'loop', operands: [{ items: messages(250) }] },
    { type: 'fragment', operator: 'opt', operands: [{ items: messages(250) }] },
  ] };
  assert.throws(() => parseDocument(JSON.stringify(doc)), e => e.code === 'TOO_MANY_ITEMS' && e.path === '/items/1/operands/0/items/148');
});

test('positive fixtures and examples validate', async () => {
  for (const c of await fixtures('valid.json')) assert.doesNotThrow(() => parseDocument(JSON.stringify(c.doc)), c.name);
  const files = await examples();
  assert.ok(files.length >= 3);
  for (const file of files) parseDocument(await readFile(file, 'utf8'));
});

test('stress example has at least 40 messages and nested fragments', async () => {
  const doc = JSON.parse(await readFile(join(root, 'examples/sequence/stress.json'), 'utf8'));
  let messages = 0, depth = 0;
  const visit = (items, d) => { for (const i of items) {
    if (['message', 'found', 'lost'].includes(i.type)) messages++;
    if (i.type === 'fragment') { depth = Math.max(depth, d + 1); for (const o of i.operands) visit(o.items, d + 1); }
  } };
  visit(doc.items, 0);
  assert.ok(messages >= 40, `${messages} messages`);
  assert.ok(depth >= 3, `fragments nested ${depth} deep`);
});

test('UML notation: each message sort gets its PlantUML arrow (strict UML style, no footbox)', () => {
  const lines = source({ kind: 'sequence', title: 'T', autonumber: true, lifelines: L('a', 'b', 'c'), items: [
    { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 's', activate: true },
    { type: 'message', sort: 'reply', from: 'b', to: 'a', name: 's', deactivate: true },
    { type: 'message', sort: 'asynchronous', from: 'a', to: 'b', name: 'x' },
    { type: 'message', sort: 'create', from: 'a', to: 'c', name: 'C' },
    { type: 'message', sort: 'delete', from: 'a', to: 'c', name: 'd' },
    { type: 'found', sort: 'synchronous', to: 'a', name: 'f' },
    { type: 'lost', sort: 'asynchronous', from: 'a', name: 'l' },
    { type: 'message', sort: 'synchronous', from: 'b', to: 'b', name: 'self' },
  ] }).split('\n');
  assert.ok(lines.includes('skinparam style strictuml') && lines.includes('hide footbox') && lines.includes('autonumber'));
  assert.ok(lines.some(l => /^mainframe \*\*sd\*\* ​<U\+0054>​$/.test(l)), 'frame heading sd T');
  const flow = lines.filter(l => /^(uml_|\[o|create |destroy |activate |deactivate )/.test(l)).map(l => l.replace(/ : .*$/, ''));
  assert.deepEqual(flow, [
    'uml_l0 -> uml_l1', 'activate uml_l1',
    'uml_l1 -->> uml_l0', 'deactivate uml_l1',
    'uml_l0 ->> uml_l1',
    'create uml_l2', 'uml_l0 -->> uml_l2',
    'uml_l0 -> uml_l2', 'destroy uml_l2',
    '[o-> uml_l0',
    'uml_l0 ->>o]',
    'uml_l1 -> uml_l1',
  ]);
});

test('UML notation: lifeline heads, symbols and message labels', () => {
  const lines = new Set(body({ kind: 'sequence', lifelines: [
    { id: 'a', name: 'user', symbol: 'actor' }, { id: 'b', name: 'b', classifier: 'B', symbol: 'boundary' },
    { id: 'c', classifier: 'C', symbol: 'control' }, { id: 'd', name: 'd', symbol: 'entity' }, { id: 'e', name: 'e' },
  ], items: [
    { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'get', arguments: ['id', 'n'] },
    { type: 'message', sort: 'reply', from: 'b', to: 'a', assignment: 'x', name: 'get', arguments: [], returnValue: 'Item' },
    { type: 'message', sort: 'asynchronous', from: 'c', to: 'd', name: 'ping' },
    { type: 'message', sort: 'asynchronous', from: 'd', to: 'e', name: 'ping' },
  ] }).map(decode));
  for (const head of ['actor "user" as uml_l0', 'boundary "b : B" as uml_l1', 'control ": C" as uml_l2', 'entity "d" as uml_l3', 'participant "e" as uml_l4']) assert.ok(lines.has(head), head);
  assert.ok(lines.has('uml_l0 -> uml_l1 : get(id, n)'));
  assert.ok(lines.has('uml_l1 -->> uml_l0 : x = get() : Item'));
  assert.ok(lines.has('uml_l2 ->> uml_l3 : ping'));
});

test('UML notation: combined fragments, interaction uses, state invariants and notes', () => {
  const lines = body({ kind: 'sequence', lifelines: L('a', 'b', 'c'), items: [
    { type: 'fragment', operator: 'alt', operands: [
      { guard: 'ok', items: [{ type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'x' }] },
      { guard: 'else', items: [{ type: 'fragment', operator: 'loop', min: 1, max: 3, operands: [{ guard: 'more', items: [{ type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'y' }] }] }] },
    ] },
    { type: 'fragment', operator: 'loop', operands: [{ guard: 'each', items: [{ type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'z' }] }] },
    { type: 'fragment', operator: 'strict', operands: [{ items: [{ type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'p' }] }, { items: [{ type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'q' }] }] },
    { type: 'ref', covered: ['c', 'a', 'b'], name: 'Login', arguments: ['u'] },
    { type: 'stateInvariant', lifeline: 'b', constraint: 'x > 0' },
    { type: 'note', position: 'over', lifelines: ['b', 'a'], text: 'n' },
    { type: 'note', position: 'right', lifelines: ['c'], text: 'r' },
  ] }).map(decode);
  const expected = ['alt ok', 'uml_l0 -> uml_l1 : x', 'else else', 'group loop(1,3) [more]', 'uml_l0 -> uml_l1 : y', 'end', 'end',
    'loop each', 'uml_l0 -> uml_l1 : z', 'end', 'group strict', 'uml_l0 -> uml_l1 : p', 'else', 'uml_l0 -> uml_l1 : q', 'end',
    'ref over uml_l0, uml_l2 : Login(u)', 'rnote over uml_l1 #FFFFFF;line:FFFFFF : {x > 0}', 'note over uml_l0, uml_l1', 'n', 'end note', 'note right of uml_l2', 'r', 'end note'];
  assert.deepEqual(lines.slice(-expected.length).map(l => l.trim()), expected);
});

test('long labels are wrapped with generated line breaks only; each line is encoded', () => {
  const name = 'averyveryverylongoperationnamewithoutanyspaceswhatsoever plus words';
  const src = source({ kind: 'sequence', lifelines: L('a', 'b'), items: [{ type: 'message', sort: 'asynchronous', from: 'a', to: 'b', name }] });
  const line = src.split('\n').find(l => l.startsWith('uml_l0 ->> uml_l1 : '));
  const parts = line.slice('uml_l0 ->> uml_l1 : '.length).split(String.raw`\n`);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.match(p, /^​(?:<U\+[0-9A-F]{4}>)+​$/);
  assert.equal(parts.map(decode).join(''), name);
});

test('hostile text in every slot is encoded and never becomes PlantUML syntax', () => {
  const hostile = String.raw`" } !include https://evil.invalid\n@enduml <b>x</b> [[link]] ** __ \ ;line:red #red <<x>>`;
  const doc = { kind: 'sequence', title: hostile, lifelines: [{ id: 'a', name: hostile, classifier: hostile }, { id: 'b', name: 'b' }], items: [
    { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: hostile, arguments: [hostile] },
    { type: 'message', sort: 'reply', from: 'b', to: 'a', name: 'get', assignment: hostile, returnValue: hostile },
    { type: 'fragment', operator: 'loop', min: 1, operands: [{ guard: hostile, items: [{ type: 'found', sort: 'synchronous', to: 'a', name: hostile }] }] },
    { type: 'fragment', operator: 'alt', operands: [{ guard: hostile, items: [{ type: 'lost', sort: 'synchronous', from: 'a', name: hostile }] }, { guard: hostile, items: [{ type: 'stateInvariant', lifeline: 'a', constraint: hostile }] }] },
    { type: 'note', position: 'over', lifelines: ['a', 'b'], text: hostile },
    { type: 'ref', covered: ['a', 'b'], name: hostile, arguments: [hostile] },
  ] };
  const src = source(doc);
  // Strip every encoded token: what remains is generated syntax only.
  const skeleton = src.replaceAll(/​(?:<U\+[0-9A-F]{4}>)*​/g, 'TEXT');
  for (const fragment of ['!include', 'evil', '<b>', '[[', '#red', '<<x>>', 'line:red']) assert.ok(!skeleton.includes(fragment), fragment);
  assert.equal(skeleton.match(/@enduml/g).length, 1);
  assert.ok(!/<U\+00(?:0A|0D)>/.test(src), 'no encoded line breaks');
  assert.ok(src.split('\n').every(l => !l.includes('uml_') || /^\s*(?:[a-z]+ |\[o|uml_l\d|ref over|note over|rnote over|group |alt |else|loop |end)/.test(l)));
});

test('a destruction that ends an operand gets room before the fragment border', () => {
  const lines = body({ kind: 'sequence', lifelines: L('a', 'b'), items: [
    { type: 'fragment', operator: 'opt', operands: [{ items: [{ type: 'message', sort: 'delete', from: 'a', to: 'b', name: 'drop' }] }] },
  ] }).map(l => l.trim());
  assert.deepEqual(lines.slice(-4).map(decode), ['uml_l0 -> uml_l1 : drop', 'destroy uml_l1', '||12||', 'end']);
});

test('user IDs never reach the generated source', () => {
  const src = source({ kind: 'sequence', lifelines: [{ id: 'secretLifelineId', name: 'a' }, { id: 'other', name: 'b' }], items: [{ type: 'message', sort: 'synchronous', id: 'secretMessageId', from: 'secretLifelineId', to: 'other', name: 'x' }] });
  assert.ok(!src.includes('secretLifelineId') && !src.includes('secretMessageId') && !src.includes('other'));
});

test('post-processing ends destroyed lifelines at their X and attaches self-messages to their activation bar', () => {
  const lifeline = '<g><title>x</title><rect fill="#000000" fill-opacity="0.00000" height="500" width="8" x="96" y="100"/><line style="stroke:#334155;stroke-width:0.5;stroke-dasharray:5,5;" x1="100" x2="100" y1="100" y2="600"/></g>';
  const cross = '<line style="stroke:#334155;stroke-width:1;" x1="91" x2="109" y1="291" y2="309"/><line style="stroke:#334155;stroke-width:1;" x1="91" x2="109" y1="309" y2="291"/>';
  const out = endDestroyedLifelines(`<svg>${lifeline}${cross}</svg>`);
  assert.match(out, /y1="100" y2="300"\/><\/g>/);
  assert.match(out, /height="200"/);
  assert.equal(out.match(/stroke-width:2;/g).length, 2, 'both X styles drawn 2px');
  assert.equal(endDestroyedLifelines(`<svg>${lifeline}</svg>`), `<svg>${lifeline}</svg>`);

  const bar = '<rect fill="#F8FAFC" height="100" style="stroke:#334155;stroke-width:1;" width="10" x="95" y="150"/>';
  const self = '<g class="message" data-participant-1="uml_l1" data-participant-2="uml_l1"><line style="stroke:#334155;stroke-width:1.25;" x1="110" x2="150" y1="200" y2="200"/>';
  assert.match(attachSelfMessages(`${bar}${self}`), /x1="105" x2="150" y1="200" y2="200"/);
});

test('QA reader: a stored sequence render yields lifelines, messages and labels, and the gates pass', async () => {
  const svg = await readFile(join(root, 'test/fixtures/sequence/rendered.svg'), 'utf8');
  const scene = await inspectSvg(svg);
  assert.equal(scene.nodes.filter(n => n.type === 'lifeline-head').length, 5, 'one head per lifeline, no footbox');
  assert.equal(scene.interaction.messages.length, 7);
  const [async, create, , del, found, lost, self] = scene.interaction.messages;
  assert.equal(async.head.style, 'open');
  assert.ok(create.dashed && create.head.style === 'open');
  assert.equal(del.head.style, 'filled');
  assert.ok(found.source === undefined && found.circle);
  assert.ok(lost.target === undefined && lost.circle);
  assert.equal(self.points.length, 4, 'self-message is a three-segment loop');
  assert.equal(scene.markers.filter(m => m.marker === 'cross').length, 1, 'destruction X');
  assert.ok(scene.frameHeading);
  assert.ok(scene.texts.some(t => t.role === 'frame-label' && t.content === 'sd' && t.bold));
  const report = await checkSvg(svg, ['Sorts', 'user', 'signal', 'init', 'drop', 'tick', 'gone', 'self', 'Ctl', 'Store']);
  assert.ok(report.ok, JSON.stringify(report.gates.filter(g => !g.ok)));
  // Engine-only gates are reported as skipped; the ones this reader supplies data for are evaluated.
  const skipped = new Set(report.gates.filter(g => g.skipped).map(g => g.gate));
  for (const gate of ['label-proximity', 'edge-endpoints', 'markers']) assert.ok(skipped.has(gate), gate);
  for (const gate of ['label-overlap', 'label-edge-crossing', 'message-endpoints', 'lifeline-crossing', 'inside-canvas', 'literal-text', 'min-font-size', 'text-fits']) {
    assert.ok(report.gates.some(g => g.gate === gate && !g.skipped), `${gate} evaluated`);
  }
});

test('QA reader: the message-endpoints gate catches arrows that miss their lifeline or point the wrong way', async () => {
  const svg = await readFile(join(root, 'test/fixtures/sequence/rendered.svg'), 'utf8');
  // Shorten the asynchronous message: its line and arrowhead stop 40px early.
  const group = svg.match(/<g class="message"[^>]*>(?:(?!<\/g>).)*signal(?:(?!<\/g>).)*<\/g>/s)[0];
  const shifted = group.replaceAll(/(x2?)="([\d.]+)"/g, (m, k, v) => `${k}="${Number(v) - 40}"`).replaceAll(/points="([^"]*)"/g, (m, p) => `points="${p.split(',').map((v, i) => i % 2 ? v : Number(v) - 40).join(',')}"`);
  const report = await checkSvg(svg.replace(group, shifted));
  const gate = report.gates.find(g => g.gate === 'message-endpoints');
  assert.ok(!gate.ok && gate.failures.some(f => /not on lifeline/.test(f)), JSON.stringify(gate));
  // Mirror the open arrowhead to the sending end: it now points away from the line.
  const main = [...group.matchAll(/<line style="[^"]*" x1="([\d.]+)" x2="([\d.]+)"/g)].find(l => Math.abs(l[1] - l[2]) > 20);
  const sum = Number(main[1]) + Number(main[2]);
  const flipped = group.replaceAll(/<line style="stroke:#334155;stroke-width:1.25;" x1="([\d.]+)" x2="([\d.]+)"/g, (m, a, b) =>
    Math.abs(a - b) <= 16 ? m.replace(`x1="${a}" x2="${b}"`, `x1="${sum - a}" x2="${sum - b}"`) : m);
  assert.notEqual(flipped, group);
  const report2 = await checkSvg(svg.replace(group, flipped));
  assert.ok(!report2.gates.find(g => g.gate === 'message-endpoints').ok);
});

test('QA: lifeline-crossing fails when a lifeline crosses a message label or a guard sits on an activation bar', async () => {
  const svg = await readFile(join(root, 'test/fixtures/sequence/rendered-checkout.svg'), 'utf8');
  const gate = async s => (await checkSvg(s)).gates.find(g => g.gate === 'lifeline-crossing');
  assert.ok((await gate(svg)).ok, 'the stored render passes');
  // Without its halo, the reply label is crossed by the order lifeline.
  const halo = svg.match(/<rect fill="#FFFFFF" height="[\d.]+" width="[\d.]+" x="[\d.]+" y="[\d.]+"\/>(?=<text[^>]*>(?:&#8203;|​)?result = charge)/)[0];
  const unhaloed = await gate(svg.replace(halo, ''));
  assert.ok(!unhaloed.ok && unhaloed.failures.some(f => /result = charge.*crossed by lifeline/.test(f)), JSON.stringify(unhaloed.failures));
  // Moved back onto the service activation bar (PlantUML's own placement), the guard fails.
  const guard = svg.match(/<text[^>]*x="([\d.]+)"[^>]*>\[(?:&#8203;|​)?result\.accepted/);
  const bar = svg.match(/<rect fill="#F8FAFC" height="[\d.]+" style="stroke:#334155;stroke-width:1;" width="10" x="([\d.]+)" y="[\d.]+"\/>/g)
    .map(r => Number(r.match(/ x="([\d.]+)"/)[1])).find(x => x < Number(guard[1]) && Number(guard[1]) - x < 40);
  const onBar = await gate(svg.replace(guard[0], guard[0].replace(`x="${guard[1]}"`, `x="${bar - 4}"`)));
  assert.ok(!onBar.ok && onBar.failures.some(f => /result\.accepted.*activation bar/.test(f)), JSON.stringify(onBar.failures));
  // A halo behind the guard on the bar does not help: the bar would look interrupted.
  const box = guard[0].match(/textLength="([\d.]+)"[^>]*y="([\d.]+)"/);
  const haloed = `<rect fill="#FFFFFF" height="20" rx="3" ry="3" width="${Number(box[1]) + 8}" x="${bar - 8}" y="${Number(box[2]) - 14}"/>`;
  const behind = await gate(svg.replace(guard[0], haloed + guard[0].replace(`x="${guard[1]}"`, `x="${bar - 4}"`)));
  assert.ok(!behind.ok && behind.failures.some(f => /result\.accepted.*activation bar/.test(f)), JSON.stringify(behind.failures));
});

test('post-processing moves a guard off an activation bar, haloing only the dashed lifelines it then covers', () => {
  const lifeline = x => `<g><title>l</title><rect fill="#000000" fill-opacity="0.00000" height="400" width="8" x="${x - 4}" y="100"/><line style="stroke:#334155;stroke-width:0.5;stroke-dasharray:5,5;" x1="${x}" x2="${x}" y1="100" y2="500"/></g>`;
  const bar = '<rect fill="#F8FAFC" height="300" style="stroke:#334155;stroke-width:1.25;" width="10" x="145" y="150"/>';
  const frame = '<rect fill="none" height="200" style="stroke:#475569;stroke-width:1.5;" width="500" x="20" y="200"/>';
  // A 200px guard from 120 covers the bar at 145..155; no free gap exists (lifelines every 120 px).
  const guard = '<text fill="#0F172A" font-size="13" font-weight="bold" textLength="200" x="120" y="220">[a long condition]</text>';
  const out = clearLabels(`<svg>${lifeline(150)}${lifeline(270)}${lifeline(390)}${bar}${frame}${guard}</svg>`);
  const x = Number(out.match(/textLength="200" x="([\d.]+)"/)[1]);
  assert.ok(x >= 159, `the guard starts right of the bar (${x})`);
  assert.match(out, new RegExp(String.raw`<rect fill="#FFFFFF" height="[\d.]+" rx="3" ry="3" width="208" x="${x - 4}" y="[\d.]+"/><text`), 'halo behind the moved guard');
});

test('post-processing separates the right borders of nested fragments and moves state invariants off activation bars', () => {
  const frame = (x, y, w, h) => `<rect fill="none" height="${h}" style="stroke:#475569;stroke-width:1.5;" width="${w}" x="${x}" y="${y}"/>`;
  const svg = '<svg height="400px" style="width:600px;height:400px;" viewBox="0 0 600 400" width="600px">'
    + '<rect fill="#FFFFFF" height="390" style="stroke:#475569;stroke-width:1;" width="560" x="5" y="5"/>'
    + frame(20, 50, 530, 300) + frame(30, 80, 520, 200) + frame(40, 100, 510, 100)
    + '<line style="stroke:#475569;stroke-width:1;stroke-dasharray:2,2;" x1="30" x2="550" y1="220" y2="220"/></svg>';
  const out = separateFragmentEdges(svg);
  assert.match(out, /width="510" x="40" y="100"/, 'the innermost fragment keeps its border');
  assert.match(out, /width="530" x="30" y="80"/, 'its parent ends 10 px further right');
  assert.match(out, /width="550" x="20" y="50"/, 'and the outermost 10 px beyond that');
  assert.match(out, /x1="30" x2="560" y1="220"/, 'the operand separator follows its fragment');
  assert.match(out, /<rect fill="#FFFFFF" height="390" [^>]*width="575"/, 'the diagram frame keeps 10 px around the fragments');
  assert.match(out, /viewBox="0 0 615 400"/);
  const invariant = '<rect fill="#F8FAFC" height="200" style="stroke:#334155;stroke-width:1.25;" width="10" x="95" y="50"/>'
    + '<rect fill="#FFFFFF" height="31" style="stroke:#FFFFFF;stroke-width:1;" width="120" x="40" y="100"/><text font-size="13" textLength="100" x="50" y="120">{x &gt; 0}</text>';
  const moved = invariantsBesideBars(`<svg>${invariant}</svg>`);
  assert.match(moved, /width="120" x="107" y="100"\/><text font-size="13" textLength="100" x="117"/, 'the invariant starts 2 px right of the bar');
});

test('post-processing moves a crossed label beside the lifeline or paints a halo when no gap fits', () => {
  const lifeline = x => `<g><title>l</title><rect fill="#000000" fill-opacity="0.00000" height="400" width="8" x="${x - 4}" y="100"/><line style="stroke:#334155;stroke-width:0.5;stroke-dasharray:5,5;" x1="${x}" x2="${x}" y1="100" y2="500"/></g>`;
  const message = (x1, x2, width) => `<g class="message" data-participant-1="uml_l0" data-participant-2="uml_l2"><line style="stroke:#334155;stroke-width:1.25;" x1="${x1}" x2="${x2}" y1="300" y2="300"/><text fill="#1E293B" font-size="12" textLength="${width}" x="${x1 + 11}" y="291">label</text></g>`;
  // A 60px label starting at 111 is crossed by the lifeline at 150; there is room after it.
  const moved = clearLabels(`<svg>${lifeline(100)}${lifeline(150)}${lifeline(400)}${message(100, 400, 60)}</svg>`);
  const x = Number(moved.match(/textLength="60" x="([\d.]+)"/)[1]);
  assert.ok(x > 154 && x + 60 < 396, `moved beside the lifeline (${x})`);
  // A 280px label cannot avoid the lifeline at 150 within its arrow: it gets a halo.
  const haloed = clearLabels(`<svg>${lifeline(100)}${lifeline(150)}${lifeline(400)}${message(100, 400, 280)}</svg>`);
  // The halo leaves HALO_PAD (4 px) of clear space on each side and has rounded corners.
  assert.match(haloed, /<rect fill="#FFFFFF" height="[\d.]+" rx="3" ry="3" width="288" x="107" y="[\d.]+"\/><text/);
});

test('kinds, schema and validate work for sequence diagrams', () => {
  const kinds = JSON.parse(cli(['kinds']).stdout);
  const kind = kinds.find(k => k.kind === 'sequence');
  assert.deepEqual(kind.backends, ['plantuml']);
  const schema = JSON.parse(cli(['schema', 'sequence']).stdout);
  assert.equal(schema.properties.kind.const, 'sequence');
  assert.deepEqual(schema.definitions.item.oneOf.map(b => b.properties.type.const), ['message', 'found', 'lost', 'activate', 'deactivate', 'destroy', 'stateInvariant', 'note', 'ref', 'fragment']);
  const result = cli(['validate', join(root, 'examples/sequence/checkout.json')]);
  assert.deepEqual(JSON.parse(result.stdout), { valid: true, kind: 'sequence', version: 2 });
});
