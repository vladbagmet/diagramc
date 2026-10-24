import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { renderToSvg } from '../../dist/render.js';
import { inspectSvg, renderAndCheck } from '../../dist/qa/index.js';
import { assertGates, budgetFactor, cli, plantUmlTest as test, root, workspace } from '../helpers.mjs';

// Real pinned PlantUML (npm run setup:renderer): every gate on every fixture and example.
const fixtures = name => readFile(join(root, 'test/fixtures/sequence', name), 'utf8').then(JSON.parse);
const examples = async () =>
  (await readdir(join(root, 'examples/sequence')))
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => join(root, 'examples/sequence', f));
const render = async doc => {
  const { svg } = await assertGates(doc);
  return { svg, scene: await inspectSvg(svg) };
};
const L = (...ids) => ids.map(id => ({ id, name: id }));

test('positive fixtures render and pass every QA gate', async () => {
  for (const c of await fixtures('valid.json')) await assertGates(c.doc);
});

test('every sequence example passes every QA gate', async () => {
  for (const file of await examples()) await assertGates(await readFile(file, 'utf8'));
});

test('stress example (40+ messages, nested fragments) renders within 5 s cold', async () => {
  const { ms } = await renderAndCheck(await readFile(join(root, 'examples/sequence/stress.json'), 'utf8'));
  assert.ok(ms < 5000 * budgetFactor, `took ${ms} ms`);
});

test('rendering is byte-identical across runs', async () => {
  const parsed = parseDocument(await readFile(join(root, 'examples/sequence/notation.json'), 'utf8'));
  assert.equal(await renderToSvg(parsed), await renderToSvg(parsed));
});

test('UML notation: arrowheads and line styles per message sort; found and lost circles; destruction ends the lifeline', async () => {
  const { scene } = await render({
    kind: 'sequence',
    lifelines: L('a', 'b', 'c'),
    items: [
      { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'sync', activate: true },
      { type: 'message', sort: 'reply', from: 'b', to: 'a', name: 'sync', deactivate: true },
      { type: 'message', sort: 'asynchronous', from: 'a', to: 'b', name: 'async' },
      { type: 'message', sort: 'create', from: 'a', to: 'c', name: 'C' },
      { type: 'message', sort: 'delete', from: 'b', to: 'c', name: 'drop' },
      { type: 'found', sort: 'synchronous', to: 'a', name: 'found' },
      { type: 'lost', sort: 'asynchronous', from: 'b', name: 'lost' },
    ],
  });
  const m = scene.interaction.messages;
  const expect = [
    ['filled', false],
    ['open', true],
    ['open', false],
    ['open', true],
    ['filled', false],
    ['filled', false],
    ['open', false],
  ];
  for (const [i, [head, dashed]] of expect.entries()) {
    assert.equal(m[i].head.style, head, `message ${i} head`);
    assert.equal(m[i].dashed, dashed, `message ${i} dashed`);
  }
  // Synchronous and asynchronous arrows point at the receiver (right), the reply back (left).
  assert.ok(m[0].head.direction.x > 0.99 && m[1].head.direction.x < -0.99 && m[2].head.direction.x > 0.99);
  // Create ends on the created head's border; the head sits at the message's height.
  const head = scene.interaction.createdHeads.get(m[3].target);
  assert.ok(head && Math.abs(m[3].head.tip.x - head.x) < 3 && m[3].head.tip.y > head.y && m[3].head.tip.y < head.y + head.height);
  // Found: circle at the start; lost: circle at the end.
  assert.ok(m[5].source === undefined && Math.abs(m[5].circle.x - m[5].points[0].x) < 8);
  assert.ok(m[6].target === undefined && m[6].circle.x > m[6].points.at(-1).x);
  // The destroyed lifeline ends at the X.
  const cross = scene.markers.find(k => k.marker === 'cross');
  const lifeline = scene.interaction.lifelines.find(l => l.id === m[4].target);
  assert.ok(cross && Math.abs(lifeline.bottom - cross.tip.y) < 0.5 && Math.abs(lifeline.x - cross.tip.x) < 1);
  assert.ok(Math.abs(cross.tip.y - m[4].head.tip.y) < 1, 'X at the delete message');
});

