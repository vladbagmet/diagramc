import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../dist/engine/elk.js';
import { loadFonts, fontFaceCss } from '../dist/engine/fonts.js';
import { wrapText } from '../dist/engine/text.js';
import { el, Canvas } from '../dist/engine/svg.js';
import { drawEdge } from '../dist/engine/edges.js';
import { planSelfLoops, selfLoopRoute } from '../dist/engine/selfloops.js';
import { distanceToBorder, contains, overlaps } from '../dist/engine/geometry.js';
import { checkSvg } from '../dist/qa/index.js';

const options = { direction: 'DOWN' };

// elkjs proofs: the next chunks depend on edge labels, fixed-side ports and compound nodes.
test('elkjs: center, head and tail edge labels get reserved, non-overlapping room', async () => {
  const label = (id, placement, width = 40) => ({ id, width, height: 16, placement });
  const result = await layout(
    [{ id: 'a', width: 120, height: 60 }, { id: 'b', width: 120, height: 60 }],
    [{ id: 'e', source: 'a', target: 'b', labels: [label('c', 'center'), label('h', 'head'), label('t', 'tail')] }], options);
  const a = result.nodes.get('a'), b = result.nodes.get('b'), labels = result.edges.get('e').labels;
  for (const l of labels.values()) for (const n of [a, b]) assert.ok(!overlaps(l, n), 'label overlaps a node');
  assert.ok(!overlaps(labels.get('c'), labels.get('h')) && !overlaps(labels.get('h'), labels.get('t')));
  assert.ok(labels.get('h').y > labels.get('c').y && labels.get('t').y < labels.get('c').y, 'head near target, tail near source');
  const points = result.edges.get('e').points;
  assert.ok(distanceToBorder(points[0], a) < 0.01 && distanceToBorder(points.at(-1), b) < 0.01, 'route ends on node borders');
});

test('elkjs: fixed-side ports are respected and a shared port joins edges (generalization tree)', async () => {
  const result = await layout(
    [{ id: 'p', width: 120, height: 60, ports: [{ id: 'p:gen', side: 'SOUTH', width: 26 }] },
     { id: 'c1', width: 80, height: 40 }, { id: 'c2', width: 80, height: 40 }, { id: 'c3', width: 80, height: 40, ports: [{ id: 'c3:w', side: 'WEST' }] }],
    [{ id: 'e1', source: 'p:gen', target: 'c1' }, { id: 'e2', source: 'p:gen', target: 'c2' }, { id: 'e3', source: 'p:gen', target: 'c3:w' }], options);
  const p = result.nodes.get('p'), port = result.ports.get('p:gen');
  assert.ok(Math.abs(port.y - (p.y + p.height)) < 0.01, 'SOUTH port on the bottom border');
  for (const id of ['e1', 'e2', 'e3']) assert.deepEqual(result.edges.get(id).points[0], port);
  const c3 = result.nodes.get('c3'), end = result.edges.get('e3').points.at(-1);
  assert.ok(Math.abs(end.x - c3.x) < 0.01, 'WEST port on the left border');
});

test('elkjs: compound nodes contain their children and cross-hierarchy edges get absolute coordinates', async () => {
  const result = await layout(
    [{ id: 'pkg', width: 0, height: 0, padding: { top: 30, left: 12, bottom: 12, right: 12 }, children: [{ id: 'x', width: 100, height: 40 }, { id: 'y', width: 100, height: 40 }] },
     { id: 'z', width: 100, height: 40 }],
    [{ id: 'inner', source: 'x', target: 'y' }, { id: 'cross', source: 'x', target: 'z', labels: [{ id: 'l', width: 50, height: 16, placement: 'center' }] }],
    { ...options, direction: 'DOWN' });
  const pkg = result.nodes.get('pkg');
  for (const id of ['x', 'y']) assert.ok(contains(pkg, result.nodes.get(id)), `${id} inside its package`);
  assert.ok(result.nodes.get('x').y - pkg.y >= 30, 'top padding (room for a tab) respected');
  const cross = result.edges.get('cross').points;
  assert.ok(distanceToBorder(cross[0], result.nodes.get('x')) < 0.01 && distanceToBorder(cross.at(-1), result.nodes.get('z')) < 0.01);
  const inner = result.edges.get('inner').points;
  assert.ok(distanceToBorder(inner[0], result.nodes.get('x')) < 0.01 && distanceToBorder(inner.at(-1), result.nodes.get('y')) < 0.01);
});

test('self-loops: engine routes nest on the right border inside the reserved room', async () => {
  const plan = planSelfLoops([{ endLabelWidth: 40, endLabelRows: 2, labelHeight: 17 }, { endLabelWidth: 0, endLabelRows: 0, labelHeight: 17, centerLabel: { width: 30, height: 17 } }]);
  const result = await layout(
    [{ id: 'top', width: 100, height: 40 }, { id: 'a', width: 100, height: plan.minHeight, reserveRight: plan.reserveRight }, { id: 'b', width: 100, height: 40 }, { id: 'c', width: 100, height: 40 }],
    [{ id: 'e1', source: 'top', target: 'a' }, { id: 'e2', source: 'top', target: 'b' }, { id: 'e3', source: 'top', target: 'c' }], options);
  const a = result.nodes.get('a');
  const routes = [0, 1].map(i => selfLoopRoute(a, plan, i));
  for (const route of routes) for (const point of route) {
    assert.ok(point.x >= a.x + a.width && point.x <= a.x + a.width + plan.reserveRight);
    assert.ok(point.y >= a.y && point.y <= a.y + a.height);
  }
  const reserved = { x: a.x + a.width, y: a.y, width: plan.reserveRight, height: a.height };
  for (const id of ['top', 'b', 'c']) assert.ok(!overlaps(reserved, result.nodes.get(id)), `ELK kept the reserved room free of ${id}`);
  assert.ok(routes[1][1].x > routes[0][1].x && routes[1][0].y < routes[0][0].y, 'outer loop surrounds the inner loop');
});

