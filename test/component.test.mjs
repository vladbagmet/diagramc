import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { distanceToBorder, center } from '../dist/engine/geometry.js';
import { root } from './helpers.mjs';
import {
  assertBudget, assertDeterministic, assertExamples, assertHostile, assertNegativeFixtures, assertPositiveFixtures,
  dashed, fixtures, inside, node, nodeGroup, scene, text, textIncluding,
} from './structure-helpers.mjs';

const example = name => readFile(join(root, 'examples/component', name), 'utf8');

test('component: negative fixtures fail with the exact code and JSON path', () => assertNegativeFixtures('component', 35));
test('component: positive fixtures render and pass every QA gate', () => assertPositiveFixtures('component'));
test('component: every example passes every QA gate', () => assertExamples('component', 3));

test('component: stress example (30 components, 40+ relationships) renders within 2 s', async () => {
  const { doc } = await assertBudget('component');
  let components = 0;
  const walk = e => { if (e.type === 'component') components++; (e.elements ?? []).forEach(walk); };
  doc.elements.forEach(walk);
  assert.ok(components >= 30 && doc.relationships.length >= 40);
});

test('component: rendering is byte-identical across runs', () => assertDeterministic('examples/component/notation.json'));

test('UML notation: component keyword and icon, artifact keyword and icon, interface box, frame', async () => {
  const { svg, scene: s } = await scene(await example('webshop.json'));
  assert.ok(text(s, '«component»') && text(s, '«artifact»') && text(s, '«interface»'));
  assert.match(nodeGroup(svg, 'ordering'), /data-uml-icon="component"/);
  assert.match(nodeGroup(svg, 'jar'), /data-uml-icon="artifact"/);
  assert.ok(text(s, 'save(order : Order)'), 'interface operations in their compartment');
  assert.ok(text(s, '«external»'), 'stereotypes');
  assert.ok(s.frameHeading && text(s, 'cmp ') && text(s, 'Web shop'), 'frame heading "cmp Web shop"');
  // Nesting: parts are drawn inside their component.
  for (const id of ['manager', 'repo']) {
    assert.equal(node(s, id).parent, 'ordering');
    assert.ok(inside(node(s, 'ordering'), node(s, id)), `${id} inside Ordering`);
  }
});

test('UML notation: ports sit centered on their owner border, delegations attach to them', async () => {
  const { svg, scene: s } = await scene(await example('webshop.json'));
  const ports = s.nodes.filter(n => n.type === 'port');
  assert.deepEqual(ports.map(p => p.id).sort(), ['mIn', 'mOut', 'pOrders', 'pPay']);
  for (const p of ports) {
    assert.ok(distanceToBorder(center(p.bounds), node(s, p.parent).bounds) < 0.01, `${p.id} centered on the border`);
    assert.equal(p.bounds.width, 12);
  }
  const delegations = s.edges.filter(e => e.type === 'delegation');
  assert.deepEqual(delegations.map(e => [e.source, e.target, e.sourceMarker, e.targetMarker]),
    [['pOrders', 'mIn', 'none', 'open-arrow'], ['mOut', 'pPay', 'none', 'open-arrow']]);
  for (const e of delegations) {
    assert.equal(dashed(svg, e.id), false, 'delegation is a solid line');
    assert.ok(distanceToBorder(e.points[0], node(s, e.source).bounds) < 0.01 && distanceToBorder(e.points.at(-1), node(s, e.target).bounds) < 0.01, 'ends on the port squares');
  }
  assert.equal(s.texts.filter(t => t.content === '«delegate»').length, 2);
  assert.ok(text(s, 'orders') && text(s, 'pay'), 'port names');
});

test('UML notation: lollipops, sockets and ball-and-socket assemblies face outward and align', async () => {
  const { scene: s } = await scene(await example('notation.json'));
  const balls = s.nodes.filter(n => n.type === 'provided-interface');
  const sockets = s.nodes.filter(n => n.type === 'required-interface');
  const joints = s.nodes.filter(n => n.type === 'assembly');
  assert.ok(balls.length >= 1 && joints.length === 4);
  for (const j of joints) {
    assert.ok(j.ball && j.socket && Math.abs(j.ball.x - j.socket.x) < 0.01 && Math.abs(j.ball.y - j.socket.y) < 0.01, 'ball inside the socket');
    assert.ok(j.ball.r < j.socket.r);
    const lines = s.edges.filter(e => e.target === j.id);
    assert.equal(lines.length, 2);
    const required = lines.find(e => e.id.endsWith('::required')), provided = lines.find(e => e.id.endsWith('::provided'));
    // Requirer meets the socket's back, provider enters through the opening; both on one horizontal axis.
    assert.equal(required.points.at(-1).x, j.socket.x - j.socket.r * j.socket.u.x);
    assert.equal(provided.points.at(-1).x, j.socket.x + j.socket.r * j.socket.u.x);
    assert.equal(required.points.at(-1).y, j.socket.y);
    assert.equal(provided.points.at(-1).y, j.socket.y);
  }
  // The IHealth lollipop: provided by the "events" port, outside Backend.
  const health = balls.find(b => b.id === 'beEvents::provides::iHealth');
  assert.ok(health && !inside(node(s, 'backend'), health), 'lollipop outside its owner');
  assert.ok(text(s, 'IHealth'));
  for (const name of ['ICatalog', 'IAuth', 'ISearch', 'IEvents']) assert.ok(text(s, name), `${name} names its joint`);
  assert.equal(sockets.length, 0, 'every required interface here is assembled');
});