test('UML notation: no footbox, nested activations offset, frame heading "sd <name>"', async () => {
  const { svg, scene } = await render({
    kind: 'sequence',
    title: 'Nest',
    lifelines: L('a', 'b'),
    items: [
      { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'outer', activate: true },
      { type: 'message', sort: 'synchronous', from: 'b', to: 'b', name: 'inner', activate: true },
      { type: 'deactivate', lifeline: 'b' },
      { type: 'message', sort: 'reply', from: 'b', to: 'a', name: 'outer', deactivate: true },
    ],
  });
  assert.equal(scene.nodes.filter(n => n.type === 'lifeline-head').length, 2);
  assert.doesNotMatch(svg, /participant-tail/);
  const bars = scene.interaction.bars.filter(b => b.lifeline === 'uml_l1');
  const xs = [...new Set(bars.map(b => b.x))].sort((p, q) => p - q);
  assert.equal(xs.length, 2, 'two bar columns');
  assert.ok(xs[1] - xs[0] > 3 && xs[1] - xs[0] < 10, 'nested bar offset to the right');
  const frame = scene.texts.filter(t => t.role === 'frame-label');
  assert.deepEqual(
    frame.map(t => [t.content, t.bold]),
    [
      ['sd', true],
      ['Nest', false],
    ],
  );
  assert.match(svg, /<path d="M[\d.,]+ L[^"]+ Z" fill="#F1F5F9"/, 'filled pentagon heading');
});

test('UML notation: fragments, guards, interaction use and state invariant text', async () => {
  const { scene } = await render(JSON.parse(await readFile(join(root, 'examples/sequence/notation.json'), 'utf8')));
  const texts = scene.texts.map(t => t.content);
  for (const t of ['alt', 'opt', 'loop(1,3)', 'break', 'par', 'critical', 'neg', 'ref', 'FindUser(name)', '{open}'])
    assert.ok(texts.includes(t), `missing ${t}`);
  for (const g of ['user found', 'else', 'remember me', 'attempts < 3', 'locked'])
    assert.ok(
      texts.some(t => t === `[\u200B${g}\u200B]` || t === `[${g}]`),
      `missing guard [${g}]`,
    );
  assert.ok(scene.texts.find(t => t.content === 'alt').bold, 'operator in bold');
});

test('review fixes: notes clear of other lifelines, found/lost inside fragments, regular guards, head names on one baseline (C-07, C-10, C-33, C-41)', async () => {
  const checkout = await render(await readFile(join(root, 'examples/sequence/checkout.json'), 'utf8'));
  // C-07: no note covers a lifeline other than its own.
  const lifelines = [...checkout.svg.matchAll(/<line style="[^"]*dasharray:5,5;" x1="([\d.]+)" x2="\1" y1="([\d.]+)" y2="([\d.]+)"/g)].map(m => ({
    x: Number(m[1]),
    top: Number(m[2]),
    bottom: Number(m[3]),
  }));
  for (const note of checkout.scene.nodes.filter(n => n.type === 'note')) {
    const crossing = lifelines.filter(
      l => l.x > note.bounds.x && l.x < note.bounds.x + note.bounds.width && l.bottom > note.bounds.y && l.top < note.bounds.y + note.bounds.height,
    );
    assert.ok(crossing.length <= 1, `note ${note.id} covers ${crossing.length} lifelines`);
  }
  // C-33: icon heads and rectangle heads have their names on one baseline.
  const heads = [...checkout.svg.matchAll(/<g class="participant participant-head"[^>]*>((?:(?!<\/g>).)*)<\/g>/gs)].map(m =>
    Math.max(...[...m[1].matchAll(/<text [^>]* y="([\d.]+)"/g)].map(t => Number(t[1]))),
  );
  assert.ok(new Set(heads.filter(y => y < 200).map(y => y.toFixed(1))).size === 1, `top heads on one baseline: ${heads}`);
  const notation = await render(await readFile(join(root, 'examples/sequence/notation.json'), 'utf8'));
  // C-41: guards are regular, operators bold.
  for (const t of notation.scene.texts.filter(t => /^\[.*\]$/.test(t.content.replaceAll('\u200B', '')))) assert.equal(t.bold, false, t.content);
  assert.ok(notation.scene.texts.find(t => t.content === 'break').bold);
  // C-10: the lost message in the break fragment ends inside it.
  const frames = [...notation.svg.matchAll(/<rect fill="none" height="([\d.]+)" style="stroke:#475569;[^"]*" width="([\d.]+)" x="([\d.]+)" y="([\d.]+)"/g)].map(
    m => ({ h: Number(m[1]), w: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }),
  );
  const lost = notation.svg
    .match(/<ellipse cx="([\d.]+)" cy="([\d.]+)" fill="#000000"/g)
    .map(e =>
      e
        .match(/cx="([\d.]+)" cy="([\d.]+)"/)
        .slice(1)
        .map(Number),
    )
    .find(([, cy]) => frames.some(f => cy > f.y && cy < f.y + f.h && f.w < 250));
  assert.ok(lost, 'lost message circle inside the small break frame');
  const breakFrame = frames.filter(f => lost[1] > f.y && lost[1] < f.y + f.h).sort((a, b) => a.w - b.w)[0];
  assert.ok(lost[0] < breakFrame.x + breakFrame.w - 8, 'circle inside the innermost fragment');
});

