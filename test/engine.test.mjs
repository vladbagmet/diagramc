import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../dist/engine/elk.js';
import { loadFonts, fontFaceCss } from '../dist/engine/fonts.js';
import { wordPieces, wrapText } from '../dist/engine/text.js';
import { el, Canvas } from '../dist/engine/svg.js';
import { drawEdge, drawMessageArrow } from '../dist/engine/edges.js';
import { planSelfLoops, selfLoopRoute } from '../dist/engine/selfloops.js';
import { distanceToBorder, contains, overlaps, segmentDistance, distanceToSegment, segmentIntersectsRect } from '../dist/engine/geometry.js';
import { stressCenters } from '../dist/engine/stress.js';
import { checkSvg } from '../dist/qa/index.js';
import { splitFallbackRuns } from '../dist/engine/png.js';
import { routeOrthogonal } from '../dist/engine/router.js';
import { repairRoutes } from '../dist/engine/repair.js';
import { aspectPenalty, chooseLayout, layoutScore, routesDetour } from '../dist/engine/aspect.js';
import { placeLabels } from '../dist/engine/labels.js';

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

test('self-loops: corner loops first, then nested loops on the right side, all inside the reserved room', async () => {
  const loops = [
    { endLabelWidth: 40, endLabelRows: 2, labelHeight: 17 },
    { endLabelWidth: 0, endLabelRows: 0, labelHeight: 17, centerLabel: { width: 30, height: 17 } },
    { endLabelWidth: 20, endLabelRows: 1, labelHeight: 17 },
  ];
  // One or two loops need no extra height: they sit on the corners.
  assert.ok(planSelfLoops(loops.slice(0, 1)).minHeight <= 60, 'one loop keeps a small node small');
  const plan = planSelfLoops(loops);
  const result = await layout(
    [{ id: 'top', width: 100, height: 40 }, { id: 'a', width: 100, height: plan.minHeight, reserveRight: plan.reserveRight, reserveAbove: plan.reserveAbove, reserveBelow: plan.reserveBelow }, { id: 'b', width: 100, height: 40 }, { id: 'c', width: 100, height: 40 }],
    [{ id: 'e1', source: 'top', target: 'a' }, { id: 'e2', source: 'top', target: 'b' }, { id: 'e3', source: 'top', target: 'c' }], options);
  const a = result.nodes.get('a');
  const routes = [0, 1, 2].map(i => selfLoopRoute(a, plan, i));
  const right = a.x + a.width, bottom = a.y + a.height;
  // Top-right corner: out of the top border, back into the right border; bottom-right: the mirror image.
  assert.equal(routes[0][0].y, a.y); assert.ok(routes[0][0].x < right);
  assert.equal(routes[0].at(-1).x, right);
  assert.equal(routes[1][0].x, right);
  assert.equal(routes[1].at(-1).y, bottom); assert.ok(routes[1].at(-1).x < right);
  // The side loop lies between the corner loops' legs, on the right border.
  assert.ok(routes[2][0].x === right && routes[2].at(-1).x === right);
  assert.ok(routes[2][0].y > routes[0].at(-1).y && routes[2].at(-1).y < routes[1][0].y);
  const room = { x: a.x, y: a.y - plan.reserveAbove.height, width: a.width + plan.reserveRight, height: a.height + plan.reserveAbove.height + plan.reserveBelow.height };
  for (const route of routes) for (const point of route) assert.ok(point.x <= right + plan.reserveRight && point.y >= room.y && point.y <= room.y + room.height);
  const reserved = { x: right, y: room.y, width: plan.reserveRight, height: room.height };
  for (const id of ['top', 'b', 'c']) assert.ok(!overlaps(reserved, result.nodes.get(id)), `ELK kept the reserved room free of ${id}`);
});

