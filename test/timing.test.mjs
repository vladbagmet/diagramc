import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { timingToPlantUml, niceStep } from '../dist/kinds/timing/to-plantuml.js';
import { cutGuides, encloseFooter, liftConstraints, nudgeMessages, placeMessageLabels, CONSTRAINT_LIFT } from '../dist/kinds/timing/postprocess.js';
import { estimateWidth, VALUE_PAD } from '../dist/kinds/timing/scale.js';
import { checkSvg, inspectSvg } from '../dist/qa/index.js';
import { cli, root } from './helpers.mjs';

// Java-free tests of the timing kind. Real renders are in test/integration/timing.test.mjs.
const fixtures = name => readFile(join(root, 'test/fixtures/timing', name), 'utf8').then(JSON.parse);
const source = doc => timingToPlantUml(parseDocument(JSON.stringify(doc)).model);
const decode = s => s.replaceAll(/<U\+([0-9A-F]{4})>/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16))).replaceAll('\u200B', '');
const T = (id, notation, states, changes, extra = {}) => ({ id, name: id, notation, states, changes: changes.map(([at, state]) => ({ at, state })), ...extra });

test('negative fixtures fail with the exact code and JSON path', async () => {
  const cases = await fixtures('invalid.json');
  assert.ok(cases.length >= 25);
  for (const c of cases) {
    assert.throws(
      () => parseDocument(JSON.stringify(c.doc)),
      error => {
        assert.equal(error.code, c.expect.code, `${c.name}: ${error.message}`);
        assert.equal(error.path, c.expect.path, `${c.name}: ${error.message}`);
        return true;
      },
      c.name,
    );
  }
});

test('positive fixtures and examples validate', async () => {
  for (const c of await fixtures('valid.json')) assert.doesNotThrow(() => parseDocument(JSON.stringify(c.doc)), c.name);
  const files = (await readdir(join(root, 'examples/timing'))).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 3);
  for (const f of files) parseDocument(await readFile(join(root, 'examples/timing', f), 'utf8'));
});

test('UML notation: robust and concise lifelines, states, changes, messages, constraints, highlights, notes', () => {
  const lines = source({
    kind: 'timing',
    title: 'T',
    timeUnit: 'ms',
    lifelines: [
      T(
        'r',
        'robust',
        ['On', 'Off'],
        [
          [0, 'Off'],
          [10, 'On'],
        ],
        { classifier: 'Lamp' },
      ),
      T(
        'c',
        'concise',
        ['A', 'B'],
        [
          [0, 'A'],
          [20, 'B'],
        ],
      ),
    ],
    messages: [{ from: 'r', fromTime: 10, to: 'c', toTime: 20, name: 'go', arguments: ['1'] }],
    durationConstraints: [{ lifeline: 'r', from: 0, to: 10, min: 'd', max: '3*d' }],
    timeConstraints: [{ lifeline: 'c', at: 20, from: 18, to: 22 }],
    highlights: [{ from: 22, to: 25, label: 'idle' }],
    notes: [{ lifeline: 'c', at: 20, text: 'changes', position: 'bottom' }],
  })
    .split('\n')
    .map(decode);
  const body = lines.slice(lines.indexOf('</style>') + 1);
  assert.deepEqual(body, [
    'mainframe **sd** T',
    'footer time (ms)',
    'scale 5 as 96 pixels',
    'robust "r : Lamp" as uml_t0',
    'uml_t0 has "On" as uml_t0s0',
    'uml_t0 has "Off" as uml_t0s1',
    'concise "c" as uml_t1',
    'uml_t1 has "A" as uml_t1s0',
    'uml_t1 has "B" as uml_t1s1',
    '@0',
    'uml_t0 is uml_t0s1',
    'uml_t1 is uml_t1s0',
    '@10',
    'uml_t0 is uml_t0s0',
    '@20',
    'uml_t1 is uml_t1s1',
    'note bottom of uml_t1',
    'changes',
    'end note',
    '@25',
    'uml_t0 is uml_t0s0',
    'uml_t0@0 <-> @10 : {d..3*d}',
    'uml_t0@10 -> uml_t1@20 : go(1)',
    // Time constraints carry a marker fill: the post-processor confines them to their lifeline.
    'highlight 18 to 22 #F1F5F8 : {18..22}',
    'highlight 22 to 25 : idle',
    '@enduml',
    '',
  ]);
});

