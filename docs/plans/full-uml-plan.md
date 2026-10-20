# Full UML coverage plan

Date: 2026-10-19. Starting point: the class-diagram MVP (TypeScript CLI, JSON model, PlantUML 1.2025.10 with Smetana, pinned Temurin JRE). Goal: a polished agent-first CLI that renders all 14 UML 2.5.1 diagram kinds, each at the highest quality we can verify.

## Decisions already made

- **Hybrid rendering.** Our own layout and SVG renderer (elkjs plus hand-written drawing code) for the structural and graph-like kinds, where layout quality matters most and PlantUML's Smetana engine is weakest. PlantUML stays for the kinds it draws well with dedicated engines.
- **One model, one look.** Every kind is a JSON document validated by a JSON Schema, with the same ID rules, text rules, error format and visual theme (colors, line weights, font sizes) whichever backend draws it.
- **Git.** The project is a local git repository. Each work chunk is done on its own branch or worktree and merged after review. Nothing is pushed anywhere.
- **TypeScript stays.** The MVP proved the Node/TS stack, security model and setup script. The Rust rewrite in the research report is not part of this plan.

## Backend per diagram kind

| Kind | Backend | Why |
|---|---|---|
| Class | Own (ELK) | Flagship; Smetana gives clipped self-loops, weak routing, no multiplicity placement control |
| Object | Own (ELK) | Same box/link machinery as class |
| Package | Own (ELK, compound) | Needs real nesting and tab-shaped package frames |
| Profile | Own (ELK) | Stereotype/metaclass extension arrows; class machinery |
| Component | Own (ELK, ports) | Ports, provided/required interfaces (lollipop and socket) need port-aware layout |
| Deployment | Own (ELK, compound) | 3D node boxes, nesting, artifacts, communication paths |
| Composite structure | Own (ELK, compound + ports) | Parts, ports and connectors inside a classifier |
| Communication | Own (ELK) | Numbered messages on links; PlantUML has no native support |
| Interaction overview | Own (ELK, layered top-down) | Activity-like flow whose nodes are interaction frames; PlantUML has no native support |
| Sequence | PlantUML | Dedicated, mature sequence engine (no graph layout involved) |
| Timing | PlantUML | Dedicated timing engine |
| Activity | PlantUML (new activity syntax) | Dedicated engine, swimlanes, fork/join, decision/merge |
| State machine | Own (ELK, compound) | Moved from PlantUML in chunk 5: Smetana dropped orthogonal regions and failed the gates ([decision 0002](../decisions/0002-state-machine-and-use-case-backend.md)) |
| Use case | Own (ELK, compound) | Moved from PlantUML in chunk 5: Smetana failed the gates ([decision 0002](../decisions/0002-state-machine-and-use-case-backend.md)) |

Information flow (StarUML extra) is out of scope.

## Target architecture

```
src/
  cli.ts                 commands: render, validate, schema, kinds, (inspect)
  core/                  errors, io, text rules, ids, theme tokens, diagnostics
  model/                 envelope schema, registry of kinds, shared validators
  kinds/<kind>/          schema.json, validate.ts, to-plantuml.ts OR layout.ts + draw.ts, examples/
  engine/                own renderer: font metrics, text measurement, shapes,
                         arrowheads, edge labels, ELK adapter, SVG writer
  plantuml/              source generation helpers (display-text encoding), runner
  qa/                    SVG geometry inspection used by tests and `uml inspect`
```

Model envelope (schema v2):

```json
{ "kind": "class", "title": "Ordering", "elements": [...], "relationships": [...] }
```

Each kind defines its own `elements` and `relationships` vocabulary under one envelope. A v1 document (no `kind`, has `classes`) keeps working and is treated as a class diagram, so the MVP contract does not break. The optional `title` is drawn as the UML diagram frame heading (pentagon in the top-left corner, e.g. `class Ordering`).

## Quality bar: how every kind is tested

A kind is done only when all of these pass. These are hard gates, not aspirations.