test('UML notation: unconnected required interfaces are sockets opening away from their owner', async () => {
  const doc = (await fixtures('component', 'valid.json')).find(c => c.name.startsWith('port providing and requiring')).doc;
  const { scene: s } = await scene(doc);
  const sockets = s.nodes.filter(n => n.type === 'required-interface');
  assert.equal(sockets.length, 2);
  const owner = node(s, 'a').bounds;
  for (const k of sockets) {
    const stem = s.edges.find(e => e.target === k.id);
    const into = Math.sign(stem.points.at(-1).x - stem.points.at(-2).x);
    assert.equal(k.socket.u.x, into, 'opening continues the stem direction');
    assert.ok(k.socket.x < owner.x || k.socket.x > owner.x + owner.width, 'outside the component');
  }
});

test('UML notation: realization, usage, manifest and dependency lines and arrowheads', async () => {
  const { svg, scene: s } = await scene(await example('notation.json'));
  const byType = Object.fromEntries(s.edges.map(e => [e.type, e]));
  assert.deepEqual([byType.realization.targetMarker, dashed(svg, byType.realization.id)], ['hollow-triangle', true]);
  assert.deepEqual([byType.usage.targetMarker, dashed(svg, byType.usage.id)], ['open-arrow', true]);
  assert.deepEqual([byType.manifest.source, byType.manifest.target, byType.manifest.targetMarker, dashed(svg, byType.manifest.id)], ['war', 'backend', 'open-arrow', true]);
  assert.deepEqual([byType.dependency.targetMarker, dashed(svg, byType.dependency.id)], ['open-arrow', true]);
  for (const t of ['«use»', '«manifest»', '«trace»', 'telemetry']) assert.ok(textIncluding(s, t), `missing ${t}`);
  assert.ok(text(s, 'api : HttpClient'), 'typed port label');
});

test('component: an interface only used as lollipop or socket is not drawn as a box; with a relationship it is', async () => {
  const { scene: s } = await scene(await example('webshop.json'));
  assert.ok(!node(s, 'iOrders') && !node(s, 'iPayment'), 'IOrders and IPayment only as symbols');
  assert.ok(node(s, 'iStore'), 'IOrderStore is realized and used: drawn as a box');
  // A delegated interface is drawn once, at the outer port.
  assert.ok(!s.nodes.some(n => n.id === 'mIn::provides::iOrders'));
});

test('component: hostile and markup-like text stays literal in every slot', async () => {
  const hostile = '<script>alert(1)</script> " } @enduml [[x]]';
  const doc = {
    kind: 'component', title: '<svg onload="x">',
    elements: [
      { id: 'a', type: 'component', name: hostile, stereotypes: ['<b>'], requires: ['i'], ports: [{ id: 'p', name: '<a href="x">', type: '&amp;' }] },
      { id: 'b', type: 'component', name: '  spaced  ', provides: ['i'] },
      { id: 'i', type: 'interface', name: '<foreignObject>', operations: [{ name: 'url(javascript:x)' }] },
      { id: 'x', type: 'artifact', name: '🚀 𠀀 <image href=x>' },
      { id: 'n', type: 'note', text: '<use href="#x"/> ]]> <!--', attachedTo: ['a'] },
    ],
    relationships: [
      { type: 'assembly', from: 'a', to: 'b', interface: 'i' },
      { type: 'dependency', from: 'x', to: 'b', keyword: '<i>', name: '{{x}}' },
      { type: 'usage', from: 'b', to: 'i' },
    ],
  };
  await assertHostile(doc, [hostile, '«<b>»', '<a href="x"> : &amp;', '  spaced  ', '<foreignObject>', 'url(javascript:x)()', '🚀 𠀀 <image href=x>', '«<i>»', '{{x}}']);
});

test('the published component schema describes the contract', async () => {
  const { componentKind } = await import('../dist/kinds/component/index.js');
  const schema = componentKind.schema;
  assert.equal(schema.properties.kind.const, 'component');
  assert.deepEqual(schema.definitions.relationship.oneOf.map(b => b.properties.type.const), ['assembly', 'delegation', 'realization', 'usage', 'manifest', 'dependency']);
  assert.equal(componentKind.frameKeyword, 'cmp');
});