test('time axis: about ten round ticks, and room for every concise value', () => {
  assert.deepEqual([0.5, 1, 1.5, 3, 7, 10, 12, 45, 99, 101].map(niceStep), [1, 1, 2, 5, 10, 10, 20, 50, 100, 200]);
  const scale = doc =>
    source(doc)
      .match(/^scale (\d+) as (\d+) pixels$/m)
      .slice(1)
      .map(Number);
  const [step, px] = scale({
    kind: 'timing',
    timeUnit: 's',
    lifelines: [
      T(
        'c',
        'concise',
        ['a long value name', 'B'],
        [
          [0, 'a long value name'],
          [10, 'B'],
          [100, 'a long value name'],
        ],
      ),
    ],
  });
  // The last value starts at the last time: the axis runs on so it has room too (about 160 s, ticks of 20).
  assert.equal(step, 20);
  assert.ok((px / step) * 10 >= estimateWidth('a long value name') + VALUE_PAD, 'the shortest value interval is wide enough for its text');
  assert.deepEqual(
    scale({ kind: 'timing', timeUnit: 's', lifelines: [T('r', 'robust', ['a'], [[0, 'a']])], highlights: [{ from: 0, to: 10 }] }),
    [1, 48],
    'at least 480 px wide',
  );
  // Large time values do not blow up the width: the scale follows what needs room (review C-14).
  const [bigStep, bigPx] = scale({
    kind: 'timing',
    timeUnit: 'ms',
    lifelines: [
      T(
        'r',
        'robust',
        ['Closed', 'Open'],
        [
          [0, 'Closed'],
          [2500, 'Open'],
          [11_000, 'Closed'],
        ],
      ),
    ],
  });
  assert.ok((bigPx / bigStep) * 11_000 <= 600, `a two-change lifeline over 11000 ms stays compact (${(bigPx / bigStep) * 11_000} px)`);
  // Text that cannot get its room even at the widest axis is a validation error, never overlapping text (C-03).
  const dense = {
    kind: 'timing',
    timeUnit: 'cycles',
    lifelines: [
      T(
        'c',
        'concise',
        ['OK', 'WAITING_FOR_UPSTREAM_ACKNOWLEDGEMENT'],
        [
          [0, 'OK'],
          [500, 'WAITING_FOR_UPSTREAM_ACKNOWLEDGEMENT'],
          [502, 'OK'],
          [1000, 'WAITING_FOR_UPSTREAM_ACKNOWLEDGEMENT'],
        ],
      ),
    ],
  };
  assert.throws(
    () => parseDocument(JSON.stringify(dense)),
    e => {
      assert.equal(e.code, 'TIMELINE_TOO_DENSE');
      assert.equal(e.path, '/lifelines/0/changes/1/state');
      assert.match(e.message, /needs about \d+ px.*leaves it \d+ px; shorten the text/);
      return true;
    },
  );
  assert.ok(estimateWidth('STOP') >= 33 && estimateWidth('STOP') <= 36, 'advance table matches Inter (STOP is 34.5 px at 13 px)');
});

test('hostile text in every slot is encoded and never becomes PlantUML syntax', () => {
  const hostile = String.raw`" } !include https://evil.invalid\n@enduml <b>x</b> [[link]] #red @5 is has`;
  const src = source({
    kind: 'timing',
    title: hostile,
    timeUnit: hostile.slice(0, 40),
    lifelines: [
      T(
        'r',
        'robust',
        [hostile, 'Off'],
        [
          [0, hostile],
          [10, 'Off'],
        ],
        { name: hostile, classifier: hostile },
      ),
      T('c', 'concise', [hostile], [[0, hostile]], { name: hostile }),
    ],
    messages: [{ from: 'r', fromTime: 0, to: 'c', toTime: 5, name: hostile, arguments: [hostile] }],
    durationConstraints: [{ lifeline: 'r', from: 0, to: 10, min: hostile.slice(0, 40), max: hostile.slice(0, 40) }],
    highlights: [{ from: 1, to: 10, label: hostile }],
    notes: [{ lifeline: 'c', at: 0, text: hostile }],
  });
  const skeleton = src.replaceAll(/\u200B(?:<U\+[0-9A-F]{4}>)*\u200B/g, 'TEXT');
  for (const fragment of ['!include', 'evil', '<b>', '[[', '#red', ' is has']) assert.ok(!skeleton.includes(fragment), fragment);
  assert.equal(skeleton.match(/@enduml/g).length, 1);
  assert.ok(!src.includes('"r"') && !src.includes(' r@'), 'user IDs never reach the source');
});

