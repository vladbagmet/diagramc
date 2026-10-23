import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../dist/engine/elk.js';
import { loadFonts } from '../dist/engine/fonts.js';
import { layoutDiagram, drawDiagram } from '../dist/engine/diagram.js';
import { measurePackage, drawPackageNode } from '../dist/engine/packages.js';
import { Canvas } from '../dist/engine/svg.js';
import { contains } from '../dist/engine/geometry.js';
import { drawEdge } from '../dist/engine/edges.js';
import { checkOwnership, nestedIn } from '../dist/model/nesting.js';
import { checkSvg, inspectSvg } from '../dist/qa/index.js';

// Engine pieces added for nesting kinds (package, profile, object): ELK compound
// options, the package shape, the generic diagram pipeline, QA gate outlines.

test('elkjs: a compound node spaces the edges crossing its border by portSpacing', async () => {
  const result = await layout(
    [
      {
        id: 'pkg',
        width: 0,
        height: 0,
        portSpacing: 28,
        padding: { top: 30, left: 12, bottom: 12, right: 12 },
        children: [{ id: 'x', width: 60, height: 40 }],
      },
      { id: 'a', width: 60, height: 40 },
      { id: 'b', width: 60, height: 40 },
    ],
    [
      { id: 'ea', source: 'a', target: 'pkg' },
      { id: 'eb', source: 'b', target: 'pkg' },
    ],
    { direction: 'DOWN' },
  );
  const ends = ['ea', 'eb'].map(id => result.edges.get(id).points.at(-1));
  assert.ok(Math.abs(ends[0].x - ends[1].x) >= 28 - 0.01, 'edges into the compound node are spaced by portSpacing');
});

test('elkjs: a nested node with one side port is not stretched by its parent port spacing', async () => {
  const result = await layout(
    [
      {
        id: 'pkg',
        width: 0,
        height: 0,
        portSpacing: 28,
        padding: { top: 30, left: 12, bottom: 12, right: 12 },
        children: [
          { id: 'm', width: 96, height: 53, ports: [{ id: 'm:p', side: 'EAST', width: 26 }] },
          { id: 's', width: 96, height: 83 },
        ],
      },
    ],
    [{ id: 'e', source: 'm:p', target: 's' }],
    { direction: 'RIGHT' },
  );
  assert.equal(result.nodes.get('m').height, 53);
});

test('packages: the name sits in the tab for containers and in the body for empty packages; data-uml-tab marks the outline', async () => {
  const metrics = await loadFonts();
  const canvas = new Canvas(metrics);
  for (const container of [true, false]) {
    const pkg = measurePackage(metrics, { name: 'billing', keywords: ['profile'] }, container);
    const bounds = { x: 10, y: 10, width: Math.max(pkg.width, 200), height: Math.max(pkg.height, 120) };
    const svg = await new Promise(resolve => {
      canvas.nodes.length = 0;
      canvas.nodes.push(drawPackageNode(canvas, pkg, bounds, { id: 'p', type: 'package' }));
      resolve(canvas.finish({ width: 300, height: 200, kind: 'package' }));
    });
    const scene = await inspectSvg(await svg);
    const node = scene.nodes[0];
    assert.deepEqual(node.tab, { x: 10, y: 10, width: pkg.tab.width, height: pkg.tab.height });
    const name = scene.texts.find(t => t.content === 'billing');
    if (container) assert.ok(contains(node.tab, name.bounds), 'container: name in the tab');
    else assert.ok(name.bounds.y >= node.tab.y + node.tab.height, 'empty package: name in the body');
    assert.ok(scene.texts.some(t => t.content === '«profile»'));
  }
});

