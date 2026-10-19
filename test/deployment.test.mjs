import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import {
  assertBudget, assertDeterministic, assertExamples, assertHostile, assertNegativeFixtures, assertPositiveFixtures,
  dashed, fixtures, inside, node, nodeGroup, scene, text, textIncluding,
} from './structure-helpers.mjs';

const example = name => readFile(join(root, 'examples/deployment', name), 'utf8');

test('deployment: negative fixtures fail with the exact code and JSON path', () => assertNegativeFixtures('deployment', 25));
test('deployment: positive fixtures render and pass every QA gate', () => assertPositiveFixtures('deployment'));
test('deployment: every example passes every QA gate', () => assertExamples('deployment', 3));

test('deployment: stress example (45+ elements, 2 regions) renders within 2 s', async () => {
  const { doc } = await assertBudget('deployment');
  let count = 0;
  const walk = e => { count++; (e.elements ?? []).forEach(walk); };
  doc.elements.forEach(walk);
  assert.ok(count >= 45 && doc.relationships.length >= 25);
});

test('deployment: rendering is byte-identical across runs', () => assertDeterministic('examples/deployment/webshop.json'));

test('UML notation: nodes are 3D boxes; devices and execution environments carry their keyword; nesting', async () => {
  const doc = (await fixtures('deployment', 'valid.json')).find(c => c.name.startsWith('every node type')).doc;
  const { svg, scene: s } = await scene(doc);
  // The 3D box: front face plus top and side faces (two polygons) inside the node's bounds.
  for (const id of ['rack', 'srv', 'os', 'jvm']) {
    const group = nodeGroup(svg, id);
    assert.equal((group.match(/<polygon /g) ?? []).length, 2, `${id} has top and side faces`);
  }
  assert.equal(node(s, 'rack').type, 'node');
  assert.ok(text(s, '«device»') && text(s, '«blade»') && s.texts.filter(t => t.content === '«executionEnvironment»').length === 2);
  assert.ok(!s.texts.some(t => t.content === '«node»'), 'a plain node has no keyword');
  for (const [outer, innerId] of [['rack', 'srv'], ['srv', 'os'], ['os', 'jvm'], ['jvm', 'app'], ['jvm', 'cfg'], ['jvm', 'cmp']]) {
    assert.equal(node(s, innerId).parent, outer);
    assert.ok(inside(node(s, outer), node(s, innerId)), `${innerId} drawn inside ${outer}`);
  }
  // Artifacts and specs: keyword and document icon; spec properties in their compartment.
  assert.match(nodeGroup(svg, 'app'), /data-uml-icon="artifact"/);
  assert.match(nodeGroup(svg, 'cfg'), /data-uml-icon="artifact"/);
  assert.ok(text(s, '«artifact»') && text(s, '«deployment spec»') && text(s, 'heap = 2g'));
  assert.match(nodeGroup(svg, 'cmp'), /data-uml-icon="component"/);
});

test('UML notation: communication paths are solid with «protocol», name and end multiplicities', async () => {
  const { svg, scene: s } = await scene(await example('webshop.json'));
  const paths = s.edges.filter(e => e.type === 'communicationPath');
  assert.equal(paths.length, 4);
  for (const p of paths) {
    assert.equal(dashed(svg, p.id), false);
    assert.deepEqual([p.sourceMarker, p.targetMarker], ['none', 'none']);
  }
  assert.ok(textIncluding(s, '«JDBC»') && textIncluding(s, 'orders') && textIncluding(s, '«HTTPS»'));
  const ends = s.texts.filter(t => t.end && t.owner === 'relationships/2');
  assert.deepEqual(ends.map(t => [t.end, t.content]).sort(), [['source', '1'], ['target', '2']]);
  assert.ok(s.frameHeading && text(s, 'dep '), 'frame heading "dep"');
});

test('UML notation: «deploy» and «manifest» are dashed dependencies with open arrowheads at the target', async () => {
  const { svg, scene: s } = await scene(await example('webshop.json'));
  const deploy = s.edges.find(e => e.type === 'deploy'), manifest = s.edges.find(e => e.type === 'manifest');
  assert.deepEqual([deploy.source, deploy.target, deploy.targetMarker, dashed(svg, deploy.id)], ['schema', 'pg', 'open-arrow', true]);
  assert.deepEqual([manifest.source, manifest.target, manifest.targetMarker, dashed(svg, manifest.id)], ['jar', 'ordering', 'open-arrow', true]);
  assert.ok(text(s, '«deploy»') && text(s, '«manifest»') && text(s, '«configures»'));
});

test('deployment: hostile and markup-like text stays literal in every slot', async () => {
  const hostile = '<script>alert(1)</script> " } @enduml';
  const doc = {
    kind: 'deployment', title: '<svg onload="x">',
    elements: [
      { id: 'a', type: 'device', name: hostile, stereotypes: ['<b>'], elements: [{ id: 'x', type: 'artifact', name: '<image href=x>' }] },
      { id: 'b', type: 'node', name: '  spaced  ', elements: [{ id: 's', type: 'deploymentSpecification', name: '&amp;', properties: [{ name: '<a>', type: '{x}', value: 'url(x)' }] }] },
      { id: 'n', type: 'note', text: '🚀 𠀀 <foreignObject>', attachedTo: ['a'] },
    ],
    relationships: [{ type: 'communicationPath', from: 'a', to: 'b', protocol: '<i>', name: ']]>', fromEnd: { multiplicity: '*' } }],
  };
  await assertHostile(doc, [hostile, '«<b>»', '<image href=x>', '  spaced  ', '&amp;', '<a> : {x} = url(x)', '🚀 𠀀 <foreignObject>', '«<i>»', ']]>']);
});

test('the published deployment schema describes the contract', async () => {
  const { deploymentKind } = await import('../dist/kinds/deployment/index.js');
  assert.equal(deploymentKind.schema.properties.kind.const, 'deployment');
  assert.deepEqual(deploymentKind.schema.definitions.relationship.oneOf.map(b => b.properties.type.const), ['communicationPath', 'deploy', 'manifest', 'dependency']);
  assert.equal(deploymentKind.frameKeyword, 'dep');
});