test('wrapping breaks words at camelCase and punctuation, keeps short words whole, never leaves punctuation alone', async () => {
  const metrics = await loadFonts();
  const style = { size: 14, bold: true };
  const breaksBetweenLetters = lines => lines.slice(1).some((line, i) => /[a-z]$/.test(lines[i]) && /^[a-z]/.test(line));
  // A camelCase identifier breaks at its humps, never inside "Relationship".
  const camel = wrapText(metrics, 'AbstractEnterpriseCustomerRelationshipManagementServiceFacadeImplementation', style, 260);
  assert.equal(camel.join(''), 'AbstractEnterpriseCustomerRelationshipManagementServiceFacadeImplementation');
  assert.ok(camel.length > 1 && !breaksBetweenLetters(camel), camel.join(' | '));
  for (const line of camel) assert.match(line, /^[A-Z]/);
  // Dotted names break after the dots.
  const dotted = wrapText(metrics, 'org.example.enterprise.customerrelationshipmanagement.internal', style, 260);
  assert.ok(dotted.slice(0, -1).every(line => line.endsWith('.')), dotted.join(' | '));
  // A single word up to maxTokenWidth stays whole (the box grows instead).
  assert.deepEqual(wrapText(metrics, 'VeryLongComponentTypeNameForLevel1', style, 200), ['VeryLongComponentTypeNameForLevel1']);
  // "name : Classifier" never leaves the colon alone on a line.
  const title = wrapText(metrics, 'primaryReplicationCoordinatorInstance : DistributedConsensusReplicationCoordinator', style, 260);
  assert.ok(title.every(line => !/^[\s:]+$/.test(line)), title.join(' | '));
  assert.equal(title.join(''), 'primaryReplicationCoordinatorInstance : DistributedConsensusReplicationCoordinator');
  assert.deepEqual(wordPieces('HTTPServer_config-v2/path(x)'), ['HTTP', 'Server_', 'config-', 'v2/', 'path', '(x)']);
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
    const lines = wrapText(metrics, text, { size: 12 }, 80, { maxTokenWidth: 80 });
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
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(30, 64)))), ['label-overlap']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(76, 110) + label(86, 112)))), ['label-overlap']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(50, 110)))), ['label-edge-crossing']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(76, 110)), ['missing text'])), ['literal-text']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + label(150, 110)))), ['label-proximity'], 'a center label far from its line');
  assert.deepEqual(failed(await checkSvg(doc(a + '<text x="30" y="40" font-size="9" data-uml-role="text" data-uml-owner="a">x</text>'))), ['min-font-size']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<g data-uml-role="node" data-uml-id="t" data-uml-type="class" data-uml-bounds="200 20 40 30"><text x="205" y="40" font-size="13" data-uml-role="text">much too long for its box</text></g>'))), ['text-fits']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<script>alert(1)</script>'))), ['safe-markup']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<rect onclick="x" width="1" height="1"/>'))), ['safe-markup']);
  assert.deepEqual(failed(await checkSvg(doc(a + '<style>@import url(https://evil.invalid/x.css)</style>'))), ['safe-markup']);
  const endLabel = `<text x="200" y="250" font-size="12" data-uml-role="label" data-uml-owner="e" data-uml-end="target" data-uml-anchor="70,70">far</text>`;
  assert.deepEqual(failed(await checkSvg(doc(a + b + edge + endLabel))), ['label-proximity']);
});

test('elkjs: FIXED_POS ports pin flows to given points (diamond vertices)', async () => {
  const diamond = { id: 'd', width: 32, height: 32, ports: [
    { id: 'd:N', side: 'NORTH', position: { x: 16, y: 0 } }, { id: 'd:S', side: 'SOUTH', position: { x: 16, y: 32 } },
    { id: 'd:E', side: 'EAST', position: { x: 32, y: 16 } }, { id: 'd:W', side: 'WEST', position: { x: 0, y: 16 } }] };
  const result = await layout([{ id: 'top', width: 80, height: 30 }, diamond, { id: 'l', width: 80, height: 30 }, { id: 'r', width: 80, height: 30 }],
    [{ id: 'in', source: 'top', target: 'd:N' }, { id: 'left', source: 'd:W', target: 'l' }, { id: 'right', source: 'd:E', target: 'r' }], options);
  const d = result.nodes.get('d');
  assert.deepEqual(result.edges.get('in').points.at(-1), { x: d.x + 16, y: d.y });
  assert.deepEqual(result.edges.get('left').points[0], { x: d.x, y: d.y + 16 });
  assert.deepEqual(result.edges.get('right').points[0], { x: d.x + 32, y: d.y + 16 });
});

test('stress placement: deterministic, linked nodes about the desired distance apart', async () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, width: 100, height: 40 }));
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }, { source: 'c', target: 'd' }];
  const first = await stressCenters(nodes, edges, { edgeLength: 200 });
  assert.deepEqual(await stressCenters(nodes, edges, { edgeLength: 200 }), first);
  for (const { source, target } of edges) {
    const p = first.get(source), q = first.get(target);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    assert.ok(d > 120 && d < 300, `${source}-${target} ${d}`);
  }
});

test('labels: an end label on a slanted line is a full-size box beside the line, near its end', () => {
  const route = [{ x: 0, y: 200 }, { x: 300, y: 80 }];
  const placed = placeLabels([{ id: 'm', width: 26, height: 15, route, at: 'target', side: 1, clearance: 4 }], { rects: [], segments: [[route[0], route[1]]] });
  const r = placed.get('m');
  assert.deepEqual([r.width, r.height], [26, 15]);
  assert.ok(!segmentIntersectsRect(route[0], route[1], r), 'clear of the line');
  assert.ok(Math.hypot(Math.max(r.x - 300, 0, 300 - r.x - r.width), Math.max(r.y - 80, 0, 80 - r.y - r.height)) < 20, 'next to the end');
});

test('geometry: segment distances', () => {
  assert.equal(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), 0, 'crossing');
  assert.equal(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }), 5, 'parallel');
  assert.equal(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 10, 'beyond the end');
});

