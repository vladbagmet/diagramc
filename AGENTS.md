# Instructions for coding agents

This file tells an agent how to work in this repository. Humans: the same rules
are in [CONTRIBUTING.md](CONTRIBUTING.md).

`uml` is a TypeScript CLI (Node.js 22 or later, ES modules) that validates a JSON
model of one UML 2.5.1 diagram and renders it to SVG or PNG, offline. 14 diagram
kinds; 11 are drawn by the own engine (elkjs layout plus hand-written SVG), and
sequence, timing and activity by a pinned PlantUML jar on a private Java runtime.
Read [docs/architecture.md](docs/architecture.md) once before larger changes.

## Repository layout

```
src/cli.ts              commands, argument parsing, help text, exit codes
src/render.ts           backend selection, rendering, layout warnings
src/core/               errors (UmlError, Diagnostic, pointer()), limits, text rules, theme tokens
src/model/              KindDefinition (kind.ts), registry.ts, schema envelope, shared rules, parse.ts
src/kinds/<kind>/       one folder per diagram kind (schema, validate, layout/draw or to-plantuml)
src/kinds/structure/    shared nested-node and port graph for component, deployment, composite structure
src/engine/             own engine: fonts, text, ELK adapter, router, route repair, shapes, edges, labels, SVG, PNG
src/plantuml/           display-text encoding, sandboxed runner, skinparams, font embedding
src/qa/                 SVG inspection and the QA gates, advice per problem
schema/                 JSON Schema of the legacy v1 class format
examples/<kind>/        example models (shipped in the npm package; `uml example` reads minimal.json)
test/                   node:test suites (*.test.mjs), helpers, fixtures
test/integration/       tests that need the real PlantUML runtime
test/fixtures/          per-kind valid.json and invalid.json, regression/ models, agent-first/, review/
scripts/                setup-renderer, gallery, stress example generators, build finishing
docs/kinds/             README.md (recipe for kinds, gate definitions) and one notation checklist per kind
docs/decisions/         numbered design decisions
assets/fonts/           pinned Inter font and its OFL license
```

`dist/`, `.tools/` (the PlantUML runtime) and `artifacts/` (gallery output) are
generated and ignored by git.

## Commands

```sh
npm ci                      # install exact dependency versions
npm run build               # tsc into dist/ (tests import from dist/, so build first)
npm run typecheck           # type-check only
npm run lint                # ESLint
npm run format:check        # Prettier check
npm test                    # build + unit tests, no Java needed
npm run setup:renderer      # once: PlantUML and Temurin into .tools/, pinned by SHA-256
npm run test:integration    # build + tests with the real PlantUML renderer
npm run test:coverage       # unit tests with coverage thresholds
npm run gallery             # render every example, run every gate, write artifacts/gallery/index.html
npm run gallery -- <kind>   # the same for one kind
npm run check               # everything a pull request must pass
```

Run one test file with `npm run build && node --test test/class.test.mjs`.
Run the CLI from source with `node dist/cli.js <command>`. `npm run check` must
pass before you call a change done; for changes to sequence, timing, activity or
`src/plantuml/`, `npm run test:integration` must pass too.

## How a diagram kind is structured

A kind exports a `KindDefinition` (`src/model/kind.ts`) from
`src/kinds/<kind>/index.ts`: `kind`, `title`, `summary`, `frameKeyword`,
`schema`, `validate(model)` and `backends` (the first is the default). It is
registered with one import and one array entry in `src/model/registry.ts`.

- `schema.ts`: JSON Schema built with `kindSchema()` from `src/model/schema.ts`.
  Every object has `additionalProperties: false` and bounded arrays. Every drawn
  string uses a shared text definition (`name`, `text`, `longText`, `keyword`,
  `multiplicity`); a drawn string that bypasses them is a bug.
- `validate.ts`: semantic rules that return `Diagnostic[]` (`{ code, path,
  message }`), never throw, report every problem, and use stable UPPER_SNAKE_CASE
  codes with JSON Pointer paths built by `pointer()`.
- Own-engine kinds: `layout.ts` (measure, ELK layout via `src/engine/elk.ts`,
  `chooseLayout`, `repairRoutes`) and `draw.ts`, or a mapping onto
  `renderDiagram()` in `src/engine/diagram.ts`. Never hard-code colors or sizes;
  use or add tokens in `src/core/theme.ts`.
- PlantUML kinds: `to-plantuml.ts` starting from `plantUmlDocument()`, every
  display string through `displayText()`, element names only through aliases, no
  raw PlantUML from input; optional `postProcess` for notation fixes.

