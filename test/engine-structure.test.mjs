// Engine and QA additions for the structural kinds (component, deployment,
// composite structure): fixed port positions, compound minimum size, explicit
// label candidates, interface symbols, the ports gate, labels in containers and
// ellipse borders. Kept apart from engine.test.mjs so parallel chunks do not collide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../dist/engine/elk.js';
import { drawEdge } from '../dist/engine/edges.js';
import { contains } from '../dist/engine/geometry.js';
import { placeLabels } from '../dist/engine/labels.js';
import { drawBall, drawSocket, drawJoint, socketBounds, componentIcon, artifactIcon } from '../dist/engine/symbols.js';
import { checkSvg } from '../dist/qa/index.js';

const doc = body => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" data-uml-renderer="engine" data-uml-kind="component">${body}</svg>`;
const failed = report => report.gates.filter(g => !g.ok).map(g => g.gate);
const typed = (id, type, x, y, w, h, extra = '') => `<g data-uml-role="node" data-uml-id="${id}" data-uml-type="${type}" data-uml-bounds="${x} ${y} ${w} ${h}"${extra}><rect x="${x}" y="${y}" width="${w}" height="${h}"/></g>`;
const line = (id, source, target, points, type = 'assembly-required') => drawEdge({ id, type, source, target, points, style: 'solid', sourceMarker: 'none', targetMarker: 'none' });

test('elkjs: fixed port positions (FIXED_POS) and minimum size of compound nodes', async () => {
  const result = await layout(
    [{ id: 'sym', width: 40, height: 60, ports: [{ id: 'sym:e', side: 'EAST', position: 45 }] },
     { id: 'box', width: 300, height: 80, padding: { top: 40, left: 10, bottom: 10, right: 10 }, children: [{ id: 'kid', width: 50, height: 20 }] }],
    [{ id: 'e', source: 'sym:e', target: 'box' }], { direction: 'RIGHT' });
  const sym = result.nodes.get('sym'), port = result.ports.get('sym:e');
  assert.ok(Math.abs(port.x - (sym.x + sym.width)) < 0.01 && Math.abs(port.y - (sym.y + 45)) < 0.01, 'port at its fixed position');
  assert.ok(Math.abs(result.edges.get('e').points[0].y - (sym.y + 45)) < 0.01, 'edge leaves at the fixed position');
  const box = result.nodes.get('box');
  assert.ok(box.width >= 300 && box.height >= 80, 'compound node at least its minimum size (header room)');
  assert.ok(contains(box, result.nodes.get('kid')));
});

test('labels: explicit candidates are used in order and skip occupied spots', () => {
  const taken = { x: 0, y: 0, width: 20, height: 10 }, free = { x: 50, y: 0, width: 20, height: 10 };
  const placed = placeLabels([{ id: 'l', width: 20, height: 10, route: [{ x: 0, y: 0 }, { x: 0, y: 0 }], at: 'center', candidates: [taken, free] }], { rects: [{ x: -5, y: -5, width: 30, height: 20 }], segments: [] });
  assert.deepEqual(placed.get('l'), free);
});

test('symbols: balls, sockets and joints declare their geometry for QA', () => {
  const ball = drawBall({ x: 10, y: 20 }, { id: 'b', type: 'provided-interface' });
  assert.match(ball, /data-uml-bounds="4 14 12 12"/);
  assert.match(ball, /data-uml-ball="10,20,6"/);
  assert.deepEqual(socketBounds({ x: 10, y: 20 }, { x: -1, y: 0 }), { x: 10, y: 10, width: 10, height: 20 }, 'a socket opening left has its back on the right');
  assert.match(drawSocket({ x: 10, y: 20 }, { x: 1, y: 0 }, { id: 's', type: 'required-interface' }), /data-uml-socket="10,20,10,1,0"/);
  const joint = drawJoint({ x: 50, y: 50 }, { x: 1, y: 0 }, { id: 'j', type: 'assembly' });
  assert.match(joint, /data-uml-ball="50,50,6"/);
  assert.match(joint, /data-uml-socket="50,50,10,1,0"/);
  assert.match(componentIcon(0, 0), /data-uml-icon="component"/);
  assert.match(artifactIcon(0, 0), /data-uml-icon="artifact"/);
});