test('QA gate message-arrows: accepts a well-placed arrow and catches each defect', async () => {
  const a = node('a', 20, 20, 100, 50), c = node('c', 250, 20, 100, 50);
  const link = drawEdge({ id: 'l', type: 'link', source: 'a', target: 'c', points: [{ x: 120, y: 45 }, { x: 250, y: 45 }], style: 'solid', sourceMarker: 'none', targetMarker: 'none' });
  const arrow = (from, to, extra = {}) => drawMessageArrow({ owner: 'l', group: 'g', source: 'a', target: 'c', from, to, style: 'solid', marker: 'filled-triangle', ...extra });
  const label = (x, y) => `<text x="${x}" y="${y}" font-size="12" data-uml-role="label" data-uml-owner="l" data-uml-group="g">1: m()</text>`;
  const ok = arrow({ x: 167, y: 30 }, { x: 203, y: 30 });
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + ok + label(167, 18)))), []);
  // Points against the message direction (a -> c is left to right here).
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + arrow({ x: 203, y: 30 }, { x: 167, y: 30 }) + label(167, 18)))), ['message-arrows']);
  // Too far from its link.
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + arrow({ x: 167, y: 140 }, { x: 203, y: 140 }) + label(167, 128)))), ['message-arrows']);
  // Not parallel to its link.
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + arrow({ x: 167, y: 10 }, { x: 203, y: 30 }) + label(140, 16)))), ['message-arrows']);
  // On top of its link.
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + arrow({ x: 167, y: 45 }, { x: 203, y: 45 }) + label(167, 25)))), ['message-arrows']);
  // Labels far from their arrow.
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + ok + label(167, 120)))), ['message-arrows']);
  // Owned by a link that does not connect sender and receiver.
  assert.deepEqual(failed(await checkSvg(doc(a + c + link + arrow({ x: 167, y: 30 }, { x: 203, y: 30 }, { target: 'a' }) + label(167, 18)))), ['message-arrows']);
});

test('message arrows use the smaller message triangle and declare its size for the gates', async () => {
  const svg = drawMessageArrow({ owner: 'l', group: 'g', source: 'a', target: 'c', from: { x: 0, y: 0 }, to: { x: 40, y: 0 }, style: 'solid', marker: 'filled-triangle' });
  assert.match(svg, /data-uml-size="10,4.5"/);
  // The triangle's base is 10 px behind the tip and 9 px wide.
  assert.match(svg, /points="40,0 30,4.5 30,-4.5"/);
  // Relationship edges keep the full-size triangle unless told otherwise.
  const edge = drawEdge({ id: 'e', type: 't', source: 'a', target: 'b', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }], style: 'solid', sourceMarker: 'none', targetMarker: 'filled-triangle' });
  assert.doesNotMatch(edge, /data-uml-size/);
});

// Additions for state machine and use case diagrams (chunk 5).
test('elkjs adapter: compound minimum size, fixed-size nodes, captions below and polyline routing', async () => {
  // A compound node is at least as wide as its own header (elkjs swaps the axes for vertical layouts).
  const compound = await layout(
    [{ id: 'a', width: 80, height: 40 }, { id: 'c', width: 300, height: 60, minimumSize: true, padding: { top: 60, left: 12, bottom: 12, right: 12 }, children: [{ id: 'x', width: 60, height: 40 }, { id: 'y', width: 60, height: 40 }] }],
    [{ id: 'e1', source: 'a', target: 'y' }, { id: 'e2', source: 'x', target: 'y' }], options);
  assert.ok(compound.nodes.get('c').width >= 300);
  // Fixed-size symbols keep their size although ports would grow them.
  const fixed = await layout([{ id: 'p', width: 12, height: 12, fixedSize: true, ports: [{ id: 'p:n', side: 'NORTH' }, { id: 'p:w', side: 'WEST' }, { id: 'p:e', side: 'EAST' }] }, { id: 'q', width: 60, height: 30 }, { id: 'r', width: 60, height: 30 }],
    [{ id: 'e1', source: 'p:w', target: 'q' }, { id: 'e2', source: 'p:e', target: 'r' }], options);
  assert.deepEqual([fixed.nodes.get('p').width, fixed.nodes.get('p').height], [12, 12]);
  const p = fixed.nodes.get('p'), west = fixed.ports.get('p:w');
  assert.ok(Math.abs(west.y - (p.y + 6)) < 0.01 && Math.abs(west.x - p.x) < 0.01, 'single port centered on its side');
  // A caption below keeps neighbours away; polyline routing gives slanted segments.
  const captioned = await layout([{ id: 'actor', width: 30, height: 50, labelBelow: { width: 140, height: 20 } }, { id: 'u1', width: 100, height: 40 }, { id: 'u2', width: 100, height: 40 }],
    [{ id: 'e1', source: 'actor', target: 'u1' }, { id: 'e2', source: 'actor', target: 'u2' }], { direction: 'RIGHT', routing: 'polyline' });
  const actor = captioned.nodes.get('actor');
  const caption = { x: actor.x + 15 - 70, y: actor.y + 50, width: 140, height: 20 };
  for (const id of ['u1', 'u2']) assert.ok(!overlaps(caption, captioned.nodes.get(id)), `caption clear of ${id}`);
  assert.ok([...captioned.edges.values()].some(e => e.points.slice(1).some((q, k) => q.x !== e.points[k].x && q.y !== e.points[k].y)), 'a slanted segment');
});

