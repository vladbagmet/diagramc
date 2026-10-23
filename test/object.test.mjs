import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudget, assertDeterministic, assertExamples, assertHostileTextIsLiteral, assertNegativeFixtures, assertPositiveFixtures, dashed, fixtures, isUnderlined, render, renderExample } from './engine-kind-checks.mjs';

test('object: negative fixtures fail with the exact code and JSON path', () => assertNegativeFixtures('object', 20));
test('object: positive fixtures render and pass every QA gate', () => assertPositiveFixtures('object'));
test('object: every example passes every QA gate', () => assertExamples('object'));
test('object: stress example (40 instances, 60 links) renders within 2 s', () => assertBudget('object'));
test('object: rendering is byte-identical across runs', () => assertDeterministic('object', 'notation'));

test('object notation: instance names underlined as name : Classifier, : Classifier or name', async () => {
  const { svg, scene } = await renderExample('object', 'notation');
  const text = content => scene.texts.find(t => t.content === content);
  for (const t of ['alice : Person', ': Person', 'bob', 'core : Team']) {
    assert.ok(text(t), `missing ${t}`);
    assert.ok(isUnderlined(svg, text(t)), `${t} underlined`);
    assert.ok(text(t).bold);
  }
  assert.ok(text('«entity»'), 'stereotype above the name');
  for (const t of ['age : Integer = 34', 'nick = "Al"']) assert.ok(text(t), `slot ${t}`);
  assert.ok(!isUnderlined(svg, text('age : Integer = 34')), 'slots are not underlined');
  assert.ok(text('object ') && text('Notation reference'), 'frame heading object <title>');
  assert.ok(scene.frameHeading);
});

test('object notation: links are solid lines with underlined names, role names at their ends and navigability', async () => {
  const doc = (await fixtures('object', 'valid.json')).find(c => c.name === 'every link adornment').doc;
  const { svg, scene } = await render(doc);
  const edge = id => scene.edges.find(e => e.id === id);
  assert.deepEqual([edge('full').source, edge('full').target, edge('full').sourceMarker, edge('full').targetMarker], ['a', 'b', 'cross', 'open-arrow']);
  assert.deepEqual([edge('plain').sourceMarker, edge('plain').targetMarker], ['none', 'none']);
  for (const id of ['full', 'named', 'plain']) assert.equal(dashed(svg, id), false, `${id} solid`);
  const label = content => scene.texts.find(t => t.content === content && t.role === 'label');
  assert.ok(isUnderlined(svg, label('l1 : owns')), 'link name : association underlined');
  assert.ok(isUnderlined(svg, label('l2')));
  assert.equal(label('owner').owner, 'full');
  assert.equal(label('owner').end, 'source');
  assert.equal(label('item').end, 'target');
});

test('object notation: notes attach with dotted anchor lines; a self link loops on the top-right corner', async () => {
  const { svg, scene } = await renderExample('object', 'notation');
  const anchors = scene.edges.filter(e => e.type === 'note-anchor');
  assert.equal(anchors.length, 2);
  for (const a of anchors) assert.ok(dashed(svg, a.id));
  const loop = scene.edges.find(e => e.source === 'named' && e.target === 'named');
  const node = scene.nodes.find(n => n.id === 'named').bounds;
  assert.equal(loop.points[0].y, node.y, 'leaves the top border');
  assert.ok(loop.points[0].x < node.x + node.width);
  assert.equal(loop.points.at(-1).x, node.x + node.width, 'returns to the right border');
});

test('object: hostile and markup-like text stays literal and cannot create active SVG', async () => {
  const hostile = String.raw`" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \n @enduml`;
  await assertHostileTextIsLiteral({
    kind: 'object', title: '<script>x</script>',
    elements: [
      { id: 'a', type: 'instance', name: hostile, classifier: '<svg onload="alert(1)">', stereotypes: ['<a href="x">'], slots: [{ feature: '&amp;', type: 'url(https://evil.invalid)', value: '<image href="x"/>' }] },
      { id: 'b', type: 'instance', name: '  🚀 𠀀  ' },
      { id: 'n', type: 'note', text: '<foreignObject>x</foreignObject>', attachedTo: ['a'] },
    ],
    relationships: [{ type: 'link', from: 'a', to: 'b', name: hostile, association: '<use/>', toEnd: { role: '<script>' } }],
  }, [hostile, '<svg onload="alert(1)">', '<image href="x"/>', '  🚀 𠀀  ', '<use/>', '<script>']);
});

test('object: the schema publishes the contract', async () => {
  const { objectKind } = await import('../dist/kinds/object/index.js');
  assert.equal(objectKind.schema.properties.kind.const, 'object');
  assert.deepEqual(objectKind.schema.definitions.element.oneOf.map(b => b.properties.type.const), ['instance', 'note']);
  assert.equal(objectKind.frameKeyword, 'object');
});
