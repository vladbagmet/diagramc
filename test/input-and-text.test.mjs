import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../dist/model/json.js';
import { parseDocument } from '../dist/model/parse.js';
import { decodeXml, parseXml, textContent, walk } from '../dist/qa/xml.js';
import { classToPlantUml } from '../dist/kinds/class/to-plantuml.js';
import { stressCenters } from '../dist/engine/stress.js';
import { renderDocument } from '../dist/render.js';
import { minimalV2 } from './helpers.mjs';

/** The INVALID_JSON error of `text`, or a failure when it parses. */
function jsonError(text) {
  try { parseJson(text); } catch (error) { return error; }
  assert.fail(`${JSON.stringify(text)} parsed`);
}

test('INVALID_JSON points at the first wrong character, with a hint for common mistakes', () => {
  const cases = [
    // [input, line, column, hint pattern or undefined]
    ['{"a":1,}', 1, 8, /trailing comma/],
    ['[1,\n]', 2, 1, /trailing comma/],
    ['{// note\n}', 1, 2, /comment/],
    ['{/* note */}', 1, 2, /comment/],
    ["{'a':1}", 1, 2, /double quotes/],
    ['{\n  kind: "class"}', 2, 3, /property names in double quotes/],
    ['{"a":1 "b":2}', 1, 8, /comma is missing/],
    ['{"a":"x" "b":2}', 1, 10, /comma is missing/],
    ['{"a":[1,2', 1, 10, /ends early/],
    ['', 1, 1, /ends early/],
    ['[01]', 1, 3, undefined],
    ['[tru]', 1, 2, undefined],
    ['"a\tb"', 1, 3, undefined],
    ['{"a" 1}', 1, 6, undefined],
    ['[1 2]', 1, 4, undefined],
    ['{"a":1}x', 1, 8, undefined],
    ['[-]', 1, 3, undefined],
    ['["x\\""]x', 1, 8, undefined],
    ['{"a":{}, "b":[]]', 1, 16, undefined],
  ];
  for (const [text, line, column, hint] of cases) {
    const error = jsonError(text);
    assert.equal(error.code, 'INVALID_JSON', text);
    assert.deepEqual([error.details.line, error.details.column], [line, column], `${JSON.stringify(text)}: ${error.message}`);
    if (hint) assert.match(error.details.hint, hint, text);
    else assert.equal(error.details.hint, undefined, `${JSON.stringify(text)}: ${error.details.hint}`);
    assert.doesNotMatch(error.message, /at position \d+|is not valid JSON$/, 'no raw V8 position or input echo');
  }
});

test('INVALID_JSON quotes only the part of a long line around the error', () => {
  const text = `{"a": "${'x'.repeat(200)}", "b": nope}`;
  const error = jsonError(text);
  assert.ok(error.details.near.length <= 120, error.details.near);
  assert.match(error.details.near, /nope/);
});

test('parseDocument rejects empty input and non-object documents with a clear message', () => {
  assert.throws(() => parseDocument('  \n'), { code: 'INVALID_JSON', message: /Input is empty/ });
  for (const text of ['[]', 'null', '"class"', '3']) {
    assert.throws(() => parseDocument(text), error => error.code === 'SCHEMA_INVALID' && error.message.includes('JSON object'), text);
  }
});

test('the QA XML reader handles comments, CDATA, processing instructions and entities', () => {
  const doc = parseXml('<?xml version="1.0"?><!DOCTYPE svg><!-- c --><svg a=\'1 &amp; 2\'><g id="x"><text>&lt;b&gt; &#65;&#x42;</text><![CDATA[<raw>]]></g><rect/></svg>');
  const svg = doc.children.find(c => typeof c !== 'string');
  assert.equal(svg.tag, 'svg');
  assert.equal(svg.attrs.a, '1 & 2');
  assert.equal(textContent(svg), '<b> AB<raw>');
  assert.deepEqual([...walk(doc)].map(({ element }) => element.tag), ['#document', 'svg', 'g', 'text', 'rect']);
  assert.deepEqual([...walk(doc)].at(-1).ancestors.map(a => a.tag), ['#document', 'svg']);
  assert.equal(decodeXml('&quot;&apos;&gt;&unknown;'), '"\'>&unknown;');
});

test('the QA XML reader rejects malformed input instead of guessing', () => {
  for (const [source, message] of [
    ['<svg><g></svg>', /Mismatched <\/svg>/],
    ['<svg>', /Unclosed <svg>/],
    ['<svg><![CDATA[x</svg>', /Unterminated CDATA/],
    ['<svg><!-- x</svg>', /Unterminated -->/],
    ['<svg>< g/></svg>', /Malformed tag/],
  ]) assert.throws(() => parseXml(source), { message }, source);
});

