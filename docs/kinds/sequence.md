# Sequence diagram: notation checklist

Backend: PlantUML 1.2025.10 (classic sequence engine, `skinparam style strictuml`,
`hide footbox`). Frame keyword: `sd`. Schema: `uml schema sequence`. Code:
`src/kinds/sequence/`. UML references are to UML 2.5.1 (formal/17-12-05), clause 17.

Tests referenced below: `unit` = `test/sequence.test.mjs` (no Java: generated
source, validation, QA reader on a stored render), `integration` =
`test/integration/sequence.test.mjs` (real renders, every gate), `qa` = the
`message-endpoints` gate in `src/qa/plantuml-interaction.ts`, which runs on every
fixture and example. Fixtures: `test/fixtures/sequence/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Lifeline | `lifelines[]`: `name`, `classifier` | Rectangle head with `name : Classifier` (or `: Classifier`), dashed line below (17.3.4) | unit: "lifeline heads, symbols and message labels"; integration: "no footbox..." (one head per lifeline) |
| Actor lifeline | `symbol: "actor"` | Stick figure with the name below (17.3.4, 18.1.4) | unit: heads test; gallery `checkout`, `notation` |
| Boundary, control, entity | `symbol: "boundary" / "control" / "entity"` | Stereotype icons of the standard robustness profile, name below | unit: heads test; gallery `notation` |
| No repeated heads at the bottom | (always) | UML draws heads only at the top | unit: `hide footbox` in the source; integration: no `participant-tail` |
| Synchronous message | `sort: "synchronous"` | Solid line, filled arrowhead (17.4.4) | integration: "arrowheads and line styles per message sort" (`filled`, not dashed) |
| Asynchronous message | `sort: "asynchronous"` | Solid line, open arrowhead | integration: same test (`open`, not dashed) |
| Reply | `sort: "reply"`, `assignment`, `returnValue` | Dashed line, open arrowhead; label `x = name(args) : value` | integration: same test (`open`, dashed); unit: label `x = get() : Item` |
| Create message | `sort: "create"` | Dashed line, open arrowhead ending on the head of the created lifeline, drawn at that height | integration: same test (tip on the created head's border) |
| Delete message and destruction | `sort: "delete"`; `type: "destroy"` | Message ending in an X; the lifeline ends at the X (17.3.4) | integration: same test (X at the message, lifeline bottom at the X); unit: post-processing test |
| Found message | `type: "found"` | Filled circle at the start | integration: same test; qa |
| Lost message | `type: "lost"` | Filled circle at the end | integration: same test; qa |
| Self-message | `from` = `to` | Loop back to the same lifeline | unit: QA reader test (three-segment loop); integration fixture "every message sort and symbol" |
| Message label | `name`, `arguments` | `name(a, b)`; `name()` for an empty list; bare name without `arguments` (17.4.4) | unit: heads and labels test |
| Activation (execution specification) | `activate`/`deactivate` items, or `activate: true` / `deactivate: true` on messages | Thin rectangle on the lifeline; nested ones offset to the right (17.2.4) | integration: "nested activations offset"; qa (arrows end on bar borders) |
| Combined fragment | `type: "fragment"`, `operator` | Frame with the operator in a pentagon at the top left (17.6.4) | integration: "fragments, guards, interaction use..."; unit: generated `alt`/`group` lines |
| Operands and guards | `operands[]`, `guard` | Regions separated by dashed lines; guard `[condition]` at the top of its operand | integration: guards present; unit: `else` lines |
| Operators | `alt`, `opt`, `loop`, `par`, `break`, `critical`, `neg`, `strict`, `seq`, `assert` | Operator keyword in bold in the pentagon (17.6.3) | integration fixture "every operator"; gallery `notation` |
| Loop bounds | `min`, `max` (`"*"` allowed) | `loop(min,max)` in the pentagon, guard separate | unit: `group loop(1,3) [more]`; integration: `loop(1,3)` text |
| Interaction use | `type: "ref"`, `covered`, `name`, `arguments` | Frame with `ref` pentagon spanning the covered lifelines, `Name(args)` centered (17.7.4) | integration: `ref` and `FindUser(name)` drawn; unit: `ref over` line |
| State invariant | `type: "stateInvariant"`, `constraint` | Constraint in braces on the lifeline (17.2.4) | integration: `{open}` drawn; unit: `rnote ... {x > 0}` |
| Note | `type: "note"`, `position` over/left/right | Rectangle with folded corner (7.2.4) | unit: note block lines; gallery `checkout`, `notation` |
| Autonumber | `autonumber: true` | Sequence number before each message label | unit: `autonumber` in the source; gallery `stress` |
| Diagram frame | `title` | Frame with pentagon heading `sd <title>`, `sd` bold, filled like the own engine's frames (Annex A) | integration: frame labels `sd` (bold) and the title; filled pentagon |
| Long text | any label | Wrapped at word boundaries into generated, separately encoded lines | unit: "long labels are wrapped..."; integration fixture "long labels wrap" |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across lifelines and item IDs | `/lifelines/1/id`, `/items/0/id` |
| MISSING_REFERENCE | messages, notes, interaction uses, activations name declared lifelines | `/items/0/to`, `/items/0/operands/0/items/0/from`, `/items/0/lifelines/0`, `/items/0/covered/1`, `/items/0/lifeline` |
| LIFELINE_NAME_REQUIRED | a lifeline has a name, a classifier or both | `/lifelines/1` |
| LIFELINE_USED_BEFORE_CREATION | a created lifeline takes no part before its create message (also not in an earlier alternative) | `/items/0/to`, `/items/0/lifelines/0`, `/items/0/operands/1/items/0/to` |
| LIFELINE_ALREADY_CREATED | at most one create message per lifeline | `/items/1/to` |
| LIFELINE_DESTROYED | nothing refers to a lifeline after its destruction (in document order, across alternatives) | `/items/2/to`, `/items/1/from`, `/items/1/lifeline`, `/items/0/operands/1/items/0/to` |
| INVALID_SELF_MESSAGE | no lifeline creates or deletes itself with a message | `/items/0/to` |
| DEACTIVATION_WITHOUT_ACTIVATION | a deactivation ends an open activation | `/items/1`, `/items/0/deactivate` |
| ACTIVATION_NOT_CLOSED | every activation ends | `/items/0/activate`, `/items/0` |
| ACTIVATION_CROSSES_FRAGMENT | an activation ends in the operand where it starts | `/items/1/operands/0/items/0/deactivate`, `/items/0/operands/0/items/0/activate` |
| FRAGMENT_OPERAND_COUNT | alt: one or more operands; par, strict, seq: two or more; others exactly one | `/items/0/operands` |
| INVALID_LOOP_BOUNDS | bounds only on loop; `max` needs `min`; `min <= max`; `max > 0` | `/items/0/max`, `/items/0/min` |
| MISPLACED_ELSE | the `else` guard is on the last alt operand | `/items/0/operands/0/guard` |
| FRAGMENT_TOO_DEEP | fragments nest at most 8 deep | path of the 9th nested fragment |
| TOO_MANY_ITEMS | at most 400 items including nested ones | unit: generated document, `/items/1/operands/0/items/148` |
| NOTE_LIFELINE_COUNT | a note left or right of names exactly one lifeline | `/items/0/lifelines` |
| DUPLICATE_REFERENCE | a lifeline is listed once per note or interaction use | `/items/0/covered/1` |
| REF_COVERAGE_GAP | an interaction use covers adjacent live lifelines (PlantUML spans every column in between) | `/items/0/covered` |
| MESSAGE_NAME_REQUIRED | synchronous and asynchronous messages are named; arguments, assignment and return value need a name | `/items/0/name` |
| REPLY_ONLY_PROPERTY | `assignment` and `returnValue` only on replies | `/items/0/returnValue`, `/items/0/assignment` |
| LABEL_TOO_LONG | a drawn label fits 200 UTF-16 code units (PlantUML rejects source lines above about 2 KB) | `/items/0`, `/lifelines/0`, `/items/0/operands/0/guard` |
| SCHEMA_INVALID | unknown properties, unknown sorts, operators or symbols, `deactivate` on a found message, `activate` on a lost message, empty operands, missing `items`, multi-line text | see `invalid.json` |
| INVALID_TEXT | blank text, bidi controls, unpaired surrogates | `/lifelines/0/name`, `/items/0/operands/0/guard` |

## QA on PlantUML output

`readSequence` in `src/qa/plantuml-interaction.ts` classifies PlantUML's SVG:
participant head groups, lifeline and activation groups, message groups (line,
filled or open arrowhead, found/lost circle), and the loose primitives in
between (created heads, notes, state invariants, interaction uses, fragment
frames, destruction crosses). Wrapped lines are merged back into one text per
input string. Evaluated gates: `safe-markup`, `inside-canvas`, `node-overlap`
(heads, notes, interaction uses, invariants), `label-overlap` (message labels,
operators, guards), `label-edge-crossing` (labels against message lines),
`literal-text`, `min-font-size`, `text-fits`, `message-endpoints`. Skipped (no
data in this kind): `label-proximity`, `edge-endpoints`, `markers`, `ports`;
`message-endpoints` replaces the last two.

## PlantUML deviations fixed by the generator or post-processing

- Default arrowheads are notched; `strictuml` gives UML's filled triangle and open arrowheads.
- PlantUML repeats the heads at the bottom (footbox); hidden.
- The reply arrow `-->` has a filled head; replies and create messages use `-->>` (open).
- A destroyed lifeline continues below its X; post-processing ends it at the X and draws both X styles (destroy item, delete message) 2 px wide.
- The X reaches 9 px below its message and would touch the border of a fragment it ends; a destruction that ends an operand or the diagram is followed by 12 px of space.
- A self-message that opens a nested activation starts 5 px right of its bar; post-processing attaches it.
- The `mainframe` heading is an unfilled polyline; it is closed and filled like the own engine's frame.
- State invariants use a borderless `rnote` in the background color, so they read as a constraint in braces on the lifeline, not as a note.
- Long notes are emitted in block form, one source line per wrapped line.

## Unsupported (rejected by the schema)

- `ignore` and `consider` operators: they need message-name lists PlantUML cannot draw in the operator heading.
- General ordering, duration and time constraints, gates on the frame border, decomposed lifelines (`ref` in a head), coregions, continuations: no PlantUML notation.
- Lifeline selectors (`items[2]`): put the selector in `name`.
- Message arguments as structured parameters: arguments are display text.

## Known limitations

- Layout is PlantUML's: guard texts are written right after the operator pentagon and may overlap an activation bar under them (readable, not overlapping other labels).
- A lost message extends to the right edge of the diagram and may leave the fragment that contains it.
- Nested fragments that end together have their bottom borders a few pixels apart.
- An interaction use is drawn across every lifeline column between the outermost covered lifelines; REF_COVERAGE_GAP rejects documents where that would include an uncovered live lifeline.
- Glyph shapes come from Java's rendering of the pinned Inter font; sizes and colors match the own engine.
