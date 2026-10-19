import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseModel } from '../dist/model.js';
import { toPlantUml } from '../dist/plantuml.js';
import { renderSvg, rendererOptions } from '../dist/renderer.js';
import { cli, root, workspace } from './helpers.mjs';

function visibleText(svg) {
  return [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(m => m[1]
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    .replace(/^\u200b|\u200b$/g, ''));
}
test('real pinned renderer: all five examples through CLI, including stdin', async t => {
  const dir = await workspace(t);
  for (const name of ['simple', 'inheritance', 'order-system', 'unicode', 'long-labels']) {
    const input = join(root, 'examples', `${name}.json`), output = join(dir, `${name}.svg`);
    const result = name === 'unicode'
      ? cli(['render', '-', '-o', output], { input: await readFile(input) })
      : cli(['render', input, '-o', output]);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.equal(result.stderr, '');
    const svg = await readFile(output, 'utf8');
    assert.match(svg, /data-diagram-type="CLASS"/);
    assert.ok(!svg.includes('plantuml.com'));
    const model = parseModel(await readFile(input, 'utf8'));
    const texts = visibleText(svg);
    for (const c of model.classes) {
      for (const text of [c.name, ...(c.attributes ?? []), ...(c.methods ?? [])]) assert.ok(texts.includes(text), `${name}: missing literal text ${text}`);
    }
    for (const r of model.relationships) if (r.label) assert.ok(texts.includes(r.label), `missing label ${r.label}`);
  }
});
test('real renderer: hostile text stays literal and cannot create active SVG markup', async () => {
  const hostile = '" } !include https://evil.invalid <b>bold</b> [[https://evil.invalid]] **x** \\n @enduml';
  const model = parseModel(JSON.stringify({
    classes: [{ id: 'a', name: hostile, attributes: [hostile], methods: [hostile, 'emoji: 🚀'] }, { id: 'b', name: 'B' }],
    relationships: [{ type: 'association', from: 'a', to: 'b', label: hostile }],
  }));
  const svg = (await renderSvg(toPlantUml(model), await rendererOptions())).toString();
  assert.equal(visibleText(svg).filter(t => t === hostile).length, 4);
  assert.ok(visibleText(svg).includes('emoji: 🚀'));
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject)\b/);
  assert.doesNotMatch(svg, /(?:href|onload)=/);
});
test('real renderer: same pinned environment produces byte-identical SVG', async () => {
  const model = parseModel(await readFile(join(root, 'examples/order-system.json'), 'utf8'));
  const source = toPlantUml(model), options = await rendererOptions();
  assert.deepEqual(await renderSvg(source, options), await renderSvg(source, options));
});

test('real renderer preserves boundary spaces, generics, nested escapes and markup-like text in every slot', async () => {
  const samples = ['  Customer<T>  ', '<U+0041> &amp; [[https://evil.invalid]]', '<svg onload="alert(1)">', '{static} __under__ //italic// \\n 🚀', '\u200bvisible\u200b', 'Unicode: 🚀 𠀀 \u{100000} \u{10FFFD}'];
  const model = parseModel(JSON.stringify({
    classes: samples.map((text, i) => ({ id: `c${i}`, name: text, attributes: [text], methods: [text] })),
    relationships: samples.map((text, i) => ({ type: 'association', from: `c${i}`, to: `c${i}`, label: text })),
  }));
  const svg = (await renderSvg(toPlantUml(model), await rendererOptions())).toString();
  const texts = visibleText(svg);
  assert.match(svg, /<svg\s[^>]*xml:space="preserve"/);
  for (const [tag] of svg.matchAll(/<text\b[^>]*>/g)) assert.match(tag, /style="[^"]*white-space:pre/);
  for (const sample of samples) assert.equal(texts.filter(text => text === sample).length, 4, `lost literal text: ${sample}`);
  assert.doesNotMatch(svg, /<(?:a|image|script|foreignObject)\b/);
  assert.doesNotMatch(svg, /<[^>]*\s(?:[\w:]*href|on\w+)\s*=/);
});

test('real renderer keeps labeled and unlabeled self-associations inside the SVG viewport', async () => {
  for (const labels of [[undefined], ['loop'], ['first', 'second', 'third']]) {
    const model = parseModel(JSON.stringify({
      classes: [{ id: 'a', name: 'A' }],
      relationships: labels.map(label => ({ type: 'association', from: 'a', to: 'a', ...(label === undefined ? {} : { label }) })),
    }));
    const svg = (await renderSvg(toPlantUml(model), await rendererOptions())).toString();
    const [, top, width, height] = svg.match(/viewBox="0 (-?[\d.]+) ([\d.]+) ([\d.]+)"/).map(Number);
    assert.ok(top < 0);
    assert.ok(width > 0 && height > -top);
    for (const [, attributes] of svg.matchAll(/<text\b([^>]*)>/g)) {
      const y = Number(attributes.match(/ y="(-?[\d.]+)"/)[1]);
      const size = Number(attributes.match(/ font-size="([\d.]+)"/)[1]);
      assert.ok(y - size >= top + 4, `clipped text in ${labels.length}-loop model`);
    }
    for (const [, d] of svg.matchAll(/<path\b[^>]* d="([MC\d., -]+)"/g)) {
      const points = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      for (let i = 1; i < points.length; i += 2) assert.ok(points[i] >= top + 4);
    }
  }
});