test('clip: route ends move onto ellipse and diamond outlines', async () => {
  const { clipRoute, distanceToOutline } = await import('../dist/engine/clip.js');
  const box = { x: 0, y: 0, width: 100, height: 40 };
  for (const shape of ['ellipse', 'diamond']) {
    for (const route of [[{ x: 50, y: -30 }, { x: 50, y: 0 }], [{ x: -40, y: 30 }, { x: 0, y: 30 }], [{ x: 200, y: -100 }, { x: 100, y: 10 }]]) {
      const end = clipRoute(route, 'target', box, shape).at(-1);
      assert.ok(distanceToOutline(end, box, shape) < 0.01, `${shape} ${JSON.stringify(route)} -> ${JSON.stringify(end)}`);
      const start = clipRoute([...route].reverse(), 'source', box, shape)[0];
      assert.ok(distanceToOutline(start, box, shape) < 0.01);
    }
  }
  assert.deepEqual(clipRoute([{ x: 50, y: -30 }, { x: 50, y: 0 }], 'target', box, 'rect'), [{ x: 50, y: -30 }, { x: 50, y: 0 }]);
});

test('QA gates: shaped outlines, border nodes, edges ending on edges, labels inside containers, lines over texts', async () => {
  const shaped = (id, x, y, w, h, shape) => `<g data-uml-role="node" data-uml-id="${id}" data-uml-type="x" data-uml-shape="${shape}" data-uml-bounds="${x} ${y} ${w} ${h}"><ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/></g>`;
  const line = (id, s, t, pts) => `<g data-uml-role="edge" data-uml-id="${id}" data-uml-type="t" data-uml-source="${s}" data-uml-target="${t}" data-uml-source-marker="none" data-uml-target-marker="none" data-uml-points="${pts}"><path d="M0,0"/></g>`;
  const u = shaped('u', 200, 100, 100, 40, 'ellipse');
  const a = node('a', 20, 100, 60, 40);
  // On the ellipse: passes; on the bounding box only: fails.
  assert.deepEqual(failed(await checkSvg(doc(a + u + line('e', 'a', 'u', '80,120 200,120')))), []);
  assert.deepEqual(failed(await checkSvg(doc(a + u + line('e', 'a', 'u', '80,101 205,101')))), ['edge-endpoints']);
  // A note anchor may end on another edge, but must lie on it.
  assert.deepEqual(failed(await checkSvg(doc(a + u + line('e', 'a', 'u', '80,120 200,120') + node('n', 100, 20, 60, 30) + line('n1', 'n', 'e', '130,50 130,120')))), []);
  assert.deepEqual(failed(await checkSvg(doc(a + u + line('e', 'a', 'u', '80,120 200,120') + node('n', 100, 20, 60, 30) + line('n1', 'n', 'e', '130,50 130,110')))), ['edge-endpoints']);
  // A node on its parent's border (entry/exit point) may overlap it; an unrelated node may not.
  const parent = node('p', 20, 160, 200, 100).replace('data-uml-type="class"', 'data-uml-type="composite-state"');
  const point = '<g data-uml-role="node" data-uml-id="pt" data-uml-type="entryPoint" data-uml-parent="p" data-uml-shape="ellipse" data-uml-border-of="p" data-uml-bounds="13 193 14 14"><circle cx="20" cy="200" r="7"/></g>';
  assert.deepEqual(failed(await checkSvg(doc(parent + point))), []);
  assert.deepEqual(failed(await checkSvg(doc(parent + point.replace(' data-uml-parent="p"', '').replace(' data-uml-border-of="p"', '')))), ['node-overlap']);
  // Labels may sit inside a container (a node with children), not on its texts.
  const child = '<g data-uml-role="node" data-uml-id="k" data-uml-type="x" data-uml-parent="p" data-uml-bounds="150 220 40 20"><rect x="150" y="220" width="40" height="20"/></g>';
  const title = '<text x="30" y="175" font-size="13" data-uml-role="text" data-uml-owner="p">Container</text>';
  const inner = '<text x="60" y="240" font-size="12" data-uml-role="label" data-uml-owner="k">inside</text>';
  const onTitle = '<text x="40" y="176" font-size="12" data-uml-role="label" data-uml-owner="k">on title</text>';
  const wrap = (body, t) => body.replace('</g>', `${t}</g>`);
  assert.deepEqual(failed(await checkSvg(doc(wrap(parent, title) + child + inner))), []);
  assert.deepEqual(failed(await checkSvg(doc(wrap(parent, title) + child + onTitle))), ['label-overlap']);
  // A line into a container must not run over the container's texts.
  const outside = node('o', 300, 20, 60, 30);
  assert.deepEqual(failed(await checkSvg(doc(wrap(parent, title) + child + outside + line('x', 'o', 'k', '330,50 330,150 60,150 60,230 150,230')))), ['edge-endpoints']);
});

test('geometry: small jogs in orthogonal routes are straightened, ends stay on their borders', async () => {
  const { straightenJogs } = await import('../dist/engine/geometry.js');
  const source = { x: 100, y: 0, width: 100, height: 40 }, target = { x: 90, y: 200, width: 100, height: 40 };
  const route = [{ x: 155, y: 40 }, { x: 155, y: 80 }, { x: 158, y: 80 }, { x: 158, y: 150 }, { x: 152, y: 150 }, { x: 152, y: 200 }];
  const straight = straightenJogs(route, { source, target });
  assert.equal(straight.length, 2);
  assert.equal(straight[0].x, straight[1].x);
  assert.deepEqual([straight[0].y, straight[1].y], [40, 200]);
  // An end that would leave its node's side is not moved; the other side moves instead.
  const narrow = { x: 150, y: 200, width: 12, height: 40 };
  const kept = straightenJogs([{ x: 120, y: 40 }, { x: 120, y: 100 }, { x: 125, y: 100 }, { x: 125, y: 200 }], { source, target: narrow }, 8, 0);
  assert.deepEqual(kept.at(-1), { x: 125, y: 200 });
  assert.equal(kept.length, 2);
});

