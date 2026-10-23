import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../dist/model/parse.js';
import { exportDocument, importText } from '../dist/formats/index.js';
import { ROUND_TRIP, aliasIds, examples, roundTrip, sorted } from './format-helpers.mjs';
import { CANONICAL, LOSSES } from './format-losses.mjs';

// Round trips over every example of every kind a format imports: model ->
// text -> model must give the same model, apart from the losses docs/formats.md
// documents for that format and kind (applied to the original by LOSSES), and
// exporting the imported model again must give the same text (a fixpoint).

/**
 * Examples whose round trip cannot give a valid model because the format has no
 * way to write one of their relationships (docs/formats.md, "Lossy cases"): the
 * export must warn about it at `path`, and the import must then fail validation
 * with `code` rather than produce a different, wrong model.
 */
const LIMITS = {
  'plantuml state-machine/notation.json': { path: '/transitions/7', code: 'FORK_DEGREE', why: 'a fork into the second orthogonal region of a composite state' },
};

for (const [format, kinds] of Object.entries(ROUND_TRIP)) {
  for (const kind of kinds) {
    for (const { name, text } of await examples(kind)) {
      const limit = LIMITS[`${format} ${name}`];
      if (limit) {
        test(`${format} round trip of ${name} reports ${limit.why} as a loss and the import as invalid`, () => {
          const exported = exportDocument(parseDocument(text), format);
          assert.ok(exported.warnings.some(w => w.code === 'EXPORT_LOSSY' && w.path === limit.path), JSON.stringify(exported.warnings));
          assert.throws(() => importText(exported.text, format), e => e.code === 'IMPORT_INVALID' && e.diagnostics.some(d => d.code === limit.code));
        });
        continue;
      }
      test(`${format} round trip keeps every element, relationship and name: ${name}`, () => {
        const { original, exported, imported } = roundTrip(text, format);
        const expected = LOSSES[format][kind](aliasIds(structuredClone(original), format));
        const canonical = CANONICAL[kind] ?? (m => m);
        assert.deepEqual(sorted(canonical(structuredClone(imported))), sorted(canonical(expected)));
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
