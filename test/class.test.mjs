import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { renderToSvg } from '../dist/render.js';
import { inspectSvg } from '../dist/qa/index.js';
import { assertGates, root } from './helpers.mjs';

const fixtures = name => readFile(join(root, 'test/fixtures/class', name), 'utf8').then(JSON.parse);
const examples = async dir => (await readdir(join(root, dir))).filter(f => f.endsWith('.json')).sort().map(f => join(root, dir, f));

test('negative fixtures fail with the exact code and JSON path', async () => {
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

test('positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('every class example (v2 and v1) passes every QA gate', async () => {
  for (const file of [...await examples('examples/class'), ...await examples('examples/v1')]) {
    await assertGates(await readFile(file, 'utf8'));
  }
});

test('stress example (50 classes, 80 relationships) renders within 2 s', async () => {
  const text = await readFile(join(root, 'examples/class/stress.json'), 'utf8');
  const doc = JSON.parse(text);
  assert.equal(doc.elements.length, 50);
  assert.equal(doc.relationships.length, 80);
  const started = performance.now();
  await renderToSvg(parseDocument(text));
  assert.ok(performance.now() - started < 2000, 'stress render took longer than 2 s');
});

test('rendering is byte-identical across runs', async () => {
  const parsed = parseDocument(await readFile(join(root, 'examples/class/notation.json'), 'utf8'));
  assert.equal(await renderToSvg(parsed), await renderToSvg(parsed));
});

test('UML notation: each relationship type gets its line style and end markers', async () => {
  const doc = (await fixtures('valid.json')).find(c => c.name === 'every relationship type between two classes').doc;
  const scene = await inspectSvg(await renderToSvg(parseDocument(JSON.stringify(doc))));
  const byType = Object.fromEntries(scene.edges.map(e => [e.type, e]));
  const expected = {
    generalization: ['none', 'hollow-triangle', false], realization: ['none', 'hollow-triangle', true],
    association: ['cross', 'open-arrow', false], aggregation: ['hollow-diamond', 'none', false],
    composition: ['filled-diamond', 'open-arrow', false], dependency: ['none', 'open-arrow', true],
    containment: ['circle-plus', 'none', false],
  };
  const svg = await renderToSvg(parseDocument(JSON.stringify(doc)));
  for (const [type, [source, target, dashed]] of Object.entries(expected)) {
    assert.equal(byType[type].sourceMarker, source, type);
    assert.equal(byType[type].targetMarker, target, type);
    const group = svg.match(new RegExp(`<g data-uml-role="edge"[^>]*data-uml-type="${type}"[^>]*><path [^>]*>`))[0];
    assert.equal(/stroke-dasharray/.test(group), dashed, `${type} dashed`);
  }
  // Generalization points from the specific (b) to the general (a): arrowhead at a.
  assert.equal(byType.generalization.source, 'b');
  assert.equal(byType.generalization.target, 'a');
});

test('UML notation: keywords, stereotypes, visibility, static, abstract, derived, member formats', async () => {
  const svg = await renderToSvg(parseDocument(await readFile(join(root, 'examples/class/notation.json'), 'utf8')));
  const scene = await inspectSvg(svg);
  const text = content => scene.texts.find(t => t.content === content);
  for (const t of ['«interface»', '«enumeration»', '«dataType»', '«primitive»', '«component, replaceable»', '«use»']) assert.ok(text(t), `missing ${t}`);
  assert.ok(text('Vehicle').italic && text('Vehicle').bold, 'abstract class name is bold italic');
  assert.ok(text('Car').bold && !text('Car').italic);
  assert.ok(text('+ drive(km : Double, out log : Trip)').italic, 'abstract operation is italic');
  for (const t of ['- vin : String {readOnly}', '+ count : Integer = 0', '# wheels : Wheel [2..*]', '~ /age : Integer', '+ isRoadworthy() : Boolean {query}']) assert.ok(text(t), `missing member ${t}`);
  // Static members are underlined with a line directly under their text.
  const count = text('+ count : Integer = 0').bounds;
  const lines = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#0F172A" stroke-width="0.9"\/>/g)].map(m => m.slice(1).map(Number));
  assert.ok(lines.some(([x1, y1, x2]) => Math.abs(x1 - count.x) < 0.5 && Math.abs(x2 - (count.x + count.width)) < 0.5 && y1 > count.y && y1 < count.y + count.height + 3), 'static attribute underlined');
  // Frame heading: pentagon with "class <title>".
  assert.ok(scene.frameHeading);
  assert.ok(text('class ') && text('Notation reference'));
});

test('self-associations stay inside the canvas with labels inside their loop', async () => {
  const doc = (await fixtures('valid.json')).find(c => c.name === 'three labelled self-associations').doc;
  const { svg } = await assertGates(doc);
  const scene = await inspectSvg(svg);
  const node = scene.nodes[0].bounds;
  const right = node.x + node.width, bottom = node.y + node.height;
  const [first, second, third] = scene.edges;
  // Top-right corner, bottom-right corner, then the top-left corner (F-A-07: a third loop does not stretch the box).
  assert.ok(first.points[0].y === node.y && first.points.at(-1).x === right, 'first loop on the top-right corner');
  assert.ok(second.points[0].x === right && second.points.at(-1).y === bottom, 'second loop on the bottom-right corner');
  assert.ok(third.points[0].y === node.y && third.points.at(-1).x === node.x, 'third loop on the top-left corner');
  // Labels of a loop's ends sit inside the loop's bounding box.
  for (const label of scene.texts.filter(t => t.end)) {
    const loop = scene.edges.find(e => e.id === label.owner);
    const xs = loop.points.map(p => p.x), ys = loop.points.map(p => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    assert.ok(label.bounds.x >= box.x - 0.5 && label.bounds.x + label.bounds.width <= box.x + box.width + 0.5 && label.bounds.y >= box.y - 0.5 && label.bounds.y + label.bounds.height <= box.y + box.height + 0.5, `${label.content} inside its loop`);
  }
});

test('hostile and markup-like text stays literal and cannot create active SVG', async () => {
  const hostile = '" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \\n @enduml';
  const doc = {
    kind: 'class', title: '<script>x</script>',
    elements: [
      { id: 'a', type: 'class', name: hostile, stereotypes: ['<svg onload="alert(1)">'], attributes: [{ name: hostile, type: '&amp;' }], operations: [{ name: '<a href="x">', returnType: 'url(https://evil.invalid)' }] },
      { id: 'b', type: 'class', name: '  Customer<T>  ' },
      { id: 'n', type: 'note', text: '<foreignObject>🚀 𠀀 \u{10FFFD}</foreignObject>', attachedTo: ['a'] },
    ],
    relationships: [{ type: 'association', from: 'a', to: 'b', name: hostile, toEnd: { role: '<image href="x"/>' } }],
  };
  const { svg } = await assertGates(doc);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
  assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
  const scene = await inspectSvg(svg);
  assert.ok(scene.texts.some(t => t.content === hostile));
  assert.ok(scene.texts.some(t => t.content === '  Customer<T>  '), 'boundary spaces preserved');
  assert.match(svg, /^<svg [^>]*xml:space="preserve"/);
});

test('v1 MVP documents render on the own engine with v1 semantics', async () => {
  const { svg } = await assertGates(await readFile(join(root, 'examples/v1/order-system.json'), 'utf8'));
  const scene = await inspectSvg(svg);
  const generalization = scene.edges.find(e => e.type === 'generalization');
  assert.deepEqual([generalization.source, generalization.target, generalization.targetMarker], ['customer', 'account', 'hollow-triangle']);
  assert.ok(scene.texts.some(t => t.content === 'id: UUID'), 'v1 members are drawn verbatim');
});

test('the published schema describes the v2 contract', async () => {
  const { classKind } = await import('../dist/kinds/class/index.js');
  const schema = classKind.schema;
  assert.equal(schema.properties.kind.const, 'class');
  assert.ok(schema.definitions.element.oneOf.length === 6);
  assert.deepEqual(schema.definitions.relationship.oneOf.map(b => b.properties.type.const),
    ['generalization', 'realization', 'association', 'aggregation', 'composition', 'dependency', 'containment']);
});

test('validation hints: a swapped composition names the swap with its ends; references never suggest a note', () => {
  const errorOf = doc => { try { parseDocument(JSON.stringify(doc)); } catch (error) { return error; } assert.fail('expected a validation error'); };
  const swapped = errorOf({ kind: 'class', elements: [{ id: 'order', type: 'class', name: 'Order' }, { id: 'line', type: 'class', name: 'OrderLine' }], relationships: [{ type: 'composition', from: 'line', to: 'order', fromEnd: { multiplicity: '1..*' }, toEnd: { multiplicity: '1' } }] });
  assert.equal(swapped.code, 'INVALID_COMPOSITION');
  assert.match(swapped.message, /look swapped.*"fromEnd" and "toEnd" exchanged/);
  assert.deepEqual(swapped.diagnostics[0].details.swap, { from: 'order', to: 'line', fromEnd: { multiplicity: '1' }, toEnd: { multiplicity: '1..*' } });
  for (const kind of ['class', 'object']) {
    const type = kind === 'class' ? 'class' : 'instance', link = kind === 'class' ? 'association' : 'link';
    const error = errorOf({ kind, elements: [{ id: 'a', type, name: 'a' }, { id: 'b', type, name: 'b' }, { id: 'n1', type: 'note', text: 'note', attachedTo: ['a'] }], relationships: [{ type: link, from: 'a', to: 'n2' }] });
    assert.equal(error.code, 'MISSING_REFERENCE');
    assert.doesNotMatch(error.message, /"n1"/, `${kind}: a note is not a valid link end`);
    assert.equal(error.diagnostics[0].details?.suggestion, undefined);
  }
});
