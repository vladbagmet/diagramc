# Agent UML CLI

A small agent-friendly CLI: validated JSON class models in, readable SVG out.
No server, API key, Graphviz, or global tooling installation is required.

**Review artifact:** [`artifacts/review.svg`](artifacts/review.svg), generated from
[`examples/order-system.json`](examples/order-system.json). It has six classes,
member compartments, four associations, and one inheritance relationship.

## Clean setup

Requires Node.js 22+ and npm. Automatic renderer setup supports macOS and Linux
on arm64 and x64. Linux requires glibc and the platform libraries/fonts used by
Temurin, not a minimal musl-only environment. Setup requires HTTPS access to official
GitHub releases and the standard `tar` command. Rendering afterwards is offline.

```sh
npm ci
npm run setup:renderer
npm run build
npm test
npm run test:integration
npm run render:example
```

The setup script downloads SHA-256-verified, pinned official artifacts into
ignored `.tools/`: PlantUML **1.2025.10** and Eclipse Temurin JRE **21.0.11+10**.
It always provisions the local JRE, avoiding Java availability and version drift.
There are no Homebrew, global npm, or system-wide changes.
On macOS arm64, downloads total about **70 MiB** and `.tools/` uses about
**221 MiB**, including the retained runtime archive. The extracted JRE is about
151 MiB. Sizes differ by platform. Re-running setup verifies cached downloads.
Extraction is staged and checked before replacing the local runtime. Rerun setup
after an interrupted download/extraction or a broken local installation; it repairs
the managed runtime without requiring manual deletion.

## Use

The package declares the `uml` executable. Run it locally, without installing
anything globally:

```sh
npm exec --offline -- uml render examples/simple.json -o diagram.svg
cat examples/unicode.json | npm exec --offline -- uml render - -o unicode.svg
npm exec --offline -- uml --help
```

`npm pack` builds first and includes the executable, schema, examples and setup
script, but not downloaded tools. Installing that tarball in another npm project
exposes `uml` to npm scripts and `npm exec --offline -- uml`, not the global shell
PATH. From that project, provision its local renderer with
`node node_modules/agent-uml-cli/scripts/setup-renderer.mjs`, or use both trusted
environment overrides below.

`./dist/cli.js` is also executable after building. The output parent directory
must exist and the filename must end in `.svg`. Successful rendering is silent.
Existing output is atomically replaced only after successful validation and rendering.

## Model v1

The checked-in contract is [`schema/model-v1.schema.json`](schema/model-v1.schema.json).
The version belongs to the schema filename, not an extra model field.

```json
{
  "classes": [
    { "id": "account", "name": "Account", "attributes": ["id: UUID"] },
    { "id": "customer", "name": "Customer", "methods": ["placeOrder(): Order"] }
  ],
  "relationships": [
    { "type": "inheritance", "from": "customer", "to": "account" }
  ]
}
```

- `inheritance`: **from subclass to superclass**, with the hollow triangle at the superclass.
- `association`: undirected line, optionally with `label`. `from` and `to` identify endpoints.
- IDs: unique ASCII identifiers, `[A-Za-z][A-Za-z0-9_-]{0,63}`. Relationships use IDs, never names.
- Names and members are Unicode display text, not parsed code. Names have 1 to 100 code points;
  members and labels have 1 to 180. Each attribute and method list has at most 20 entries.
- Input is UTF-8 JSON, at most 256 KiB, with 1 to 50 classes and at most 100 relationships.
- Text must be nonblank and single-line, without control characters, bidi overrides/isolates,
  unpaired surrogates, or XML-forbidden U+FFFE/U+FFFF. Quotes, braces, HTML-like syntax,
  backslashes and leading/repeated/trailing spaces display literally.
- Unknown fields, unsupported relationship types, missing references, duplicate IDs and
  inheritance cycles, including self-inheritance, are errors. Association cycles are legal.

See all five models in [`examples/`](examples/).

## Errors and safety

Errors are one JSON object on stderr. No SVG is written to stdout.

```json
{"error":{"code":"MISSING_REFERENCE","message":"Relationship references an unknown class","details":{"from":"customer","to":"missing"}}}
```

Exit codes: `0` success, `2` usage/input validation, `3` renderer, `4` file I/O.
SIGINT/SIGTERM during rendering stop Java, preserve output and report
`RENDER_INTERRUPTED` with exit `130`/`143`, respectively.
Stable error codes also include `INVALID_JSON`, `SCHEMA_INVALID`, `DUPLICATE_ID`,
`INHERITANCE_CYCLE`, `RENDER_TIMEOUT`, and `OUTPUT_WRITE_FAILED`.
Schema errors include structured paths and validation keywords.

Validation finishes before renderer discovery or execution. Generated source uses
private aliases and UTF-16-unit-encoded display text. Fixed invisible boundaries
preserve whitespace and prevent class names from becoming generic-type syntax. Input cannot
introduce source lines, includes, links or markup. Java is spawned without a shell,
with PlantUML's **SECURE** profile, a 256 MiB heap, 20-second timeout, 8 MiB SVG limit
and 64 KiB diagnostic limit. Inherited Java option injection variables are removed.

For separately managed, trusted tools, set both `UML_JAVA` (Java executable path)
and `PLANTUML_JAR` (jar path). Overrides change the pinned environment and are
not a way to provide untrusted executables or jars.

## Backend and limits

PlantUML runs in its JVM with the built-in **Smetana** structural layout engine.
It needs no native Graphviz installation. The light theme and left-to-right layout
are fixed. Smetana is not Graphviz-equivalent: routing can be less sophisticated on
dense graphs, and large models or long unwrapped labels can produce wide diagrams.
The SVG viewport is expanded when Smetana clips self-association curves/labels above it.
Bounds protect resources, not aesthetic quality for every possible graph.

Only class diagrams and SVG are supported. There is no raw PlantUML input, code
extraction, custom styling, other diagram type, PNG/PDF export, LLM, MCP or daemon.
The PNG review preview is a browser QA artifact, not a CLI feature.

Repeated renders are tested byte-for-byte in the same pinned environment. Java's
logical SansSerif font uses locally available fonts, so glyph coverage, metrics and
output can differ across machines. Unicode text is preserved, but installed fonts
still determine whether every glyph displays correctly.

`npm test` uses Node's test runner, fake subprocesses, isolated setup fixtures and
an offline package smoke test; no Java or downloads are needed.
`npm run test:integration` requires renderer setup and covers all five examples,
literal hostile/Unicode/whitespace text, self-association bounds and determinism.

## Third-party licenses

The default PlantUML jar reports GPL v3 or later through `java -jar <jar> -license`.
That command also explains that rendered images are not covered by PlantUML's GPL
solely because it rendered them. Its jar retains bundled third-party notices.
Temurin's `NOTICE` and `legal/` directory retain GPL v2 with Classpath Exception and
component notices. These downloaded tools are not included in the npm tarball;
redistributing them carries their upstream license obligations.

Node dependencies keep their notices under `node_modules/`: Ajv and most runtime
dependencies are MIT, `fast-uri` is BSD-3-Clause. Development dependencies include
TypeScript (Apache-2.0) and Node type definitions (MIT).
