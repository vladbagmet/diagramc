# Agent UML CLI

An agent-first CLI: validated JSON UML models in, readable SVG or PNG out. No
server, API key, browser, Graphviz or global installation. Rendering is offline.

Status (0.2.0): the foundation for all 14 UML 2.5.1 diagram kinds (see
[`docs/plans/full-uml-plan.md`](docs/plans/full-uml-plan.md)). **Class diagrams**
are complete on the own layout engine; the other kinds plug in through
[`docs/kinds/README.md`](docs/kinds/README.md).

## Setup

Requires Node.js 22+ and npm.

```sh
npm ci
npm run build
npm test                    # unit tests, no Java needed
```

Own-engine kinds (class, and later object, package, component, ...) need nothing
else. PlantUML kinds (sequence, timing, activity, state machine, use case, and the
`--backend plantuml` class fallback) need the pinned local renderer:

```sh
npm run setup:renderer      # PlantUML 1.2025.10 + Temurin JRE 21.0.11+10 into ignored .tools/
npm run test:integration    # real-renderer tests
npm run gallery             # every example of every kind -> artifacts/gallery/index.html
```

The setup script downloads SHA-256-verified, pinned official artifacts into
`.tools/` (macOS and Linux, arm64 and x64; Linux needs glibc), installs the pinned
Inter font into that runtime, and repairs interrupted or broken installs. About 70
MiB of downloads; nothing system-wide changes. For separately managed, trusted tools
set both `UML_JAVA` and `PLANTUML_JAR`.

## Use

```sh
uml render model.json -o diagram.svg          # or .png (2x by default)
cat model.json | uml render - -o diagram.png --scale 3
uml render model.json -o diagram.svg --backend plantuml
uml validate model.json                       # {"valid":true,"kind":"class","version":2}
uml kinds                                     # supported kinds as JSON
uml schema class                              # JSON Schema of a kind
uml --help
```

Run it with `npm exec --offline -- uml ...` or `./dist/cli.js ...`. The output
format follows the `-o` extension unless `--format svg|png` is given. Output is
replaced atomically, only after a successful render; its parent must exist.
Successful runs print nothing (except `validate`, `kinds`, `schema`).

## Model

Every document is a JSON object with a `kind`, an optional `title` (drawn as the
UML frame heading, for example **class** Ordering) and the kind's vocabulary.
`uml schema <kind>` prints the full contract with descriptions.

```json
{
  "kind": "class",
  "title": "Ordering",
  "elements": [
    { "id": "account", "type": "class", "name": "Account", "abstract": true,
      "attributes": [{ "name": "email", "type": "String", "visibility": "private" }] },
    { "id": "customer", "type": "class", "name": "Customer", "stereotypes": ["entity"],
      "operations": [{ "name": "placeOrder", "visibility": "public",
                       "parameters": [{ "name": "cart", "type": "Cart" }], "returnType": "Order" }] },
    { "id": "order", "type": "class", "name": "Order" },
    { "id": "n1", "type": "note", "text": "Orders are immutable once paid.", "attachedTo": ["order"] }
  ],
  "relationships": [
    { "type": "generalization", "from": "customer", "to": "account" },
    { "type": "association", "from": "customer", "to": "order", "name": "places",
      "fromEnd": { "multiplicity": "1" }, "toEnd": { "role": "orders", "multiplicity": "0..*", "navigable": true } }
  ]
}
```

Rules shared by all kinds:

- IDs: unique ASCII identifiers `[A-Za-z][A-Za-z0-9_-]{0,63}`, one namespace per
  document. Relationships use IDs, never names. IDs are never drawn.
- Display text is Unicode shown literally, never parsed as markup or code: single
  line, no control characters, bidi overrides/isolates, unpaired surrogates or
  U+FFFE/U+FFFF; nonblank. Names 1 to 100 code points, other text 1 to 180, notes
  1 to 1000 (wrapped). Quotes, braces, HTML-like syntax and repeated spaces stay literal.
- Input is UTF-8 JSON of at most 256 KiB. Unknown properties are errors.

### Class diagrams