test('PNG text: lines mixing Inter and fallback glyphs are split into runs so the Latin part keeps Inter and bold', async () => {
  const metrics = await loadFonts();
  const svg = '<svg data-uml-renderer="engine"><text x="10" y="20" font-size="14" font-weight="700" data-uml-role="text">Kundin · Zoë 注文 &amp; x</text><text x="5" y="9" font-size="12">plain</text></svg>';
  const texts = [...splitFallbackRuns(svg, metrics).matchAll(/<text([^>]*)>([^<]*)<\/text>/g)];
  assert.deepEqual(texts.map(t => t[2]), ['Kundin · Zoë ', '注文', ' &amp; x', 'plain']);
  for (const t of texts.slice(0, 3)) assert.match(t[1], /font-weight="700"/);
  const xs = texts.slice(0, 3).map(t => Number(t[1].match(/ x="([^"]*)"/)[1]));
  assert.equal(xs[0], 10);
  assert.ok(Math.abs(xs[1] - (10 + metrics.measure('Kundin · Zoë ', { size: 14, bold: true }))) < 0.01);
});

test('notes: a last row of one word is avoided by wrapping narrower with the same number of rows', async () => {
  const { measureNote } = await import('../dist/engine/shapes.js');
  const metrics = await loadFonts();
  const { rows } = measureNote(metrics, 'Two app servers in production; one shown.');
  assert.ok(rows.length >= 2 && /\s/.test(rows.at(-1).trim()), `rows: ${JSON.stringify(rows)}`);
});

test('repairRoutes (junctions): a line crossing another right next to its end is rerouted', () => {
  const nodes = [
    { id: 'a', rect: { x: 0, y: 60, width: 60, height: 40 } }, { id: 'c', rect: { x: 300, y: 60, width: 60, height: 40 } },
    { id: 'g', rect: { x: 100, y: 200, width: 60, height: 40 } }, { id: 'h', rect: { x: 250, y: -100, width: 60, height: 40 } },
  ];
  const edges = [
    { id: 'l1', source: 'a', target: 'c', route: [{ x: 60, y: 80 }, { x: 300, y: 80 }], sourceMarker: 'none', targetMarker: 'none' },
    { id: 'l2', source: 'g', target: 'h', route: [{ x: 130, y: 200 }, { x: 130, y: 150 }, { x: 290, y: 150 }, { x: 290, y: -60 }], sourceMarker: 'none', targetMarker: 'none' },
  ];
  const near = routes => {
    const l1 = routes.get('l1'), l2 = routes.get('l2');
    return l2.slice(1).some((q, k) => {
      const p = l2[k];
      if (p.x !== q.x) return false;
      const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
      return y0 < 80 && y1 > 80 && [l1[0], l1.at(-1), l2[0], l2.at(-1)].some(e => Math.hypot(e.x - p.x, e.y - 80) < 30);
    });
  };
  assert.ok(near(repairRoutes(nodes, edges, { shorten: false }).routes), 'without the option the crossing stays');
  const { routes, changed } = repairRoutes(nodes, edges, { shorten: false, junctions: true });
  assert.ok(changed.has('l2') && !near(routes), JSON.stringify(routes.get('l2')));
});

test('router: an orthogonal route around an obstacle, leaving and entering perpendicular with straight stubs', () => {
  const source = { x: 0, y: 0, width: 80, height: 40 }, target = { x: 0, y: 200, width: 80, height: 40 }, wall = { x: -40, y: 90, width: 160, height: 30 };
  const route = routeOrthogonal({ source: { rect: source, stub: 20 }, target: { rect: target, stub: 20 }, obstacles: [wall], lines: [], area: { x: -100, y: -50, width: 300, height: 350 } });
  assert.ok(route && route.length >= 2);
  assert.ok(distanceToBorder(route[0], source) < 0.01 && distanceToBorder(route.at(-1), target) < 0.01);
  for (let k = 1; k < route.length; k++) {
    const a = route[k - 1], b = route[k];
    assert.ok(a.x === b.x || a.y === b.y, 'orthogonal');
    assert.ok(!segmentIntersectsRect(a, b, wall), 'clear of the obstacle');
  }
  assert.ok(Math.hypot(route[1].x - route[0].x, route[1].y - route[0].y) >= 20 && Math.hypot(route.at(-1).x - route.at(-2).x, route.at(-1).y - route.at(-2).y) >= 20, 'straight stubs at both ends');
});

test('repairRoutes: a line over a container name and a detour are rerouted; good routes stay', () => {
  const nodes = [
    { id: 'pkg', rect: { x: 0, y: 20, width: 300, height: 200 }, container: true, texts: [{ x: 0, y: 0, width: 120, height: 20 }] },
    { id: 'in', parent: 'pkg', rect: { x: 40, y: 120, width: 80, height: 40 } },
    { id: 'top', rect: { x: 40, y: -120, width: 80, height: 40 } },
    { id: 'right', rect: { x: 420, y: 120, width: 80, height: 40 } },
  ];
  const edges = [
    // Straight down through the package tab text into the nested node.
    { id: 'tab', source: 'top', target: 'in', route: [{ x: 80, y: -80 }, { x: 80, y: 120 }], sourceMarker: 'none', targetMarker: 'open-arrow' },
    // Leaves the wrong way and loops around everything.
    { id: 'loop', source: 'in', target: 'right', route: [{ x: 80, y: 160 }, { x: 80, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 140 }, { x: 500, y: 140 }], sourceMarker: 'none', targetMarker: 'open-arrow' },
    // Fine as it is.
    { id: 'ok', source: 'top', target: 'right', route: [{ x: 120, y: -100 }, { x: 460, y: -100 }, { x: 460, y: 120 }], sourceMarker: 'none', targetMarker: 'open-arrow' },
  ];
  const { routes, changed } = repairRoutes(nodes, edges);
  assert.deepEqual([...changed].sort(), ['loop', 'tab']);
  for (let k = 1; k < routes.get('tab').length; k++) assert.ok(!segmentIntersectsRect(routes.get('tab')[k - 1], routes.get('tab')[k], { x: 1, y: 1, width: 118, height: 18 }), 'clear of the tab');
  const length = r => r.slice(1).reduce((s, p, k) => s + Math.hypot(p.x - r[k].x, p.y - r[k].y), 0);
  assert.ok(length(routes.get('loop')) < 500, `short route, got ${length(routes.get('loop'))}`);
  assert.deepEqual(routes.get('ok'), edges[2].route);
});

test('layout chooser: scores prefer a readable page and the conventional direction', async () => {
  assert.equal(aspectPenalty(1600, 1000), 0);
  assert.ok(aspectPenalty(800, 2400) > aspectPenalty(1200, 1600));
  assert.ok(layoutScore({ width: 1200, height: 900 }) < layoutScore({ width: 600, height: 1800 }));
  assert.ok(layoutScore({ width: 1200, height: 900, crossings: 10 }) > layoutScore({ width: 1200, height: 900 }));
  const runs = [];
  const chosen = await chooseLayout(['DOWN', 'RIGHT'], async (dir, variant) => { runs.push(`${dir}:${variant}`); return dir === 'DOWN' ? { width: 400, height: 2400 } : { width: 1500, height: 1000 }; }, r => r);
  assert.deepEqual(chosen, { width: 1500, height: 1000 }, 'a tall chain loses against a landscape alternative');
  assert.ok(runs.includes('DOWN:plain') && runs.includes('RIGHT:plain'));
  const narrow = await chooseLayout(['DOWN'], async (dir, variant) => variant === 'narrow' ? { width: 1600, height: 1100 } : { width: 5000, height: 600 }, r => r);
  assert.deepEqual(narrow, { width: 1600, height: 1100 }, 'a too wide layered layout tries narrow layering');
  const kept = await chooseLayout(['DOWN', 'RIGHT'], async dir => dir === 'DOWN' ? { width: 1000, height: 800 } : { width: 1010, height: 760 }, r => r, { penalty: i => i ? 0.3 : 0 });
  assert.deepEqual(kept, { width: 1000, height: 800 }, 'the convention wins when the alternative is not clearly better');
});

test('chooseLayout: with maxAspect a layout within the limit wins over a smaller panorama; wrapping only when needed', async () => {
  const runs = [];
  const pick = await chooseLayout(['RIGHT', 'DOWN'], async (dir, variant) => {
    runs.push(`${dir}:${variant}`);
    if (dir === 'RIGHT') return variant === 'wrap' ? { width: 2600, height: 900 } : { width: 4400, height: 1000 };
    return { width: 1400, height: 2600 };
  }, r => r, { wrap: true, maxAspect: 2.5 });
  assert.deepEqual(pick, { width: 1400, height: 2600 }, 'the 1:1.9 layout, not the 4.4:1 one');
  assert.ok(!runs.includes('DOWN:wrap'), 'a plain layout within the limit is not wrapped');
  const without = await chooseLayout(['RIGHT', 'DOWN'], async dir => dir === 'RIGHT' ? { width: 3000, height: 700 } : { width: 1400, height: 2600 }, r => r);
  assert.deepEqual(without, { width: 3000, height: 700 }, 'without maxAspect the score alone decides');
});

test('elkjs: a top to bottom compound node with wide ports on its top border is not made as tall as they are wide', async () => {
  const result = await layout([
    { id: 'box', width: 120, height: 60, minimumSize: true, padding: { top: 40, left: 20, bottom: 20, right: 20 }, ports: [{ id: 'p', side: 'NORTH', width: 600 }], children: [{ id: 'kid', width: 50, height: 20 }] },
    { id: 'up', width: 40, height: 20 },
  ], [{ id: 'e', source: 'up', target: 'p' }], { direction: 'DOWN' });
  const box = result.nodes.get('box');
  assert.ok(box.width >= 600, `wide enough for its port (${box.width})`);
  assert.ok(box.height < 200, `not as tall as the port is wide (${box.height})`);
});

test('QA gates for the review findings: crowded ends, detours, bent arrowheads, container texts, broken words', async () => {
  const a = node('a', 20, 20, 100, 50), b = node('b', 20, 200, 100, 50);
  const dep = (id, points) => drawEdge({ id, type: 'dependency', source: 'b', target: 'a', points, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' });
  // Two lines 8 px apart into one side (A-09); 14 px is the line spacing.
  const link = (id, x) => drawEdge({ id, type: 'association', source: 'b', target: 'a', points: [{ x, y: 200 }, { x, y: 70 }], style: 'solid', sourceMarker: 'none', targetMarker: 'none' });
  assert.deepEqual(failed(await checkSvg(doc(a + b + link('e1', 60) + link('e2', 68)))), ['end-spacing']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + link('e1', 60) + link('e2', 74)))), []);
  // A detour around the drawing for a 130 px gap (A-03).
  assert.deepEqual(failed(await checkSvg(doc(a + b + dep('e1', [{ x: 60, y: 250 }, { x: 60, y: 290 }, { x: 390, y: 290 }, { x: 390, y: 5 }, { x: 60, y: 5 }, { x: 60, y: 20 }])))), ['route-length']);
  // An arrowhead on a 6 px end segment after a bend (C-04).
  assert.deepEqual(failed(await checkSvg(doc(a + b + dep('e1', [{ x: 60, y: 200 }, { x: 60, y: 120 }, { x: 90, y: 120 }, { x: 90, y: 76 }, { x: 96, y: 76 }, { x: 96, y: 70 }])))), ['markers']);
  // A line through a container's name (A-01): p contains c, the line from b runs over the tab text.
  const pkg = '<g data-uml-role="node" data-uml-id="p" data-uml-type="package" data-uml-bounds="200 20 180 150" data-uml-tab="200 20 80 20"><text x="205" y="35" font-size="13" data-uml-role="text">pkgname</text></g>';
  const inner = '<g data-uml-role="node" data-uml-id="c" data-uml-type="class" data-uml-parent="p" data-uml-bounds="220 100 80 40"></g>';
  const through = drawEdge({ id: 't', type: 'dependency', source: 'b', target: 'c', points: [{ x: 120, y: 225 }, { x: 230, y: 225 }, { x: 230, y: 5 }, { x: 260, y: 5 }, { x: 260, y: 100 }], style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' });
  assert.ok(failed(await checkSvg(doc(a + b + pkg + inner + through))).includes('edge-endpoints'));
  // A name broken between letters although it has a camelCase break (A-02).
  const broken = '<g data-uml-role="node" data-uml-id="w" data-uml-type="class" data-uml-bounds="200 200 190 60"><text font-size="13" data-uml-role="text"><tspan x="205" y="220">OrderLineIt</tspan><tspan x="205" y="238">emFactory</tspan></text></g>';
  assert.deepEqual(failed(await checkSvg(doc(broken))), ['text-fits']);
  const fine = broken.replace('OrderLineIt', 'OrderLine').replace('>emFactory', '>ItemFactory');
  assert.deepEqual(failed(await checkSvg(doc(fine))), []);
});

test('QA gates for the final review: shared lines, junctions, border hugging, container headers, wrap-arounds, ambiguous labels', async () => {
  const a = node('a', 20, 20, 100, 50), b = node('b', 20, 200, 100, 50), c = node('c', 250, 200, 100, 50);
  const line = (id, points, source = 'b', target = 'a', type = 'dependency', marker = 'open-arrow') => drawEdge({ id, type, source, target, points, style: 'dashed', sourceMarker: 'none', targetMarker: marker });
  // Two dependencies sharing 50 px of line (F-B-08), and the same lines apart.
  const e1 = line('e1', [{ x: 50, y: 200 }, { x: 50, y: 150 }, { x: 80, y: 150 }, { x: 80, y: 70 }]);
  const shared = line('e2', [{ x: 300, y: 200 }, { x: 300, y: 120 }, { x: 80, y: 120 }, { x: 80, y: 70 }], 'c');
  assert.deepEqual(failed(await checkSvg(doc(a + b + c + e1 + shared))), ['shared-segments']);
  const apart = line('e2', [{ x: 300, y: 200 }, { x: 300, y: 120 }, { x: 100, y: 120 }, { x: 100, y: 70 }], 'c');
  assert.deepEqual(failed(await checkSvg(doc(a + b + c + e1 + apart))), []);
  // A generalization tree shares its trunk on purpose.
  const gen = (id, points, source) => drawEdge({ id, type: 'generalization', source, target: 'a', points, style: 'solid', sourceMarker: 'none', targetMarker: 'hollow-triangle' });
  assert.deepEqual(failed(await checkSvg(doc(a + b + c + gen('g1', [{ x: 70, y: 200 }, { x: 70, y: 70 }], 'b') + gen('g2', [{ x: 300, y: 200 }, { x: 300, y: 130 }, { x: 70, y: 130 }, { x: 70, y: 70 }], 'c')))), []);
  // A bend lying on another line reads as a junction.
  const straight = line('e1', [{ x: 50, y: 200 }, { x: 50, y: 70 }]);
  const tee = line('e2', [{ x: 300, y: 200 }, { x: 300, y: 150 }, { x: 50, y: 150 }, { x: 50, y: 110 }, { x: 90, y: 110 }, { x: 90, y: 70 }], 'c');
  assert.ok(failed(await checkSvg(doc(a + b + c + straight + tee))).includes('shared-segments'));
  // A line 2 px outside the border of a node it does not connect (F-A-06), and 10 px away.
  const n = node('n', 150, 100, 80, 60);
  const hug = y => line('e1', [{ x: 300, y: 200 }, { x: 300, y }, { x: 100, y }, { x: 100, y: 70 }], 'c');
  assert.deepEqual(failed(await checkSvg(doc(a + c + n + hug(98)))), ['edge-endpoints']);
  assert.deepEqual(failed(await checkSvg(doc(a + c + n + hug(90)))), []);
  // A line into a component through the band of its name (F-A-13).
  const comp = '<g data-uml-role="node" data-uml-id="k" data-uml-type="component" data-uml-bounds="150 20 200 150"><text x="200" y="40" font-size="13" data-uml-role="text">Backend</text></g>';
  const part = '<g data-uml-role="node" data-uml-id="p" data-uml-type="component" data-uml-parent="k" data-uml-bounds="170 100 80 40"></g>';
  const into = y => line('t', [{ x: 120, y }, { x: 210, y }, { x: 210, y: 100 }], 'a', 'p');
  assert.ok(failed(await checkSvg(doc(a + comp + part + into(40)))).includes('edge-endpoints'));
  assert.deepEqual(failed(await checkSvg(doc(a + comp + part + into(65)))), []);
  // A line that wraps round its target to enter from the far side (F-A-01).
  const wrap = line('e1', [{ x: 300, y: 250 }, { x: 300, y: 280 }, { x: 5, y: 280 }, { x: 5, y: 5 }, { x: 70, y: 5 }, { x: 70, y: 20 }], 'c');
  assert.deepEqual(failed(await checkSvg(doc(a + c + wrap))), ['route-length']);
  // A label between two lines, nearer its own but not twice as near (F-A-05).
  const left = line('e1', [{ x: 50, y: 200 }, { x: 50, y: 70 }]), right = line('e2', [{ x: 90, y: 200 }, { x: 90, y: 70 }]);
  const lbl = x => `<text x="${x}" y="140" font-size="12" data-uml-role="label" data-uml-owner="e1">ab</text>`;
  assert.deepEqual(failed(await checkSvg(doc(a + b + left + right + lbl(62)))), ['label-proximity']);
  assert.deepEqual(failed(await checkSvg(doc(a + b + left + right + lbl(30)))), []);
});

test('layout warnings carry advice for the kind of problem, not one sentence per gate', async () => {
  const { adviceFor } = await import('../dist/qa/advice.js');
  assert.match(adviceFor('markers', 'open-arrow at (1, 2) overlaps hollow-triangle at (3, 4)'), /Arrowheads touch/);
  assert.match(adviceFor('markers', 'edge e: open-arrow at its target end points the wrong way'), /renderer defect/);
  assert.match(adviceFor('markers', 'edge e: open-arrow at its target end sits on a 1.0px segment (needs 20px straight)'), /renderer defect/);
  assert.match(adviceFor('label-proximity', 'label "x" of e is 9.0px from f but 6.0px from its own line (another line must be at least 2x as far)'), /between two lines/);
  assert.match(adviceFor('route-length', 'edge e wraps around: it turns the same way three times'), /long way round/);
});

test('layout scoring: a candidate whose lines detour around the drawing loses against a direct one', () => {
  const direct = [[{ x: 0, y: 0 }, { x: 0, y: 200 }]];
  const around = [[{ x: 0, y: 0 }, { x: 0, y: -40 }, { x: 600, y: -40 }, { x: 600, y: 260 }, { x: 0, y: 260 }, { x: 0, y: 200 }]];
  assert.equal(routesDetour(direct), 0);
  assert.ok(routesDetour(around) > 1000);
  assert.ok(layoutScore({ width: 800, height: 900, detour: routesDetour(around) }) > layoutScore({ width: 600, height: 1400, detour: routesDetour(direct) }));
});

test('repairRoutes (lines): extra lines such as region separators are not followed', () => {
  const nodes = [{ id: 'a', rect: { x: 0, y: 0, width: 60, height: 40 } }, { id: 'b', rect: { x: 300, y: 0, width: 60, height: 40 } }];
  const edges = [{ id: 'e', source: 'a', target: 'b', route: [{ x: 60, y: 20 }, { x: 300, y: 20 }], sourceMarker: 'none', targetMarker: 'open-arrow' }];
  const separator = [{ x: 60, y: 20 }, { x: 300, y: 20 }];
  assert.deepEqual(repairRoutes(nodes, edges, { force: new Set(['e']) }).routes.get('e'), separator, 'without the option the straight line stays');
  const route = repairRoutes(nodes, edges, { force: new Set(['e']), lines: [separator] }).routes.get('e');
  assert.ok(route.slice(1).every((q, k) => !(Math.abs(q.y - 20) < 1 && Math.abs(route[k].y - 20) < 1)), JSON.stringify(route));
});
