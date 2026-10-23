import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { center, distanceToBorder, distanceToEllipse } from '../dist/engine/geometry.js';
import { root } from './helpers.mjs';
import {
  assertBudget,
  assertDeterministic,
  assertExamples,
  assertHostile,
  assertNegativeFixtures,
  assertPositiveFixtures,
  dashed,
  fixtures,
  inside,
  node,
  nodeGroup,
  scene,
  text,
  textIncluding,
} from './structure-helpers.mjs';

const KIND = 'composite-structure';
const example = name => readFile(join(root, 'examples', KIND, name), 'utf8');
const fixture = async prefix => (await fixtures(KIND, 'valid.json')).find(c => c.name.startsWith(prefix)).doc;

test('composite structure: negative fixtures fail with the exact code and JSON path', () => assertNegativeFixtures(KIND, 25));
test('composite structure: positive fixtures render and pass every QA gate', () => assertPositiveFixtures(KIND));
test('composite structure: every example passes every QA gate', () => assertExamples(KIND, 3));

test('composite structure: stress example (24 parts, 30+ connectors) renders within 2 s', async () => {
  const { doc } = await assertBudget(KIND);
  let parts = 0;
  const walk = p => {
    parts++;
    for (const child of p.parts ?? []) walk(child);
  };
  for (const p of doc.elements[0].parts) walk(p);
  assert.ok(parts >= 24 && doc.relationships.length >= 30);
});

test('composite structure: rendering is byte-identical across runs', () => assertDeterministic('examples/composite-structure/thermostat.json'));

test('UML notation: parts inside the structured class, `name : Type [mult]`, dashed when not composite', async () => {
  const { svg, scene: s } = await scene(await fixture('parts with every aggregation kind'));
  const library = node(s, 'c');
  assert.ok(text(s, 'Library').bold, 'classifier name in bold');
  for (const [id, label, isDashed] of [
    ['a', 'shelves : Shelf [1..*]', false],
    ['b', 'catalog : Catalog', false],
    ['d', 'members : Person [*]', true],
    ['e', 'city : City', true],
    ['f', 'anonymous', false],
  ]) {
    assert.equal(node(s, id).parent, 'c');
    assert.ok(inside(library, node(s, id)), `${id} inside the class`);
    const t = text(s, label);
    assert.ok(t && !t.bold, `${label} in regular weight`);
    assert.equal(/<rect [^>]*stroke-dasharray/.test(nodeGroup(svg, id)), isDashed, `${id} dashed: ${isDashed}`);
  }
  // Internal structure compartment: a line separates the name compartment from the parts.
  assert.match(nodeGroup(svg, 'c'), /<line /);
  for (const e of s.edges) assert.deepEqual([e.sourceMarker, e.targetMarker, dashed(svg, e.id)], ['none', 'none', false], 'connectors are plain solid lines');
  assert.ok(text(s, 'indexes') && text(s, ': Lookup') && text(s, 'residents : Residence'));
  const ends = s.texts
    .filter(t => t.end && t.owner === 'relationships/0')
    .map(t => [t.end, t.content])
    .sort();
  assert.deepEqual(ends, [
    ['source', '1'],
    ['target', '1..*'],
    ['target', 'indexed'],
  ]);
});

test('UML notation: ports on the class and on parts are centered on borders and connectors attach to them', async () => {
  const { scene: s } = await scene(await fixture('connectors through ports'));
  const ports = s.nodes.filter(n => n.type === 'port');
  assert.equal(ports.length, 6);
  for (const p of ports) assert.ok(distanceToBorder(center(p.bounds), node(s, p.parent).bounds) < 0.01, `${p.id} on its owner border`);
  assert.deepEqual(ports.map(p => [p.id, p.parent]).sort(), [
    ['fwIn', 'fw'],
    ['fwOut', 'fw'],
    ['lan', 'c'],
    ['swDown', 'sw'],
    ['swUp', 'sw'],
    ['wan', 'c'],
  ]);
  for (const e of s.edges) {
    for (const [id, p] of [
      [e.source, e.points[0]],
      [e.target, e.points.at(-1)],
    ]) {
      if (ports.some(q => q.id === id)) assert.ok(distanceToBorder(p, node(s, id).bounds) < 0.01, `${e.id} ends on port ${id}`);
    }
  }
  assert.ok(text(s, 'lan [4]') && text(s, 'wan'));
  const conjugated = await scene(await fixture('class with only ports'));
  assert.ok(text(conjugated.scene, ': ~Serial') && text(conjugated.scene, 'south : Eth [2]'), 'conjugated port type with a tilde');
});

