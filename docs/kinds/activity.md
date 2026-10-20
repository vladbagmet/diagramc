# Activity diagram: notation checklist

Backend: PlantUML 1.2025.10, new activity syntax (its dedicated activity engine; no
Graphviz, no Smetana). Frame keyword: `act`. Schema: `uml schema activity`.
Code: `src/kinds/activity/`. UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `unit` = `test/activity.test.mjs` (no Java), `integration` =
`test/integration/activity.test.mjs` (real PlantUML); fixtures in
`test/fixtures/activity/`. Every fixture and example passes every QA gate with none
skipped: `src/qa/plantuml-activity.ts` reads PlantUML's flat activity SVG (shapes by
theme color, flow lines chained into edges, open arrowheads as markers, guards as
labels), so the edge, marker and label gates evaluate the real output.

## How a flow graph becomes PlantUML

PlantUML's activity syntax is structured (`switch`, `fork`, `while`, `repeat`), so
`structure.ts` recovers the structure of the JSON graph before anything is drawn:

- a decision closes at the merge node all its continuing branches reach; branches
  that end in final nodes need no merge. A two-way decision is `if` ... `else` ...
  `endif`, which keeps each guard at its own branch and lets branches go to other
  swimlanes; a decision with more than two branches is `switch` ... `endswitch`,
  whose branches must stay in the decision's swimlane (PlantUML loses the flows
  and guards of a case that changes swimlane), so such a model is rejected with
  `DECISION_SPANS_PARTITIONS`, whose message spells out the equivalent nested
  two-way decisions (new decision and merge IDs, partitions and guards);
- with swimlanes, PlantUML draws the branches of a decision or fork side by side
  within every swimlane they use. Each branch must therefore occupy its own run of
  adjacent partitions (neighbouring branches may share one partition at their
  boundary); branches whose partitions interleave, for example two branches that
  both use partitions 1 to 3, would have their flows drawn through each other's
  diamonds and are rejected with `BRANCHES_SHARE_PARTITIONS`. Branches are emitted
  in the left-to-right order of their partitions;
- a fork closes at the join all its branches reach (`fork` ... `end fork`);
- a loop enters at a merge node that receives a returning flow and leaves through
  exactly one flow of a two-way decision: test first is `while`, test last is
  `repeat ... repeat while`, and one action on the returning flow is `backward`.
  PlantUML drops the is/not labels of `repeat while` with plain diamonds and in
  swimlanes, so the returning guard is the condition beside the diamond and the
  leaving guard labels the next flow (`->[guard];`);
- a decision whose other branches all terminate has no merge in the model; the one
  continuing branch then carries the rest of the flow, so PlantUML draws no merge
  diamond that the model does not have.

