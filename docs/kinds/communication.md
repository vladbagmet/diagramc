# Communication diagram: notation checklist

Backend: own engine. Frame keyword: `sd` (a communication diagram shows an
interaction; UML 2.5.1 Annex A and figure 17.25). Schema: `uml schema communication`.
Code: `src/kinds/communication/`. UML references are to UML 2.5.1 (formal/17-12-05),
clause 17.9 unless noted.

Tests referenced below: `comm` = `test/communication.test.mjs`, `engine` =
`test/engine.test.mjs`; fixtures in `test/fixtures/communication/`; examples in
`examples/communication/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Lifeline | `lifelines[]` with `name` and/or `type` | Rectangle with `name : Type`, `name` or `: Type`; not underlined (UML 2 lifeline, 17.3.4) | comm: "label formats ..." and "UML notation of lifelines ..." (no underline) |
| Selector | `selector` (needs `name`) | `name[selector] : Type` (17.3.4) | comm: `w[k] : Worker` |
| Set of instances (multi-object) | `multiObject: true` | Two stacked rectangles; kept from UML 1.x because it is still widely read, a selector is the strict UML 2.5.1 alternative | comm: "UML notation ..." (`multi-object`, two rectangles) |
| Link (connector) | `links[]`, `from`/`to` (undirected) | Solid line between the lifeline rectangles, no arrowheads (17.9.3) | comm: links solid, markers `none` |
| Self-link | link with `from` = `to` | Rectangular loop at a free corner of the lifeline | comm: self-link has 5 points from and to `session`; fixtures "self-link only", "hub with self-link and every side used" |
| Message | `messages[]`, `from` = sender, `to` = receiver | Label beside the link with a short arrow parallel to the link pointing at the receiver (17.9.4) | comm: arrows source/target; engine: gate `message-arrows` |
| Synchronous call | `sort: "synchronous"` (default) | Filled arrowhead, solid line (17.4.4) | comm: `filled-triangle`, not dashed |
| Asynchronous signal | `sort: "asynchronous"` | Open arrowhead, solid line (17.4.4) | comm: `open-arrow`, not dashed |
| Reply | `sort: "reply"` | Open arrowhead, dashed line (17.4.4) | comm: `open-arrow`, dashed |
| Grouping | automatic | One arrow per link, direction and sort; its messages stacked beside it in sequence order. Forward messages left of the link direction, backward ones right | comm: three arrows on `ui-session`, `1:` above `2:` |
| Sequence number | `sequence` | Decimal terms `1`, `1.2`, `1.2.1`, concurrent threads `1a`, `1b` (17.9.4 sequence-expression) | comm: "label formats ..." ordering; fixtures |
| Guard | `guard` | `seq [guard]: ...` (branch recurrence) | comm: `1.4 [not hit]: store(user)` |
| Iteration | `iteration`, `parallel` | `seq *[clause]: ...`, `seq *||[clause]: ...` (loop recurrence) | comm: `1.3 *||[i=1..n]: warmUp(n)` |
| Signature | `name`, `arguments`, `assignTo`, `returnValue` | `x = op(a, b)`; reply `op: value` (17.4.4 message label) | comm: "label formats ..." |
| Diagram frame | `title` | Frame with pentagon heading `sd <title>` (Annex A) | comm: frame heading check |

## Layout

ELK Stress places lifelines so linked ones are about one desired distance apart
(cycles become polygons, stars become wheels), the centers are snapped to a grid
and a local search on grid cells prefers short horizontal and vertical links,
then 45 degree diagonals, no link through a lifeline, few crossings and a compact
grid that is not much wider than tall. The grid is mirrored so that messages
mostly flow left to right and top to bottom. Gaps grow until every link fits its
message blocks, and again wherever a block touches a node, a line or another
block, or comes within 12 px of a foreign link. A layered layout was rejected:
links are undirected and a hierarchy would be invented. Proof: comm "horizontal
and vertical links dominate the grid layout"; engine "stress placement".

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across lifelines, links and messages | `/lifelines/1/id`, `/messages/0/id` |
| MISSING_REFERENCE | links and messages name existing lifelines | `/links/0/to`, `/messages/0/from` |
| LIFELINE_WITHOUT_NAME | a lifeline has a name, a type or both | `/lifelines/0` |
| SELECTOR_WITHOUT_NAME | a selector qualifies a name | `/lifelines/0/selector` |
| DUPLICATE_LINK | at most one link per pair of lifelines (either direction) | `/links/1` |
| MESSAGE_WITHOUT_LINK | every message travels on a link between sender and receiver, a self-message on a self-link | `/messages/0/to`, `/messages/1/to` |
| INVALID_SEQUENCE_NUMBER | positive integers with an optional lowercase thread letter, joined by "." | `/messages/0/sequence` (`0`, `1..2`, `1A`) |
| DUPLICATE_SEQUENCE_NUMBER | sequence numbers are unique | `/messages/1/sequence` |
| MISSING_PARENT_MESSAGE | `1.2` needs a message `1` | `/messages/1/sequence` |
| NESTED_SENDER_MISMATCH | a nested message is sent by the receiver of its parent (it is sent while the parent is handled) | `/messages/1/from` |
| SEQUENCE_GAP | siblings are numbered 1, 2, 3 ... and threads a, b, c ... without gaps | `/messages/1/sequence` |
| AMBIGUOUS_THREAD | a step is either one message (`1`) or concurrent threads (`1a`, `1b`), not both | `/messages/0/sequence` |
| INVALID_REPLY | a reply is nested in the synchronous call it answers and goes back to its caller | `/messages/0/sort`, `/messages/1/sort` |
| INVALID_RETURN_VALUE | only replies carry a return value | `/messages/0/returnValue` |
| INVALID_ASSIGNMENT | asynchronous signals return nothing to assign | `/messages/0/assignTo` |
| GUARD_WITH_ITERATION | a sequence term has one recurrence: a guard or an iteration | `/messages/0/iteration` |
| SCHEMA_INVALID | unknown properties, unknown sorts, `parallel` without `iteration`, missing `sequence` or `lifelines`, multi-line text | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/lifelines/0/name` |

All rules are errors. Every negative fixture asserts the exact code and path
(comm: "negative fixtures ...").

## QA gate added for this kind

`message-arrows` (`src/qa/gates.ts`): every message arrow has its arrowhead at
the tip pointing along the arrow, is parallel to a segment of its own link and
4 to 26 px beside it, points from sender to receiver along that link, touches no
line, node, label or other arrow, and its labels are within 12 px of it. Proof:
engine "QA gate message-arrows ...".

## Unsupported (rejected by the schema)

- Actors drawn as stick figures, `self` lifelines, decomposition (`ref` in the
  lifeline head): use a lifeline with a type.
- Predecessor lists (`A3, B4 / C3.1: ...`) and named thread prefixes: use thread
  letters and nesting.
- Creation and destruction messages, lost and found messages, signal arguments by
  name (`p = v`): write them in `name`/`arguments` as plain text.
- Link ends (role names, navigability) and stereotypes on links.
- Notes.

## Known limitations

- Self-links: when all four sides of a lifeline carry links, the loop returns 9 px
  above the middle of a side that also has a link.
- Very dense graphs (complete graphs, the stress example) get long diagonal links;
  labels stay unambiguous but the drawing is wide (the stress example is about
  2700 x 1150 px).
- A link that would cross a lifeline is detoured orthogonally; crossings between
  links are minimized, not forbidden.