test('post-processing lifts duration constraints, encloses the footer and moves message labels off the receiver', () => {
  const constraint =
    '<line style="stroke:#334155;stroke-width:1.25;" x1="100" x2="200" y1="50" y2="50"/><polygon fill="#334155" points="108,54,108,46,100,50" style="s"/><polygon fill="#334155" points="192,54,192,46,200,50" style="s"/><text fill="#1E293B" font-size="12" textLength="30" x="140" y="38">{1..2}</text>';
  const lifted = liftConstraints(constraint);
  assert.match(lifted, new RegExp(`y1="${50 - CONSTRAINT_LIFT}" y2="${50 - CONSTRAINT_LIFT}"`));
  assert.match(lifted, new RegExp(`points="108,${54 - CONSTRAINT_LIFT},108,${46 - CONSTRAINT_LIFT},100,${50 - CONSTRAINT_LIFT}"`));
  assert.match(lifted, new RegExp(`y="${38 - CONSTRAINT_LIFT}"`));

  const svg =
    '<svg height="100px" style="width:10px;height:100px;" viewBox="0 0 10 100" width="10px"><defs/><g><rect fill="#FFFFFF" height="80" style="stroke:#475569;stroke-width:1;" width="5" x="1" y="5"/><g class="footer"><text fill="#334155" font-size="12" x="1" y="88">time (ms)</text></g></g></svg>';
  const out = encloseFooter(svg);
  const height = Number(out.match(/<rect fill="#FFFFFF" height="([\d.]+)"/)[1]);
  assert.ok(5 + height >= 88 + 4, 'frame encloses the footer');
  assert.match(out, /viewBox="0 0 10 \d+"/);
  assert.ok(Number(out.match(/viewBox="0 0 10 (\d+)"/)[1]) >= 5 + height);

  const message =
    '<line style="stroke:#334155;stroke-width:1.25;" x1="100" x2="200" y1="200" y2="100"/><polygon fill="#334155" points="195,108,192,104,200,100" style="s"/><text fill="#1E293B" font-size="12" textLength="20" x="200" y="120">go</text>';
  const placed = placeMessageLabels(`<svg>${message}<line style="stroke:#334155;stroke-width:1.25;" x1="0" x2="400" y1="0" y2="0"/></svg>`);
  const [x, y] = placed
    .match(/textLength="20" x="([\d.]+)" y="([\d.]+)"/)
    .slice(1)
    .map(Number);
  assert.ok(x > 140 && x < 160 && y > 150, `label next to the middle, below the rising arrow (${x}, ${y})`);
});

test('QA reader: a stored timing render yields state lines, values, messages and labels, and the gates pass', async () => {
  const svg = await readFile(join(root, 'test/fixtures/timing/rendered.svg'), 'utf8');
  const scene = await inspectSvg(svg);
  assert.equal(scene.interaction.diagram, 'timing');
  assert.equal(scene.interaction.messages.length, 2);
  assert.ok(scene.interaction.waveforms.length > 10);
  assert.ok(scene.nodes.some(n => n.type === 'concise-value'));
  assert.ok(scene.edges.some(e => e.type === 'duration-constraint'));
  assert.ok(scene.texts.some(t => t.role === 'frame-label' && t.content === 'sd'));
  const report = await checkSvg(svg, ['Everything', 'cycles', 'go', 'down', 'quiet', 'sensor', 'Sensor', 'Unknown', 'd', '3*d']);
  assert.ok(report.ok, JSON.stringify(report.gates.filter(g => !g.ok)));
});