test('UML notation: collaborations are dashed ellipses with roles; collaboration uses bind roles to parts', async () => {
  const { svg, scene: s } = await scene(await fixture('two collaboration uses'));
  const k = node(s, 'k');
  assert.equal(k.shape, 'ellipse');
  assert.match(nodeGroup(svg, 'k'), /<ellipse [^>]*stroke-dasharray/);
  assert.match(nodeGroup(svg, 'k'), /<line [^>]*stroke-dasharray/, 'dashed line under the collaboration name');
  for (const r of ['r1', 'r2']) {
    assert.equal(node(s, r).parent, 'k');
    // Role boxes lie inside the ellipse itself, not only inside its bounding box.
    const b = node(s, r).bounds;
    const c = center(k.bounds),
      a = k.bounds.width / 2,
      bb = k.bounds.height / 2;
    for (const p of [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x, y: b.y + b.height },
      { x: b.x + b.width, y: b.y + b.height },
    ]) {
      assert.ok(((p.x - c.x) / a) ** 2 + ((p.y - c.y) / bb) ** 2 < 1, `${r} corner inside the ellipse`);
    }
  }
  for (const u of ['u1', 'u2']) {
    assert.equal(node(s, u).shape, 'ellipse');
    assert.match(nodeGroup(svg, u), /<ellipse [^>]*stroke-dasharray/);
    assert.ok(inside(node(s, 'c'), node(s, u)), 'collaboration use inside its classifier');
  }
  assert.ok(text(s, 'sale : Exchange') && text(s, 'settlement : Exchange'));
  const bindings = s.edges.filter(e => e.type === 'role-binding');
  assert.equal(bindings.length, 4);
  for (const b of bindings) {
    assert.equal(dashed(svg, b.id), true);
    assert.ok(distanceToEllipse(b.points[0], node(s, b.source).bounds) < 0.5, 'binding starts on the ellipse');
    const label = s.texts.find(t => t.owner === b.id);
    assert.equal(label.end, 'target', 'role name next to the bound part');
  }
  assert.deepEqual(bindings.map(b => [b.source, b.target, s.texts.find(t => t.owner === b.id).content]).sort(), [
    ['u1', 'buyer', 'payer'],
    ['u1', 'seller', 'payee'],
    ['u2', 'bank', 'payee'],
    ['u2', 'seller', 'payer'],
  ]);
  assert.ok(textIncluding(s, '«occurrence»'));
  assert.ok(text(s, 'class ') === undefined, 'no frame without a title');
});

test('UML notation: frame heading uses the class keyword', async () => {
  const { scene: s } = await scene(await example('thermostat.json'));
  assert.ok(s.frameHeading && text(s, 'class ') && text(s, 'Smart thermostat'));
});

test('composite structure: hostile and markup-like text stays literal in every slot', async () => {
  const hostile = '<script>alert(1)</script> " } @enduml';
  const doc = {
    kind: KIND,
    title: '<svg onload="x">',
    elements: [
      {
        id: 'c',
        type: 'class',
        name: hostile,
        stereotypes: ['<b>'],
        ports: [{ id: 'p', name: '<a href=x>', type: '&amp;', conjugated: true }],
        parts: [
          { id: 'a', name: '  spaced  ', type: '{T}' },
          { id: 'b', name: '🚀 𠀀', multiplicity: '0..*' },
        ],
        collaborationUses: [{ id: 'u', name: '<use>', collaboration: 'k', bindings: [{ role: 'r', part: 'a' }] }],
      },
      { id: 'k', type: 'collaboration', name: '<foreignObject>', roles: [{ id: 'r', name: ']]>', type: '<!--' }] },
      { id: 'n', type: 'note', text: 'url(javascript:x)', attachedTo: ['c'] },
    ],
    relationships: [{ type: 'connector', from: 'p', to: 'b', name: '<i>', association: '"q"', toEnd: { role: '<role>' } }],
  };
  await assertHostile(doc, [
    hostile,
    '«<b>»',
    '<a href=x> : ~&amp;',
    '  spaced   : {T}',
    '🚀 𠀀 [0..*]',
    '<use> : <foreignObject>',
    ']]> : <!--',
    'url(javascript:x)',
    '<i> : "q"',
    '<role>',
  ]);
});

test('the published composite structure schema describes the contract', async () => {
  const { compositeStructureKind } = await import('../dist/kinds/composite-structure/index.js');
  assert.equal(compositeStructureKind.schema.properties.kind.const, KIND);
  assert.deepEqual(
    compositeStructureKind.schema.definitions.element.oneOf.map(b => b.properties.type.const),
    ['class', 'collaboration', 'note'],
  );
  assert.equal(compositeStructureKind.frameKeyword, 'class');
});
