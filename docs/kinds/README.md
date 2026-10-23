# Adding a diagram kind: the recipe

This is the procedure for adding a diagram kind (object, package, sequence, ...). The
class kind (`src/kinds/class/`, `docs/kinds/class.md`) is the worked example of an
own-engine kind and also contains a complete PlantUML backend
(`to-plantuml.ts`), so read it alongside this page.

A kind is done when everything under "Definition of done" is true.

## 1. Files you add (and the only shared line you touch)

```
src/kinds/<kind>/
  index.ts          KindDefinition: name, title, summary, frame keyword, schema, validate, backends
  model.ts          TypeScript types of a validated document
  schema.ts         JSON Schema, built with kindSchema()
  validate.ts       semantic rules -> Diagnostic[]
  layout.ts         own engine: measure + ELK layout -> positioned scene      (engine kinds)
  draw.ts           own engine: scene -> SVG via Canvas and shared shapes     (engine kinds)
  to-plantuml.ts    model -> PlantUML source                                  (PlantUML kinds)
examples/<kind>/    minimal.json, realistic example(s), stress.json (+ notation showcase)
test/fixtures/<kind>/valid.json     positive fixtures  [{ name, doc }]
test/fixtures/<kind>/invalid.json   negative fixtures  [{ name, expect: { code, path }, doc }]
test/<kind>.test.mjs                unit tests (no Java)
test/integration/<kind>.test.mjs    real-PlantUML tests (PlantUML kinds only)
docs/kinds/<kind>.md                notation checklist (template below)
```

The one shared edit: `src/model/registry.ts`, one import and one array entry:

```ts
import { sequenceKind } from '../kinds/sequence/index.js';
export const kinds = [classKind, sequenceKind];
```

Test files are picked up by the globs in `package.json` (`test/*.test.mjs`,
`test/integration/*.test.mjs`) and examples by `npm run gallery`; do not edit
those scripts. If you need a change in `src/engine`, `src/qa`, `src/plantuml` or
`src/core`, keep it small and generic, add a test for it in
`test/engine.test.mjs`, and mention it in the pull request description.

## 2. Model and schema conventions

Every document is `{ "kind": "<kind>", "title"?: "...", ... }`. Build the schema
with `kindSchema()` from `src/model/schema.ts`; it adds `kind`, `title` and the
shared definitions.

- Use `elements` for the things drawn as nodes and `relationships` for the lines
  between them, unless the kind's natural vocabulary is clearly different (a
  sequence diagram has `lifelines` and `messages`; a timing diagram has `lifelines`
  and `states`). Name properties after UML 2.5.1 terms.
- Discriminate variants with a `type` property and
  `{ "type": "object", "discriminator": { "propertyName": "type" }, "oneOf": [...] }`
  where each branch has `"type": { "const": "..." }` and
  `"additionalProperties": false`. Unknown properties then fail with a precise path.
- Every object: `additionalProperties: false`, explicit `required`, bounded arrays
  (`maxItems`). Choose limits so the stress example fits and the render budget holds.
- IDs: `{ "$ref": "#/definitions/id" }`. One ID namespace per document (elements,
  relationships with an optional `id`, nested things). IDs are never drawn.
- **Every string that is drawn must use a text definition**: `name` (1 to 100),
  `text` (1 to 180), `longText` (notes, 1 to 1000), `keyword` (stereotype or keyword
  without guillemets), `multiplicity`. They carry the `x-uml-text` marker, which
  applies the INVALID_TEXT rules (no blank text, unpaired surrogates or bidi
  controls) and registers the string for the literal-text QA gate. A drawn string
  that bypasses these definitions is a bug.
- Direction semantics go in `description`s, because agents read `uml schema <kind>`:
  for example "`from` is the specific classifier, `to` the general one".
- Prefer structured fields over strings to parse (the class kind takes attribute
  `name`, `type`, `multiplicity`, `default` and formats them itself).
- Do not invent features the backend cannot draw. Unsupported UML constructs are
  simply absent from the schema, so they fail as SCHEMA_INVALID, and are listed in
  the checklist as unsupported.

## 3. Semantic validation

`validate(model)` runs only after the schema passed and returns `Diagnostic[]`
(`{ code, path, message, details? }`); it must not throw. Use the shared helpers in
`src/model/rules.ts`: `uniqueIds` (DUPLICATE_ID), `reference` (MISSING_REFERENCE),
`findCycles`, `checkMultiplicity` (INVALID_MULTIPLICITY). Rules:

