# Writing models

The model format, kind by kind: what each kind draws, which way its
relationships point, and a minimal model to start from. Each section links the
kind's notation checklist, which lists every construct with its rules and
limits. The quickest start is still `uml example <kind>`, then
`uml schema <kind>` to look properties up and `uml validate` to check.

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
  [`schema/model-v1.schema.json`](../schema/model-v1.schema.json) and
  [`examples/v1/`](../examples/v1/)) keep working as class diagrams; members are
  drawn verbatim and error paths refer to the v1 document.

## Class diagrams

Classes (abstract in italics), interfaces, enumerations, data types and primitives
with keywords in guillemets, stereotypes, visibility, static (underlined) and
abstract (italic) members, structured attributes `name : Type [mult] = default`
and operations `name(p : T) : R`. Relationships: `generalization` (from the specific
to the general classifier), `realization` (from the implementation to the
interface), `association` (name, role names, multiplicities, navigability),
`aggregation` and `composition` (from the whole to the part), `dependency` (from
client to supplier, optional «keyword»), `containment` (from the owner); notes.
Notation checklist, rules and limits: [`kinds/class.md`](kinds/class.md).
Examples: [`examples/class/`](../examples/class/).

## Component diagrams

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

Checklist and rules: [`kinds/component.md`](kinds/component.md).
Examples: [`examples/component/`](../examples/component/).

## Deployment diagrams

Nodes as 3D boxes, devices (`«device»`) and execution environments
(`«executionEnvironment»`) nested in one another, artifacts and deployment
specifications deployed by nesting them in a node or with a `deploy` dependency
(`from` the artifact `to` the node), `manifest` from an artifact to a component,
communication paths (solid lines with a `«protocol»`, a name and end
multiplicities), dependencies and notes. Checklist and rules:
[`kinds/deployment.md`](kinds/deployment.md). Examples:
[`examples/deployment/`](../examples/deployment/).

## Composite structure diagrams

A structured class with its parts (`name : Type [multiplicity]`, dashed when
`aggregation` is `shared` or `none`), ports on the class and on parts (conjugated
ports drawn `~Type`), connectors with a name, an association type, end names and
multiplicities, collaborations (dashed ellipses with roles) and collaboration uses
whose bindings link roles to parts. Checklist and rules:
[`kinds/composite-structure.md`](kinds/composite-structure.md).
Examples: [`examples/composite-structure/`](../examples/composite-structure/).

## Object diagrams

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

Checklist: [`kinds/object.md`](kinds/object.md). Examples: [`examples/object/`](../examples/object/).

## Package diagrams

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

Checklist: [`kinds/package.md`](kinds/package.md). Examples: [`examples/package/`](../examples/package/).

## Profile diagrams

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

Checklist: [`kinds/profile.md`](kinds/profile.md). Examples: [`examples/profile/`](../examples/profile/).

## Communication diagrams

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

Checklist and rules: [`kinds/communication.md`](kinds/communication.md).
Examples: [`examples/communication/`](../examples/communication/).

## Interaction overview diagrams

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

Checklist and rules: [`kinds/interaction-overview.md`](kinds/interaction-overview.md).
Examples: [`examples/interaction-overview/`](../examples/interaction-overview/).

## Sequence diagrams

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

Checklist and rules: [`kinds/sequence.md`](kinds/sequence.md).
Examples: [`examples/sequence/`](../examples/sequence/).

## Timing diagrams

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

Checklist and rules: [`kinds/timing.md`](kinds/timing.md).
Examples: [`examples/timing/`](../examples/timing/).

## Activity diagrams

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

Checklist and rules: [`kinds/activity.md`](kinds/activity.md).
Examples: [`examples/activity/`](../examples/activity/).

## State machine diagrams

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

Checklist and rules: [`kinds/state-machine.md`](kinds/state-machine.md).
Examples: [`examples/state-machine/`](../examples/state-machine/).

## Use case diagrams

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

Checklist and rules: [`kinds/use-case.md`](kinds/use-case.md).
Examples: [`examples/use-case/`](../examples/use-case/).
