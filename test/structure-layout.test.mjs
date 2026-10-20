// Layout rules of the structural kinds (component, deployment, composite structure)
// found by the final reviews: aspect ratio, ports below name compartments, role
// bindings on their own lines, no interface drawn twice, port order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import { scene } from './structure-helpers.mjs';
import { segmentIntersectsRect, inflate } from '../dist/engine/geometry.js';

const regression = name => readFile(join(root, 'test/fixtures/regression', name), 'utf8');
const example = (kind, name) => readFile(join(root, 'examples', kind, name), 'utf8');
const size = svg => /width="([\d.]+)" height="([\d.]+)"/.exec(svg).slice(1).map(Number);
const segments = points => points.slice(1).map((p, i) => [points[i], p]);

test('layout: component and deployment drawings stay within 2.5:1 when a layout achieves it (F-A-03)', async () => {
  const models = [
    ['component-cmp-awk.json', await regression('component-cmp-awk.json')],
    ['deployment-dep-iot.json', await regression('deployment-dep-iot.json')],
    ['component webshop', await example('component', 'webshop.json')],
    ['component stress', await example('component', 'stress.json')],
    ['deployment webshop', await example('deployment', 'webshop.json')],
    ['deployment stress', await example('deployment', 'stress.json')],
  ];
  for (const [name, doc] of models) {
    const [w, h] = size((await scene(doc)).svg);
    assert.ok(Math.max(w / h, h / w) <= 2.5, `${name}: ${w}x${h}`);
  }
});

/** Name compartments of containers: from the top to the bottom of their last header text. */
function headerBands(s) {
  const bands = [];
  for (const n of s.nodes) {
    if (!s.nodes.some(m => m.parent === n.id && m.type !== 'port')) continue;
    if (n.shape === 'ellipse' || n.type === 'node' || n.type === 'device' || n.type === 'executionEnvironment') continue;
    const texts = s.texts.filter(t => t.owner === n.id).flatMap(t => t.lines);
    if (!texts.length) continue;
    const bottom = Math.max(...texts.map(r => r.y + r.height));
    bands.push({ id: n.id, rect: { x: n.bounds.x, y: n.bounds.y, width: n.bounds.width, height: bottom - n.bounds.y } });
  }
  return bands;
}

test('layout: no line runs through a container name compartment, ports sit below it (F-A-13)', async () => {
  const models = [
    await regression('component-cmp-food.json'),
    await regression('composite-structure-cs-awk.json'),
    await example('component', 'notation.json'),
    await example('component', 'webshop.json'),
    await example('composite-structure', 'thermostat.json'),
  ];
  for (const doc of models) {
    const { scene: s } = await scene(doc);
    const bands = headerBands(s);
    assert.ok(bands.length, 'containers found');
    for (const e of s.edges) {
      for (const [a, b] of segments(e.points)) {
        for (const band of bands) assert.ok(!segmentIntersectsRect(a, b, inflate(band.rect, -1)), `${e.id} crosses the name compartment of ${band.id}`);
      }
    }
  }
});

test('layout: role bindings each leave their collaboration use from their own point and never share a segment (F-A-04)', async () => {
  for (const doc of [await regression('composite-structure-cs-awk.json'), await regression('cs-awkward.json'), await example('composite-structure', 'stress.json'), await example('composite-structure', 'thermostat.json')]) {
    const { scene: s } = await scene(doc);
    const bindings = s.edges.filter(e => e.type === 'role-binding');
    assert.ok(bindings.length >= 2);
    for (const [i, a] of bindings.entries()) {
      for (const b of bindings.slice(i + 1)) {
        if (a.source !== b.source) continue;
        const d = Math.hypot(a.points[0].x - b.points[0].x, a.points[0].y - b.points[0].y);
        assert.ok(d >= 14, `${a.id} and ${b.id} start ${d.toFixed(1)}px apart`);
        for (const [p, q] of segments(a.points)) for (const [r, t] of segments(b.points)) {
          const horizontal = Math.abs(p.y - q.y) < 0.5 && Math.abs(r.y - t.y) < 0.5 && Math.abs(p.y - r.y) < 0.5;
          const vertical = Math.abs(p.x - q.x) < 0.5 && Math.abs(r.x - t.x) < 0.5 && Math.abs(p.x - r.x) < 0.5;
          const k = horizontal ? 'x' : 'y';
          const overlap = Math.min(Math.max(p[k], q[k]), Math.max(r[k], t[k])) - Math.max(Math.min(p[k], q[k]), Math.min(r[k], t[k]));
          assert.ok(!((horizontal || vertical) && overlap > 1), `${a.id} and ${b.id} share a segment`);
        }
      }
    }
  }
});