1. **Notation checklist.** A per-kind checklist in `docs/kinds/<kind>.md` lists each supported construct, how UML 2.5.1 draws it (line style, arrowhead, keyword in guillemets, compartment, shape), and the test that proves it. Unsupported constructs are listed too and rejected with a clear error.
2. **Semantic fixtures.** Positive and negative JSON fixtures per rule (for example: inheritance cycle, include cycle, initial state with a guard, final state with an outgoing transition, message to an unknown lifeline). Every negative fixture asserts the exact error code and JSON path.
3. **Geometry gates** (run on every rendered fixture, both backends, via `src/qa`):
   - everything inside the viewBox, nothing at negative coordinates (the MVP's self-loop bug);
   - no overlapping nodes except intended containment;
   - no label overlapping a node or another label;
   - edges start and end on their node's border, and arrowheads point the right way;
   - every input text appears literally in the SVG;
   - minimum font size 11px; no text wider than its box.
4. **Visual review.** Each example is rasterized to PNG (resvg-js, 2x) into `artifacts/gallery/`. A reviewer who did not write the code looks at every PNG against the notation checklist and a fixed rubric (correct notation, readability, spacing, alignment, crossings, label placement, consistency with other kinds). Findings are fixed until the reviewer has none left above "nit".
5. **Robustness.** Hostile and markup-like text stays literal, Unicode/CJK/emoji/long labels render without clipping, size limits are enforced, output is byte-identical across repeated runs, and a large fixture (for example 50 classes, 80 relationships, or 40 sequence messages) renders within the time budget (own engine under 2 s, PlantUML kinds under 5 s cold).
6. **Docs and examples.** Each kind has a README section, a schema, at least three examples (minimal, realistic, stress) and gallery PNGs.

## Work chunks

### Chunk 0: foundation (one agent, must finish first)

- Fold in the MVP review fixes (self-loop clipping and anything else in `docs/reviews/mvp-review.md`).
- Restructure into the target layout without changing v1 behavior; all existing tests keep passing.
- Schema v2 envelope, kind registry, shared text/ID validation, diagnostics with JSON paths.
- CLI: `render` (any kind, `--format svg|png`), `validate`, `schema <kind>`, `kinds`.
- Theme tokens shared by both backends (PlantUML skinparams generated from the same tokens).
- QA module with all geometry gates, a test helper that renders a fixture and runs every gate, and the PNG gallery script.
- Own engine core: pinned open-licensed font (measured with a font library, subset and embedded in the SVG so measurement matches display), text measurement and wrapping, SVG writer with escaping, ELK adapter, shared shapes (compartment box, note with folded corner, package tab frame, diagram frame with pentagon heading), all UML arrowheads and line styles, edge label placement with collision avoidance, self-loops.
- **Class diagram moved to the own engine** as the reference vertical slice: visibility, static/abstract styling, stereotypes, interfaces, enumerations, generalization, realization, association with role names and multiplicities, aggregation, composition, dependency, navigability, association classes are optional. It must pass every gate and visibly beat the MVP render.
- Write `docs/kinds/README.md`: the recipe the other chunks follow.

### Chunks 1 to 5 (parallel, one agent each, own worktree, after chunk 0 merges)

| Chunk | Kinds | Backend |
|---|---|---|
| 1 | Object, package, profile | Own |
| 2 | Component, deployment, composite structure | Own |
| 3 | Communication, interaction overview | Own |
| 4 | Sequence, timing | PlantUML |
| 5 | Activity, state machine, use case | PlantUML (activity); own (state machine, use case, see decision 0002) |

Each chunk delivers, per kind: schema, validator, renderer, notation checklist, positive/negative fixtures, examples, gallery PNGs, and passing gates. Chunks touch only `src/kinds/<kind>/`, their docs, their tests, and one registry line, so merges stay simple. A chunk that needs a change in `engine/` or `qa/` makes it small, tests it, and says so in its report.

### Chunk 6: integration and polish (after 1 to 5 merge)

- Merge, run the full suite, and regenerate the whole gallery.
- Independent review of every kind's gallery against its checklist, with one consistent rubric across kinds; fix everything found.
- Cross-kind consistency pass: fonts, colors, frame headings, arrowheads, spacing.
- README rewrite, `uml --help`, package contents, version 1.0.0.

## Risks

- **Font consistency between backends.** PlantUML uses Java's font stack; the own engine uses a pinned embedded font. Colors and sizes match exactly; glyph shapes may differ slightly between PlantUML kinds and own-engine kinds. Accepted for now and documented.
- **elkjs label and port behavior.** It is a transpiled port of Java ELK. Chunk 0 must prove edge labels, ports and compound nesting on fixtures before chunks 1 to 3 build on it.
- **PlantUML state/use case quality.** If they fail the gates, they move to the own engine during chunk 5 or 6, which costs extra time but no rework of the model.

## Outcome

Released as 1.0.0 on 2026-10-20 (see [CHANGELOG.md](../../CHANGELOG.md)).

- **All 14 kinds shipped.** Class, object, package, profile, component,
  deployment, composite structure, communication, interaction overview, state
  machine and use case run on the own engine; sequence, timing and activity run on
  PlantUML 1.2025.10, post-processed to UML notation. The backend table above held
  except for state machine and use case, which moved to the own engine in chunk 5
  (decision 0002). Class keeps PlantUML as an optional fallback
  (`--backend plantuml`). `uml kinds` lists the backends of each kind.
- **Quality gates.** `src/qa` runs 16 geometry and text gates (markup safety,
  canvas bounds, node and label overlap, labels on lines and near their ends, edge
  endpoints, shared line segments, arrowheads, message arrows, literal text,
  minimum font size, text fitting its box, ports, plus engine-only spacing and
  route-length checks) on every fixture and example of every kind. PlantUML
  sequence and timing drawings also get a dedicated reader for lifelines,
  activation bars and messages, with the `message-endpoints` and
  `lifeline-crossing` gates. The gates were tightened late; the remaining known
  failures are listed with their review findings in
  `test/known-gate-failures.mjs`, a list that only shrinks.
- **Render-time warnings and `--strict`.** `uml render` runs the same gates on
  every drawing. A drawing that fails one is still written with exit code 0, and
  stderr carries one JSON object with a `LAYOUT_QUALITY` warning per failed gate,
  with advice in terms of the model. `--strict` makes that exit code 5 and writes
  nothing.
- **Beyond the plan.** PNG output through resvg, `uml example <kind>`, and
  validation errors that list every problem with suggested corrections. The
  `uml inspect` command sketched in the target architecture was not built; the
  render-time warnings cover its purpose.
- **Known limits** are listed per kind in `docs/kinds/<kind>.md` and summarised in
  the README.