- `path` is a JSON Pointer to the most specific offending property, built with
  `pointer()` from `src/core/errors.ts` (for example `/relationships/3/to`).
- Codes are UPPER_SNAKE_CASE, stable, specific (`INITIAL_STATE_HAS_INCOMING`, not
  `INVALID_STATE`), reuse shared codes where the meaning is identical, and are
  listed in the kind's checklist.
- Report every problem, not just the first; the CLI reports the first as the error
  and includes all under `diagnostics`.

## 4a. Own-engine kinds (`backends: [{ name: 'engine', render }]`)

Pipeline: `loadFonts()` -> measure -> `layout()` -> route/label -> draw -> `Canvas.finish()`.
Copy the structure of `src/kinds/class/layout.ts` and `draw.ts`.

| Need | Use |
|---|---|
| Text width, wrapping | `loadFonts()` -> `metrics.measure(text, { size, bold, italic })`, `wrapText()` (keeps `lines.join('') === text`) |
| Colors, strokes, sizes, spacing | `theme` in `src/core/theme.ts`. Never hard-code; add a token instead |
| Classifier-like boxes with compartments | `measureBox()` + `drawBox()` (name compartment tinted; keywords/stereotypes as `BoxLine`s; `underline` for static) |
| Notes | `measureNote()` + `drawNote()`; anchor lines: `drawEdge` with `style: 'dashed'`, both markers `none`, type `note-anchor`. `placeNotes()` (`src/engine/notes.ts`) moves a note far from its targets to a free spot near them (scored by anchor length and crossings); route its anchors again (`repairRoutes` `force`) |
| Packages / containers | `measurePackageTab()` + `drawPackage()`; give ELK a compound node with `padding.top` >= tab height |
| Diagram frame | when `title` is set: `measureFrameHeading()` + `drawFrame(canvas, kind.frameKeyword, title, bounds)` |
| Whole node/edge diagram | `renderDiagram(spec)` in `src/engine/diagram.ts`: boxes, notes and packages (nested through `children`), edges with markers, end and center labels, tree and reversed edges, self-loops, frame. Object, package and profile kinds are thin mappings onto it |
| Packages | `measurePackage()` + `drawPackageNode()` in `src/engine/packages.ts` (tab with `data-uml-tab`; name in the tab for containers, in the body otherwise) |
| Layout | `layout(nodes, edges, { direction })` from `src/engine/elk.ts`: sizes, compound `children`, fixed-side `ports` (a shared port gives generalization trees; a port as wide as an end's labels and marker keeps neighbours apart), edge labels `center`/`head`/`tail` |
| Ports at given points | `LayoutPort.position` (relative to the node) switches the node to FIXED_POS, e.g. diamond vertices, the bottom of an initial dot |
| Undirected graphs | `stressCenters()` from `src/engine/stress.ts` (ELK Stress, deterministic): node centers only, route the edges yourself (see `src/kinds/communication/layout.ts` for grid snapping) |
| Message arrows beside a line | `drawMessageArrow()` (`data-uml-role="message-arrow"`, checked by the `message-arrows` gate); give its labels the same `data-uml-group` |
| Ports, interfaces, nesting, 3D nodes, ellipses | `src/kinds/structure/` (a kind-neutral graph of nested nodes, ports, lollipops, sockets and assemblies, laid out left to right, used by component, deployment and composite structure) and its symbols in `src/engine/symbols.ts`. Fixed port positions: `LayoutPort.position`; a compound node wider than its children: `minimumSize` |
| Self-loops | never give them to ELK: `planSelfLoops()` before layout (node `reserveRight`, `reserveAbove`, `reserveBelow`, min height), `selfLoopRoute()` after. Loops sit on the top-right corner, then the bottom-right corner (with `planSelfLoops(loops, { leftCorners: true })`, as in `renderDiagram`, then the top-left and bottom-left corners, mirrored, with `reserveLeft`, `reserveAboveLeft`, `reserveBelowLeft`), then nest on the right side; `selfLoopLabelSide()` gives the label side; their end labels go inside the loop (`onlySide` -1 source, 1 target) |
| Layout direction and aspect | `chooseLayout(directions, run, measure, { penalty, wrap })` from `src/engine/aspect.ts`: runs the plain layered layout per direction (conventional one first), adds `narrow` layering when it is wider than 16:9 across the direction and (opt-in) ELK `wrap` when it runs too long, and keeps the best `layoutScore` (size, distance from the 4:3..16:9 band, crossings, line length, detours: `routesDetour()` charges every route beyond the route-length gate's `routeLimit()` or wrapping round the drawing, a penalty for unconventional directions). Pass `detour: routesDetour(lines)` in your measure. Pass `LAYOUT_VARIANTS[variant]` as `elk` options to `layout()`. `renderDiagram` (`DiagramSpec.directions`, `wrap`) and the structure layout (`StructGraph.directions`) already use it |
| Route repair | after layout, `repairRoutes(nodes, edges, options)` from `src/engine/repair.ts` checks each route against the gates' rules and reroutes the ones that cross nodes or container texts (give containers' names and tabs as `texts`), detour (target above source), crowd another end on the same side, or bend under a marker, then shortens needless loops. Ends on ports, symbols, ellipses or shared arrowheads stay put (`fixedSource`/`fixedTarget`, `group`). Optional `labelFits`/`labelSpacing` spread bundled lines whose center label has no clean spot; `force` routes edges ELK could not lay out; `junctions` (opt-in) reroutes a line that crosses another within 30 px of either end, where the crossing reads as a junction (the router itself charges extra for such crossings); `lines` adds lines to keep clear of and cross rather than follow, like container borders (region separators); `tighten` (opt-in, used by `renderDiagram`) slides the U-shaped parts of a detour no reroute replaced inwards, as far as they stay clear of nodes and lines. Give stems and connectors that should stay straight a `LayoutEdge.straightness` priority. The router itself is `routeOrthogonal()` in `src/engine/router.ts` |
| Circles, ellipses, diamonds | `clipRoute()` from `src/engine/clip.ts` moves route ends onto the outline; declare `shape: 'ellipse' | 'diamond'` in the node data so the edge-endpoints gate checks the outline. Small symbols with ports: `fixedSize` keeps their size |
| Nested states, entry/exit points | compound nodes with `minimumSize` (vertical layouts are handled), nodes on a border with `parent` = the owner (and `borderOf`), lines kept off container texts (`src/kinds/state-machine/layout.ts`) |
| Captions, slanted lines | `labelBelow` reserves room under a node (actor names); `routing: 'polyline'` gives slanted segments, whose labels `placeLabels()` pushes off the line; `straightenJogs()` removes small jogs from orthogonal routes |
| Lines and arrowheads | `drawEdge({ points, style, sourceMarker, targetMarker, ... })`; markers: `hollow-triangle`, `filled-triangle`, `open-arrow`, `hollow-diamond`, `filled-diamond`, `cross`, `circle-plus`, `none`. An edge of type `note-anchor` is drawn thin, dotted and lighter (`theme.color.anchor`, `theme.stroke.anchor`, `anchorDash`) whatever its style. Bends are never rounded under an open arrowhead or cross; give every end with a marker a straight end segment of at least the marker length plus `bendRadius` (gate `markers`). `markerLength()`/`markerHalf()` give marker sizes. Message arrows beside a line (`drawMessageArrow`) use `theme.size.messageTriangle`; so do message lines inside small fragments (`drawEdge({ ..., triangleSize: theme.size.messageTriangle })`). A marker drawn at a non-default size declares it in `data-uml-size`, and the gates use that size |
| Edge labels | `placeLabels()` with obstacles (node rects, marker boxes, all segments, labelled `ends`); end labels with `at: 'source'|'target'`, center labels with ELK's suggestion (drop it for rerouted edges). Give center labels `owner` and the obstacles `lines` (every route by owner): spots as near to another line as to the own line are avoided (gate `label-proximity`). Labels keep `LABEL_CLEARANCE` (3 px) from nodes. `labelFits()` tells whether a label has a clean spot on a route |
| Text wrapping | `wrapText(metrics, text, style, maxWidth, { maxTokenWidth })`: words up to `theme.size.maxTokenWidth` stay whole (the box grows), longer ones break at camelCase, `.`, `_`, `-`, `/`, `(`, `,` and guillemets (`wordPieces`), punctuation never stands alone. `measureBox` wraps names to the box's real content width. One `<text>` holding several logical lines (keyword above name) marks them with `startsData(starts)` so the wrap check judges only real wraps |
| Parallel relationships | `renderDiagram` bundles lines between one pair of nodes that carry center labels (no end labels, not tree edges): each member is laid out as two ELK edges through an invisible hub node (`bundleHub()` in `src/engine/bundles.ts`): straight lanes one `bundlePitch()` apart (ports on both nodes as far apart), each label beside its own lane and at least twice as far from the next. Network simplex node placement keeps the lines into and out of the hub straight |
| Ends on ellipses | `spreadEllipseEnds(routes, rect, ends)` from `src/engine/clip.ts` keeps ends on one ellipse apart (polyline routes) |
| Writing SVG | `Canvas` (`text`, `lines`, layers `frame/edges/nodes/labels`), `el()`. Only whitelisted elements and attributes exist; display text is escaped |

Mandatory `data-uml-*` attributes (the shapes and `drawEdge` add them for you):
nodes `data-uml-role="node"`, `data-uml-id`, `data-uml-type`, `data-uml-bounds`
(and `data-uml-parent` when nested); edges `data-uml-role="edge"` with id, type,
source, target, points and declared markers; markers with tip and direction; texts
`data-uml-role` = `text` (inside a node, `owner` = node id), `label` (edge label,
`owner` = edge id; end labels also `data-uml-end` and `data-uml-anchor`) or
`frame-label`. The gates read geometry from these, so they are exact.

Route geometry rules: edge routes start and end exactly on node borders; markers are
drawn at the end with the direction of the last segment; labels never sit on lines.

## 4b. PlantUML kinds (`backends: [{ name: 'plantuml', diagramType, toPlantUml }]`)

- Start from `plantUmlDocument(lines, { layout })` (`src/plantuml/skin.ts`): it adds
  `@startuml`/`@enduml` and the theme skinparams. Use `{ layout: 'smetana' }` only for
  diagram types that need a graph layout (never Graphviz). Add kind-specific
  skinparams in `skin.ts` from theme tokens if the generic ones do not cover them.
- Encode **every** display string with `displayText()`; inside quotes where the
  PlantUML grammar expects a quoted name (`participant "<encoded>" as uml_e0`).
- Refer to elements only through `aliases()`; user IDs never reach the source.
- No raw PlantUML pass-through, no `!include`, no links, no Creole from input.
- Set `diagramType` to the value PlantUML writes to `data-diagram-type`
  (e.g. `SEQUENCE`); the runner rejects other output.
- The runner (SECURE profile, no shell, time/size limits) and font embedding are
  applied automatically by `src/render.ts`.
- `toPlantUml` may be async (the activity kind measures note text to wrap it).
- `postProcess(svg, model)` (optional) fixes PlantUML's SVG where its notation
  deviates from UML before fonts are embedded. It may only rewrite PlantUML's own
  primitives (the activity kind turns filled arrowheads into open ones, removes
  mid-line arrowheads, draws the call behavior rake, moves crossed guards); it never
  inserts input text. Mark shapes it must find with a kind-specific style from
  theme tokens (e.g. `CALL_BEHAVIOR_MARK` in `skin.ts`).
- QA on PlantUML output is best-effort (`src/qa/inspect.ts` reads `g.entity` and
  `g.link` groups). If your diagram type uses other groups (sequence: participants,
  messages), extend `readPlantUml` generically and test it. Diagram types with a
  flat SVG get their own reader, dispatched on `data-diagram-type` (activity:
  `src/qa/plantuml-activity.ts`, which classifies shapes by theme color and chains
  flow lines into edges); a reader that recovers exact edge geometry sets
  `scene.exactEdges`, and then every gate runs. Gates that cannot be evaluated are
  reported as skipped, never as passed silently.

## 5. Tests (all mandatory)

In `test/<kind>.test.mjs` (Java-free) or `test/integration/<kind>.test.mjs`
(PlantUML kinds), following `test/class.test.mjs`:

1. **Negative fixtures**: every entry of `invalid.json` fails with exactly
   `expect.code` and `expect.path`. At least one per semantic rule and per kind of
   schema error (unknown property, wrong type value, bad text).
2. **Positive fixtures**: every entry of `valid.json` passes `assertGates(doc)`
   (from `test/helpers.mjs`), which renders and runs every QA gate in one call.
3. **Examples**: every file in `examples/<kind>/` passes `assertGates`.
4. **Budget**: the stress example renders within 2 s (engine) or 5 s cold
   (PlantUML).
5. **Determinism**: two renders are byte-identical.
6. **Notation**: assertions on the inspected scene (`inspectSvg`) that each
   construct of the checklist is drawn as UML 2.5.1 requires (marker types and
   ends, dashed or solid lines, keywords in guillemets, italics, underlines).
7. **Hostile text**: markup-like, quote, Unicode, emoji and boundary-space text in
   every text slot stays literal and produces no active SVG.

The QA gates (`src/qa/gates.ts`, all must pass): `safe-markup`, `inside-canvas`,
`node-overlap` (containment allowed; a port may straddle its owner's border),
`label-overlap` (a label may lie inside a container that encloses an end of its own
edge, or a container of the port or symbol it names, clear of package tabs; never on
a leaf node or on any text; at least 3 px from node borders), `label-edge-crossing`,
`label-proximity` (end labels near and unambiguous; center labels within 24 px of
their line; every other line at least twice as far from a label as its own line,
for center and end labels), `edge-endpoints` (on
borders, on the tab or body of a package, on the ellipse for
`data-uml-shape="ellipse"` nodes, no edge through other nodes and none running
along a node's border closer than 4 px, no line over the
texts of any container: tabs, component and node names, composite headers, nor
through a container's header band or along the separator below it),
`shared-segments` (no two lines within 2 px of each other for more than 10 px, at
any angle, except the lines of one generalization tree into a shared hollow
triangle and slanted lines within 60 px of a point they share (an actor's fan); no
bend of one line lies on another line),
`end-spacing` (ends on one side of a node at least the line spacing apart, more
with arrowheads; one shared point is allowed), `route-length` (no route longer than
3x the gap between its nodes plus 200 px, nor than `routeLimit()` in
`src/engine/aspect.ts` of the Manhattan distance between its ends: 2.5x plus 80 px,
and at most 320 px plus 5 % beyond it; no route that turns the same way three times
and so wraps round the drawing), `markers` (present, at the end, pointing
inward, not touching other markers, on a straight end segment as long as the marker
plus a bend),
`message-arrows` (parallel to and beside their own link, pointing at the receiver,
labels next to them), `literal-text`, `min-font-size` (11 px), `text-fits` (inside
the node; no word broken between letters where it has a break opportunity, no line
of punctuation alone), `ports`
(ports centered on their owner's border with their names next to them; lollipops and
sockets outside their owner, facing outward; ball-and-socket joints concentric with
the requiring line at the socket's back and the providing line through its opening,
on one axis; interface names next to their symbol). `end-spacing` and `route-length`
judge layout choices only the own engine makes (`ENGINE_ONLY_GATES`); PlantUML output
reports them as skipped.

Reviewer models that exposed layout defects live in `test/fixtures/regression/`
(`test/regression.test.mjs` runs every gate on each). Add a model there for every
layout defect you fix.

Examples and fixtures that fail a gate added before their kind was fixed are listed
in `KNOWN_GATE_FAILURES` (`test/known-gate-failures.mjs`) with the review finding,
the gate and a pattern of the tolerated problems. `assertGates`, the strict
integration test and the gallery accept exactly those problems; an entry that no
longer fails makes the tests fail until it is removed. Never add an entry to make a
change pass; remove entries as you fix them.

Layout warnings (`uml render`) carry advice per kind of problem
(`src/qa/advice.ts`); add a rule there for every new problem message a model can
avoid.

## 6. Gallery and visual review

`npm run gallery` (or `npm run gallery -- <kind>`) renders every example to
`artifacts/gallery/<kind>/<name>.svg` and `.png` (2x) and writes
`artifacts/gallery/index.html`; it fails if any gate fails. Look at every PNG
yourself (an image viewer, or the Read tool), compare with the checklist and fix
until a UML expert would find nothing wrong: notation, spacing, alignment,
crossings, label placement, no clipping. Gates are necessary, not sufficient.

## 7. Notation checklist template (`docs/kinds/<kind>.md`)

```markdown
# <Kind> diagram: notation checklist

Backend: own engine | PlantUML. Frame keyword: `<keyword>`. Schema: `uml schema <kind>`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation (clause) | Proof (test) |
|---|---|---|---|
| ... | `elements[].type = "..."` | shape, line style, arrowhead, keyword, compartment | test file: test name / fixture |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|

## Unsupported (rejected by the schema)

- construct: why / workaround

## Known limitations
```

## Definition of done

- Registry line added; `uml kinds`, `uml schema <kind>`, `uml validate`, `uml render`
  work for the kind, both SVG and PNG.
- Checklist complete, every supported row linked to a passing test.
- `npm test`, `npm run test:integration` and `npm run gallery` pass.
- At least three examples (minimal, realistic, stress) and they look right.
- Own-engine kinds choose their layout with `chooseLayout` and run `repairRoutes`
  (or the pipelines that do: `renderDiagram`, the structure layout), so the
  aspect-ratio and routing rules hold on input nobody tuned for.
- README section for the kind (short: what it draws, an example, the direction
  conventions).
