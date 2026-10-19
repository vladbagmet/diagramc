import test from 'node:test';
import assert from 'node:assert/strict';
import { contains } from '../dist/engine/geometry.js';
import { assertBudget, assertDeterministic, assertExamples, assertHostileTextIsLiteral, assertNegativeFixtures, assertPositiveFixtures, dashed, fixtures, render, renderExample } from './engine-kind-checks.mjs';

test('package: negative fixtures fail with the exact code and JSON path', () => assertNegativeFixtures('package', 30));
test('package: positive fixtures render and pass every QA gate', () => assertPositiveFixtures('package'));
test('package: every example passes every QA gate', () => assertExamples('package'));
test('package: stress example (45 elements, 31 relationships, 3 nesting levels) renders within 2 s', () => assertBudget('package'));
test('package: rendering is byte-identical across runs', () => assertDeterministic('package', 'webshop'));

test('package notation: tab folders; name in the tab with contents, in the body without', async () => {
  const { scene } = await renderExample('package', 'webshop');
  const node = id => scene.nodes.find(n => n.id === id);
  const text = content => scene.texts.find(t => t.content === content);
  // Container: the name sits in the tab.
  const shop = node('shop');
  assert.ok(shop.tab && contains(shop.tab, text('shop').bounds), 'container name inside its tab');
  assert.ok(shop.tab.width < shop.bounds.width, 'tab narrower than the body');
  // Empty package: empty tab, name (and stereotype) in the body.
  const util = node('javaUtil');
  assert.ok(util.tab);
  for (const t of ['java.util', '«library»']) assert.ok(text(t).bounds.y >= util.tab.y + util.tab.height, `${t} below the tab`);
  assert.ok(text('java.util').bold);
  // Nesting: members are drawn inside their package, with data-uml-parent.
  for (const [child, parent] of [['web', 'shop'], ['controller', 'web'], ['repo', 'domain'], ['n1', 'shop']]) {
    assert.equal(node(child).parent, parent);
    assert.ok(contains(node(parent).bounds, node(child).bounds), `${child} inside ${parent}`);
    assert.ok(node(child).bounds.y >= node(parent).tab.y + node(parent).tab.height, `${child} below the tab of ${parent}`);
  }
  assert.ok(text('«interface»') && text('OrderRepository'), 'classifier keyword');
  assert.ok(text('package ') && text('Web shop'), 'frame heading package <title>');
});

test('package notation: import, access, merge and dependency are dashed open arrows with keywords; containment uses circle-plus', async () => {
  const doc = (await fixtures('package', 'valid.json')).find(c => c.name === 'every relationship type').doc;
  const { svg, scene } = await render(doc);
  const edge = id => scene.edges.find(e => e.id === id);
  const label = owner => scene.texts.filter(t => t.role === 'label' && t.owner === owner).map(t => t.content).join(' ');
  for (const [id, keyword] of [['imp', '«import»'], ['eimp', '«import»'], ['acc', '«access»'], ['mrg', '«merge»'], ['dep', '«use»needs']]) {
    assert.equal(dashed(svg, id), true, `${id} dashed`);
    assert.deepEqual([edge(id).sourceMarker, edge(id).targetMarker], ['none', 'open-arrow'], id);
    assert.equal(label(id), keyword, id);
  }
  assert.equal(dashed(svg, 'own'), false, 'containment solid');
  assert.deepEqual([edge('own').source, edge('own').target, edge('own').sourceMarker, edge('own').targetMarker], ['e', 'k', 'circle-plus', 'none']);
});

test('package: lines ending at a package meet its tab or its body, never the empty corner beside the tab', async () => {
  for (const name of ['webshop', 'stress']) {
    const { scene } = await renderExample('package', name);
    for (const e of scene.edges) for (const [id, p] of [[e.source, e.points[0]], [e.target, e.points.at(-1)]]) {
      const node = scene.nodes.find(n => n.id === id);
      if (!node.tab) continue;
      const beside = p.x > node.tab.x + node.tab.width + 0.5 && p.y < node.tab.y + node.tab.height - 0.5;
      assert.ok(!beside, `${e.id} ends beside the tab of ${id}`);
    }
  }
});

test('package: hostile and markup-like text stays literal and cannot create active SVG', async () => {
  const hostile = '" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \\n @enduml';
  await assertHostileTextIsLiteral({
    kind: 'package', title: '<script>x</script>',
    elements: [
      { id: 'p', type: 'package', name: hostile, stereotypes: ['<svg onload="alert(1)">'], members: ['c'] },
      { id: 'c', type: 'class', name: '<a href="x">', stereotypes: ['url(https://evil.invalid)'] },
      { id: 'q', type: 'package', name: '  🚀 𠀀  ' },
      { id: 'n', type: 'note', text: '<foreignObject>x</foreignObject>', attachedTo: ['q'] },
    ],
    relationships: [{ type: 'dependency', from: 'c', to: 'q', name: '<image href="x"/>', keyword: '&amp;' }],
  }, [hostile, '<a href="x">', '  🚀 𠀀  ', '<image href="x"/>', '«&amp;»']);
});

test('package: the schema publishes the contract', async () => {
  const { packageKind } = await import('../dist/kinds/package/index.js');
  assert.equal(packageKind.schema.properties.kind.const, 'package');
  assert.deepEqual(packageKind.schema.definitions.relationship.oneOf.map(b => b.properties.type.const), ['import', 'access', 'merge', 'dependency', 'containment']);
  assert.equal(packageKind.frameKeyword, 'package');
});
