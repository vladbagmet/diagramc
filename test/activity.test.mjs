import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { structure } from '../dist/kinds/activity/structure.js';
import { activityToPlantUml } from '../dist/kinds/activity/to-plantuml.js';
import { fixActivitySvg } from '../dist/kinds/activity/postprocess.js';
import { loadFonts } from '../dist/engine/fonts.js';
import { ENGINE_ONLY_GATES, inspectSvg, runGates } from '../dist/qa/index.js';
import { cli, fakeJava, root, workspace } from './helpers.mjs';
import { existsSync, readFileSync } from 'node:fs';

// Java-free tests of the activity kind: validation, structuring, PlantUML source
// generation and the SVG post-processor. Real renders: test/integration/activity.test.mjs.
const fixtures = name => readFile(join(root, 'test/fixtures/activity', name), 'utf8').then(JSON.parse);
const model = doc => parseDocument(JSON.stringify(doc)).model;
const kinds = steps => steps.map(s => s.kind === 'node' ? s.node.type : s.kind);

test('activity: negative fixtures fail with the exact code and JSON path', async () => {
  const cases = await fixtures('invalid.json');
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    assert.throws(() => parseDocument(JSON.stringify(c.doc)), error => {
      assert.equal(error.code, c.expect.code, `${c.name}: ${error.message}`);
      assert.equal(error.path, c.expect.path, `${c.name}: ${error.message}`);
      return true;
    }, c.name);
  }
});

test('activity: positive fixtures and examples validate', async () => {
  for (const c of await fixtures('valid.json')) parseDocument(JSON.stringify(c.doc));
  for (const f of (await readdir(join(root, 'examples/activity'))).filter(f => f.endsWith('.json'))) {
    parseDocument(await readFile(join(root, 'examples/activity', f), 'utf8'));
  }
});

test('activity: flow graphs become structured blocks', async () => {
  const valid = Object.fromEntries((await fixtures('valid.json')).map(c => [c.name, c.doc]));
  const decision = structure(model(valid['decision with merge']));
  assert.deepEqual(kinds(decision), ['initial', 'decision', 'activityFinal']);
  assert.equal(decision[1].merge.id, 'm');
  assert.deepEqual(decision[1].branches.map(b => b.guard), ['yes', 'no']);
  assert.deepEqual(kinds(structure(model(valid['while loop (test first)']))), ['initial', 'while', 'activityFinal']);
  const repeat = structure(model(valid['repeat loop (test after)']))[1];
  assert.equal(repeat.kind, 'repeat');
  assert.equal(repeat.backGuard, 'again');
  assert.equal(repeat.exitGuard, 'done');
  assert.equal(structure(model(valid['loop with an action on the returning flow']))[1].backward.id, 'w');
  assert.deepEqual(kinds(structure(model(valid['fork and join']))), ['initial', 'fork', 'activityFinal']);
  // Without a merge node, the continuing branch carries the rest of the flow,
  // so PlantUML draws no merge diamond that the model does not have.
  const open = structure(model(valid['decision whose other branch terminates (no merge)']));
  assert.deepEqual(kinds(open), ['initial', 'decision']);
  assert.equal(open[1].merge, undefined);
  assert.deepEqual(kinds(open[1].branches[0].body), ['action', 'action', 'activityFinal']);
  assert.deepEqual(kinds(open[1].branches[1].body), ['action', 'flowFinal']);
});

test('activity: PlantUML source uses UML shapes, encodes every display string and never passes input through', async () => {
  const hostile = '"; @enduml !include /etc/passwd <b>x</b> [[http://x]] |lane| :act; <<object>>';
  const doc = {
    kind: 'activity', title: hostile, partitions: [{ id: 'p', name: hostile }],
    nodes: [
      { id: 'i', type: 'initial', partition: 'p' },
      { id: 'a', type: 'action', name: hostile, partition: 'p', note: hostile },
      { id: 'o', type: 'object', name: hostile, state: hostile, partition: 'p' },
      { id: 'c', type: 'callBehavior', name: 'Call', partition: 'p' },
      { id: 's', type: 'sendSignal', name: 'Send', partition: 'p' },
      { id: 'r', type: 'acceptEvent', name: 'Accept', partition: 'p' },
      { id: 'd', type: 'decision', partition: 'p' },
      { id: 'f', type: 'activityFinal', partition: 'p' },
      { id: 'g', type: 'flowFinal', partition: 'p' },
    ],
    edges: [
      { type: 'control', from: 'i', to: 'a' }, { type: 'object', from: 'a', to: 'o' }, { type: 'object', from: 'o', to: 'c' },
      { type: 'control', from: 'c', to: 's' }, { type: 'control', from: 's', to: 'r' }, { type: 'control', from: 'r', to: 'd' },
      { type: 'control', from: 'd', to: 'f', guard: hostile }, { type: 'control', from: 'd', to: 'g', guard: 'else' },
    ],
  };
  const source = activityToPlantUml(model(doc), await loadFonts());
  for (const fragment of ['@enduml\n', '!include', '<b>', '[[', 'passwd', 'lane|']) {
    assert.equal(source.split(fragment).length - 1, fragment === '@enduml\n' ? 1 : 0, `raw ${fragment}`);
  }
  assert.doesNotMatch(source, /\bi\b.*\bp\b/u, 'user IDs never reach the source');
  for (const line of ['start', 'stop', 'end', 'endif', 'note right', 'end note']) assert.ok(source.split('\n').some(l => l.trim() === line), `missing ${line}`);
  // Two-way decisions are if/else: guards stay at their own branch and swimlane changes inside branches work.
  assert.ok(source.split('\n').some(l => l.startsWith('if () then (​<U+')), 'two-way decision as if/else');
  for (const stereotype of ['<<callBehavior>>', '<<output>>', '<<input>>', '<<object>>']) assert.ok(source.includes(stereotype), stereotype);
  assert.match(source, /^mainframe \*\*act\*\* ​<U\+0022>/mu);
  assert.match(source, /^\|​<U\+0022>/mu, 'partition becomes an encoded swimlane');
});