test('QA ports gate: ports on borders, lollipops and sockets facing outward, aligned ball-and-socket joints', async () => {
  const comp = typed('c', 'component', 100, 50, 100, 80);
  const port = (cx, cy) => typed('p', 'port', cx - 6, cy - 6, 12, 12, ' data-uml-parent="c"');
  // A port straddles its owner's border: no overlap failure, centered exactly on the border.
  assert.deepEqual(failed(await checkSvg(doc(comp + port(100, 90)))), []);
  assert.deepEqual(failed(await checkSvg(doc(comp + port(104, 90)))), ['ports']);
  // Lollipop: stem from the port to the ball, ball outside the component.
  const ball = (cx, cy) => typed('b', 'provided-interface', cx - 6, cy - 6, 12, 12, ` data-uml-ball="${cx},${cy},6"`);
  assert.deepEqual(failed(await checkSvg(doc(comp + port(100, 90) + ball(50, 90) + line('s', 'p', 'b', [{ x: 94, y: 90 }, { x: 56, y: 90 }])))), []);
  assert.deepEqual(failed(await checkSvg(doc(comp + port(100, 90) + ball(50, 90) + line('s', 'p', 'b', [{ x: 94, y: 90 }, { x: 60, y: 90 }])))), ['edge-endpoints', 'ports']);
  assert.deepEqual(failed(await checkSvg(doc(comp + port(100, 90) + ball(150, 90) + line('s', 'p', 'b', [{ x: 106, y: 90 }, { x: 144, y: 90 }])))), ['ports'], 'a lollipop inside its owner');
  // Socket opening toward its owner instead of away from it.
  const socket = u => typed('k', 'required-interface', 40, 80, 10, 20, ` data-uml-socket="${u > 0 ? 50 : 40},90,10,${u},0"`);
  assert.deepEqual(failed(await checkSvg(doc(comp + port(100, 90) + socket(-1) + line('s', 'p', 'k', [{ x: 94, y: 90 }, { x: 50, y: 90 }])))), []);
  assert.deepEqual(failed(await checkSvg(doc(comp + port(100, 90) + socket(1) + line('s', 'p', 'k', [{ x: 94, y: 90 }, { x: 50, y: 90 }])))), ['ports']);
  // Joint: requirer at the socket's back, provider through the opening, on one axis.
  const left = typed('l', 'component', 10, 200, 60, 40), right = typed('r', 'component', 300, 200, 60, 40);
  const joint = (ball, u) => typed('j', 'assembly', 170, 210, 20, 20, ` data-uml-ball="${ball},220,6" data-uml-socket="180,220,10,${u},0"`);
  const lines = line('j1', 'l', 'j', [{ x: 70, y: 220 }, { x: 170, y: 220 }]) + line('j2', 'r', 'j', [{ x: 300, y: 220 }, { x: 190, y: 220 }], 'assembly-provided');
  assert.deepEqual(failed(await checkSvg(doc(left + right + joint(180, 1) + lines))), []);
  assert.deepEqual(failed(await checkSvg(doc(left + right + joint(180, -1) + lines))), ['ports'], 'socket facing the requirer');
  assert.deepEqual(failed(await checkSvg(doc(left + right + joint(182, 1) + lines))), ['ports'], 'ball not centered in the socket');
  const bent = line('j1', 'l', 'j', [{ x: 70, y: 224 }, { x: 170, y: 224 }]) + line('j2', 'r', 'j', [{ x: 300, y: 220 }, { x: 190, y: 220 }], 'assembly-provided');
  assert.deepEqual(failed(await checkSvg(doc(left + right + joint(180, 1) + bent))), ['ports'], 'requirer off the axis');
  // Interface names stay next to their symbol.
  const far = '<text x="300" y="40" font-size="12" data-uml-role="label" data-uml-owner="j">IThing</text>';
  assert.deepEqual(failed(await checkSvg(doc(left + right + joint(180, 1) + lines + far))), ['ports']);
});

test('QA gates: labels may sit in a container body but not on leaves or texts; ellipse borders are exact', async () => {
  const container = typed('k', 'node', 10, 10, 300, 200), inner = typed('x', 'artifact', 40, 60, 80, 40, ' data-uml-parent="k"');
  const label = (x, y) => `<text x="${x}" y="${y}" font-size="12" data-uml-role="label" data-uml-owner="e">lbl</text>`;
  assert.deepEqual(failed(await checkSvg(doc(container + inner + label(200, 150)))), [], 'inside the container body');
  assert.deepEqual(failed(await checkSvg(doc(container + inner + label(50, 80)))), ['label-overlap'], 'on a nested leaf');
  assert.deepEqual(failed(await checkSvg(doc(container + inner + label(300, 150)))), ['label-overlap'], 'across the container border');
  const titled = container.replace('</g>', '<text x="100" y="30" font-size="13" data-uml-role="text" data-uml-owner="k">Header</text></g>');
  assert.deepEqual(failed(await checkSvg(doc(titled + inner + label(105, 30)))), ['label-overlap'], 'over the container name');
  // A port does not make a leaf a container.
  const leaf = typed('c', 'component', 200, 230, 80, 40), p = typed('p', 'port', 194, 244, 12, 12, ' data-uml-parent="c"');
  assert.deepEqual(failed(await checkSvg(doc(leaf + p + label(215, 255)))), ['label-overlap']);
  // Ellipses: lines must end on the ellipse, not on its bounding box.
  const ellipse = typed('u', 'collaboration-use', 100, 100, 100, 50, ' data-uml-shape="ellipse"'), part = typed('v', 'part', 300, 100, 60, 50);
  const binding = points => drawEdge({ id: 'b', type: 'role-binding', source: 'u', target: 'v', points, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  assert.deepEqual(failed(await checkSvg(doc(ellipse + part + binding([{ x: 200, y: 125 }, { x: 300, y: 125 }])))), []);
  assert.deepEqual(failed(await checkSvg(doc(ellipse + part + binding([{ x: 200, y: 105 }, { x: 300, y: 105 }])))), ['edge-endpoints']);
});
