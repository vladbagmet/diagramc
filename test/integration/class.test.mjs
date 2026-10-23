import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../../dist/model/parse.js';
import { classToPlantUml } from '../../dist/kinds/class/to-plantuml.js';
import { classKind } from '../../dist/kinds/class/index.js';
import { renderSvg, rendererOptions } from '../../dist/plantuml/runner.js';
import { renderToSvg } from '../../dist/render.js';
import { loadFonts } from '../../dist/engine/fonts.js';
import { checkSvg, formatReport, renderAndCheck } from '../../dist/qa/index.js';
import { budgetFactor, cli, plantUmlTest as test, root, workspace } from '../helpers.mjs';

// Real pinned PlantUML (npm run setup:renderer). Only the PlantUML backend needs Java.
const plantuml = { backend: 'plantuml' };

function visibleText(svg) {
  return [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(m => m[1]
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    .replace(/^​|​$/g, ''));
}
// Smetana (PlantUML's built-in layout) can put labels on nodes and draws note
// pointers through other nodes, so the class fallback guarantees only the gates
// that do not depend on layout quality. The own engine must pass all of them.
const FALLBACK_GATES = classKind.backends.find(b => b.name === 'plantuml').gates;
const fallbackFailures = report => report.gates.filter(g => FALLBACK_GATES.includes(g.gate) && !g.ok).map(g => `${g.gate}: ${g.failures.join('; ')}`);
const examples = async dir => (await readdir(join(root, dir))).filter(f => f.endsWith('.json')).sort().map(f => join(root, dir, f));

test('PlantUML backend: every class example (v2 and v1) renders through the CLI and passes the gates', async t => {
  const dir = await workspace(t);
  for (const input of [...await examples('examples/class'), ...await examples('examples/v1')]) {
    if (input.endsWith('stress.json')) continue;
    const output = join(dir, 'out.svg');
    const result = input.endsWith('unicode.json')
      ? cli(['render', '-', '-o', output, '--backend', 'plantuml'], { input: await readFile(input) })
      : cli(['render', input, '-o', output, '--backend', 'plantuml']);
    assert.equal(result.status, 0, `${input}: ${result.stderr}`);
    assert.equal(result.stderr, '');
    const svg = await readFile(output, 'utf8');
    assert.match(svg, /data-diagram-type="CLASS"/);
    assert.ok(!svg.includes('plantuml.com'));
    const parsed = parseDocument(await readFile(input, 'utf8'));
    const report = await checkSvg(svg, parsed.texts.map(x => x.text));
    assert.deepEqual(fallbackFailures(report), [], `${input}:\n${formatReport(report)}`);
  }
});
test('PlantUML backend: stress example renders within 5 s', async () => {
  const { report, ms } = await renderAndCheck(await readFile(join(root, 'examples/class/stress.json'), 'utf8'), plantuml);
  assert.deepEqual(fallbackFailures(report), []);
  assert.ok(ms < 5000 * budgetFactor, `took ${ms} ms`);
});
test('PlantUML backend: the pinned runtime measures with Inter and the SVG embeds it', async () => {
  const svg = await renderToSvg(parseDocument(JSON.stringify({ kind: 'class', elements: [{ id: 'c', type: 'class', name: 'Customer', attributes: [{ name: 'placeOrder', type: 'Order' }] }] })), plantuml);
  assert.match(svg, /<style>@font-face\{font-family:"Inter";[^}]*src:url\(data:font\/woff2;base64,/);
  const metrics = await loadFonts();
  const [, length] = svg.match(/textLength="([\d.]+)"[^>]*>&#8203;placeOrder : Order&#8203;/) ?? svg.match(/textLength="([\d.]+)"[^>]*>​placeOrder : Order​/);
  const expected = metrics.measure('placeOrder : Order', { size: 13 });
  assert.ok(Math.abs(Number(length) - expected) / expected < 0.03, `Java measured ${length}, Inter is ${expected}`);
});
test('PlantUML backend: hostile text stays literal and cannot create active SVG markup', async () => {
  const hostile = '" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \\n @enduml';
  const model = parseDocument(JSON.stringify({
    classes: [{ id: 'a', name: hostile, attributes: [hostile], methods: [hostile, 'emoji: 🚀'] }, { id: 'b', name: 'B' }],
    relationships: [{ type: 'association', from: 'a', to: 'b', label: hostile }],
  })).model;
  const svg = (await renderSvg(classToPlantUml(model), await rendererOptions())).toString();
  assert.equal(visibleText(svg).filter(t => t === hostile).length, 4);
  assert.ok(visibleText(svg).includes('emoji: 🚀'));
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject)\b/);
  assert.doesNotMatch(svg, /(?:href|onload)=/);
});
test('PlantUML backend: same pinned environment produces byte-identical SVG', async () => {
  const parsed = parseDocument(await readFile(join(root, 'examples/class/ordering.json'), 'utf8'));
  assert.equal(await renderToSvg(parsed, plantuml), await renderToSvg(parsed, plantuml));
});
test('PlantUML backend preserves boundary spaces, generics, nested escapes and markup-like text in every slot', async () => {
  const samples = ['  Customer<T>  ', '<U+0041> &amp; [[https://evil.invalid]]', '<svg onload="alert(1)">', '{static} __under__ //italic// \\n 🚀', '​visible​', 'Unicode: 🚀 𠀀 \u{100000} \u{10FFFD}'];
  const model = parseDocument(JSON.stringify({
    classes: samples.map((text, i) => ({ id: `c${i}`, name: text, attributes: [text], methods: [text] })),
    relationships: samples.map((text, i) => ({ type: 'association', from: `c${i}`, to: `c${i}`, label: text })),
  })).model;
  const svg = (await renderSvg(classToPlantUml(model), await rendererOptions())).toString();
  const texts = visibleText(svg);
  assert.match(svg, /<svg\s[^>]*xml:space="preserve"/);
  for (const [tag] of svg.matchAll(/<text\b[^>]*>/g)) assert.match(tag, /style="[^"]*white-space:pre/);
  for (const sample of samples) assert.equal(texts.filter(text => text === sample).length, 4, `lost literal text: ${sample}`);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject)\b/);
  assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
});
test('PlantUML backend keeps labeled and unlabeled self-associations inside the SVG viewport', async () => {
  for (const labels of [[undefined], ['loop'], ['first', 'second', 'third']]) {
    const model = parseDocument(JSON.stringify({
      classes: [{ id: 'a', name: 'A' }],
      relationships: labels.map(label => ({ type: 'association', from: 'a', to: 'a', ...(label === undefined ? {} : { label }) })),
    })).model;
    const svg = (await renderSvg(classToPlantUml(model), await rendererOptions())).toString();
    const [, top, width, height] = svg.match(/viewBox="0 (-?[\d.]+) ([\d.]+) ([\d.]+)"/).map(Number);
    assert.ok(width > 0 && height > -top);
    for (const [, attributes] of svg.matchAll(/<text\b([^>]*)>/g)) {
      const y = Number(attributes.match(/ y="(-?[\d.]+)"/)[1]);
      const size = Number(attributes.match(/ font-size="([\d.]+)"/)[1]);
      assert.ok(y - size >= top, `clipped text in ${labels.length}-loop model`);
    }
  }
});
test('PlantUML backend renders PNG through resvg', async t => {
  const dir = await workspace(t);
  const result = cli(['render', join(root, 'examples/class/minimal.json'), '-o', join(dir, 'a.png'), '--backend', 'plantuml']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([...(await readFile(join(dir, 'a.png'))).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});
