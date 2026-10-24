---
name: uml
description: Draws UML 2.5.1 diagrams (class, sequence, state machine, activity, component, deployment, use case and every other kind) as SVG or PNG from a JSON model with the offline `uml` CLI or its MCP server, validates the model with JSON Pointer diagnostics, and converts to and from PlantUML and Mermaid. Use when asked to draw, render, check or convert a UML diagram, or to turn PlantUML or Mermaid text into a checked model.
---

# uml: validated JSON models to UML diagrams

`uml` checks one JSON model of one UML diagram against its kind's schema and
rules, draws it as SVG or PNG offline and checks the drawing for layout defects.
Use it whenever a task needs a UML diagram file, a checked UML model, or
PlantUML or Mermaid text from a model or back; prefer it to hand-written SVG,
PlantUML or Mermaid, which nothing validates.

If `uml` is not on the PATH, try `npx uml`. `uml <command> --help` describes
every option.

## Discover before writing

```sh
uml kinds                 # the 14 kinds: summary, backends, export and import formats (JSON)
uml example sequence      # a minimal valid model of a kind: start from this
uml schema state-machine  # the kind's JSON Schema: every property, allowed values
uml guide reference       # the per-kind cheat sheet (also reference.md next to this file)
```

[reference.md](reference.md) lists, per kind, the top-level properties and the
`type` values of each list with what each requires: read that section first.

## The loop: write, validate, render

```sh
uml example class > model.json        # 1. start from the example
uml validate model.json               # 2. {"valid":true,"kind":"class","version":2}
uml render model.json -o diagram.svg  # 3. draw; prints nothing on success
cat model.json | uml validate -       # "-" reads the model from stdin
```

Edit the model, then validate until it passes, then render. Model rules shared
by every kind:

- `kind` names the diagram; `title` (optional) becomes the frame heading.
- Every element has an `id`: an ASCII letter, then letters, digits, `_` or `-`.
  IDs are never drawn. Relationships refer to IDs (`from`, `to`), never names.
- Direction: `from` is the source. A generalization goes from the specific to
  the general element; a dependency from the client to the supplier.
- Text is drawn literally. Write keywords and stereotypes without guillemets
  (`"use"`, not `"«use»"`) and guards without brackets (`"x > 0"`, not `"[x > 0]"`).
- Unknown properties are errors. Input is UTF-8 JSON of at most 256 KiB.

## Read the error, fix everything, run again

A failure prints one JSON object on stderr and writes no file:

```json
{"error":{"code":"SCHEMA_INVALID","message":"3 problems; fix all of them ...","path":"/elements/0/methods",
 "diagnostics":[
  {"code":"SCHEMA_INVALID","path":"/elements/0/methods","message":"Unknown property \"methods\" ...; did you mean \"operations\"",
   "details":{"rule":"additionalProperties","allowed":["id","type","name","..."],"suggestion":"operations"}},
  {"code":"SCHEMA_INVALID","path":"/relationships/0/type","message":"... \"inheritance\" ...; did you mean \"generalization\"",
   "details":{"rule":"discriminator","value":"inheritance","suggestion":"generalization"}},
  {"code":"MISSING_REFERENCE","path":"/relationships/0/to","message":"After the corrections above: ...",
   "details":{"to":"c","suggestion":"a","afterFixes":true}}]}}
```

- `diagnostics` lists every problem. Fix all of them in one edit, not just the first.
- `path` is a JSON Pointer into your model: `/relationships/0/type`.
- `details.suggestion` is the corrected value or property name when it is clear;
  `details.swap` the corrected `from`/`to` of a relationship that looks reversed;
  `details.afterFixes` marks problems found by assuming the suggestions applied.

Exit codes: `0` success (warnings possible), `2` invalid model or usage, `3`
renderer, `4` file I/O, `5` layout check failed under `--strict`.

## Layout warnings and --strict

Every render runs layout checks (overlaps, labels on lines, missing arrowheads,
text outside its box). A failed check still writes the file and exits 0, but
prints on stderr:

```json
{"warnings":[{"code":"LAYOUT_QUALITY","gate":"label-edge-crossing","message":"...","count":1,
  "problems":["label \"places\" crosses edge r3"],"advice":"A line runs through a label. Shorter labels ..."}]}
```

Read `advice`: it says what to change in the model (shorter labels, fewer
crossing relationships, splitting the diagram), or that the defect is the
renderer's and the model cannot avoid it. To refuse a flawed drawing, add
`--strict`: exit 5, code `LAYOUT_QUALITY`, the warnings in `details.warnings`,
and nothing is written.

## SVG or PNG

The `-o` extension picks the format; `--format svg|png` overrides it.

```sh
uml render model.json -o diagram.svg --strict    # fail instead of warning
uml render model.json -o diagram.png             # PNG at 2x pixel density
uml render model.json -o diagram.png --scale 3   # --scale 1 to 4, PNG only
uml render model.json -o diagram.svg --backend plantuml  # class only: draw with PlantUML
```

SVG (font embedded) suits docs and the web and is text you can inspect; PNG
suits places that do not show SVG (chat, slides). The output's parent directory
must exist; the file is replaced only after a successful render.

## Export and import

```sh
uml export model.json --to plantuml               # every kind, to stdout
uml export model.json --to mermaid -o diagram.mmd # class, sequence, activity, state-machine, use-case
uml export model.json --to plantuml -o diagram.puml
uml import diagram.puml -o imported.json          # format from the extension
cat diagram.mmd | uml import - --from mermaid     # stdin needs --from
```

`uml kinds` lists each kind's `exports` and `imports`. Export reports what the
format cannot express as `{"warnings":[{"code":"EXPORT_LOSSY","path","message"}]}`
and still succeeds; a kind the format cannot draw fails with
`UNSUPPORTED_EXPORT` and names the formats that work. Import reads only what
maps onto the model and reports every other line at once as
`UNSUPPORTED_SYNTAX` or `MALFORMED_LINE` with path `/lines/<n>`; pass
`--kind <kind>` when the text does not make the kind clear. A model that reads
but breaks a rule fails with `IMPORT_INVALID`, the model in `details.model`.

## Sequence, timing and activity need the renderer

These three kinds (and class with `--backend plantuml`) are drawn by a pinned
PlantUML on a private Java runtime. Without it, rendering them fails with exit
3, code `RENDERER_MISSING`, and `details.setup` holds the exact command, for
example `node ".../scripts/setup-renderer.mjs"`. Run it once (about 60 MiB,
SHA-256 pinned, installed inside the package, no system changes), or ask the
user to, then render again. Validate, export and import work without it. Or
set both `UML_JAVA` and `PLANTUML_JAR` to a trusted Java and jar.

## As MCP tools

`uml mcp` runs a stdio MCP server with the tools `uml_kinds`, `uml_example`,
`uml_schema`, `uml_validate`, `uml_render`, `uml_export` and `uml_import`. They
take a model as a JSON object, JSON text or a `file` path and return what the
commands print; a failure is a tool error carrying the same `{"error":...}`
object, and warnings come as a second item. `uml_render` returns SVG text or a
PNG image, or writes `output` when it is given.

## Limits

- One diagram of one kind per model. Split a large system into several
  diagrams: very large ones get wide or tall and collect layout warnings.
- Names 1 to 100 characters, other text 1 to 180, notes 1 to 1000, single line;
  lists are bounded (150 class elements, 300 sequence items; see the schema).
- Activity swimlanes accept well-structured flows only: crossing branches are
  rejected with an error that says what to write instead.
- PNG draws emoji as boxes; SVG keeps them.
