# Changelog

## 1.1.1 (2026-10-24)

- Text containing `$&`, `$'`, `` $` ``, `$$` or `$1` now stays literal in
  sequence and timing diagrams. Before, a participant name next to an actor head
  or a duration constraint label with such a pattern was expanded as a
  replacement pattern while the SVG was post-processed, which broke the SVG and
  made `render` fail with `INTERNAL_ERROR`. Every string replacement on drawn
  output now passes its value through a function, so no pattern is expanded.
- Runtime dependencies: elkjs 0.12.0 (layout engine; every example renders
  as before), harfbuzzjs 1.6.3 and zod 4.6.7. elkjs now declares
  `EPL-2.0 OR GPL-3.0-or-later`; diagramc still uses it under EPL-2.0, and
  `THIRD_PARTY_NOTICES.md` carries its new license text.
- Development tools: ESLint 10, @eslint/js 10 and eslint-plugin-unicorn 78,
  with the code fixed or the rules configured for their new checks.

## 1.1.0 (2026-10-24)

- The project is renamed to diagramc, to leave room for diagram families beyond
  UML. The npm package `agent-uml-cli` is now `diagramc`, the `uml` command is
  now `diagramc`, the repository moves from `vladbagmet/uml_cli` to
  `vladbagmet/diagramc`, and the `UML_JAVA` environment variable is now
  `DIAGRAMC_JAVA` (`PLANTUML_JAR` is unchanged). The skill directory follows
  the binary (`skills/diagramc/`), and so do the MCP server name and its tools
  (`diagramc_kinds`, `diagramc_render` and so on). Release tarballs are named
  `diagramc-<version>.tgz`. The model format, the diagram kinds and their
  output are unchanged.
- Agent entry points. `skills/diagramc/SKILL.md` is a usage skill in the Agent
  Skills format (discovery, the write, validate and render loop, reading errors
  and warnings, export and import, renderer setup, limits), with a per-kind
  cheat sheet in `skills/diagramc/reference.md` generated from the kinds and
  schemas. Both ship in the package.
- New command `diagramc guide [reference]` prints that skill (or the cheat sheet)
  from the installed package; `diagramc --help` points to it in its first lines.
- New command `diagramc mcp` runs a stdio MCP server with the tools
  `diagramc_kinds`, `diagramc_example`, `diagramc_schema`, `diagramc_validate`,
  `diagramc_render`, `diagramc_export` and `diagramc_import`. They call the same
  code as the commands and return what the commands print; a failure is a tool
  error carrying the same `{"error":...}` object, warnings a second item.
  `diagramc_render` returns SVG text or a PNG image, or writes the file given as
  `output`. Client configuration for Claude Code, Codex and JSON-configured
  clients is in the README.
- New runtime dependencies for the MCP server: `@modelcontextprotocol/sdk`
  1.32.1 and `zod` 4.6.6 (both MIT). `fast-uri` moves to 3.1.9 for its
  security advisories.
- New command `diagramc export <model.json|-> --to plantuml|mermaid [-o file]`:
  writes a model as readable PlantUML (all 14 kinds) or Mermaid (class,
  sequence, state machine, and activity and use case as flowcharts). Model IDs
  become the aliases; constructs a format cannot express are reported as
  `EXPORT_LOSSY` warnings with their JSON path. Kinds Mermaid cannot draw fail
  with `UNSUPPORTED_EXPORT`.
- New command `diagramc import <file.puml|file.mmd|-> [--from plantuml|mermaid]
  [--kind <kind>] [-o model.json]`: reads PlantUML (class, sequence, state
  machine, use case, activity) or Mermaid (class, sequence, state machine)
  into a validated model. The format follows the file extension and the kind
  the content; every line that cannot be read is reported at once with its
  line number (`UNSUPPORTED_SYNTAX`, `MALFORMED_LINE`), and a model that reads
  but breaks a rule fails with `IMPORT_INVALID`.
- `diagramc kinds` lists, per kind, the formats it `exports` to and `imports` from.
- Mapping tables, lossy cases and import rules: `docs/formats.md`; why
  PlantUML and Mermaid and not XMI: `docs/decisions/0004-exchange-formats.md`.
- Deployment, component and composite structure layouts no longer let a line
  between elements of two top-level containers decide their order: the
  containers can sit side by side. The deployment stress example now passes
  every layout check (5120 x 3892 instead of 3906 x 6762, no lines around a region).
- `-o /dev/stdout` works on Linux when the output is a socket, as it is for a
  process started from Node. The output now goes through the process stream
  instead of opening the path, which Linux refused with `OUTPUT_WRITE_FAILED`.

### Development

- `npm run check` runs everything a pull request must pass: `npm run typecheck`
  (now also with `exactOptionalPropertyTypes`), `npm run lint` (ESLint 9 with
  typescript-eslint strict and stylistic type-checked rules and unicorn),
  `npm run format:check` (Prettier), `npm run test:coverage` (unit tests with
  line, branch and function thresholds of 90, 80 and 90 percent over `src/`)
  and `npm run gallery`. GitHub Actions runs the checks on Node 22 and 24.
- Stress render budgets measure CPU time instead of wall-clock time, and tests
  that need the PlantUML runtime are skipped with a reason when it is missing.

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
  (`diagramc schema <kind>` prints it). v1 documents (`classes` and `relationships`,
  no `kind`) keep working as class diagrams.

### Commands and output

- PNG output (`-o diagram.png` or `--format png`, `--scale 1` to `4`, default 2)
  next to SVG.
- New commands: `diagramc validate`, `diagramc example <kind>` (a minimal valid model to
  start from), `diagramc schema <kind>` and `diagramc kinds`.
- `diagramc <command> --help` describes one command.
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

- `diagramc --version` and the help come from `package.json`. The help and the
  `RENDERER_MISSING` error show the path of the renderer setup script of the
  installed package.
- The package ships `THIRD_PARTY_NOTICES.md` (Inter under the OFL, the npm
  dependencies with their licenses, and the PlantUML and Java runtime that the
  setup script downloads).

## 0.1.0

Class-diagram MVP: validated JSON class models (v1 format) to SVG through a
pinned, sandboxed PlantUML with a local Java runtime.
