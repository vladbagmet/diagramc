import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { kinds } from '../dist/model/registry.js';
import { exportDocument, formatSupport, importText } from '../dist/formats/index.js';
import { checkMermaid } from './mermaid-check.mjs';
import { cli, root, workspace } from './helpers.mjs';
import { ROUND_TRIP, aliasIds, examples, roundTrip, sorted } from './format-helpers.mjs';
import { CANONICAL, LIMITS, LOSSES } from './format-losses.mjs';

// Round trips over every example of every kind a format imports: model ->
// text -> model must give the same model, apart from the losses docs/formats.md
// documents for that format and kind (applied to the original by LOSSES), and
// exporting the imported model again must give the same text (a fixpoint).

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
        const canonical = CANONICAL[`${format} ${kind}`] ?? CANONICAL[kind] ?? (m => m);
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

// Every Mermaid export passes the structural check, every PlantUML export is
// one diagram whose lines cannot become directives, for every example of every
// kind (PlantUML itself checks the exports in test/integration/formats.test.mjs).

for (const { kind } of kinds) {
  test(`every ${kind} example exports to well-formed text in each format it supports`, async () => {
    const support = formatSupport(kind);
    assert.ok(support.exports.includes('plantuml'), 'every kind exports to PlantUML');
    for (const { name, text } of await examples(kind)) {
      const parsed = parseDocument(text);
      const puml = exportDocument(parsed, 'plantuml').text.split('\n');
      assert.equal(puml[0], '@startuml', name);
      assert.equal(puml.filter(l => /^\s*@(?:start|end)uml/u.test(l)).length, 2, `${name}: one diagram`);
      assert.deepEqual(puml.filter(l => /^\s*!/u.test(l)), [], `${name}: no preprocessor lines`);
      if (support.exports.includes('mermaid')) {
        const problems = checkMermaid(exportDocument(parsed, 'mermaid').text);
        assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
      } else {
        assert.throws(() => exportDocument(parsed, 'mermaid'), e => e.code === 'UNSUPPORTED_EXPORT' && e.details.formats.includes('plantuml') && e.message.includes(kind));
      }
    }
  });
}

test('the formats each kind exports to and imports from', () => {
  assert.deepEqual(Object.fromEntries(kinds.map(k => [k.kind, formatSupport(k.kind)])), {
    class: { exports: ['plantuml', 'mermaid'], imports: ['plantuml', 'mermaid'] },
    object: { exports: ['plantuml'], imports: [] },
    package: { exports: ['plantuml'], imports: [] },
    profile: { exports: ['plantuml'], imports: [] },
    communication: { exports: ['plantuml'], imports: [] },
    'interaction-overview': { exports: ['plantuml'], imports: [] },
    component: { exports: ['plantuml'], imports: [] },
    deployment: { exports: ['plantuml'], imports: [] },
    'composite-structure': { exports: ['plantuml'], imports: [] },
    sequence: { exports: ['plantuml', 'mermaid'], imports: ['plantuml', 'mermaid'] },
    timing: { exports: ['plantuml'], imports: [] },
    activity: { exports: ['plantuml', 'mermaid'], imports: ['plantuml'] },
    'state-machine': { exports: ['plantuml', 'mermaid'], imports: ['plantuml', 'mermaid'] },
    'use-case': { exports: ['plantuml', 'mermaid'], imports: ['plantuml'] },
  });
});

// Text written by hand, in the style of each format's documentation: the
// importer reads the common subset and infers the kind from the content.

const HAND_WRITTEN = [
  ['plantuml', 'class', `@startuml
' a comment
skinparam classAttributeIconSize 0
abstract class Animal {
  -name : String
  {abstract} +speak() : String
}
interface Pet
class Dog
Animal <|-- Dog
Dog ..|> Pet
Dog "1" *-- "4" Leg : has >
Dog : +fetch(item : Ball) : Boolean
@enduml`],
  ['plantuml', 'sequence', `@startuml
actor User
participant "Web Shop" as shop
User -> shop ++ : order(item)
shop -->> User -- : confirmation
alt paid
  shop ->> User : receipt
else not paid
  shop ->> User : reminder
end
@enduml`],
  ['plantuml', 'state-machine', `@startuml
[*] --> Idle
state Idle : entry / reset
Idle --> Running : start [ready] / log
state Running {
  [*] --> Fast
  Fast --> Slow : brake
}
Running --> [*] : stop
@enduml`],
  ['plantuml', 'use-case', `@startuml
left to right direction
actor :Customer: as c
rectangle Shop {
  usecase (Checkout) as checkout
  (Pay)
}
c -- checkout
checkout ..> (Pay) : <<include>>
@enduml`],
  ['plantuml', 'activity', `@startuml
start
:Receive order;
if () then ([in stock])
  :Ship;
else ([out of stock])
  :Reorder;
endif
stop
@enduml`],
  ['mermaid', 'class', `---
title: Animals
---
classDiagram
  %% a comment
  class Animal {
    <<abstract>>
    +name : String
    +speak()* : String
  }
  Animal <|-- Dog
  Dog : +fetch() : Boolean
  note for Dog "Good boy"`],
  ['mermaid', 'sequence', `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>+B: Hello Bob, how are you?
  B-->>-A: Great!
  loop every minute
    A-)B: ping
  end`],
  ['mermaid', 'state-machine', `stateDiagram-v2
  [*] --> Still
  Still --> Moving : push
  Moving --> Still : stop
  state Moving {
    [*] --> Slow
    Slow --> Fast : speed up
  }
  Moving --> [*] : crash`],
];

