# State machine diagram: notation checklist

Backend: own engine (see [docs/decisions/0002-state-machine-and-use-case-backend.md](../decisions/0002-state-machine-and-use-case-backend.md)
for why not PlantUML). Frame keyword: `stm`. Schema: `diagramc schema state-machine`.
Code: `src/kinds/state-machine/`. UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `sm` = `test/state-machine.test.mjs`, `engine` =
`test/engine.test.mjs`; fixtures in `test/fixtures/state-machine/`. Every fixture and
example passes every QA gate.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Simple state | `type: "state"` | Rounded rectangle, name centered (14.2.4) | sm: "UML 2.5.1 notation of states, pseudostates and transitions" (`rx="10"`) |
| Entry, do, exit behaviors | `entry`, `doActivity`, `exit` | `entry / ...`, `do / ...`, `exit / ...` in a compartment below the name (14.2.4) | sm: notation test; fixture "state behaviors and internal transitions" |
| Internal transitions | `internal[]` | `trigger [guard] / effect` in the same compartment | sm: `edit / updateLines` |
| Composite state | `regions` (one) | Rounded rectangle, name compartment, a line, then the nested vertices (14.2.4) | sm: `composite-state`; fixture "composite state with one region" |
| Orthogonal regions | `regions` (several), optional region `name` | Regions one below the other or side by side (whichever reads better), separated by dashed lines; names in italics at the region's top left | sm: one dashed separator, italic `payment`; sm: regions side by side |
| Submachine state | `submachine` | `name : Submachine` (14.2.4) | sm: `Invoice : Billing`, type `submachine-state` |
| Entry point / exit point | `connectionPoints[]` | Small circle / circle with a cross on the state's border (entry left, exit right), name beside it (14.2.4) | sm: points centered on the composite's border; fixture "entry and exit points" |
| Initial pseudostate | `type: "initial"` | Filled circle (14.2.4) | sm: filled circle, ellipse outline |
| Final state | `type: "final"` | Circle around a filled circle | sm: two circles |
| Choice | `type: "choice"` | Hollow diamond; outgoing transitions leave at its vertices | sm notation example; fixture "choice and junction" |
| Junction | `type: "junction"` | Small filled circle | sm: smaller than the initial pseudostate |
| Fork / join | `type: "fork"` / `"join"` | Filled bar | sm: bar |
| Shallow / deep history | `type: "shallowHistory"` / `"deepHistory"` | Circle with H / H* | sm: `H*` |
| Terminate | `type: "terminate"` | A cross | sm: cross path |
| Transition | `transitions[]` | Solid line, open arrowhead at the target, label `trigger [guard] / effect` (14.2.4) | sm: every transition `open-arrow` at the target, labels |
| Self-transition | `from` = `to` | Loop on the state's right side, label right of the loop | fixture "self-transitions" |
| Transition into a nested state | `to` inside a composite | Line enters the composite below its name (never over its texts) | fixture "transition from outside into a nested state"; engine: "lines over texts" gate |
| Note | `type: "note"`, `attachedTo` | Folded-corner rectangle, thin dotted line to each annotated vertex; laid out inside the innermost composite holding its targets | sm: dotted `note-anchor` |
| Diagram frame | `title` | Pentagon heading **stm** name (Annex A) | sm: frame label |

