# Agent UML CLI

`uml` turns a JSON model into a UML diagram, as SVG or PNG. It supports all 14
UML 2.5.1 diagram kinds: class, object, package, profile, component, deployment,
composite structure, communication, interaction overview, sequence, timing,
activity, state machine and use case. It is built for agents as users: every
model is validated against a published JSON Schema, errors are one JSON object
that lists every problem (with a fix where one is clear), and each drawing is checked for
layout defects before it is written. Rendering is offline and needs no server,
API key, browser, Graphviz or global installation.

Version 1.0.0. Changes: [CHANGELOG.md](CHANGELOG.md).

## Install

Requires Node.js 22 or later and npm.

From a source checkout:

```sh
npm ci
npm run build              # dist/cli.js, run it as ./dist/cli.js or npm exec --offline -- uml
npm test                   # unit tests, no Java needed
```

As a package in another project (the package is not published to a registry;
build the tarball with `npm pack` in a checkout):

```sh
npm install /path/to/agent-uml-cli-1.0.0.tgz
npx uml --help             # or npm exec --offline -- uml --help
```

### PlantUML renderer (sequence, timing, activity)

Eleven kinds use the built-in engine and need nothing else. Sequence, timing and
activity diagrams (and class diagrams with `--backend plantuml`) are drawn by a
pinned PlantUML running on a private Java runtime, which a setup script downloads
once:

```sh
npm run setup:renderer                                     # in a source checkout
node node_modules/agent-uml-cli/scripts/setup-renderer.mjs # in a project that installed the package
```

It downloads PlantUML 1.2025.10 and the Eclipse Temurin JRE 21.0.11+10 (about 70
MiB, about 220 MiB on disk) from their official GitHub releases, checks each
against a pinned SHA-256, and unpacks them into the package's own `.tools/`
directory. It runs on macOS and Linux, arm64 and x64 (Linux needs glibc and
`tar`), changes nothing system-wide, and repairs an interrupted or broken
install when run again. After that, rendering is offline. `uml --help` prints
the exact setup command for the installed copy. The runtime lives inside the
installed package, so after npm replaces the package (an upgrade, a clean
install) run the setup again; `RENDERER_MISSING` says so. To use a separately managed,
trusted Java and PlantUML jar instead, set both `UML_JAVA` and `PLANTUML_JAR`.

### Fonts

Nothing to install. The Inter font (SIL Open Font License) ships with the
package: the built-in engine measures text with it, every SVG embeds the subset
it uses, PNG output uses it, and the setup script installs it into the private
Java runtime so PlantUML measures with the same font. Glyphs Inter lacks (CJK,
emoji) come from the viewer's fonts in SVG.

## Quick start

```sh
uml example class > model.json                # a minimal valid model to start from
uml schema class                              # JSON Schema of a kind: every property, allowed values
uml validate model.json                       # {"valid":true,"kind":"class","version":2}
uml render model.json -o diagram.svg          # or .png (2x by default)
cat model.json | uml render - -o diagram.png --scale 3
uml render model.json -o diagram.svg --backend plantuml
uml render model.json -o diagram.svg --strict # fail instead of warning on layout defects
uml kinds                                     # the 14 kinds and their backends as JSON
uml render --help                             # every command has its own help
```