for (const [format, kind, source] of HAND_WRITTEN) {
  test(`${format} import reads hand-written ${kind} text and infers its kind`, () => {
    const { model, parsed } = importText(source, format);
    assert.equal(model.kind, kind);
    assert.equal(parsed.kind.kind, kind);
  });
}

test('import never guesses: unsupported constructs and malformed lines are reported, each with its line', () => {
  const errorOf = (text, format, kind) => { try { importText(text, format, kind); } catch (e) { return e; } assert.fail('expected an error'); };
  let e = errorOf('@startuml\nstart\nif (paid?) then (yes)\n  :Ship;\nendif\nstop\n@enduml', 'plantuml', 'activity');
  assert.ok(e.diagnostics.some(d => d.code === 'UNSUPPORTED_SYNTAX' && d.details.line === 3 && /question text/u.test(d.message)), JSON.stringify(e.diagnostics));
  e = errorOf('sequenceDiagram\n  participant A\n  A->>B: hi\n  box Purple\n  end', 'mermaid');
  assert.deepEqual(e.diagnostics.map(d => [d.code, d.details.line]), [['MALFORMED_LINE', 3], ['UNSUPPORTED_SYNTAX', 4], ['MALFORMED_LINE', 5]]);
  e = errorOf('flowchart LR\n  a --> b', 'mermaid');
  assert.equal(e.code, 'UNSUPPORTED_SYNTAX');
  assert.match(e.message, /flowchart/u);
  e = errorOf('@startuml\n!include foo.puml\nclass A\n@enduml', 'plantuml');
  assert.ok(e.diagnostics.some(d => d.details.line === 2 && /preprocessor/u.test(d.message)));
});

test('a model that reads but breaks a rule fails with IMPORT_INVALID, pointing into the model it carries', () => {
  const source = '@startuml\nclass A\ninterface I\nI --|> A\n@enduml';
  let error;
  try { importText(source, 'plantuml'); } catch (e) { error = e; }
  assert.equal(error?.code, 'IMPORT_INVALID');
  assert.equal(error.details.kind, 'class');
  assert.equal(error.details.model.elements.length, 2);
  assert.ok(error.diagnostics.every(d => d.path.startsWith('/')));
});

test('uml export and uml import on the command line', async t => {
  const dir = await workspace(t);
  // stdout, with the format named
  let r = cli(['export', join(root, 'examples/class/minimal.json'), '--to', 'plantuml']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^@startuml\n/u);
  // -o with the format inferred from the extension, losses on stderr
  r = cli(['export', join(root, 'examples/class/notation.json'), '-o', join(dir, 'n.mmd')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(join(dir, 'n.mmd'), 'utf8'), /^---\ntitle: "Notation reference"\n---\nclassDiagram\n/u);
  const { warnings } = JSON.parse(r.stderr);
  assert.ok(warnings.length && warnings.every(w => w.code === 'EXPORT_LOSSY' && w.path.startsWith('/')));
  // a kind Mermaid cannot draw
  r = cli(['export', join(root, 'examples/timing/door.json'), '--to', 'mermaid']);
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stderr).error.code, 'UNSUPPORTED_EXPORT');
  assert.equal(r.stdout, '');
  // usage errors
  for (const args of [['export', join(root, 'examples/class/minimal.json')], ['export', join(root, 'examples/class/minimal.json'), '--to', 'xmi'], ['import', '-']]) {
    r = cli(args, { input: '' });
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(JSON.parse(r.stderr).error.code, 'USAGE');
  }
  // import: --from inferred from .mmd, -o written, the model validates
  r = cli(['import', join(dir, 'n.mmd'), '-o', join(dir, 'n.json')]);
  assert.equal(r.status, 0, r.stderr);
  r = cli(['validate', join(dir, 'n.json')]);
  assert.equal(r.status, 0, r.stderr);
  // import from stdin with --from, onto stdout
  r = cli(['import', '-', '--from', 'plantuml'], { input: '@startuml\nclass A\nclass B\nA --> B\n@enduml\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).kind, 'class');
  // --kind when the text alone does not tell
  r = cli(['import', '-', '--from', 'plantuml', '--kind', 'sequence'], { input: '@startuml\nparticipant A\nparticipant B\nA -> B : hi\n@enduml\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).kind, 'sequence');
  r = cli(['import', '-', '--from', 'mermaid', '--kind', 'timing'], { input: 'sequenceDiagram\n' });
  assert.equal(JSON.parse(r.stderr).error.code, 'UNSUPPORTED_IMPORT');
  // unreadable lines: one error object with every problem
  r = cli(['import', '-', '--from', 'plantuml'], { input: '@startuml\nclass A\nA ~~ B\nstruct S\n@enduml\n' });
  assert.equal(r.status, 2);
  assert.deepEqual(JSON.parse(r.stderr).error.diagnostics.map(d => d.path), ['/lines/3', '/lines/4']);
});

test('uml kinds lists the formats, and the help describes export and import', () => {
  const listed = JSON.parse(cli(['kinds']).stdout);
  assert.deepEqual(listed.find(k => k.kind === 'class').exports, ['plantuml', 'mermaid']);
  assert.deepEqual(listed.find(k => k.kind === 'timing').imports, []);
  const help = cli(['--help']).stdout;
  assert.match(help, /uml export <model\.json\|->/u);
  assert.match(help, /uml import <diagram\.puml\|diagram\.mmd\|->/u);
  for (const command of ['export', 'import']) {
    const r = cli([command, '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(`^Usage: uml ${command} `, 'u'));
  }
});
