import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../dist/model/parse.js';
import { exportDocument, importText } from '../dist/formats/index.js';
import { ROUND_TRIP, aliasIds, examples, roundTrip, sorted } from './format-helpers.mjs';
import { LOSSES } from './format-losses.mjs';

// Round trips over every example of every kind a format imports: model ->
// text -> model must give the same model, apart from the losses docs/formats.md
// documents for that format and kind (applied to the original by LOSSES), and
// exporting the imported model again must give the same text (a fixpoint).

for (const [format, kinds] of Object.entries(ROUND_TRIP)) {
  for (const kind of kinds) {
    for (const { name, text } of await examples(kind)) {
      test(`${format} round trip keeps every element, relationship and name: ${name}`, () => {
        const { original, exported, imported } = roundTrip(text, format);
        const expected = LOSSES[format][kind](aliasIds(structuredClone(original), format));
        assert.deepEqual(sorted(imported), sorted(expected));
        const again = exportDocument(parseDocument(JSON.stringify(imported)), format);
        assert.equal(again.text, exported.text, 'exporting the imported model gives the same text');
      });
    }
  }
}

test('import reports every unsupported and malformed line at once, with line numbers', () => {
  const source = ['@startuml', 'class A {', '  +ok() : Boolean', '}', 'struct S', 'A --> B : uses', 'A ~~~ B', 'package P {', '}', '@enduml'].join('\n');
  let error;
  try { importText(source, 'plantuml'); } catch (e) { error = e; }
  assert.ok(error, 'expected an error');
  assert.deepEqual(error.diagnostics.map(d => [d.code, d.path, d.details.line]), [
    ['UNSUPPORTED_SYNTAX', '/lines/5', 5],
    ['UNSUPPORTED_SYNTAX', '/lines/7', 7],
    ['UNSUPPORTED_SYNTAX', '/lines/8', 8],
    ['MALFORMED_LINE', '/lines/9', 9],
  ]);
});