/** PlantUML source with the <U+XXXX> display tokens decoded, for reading. */
const readable = source => source.replace(/​/g, '').replace(/<U\+([0-9A-F]{4})>/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

test('class PlantUML source: every keyword, end, arrow and note maps to PlantUML syntax', () => {
  const { model } = parseDocument(JSON.stringify({
    kind: 'class',
    title: 'T',
    elements: [
      { id: 'secretId', type: 'class', name: 'A', abstract: true, stereotypes: ['entity'],
        attributes: [{ name: 'n', type: 'Integer', static: true }],
        operations: [{ name: 'run', abstract: true }, { name: 'make', static: true }] },
      { id: 'b', type: 'interface', name: 'B' },
      { id: 'e', type: 'enumeration', name: 'E', literals: ['ON', 'OFF'] },
      { id: 'n', type: 'note', text: 'remember', attachedTo: ['secretId', 'b'] },
    ],
    relationships: [
      { type: 'aggregation', from: 'secretId', to: 'b', toEnd: { navigable: true } },
      { type: 'aggregation', from: 'secretId', to: 'b', toEnd: { navigable: false } },
      { type: 'composition', from: 'secretId', to: 'e', toEnd: { navigable: false } },
      { type: 'composition', from: 'b', to: 'e' },
      { type: 'association', from: 'secretId', to: 'b', fromEnd: { navigable: true, role: 'r' }, toEnd: { navigable: false, multiplicity: '*' } },
      { type: 'dependency', from: 'b', to: 'e', keyword: 'use', name: 'link' },
      { type: 'realization', from: 'secretId', to: 'b' },
      { type: 'generalization', from: 'e', to: 'secretId' },
      { type: 'dependency', from: 'e', to: 'b' },
      { type: 'containment', from: 'b', to: 'e' },
    ],
  }));
  const source = classToPlantUml(model);
  assert.doesNotMatch(source, /secretId/, 'user IDs never reach the source');
  const text = readable(source);
  assert.match(text, /mainframe class T/);
  assert.match(text, /abstract class "A" as uml_e0 <<entity>> \{\n {2}\{static\} \{field\} \+? ?n : Integer\n {2}\{abstract\} \{method\} [^\n]*run\(\)\n {2}\{static\} \{method\} [^\n]*make\(\)\n\}/);
  assert.match(text, /class "B" as uml_e1 <<interface>> \{/);
  assert.match(text, /class "E" as uml_e2 <<enumeration>> \{\n {2}ON\n {2}OFF\n\}/);
  assert.match(text, /note "remember" as uml_e3/);
  for (const line of [
    'uml_e0 o--> uml_e1', 'uml_e0 o--x uml_e1', 'uml_e0 *--x uml_e2', 'uml_e1 *-- uml_e2',
    'uml_e0 "r" <--x "*" uml_e1', 'uml_e1 ..> uml_e2 : «use» link', 'uml_e0 ..|> uml_e1',
    'uml_e2 --|> uml_e0', 'uml_e2 ..> uml_e1', 'uml_e1 +-- uml_e2', 'uml_e3 .. uml_e0', 'uml_e3 .. uml_e1',
  ]) assert.ok(text.split('\n').includes(line), `missing: ${line}`);
});

test('stress placement honours a per-edge length and is deterministic', async () => {
  const nodes = ['a', 'b', 'c'].map(id => ({ id, width: 40, height: 20 }));
  const distance = (m, p, q) => Math.hypot(m.get(p).x - m.get(q).x, m.get(p).y - m.get(q).y);
  const even = await stressCenters(nodes, [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }], { edgeLength: 100 });
  const long = await stressCenters(nodes, [{ source: 'a', target: 'b', length: 300 }, { source: 'b', target: 'c' }], { edgeLength: 100, iterations: 50 });
  assert.equal(even.size, 3);
  assert.ok(distance(long, 'a', 'b') > distance(even, 'a', 'b') * 1.5, 'the longer desired length spreads that pair');
  assert.deepEqual(await stressCenters(nodes, [{ source: 'a', target: 'b' }], { edgeLength: 100 }), await stressCenters(nodes, [{ source: 'a', target: 'b' }], { edgeLength: 100 }));
});

test('renderDocument returns SVG text or PNG bytes', async () => {
  const parsed = parseDocument(JSON.stringify(minimalV2));
  const svg = await renderDocument(parsed, 'svg');
  assert.match(svg.toString('utf8'), /^<svg /);
  const png = await renderDocument(parsed, 'png', { scale: 1 });
  assert.deepEqual([...png.subarray(1, 4)], [...Buffer.from('PNG')]);
});