The full recipe, including which engine helper to use for what, is
[docs/kinds/README.md](docs/kinds/README.md). The notation checklists in
`docs/kinds/<kind>.md` list every supported construct with the test that proves
it; update the checklist whenever you change what a kind draws.

## QA gates

`src/qa/gates.ts` inspects a rendered SVG and runs the gates: `safe-markup`,
`inside-canvas`, `node-overlap`, `label-overlap`, `label-edge-crossing`,
`label-proximity`, `edge-endpoints`, `shared-segments`, `end-spacing`,
`route-length`, `markers`, `message-arrows`, `literal-text`, `min-font-size`,
`text-fits`, `ports`, plus `message-endpoints` and `lifeline-crossing` for
PlantUML sequence and timing drawings. Exact definitions are in
`docs/kinds/README.md`, section 5.

- Own-engine SVG carries `data-uml-*` attributes (role, id, bounds, points,
  markers, owner) that the gates read; shapes from `src/engine/` add them. Keep
  them correct when you draw something new.
- Tests call `assertGates(document)` from `test/helpers.mjs`, which renders and
  runs every gate. `uml render` runs the same gates and turns failures into
  `LAYOUT_QUALITY` warnings (exit 5 with `--strict`).
- `test/known-gate-failures.mjs` lists the few tolerated failures. Never add an
  entry to make a change pass. Remove entries you fix; a stale entry fails the tests.
- When you add a new problem message a model author can avoid, add advice for it
  in `src/qa/advice.ts`.
- Gates are necessary, not sufficient: after a drawing change, run
  `npm run gallery` and look at the PNGs of the affected kind.

## Examples and fixtures

- **Example:** `examples/<kind>/<name>.json`, invented and generic content. Each
  kind has `minimal.json`, a realistic example, usually `notation.json`, and
  `stress.json`. Stress examples are generated:
  `node scripts/generate-<kind>-stress.mjs > examples/<kind>/stress.json`; change
  the generator, not the JSON. Kind tests pick up every file in the folder.
- **Positive fixture:** an entry `{ "name": ..., "doc": {...} }` in
  `test/fixtures/<kind>/valid.json`; every entry must pass every gate.
- **Negative fixture:** an entry `{ "name": ..., "expect": { "code": ..., "path": ... }, "doc": {...} }`
  in `test/fixtures/<kind>/invalid.json`; it must fail with exactly that code and
  JSON Pointer. Add one per new semantic rule.
- **Regression model:** a layout defect you fix gets a model in
  `test/fixtures/regression/<kind>-<short-name>.json`; `test/regression.test.mjs`
  runs every gate on each file there.

## Test conventions

- `node:test` and `node:assert/strict`, files named `*.test.mjs`. Tests import
  the compiled code from `dist/`, so build first (`npm test` does).
- Unit tests must not need Java. Anything that runs PlantUML goes in
  `test/integration/`.
- Use `workspace(t)` from `test/helpers.mjs` for temporary directories and
  `cli([...args])` to run the CLI.
- Test behavior a user or agent sees: error codes and paths, drawn notation
  (through `inspectSvg`), determinism (two renders are byte-identical), hostile
  and Unicode text staying literal.
- Keep tests fast; the stress examples have a render-time budget.

## Code conventions

- TypeScript `strict` with `noUncheckedIndexedAccess`; ES modules with `.js`
  import suffixes.
- Errors the user can cause are `UmlError` with a stable code and an exit code;
  validation problems are `Diagnostic`s with JSON Pointers. Messages are written
  for an agent to act on: say what is wrong and what to write instead.
- No new runtime dependency without a strong reason; it has to be added to
  `THIRD_PARTY_NOTICES.md` with its license text.
- Comments, docs and messages: plain English, full sentences, no em-dashes.

## Commits and pull requests

- One logical change per commit. Subject line in the imperative or as a short
  statement of the result, often prefixed with the kind, for example
  `Package: tighten detours the router cannot replace` or
  `Deployment: lines between two containers no longer stack them`. The body
  explains why, in plain sentences.
- **No AI attribution anywhere.** Do not add `Co-Authored-By` lines naming an
  assistant, "Generated with" notes, session links or similar text to commits,
  pull requests, code comments or docs. This is a hard rule of the maintainer.
  The human who opens the pull request takes responsibility for it and states
  which parts were agent-written in the description (see CONTRIBUTING.md).
- Do not commit `dist/`, `.tools/`, `artifacts/`, coverage output or local
  settings.