test('activity: post-processor draws open arrowheads, drops mid-line arrows and adds the rake', () => {
  const svg = '<svg data-diagram-type="ACTIVITY" viewBox="0 0 200 200" width="200px" height="200px" style="width:200px;height:200px;"><g>'
    + '<rect fill="#F8FAFC" height="40" rx="12" ry="12" style="stroke:#334156;stroke-width:1.25;" width="100" x="10" y="10"/>'
    + '<line style="stroke:#334155;stroke-width:1.25;" x1="60" x2="60" y1="50" y2="100"/>'
    + '<polygon fill="#334155" points="56,90,60,100,64,90,60,94" style="stroke:#334155;stroke-width:1;"/>'
    + '<line style="stroke:#334155;stroke-width:1.25;" x1="150" x2="150" y1="20" y2="180"/>'
    + '<polygon fill="#334155" points="146,110,150,100,154,110,150,106" style="stroke:#334155;stroke-width:1;"/>'
    + '</g></svg>';
  const fixed = fixActivitySvg(svg);
  assert.equal((fixed.match(/<polygon/g) ?? []).length, 0, 'filled heads are gone');
  assert.equal((fixed.match(/<polyline/g) ?? []).length, 1, 'one open head at the line end, none mid-line');
  assert.match(fixed, /<polyline fill="none" points="54,89 60,100 66,89"/);
  assert.match(fixed, /<rect [^>]*stroke:#334155;/, 'marker stroke restored');
  assert.match(fixed, /<path d="M94,30 V42 M88,42 V36 H100 V42" fill="none"/, 'rake in the lower right corner');
});

test('activity: decisions with more than two branches use switch; repeat loops label both guards', async () => {
  const valid = Object.fromEntries((await fixtures('valid.json')).map(c => [c.name, c.doc]));
  const three = activityToPlantUml(model(valid['three-way decision']));
  assert.match(three, /^switch \(\)$/mu);
  assert.doesNotMatch(three, /^if /mu);
  const repeat = activityToPlantUml(model(valid['repeat loop (test after)'])).split('\n');
  // PlantUML drops is/not labels of repeat loops: the back guard is the condition, the exit guard labels the next flow.
  const at = repeat.findIndex(l => l.startsWith('repeat while ('));
  assert.ok(at > 0, 'repeat while with the returning guard');
  assert.match(repeat[at + 1], /^->​<U\+005B>/u, 'exit guard on the leaving flow');
});

test('activity: post-processor mirrors accept event notches, trims bars and anchors notes with a dashed line', () => {
  const svg = '<svg data-diagram-type="ACTIVITY" viewBox="0 0 400 300" width="400px" height="300px" style="width:400px;height:300px;"><g>'
    // Accept event: notch on the right, as PlantUML draws <<input>>.
    + '<polygon fill="#F8FAFC" points="10,10,110,10,100,30,110,50,10,50" style="stroke:#334155;stroke-width:1.25;"/>'
    // Send signal (convex point on the right) stays as it is.
    + '<polygon fill="#F8FAFC" points="10,60,100,60,110,80,100,100,10,100" style="stroke:#334155;stroke-width:1.25;"/>'
    // A fork bar across the whole width with two flows leaving it at x=150 and x=190.
    + '<rect fill="#334155" height="6" rx="2.5" ry="2.5" style="stroke:#334155;stroke-width:1;" width="380" x="10" y="120"/>'
    + '<line style="stroke:#334155;stroke-width:1.25;" x1="150" x2="150" y1="126" y2="160"/>'
    + '<line style="stroke:#334155;stroke-width:1.25;" x1="190" x2="190" y1="126" y2="160"/>'
    // A note right of an action, with PlantUML's pointer on its left edge.
    + '<path d="M240,200 L240,210 L220,214 L240,218 L240,240 A0,0 0 0 0 240,240 L380,240 A0,0 0 0 0 380,240 L380,210 L370,200 L240,200 A0,0 0 0 0 240,200" fill="#FFF8DB" style="stroke:#9A7B1C;stroke-width:1;"/>'
    + '</g></svg>';
  const fixed = fixActivitySvg(svg);
  assert.match(fixed, /points="10,10,110,10,110,50,10,50,20,30"/, 'accept event notch on the left');
  assert.match(fixed, /points="10,60,100,60,110,80,100,100,10,100"/, 'send signal unchanged');
  assert.match(fixed, /<rect fill="#334155" height="6" [^>]*width="72" x="134" y="120"\/>/, 'bar spans its flows plus 16 px');
  assert.match(fixed, /<path d="M240,200 L240,240 A0,0/, 'note pointer removed');
  assert.match(fixed, /<line x1="240" y1="214" x2="220" y2="214" style="[^"]*stroke-dasharray:7,4;"\/>/, 'dashed anchor to the node');
});

test('activity: post-processor draws a fork branch beyond the bar straight from the bar, and a join input straight into it', () => {
  const line = (x1, y1, x2, y2) => `<line style="stroke:#334155;stroke-width:1.25;" x1="${x1}" x2="${x2}" y1="${y1}" y2="${y2}"/>`;
  const svg = '<svg data-diagram-type="ACTIVITY" viewBox="0 0 600 400" width="600px" height="400px" style="width:600px;height:400px;"><g>'
    // Fork bar from 40 to 240 with an incoming flow on top and two branches below,
    // the second attached at the bar's right end with a stub and a jog to x=400.
    + '<rect fill="#334155" height="6" rx="2.5" ry="2.5" style="stroke:#334155;stroke-width:1;" width="200" x="40" y="100"/>'
    + line(140, 60, 140, 100) + '<polyline fill="none" points="134,89 140,100 146,89" style="stroke:#334155;stroke-width:1.25;"/>'
    + line(80, 106, 80, 200) + line(238, 106, 238, 110) + line(238, 110, 400, 110) + line(400, 110, 400, 200)
    // Join bar with the same shape upside down: the jog ends in an arrowhead at the bar's end.
    + '<rect fill="#334155" height="6" rx="2.5" ry="2.5" style="stroke:#334155;stroke-width:1;" width="200" x="40" y="300"/>'
    + line(80, 240, 80, 300) + line(400, 240, 400, 290) + line(400, 290, 238, 290) + line(238, 290, 238, 300)
    + '<polyline fill="none" points="232,289 238,300 244,289" style="stroke:#334155;stroke-width:1.25;"/>'
    + line(140, 306, 140, 340)
    + '</g></svg>';
  const fixed = fixActivitySvg(svg);
  assert.doesNotMatch(fixed, /x1="238"/, 'stubs and jogs are gone');
  assert.match(fixed, /x1="400" x2="400" y1="106" y2="200"/, 'the fork branch leaves the underside of the bar');
  assert.match(fixed, /x1="400" x2="400" y1="240" y2="300"/, 'the join input runs into the top of the bar');
  assert.match(fixed, /points="394,289 400,300 406,289"/, 'its arrowhead moved with it');
  assert.match(fixed, /x1="140" x2="140" y1="60" y2="100"/, 'the flow into the fork keeps its route');
  assert.equal((fixed.match(/<rect fill="#334155"[^>]*x="64" y="(100|300)"/g) ?? []).length, 2, 'both bars span their branches plus the overhang');
});

test('activity: branches are ordered by the swimlanes they occupy; interleaving branches and cross-lane multiway decisions are rejected with a rewrite', async () => {
  const lanes = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase() }));
  const doc = {
    kind: 'activity', partitions: lanes,
    nodes: [{ id: 'i', type: 'initial', partition: 'b' }, { id: 'd', type: 'decision', partition: 'b' },
      { id: 'x', type: 'action', name: 'Right', partition: 'c' }, { id: 'y', type: 'action', name: 'Left', partition: 'a' },
      { id: 'm', type: 'merge' }, { id: 'f', type: 'activityFinal', partition: 'b' }],
    edges: [{ from: 'i', to: 'd' }, { from: 'd', to: 'x', guard: 'p' }, { from: 'd', to: 'y', guard: 'else' },
      { from: 'x', to: 'm' }, { from: 'y', to: 'm' }, { from: 'm', to: 'f' }],
  };
  const source = activityToPlantUml(model(doc));
  assert.ok(source.indexOf('<U+004C><U+0065><U+0066><U+0074>') < source.indexOf('<U+0052><U+0069><U+0067><U+0068><U+0074>'), 'the branch in the left lane comes first');
  // A third branch in another lane: the error spells out the nested two-way decisions.
  const three = structuredClone(doc);
  three.nodes.push({ id: 'z', type: 'action', name: 'Middle', partition: 'b' });
  three.edges.push({ from: 'd', to: 'z', guard: 'q' }, { from: 'z', to: 'm' });
  assert.throws(() => parseDocument(JSON.stringify(three)), error => {
    assert.equal(error.code, 'DECISION_SPANS_PARTITIONS');
    assert.match(error.message, /Rewrite it as nested two-way decisions, which may cross partitions: decision "d" keeps \[p\] to "x" and gets a flow \[else\] to a new decision "d_2" in partition "a", whose branches meet at a new merge "m_2" that flows into "m"; decision "d_2" gets \[else\] to "y" and \[q\] to "z"$/u);
    assert.doesNotMatch(error.message, /keeps \[else\]/u, 'the [else] branch is never kept by an outer decision');
    return true;
  });
  // The reviewers' deeply nested decisions over five swimlanes: rejected, not drawn 30000 px wide.
  assert.throws(() => parseDocument(readFileSync(join(root, 'test/fixtures/review/act-awkward.json'), 'utf8')), error => {
    assert.equal(error.code, 'BRANCHES_SHARE_PARTITIONS');
    assert.match(error.diagnostics[0].message, /^The branches of decision "n2" overlap in swimlanes: branch \[condition 4-a is satisfied by the request\] \(from node "n4"\) uses partitions "p1" to "p4" and branch \[else\] \(from node "n26"\) uses partitions "p0" to "p4"/u);
    return true;
  });
});