test('diagram pipeline: containers enclose their children below the tab, lines end on the tab or body, containers are drawn below lines', async () => {
  const metrics = await loadFonts();
  const box = (id, name) => ({
    id,
    type: 'class',
    shape: { kind: 'box', compartments: [{ header: true, lines: [{ text: name, style: { size: 14, bold: true }, align: 'center' }] }] },
  });
  const spec = {
    kind: 'package',
    frameKeyword: 'package',
    title: 'T',
    nodes: [
      { id: 'p', type: 'package', shape: { kind: 'package', header: { name: 'a.rather.long.package.name' } }, children: [box('c', 'C'), box('d', 'D')] },
      { id: 'q', type: 'package', shape: { kind: 'package', header: { name: 'q' } } },
      box('top1', 'Top1'),
      box('top2', 'Top2'),
      box('top3', 'Top3'),
    ],
    edges: [
      {
        id: 'e1',
        type: 'import',
        source: 'top1',
        target: 'p',
        style: 'dashed',
        sourceMarker: 'none',
        targetMarker: 'open-arrow',
        center: [{ text: '«import»' }],
      },
      { id: 'e2', type: 'import', source: 'top2', target: 'p', style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' },
      { id: 'e3', type: 'dependency', source: 'top3', target: 'p', style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' },
      {
        id: 'e4',
        type: 'link',
        source: 'c',
        target: 'd',
        style: 'solid',
        sourceMarker: 'none',
        targetMarker: 'none',
        center: [{ text: 'name', underline: true }],
        ends: [{ end: 'target', text: 'role', kind: 'role' }],
      },
      { id: 'e5', type: 'import', source: 'p', target: 'q', style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' },
    ],
  };
  const svg = await drawDiagram(await layoutDiagram(spec, metrics), metrics);
  const report = await checkSvg(svg, ['a.rather.long.package.name', 'C', 'D', 'q', 'name', 'role']);
  assert.ok(report.ok, JSON.stringify(report.gates.filter(g => !g.ok)));
  const scene = await inspectSvg(svg);
  const p = scene.nodes.find(n => n.id === 'p');
  assert.ok(p.bounds.width >= p.tab.width + 24, 'a container is at least as wide as its tab');
  for (const id of ['c', 'd']) {
    const child = scene.nodes.find(n => n.id === id);
    assert.equal(child.parent, 'p');
    assert.ok(contains(p.bounds, child.bounds) && child.bounds.y > p.tab.y + p.tab.height);
  }
  for (const e of scene.edges.filter(e => e.target === 'p')) {
    const end = e.points.at(-1);
    assert.ok(!(end.x > p.tab.x + p.tab.width && end.y < p.tab.y + p.tab.height - 0.5), `${e.id} ends beside the tab`);
  }
  // Containers are written before the edge layer so lines inside them stay visible.
  assert.ok(svg.indexOf('data-uml-id="p"') < svg.indexOf('data-uml-role="edge"'));
  assert.ok(svg.indexOf('data-uml-id="c"') > svg.indexOf('data-uml-role="edge"'));
});

// QA gates: packages' outlines and labels inside containers.
const doc = body =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" data-uml-renderer="engine" data-uml-kind="package">${body}</svg>`;
const failed = report => report.gates.filter(g => !g.ok).map(g => g.gate);
const pkg = '<g data-uml-role="node" data-uml-id="p" data-uml-type="package" data-uml-bounds="20 20 300 200" data-uml-tab="20 20 60 20"></g>';
const inner = (id, x, y) => `<g data-uml-role="node" data-uml-id="${id}" data-uml-type="class" data-uml-parent="p" data-uml-bounds="${x} ${y} 60 30"></g>`;
const outside = '<g data-uml-role="node" data-uml-id="o" data-uml-type="class" data-uml-bounds="340 20 50 30"></g>';
const line = (id, source, target, points) =>
  drawEdge({ id, type: 'import', source, target, points, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
const label = (owner, x, y) => `<text x="${x}" y="${y}" font-size="12" data-uml-role="label" data-uml-owner="${owner}">lbl</text>`;

test('QA gates: a line may end on a package tab or body but not beside the tab', async () => {
  assert.deepEqual(
    failed(
      await checkSvg(
        doc(
          pkg +
            outside +
            line('e', 'o', 'p', [
              { x: 365, y: 50 },
              { x: 365, y: 40 },
              { x: 200, y: 40 },
              { x: 200, y: 40 },
            ]),
        ),
      ),
    ),
    [],
  );
  assert.deepEqual(
    failed(
      await checkSvg(
        doc(
          pkg +
            outside +
            line('e', 'o', 'p', [
              { x: 365, y: 50 },
              { x: 365, y: 60 },
              { x: 320, y: 60 },
            ]),
        ),
      ),
    ),
    [],
  );
  // (This route is also a detour for route-length; only the endpoint rule matters here.)
  assert.ok(
    !failed(
      await checkSvg(
        doc(
          pkg +
            outside +
            line('e', 'o', 'p', [
              { x: 365, y: 20 },
              { x: 365, y: 10 },
              { x: 50, y: 10 },
              { x: 50, y: 20 },
            ]),
        ),
      ),
    ).includes('edge-endpoints'),
    'on the tab top',
  );
  assert.deepEqual(
    failed(
      await checkSvg(
        doc(
          pkg +
            outside +
            line('e', 'o', 'p', [
              { x: 365, y: 20 },
              { x: 365, y: 10 },
              { x: 200, y: 10 },
              { x: 200, y: 20 },
            ]),
        ),
      ),
    ),
    ['edge-endpoints'],
    'beside the tab',
  );
});

test('QA gates: labels may sit inside a container that encloses an end of their edge, clear of its tab', async () => {
  const a = inner('a', 40, 60),
    b = inner('b', 40, 160),
    e = line('e', 'a', 'b', [
      { x: 70, y: 90 },
      { x: 70, y: 160 },
    ]);
  assert.deepEqual(failed(await checkSvg(doc(pkg + a + b + e + label('e', 80, 130)))), []);
  assert.ok(failed(await checkSvg(doc(pkg + a + b + e + label('e', 30, 35)))).includes('label-overlap'), 'on the tab');
  const f = line('f', 'o', 'o2', [
    { x: 365, y: 50 },
    { x: 365, y: 240 },
  ]);
  const o2 = '<g data-uml-role="node" data-uml-id="o2" data-uml-type="class" data-uml-bounds="340 240 50 30"></g>';
  assert.ok(
    failed(await checkSvg(doc(pkg + outside + o2 + f + label('f', 200, 130)))).includes('label-overlap'),
    'label of an unrelated edge inside the container',
  );
});

test('nesting rules: one owner, no duplicates, no cycles', () => {
  const diagnostics = [];
  const owner = checkOwnership(
    [
      { from: 'a', to: 'b', path: '/1' },
      { from: 'c', to: 'b', path: '/2' },
      { from: 'a', to: 'b', path: '/3' },
      { from: 'b', to: 'd', path: '/4' },
      { from: 'd', to: 'a', path: '/5' },
    ],
    diagnostics,
  );
  assert.deepEqual(
    diagnostics.map(d => [d.code, d.path]),
    [
      ['MULTIPLE_OWNERS', '/2'],
      ['DUPLICATE_MEMBER', '/3'],
      ['CONTAINMENT_CYCLE', '/5'],
    ],
  );
  assert.equal(owner.get('b'), 'a');
  assert.ok(
    nestedIn(
      'd',
      'a',
      new Map([
        ['b', 'a'],
        ['d', 'b'],
      ]),
    ),
  );
  assert.ok(!nestedIn('a', 'x', new Map([['b', 'a']])));
});

test('parallel relationships between one pair form a short bundle with each label beside its own line', async () => {
  const { readFile } = await import('node:fs/promises');
  const { renderAndCheck } = await import('../dist/qa/index.js');
  const { labelLineDistances } = await import('../dist/engine/labels.js');
  const doc = await readFile(new URL('fixtures/regression/package-awkward.json', import.meta.url), 'utf8');
  const { svg, report } = await renderAndCheck(doc);
  assert.ok(report.ok);
  const scene = await inspectSvg(svg);
  const node = id => scene.nodes.find(n => n.id === id).bounds;
  const gap =
    Math.max(0, node('lib').y - node('other').y - node('other').height, node('other').y - node('lib').y - node('lib').height) +
    Math.max(0, node('lib').x - node('other').x - node('other').width, node('other').x - node('lib').x - node('lib').width);
  const pair = scene.edges.filter(e => [e.source, e.target].sort().join(',') === 'lib,other');
  assert.equal(pair.length, 5);
  const length = pts => pts.slice(1).reduce((s, p, k) => s + Math.hypot(p.x - pts[k].x, p.y - pts[k].y), 0);
  for (const e of pair) {
    assert.ok(length(e.points) <= gap + 400, `${e.id} is ${length(e.points).toFixed(0)} px long for a ${gap.toFixed(0)} px gap`);
    const label = scene.texts.find(t => t.role === 'label' && t.owner === e.id && !t.end);
    const d = labelLineDistances(
      label.bounds,
      e.points,
      pair.filter(o => o !== e).map(o => o.points),
    );
    assert.ok(d.own <= 8 && d.other >= d.own + 6, `label of ${e.id}: ${d.own.toFixed(1)} px from its line, ${d.other.toFixed(1)} px from the next`);
  }
});