Classes (abstract in italics), interfaces, enumerations, data types and primitives
with keywords in guillemets, stereotypes, visibility, static (underlined) and
abstract (italic) members, structured attributes `name : Type [mult] = default`
and operations `name(p : T) : R`. Relationships: `generalization` (from the specific
to the general classifier), `realization` (from the implementation to the
interface), `association` (name, role names, multiplicities, navigability),
`aggregation` and `composition` (from the whole to the part), `dependency` (from
client to supplier, optional «keyword»), `containment` (from the owner); notes.
Notation checklist, rules and limits: [`docs/kinds/class.md`](docs/kinds/class.md).
Examples: [`examples/class/`](examples/class/).

**v1 documents** (the MVP format: `classes` + `relationships`, no `kind`, see
[`schema/model-v1.schema.json`](schema/model-v1.schema.json) and
[`examples/v1/`](examples/v1/)) keep working as class diagrams; members are drawn
verbatim and error paths refer to the v1 document.

### Object diagrams

Instance specifications drawn `name : Classifier` underlined (`: Classifier` for
an anonymous instance, `name` when the classifier is not shown), with a slots
compartment (`feature = value`, `feature : Type = value`), and `link`s between
them: solid lines with an underlined `name : association`, role names and
navigability per end. Optional `classifiers` declarations make the validator check
classifier names and slot features. Links are laid out from the instance listed
first to the one listed later.

```json
{ "kind": "object", "elements": [
    { "id": "ann", "type": "instance", "name": "ann", "classifier": "Customer", "slots": [{ "feature": "name", "value": "\"Ann\"" }] },
    { "id": "o1", "type": "instance", "classifier": "Order" } ],
  "relationships": [{ "type": "link", "from": "ann", "to": "o1", "association": "places", "toEnd": { "role": "orders", "navigable": true } }] }
```

Checklist: [`docs/kinds/object.md`](docs/kinds/object.md). Examples: [`examples/object/`](examples/object/).

### Package diagrams

Packages as tab folders, nested through `members` (name in the tab when the
package shows contents, in the body otherwise), name-only classifiers and notes.
Relationships: `import` and `access` (from the importing package to a package or
classifier), `merge` (from the receiving to the merged package), `dependency`
(client to supplier, optional «keyword»), `containment` (from the owner, circle-plus,
an alternative to nesting). An element has one owner; ownership is acyclic.

```json
{ "kind": "package", "elements": [
    { "id": "app", "type": "package", "name": "app", "members": ["main"] },
    { "id": "main", "type": "class", "name": "Main" },
    { "id": "util", "type": "package", "name": "util" } ],
  "relationships": [{ "type": "import", "from": "app", "to": "util" }] }
```

Checklist: [`docs/kinds/package.md`](docs/kinds/package.md). Examples: [`examples/package/`](examples/package/).

### Profile diagrams

`profile`s (packages with «profile»), `stereotype`s with tag definitions as
attributes (abstract ones in italics), `metaclass`es, enumerations for tag types,
and packages and classes that use the profile. Relationships: `extension` (from a
stereotype to a metaclass, filled triangle, `required: true` adds {required}),
`generalization` between stereotypes, `apply` (from a package to a profile) and
`reference` (from a profile to a metaclass or metamodel package). Metaclasses are
drawn above their stereotypes.

```json
{ "kind": "profile", "elements": [
    { "id": "p", "type": "profile", "name": "Persistence", "members": ["entity", "class"] },
    { "id": "entity", "type": "stereotype", "name": "Entity", "attributes": [{ "name": "table", "type": "String" }] },
    { "id": "class", "type": "metaclass", "name": "Class" } ],
  "relationships": [{ "type": "extension", "from": "entity", "to": "class" }] }
```

Checklist: [`docs/kinds/profile.md`](docs/kinds/profile.md). Examples: [`examples/profile/`](examples/profile/).

## Errors

Errors are one JSON object on stderr; no output file is written or changed.

```json
{"error":{"code":"MISSING_REFERENCE","message":"Reference to unknown element \"missing\"","path":"/relationships/0/to","details":{"from":"customer","to":"missing"},"diagnostics":[...]}}
```

