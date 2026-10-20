import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg, runGates } from '../dist/qa/index.js';
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

test('use case: actors stand in the outer columns, lines are straight unless something is in the way', async () => {
  const svg = await svgOf(await readFile(join(root, 'examples/use-case/notation.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  const node = id => scene.nodes.find(n => n.id === id).bounds;
  const cx = id => node(id).x + node(id).width / 2;
  // A specialised actor stands in the column of its general actor (left), a secondary actor right of the use cases.
  assert.ok(Math.abs(cx('student') - cx('user')) < 1, 'Student under Library user');
  assert.ok(cx('librarian') === cx('user'), 'primary actors in one column');
  for (const id of ['borrow', 'reserve', 'identify', 'search']) assert.ok(cx('catalog') > cx(id), `secondary actor right of ${id}`);
  // An actor's associations meet at one point per side; an association to a use case is a straight line.
  const association = scene.edges.find(e => e.type === 'association' && e.source === 'user');
  assert.equal(association.points.length, 2);
  // Ends with multiplicities meet the ellipse near its left or right vertex, so the label sits next to them.
  const end = association.points.at(-1), b = node(association.target);
  assert.ok(Math.abs(end.y - (b.y + b.height / 2)) <= 0.3 * b.height / 2 + 0.5);
});

test('use case: notes and lines never cross notes, captions or other elements; arrowheads at a hub keep apart', async () => {
  // Reviewer models: a condition anchor ran through a note, «include» lines through notes, a comb of
  // arrowheads at the hub use case (see test/fixtures/regression/use-case-*.json for the gates).
  for (const name of ['use-case-u1-atm.json', 'use-case-u2-awkward.json']) {
    const { svg } = await assertGates(await readFile(join(root, 'test/fixtures/regression', name), 'utf8'));
    const scene = await inspectSvg(svg);
    const hub = name.includes('u1') ? 'auth' : 'hub';
    const tips = scene.markers.filter(m => scene.edges.some(e => e.target === hub && Math.hypot(e.points.at(-1).x - m.tip.x, e.points.at(-1).y - m.tip.y) < 0.5)).map(m => m.tip);
    assert.ok(tips.length >= 4, `${name}: arrowheads at the hub`);
    for (const [i, a] of tips.entries()) for (const c of tips.slice(i + 1)) assert.ok(Math.hypot(a.x - c.x, a.y - c.y) >= 14, `${name}: arrowheads apart`);
  }
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

const regression = name => readFile(join(root, 'test/fixtures/regression', name), 'utf8');

test('shared-segments gate on use case drawings: lines running on top of each other fail, a fan from one point does not', () => {
  const node = (id, type, x, y, w, h, parent) => ({ id, type, bounds: { x, y, width: w, height: h }, ...(parent ? { parent } : {}) });
  const edge = (id, target, points) => ({ id, type: 'association', source: 'a', target, points, sourceMarker: 'none', targetMarker: 'none' });
  const scene = edges => ({
    renderer: 'engine', kind: 'use-case', viewBox: { x: 0, y: 0, width: 1000, height: 600 }, markers: [], arrows: [], texts: [], extents: [], unsafe: [],
    nodes: [node('a', 'actor', 10, 100, 30, 60), node('u1', 'useCase', 800, 50, 120, 40), node('u2', 'useCase', 800, 300, 120, 40)], edges,
  });
  const verdict = edges => runGates(scene(edges)).gates.find(g => g.gate === 'shared-segments');
  // Two lines sharing a trunk to a bend at (600, 130), then fanning out (the old hospital stress drawing).
  const trunk = verdict([edge('e1', 'u1', [{ x: 40, y: 130 }, { x: 600, y: 131 }, { x: 800, y: 70 }]), edge('e2', 'u2', [{ x: 40, y: 130 }, { x: 600, y: 132 }, { x: 800, y: 320 }])]);
  assert.equal(trunk.ok, false);
  assert.match(trunk.failures[0], /e1 and e2 share \d+px of line/);
  // Straight lines from one point to the two use cases.
  assert.equal(verdict([edge('e1', 'u1', [{ x: 40, y: 130 }, { x: 800, y: 70 }]), edge('e2', 'u2', [{ x: 40, y: 130 }, { x: 800, y: 320 }])]).ok, true);
  // The gate is generic: the same trunk fails in any kind of drawing.
  assert.equal(runGates({ ...scene([edge('e1', 'u1', [{ x: 40, y: 130 }, { x: 600, y: 131 }]), edge('e2', 'u2', [{ x: 40, y: 130 }, { x: 600, y: 132 }])]), kind: 'class' }).gates.find(g => g.gate === 'shared-segments').ok, false);
});

test('use case layout: actors stand beside the subject they mostly use; no line runs along an unrelated subject', async () => {
  const scene = await inspectSvg(await svgOf(await readFile(join(root, 'examples/use-case/stress.json'), 'utf8')));
  const byId = new Map(scene.nodes.map(n => [n.id, n]));
  const subjects = scene.nodes.filter(n => n.type === 'subject');
  let past = 0;
  for (const e of scene.edges.filter(e => e.type === 'association')) {
    const own = new Set([byId.get(e.source)?.parent, byId.get(e.target)?.parent]);
    const zones = subjects.filter(s => !own.has(s.id)).map(s => ({ x: s.bounds.x - 24, y: s.bounds.y - 24, width: s.bounds.width + 48, height: s.bounds.height + 48 }));
    for (let k = 1; k < e.points.length; k++) {
      const a = e.points[k - 1], b = e.points[k], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
      for (let i = 0; i < n; i++) {
        const p = { x: a.x + (b.x - a.x) * (i + 0.5) / n, y: a.y + (b.y - a.y) * (i + 0.5) / n };
        if (zones.some(z => p.x > z.x && p.x < z.x + z.width && p.y > z.y && p.y < z.y + z.height)) past += Math.hypot(b.x - a.x, b.y - a.y) / n;
      }
    }
  }
  // The row layout ran the clerk's and the patient's lines along the clinical system for about 1800 px.
  assert.ok(past < 300, `${past.toFixed(0)} px of lines past unrelated subjects`);
  // The front desk clerk, mostly at billing, stands level with the billing system.
  const clerk = byId.get('clerk').bounds, billing = byId.get('billing').bounds;
  assert.ok(clerk.y > billing.y && clerk.y < billing.y + billing.height, `${JSON.stringify(clerk)} beside ${JSON.stringify(billing)}`);
});

test('use case layout: generalizations to one actor share one arrowhead; external systems stand right', async () => {
  const awk = await inspectSvg(await svgOf(await regression('use-case-uc-awk.json')));
  const tips = awk.edges.filter(e => e.type === 'generalization' && e.target === 'emp').map(e => e.points.at(-1));
  assert.equal(tips.length, 2);
  assert.ok(Math.hypot(tips[0].x - tips[1].x, tips[0].y - tips[1].y) < 0.5, JSON.stringify(tips));
  const lib = await inspectSvg(await svgOf(await regression('use-case-uc-lib.json')));
  const app = lib.nodes.find(n => n.id === 'app').bounds, psp = lib.nodes.find(n => n.id === 'psp').bounds, cust = lib.nodes.find(n => n.id === 'cust').bounds;
  assert.ok(psp.x > app.x + app.width && cust.x + cust.width < app.x, 'the «system» actor stands right of the subject, the customer left');
});

test('use case layout: a repeated association between one actor and one use case is a second visible line', async () => {
  const scene = await inspectSvg(await svgOf(await readFile(join(root, 'examples/use-case/stress.json'), 'utf8')));
  const both = scene.edges.filter(e => e.source === 'nurse' && e.target === 'vitals');
  assert.equal(both.length, 2);
  const mid = e => e.points[Math.floor(e.points.length / 2)];
  assert.ok(both.some(e => e.points.length > 2), 'one of them bends beside the other');
  assert.ok(Math.hypot(mid(both[0]).x - mid(both[1]).x, mid(both[0]).y - mid(both[1]).y) > 10);
});
