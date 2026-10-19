# Interaction overview diagram: notation checklist

Backend: own engine. Frame keyword: `sd` (an interaction overview is an interaction;
UML 2.5.1 Annex A and figure 17.27, heading `sd <name> lifelines <list>`). Schema:
`uml schema interaction-overview`. Code: `src/kinds/interaction-overview/`. UML
references are to UML 2.5.1 (formal/17-12-05): clause 17.10 for the diagram,
15.3 for the control nodes and flows.

Tests referenced below: `iod` = `test/interaction-overview.test.mjs`, `engine` =
`test/engine.test.mjs`; fixtures in `test/fixtures/interaction-overview/`; examples
in `examples/interaction-overview/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Initial node | `type: "initial"` | Small filled circle (15.3.3) | iod: "UML notation of control nodes ..." |
| Activity final | `type: "final"` | Circle around a filled circle (15.3.3) | iod: two circles |
| Flow final | `type: "flow-final"` | Circle with an X (15.3.3) | iod: circle and crossing path |
| Decision, merge | `type: "decision"` / `"merge"` | Diamond; flows meet it at its vertices (15.3.3) | iod: polygon; flows end on a vertex |
| Fork, join | `type: "fork"` / `"join"` | Filled bar across the flow (15.3.3) | iod: filled rect, width > 5 x height |
| Control flow | `flows[]`, `from` -> `to` | Solid line, open arrowhead at the target (15.2.4) | iod: 13 flows, markers `none` / `open-arrow` |
| Guard | `flows[].guard` | `[guard]` next to the flow where it leaves the decision; next to the target when several branches share a vertex (15.2.4) | iod: guards are source end labels; fixture "decision with four branches" |
| Interaction use | `type: "interaction-use"`, `name`, `arguments` | Frame with `ref` in the pentagon, the referenced interaction's name centered, `Name(args)` (17.7.4) | iod: `ref` bold in the frame, `Wait(5 s)` |
| Inline interaction | `type: "interaction"`, `lifelines`, `messages` | Frame with `sd <name>`, lifeline heads `name : Type` with dashed lifelines, messages as horizontal arrows in list order, labels above them (17.10, 17.3.4, 17.4.4) | iod: "inline sd fragments ..." |
| Synchronous / asynchronous / reply message | `messages[].sort` | Filled arrowhead / open arrowhead / dashed line with open arrowhead (17.4.4) | iod: markers in list order, reply dashed |
| Self-message | message with `from` = `to` | Small loop right of the lifeline, label beside it | fixtures "fork into three inline interactions", "wide inline interaction" |
| Lifelines header | `lifelines: [":A", ":B"]` | Frame heading `sd <title> lifelines :A, :B` (figure 17.27) | iod: frame label `WithdrawCash lifelines :Customer, :ATM, :Bank` |
| Diagram frame | `title` | Frame with pentagon heading `sd <title>` (Annex A) | iod: frame heading; fixture "lifelines header without a title" |

## Layout

ELK Layered, top-down, orthogonal routing, like an activity diagram. Loop-back
flows (found by a depth-first search from the initial node) are given to ELK
reversed, so its layering follows the flow and loops return on the east side of
the decision and the merge instead of turning the diagram upside down. Control
nodes have fixed ports where the shape meets its bounding box (bottom of the
initial dot, top of the final circles, the four diamond vertices). Diamond
vertices are chosen from where the previous pass placed the neighbours (one branch
straight down, the leftmost west, the rightmost east) and the layout is repeated
until the choice is stable. Inline `sd` fragments use a small fixed layout (no
graph layout), with lifelines spaced so every message label fits between the
lifelines it connects.

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across nodes, flows, inline lifelines and messages | `/nodes/1/id`, `/nodes/1/lifelines/0/id` |
| MISSING_REFERENCE | flows name existing nodes; inline messages name lifelines of the same interaction | `/flows/0/to`, `/nodes/2/messages/0/to` |
| LIFELINE_WITHOUT_NAME | an inline lifeline has a name, a type or both | `/nodes/1/lifelines/0` |
| MISSING_INITIAL_NODE | exactly one initial node | `/nodes` |
| MULTIPLE_INITIAL_NODES | exactly one initial node (use a fork for concurrent starts) | `/nodes/1` |
| INITIAL_NODE_HAS_INCOMING | no flow into the initial node | `/flows/1/to` |
| FINAL_NODE_HAS_OUTGOING | no flow out of an activity final or flow final | `/flows/1/from` |
| SELF_FLOW | no flow from a node to itself (loop through a merge) | `/flows/1/to` |
| DUPLICATE_FLOW | at most one flow per ordered pair | `/flows/1` |
| INVALID_DECISION | one incoming, at least two outgoing flows | `/nodes/1` |
| MISSING_GUARD | every flow leaving a decision has a guard | `/flows/2` |
| DUPLICATE_GUARD | guards of one decision are distinct (`else` at most once) | `/flows/2/guard` |
| GUARD_OUTSIDE_DECISION | only flows leaving a decision carry guards (stricter than UML, which allows guards on any edge; it keeps overviews unambiguous) | `/flows/0/guard` |
| INVALID_MERGE | at least two incoming, one outgoing flow | `/nodes/1` |
| INVALID_FORK | one incoming, at least two outgoing flows | `/nodes/1` |
| INVALID_JOIN | at least two incoming, one outgoing flow | `/nodes/4` |
| IMPLICIT_FORK | initial nodes, interaction uses and inline interactions have at most one outgoing flow (UML would fork implicitly) | `/nodes/1` |
| IMPLICIT_JOIN | interaction uses and inline interactions have at most one incoming flow (UML would wait for all of them) | `/nodes/3` |
| DEAD_END | initial nodes, interaction uses and inline interactions have an outgoing flow: every path ends in a final node | `/nodes/1` |
| UNREACHABLE_NODE | every node is reachable from the initial node | `/nodes/2` |
| SCHEMA_INVALID | unknown node types, names on control nodes, inline interactions without messages, unknown message sorts, missing `nodes` | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/nodes/1/name` |

All rules are errors (none are warnings): an invalid overview is not rendered.

## Unsupported (rejected by the schema)

- Combined fragments (`alt`, `loop`, `par`) inside inline interactions, activation
  bars, gates, create and destroy messages: inline interactions are kept to
  lifelines and messages; reference a full sequence diagram with an interaction
  use instead.
- Interaction use return values and gates, `sd` frames with parameters.
- Object flows, pins, swimlanes, interruptible regions: activity diagram kind.
- Duration and time constraints between frames.
- Notes.

## Known limitations

- More than three branches of a decision (or inputs of a merge) share the straight
  vertex; their guards then sit next to the targets.
- Several flows into a final node meet at its top point, which reads like a merge
  just above the node (valid UML, since a final node accepts any token).
- Inline interactions have at most 6 lifelines and 12 messages, so they stay
  readable at overview scale.