test('activity: post-processor moves a guard off a crossing line and the QA reader sees flows', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" data-diagram-type="ACTIVITY" viewBox="0 0 300 200" width="300px" height="200px" style="width:300px;height:200px;"><g>'
    + '<rect fill="#F8FAFC" height="40" rx="12" ry="12" style="stroke:#334155;stroke-width:1.25;" width="100" x="10" y="10"/>'
    + '<rect fill="#F8FAFC" height="40" rx="12" ry="12" style="stroke:#334155;stroke-width:1.25;" width="100" x="10" y="140"/>'
    + '<line style="stroke:#334155;stroke-width:1.25;" x1="60" x2="60" y1="50" y2="140"/>'
    + '<polygon fill="#334155" points="56,130,60,140,64,130,60,134" style="stroke:#334155;stroke-width:1;"/>'
    + '<text fill="#1E293B" font-family="Inter" font-size="12" lengthAdjust="spacing" textLength="40" x="40" y="100">[guard]</text>'
    + '</g></svg>';
  const before = runGates(await inspectSvg(svg.replace('data-diagram-type', 'data-x').replace('<svg ', '<svg data-diagram-type="ACTIVITY" ').replace(/<polygon[^>]*>/, '<polyline fill="none" points="54,129 60,140 66,129" style="stroke:#334155;stroke-width:1.25;"/>')), ['[guard]']);
  assert.ok(!before.gates.find(g => g.gate === 'label-edge-crossing').ok, 'the reader detects the crossing');
  const scene = await inspectSvg(fixActivitySvg(svg));
  assert.equal(scene.edges.length, 1);
  assert.equal(scene.edges[0].targetMarker, 'open-arrow');
  assert.ok(scene.edges[0].source && scene.edges[0].target, 'flow connects two nodes');
  const report = runGates(scene, ['[guard]']);
  assert.ok(report.ok, JSON.stringify(report.gates.filter(g => !g.ok)));
  assert.ok(report.gates.every(g => !g.skipped || ENGINE_ONLY_GATES.includes(g.gate)), 'no gate is skipped for activity diagrams (except the engine-only ones)');
});

test('activity: validation, structuring included, finishes before Java is ever started', async t => {
  const dir = await workspace(t), marker = join(dir, 'spawned');
  const java = await fakeJava(dir, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned');`);
  const env = { ...process.env, UML_JAVA: java, PLANTUML_JAR: 'unused' };
  const unstructured = (await fixtures('invalid.json')).find(c => c.expect.code === 'UNSTRUCTURED_FLOW').doc;
  const result = cli(['render', '-', '-o', join(dir, 'out.svg')], { input: JSON.stringify(unstructured), env });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'UNSTRUCTURED_FLOW');
  assert.ok(!existsSync(marker), 'the renderer was not started');
  assert.ok(!existsSync(join(dir, 'out.svg')));
});