test('review fixes: identifiers wrap at word parts, untitled diagrams get a margin, activations end clear of fragments (C-08, C-38, C-45)', async () => {
  const doc = {
    kind: 'sequence',
    lifelines: [
      { id: 'a', name: 'client' },
      { id: 'b', name: 'service1', classifier: 'VeryLongMicroserviceClassifierName1' },
    ],
    items: [
      { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: 'submitAnExtremelyLongOperationNameThatGoesOnAndOn', activate: true },
      {
        type: 'fragment',
        operator: 'opt',
        operands: [{ guard: 'ready', items: [{ type: 'message', sort: 'asynchronous', from: 'b', to: 'a', name: 'notify' }] }],
      },
      { type: 'deactivate', lifeline: 'b' },
    ],
  };
  const { svg, scene } = await render(doc);
  const lines = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map(m => m[1].replaceAll('&#8203;', ''));
  // Lines break after spaces and at camelCase boundaries, never inside a word part.
  const head = lines.slice(
    lines.indexOf('client') + 1,
    lines.findIndex(l => l.startsWith('submit')),
  );
  assert.ok(head.length > 1 && head.join('') === 'service1 : VeryLongMicroserviceClassifierName1', `head wrapped: ${head}`);
  for (let i = 1; i < head.length; i++) assert.ok(!(/[a-z]$/.test(head[i - 1]) && /^[a-z]/.test(head[i])), `break inside a word part: ${head}`);
  assert.ok(lines.includes('submitAnExtremelyLongOperationNameThatGoesOn') && lines.includes('AndOn'), `label breaks at a camelCase boundary: ${lines}`);
  // C-45: 16 px margin around an untitled drawing.
  const box = svg
    .match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    .slice(1)
    .map(Number);
  const xs = scene.extents.flatMap(r => [r.x, r.x + r.width]),
    ys = scene.extents.flatMap(r => [r.y, r.y + r.height]);
  assert.ok(Math.min(...xs) >= 15 && Math.min(...ys) >= 15 && box[0] - Math.max(...xs) >= 15, 'canvas margin');
  // C-38: the bar ending after the fragment runs at least 10 px below its border.
  const frame = svg
    .match(/<rect fill="none" height="([\d.]+)" style="stroke:#475569;[^"]*" width="[\d.]+" x="[\d.]+" y="([\d.]+)"/)
    .slice(1)
    .map(Number);
  const bars = [...svg.matchAll(/<rect fill="#F8FAFC" height="([\d.]+)" style="stroke:#334155;[^"]*" width="[\d.]+" x="[\d.]+" y="([\d.]+)"/g)].map(
    m => Number(m[2]) + Number(m[1]),
  );
  assert.ok(
    bars.some(b => b - (frame[1] + frame[0]) >= 10),
    'activation visibly continues below the fragment',
  );
});

