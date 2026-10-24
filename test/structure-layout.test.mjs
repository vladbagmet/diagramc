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
    if (
      s.nodes.every(m => m.parent !== n.id || m.type === 'port') ||
      n.shape === 'ellipse' ||
      n.type === 'node' ||
      n.type === 'device' ||
      n.type === 'executionEnvironment'
    )
      continue;
    const texts = s.texts.filter(t => t.owner === n.id).flatMap(t => t.lines);
    if (texts.length === 0) continue;
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
  for (const doc of [
    await regression('composite-structure-cs-awk.json'),
    await regression('cs-awkward.json'),
    await example('composite-structure', 'stress.json'),
    await example('composite-structure', 'thermostat.json'),
  ]) {
    const { scene: s } = await scene(doc);
    const bindings = s.edges.filter(e => e.type === 'role-binding');
    assert.ok(bindings.length >= 2);
    for (const [i, a] of bindings.entries()) {
      for (const b of bindings.slice(i + 1)) {
        if (a.source !== b.source) continue;
        const d = Math.hypot(a.points[0].x - b.points[0].x, a.points[0].y - b.points[0].y);
        assert.ok(d >= 14, `${a.id} and ${b.id} start ${d.toFixed(1)}px apart`);
        for (const [p, q] of segments(a.points))
          for (const [r, t] of segments(b.points)) {
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

/** Proper crossing point of two segments, or undefined. */
function crossing([a, b], [c, d]) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) return;
  const k = d1 / (d1 - d2);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

test('layout: no line crosses another next to a port, and none runs along a box it does not touch (F-A-06)', async () => {
  const docs = [
    await regression('component-cmp-awk.json'),
    await regression('component-cmp-food.json'),
    await example('component', 'webshop.json'),
    await example('component', 'notation.json'),
  ];
  for (const doc of docs) {
    const { scene: s } = await scene(doc);
    const ports = s.nodes.filter(n => n.type === 'port');
    for (const [i, e] of s.edges.entries()) {
      for (const f of s.edges.slice(i + 1)) {
        for (const p of segments(e.points))
          for (const q of segments(f.points)) {
            const x = crossing(p, q);
            if (!x) continue;
            for (const port of ports) {
              const c = { x: port.bounds.x + port.bounds.width / 2, y: port.bounds.y + port.bounds.height / 2 };
              assert.ok(Math.hypot(x.x - c.x, x.y - c.y) > 30, `${e.id} crosses ${f.id} next to port ${port.id}`);
            }
          }
      }
    }
    const ancestors = id => {
      const out = new Set();
      for (let n = s.nodes.find(m => m.id === id); n?.parent; n = s.nodes.find(m => m.id === n.parent)) out.add(n.parent);
      return out;
    };
    for (const e of s.edges) {
      const related = new Set([e.source, e.target, ...ancestors(e.source), ...ancestors(e.target)]);
      for (const n of s.nodes) {
        if (
          related.has(n.id) ||
          n.type === 'port' ||
          s.nodes.some(m => m.parent === n.id && m.type !== 'port') ||
          ancestors(n.id).has(e.source) ||
          ancestors(n.id).has(e.target)
        )
          continue;
        for (const [a, b] of segments(e.points)) assert.ok(!segmentIntersectsRect(a, b, inflate(n.bounds, 4)), `${e.id} runs along or through ${n.id}`);
      }
    }
  }
});

/** Longest collinear run two routes share (within 1.5 px), and whether a bend of one lies on the other. */
function sharing(a, b) {
  let run = 0;
  for (const [p, q] of segments(a))
    for (const [r, t] of segments(b)) {
      if (Math.abs(p.x - q.x) < 0.5 && Math.abs(r.x - t.x) < 0.5 && Math.abs(p.x - r.x) <= 1.5)
        run = Math.max(run, Math.min(Math.max(p.y, q.y), Math.max(r.y, t.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, t.y)));
      if (Math.abs(p.y - q.y) < 0.5 && Math.abs(r.y - t.y) < 0.5 && Math.abs(p.y - r.y) <= 1.5)
        run = Math.max(run, Math.min(Math.max(p.x, q.x), Math.max(r.x, t.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, t.x)));
    }
  const near = (p, line) =>
    segments(line).some(([c, d]) => {
      const l2 = (d.x - c.x) ** 2 + (d.y - c.y) ** 2,
        k = l2 ? Math.max(0, Math.min(1, ((p.x - c.x) * (d.x - c.x) + (p.y - c.y) * (d.y - c.y)) / l2)) : 0;
      return Math.hypot(p.x - c.x - k * (d.x - c.x), p.y - c.y - k * (d.y - c.y)) < 1;
    });
  return { run, junction: a.slice(1, -1).some(p => near(p, b)) || b.slice(1, -1).some(p => near(p, a)) };
}

test('layout: no two lines run on top of each other or meet at a bend, also at a port with several lines', async () => {
  const docs = [
    ['component notation', await example('component', 'notation.json')],
    ['composite stress', await example('composite-structure', 'stress.json')],
    ['cs-awk', await regression('composite-structure-cs-awk.json')],
    ['cmp-awk', await regression('component-cmp-awk.json')],
    ['cs-ev', await regression('composite-structure-cs-ev.json')],
    ['component stress', await example('component', 'stress.json')],
    ['c1', await regression('component-c1-ridesharing.json')],
  ];
  for (const [name, doc] of docs) {
    const { scene: s } = await scene(doc);
    for (const [i, e] of s.edges.entries())
      for (const f of s.edges.slice(i + 1)) {
        const { run, junction } = sharing(e.points, f.points);
        assert.ok(run <= 10, `${name}: ${e.id} and ${f.id} share ${run.toFixed(0)} px`);
        assert.ok(!junction, `${name}: ${e.id} and ${f.id} meet where one bends`);
      }
  }
});

test('notation: an interface appears once, as a box joined by lines or as one symbol, never as a second unjoined symbol (F-A-12)', async () => {
  const docs = [
    await regression('component-cmp-awk.json'),
    await regression('component-cmp-food.json'),
    await example('component', 'stress.json'),
    await example('component', 'webshop.json'),
    await example('component', 'notation.json'),
  ];
  for (const doc of docs) {
    const { scene: s } = await scene(doc);
    const loose = s.nodes.filter(n => n.type === 'provided-interface' || n.type === 'required-interface').map(n => n.id.split('::').at(-1));
    const boxes = new Set(s.nodes.filter(n => n.type === 'interface').map(n => n.id));
    for (const i of loose) {
      assert.ok(!boxes.has(i), `${i} is both a box and an unconnected symbol`);
      assert.equal(loose.filter(x => x === i).length, 1, `${i} appears as several unconnected symbols`);
    }
  }
  const { scene: stress } = await scene(await example('component', 'stress.json'));
  assert.ok(
    stress.nodes.some(n => n.id === 'iCharge'),
    'ICharge, provided and required without an assembly, is a box',
  );
  assert.ok(
    stress.edges.some(e => e.source === 'payments' && e.target === 'iCharge' && e.targetMarker === 'hollow-triangle'),
    'realized by Payment Provider',
  );
  assert.ok(
    stress.edges.some(e => e.source === 'billing2' && e.target === 'iCharge' && e.targetMarker === 'open-arrow'),
    'used by Tax Engine',
  );
});