Writing a model: start from `uml example <kind>`, look properties up in
`uml schema <kind>`, then `uml validate`. When validation fails, the error lists
every problem with a corrected value where one is clear (see
[Errors](#errors)).

The output format follows the `-o` extension unless `--format svg|png` is given;
`--scale 1` to `4` sets the PNG pixel density. The output is replaced
atomically, only after a successful render, and its parent directory must
exist. An existing device or pipe (`-o /dev/null --format svg`,
`-o /dev/stdout`) is written directly. Successful runs print nothing on stdout,
except `validate`, `example`, `kinds` and `schema`.

## Diagram kinds

| Kind | `kind` | Backend | Frame keyword | Checklist | Examples |
|---|---|---|---|---|---|
| Class | `class` | own engine (PlantUML with `--backend plantuml`) | `class` | [class.md](docs/kinds/class.md) | [examples/class](examples/class/) |
| Object | `object` | own engine | `object` | [object.md](docs/kinds/object.md) | [examples/object](examples/object/) |
| Package | `package` | own engine | `package` | [package.md](docs/kinds/package.md) | [examples/package](examples/package/) |
| Profile | `profile` | own engine | `profile` | [profile.md](docs/kinds/profile.md) | [examples/profile](examples/profile/) |
| Communication | `communication` | own engine | `sd` | [communication.md](docs/kinds/communication.md) | [examples/communication](examples/communication/) |
| Interaction overview | `interaction-overview` | own engine | `sd` | [interaction-overview.md](docs/kinds/interaction-overview.md) | [examples/interaction-overview](examples/interaction-overview/) |
| Component | `component` | own engine | `cmp` | [component.md](docs/kinds/component.md) | [examples/component](examples/component/) |
| Deployment | `deployment` | own engine | `dep` | [deployment.md](docs/kinds/deployment.md) | [examples/deployment](examples/deployment/) |
| Composite structure | `composite-structure` | own engine | `class` | [composite-structure.md](docs/kinds/composite-structure.md) | [examples/composite-structure](examples/composite-structure/) |
| Sequence | `sequence` | PlantUML | `sd` | [sequence.md](docs/kinds/sequence.md) | [examples/sequence](examples/sequence/) |
| Timing | `timing` | PlantUML | `sd` | [timing.md](docs/kinds/timing.md) | [examples/timing](examples/timing/) |
| Activity | `activity` | PlantUML | `act` | [activity.md](docs/kinds/activity.md) | [examples/activity](examples/activity/) |
| State machine | `state-machine` | own engine | `stm` | [state-machine.md](docs/kinds/state-machine.md) | [examples/state-machine](examples/state-machine/) |
| Use case | `use-case` | own engine | `uc` | [use-case.md](docs/kinds/use-case.md) | [examples/use-case](examples/use-case/) |

The own engine is elkjs 0.11.1 layout with hand-written SVG. PlantUML 1.2025.10
uses its dedicated sequence, timing and activity engines (and Smetana for the
class fallback, never Graphviz), and its output is post-processed to UML
notation. Both share one theme (`src/core/theme.ts`). Each checklist lists the
supported notation, the semantic rules, what is rejected, and the kind's known
limitations.

## Writing models

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
- v1 documents (the 0.1 format: `classes` + `relationships`, no `kind`, see
  [`schema/model-v1.schema.json`](schema/model-v1.schema.json) and
  [`examples/v1/`](examples/v1/)) keep working as class diagrams; members are
  drawn verbatim and error paths refer to the v1 document.

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

### Component diagrams

Components (`«component»` and the component icon), nested components and classes,
ports (squares on the border), provided interfaces (lollipops) and required
interfaces (sockets) listed by interface ID in `provides` / `requires`, assembly
connectors drawn as ball-and-socket joints, delegation connectors from a port to a
part inside, interfaces as classifiers with `realization` and `usage`, artifacts
with `manifest`, dependencies and notes. Layout runs left to right: an `assembly`
goes `from` the requiring port or component `to` the providing one; a
`delegation` goes from the delegating end to the handling end (outer port to part
for provided interfaces, part to outer port for required ones).

```json
{ "kind": "component", "elements": [
    { "id": "ui", "type": "component", "name": "Web UI", "requires": ["api"] },
    { "id": "svc", "type": "component", "name": "Orders", "ports": [{ "id": "p", "name": "api", "provides": ["api"] }] },
    { "id": "api", "type": "interface", "name": "IOrders" } ],
  "relationships": [{ "type": "assembly", "from": "ui", "to": "p", "interface": "api" }] }
```

Checklist and rules: [`docs/kinds/component.md`](docs/kinds/component.md).
Examples: [`examples/component/`](examples/component/).

### Deployment diagrams

Nodes as 3D boxes, devices (`«device»`) and execution environments
(`«executionEnvironment»`) nested in one another, artifacts and deployment
specifications deployed by nesting them in a node or with a `deploy` dependency
(`from` the artifact `to` the node), `manifest` from an artifact to a component,
communication paths (solid lines with a `«protocol»`, a name and end
multiplicities), dependencies and notes. Checklist and rules:
[`docs/kinds/deployment.md`](docs/kinds/deployment.md). Examples:
[`examples/deployment/`](examples/deployment/).

### Composite structure diagrams

A structured class with its parts (`name : Type [multiplicity]`, dashed when
`aggregation` is `shared` or `none`), ports on the class and on parts (conjugated
ports drawn `~Type`), connectors with a name, an association type, end names and
multiplicities, collaborations (dashed ellipses with roles) and collaboration uses
whose bindings link roles to parts. Checklist and rules:
[`docs/kinds/composite-structure.md`](docs/kinds/composite-structure.md).
Examples: [`examples/composite-structure/`](examples/composite-structure/).

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

### Communication diagrams

`lifelines` (rectangles `name : Type`, optional selector, multi-object stacks),
undirected `links` between them, and `messages` that travel on links: `from` is
the sender, `to` the receiver, `sequence` a decimal number (`1`, `1.2`, `2a`).
Each message is listed beside its link with an arrow toward the receiver (filled
for synchronous, open for asynchronous, dashed for replies), with optional guard,
iteration, arguments, assignment and return value. A nested message (`1.2`) is
sent by the receiver of its parent (`1`); every message needs a link (a self-link
for self-messages).

```json
{ "kind": "communication",
  "lifelines": [{ "id": "c", "name": "client", "type": "Client" }, { "id": "s", "type": "Server" }],
  "links": [{ "from": "c", "to": "s" }],
  "messages": [{ "sequence": "1", "from": "c", "to": "s", "name": "ping", "arguments": [] }] }
```

Checklist and rules: [`docs/kinds/communication.md`](docs/kinds/communication.md).
Examples: [`examples/communication/`](examples/communication/).

### Interaction overview diagrams

A top-down control flow: `nodes` of type `initial`, `final`, `flow-final`,
`decision`, `merge`, `fork`, `join`, `interaction-use` (a `ref` frame naming
another interaction) and `interaction` (an inline `sd` frame with its own
lifelines and messages), connected by `flows` from `from` to `to`. Flows leaving a
decision carry a `guard`. Optional `lifelines` go into the frame heading. Exactly
one initial node; every node reachable; every path ends in a final node.

```json
{ "kind": "interaction-overview",
  "nodes": [{ "id": "start", "type": "initial" }, { "id": "login", "type": "interaction-use", "name": "Login" }, { "id": "end", "type": "final" }],
  "flows": [{ "from": "start", "to": "login" }, { "from": "login", "to": "end" }] }
```

Checklist and rules: [`docs/kinds/interaction-overview.md`](docs/kinds/interaction-overview.md).
Examples: [`examples/interaction-overview/`](examples/interaction-overview/).

### Sequence diagrams

Drawn by PlantUML, post-processed to UML notation (guards in regular weight,
notes kept clear of other lifelines, found and lost messages inside their
fragment). `lifelines` (left to right; `name`, `classifier`, `symbol`
rectangle, actor, boundary, control or entity) and `items` in time order, top to
bottom: `message` from `from` to `to` with a `sort` (synchronous: filled
arrowhead; asynchronous: open; reply: dashed, open; create: dashed to the new
lifeline's head; delete: ends in the X of `to`), `found` and `lost` messages,
`activate`/`deactivate` (or `activate: true` on a message for the receiver,
`deactivate: true` for the sender), `destroy`, `stateInvariant`, `note`, `ref`
(interaction use over `covered` lifelines) and `fragment` (`operator` alt, opt,
loop with `min`/`max`, par, break, critical, neg, strict, seq, assert; `operands`
with optional `guard`, written without brackets, and their own items). A created
lifeline must not appear before its create message, nothing may follow a
destruction, and activations end in the operand where they start (end one that
spans a fragment with a `deactivate` item after the fragment).

```json
{ "kind": "sequence", "title": "Ping",
  "lifelines": [{ "id": "c", "name": "client", "classifier": "Client" }, { "id": "s", "classifier": "Server" }],
  "items": [
    { "type": "message", "sort": "synchronous", "from": "c", "to": "s", "name": "ping", "arguments": [], "activate": true },
    { "type": "message", "sort": "reply", "from": "s", "to": "c", "name": "ping", "returnValue": "pong", "deactivate": true }] }
```

Checklist and rules: [`docs/kinds/sequence.md`](docs/kinds/sequence.md).
Examples: [`examples/sequence/`](examples/sequence/).

### Timing diagrams

Drawn by PlantUML. `lifelines` (top to bottom) with `notation` robust (one row per
state, a stepped state line) or concise (values in bands), their declared
`states` and `changes` (`at`, `state`) in increasing time order. All times are
integers in `timeUnit`, which labels the time axis (for 2.5 s use `"ms"` and
2500). Optional `messages` (sent by `from` at `fromTime`, received by `to` at
`toTime`), `durationConstraints` (arrow labelled `{min..max}` in a band above its
lifeline, with dotted lines to the two times), `timeConstraints` (the change of
`lifeline` at `at` must happen within `[from, to]`: a shaded window in that
lifeline's row), `highlights` and `notes` (concise lifelines). The time scale
follows what has to fit between two times; text that cannot fit even on the
widest axis (3200 px) is rejected with `TIMELINE_TOO_DENSE` and the room it needs,
never drawn over other text.

```json
{ "kind": "timing", "title": "Blink", "timeUnit": "s",
  "lifelines": [{ "id": "led", "name": "led", "notation": "robust", "states": ["On", "Off"],
    "changes": [{ "at": 0, "state": "Off" }, { "at": 1, "state": "On" }, { "at": 2, "state": "Off" }] }] }
```

Checklist and rules: [`docs/kinds/timing.md`](docs/kinds/timing.md).
Examples: [`examples/timing/`](examples/timing/).

### Activity diagrams

Drawn by PlantUML's activity engine (needs the pinned renderer). `nodes` of type
`action`, `callBehavior` (with the rake symbol), `sendSignal`, `acceptEvent`,
`object` (with an optional `[state]`), `initial`, `activityFinal`, `flowFinal`,
`decision`, `merge`, `fork` and `join`, connected by `edges` from `from` to `to`
(`type` control or object, inferred when omitted). Flows leaving a decision carry
a `guard` written without brackets; executable nodes may carry a `note`, attached
with a dashed line; optional `partitions` become swimlanes, and two-way decisions
may send their branches to other swimlanes (a decision with more than two branches
keeps them in its own swimlane, `DECISION_SPANS_PARTITIONS`, and the error spells
out the equivalent nested two-way decisions). The branches of a decision or fork
must each occupy their own run of adjacent swimlanes, neighbours sharing at most
one (`BRANCHES_SHARE_PARTITIONS`): PlantUML draws branches side by side in every
swimlane they use, so interleaved branches would cross each other. Decisions and
merges, forks and joins are explicit nodes (an action has at most one incoming and
one outgoing flow), and the graph must be well structured: each decision closes at
its own merge, each fork at its join, loops enter at a merge and leave through one
decision. Anything else is rejected with `UNSTRUCTURED_FLOW` and the node where the
structure breaks.

```json
{ "kind": "activity",
  "nodes": [{ "id": "i", "type": "initial" }, { "id": "a", "type": "action", "name": "Brew coffee" }, { "id": "f", "type": "activityFinal" }],
  "edges": [{ "type": "control", "from": "i", "to": "a" }, { "type": "control", "from": "a", "to": "f" }] }
```

Checklist and rules: [`docs/kinds/activity.md`](docs/kinds/activity.md).
Examples: [`examples/activity/`](examples/activity/).

### State machine diagrams

Own engine. `elements` are states and pseudostates (`initial`, `final`, `choice`,
`junction`, `fork`, `join`, `shallowHistory`, `deepHistory`, `terminate`) and
notes. A state has optional `entry`, `doActivity`, `exit` and `internal`
transitions; with `regions` it is a composite state (several regions are
orthogonal, separated by dashed lines), with `submachine` a submachine state, and
composite or submachine states may have `connectionPoints` (entry and exit points
on their border). `transitions` (top level, any depth) go from `from` to `to` and
are labeled `trigger [guard] / effect`.

```json
{ "kind": "state-machine",
  "elements": [{ "id": "i", "type": "initial" }, { "id": "off", "type": "state", "name": "Off" }, { "id": "on", "type": "state", "name": "On" }],
  "transitions": [{ "from": "i", "to": "off" }, { "from": "off", "to": "on", "trigger": "switchOn" }] }
```

Checklist and rules: [`docs/kinds/state-machine.md`](docs/kinds/state-machine.md).
Examples: [`examples/state-machine/`](examples/state-machine/).

### Use case diagrams

Own engine. `elements`: `actor`s (stick figures), `useCase`s (ellipses, with
optional `extensionPoints`, inside the `subject` they name), `subject`s (system
boundaries) and notes. `relationships`: `association` (actor and use case, optional
multiplicities; `from` is placed left of `to`, so primary actors go in `from`),
`include` (from the base to the included use case), `extend` (from the extending
to the base use case, naming one of the base's `extensionPoint`s, optional
`condition` shown in a note) and `generalization` (from specific to general).

```json
{ "kind": "use-case",
  "elements": [{ "id": "c", "type": "actor", "name": "Customer" }, { "id": "s", "type": "subject", "name": "ATM" }, { "id": "w", "type": "useCase", "name": "Withdraw cash", "subject": "s" }],
  "relationships": [{ "type": "association", "from": "c", "to": "w" }] }
```

Checklist and rules: [`docs/kinds/use-case.md`](docs/kinds/use-case.md).
Examples: [`examples/use-case/`](examples/use-case/).

## Errors

Errors are one JSON object on stderr; no output file is written or changed.

```json
{"error":{"code":"SCHEMA_INVALID","message":"2 problems; fix all of them (each is also listed in \"diagnostics\" with its path): (1) Unknown property \"methods\" in /elements/0 (type \"class\"); did you mean \"operations\". Allowed properties: id, type, name, stereotypes, attributes, operations, abstract (2) /relationships/0/type is \"inheritance\", which is not a known type; did you mean \"generalization\". Allowed values: \"generalization\", \"realization\", ...","path":"/elements/0/methods","diagnostics":[{"code":"SCHEMA_INVALID","path":"/elements/0/methods","message":"...","details":{"rule":"additionalProperties","property":"methods","allowed":["id","type","name","stereotypes","attributes","operations","abstract"],"suggestion":"operations"}},{"code":"SCHEMA_INVALID","path":"/relationships/0/type","message":"...","details":{"rule":"discriminator","allowed":["generalization","realization","association","aggregation","composition","dependency","containment"],"value":"inheritance","suggestion":"generalization"}}]}}
```

Written so an agent can fix a model in one round:

- `diagnostics` lists every problem, one entry per problem, in document order,
  each with a JSON Pointer `path`; `message` summarises all of them; `code` and
  `path` are the first one's.
- Unknown properties list the allowed ones and the nearest match (typos and names
  from other tools: `methods` -> `operations`, `label` -> `name`, `source`/`target`
  -> `from`/`to`, `participants` -> `lifelines`, `tags` -> `attributes`, ...).
  Wrong `type` (or other enumerated) values list the allowed values and the nearest
  one (`inheritance` -> `generalization`, `"type": "alt"` -> a fragment with
  `"operator": "alt"`). Formats are described in words with examples, never as a
  regular expression (`"0..n"` -> `"0..*"`, `"engine.tank"` -> `"engine-tank"`).
- `details.suggestion` holds the corrected value or property name where it is
  clear; `details.swap` the corrected `from`/`to` when a relationship looks
  reversed. Problems that appear once those corrections are made are reported in
  the same error, marked `details.afterFixes`.
- Unknown kinds, IDs and commands get "did you mean"; a reference by name points
  at the ID; keywords written with guillemets and guards or constraints written
  with their brackets are rejected with the bare text (the diagram adds them).
- `INVALID_JSON` gives the line, column and a hint (trailing comma, comment,
  single quotes); file errors name the path and the reason (`errno`).
- `RENDERER_MISSING` names the setup command for the installed copy in
  `details.setup`.

Exit codes: `0` success (possibly with layout warnings), `2` usage or input
validation, `3` renderer, `4` file I/O, `5` layout check failed under `--strict`,
`130`/`143` interrupted by SIGINT/SIGTERM. Codes include `USAGE`, `INVALID_JSON`,
`INVALID_ENCODING`, `INPUT_TOO_LARGE`, `INPUT_READ_FAILED`, `SCHEMA_INVALID`,
`INVALID_TEXT`, `UNKNOWN_KIND`, `DUPLICATE_ID`, `MISSING_REFERENCE`, kind-specific
rule codes (see `docs/kinds/<kind>.md`), `UNSUPPORTED_BACKEND`,
`RENDERER_MISSING`, `RENDER_FAILED`, `RENDER_TIMEOUT`, `RENDER_OUTPUT_LIMIT`,
`RENDER_INTERRUPTED`, `RASTERIZE_FAILED`, `OUTPUT_WRITE_FAILED`, `LAYOUT_QUALITY`.

### Layout warnings and `--strict`

Every render runs the same quality gates the test suite uses (a few
milliseconds; see [Quality assurance](#quality-assurance)). When the drawing
fails one, the file is still written and the exit code is 0, but stderr carries
one JSON object with one warning per failed gate:

```json
{"warnings":[{"code":"LAYOUT_QUALITY","gate":"label-edge-crossing","message":"Layout check \"label-edge-crossing\" found 1 problem: label \"places\" crosses edge r3","count":1,"problems":["label \"places\" crosses edge r3"],"advice":"A line runs through a label. Shorter labels or fewer crossing relationships usually help."}]}
```

`problems` holds up to five of the gate's findings; `advice` says what usually
helps for those kinds of problem, in terms of the model, or that the problem is a
renderer defect the model cannot avoid (`src/qa/advice.ts`). With `--strict` the
same finding is an error instead: exit code 5, code `LAYOUT_QUALITY`, the
warnings in `details.warnings`, and no output is written or changed. Some dense
layouts still produce warnings; the ones the test suite tolerates for now are
listed with their review findings in `test/known-gate-failures.mjs`.

## Limits and known limitations

- **Input.** UTF-8 JSON, at most 256 KiB. Names 1 to 100 code points, other text
  1 to 180, notes 1 to 1000. Rendered SVG is capped at 8 MiB; PlantUML gets a 20 s
  timeout and a 256 MiB heap.
- **Emoji in PNG.** No emoji font is bundled, so PNG output draws an emoji as a
  box ("□"); the SVG keeps the emoji for the viewer's fonts. CJK and other scripts
  Inter lacks come from system fonts in PNG
  ([decision 0003](docs/decisions/0003-png-text.md)).
- **Activity swimlanes.** PlantUML draws the branches of a decision or fork side
  by side in every swimlane they use, so structures that would cross are rejected
  rather than drawn badly: a decision with more than two branches must keep them
  in its own swimlane (`DECISION_SPANS_PARTITIONS`, the error spells out the
  equivalent nested two-way decisions), branches must each occupy their own run
  of adjacent swimlanes (`BRANCHES_SHARE_PARTITIONS`), and the flow must be well
  structured (`UNSTRUCTURED_FLOW`).
- **Very large diagrams** get wide or tall rather than crowded (several thousand
  pixels on one side, or a long column), and dense ones keep long routes and can
  produce layout warnings. Splitting a model into several diagrams reads better.
  Timing diagrams too dense for a 3200 px axis are rejected with
  `TIMELINE_TOO_DENSE` and the room they need. Inline interactions in an
  interaction overview have at most 6 lifelines and 12 messages.
- **Two backends, one look.** Colors, sizes and the font match, but PlantUML
  kinds draw glyphs through Java, so they can differ slightly from own-engine
  kinds. PlantUML output is checked by the same gates on a best-effort reading of
  its SVG.
- **Platforms.** The renderer setup supports macOS and Linux (glibc) on arm64 and
  x64. Other systems are not tested.

Per-kind limitations are in each `docs/kinds/<kind>.md`.

## Rendering and safety

- **Validation first.** The whole document is validated before any renderer is
  discovered or started.
- **Own engine SVG** is written by an escaping writer that only knows presentation
  elements: no scripts, links, `foreignObject`, images, event handlers or external
  references. The only `url(...)` is the embedded font subset (`data:` URL).
- **PlantUML** gets private aliases and UTF-16-unit-encoded display text, so input
  cannot become source lines, includes, links or markup. Java runs without a shell,
  with PlantUML's SECURE profile, 256 MiB heap, 20 s timeout, 8 MiB SVG and 64 KiB
  diagnostics limits; Java option injection variables are removed.
- **Fonts.** Text is measured with HarfBuzz using the pinned Inter font, within
  0.2 % of Chrome's own measurement
  ([decision 0001](docs/decisions/0001-fonts.md)). PNG export uses resvg and keeps
  Inter and bold for the Latin part of mixed-script lines.
- **Deterministic.** Repeated renders are byte-identical in the same environment.
- **Budgets.** A 50-class, 80-relationship diagram renders in well under 2 s.

## Quality assurance

`src/qa` inspects rendered SVGs and enforces hard gates on every fixture and
example: markup safety, everything inside the canvas, no node overlap (containment
allowed), no label overlapping a node, label or line, end labels near and
unambiguous at their end, edges ending on node borders, no two lines sharing a
segment, no needless detours, arrowheads present and
pointing inward, message arrows beside their own link, every input text drawn
literally, minimum font size 11 px, text inside its box, ports on their owner's
border and interface symbols facing outward. Own-engine SVGs carry `data-uml-*`
attributes so gates are exact; PlantUML SVGs are checked best-effort, with a
dedicated reader for sequence and timing diagrams (lifelines, activation bars,
messages, state lines) that adds the `message-endpoints` and `lifeline-crossing`
gates. Gates without data are reported as skipped. Known failures that are
still being fixed are listed, each with its review finding, in
`test/known-gate-failures.mjs`; that list only shrinks.

## Development

```sh
npm test                   # build, then unit tests (no Java needed)
npm run setup:renderer     # once, for the PlantUML kinds
npm run test:integration   # real-renderer tests, every gate on every example
npm run gallery            # every example of every kind -> artifacts/gallery/index.html
```

```
src/cli.ts         commands and help
src/render.ts      backend selection, rendering, layout warnings
src/core/          errors, io, limits, text rules, theme tokens
src/model/         kind interface, registry, schema envelope, shared rules, parsing
src/kinds/<kind>/  one folder per diagram kind
src/engine/        fonts, text, SVG writer, ELK adapter, shapes, edges, labels, PNG
src/plantuml/      encoding, runner, skinparams, font embedding
src/qa/            SVG inspection and gates
docs/kinds/        recipe for new kinds and per-kind notation checklists
docs/decisions/    design decisions
```

## Licenses

Third-party components keep their own licenses, listed with their texts in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): the Inter font (SIL Open Font
License 1.1, [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt)), the npm
dependencies (elkjs EPL-2.0, @resvg/resvg-js MPL-2.0, harfbuzzjs MIT,
subset-font BSD-3-Clause, Ajv MIT and their dependencies), and the PlantUML jar
(GPL v3 or later; generated images are not covered by it) and Temurin JRE (GPL v2
with Classpath Exception) that the setup script downloads. Downloaded tools are
not part of the package.