test('hostile, markup-like and Unicode text stays literal in every slot', async () => {
  const hostile = String.raw`" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \n @enduml`;
  const samples = [hostile, '  spaced  ', '<svg onload="alert(1)">', 'Unicode: 🚀 𠀀 \u{10FFFD} 漢字', "Dollar patterns: $& $' $` $$ $1"];
  for (const text of samples) {
    const doc = {
      kind: 'sequence',
      title: text,
      lifelines: [
        { id: 'a', name: text, classifier: text, symbol: 'actor' },
        { id: 'b', name: text },
        { id: 'c', name: 'c' },
      ],
      items: [
        { type: 'message', sort: 'synchronous', from: 'a', to: 'b', name: text, arguments: [text], activate: true },
        { type: 'message', sort: 'reply', from: 'b', to: 'a', assignment: text, name: 'get', returnValue: text, deactivate: true },
        {
          type: 'fragment',
          operator: 'alt',
          operands: [
            { guard: text, items: [{ type: 'found', sort: 'asynchronous', to: 'b', name: text }] },
            { guard: 'else', items: [{ type: 'lost', sort: 'asynchronous', from: 'b', name: text }] },
          ],
        },
        {
          type: 'fragment',
          operator: 'loop',
          min: 1,
          max: 2,
          operands: [{ guard: text, items: [{ type: 'message', sort: 'asynchronous', from: 'b', to: 'c', name: 'x' }] }],
        },
        { type: 'stateInvariant', lifeline: 'b', constraint: text },
        { type: 'note', position: 'over', lifelines: ['a', 'b'], text },
        { type: 'note', position: 'right', lifelines: ['c'], text },
        { type: 'ref', covered: ['a', 'b'], name: text, arguments: [text] },
      ],
    };
    const { svg, scene } = await render(doc);
    assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject|use)\b/);
    assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
    assert.ok(
      scene.texts.some(t => t.content === text),
      `literal ${JSON.stringify(text)}`,
    );
  }
});

test('CLI renders sequence diagrams to SVG and PNG', async t => {
  const dir = await workspace(t);
  for (const format of ['svg', 'png']) {
    const out = join(dir, `a.${format}`);
    const result = cli(['render', join(root, 'examples/sequence/minimal.json'), '-o', out]);
    assert.equal(result.status, 0, result.stderr);
    const bytes = await readFile(out);
    if (format === 'png') assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    else assert.match(bytes.toString(), /data-diagram-type="SEQUENCE"/);
  }
});

test('review models (sequence) render and pass every QA gate', async () => {
  for (const name of ['seq-awkward.json', 'seq-oauth.json']) {
    await assertGates(await readFile(join(root, 'test/fixtures/review', name), 'utf8'));
  }
  // C-23: the reviewer's guard "[ok]" used to be drawn [[ok]]; it is now rejected with the corrected text.
  assert.throws(
    () => parseDocument(reviewText('seq-llm2.json')),
    e => e.diagnostics.some(d => d.path === '/items/3/operands/0/guard' && d.details.suggestion === 'ok'),
  );
});
const reviewText = name => readFileSync(join(root, 'test/fixtures/review', name), 'utf8');

test('nested fragments never share a right border; notes over lifelines keep the usual text padding', async () => {
  const files = [...(await examples()), join(root, 'test/fixtures/review/seq-awkward.json'), join(root, 'test/fixtures/regression/sequence-seq-pay.json')];
  let nested = 0;
  for (const file of files) {
    const svg = await renderToSvg(parseDocument(await readFile(file, 'utf8')));
    const frames = [
      ...new Set(
        [...svg.matchAll(/<rect fill="none" height="([\d.]+)" style="stroke:#475569;[^"]*" width="([\d.]+)" x="([\d.]+)" y="([\d.]+)"\/>/gu)].map(m =>
          m.slice(1).join(','),
        ),
      ),
    ]
      .map(k => k.split(',').map(Number))
      .map(([h, w, x, y]) => ({ x, y, r: x + w, b: y + h }));
    for (const a of frames)
      for (const b of frames) {
        if (a === b || !(b.x >= a.x && b.y >= a.y && b.r <= a.r && b.b <= a.b)) continue;
        nested++;
        assert.ok(a.r - b.r >= 9.5, `${file}: a fragment nested at (${b.x}, ${b.y}) ends ${(a.r - b.r).toFixed(1)} px from its parent's right border`);
      }
    for (const m of svg.matchAll(/<path d="M([\d.]+),[\d.]+ L\1,[^"]*" fill="#FFF8DB"[^>]*\/><path [^>]*\/><text [^>]* x="([\d.]+)"/gu)) {
      assert.ok(Number(m[2]) - Number(m[1]) <= 12.5, `${file}: note text starts ${(Number(m[2]) - Number(m[1])).toFixed(1)} px inside its note`);
    }
  }
  assert.ok(nested >= 10);
});