`path` is a JSON Pointer into the input; `diagnostics` lists every problem found
(fix them all in one pass). Exit codes: `0` success, `2` usage/input validation,
`3` renderer, `4` file I/O, `130`/`143` interrupted by SIGINT/SIGTERM. Codes
include `USAGE`, `INVALID_JSON`, `INVALID_ENCODING`, `INPUT_TOO_LARGE`,
`SCHEMA_INVALID` (details: every schema error), `INVALID_TEXT`, `UNKNOWN_KIND`,
`DUPLICATE_ID`, `MISSING_REFERENCE`, kind-specific rule codes (see
`docs/kinds/<kind>.md`), `UNSUPPORTED_BACKEND`, `RENDERER_MISSING`,
`RENDER_FAILED`, `RENDER_TIMEOUT`, `RENDER_OUTPUT_LIMIT`, `RENDER_INTERRUPTED`,
`RASTERIZE_FAILED`, `OUTPUT_WRITE_FAILED`.

## Rendering and safety

- **Hybrid backends.** Own engine (elkjs 0.11.1 layout + hand-written SVG) for
  class, object, package, profile, component, deployment, composite structure,
  communication and interaction overview; PlantUML for sequence, timing, activity,
  state machine and use case. Both share theme tokens (`src/core/theme.ts`).
- **Validation first.** The whole document is validated before any renderer is
  discovered or started.
- **Own engine SVG** is written by an escaping writer that only knows presentation
  elements: no scripts, links, `foreignObject`, images, event handlers or external
  references. The only `url(...)` is the embedded font subset (`data:` URL).
- **PlantUML** gets private aliases and UTF-16-unit-encoded display text, so input
  cannot become source lines, includes, links or markup. Java runs without a shell,
  with PlantUML's SECURE profile, 256 MiB heap, 20 s timeout, 8 MiB SVG and 64 KiB
  diagnostics limits; Java option injection variables are removed.
- **Fonts.** Text is measured with HarfBuzz using the pinned Inter font, and every
  SVG embeds the subset it uses, so it looks the same everywhere (within 0.2 % of
  Chrome's own measurement). See [`docs/decisions/0001-fonts.md`](docs/decisions/0001-fonts.md).
  Glyphs Inter lacks (CJK, emoji) come from the viewer's fonts. PNG export uses
  resvg; it shows emoji as "□".
- **Deterministic.** Repeated renders are byte-identical in the same environment.
- **Budgets.** A 50-class, 80-relationship diagram renders in well under 2 s.

## Quality assurance

`src/qa` inspects rendered SVGs and enforces hard gates on every fixture and
example: markup safety, everything inside the canvas, no node overlap (containment
allowed), no label overlapping a node, label or line, end labels near and
unambiguous at their end, edges ending on node borders (a package's tab or body), arrowheads present at the
right end and pointing inward, every input text drawn literally, minimum font size
11 px, text inside its box. Own-engine SVGs carry `data-uml-*` attributes so gates
are exact; PlantUML SVGs are checked best-effort. `npm run gallery` renders every
example to SVG and PNG with an `index.html` overview.

## Repository layout

```
src/cli.ts         commands
src/core/          errors, io, limits, text rules, theme tokens
src/model/         kind interface, registry, schema envelope, shared rules, parsing
src/kinds/<kind>/  one folder per diagram kind
src/engine/        fonts, text, SVG writer, ELK adapter, shapes, edges, labels, PNG
src/plantuml/      encoding, runner, skinparams, font embedding
src/qa/            SVG inspection and gates
docs/kinds/        recipe for new kinds and per-kind notation checklists
```

## Third-party licenses

Runtime npm dependencies: elkjs (EPL-2.0), harfbuzzjs (MIT), subset-font and
fontverter (BSD-3-Clause), wawoff2 (MIT), @resvg/resvg-js (MPL-2.0), Ajv (MIT;
fast-uri BSD-3-Clause). Notices stay under `node_modules/`. The Inter font is
under the SIL Open Font License 1.1 ([`assets/fonts/OFL.txt`](assets/fonts/OFL.txt)).
The downloaded PlantUML jar reports GPL v3 or later (`java -jar <jar> -license`,
which also states that generated images are not covered by its GPL); Temurin's
`NOTICE` and `legal/` directory carry GPL v2 with Classpath Exception. Downloaded
tools are not part of the npm package.
