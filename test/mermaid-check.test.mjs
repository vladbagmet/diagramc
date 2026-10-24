import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMermaid } from './mermaid-check.mjs';

// Self-tests of the structural Mermaid check the format tests rely on.

const valid = {
  class: [
    '---',
    'title: "Shop #35;1"',
    '---',
    'classDiagram',
    '  class Order["Order"] {',
    '    +total() Money',
    '    <<entity>>',
    '  }',
    '  class Item',
    '  Order "1" *-- "*" Item : lines',
    '  note for Order "An #quot;order#quot;"',
  ].join('\n'),
  sequence: [
    'sequenceDiagram',
    '  participant a as Alice',
    '  actor b as Bob',
    '  a->>+b: hello(x)',
    '  alt ok',
    '    b-->>-a: done',
    '  else failed',
    '    b-)a: retry',
    '  end',
    '  Note over a,b: text',
  ].join('\n'),
  state: [
    'stateDiagram-v2',
    '  state "Idle" as idle',
    '  state c <<choice>>',
    '  state "Busy" as busy {',
    '    [*] --> work',
    '    --',
    '    [*] --> other',
    '  }',
    '  [*] --> idle',
    '  idle --> c : go [ready]',
    '  note right of idle : waiting',
  ].join('\n'),
  flowchart: [
    'flowchart TD',
    '  subgraph lane1 ["Lane"]',
    '    direction TB',
    '    start@{ shape: sm-circ }',
    '    act1("Do it")',
    '  end',
    '  start --> act1',
    '  act1 -->|"[ok]"| d{" "}',
    '  d --> fin@{ shape: fr-circ }',
  ].join('\n'),
};

for (const [name, text] of Object.entries(valid)) {
  test(`mermaid check accepts a valid ${name} diagram`, () => assert.deepEqual(checkMermaid(text), []));
}

test('mermaid check reports an unclosed block with its line', () => {
  assert.deepEqual(checkMermaid(['sequenceDiagram', 'participant a', 'loop again', 'a->>a: x'].join('\n')), ['line 3: "loop" is not closed']);
});

test('mermaid check reports a raw quote inside a quoted label', () => {
  assert.deepEqual(
    checkMermaid(['flowchart LR', 'a["say "hi""]'].join('\n')).map(p => p.slice(0, 7)),
    ['line 2:'],
  );
});

test('mermaid check reports an unknown statement', () => {
  assert.match(checkMermaid(['classDiagram', 'class A', 'A ~~~ B'].join('\n'))[0], /^line 3: not a classDiagram statement/u);
});

test('mermaid check reports an undeclared participant', () => {
  assert.deepEqual(checkMermaid(['sequenceDiagram', 'participant a', 'a->>b: x'].join('\n')), ['line 3: participant "b" is used before it is declared']);
});

test('mermaid check rejects "end" as a flowchart node ID', () => {
  assert.deepEqual(checkMermaid(['flowchart TD', 'a("x") --> end("y")'].join('\n')), ['line 2: "end" is a Mermaid keyword and cannot be a node ID']);
});

test('mermaid check reports else outside alt and a raw semicolon in a message', () => {
  assert.deepEqual(checkMermaid(['sequenceDiagram', 'participant a', 'else x', 'a->>a: one; two'].join('\n')), [
    'line 3: "else" outside alt',
    'line 4: raw ";" in message text',
  ]);
});