test('fonts: HarfBuzz measurement of the pinned Inter matches reference widths', async () => {
  const metrics = await loadFonts();
  // Reference: Chrome getComputedTextLength() of the embedded subset (docs/decisions/0001-fonts.md).
  assert.ok(Math.abs(metrics.measure('Customer', { size: 13 }) - 59.83) < 0.05);
  assert.ok(Math.abs(metrics.measure('placeOrder(): Order', { size: 13 }) - 120.40) < 0.05);
  assert.ok(metrics.measure('Customer', { size: 13, bold: true }) > metrics.measure('Customer', { size: 13 }));
  assert.ok(metrics.measure('注文', { size: 13 }) >= 26, 'CJK falls back to a full-width estimate');
  const css = await fontFaceCss(new Map([['regular', 'abc'], ['bold', 'X']]));
  assert.equal(css.match(/@font-face/g).length, 2);
  assert.match(css, /src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)/);
});

test('wrapping keeps the text literal: lines join back to the input', async () => {
  const metrics = await loadFonts();
  for (const text of ['evaluated against the destination-specific shipping policy', 'Averyveryveryveryverylongwordwithoutanyspaces', '  leading and trailing  ', '注文 注文 注文 注文 注文 注文 注文']) {
    const lines = wrapText(metrics, text, { size: 12 }, 80);
    assert.equal(lines.join(''), text);
    for (const line of lines) assert.ok(metrics.measure(line.trimEnd(), { size: 12 }) <= 80 || [...line.trim()].length === 1);
  }
});

test('SVG writer escapes text and refuses unsafe elements and attributes', async () => {
  assert.throws(() => el('script'), /not allowed/);
  assert.throws(() => el('foreignObject'), /not allowed/);
  assert.throws(() => el('rect', { onload: 'x' }), /not allowed/);
  assert.throws(() => el('rect', { href: 'x' }), /not allowed/);
  assert.equal(el('rect', { 'data-uml-id': '"><script>' }), '<rect data-uml-id="&quot;&gt;&lt;script&gt;"/>');
  const canvas = new Canvas(await loadFonts());
  assert.equal(canvas.text('<b>&</b>', 1, 2, { size: 12, role: 'label' }).match(/>(.*)<\/text>/)[1], '&lt;b&gt;&amp;&lt;/b&gt;');
});

// The gates must catch the defects they exist for.
const node = (id, x, y, w, h) => `<g data-uml-role="node" data-uml-id="${id}" data-uml-type="class" data-uml-bounds="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></g>`;
const doc = body => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" data-uml-renderer="engine" data-uml-kind="class">${body}</svg>`;
const failed = report => report.gates.filter(g => !g.ok).map(g => g.gate);

test('QA gates pass a clean drawing and catch each defect class', async () => {
  const a = node('a', 20, 20, 100, 50), b = node('b', 20, 150, 100, 50);
  const edge = drawEdge({ id: 'e', type: 'generalization', source: 'b', target: 'a', points: [{ x: 70, y: 150 }, { x: 70, y: 70 }], style: 'solid', sourceMarker: 'none', targetMarker: 'hollow-triangle' });
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge))), []);
  assert.deepEqual(failed(await checkSvg(doc(a + node('c', -5, 100, 50, 20)))), ['inside-canvas']);
  assert.deepEqual(failed(await checkSvg(doc(a + node('c', 60, 40, 100, 50)))), ['node-overlap']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge.replace('data-uml-points="70,150 70,70"', 'data-uml-points="70,140 70,70"')))), ['edge-endpoints']);
  const reversed = drawEdge({ id: 'e', type: 'generalization', source: 'b', target: 'a', points: [{ x: 70, y: 150 }, { x: 70, y: 70 }], style: 'solid', sourceMarker: 'none', targetMarker: 'hollow-triangle' }).replace('data-uml-direction="0,-1"', 'data-uml-direction="0,1"');
  assert.deepEqual(failed(await checkSvg(doc(a + b + reversed))), ['markers']);
  const label = (x, y, text = 'label') => `<text x="${x}" y="${y}" font-size="12" data-uml-role="label" data-uml-owner="e">${text}</text>`;
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(30, 40)))), ['label-overlap']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(150, 110) + label(160, 112)))), ['label-overlap']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(50, 110)))), ['label-edge-crossing']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(150, 110)), ['missing text'])), ['literal-text']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<text x="30" y="40" font-size="9" data-uml-role="text" data-uml-owner="a">x</text>'))), ['min-font-size']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<g data-uml-role="node" data-uml-id="t" data-uml-type="class" data-uml-bounds="200 20 40 30"><text x="205" y="40" font-size="13" data-uml-role="text">much too long for its box</text></g>'))), ['text-fits']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<script>alert(1)</script>'))), ['safe-markup']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<rect onclick="x" width="1" height="1"/>'))), ['safe-markup']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<style>@import url(https://evil.invalid/x.css)</style>'))), ['safe-markup']);
  const endLabel = `<text x="200" y="250" font-size="12" data-uml-role="label" data-uml-owner="e" data-uml-end="target" data-uml-anchor="70,70">far</text>`;
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + endLabel))), ['label-proximity']);
});
