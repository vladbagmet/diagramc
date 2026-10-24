# Architecture

`diagramc` turns a JSON model of one UML 2.5.1 diagram into SVG or PNG, offline. It is
built for agents first: every input is validated against a JSON Schema and
semantic rules before anything is drawn, every error is one JSON object with a
code and a JSON Pointer, and every drawing is checked by geometry gates.

## Pipeline

```
model.json
  -> parseDocument     size limit, JSON syntax, `kind` envelope, the kind's schema,
                       text rules, the kind's semantic rules   (src/model/parse.ts)
  -> renderToSvg       the kind's selected backend               (src/render.ts)
       own engine:     measure with Inter + HarfBuzz, lay out with elkjs, route,
                       place labels, write SVG with an embedded font subset
       PlantUML:       model -> PlantUML source -> pinned jar on a private Java
                       runtime -> optional post-processing -> embedded font subset
  -> layoutWarnings    QA gates on the SVG; failures become LAYOUT_QUALITY
                       warnings on stderr, or exit 5 with --strict  (src/qa)
  -> rasterize         PNG through resvg-js, only for PNG output (src/engine/png.ts)
```

Validation never touches a renderer, and Java is only discovered and started
after a document passed every check. Inputs are capped at 256 KiB and rendered
SVGs at 8 MiB (`src/core/limits.ts`).

## One model, two backends

Every document is `{ "kind": "<kind>", "title"?: "...", ... }`. Each kind lives
in `src/kinds/<kind>/` and exports a `KindDefinition` (`src/model/kind.ts`): its
name, frame keyword, JSON Schema, semantic validator and one or more backends.
`src/model/registry.ts` lists the 14 kinds in `diagramc kinds` order; adding a kind is
one folder plus one registry line (see [kinds/README.md](kinds/README.md)).
Envelope-less documents with a `classes` array are the original v1 format and
are upgraded to class diagrams (`src/kinds/class/v1.ts`, `schema/model-v1.schema.json`).

| Backend | Kinds | Why |
|---|---|---|
| Own engine (elkjs layout, hand-written SVG) | class, object, package, profile, component, deployment, composite structure, communication, interaction overview, state machine, use case | Layout quality matters most for graph-like diagrams; ports, nesting, labels and routes need control PlantUML's Smetana layout does not give |
| PlantUML 1.2025.10 | sequence, timing, activity | PlantUML has dedicated, mature engines for these that need no graph layout |
| PlantUML (optional) | class with `--backend plantuml` | Best-effort fallback, held only to the text and safety gates |

State machine and use case started on PlantUML and moved to the own engine
because Smetana failed the gates ([decision 0002](decisions/0002-state-machine-and-use-case-backend.md)).

Both backends share one look: colors, stroke widths, font sizes and spacing come
from the theme tokens in `src/core/theme.ts`, and the PlantUML skinparams are
generated from the same tokens (`src/plantuml/skin.ts`).

## Source layout

| Path | Contents |
|---|---|
| `src/cli.ts` | Commands (`render`, `validate`, `export`, `import`, `example`, `schema`, `kinds`, `guide`, `mcp`), argument parsing, help, exit codes |
| `src/commands.ts` | The operation behind each command, shared by the command line and the MCP server |
| `src/mcp.ts` | `diagramc mcp`: the commands as MCP tools on stdio, a thin layer over `src/commands.ts` |
| `src/formats/` | PlantUML and Mermaid export and import |
| `src/render.ts` | Backend selection, rendering, layout warnings |
| `src/core/` | Errors and diagnostics, I/O, limits, text rules, theme tokens |
| `src/model/` | Kind interface, registry, schema envelope (`kindSchema()`), shared rules, parsing, correction hints |
| `src/kinds/<kind>/` | Schema, validator and renderer of one kind; `structure/` is the shared graph of nested nodes and ports used by component, deployment and composite structure |
| `src/engine/` | Own engine: fonts and text measurement, ELK adapter, orthogonal router and route repair, aspect-ratio choice, shapes, symbols, edges, labels, self-loops, SVG writer, PNG |
| `src/plantuml/` | Display-text encoding, the sandboxed runner, skinparams, font embedding, SVG geometry fixes |
| `src/qa/` | SVG inspection into a scene and the gates run on it, plus advice per problem |
| `scripts/` | Renderer setup, gallery, build finishing, stress model generators, the skill reference generator |
| `skills/diagramc/` | The usage skill for agents (`diagramc guide` prints it); `reference.md` is generated |
| `test/` | `node:test` suites; `test/integration/` needs the PlantUML runtime |

## Rendering details that matter

- **Fonts.** One pinned font, Inter 4.1 (SIL OFL 1.1, `assets/fonts/`), measured
  with HarfBuzz and embedded as a subset in every SVG, so measured and displayed
  widths agree. The renderer setup installs the same font into the private Java
  runtime so PlantUML measures with it too ([decision 0001](decisions/0001-fonts.md)).
- **Machine-readable SVG.** Own-engine shapes carry `data-uml-*` attributes (role,
  id, bounds, points, markers, owner). The gates read geometry from them, so their
  checks are exact. PlantUML output is read best-effort from its own groups and
  colors (`src/qa/inspect.ts`, `plantuml-activity.ts`, `plantuml-interaction.ts`);
  gates that cannot be evaluated are reported as skipped.
- **PlantUML sandbox.** The jar runs as a child process without a shell, under the
  SECURE security profile, with a 256 MiB heap, a 20 s timeout and output limits.
  User IDs never reach the source (private aliases), every display string is
  encoded, and there is no raw PlantUML pass-through (`src/plantuml/`).
- **PNG.** `src/engine/png.ts` rasterizes the SVG with resvg-js and handles text
  that Inter cannot draw ([decision 0003](decisions/0003-png-text.md)).
- **Determinism.** The same input gives byte-identical output; tests check it.

## Quality gates

`src/qa/gates.ts` defines the gates every drawing is checked against: markup
safety, canvas bounds, node and label overlap, label distance from lines, edge
endpoints, shared line segments, end spacing, route length, arrowheads, message
arrows, literal text, minimum font size, text fitting its box and ports, plus the
PlantUML interaction gates `message-endpoints` and `lifeline-crossing`.
`docs/kinds/README.md` describes them in detail. Tests run every gate on every example and
fixture; `diagramc render` runs them on every drawing. The few known failures are
listed in `test/known-gate-failures.mjs`, which may only shrink.

## Renderer runtime

`scripts/setup-renderer.mjs` downloads PlantUML (MIT build) and an Eclipse
Temurin JRE, both pinned by version and SHA-256, into `.tools/` and writes
`.tools/renderer.json`. Nothing is installed globally. `DIAGRAMC_JAVA` and
`PLANTUML_JAR` together override the local runtime. See
[decision 0005](decisions/0005-plantuml-license-build.md) for the license build.
