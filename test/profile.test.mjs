import test from 'node:test';
import assert from 'node:assert/strict';
import { contains, distance } from '../dist/engine/geometry.js';
import {
  assertBudget,
  assertDeterministic,
  assertExamples,
  assertHostileTextIsLiteral,
  assertNegativeFixtures,
  assertPositiveFixtures,
  dashed,
  fixtures,
  render,
  renderExample,
} from './engine-kind-checks.mjs';

test('profile: negative fixtures fail with the exact code and JSON path', () => assertNegativeFixtures('profile', 30));
test('profile: positive fixtures render and pass every QA gate', () => assertPositiveFixtures('profile'));
test('profile: every example passes every QA gate', () => assertExamples('profile'));
test('profile: stress example (3 profiles, 24 stereotypes, 30 relationships) renders within 2 s', () => assertBudget('profile'));
test('profile: rendering is byte-identical across runs', () => assertDeterministic('profile', 'ejb'));

test('profile notation: «profile» package, «stereotype» boxes with tagged values, «metaclass» boxes', async () => {
  const { scene } = await renderExample('profile', 'ejb');
  const node = id => scene.nodes.find(n => n.id === id);
  const text = (content, owner) => scene.texts.find(t => t.content === content && (owner === undefined || t.node === owner));
  assert.ok(
    contains(node('ejb').tab, text('«profile»', 'ejb').bounds) && contains(node('ejb').tab, text('EJB', 'ejb').bounds),
    '«profile» and name in the tab',
  );
  assert.ok(text('«stereotype»', 'session') && text('Session', 'session').bold);
  assert.ok(text('state : StateKind = stateless', 'session'), 'tagged value with type and default');
  assert.ok(text('table : String [0..1]', 'entity'), 'tagged value multiplicity');
  assert.ok(text('Bean', 'bean').italic, 'abstract stereotype in italics');
  assert.ok(text('«metaclass»', 'component') && text('Component', 'component'));
  assert.ok(text('«Session»', 'cart'), 'applied stereotype on a class');
  assert.ok(text('«enumeration»', 'stateKind') && text('stateful', 'stateKind'));
  assert.equal(node('bean').parent, 'ejb');
  assert.ok(text('profile ') && scene.frameHeading, 'frame heading profile <title>');
});

test('profile notation: extension is a solid line with a filled triangle at the metaclass and {required} at the stereotype end', async () => {
  const doc = (await fixtures('profile', 'valid.json')).find(c => c.name === 'every relationship type').doc;
  const { svg, scene } = await render(doc);
  const edge = id => scene.edges.find(e => e.id === id);
  const labels = owner => scene.texts.filter(t => t.role === 'label' && t.owner === owner);
  assert.deepEqual([edge('ext').source, edge('ext').target, edge('ext').sourceMarker, edge('ext').targetMarker], ['s', 'm', 'none', 'filled-triangle']);
  assert.equal(dashed(svg, 'ext'), false);
  const required = labels('ext').find(t => t.content === '{required}');
  assert.equal(required.end, 'source');
  assert.ok(distance(required.anchor, edge('ext').points[0]) < 0.5);
  assert.deepEqual([edge('gen').targetMarker, dashed(svg, 'gen')], ['hollow-triangle', false]);
  for (const [id, keyword] of [
    ['apply', '«apply»'],
    ['ref', '«reference»'],
  ]) {
    assert.equal(dashed(svg, id), true);
    assert.equal(edge(id).targetMarker, 'open-arrow');
    assert.equal(labels(id)[0].content, keyword);
  }
  assert.deepEqual([edge('apply').source, edge('apply').target], ['app', 'p'], 'apply points from the package to the profile');
  // The metaclass is laid out above the stereotype that extends it.
  const m = scene.nodes.find(n => n.id === 'm').bounds,
    s = scene.nodes.find(n => n.id === 's').bounds;
  assert.ok(m.y + m.height <= s.y, 'metaclass above its stereotype');
});

test('profile notation: each extension of one metaclass has its own arrowhead', async () => {
  const doc = (await fixtures('profile', 'valid.json')).find(c => c.name === 'several stereotypes extending one metaclass').doc;
  const { scene } = await render(doc);
  assert.equal(scene.markers.filter(m => m.marker === 'filled-triangle').length, 3);
});

test('profile: hostile and markup-like text stays literal and cannot create active SVG', async () => {
  const hostile = String.raw`" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \n @enduml`;
  await assertHostileTextIsLiteral(
    {
      kind: 'profile',
      title: '<script>x</script>',
      elements: [
        { id: 'p', type: 'profile', name: hostile, members: ['s'] },
        {
          id: 's',
          type: 'stereotype',
          name: '<svg onload="alert(1)">',
          attributes: [{ name: '<a href="x">', type: '&amp;', default: 'url(https://evil.invalid)' }],
        },
        { id: 'm', type: 'metaclass', name: '  🚀 𠀀  ' },
        { id: 'e', type: 'enumeration', name: 'E', literals: ['<image href="x"/>'] },
        { id: 'n', type: 'note', text: '<foreignObject>x</foreignObject>', attachedTo: ['s'] },
      ],
      relationships: [{ type: 'extension', from: 's', to: 'm', required: true }],
    },
    [hostile, '<svg onload="alert(1)">', '<a href="x"> : &amp; = url(https://evil.invalid)', '  🚀 𠀀  ', '<image href="x"/>'],
  );
});

test('profile: the schema publishes the contract', async () => {
  const { profileKind } = await import('../dist/kinds/profile/index.js');
  assert.equal(profileKind.schema.properties.kind.const, 'profile');
  assert.deepEqual(
    profileKind.schema.definitions.relationship.oneOf.map(b => b.properties.type.const),
    ['extension', 'generalization', 'apply', 'reference'],
  );
  assert.equal(profileKind.frameKeyword, 'profile');
});