Lines end exactly on the outlines of circles and diamonds (`src/engine/clip.ts`;
the edge-endpoints gate reads `data-uml-shape`), pseudostates keep their size
(`fixedSize`), and short jogs are straightened (`straightenJogs`).

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique at every depth (vertices, connection points, regions, transitions) | `/elements/2/id` |
| MISSING_REFERENCE | transition ends and note attachments exist | `/transitions/1/to`, `/elements/4/attachedTo/0` |
| INVALID_ATTACHMENT | notes attach to vertices, not to notes or connection points | `/elements/5/attachedTo/0`, `/elements/2/attachedTo/0` |
| NOTE_IN_TRANSITION | transitions connect vertices only | `/transitions/3/from` |
| MULTIPLE_INITIAL | at most one initial pseudostate per region | `/elements/4` |
| INITIAL_OUTGOING | an initial pseudostate has exactly one outgoing transition | `/elements/0` |
| INITIAL_HAS_INCOMING | no transition into an initial pseudostate | `/transitions/3/to` |
| INITIAL_TRANSITION_TRIGGER, INITIAL_TRANSITION_GUARD | the initial transition has no trigger and no guard | `/transitions/0/trigger`, `/transitions/0/guard` |
| FINAL_STATE_HAS_OUTGOING, TERMINATE_HAS_OUTGOING | no transitions leave final states or terminate | `/transitions/3/from` |
| TRIGGER_ON_PSEUDOSTATE_TRANSITION | only transitions leaving states have triggers | `/transitions/4/trigger` |
| CHOICE_WITHOUT_GUARD | a choice has a guard on at least one outgoing transition | `/elements/4` |
| CHOICE_DEGREE, JUNCTION_DEGREE, FORK_DEGREE, JOIN_DEGREE, HISTORY_DEGREE | incoming and outgoing counts of pseudostates | `/elements/4`, `/elements/0/regions/0/elements/0` |
| GUARD_ON_FORK_OR_JOIN | no guards on transitions leaving a fork or entering a join | `/transitions/4/guard` |
| HISTORY_AT_TOP_LEVEL, MULTIPLE_HISTORY | history only inside composite states, at most one of each kind per region | `/elements/4`, `/elements/0/regions/0/elements/1` |
| PSEUDOSTATE_SELF_TRANSITION | only states have self-transitions | `/transitions/3` |
| TRANSITION_ACROSS_REGIONS | no transition between orthogonal regions of the same state | `/transitions/0` |
| INVALID_ENTRY_POINT_TRANSITION, INVALID_EXIT_POINT_TRANSITION | entry points lead inside their state, exit points lead outside | `/transitions/0/to`, `/transitions/0/from` |
| CONNECTION_POINT_ON_SIMPLE_STATE | entry/exit points only on composite or submachine states | `/elements/1/connectionPoints` |
| SUBMACHINE_WITH_REGIONS | a state is a submachine state or a composite state, not both | `/elements/1/submachine` |
| NESTING_TOO_DEEP | at most six levels of nesting | see `invalid.json` |
| SCHEMA_INVALID, INVALID_TEXT | shared rules (unknown properties, names on pseudostates, empty regions, notes inside regions) | see `invalid.json` |

## Unsupported (rejected by the schema)

- Entry and exit points on the state machine's own frame, connection point
  references on submachine states drawn as separate symbols (submachine states take
  `connectionPoints` directly).
- Protocol state machines (`[pre] event / [post]`), state invariants, deferred
  events, local vs external transition kinds (all transitions are drawn external).
- Transition-oriented notation (signal send/receive symbols on transitions).
- The optional submachine icon and composite-state icon (decorations only).

## Known limitations

- Layout is ELK layered with depth-first cycle breaking, so the main flow starts at
  the top (or the left). Four candidates are compared with `layoutScore`
  (src/engine/aspect.ts): top to bottom or left to right, each with orthogonal
  regions one after the other or side by side. Left to right carries a penalty, so
  it wins only when clearly more compact. A long chain of large composites still
  ends up as a tall column (the stress example is about 1:4); ELK graph wrapping
  produced crossings and is not used.
- Entry and exit points stay on the side ELK chose, moved along it to keep clear of
  the corners, the name compartment and region names, and beside the region their
  inner lines lead to.
- Pseudostates with several incoming lines are laid out twice: the second run gives
  each line the free side facing its source, so arrowheads never share a tip. A
  choice or junction where a line would otherwise turn round to a vertex facing away
  from its source shares all four vertices among all its lines (and a note's dashed
  line) by how far each would turn.
- Orthogonal regions side by side stand in document order (ELK orders them by its
  crossing minimisation; they are moved into order after layout). Regions keep their
  cells: a line from one region to the outside does not cut through a sibling
  region. Lines that cannot avoid a sibling region (from one region to another, or
  to an exit point on the far side) cross it inside the composite, keeping clear of
  the dashed separators instead of following them.
- Fork and join bars: each branch is one straight line from the bar to the facing
  side of its vertex, and the bar spans its branches. When something beside the bar
  is in the way, the bar moves next to the composite of its vertices; lines the bar
  or the branches would cross are rerouted, and the change is dropped if it adds a
  crossing. No line crosses a composite's header band, so branches into its regions
  do not come from above: the regions stack one after the other and the bar stands
  beside the composite, turned along the flow, each branch running straight across
  into its region (layout scoring counts a line through a header like ten crossings,
  so this arrangement wins).
- A choice with all four vertices taken and a note attached is drawn larger, and the
  note's dashed line ends on the middle of an edge, clear of the vertices.
- A transition label without a clean spot gets room: the lines running through the
  space beside its line are routed around it, kept only if more labels fit.
- A note on several vertices is laid out after the first of them along the flow, so
  its dashed lines stay short.
- Transitions from outside into a nested vertex never pass through the composite's
  header band: they detour around its side and enter below the header.
- Routes go through the shared repair pass (src/engine/repair.ts): lines over a
  composite's header, detours, crowded ends and arrowheads on short end segments
  are rerouted. The line-over-container-texts check now covers every container.
