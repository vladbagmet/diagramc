# Adding a diagram kind: the recipe

This is the exact procedure for a kind chunk (object, package, sequence, ...). The
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
`test/engine.test.mjs`, and list it in your report.

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
| Notes | `measureNote()` + `drawNote()`; anchor lines: `drawEdge` with `style: 'dashed'`, both markers `none`, type `note-anchor` |
| Packages / containers | `measurePackageTab()` + `drawPackage()`; give ELK a compound node with `padding.top` >= tab height |
| Diagram frame | when `title` is set: `measureFrameHeading()` + `drawFrame(canvas, kind.frameKeyword, title, bounds)` |
| Whole node/edge diagram | `renderDiagram(spec)` in `src/engine/diagram.ts`: boxes, notes and packages (nested through `children`), edges with markers, end and center labels, tree and reversed edges, self-loops, frame. Object, package and profile kinds are thin mappings onto it |
| Packages | `measurePackage()` + `drawPackageNode()` in `src/engine/packages.ts` (tab with `data-uml-tab`; name in the tab for containers, in the body otherwise) |
| Layout | `layout(nodes, edges, { direction })` from `src/engine/elk.ts`: sizes, compound `children`, fixed-side `ports` (a shared port gives generalization trees; a port as wide as an end's labels and marker keeps neighbours apart), edge labels `center`/`head`/`tail` |
| Self-loops | never give them to ELK: `planSelfLoops()` before layout (node `reserveRight`, min height), `selfLoopRoute()` after |
| Lines and arrowheads | `drawEdge({ points, style, sourceMarker, targetMarker, ... })`; markers: `hollow-triangle`, `filled-triangle`, `open-arrow`, `hollow-diamond`, `filled-diamond`, `cross`, `circle-plus`, `none` |
| Edge labels | `placeLabels()` with obstacles (node rects, marker boxes, all segments, labelled `ends`); end labels with `at: 'source'|'target'`, center labels with ELK's suggestion |
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
- QA on PlantUML output is best-effort (`src/qa/inspect.ts` reads `g.entity` and
  `g.link` groups). If your diagram type uses other groups (sequence: participants,
  messages), extend `readPlantUml` generically and test it. Gates that cannot be
  evaluated are reported as skipped, never as passed silently.

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
`node-overlap` (containment allowed), `label-overlap`, `label-edge-crossing`,
`label-proximity` (end labels near and unambiguous), `edge-endpoints` (on borders,
no edge through other nodes), `markers` (present, at the end, pointing inward, not
touching other markers), `literal-text`, `min-font-size` (11 px), `text-fits`.

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
- README section for the kind (short: what it draws, an example, the direction
  conventions).