Graphs that are not well structured (a merge shared by two decisions, a loop with
two exits, a loop with nodes both before and after its decision, branches that
meet at a join instead of a merge) are rejected with `UNSTRUCTURED_FLOW` and the
JSON path of the node where the structure breaks. PlantUML's `goto`/`label`
extension is not used: it is experimental and draws unlabeled connectors. Implicit
forks and merges (an action with several outgoing or incoming flows) are rejected
too (`IMPLICIT_FORK`, `IMPLICIT_MERGE`): explicit control nodes keep the drawing
and the semantics unambiguous.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Opaque action | `nodes[].type = "action"` | Rounded rectangle with the name, wrapped at 260 px at natural break points (16.2.4) | integration: "UML 2.5.1 notation of every construct" (type `action`, rounded rect) |
| Call behavior action | `type: "callBehavior"` | Rounded rectangle with the rake symbol in the lower right corner (16.3.4) | unit: "post-processor draws open arrowheads, drops mid-line arrows and adds the rake"; integration: rake path present |
| Send signal action | `type: "sendSignal"` | Convex pentagon (16.3.4) | integration: `signal` node, five-point polygon |
| Accept event action | `type: "acceptEvent"` | Rectangle with a concave notch on the left (16.10.4); PlantUML's notch on the right is mirrored | unit: post-processor test; integration: notch point inside the left edge |
| Object node | `type: "object"`, `state` | Rectangle with the type name and `[state]` below it (15.4.4) | integration: `object` node with `[complete]` |
| Initial node | `type: "initial"` | Filled circle (15.3.4) | integration: one filled circle r=10 |
| Activity final | `type: "activityFinal"` | Circle with a filled inner circle (15.3.4) | integration: bull's eye |
| Flow final | `type: "flowFinal"` | Circle with an X (15.3.4) | integration: three circles in the notation example |
| Decision / merge | `type: "decision"` / `"merge"` | Diamond; guards `[g]` on the flows leaving a decision; a merge directly followed by a loop decision is drawn as one combined diamond (15.3.4 allows this) | integration: diamonds and guard labels; unit: "flow graphs become structured blocks" |
| Fork / join | `type: "fork"` / `"join"` | Thick bar spanning its flows plus 16 px (15.3.4); PlantUML's bars across the whole block are trimmed | integration: two bars, overhang at most 16 px |
| Control flow, object flow | `edges[].type` (optional: object flow when an end is an object node) | Solid line with an open arrowhead at the target (15.2.4); PlantUML's filled, notched heads are rewritten to open heads | integration: every flow's target marker is `open-arrow`, no filled heads |
| Guard | `edges[].guard` | `[guard]` next to the flow | integration: guards are labels |
| Loops | merge + decision + returning flow | Merge diamond, decision diamond, returning flow with its guard | unit: while/repeat/backward; fixtures "while loop", "repeat loop", "loop with an action on the returning flow" |
| Partitions | `partitions`, `nodes[].partition` | Swimlanes left to right in input order, bold names (15.6.4) | integration: "partitions are swimlanes in input order with bold names" |
| Note | `note` on an executable node | Rectangle with a folded corner next to the node, attached by a dashed line (7.2.4); PlantUML's speech-bubble pointer is removed | integration: one `note` node and its dashed anchor |
| Diagram frame | `title` | Frame with pentagon heading **act** name (Annex A) | integration: frame label `act` bold |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across partitions, nodes and edges | `/nodes/2/id`, `/edges/0/id` |
| MISSING_REFERENCE | edge ends and partitions exist | `/edges/1/to`, `/nodes/1/partition` |
| MISSING_PARTITION | with partitions, every node except merge/join names one | `/nodes/0/partition` |
| MISSING_INITIAL_NODE, MULTIPLE_INITIAL_NODES | exactly one initial node | `/nodes`, `/nodes/1` |
| INITIAL_NODE_HAS_INCOMING | no flow into the initial node | `/edges/2/to` |
| FINAL_NODE_HAS_OUTGOING | no flow out of activity or flow finals | `/edges/2/from`, `/edges/1/from` |
| MISSING_GUARD, DUPLICATE_GUARD | every flow leaving a decision has a guard, distinct per decision | `/edges/2/guard` |
| UNEXPECTED_GUARD | guards only on flows leaving a decision | `/edges/0/guard` |
| DECISION_DEGREE, MERGE_DEGREE, FORK_DEGREE, JOIN_DEGREE | 1 in / 2+ out, 2+ in / 1 out, 1 in / 2+ out, 2+ in / 1 out | `/nodes/1`, `/nodes/4` |
| IMPLICIT_FORK, IMPLICIT_MERGE | other nodes have at most one outgoing and one incoming flow | `/edges/2/from`, `/edges/3/to` |
| MISSING_OUTGOING_FLOW | every non-final node has an outgoing flow | `/nodes/1` |
| UNREACHABLE_NODE | every node is reachable from the initial node | `/nodes/3` |
| INVALID_OBJECT_FLOW | an object flow touches an object node or a control node, never the initial node | `/edges/1/type`, `/edges/0/type` |
| INVALID_CONTROL_FLOW | flows into or out of object nodes are object flows | `/edges/1/type` |
| UNSTRUCTURED_FLOW | the graph is well structured (see above) | `/nodes/1`, `/nodes/3` |
| DECISION_SPANS_PARTITIONS | a decision with more than two branches keeps them in its own partition | `/nodes/1/partition` |
| BRANCHES_SHARE_PARTITIONS | with partitions, the branches of a decision or fork occupy separate runs of adjacent partitions (they may share one boundary partition) | `/nodes/1` |
| SCHEMA_INVALID, INVALID_TEXT, UNKNOWN_KIND | shared rules | see `invalid.json` |

## Unsupported (rejected by the schema)

- Pins (input and output pins on actions): PlantUML cannot draw them; model the
  data as an object node between the actions (the standalone pin notation).
- Interruptible activity regions and interrupting edges, exception handlers,
  expansion regions, activity parameter nodes, central buffer and data store nodes,
  accept time event (hourglass), weights and edge names other than guards.
- Decision input text inside the diamond (`«decisionInput»`): guards carry the
  conditions.
- Unstructured flows (see above) and implicit forks and merges.
- Nested partitions and horizontal swimlanes.

## Known limitations

- Notes are attached with PlantUML's pointer (a speech-bubble corner) instead of a
  dashed anchor line.
- PlantUML lays swimlanes out with full-height lines and leaves the lane height of
  the tallest lane; cross-lane flows are horizontal lines. Branch order follows the
  partitions of each branch (see `BRANCHES_SHARE_PARTITIONS`). A join is drawn in
  its fork's partition; fork and join bars are lengthened so every branch leaves or
  enters a bar straight, so a bar may cross a swimlane border.
- PlantUML places guards of narrow loops across the return line; the post-processor
  moves such labels beside the line, opening a column for them inside a narrow
  swimlane when needed (lane titles then stay where PlantUML put them).
- Action and object names are not wrapped (PlantUML would split them into separate
  text elements); they are single-line, at most 100 characters.
- The rake and open arrowheads are drawn by a post-processor on PlantUML's SVG
  (`postprocess.ts`); it only rewrites PlantUML's own primitives.
