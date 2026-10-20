# Changelog

## Unreleased

- Deployment, component and composite structure layouts no longer let a line
  between elements of two top-level containers decide their order: the
  containers can sit side by side. The deployment stress example now passes
  every layout check (5120 x 3892 instead of 3906 x 6762, no lines around a region).

## 1.0.0 (2026-10-20)

First stable release. Compared with the 0.1.0 MVP, which drew class diagrams to
SVG through PlantUML:

### Diagram kinds

- All 14 UML 2.5.1 diagram kinds: class, object, package, profile, component,
  deployment, composite structure, communication, interaction overview, state
  machine and use case on a built-in layout engine (elkjs layout, hand-written
  SVG); sequence, timing and activity on the pinned PlantUML 1.2025.10, with its
  output post-processed to UML notation.
- Class diagrams moved from PlantUML to the built-in engine. PlantUML remains
  available for them with `--backend plantuml`.
- Diagrams with a `title` get a UML frame with a heading (for example
  **class** Ordering).
- Every kind has a notation checklist in `docs/kinds/` and examples in
  `examples/<kind>/`.

### Model format

- Schema v2: every document names its `kind` and uses that kind's vocabulary
  (`uml schema <kind>` prints it). v1 documents (`classes` and `relationships`,
  no `kind`) keep working as class diagrams.

### Commands and output

- PNG output (`-o diagram.png` or `--format png`, `--scale 1` to `4`, default 2)
  next to SVG.
- New commands: `uml validate`, `uml example <kind>` (a minimal valid model to
  start from), `uml schema <kind>` and `uml kinds`.
- `uml <command> --help` describes one command.
- Text is measured with HarfBuzz using the bundled Inter font, and every SVG embeds
  the subset of the font it uses, so drawings look the same on every machine.

### Errors and warnings

- Validation reports every problem at once in `diagnostics`, each with a JSON
  Pointer path, and suggests corrections where they are clear: the nearest
  property or value for typos and names from other tools, the swapped `from`/`to`
  of a reversed relationship, bare text for keywords written with guillemets or
  guards written with brackets. `INVALID_JSON` gives the line and column, and file
  errors name the path and the reason.
- Every render runs the layout quality checks the test suite uses. A drawing that
  fails one is still written (exit 0) and stderr carries one JSON object,
  `{"warnings":[{"code":"LAYOUT_QUALITY", ...}]}`, with advice in terms of the
  model.
- `--strict` turns those warnings into an error: exit code 5, code
  `LAYOUT_QUALITY`, and nothing is written.

### Packaging

- `uml --version` and the help come from `package.json`. The help and the
  `RENDERER_MISSING` error show the path of the renderer setup script of the
  installed package.
- The package ships `THIRD_PARTY_NOTICES.md` (Inter under the OFL, the npm
  dependencies with their licenses, and the PlantUML and Java runtime that the
  setup script downloads).

## 0.1.0

Class-diagram MVP: validated JSON class models (v1 format) to SVG through a
pinned, sandboxed PlantUML with a local Java runtime.