test('QA reader: the gates catch a message that misses the state lines and a label on a line', async () => {
  const svg = await readFile(join(root, 'test/fixtures/timing/rendered.svg'), 'utf8');
  // Move the "down" message's end 30px up, away from every state line.
  const moved = svg.replace(
    /(<line style="stroke:#334155;stroke-width:1.25;" x1="[\d.]+" x2="[\d.]+" y1="[\d.]+" y2=")([\d.]+)("\/><polygon fill="#334155" points=")([^"]*)("[^>]*\/><text[^>]*>&#8203;down)/,
    (m, a, y2, b, pts, c) =>
      `${a}${Number(y2) - 30}${b}${pts
        .split(',')
        .map((v, i) => (i % 2 ? Number(v) - 30 : v))
        .join(',')}${c}`,
  );
  assert.notEqual(moved, svg);
  const gate = (await checkSvg(moved)).gates.find(g => g.gate === 'message-endpoints');
  assert.ok(!gate.ok, 'message-endpoints fails');
  // Put the "quiet" highlight label on a robust state line.
  const line = svg.match(/<line style="stroke:#334155;stroke-width:1.5;" x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="\3"\/>/);
  const onLine = svg.replace(/(<text[^>]* x=")[\d.]+(" y=")[\d.]+(">&#8203;quiet)/, `$1${Number(line[1]) + 2}$2${Number(line[3]) + 4}$3`);
  const crossing = (await checkSvg(onLine)).gates.find(g => g.gate === 'label-edge-crossing');
  assert.ok(!crossing.ok, 'label-edge-crossing fails');
});

test('post-processing moves an instant message off the state change it would run along, onto the state lines beside it, and cuts guides around text', async () => {
  const robust = (x1, y1, x2, y2) => `<line style="stroke:#334155;stroke-width:1.5;" x1="${x1}" x2="${x2}" y1="${y1}" y2="${y2}"/>`;
  // Sender: robust line at y=100. Middle lifeline: steps at x=200 between y=180 and 160. Receiver: line at y=300.
  const lifelines = robust(0, 100, 400, 100) + robust(0, 180, 200, 180) + robust(200, 180, 200, 160) + robust(200, 160, 400, 160) + robust(0, 300, 400, 300);
  const message =
    '<line style="stroke:#334155;stroke-width:1.25;" x1="200" x2="200" y1="100" y2="300"/><polygon fill="#334155" points="197.3,292.5,202.7,292.5,200,300" style="stroke:#334155;stroke-width:1.25;"/><text fill="#1E293B" font-size="12" textLength="20" x="204" y="200">go</text>';
  const out = nudgeMessages(`<svg>${lifelines}${message}</svg>`);
  assert.match(
    out,
    /x1="208" x2="208" y1="100" y2="300"\/><polygon fill="#334155" points="205.3,292.5,210.7,292.5,208,300"/,
    'moved 8 px right, still from line to line',
  );
  // The gate sees the original message run along the step, and not the moved one.
  const gate = async svg =>
    (
      await checkSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-type="TIMING" viewBox="0 0 400 400" width="400px" height="400px"><g>${svg.slice(5, -6)}</g></svg>`,
      )
    ).gates.find(g => g.gate === 'timing-lines');
  assert.ok(!(await gate(`<svg>${lifelines}${message}</svg>`)).ok);
  assert.ok((await gate(out)).ok, JSON.stringify((await gate(out)).failures));
  // A highlight border is cut where it would run through a text.
  const guide = '<line style="stroke:#334155;stroke-width:1.25;stroke-dasharray:4,4;" x1="50" x2="50" y1="0" y2="200"/>';
  const text = '<text fill="#0F172A" font-size="13" textLength="40" x="30" y="100">FULL</text>';
  const cut = cutGuides(`<svg>${guide}${text}</svg>`);
  assert.equal((cut.match(/dasharray:4,4/g) ?? []).length, 2, 'two pieces, one above and one below the text');
  assert.match(cut, /y1="0" y2="85.65"\/><line [^>]*y1="105.25" y2="200"/);
});

test('duration constraint bounds may be numbers; a wrong type names the bound, not a shared definition', () => {
  const doc = bound =>
    JSON.stringify({
      kind: 'timing',
      timeUnit: 'ms',
      lifelines: [
        {
          id: 'a',
          name: 'A',
          notation: 'robust',
          states: ['x', 'y'],
          changes: [
            { at: 0, state: 'x' },
            { at: 10, state: 'y' },
          ],
        },
      ],
      durationConstraints: [{ lifeline: 'a', from: 0, to: 10, min: bound, max: '3*d' }],
    });
  assert.equal(parseDocument(doc(2.5)).model.durationConstraints[0].min, 2.5);
  assert.match(timingToPlantUml(parseDocument(doc(2)).model), /<U\+007B><U\+0032><U\+002E><U\+002E><U\+0033><U\+002A><U\+0064><U\+007D>/u, 'drawn {2..3*d}');
  assert.throws(
    () => parseDocument(doc(true)),
    e =>
      /durationConstraints\/0\/min boolean true is not valid; it must be one of: a number such as 10 or 2.5; an expression/u.test(e.message) &&
      !/guillemets/u.test(e.message),
  );
});

test('kinds, schema and validate work for timing diagrams', () => {
  const kind = JSON.parse(cli(['kinds']).stdout).find(k => k.kind === 'timing');
  assert.deepEqual(kind.backends, ['plantuml']);
  const schema = JSON.parse(cli(['schema', 'timing']).stdout);
  assert.equal(schema.properties.kind.const, 'timing');
  assert.deepEqual(schema.required, ['kind', 'timeUnit', 'lifelines']);
  assert.deepEqual(JSON.parse(cli(['validate', join(root, 'examples/timing/door.json')]).stdout), { valid: true, kind: 'timing', version: 2 });
});
