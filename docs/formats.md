# Exchange formats: PlantUML and Mermaid

The JSON model stays the source format. `uml export` writes a model as
PlantUML or Mermaid text, and `uml import` reads such text back into a model,
because those are the text formats people and agents already have, share and
paste into READMEs, wikis and issues. Why these two and not XMI:
[decision 0004](decisions/0004-exchange-formats.md).

```sh
uml export model.json --to plantuml               # stdout
uml export model.json --to mermaid -o diagram.mmd # format also inferred from .mmd/.puml
uml import diagram.puml -o model.json             # --from inferred from the extension
cat diagram.mmd | uml import - --from mermaid     # stdin needs --from
uml import notes.puml --kind sequence             # when the text alone does not tell
```

## Support per kind

| Kind | Export PlantUML | Export Mermaid | Import PlantUML | Import Mermaid |
|---|---|---|---|---|
| class | yes | yes (`classDiagram`) | yes | yes |
| object | yes | no | no | no |
| package | yes | no | no | no |
| profile | yes | no | no | no |
| communication | yes | no | no | no |
| interaction overview | yes | no | no | no |
| component | yes | no | no | no |
| deployment | yes | no | no | no |
| composite structure | yes | no | no | no |
| sequence | yes | yes (`sequenceDiagram`) | yes | yes |
| timing | yes | no | no | no |
| activity | yes | yes (`flowchart TD`) | yes | no |
| state machine | yes | yes (`stateDiagram-v2`) | yes | yes |
| use case | yes | yes (`flowchart LR`) | yes | no |

`uml kinds` lists the same in each kind's `exports` and `imports`.

Mermaid has no diagram type for the other kinds, or none that draws their
notation (a component diagram needs sockets, ports, assembly and delegation
connectors, which no Mermaid diagram has), so `uml export --to mermaid` fails
for them with `UNSUPPORTED_EXPORT` (exit 2); `details.formats` names the
formats that work.

## How the text is written

- **Readable, plain text.** No skin parameters or styles: the text is what a
  person would write. Model IDs become the aliases (`class "Order item" as
  order_item`), so references in the text read like the model.
- **IDs.** PlantUML and Mermaid aliases cannot contain `-`, so `order-item`
  becomes `order_item` (with a numeric suffix if that is taken). An ID that is a
  keyword of the format (`note`, `end`, `state`, ...) gets a suffix (`note_2`).
- **Escaping.** Only characters that would change the meaning of a line at
  that position are escaped: PlantUML `<U+XXXX>` tokens, Mermaid entity codes
  (`#35;`). Both formats draw the character, and the importer decodes it, so
  any text (quotes, colons, brackets, markup, `@enduml`, emoji, leading spaces)
  survives export and import unchanged and can never become a directive,
  markup or a new line.
- **Titles.** PlantUML `title`, Mermaid front matter (`title: "..."`).
- **Losses are reported, not hidden.** A construct the format cannot express is
  approximated or left out, and the export prints one JSON object on stderr
  with an `EXPORT_LOSSY` warning per construct and its JSON Pointer:
  `{"warnings":[{"code":"EXPORT_LOSSY","path":"/transitions/7","message":"..."}]}`.
  The text is still written and the exit code is 0.
- **Graph layout.** PlantUML class, state, use case and the description
  diagrams need a graph layout: Graphviz, or PlantUML's built-in Smetana with
  `!pragma layout smetana`. The export leaves that choice to the reader; the
  tests render every export with Smetana.

## How text is read

- The importer reads the part of each syntax that maps onto the model and
  nothing else. It never guesses: every line it cannot read is reported, all at
  once, in the usual error object, one diagnostic per line:
  `{"code":"UNSUPPORTED_SYNTAX"|"MALFORMED_LINE","path":"/lines/<n>","message":"Line <n>: ...","details":{"line":<n>,"text":"..."}}`.
  `UNSUPPORTED_SYNTAX` is valid in the format but has no place in the model
  (a `struct`, a decision question, a `box`); `MALFORMED_LINE` is not
  understood or contradicts an earlier line.
- Comments, blank lines and lines that only change presentation are skipped:
  PlantUML `skinparam`, `hide`, `show`, `scale`, `left to right direction`,
  `!theme`, `!pragma`, `<style>` blocks, `header`, `footer`, `caption`,
  `legend`, `|||` spacing; Mermaid `%%` comments and directives, front matter
  other than the title, `classDef`, `style`, `linkStyle`, `click`, `direction`,
  `cssClass`, Mermaid `rect` highlight blocks (their content is read).
- PlantUML preprocessor lines (`!include`, `!define`, variables, procedures)
  are reported, never followed. Only the first `@startuml` diagram is read.
- The kind: PlantUML is inferred from the content (class declarations and
  arrows, participants and messages, `[*]` and `state`, use cases and actors,
  `start`/`:action;`/`if`); Mermaid from the header (`classDiagram`,
  `sequenceDiagram`, `stateDiagram-v2`). `--kind <kind>` overrides it.
- The model then goes through the same validation as `uml validate`. A text
  that reads but describes an invalid model (an interface specializing a
  class) fails with `IMPORT_INVALID`: the diagnostics point into the model,
  which the error carries in `details.model`.
- Elements PlantUML or Mermaid create implicitly (a class first named in a
  relationship, a state first named in a transition) are created the same way
  by the importer, with the name as ID.
- Imported IDs: aliases are kept; names without an alias become IDs
  (`"Order item"` -> `Order_item`); nodes without any (activity nodes, `[*]`,
  notes) get IDs from their name or type (`check_stock`, `initial`, `merge_2`).

## Mappings

The tables show what each model construct is written as. For the import kinds,
the importer reads exactly these forms back (and the common variants listed
under "Also read").

### Class (PlantUML, both ways)

| Model | PlantUML |
|---|---|
| class, abstract class | `class "Name" as id`, `abstract class "Name" as id` (`class id` when the name is the ID) |
| interface, enumeration | `interface "Name" as id`, `enum "Name" as id` |
| datatype, primitive | `class "Name" as id <<dataType>>`, `<<primitive>>` |
| stereotypes | `<<a, b>>` after the alias |
| attribute | body line `-/name : Type [0..1] = default {readOnly}`, `{static}` before it |
| operation | body line `+name(in p : T [m] = d, out q : U) : R {query}`, `{static}`, `{abstract}` before it |
| enumeration literal | body line `LITERAL` |
| generalization, realization | `a --\|> b`, `a ..\|> b` |
| association | `a "role 0..1" -- "role *" b : name`, navigability `<--`, `-->`, `x--`, `--x` |
| aggregation, composition | `whole o-- part`, `whole *-- part` (`o-->`, `*--x` for the part end's navigability) |
| dependency | `a ..> b : <<keyword>> name` |
| containment | `owner +-- owned` |
| note | `note "text" as id`, attached with `id .. target` |

Also read: reversed arrows (`<\|--`, `--*`, `<..`), direction words (`-up->`),
`Name : member` lines, `note left of X : text` and `note as N ... end note`,
`{classifier}` for static, `{field}`/`{method}`, a trailing reading direction
(`: owns >`, dropped).

### Class (Mermaid, both ways)

| Model | Mermaid |
|---|---|
| classifier | `class id["Name"]` (`class id` when the name is the ID) |
| interface, enumeration, datatype, primitive | annotation `<<interface>>`, `<<enumeration>>`, `<<dataType>>`, `<<primitive>>` in the body |
| abstract class | annotation `<<abstract>>` |
| stereotypes | one `<<name>>` annotation each |
| attribute | body line `-/name : Type [0..1] = default #123;readOnly#125;`, `$` suffix when static |
| operation | body line `+name(p : T) : R`, `*` suffix when abstract, `$` when static |
| enumeration literal | body line `LITERAL` |
| relationships | as PlantUML: `--\|>`, `..\|>`, `--`, `-->`, `<--`, `<-->`, `o--`, `*--`, `*-->`, `..>`, end labels `"role 1"`, label `: «keyword» name` |
| note | `note for id "text"`, or `note "text"` when not attached |

Also read: Mermaid's own member style: type first (`+String name`), return
type after a space (`+speak() String`), `*`/`$` right after `()`, `~T~`
generics (read as `<T>`), `Id : member` lines, `<<annotation>> Id`.

### Sequence (PlantUML, both ways)

| Model | PlantUML |
|---|---|
| lifeline | `participant "name : Classifier" as id`; symbols `actor`, `boundary`, `control`, `entity` |
| synchronous, asynchronous, reply | `a -> b : name(args)`, `a ->> b`, `a --> b : x = name(args) : value` |
| create, delete message | `a -->> b ** : name`, `a -> b !! : name` |
| activate / deactivate flags | `++` (activates the receiver), `--` (deactivates the sender) after the receiver |
| found, lost message | `[o-> b`, `[o->> b`, `a ->o]`, `a ->>o]` |
| activation, deactivation, destruction | `activate a`, `deactivate a`, `destroy a` |
| state invariant | `hnote over a : {constraint}` |
| note | `note over a, b : text`, `note left of a : text` |
| interaction use | `ref over a, b : Name(args)` |
| alt, opt, loop, par, break, critical | the keyword with the guard, `else guard`, `end` |
| neg, strict, seq, assert, loop(min,max) | `group neg [guard]`, `group loop(1,3) [guard]` |
| autonumber | `autonumber` |

Also read: reverse arrows (`b <- a`), `|||` spacing (skipped).

### Sequence (Mermaid, both ways)

| Model | Mermaid |
|---|---|
| lifeline | `participant id as name : Classifier`, `actor id as ...` |
| synchronous, asynchronous, reply | `a->>b: name(args)`, `a-)b`, `a-->>b: x = name(args) : value` |
| create message | `create participant b as ...` then `a-->>b: name` |
| delete message | `destroy b` then `a->>b: name` |
| activate / deactivate flags | `a->>+b` (activates b), `a-->>-b` (deactivates a) |
| activation, deactivation | `activate a`, `deactivate a` |
| note | `Note over a,b: text`, `Note left of a: text` |
| alt, opt, loop, par, break, critical | the keyword with the guard; `else`, `and`, `option` for further operands; `end` |
| loop(min,max) | `loop (1,3) guard` |
| autonumber | `autonumber` |

### State machine (PlantUML, both ways)

| Model | PlantUML |
|---|---|
| state | `state "Name" as id`; submachine state `state "Name : Machine" as id` |
| entry, do, exit, internal | `id : entry / x`, `id : do / x`, `id : exit / x`, `id : trigger [guard] / effect` |
| composite state, regions | `state "Name" as id { ... }`, regions separated by `--` |
| entry, exit point | `state "name" as id <<entryPoint>>` / `<<exitPoint>>` inside the composite |
| initial, final | `state id <<start>>`, `state id <<end>>` |
| choice, fork, join | `<<choice>>`, `<<fork>>`, `<<join>>` |
| shallow, deep history | `<<history>>`, `<<history*>>` |
| junction, terminate | `<<junction>>`, `<<terminate>>` (PlantUML draws a box; see lossy cases) |
| transition | `a --> b : trigger [guard] / effect`, written in the innermost region holding both ends |
| note | `note right of id : text`; unattached: `note "text" as id` |

Also read: `[*] --> a` and `a --> [*]` (one initial and final per region,
created with fresh IDs), `state X : description`, states declared after a
transition named them.

### State machine (Mermaid, both ways)

| Model | Mermaid |
|---|---|
| state | `state "Name" as id` (submachine: `"Name : Machine"`), descriptions `id : entry / x` as in PlantUML |
| composite state | `state id { ... }` after the declaration, regions separated by `--` |
| initial, final, terminate | `[*] --> a`, `a --> [*]` |
| choice, fork, join | `state id <<choice>>`, `<<fork>>`, `<<join>>` |
| transition | `a --> b : trigger [guard] / effect`, in the region of its ends |
| note | `note right of id : text` |

### Use case (PlantUML, both ways)

| Model | PlantUML |
|---|---|
| actor | `actor "Name" as id <<stereotype>>` |
| use case | `usecase "Name" as id`; with extension points `usecase "Name\n--\nextension points\npoint" as id` |
| subject | `rectangle "Name" as id <<stereotype>> { use cases }` |
| association | `a "1" -- "0..*" b : name` |
| include | `a ..> b : <<include>>` |
| extend | `a ..> b : <<extend>>\ncondition: {c}\nextension point: p` |
| generalization | `a --\|> b` |
| note | `note "text" as id`, attached with `id .. target` |

Also read: `(Use case)` and `:Actor:` short forms, `usecase (Name) as id`,
`actor :Name: as id`, `-->` on associations (the arrowhead is dropped),
reversed arrows.

### Activity (PlantUML, both ways)

| Model | PlantUML |
|---|---|
| initial, activity final, flow final | `start`, `stop`, `end` |
| action | `:Name;` |
| call behavior, send signal, accept event | `:Name; <<procedure>>`, `:Name; <<output>>`, `:Name; <<input>>` |
| object node | `:Name\n[state]; <<object>>` |
| note | `note right` / text / `end note` after the node |
| decision with 2 branches | `if () then ([guard])` ... `else ([guard])` ... `endif` |
| decision with more branches | `switch ()`, `case ([guard])`, `endswitch` |
| fork and join | `fork`, `fork again`, `end fork` |
| loop, test first | `while () is ([guard])` ... `endwhile ([exit guard])` |
| loop, test last | `repeat` ... (`backward :Action;`) `repeat while () is ([guard]) not ([exit guard])` |
| partition | swimlane `\|Name\|`, all declared first in model order |

The graph is written through the activity kind's own structuring (the same
one the renderer uses), so every valid model exports. On import, a decision
gets a merge node when two or more branches continue past `endif`, a fork
always gets its join, and every loop is a merge and a decision.

### Mermaid flowcharts (export only)

Activity (`flowchart TD`, Mermaid 11 shapes):

| Model | Mermaid |
|---|---|
| initial, activity final, flow final | `id@{ shape: sm-circ }`, `@{ shape: fr-circ }`, `@{ shape: cross-circ }` |
| decision, merge | `id{" "}` |
| fork, join | `id@{ shape: fork }` |
| action, call behavior | `id("Name")`, `id[["Name"]]` |
| accept event, send signal | `id>"Name"]`, `id["Name"]` |
| object node | `id["Name<br>[state]"]` |
| partition | `subgraph id ["Name"]` holding its nodes |
| flow | `a --> b`, `a -->\|"[guard]"\| b` |
| note | `id_note@{ shape: brace, label: "text" }` joined with `node -.- id_note` |

Use case (`flowchart LR`):

| Model | Mermaid |
|---|---|
| actor | `id["«actor»<br>Name"]` |
| use case | `id(["Name"])`, extension points below the name |
| subject | `subgraph id ["Name"]` holding its use cases |
| association | `a --- b`, multiplicities and name as the label |
| include, extend | `a -.->\|"«include»"\| b`, `a -.->\|"«extend»<br>condition: {c}<br>extension point: p"\| b` |
| generalization | `a --> b` |
| note | `id@{ shape: brace, label: "text" }` joined with `id -.- target` |

### PlantUML export of the other kinds

| Kind | Written as |
|---|---|
| object | `object "name : Classifier" as id { feature = value }`, links `a "role" -- "role" b : name`, navigability arrows |
| package | `package "Name" as id <<s>> { members }`, classifiers as in class diagrams, `..>` with `<<import>>`, `<<access>>`, `<<merge>>`, `+--` containment |
| profile | `package "Name" as id <<profile>>`, stereotypes `class ... <<stereotype>>` with tagged values, metaclasses `<<metaclass>>`, extension `-->` (`{required}`), `<<apply>>`, `<<reference>>` |
| communication | lifelines `rectangle` (multi-objects `collections`), links `a -- b` labelled with the numbered messages (`1.2 [guard]: x = name(args): value` and an arrow sign) |
| interaction overview | a PlantUML state diagram: control nodes as `<<start>>`, `<<end>>`, `<<choice>>`, `<<fork>>`, `<<join>>`; interaction uses `state "ref\nName(args)"`, inline interactions `state "sd Name"` listing lifelines and messages; flows `a --> b : [guard]` |
| component | `component "Name" as id { port ...; nested }`, class parts `rectangle <<class>>`, `interface`, `artifact`, provided `owner -- iface`, required `owner --( iface`, assembly `a -(0- b`, delegation `<<delegate>>`, realization, usage, manifest, dependency |
| deployment | `node` (devices and execution environments by stereotype), `artifact`, `component`, deployment specifications `artifact ... <<deployment spec>>`, communication paths with multiplicities and `<<protocol>>`, `<<deploy>>`, `<<manifest>>` |
| composite structure | structured classes and parts as nested `rectangle`s (reference properties dashed), `port "name : ~Type [m]"`, collaboration uses as dashed `usecase`, role bindings `use .. part : role`, collaborations as dashed rectangles, connectors with end labels |
| timing | `robust`/`concise "name : Classifier" as id` with `has` states, `@t` / `id is state`, notes, duration constraints `id@a <-> @b : {min..max}`, messages `a@t1 -> b@t2`, highlights, time unit in the footer |

## Lossy cases

Every case below is reported as an `EXPORT_LOSSY` warning when it happens, and
the round-trip tests expect exactly these differences.

All formats and kinds:

- Relationship, transition, flow and item IDs (sequence messages, notes,
  fragments) are not kept; imported ones have none.
- `-` in an ID becomes `_`; a keyword ID gets a suffix.
- An empty list (`"stereotypes": []`) reads back as no list.

PlantUML:

- Class: an interface marked abstract is written as a plain interface.
- Sequence: a note or reference over more than two lifelines is written over
  the outermost two (PlantUML spans the columns between them).
- State machine: region IDs and names are not kept; an attached note gets a
  new ID and is written once per vertex; junction and terminate pseudostates
  are written as `<<junction>>`/`<<terminate>>` states, which PlantUML draws as
  boxes (they read back exactly). PlantUML keeps the second and later
  orthogonal regions of a composite state closed, so a transition into or out
  of such a region cannot be written and is left out; a model that needs one
  (a fork into two regions) reads back invalid
  (`examples/state-machine/notation.json`).
- Activity: nodes and partitions have no IDs in PlantUML (imported ones are
  made from names); with swimlanes, a node outside every partition is drawn in
  the swimlane current at its place; an explicit flow `type` equal to the
  inferred one is dropped.
- Use case: none beyond the general ones.
- Export-only kinds: profile extensions get an open arrowhead (PlantUML has no
  filled triangle); communication messages are text on their link, so their
  sorts look alike, and a message without a link gets one; interaction
  overview flow finals are drawn as finals, interaction uses and inline
  interactions as boxes headed `ref`/`sd`; component interface operations are
  not shown; a composite structure collaboration is a dashed rectangle; a
  timing time constraint highlights the window across all lifelines.

Mermaid:

- Class: no containment (written as an association) and no cross for a
  non-navigable end (left plain); notes get new IDs and are written once per
  target; an abstract interface or enumeration loses the mark; a stereotype
  named like a classifier type or `abstract` reads back as that type.
- Sequence: no boundary, control or entity symbols (plain participants); a
  created lifeline is declared at its create message, so it moves after the
  others; found and lost messages, state invariants and interaction uses
  become notes; a destruction without a message is left out; neg, strict, seq
  and assert fragments lose their frame; a message that both activates and
  deactivates gets a separate `deactivate` line; notes over more than two
  lifelines keep the outermost two.
- State machine: initial and final pseudostates have no IDs and there is one
  of each per region; terminate becomes final, junction becomes choice,
  history a state named `H`/`H*`, entry and exit points states inside the
  composite; region IDs and names are not kept; floating notes and notes on
  `[*]` are left out; Mermaid draws transitions only within one region, so a
  transition across a composite state's border is left out (a model that
  needs one reads back invalid: `examples/state-machine/notation.json`).
- Activity (export only): call behavior is a subroutine box without the
  rake, send signal a plain box, notes are comment shapes.
- Use case (export only): actors are boxes marked «actor», use cases
  stadiums, multiplicities part of the edge label, generalizations plain
  arrows, notes comment shapes.

## Tests

- `test/formats.test.mjs`: round trips JSON -> text -> JSON over every example
  of every import kind in both formats. The imported model must equal the
  original with the documented losses applied (`test/format-losses.mjs`,
  compared with object keys sorted; activity graphs compared by structure, as
  PlantUML has no node IDs), and exporting it again must give the same text.
  Also: every export of every example is one well-formed diagram, every
  Mermaid export passes `test/mermaid-check.mjs` (a strict structural check of
  the Mermaid grammar, without a Mermaid dependency), hand-written text in
  each format's documented style imports, and the CLI.
- `test/integration/formats.test.mjs`: every example of every kind is exported
  and rendered by the pinned PlantUML in one run, and every round-tripped
  model renders.

## README excerpt

```markdown
### Export and import: PlantUML and Mermaid

Models export to the text formats people already share, and import back:

    uml export model.json --to plantuml            # every kind
    uml export model.json --to mermaid -o d.mmd    # class, sequence, state machine, activity, use case
    uml import diagram.puml -o model.json          # class, sequence, state machine, use case, activity
    cat diagram.mmd | uml import - --from mermaid  # class, sequence, state machine

The text is plain and readable (your IDs become the aliases) and renders
natively on GitHub, GitLab and most wikis in the Mermaid case. Anything a
format cannot express is reported as an `EXPORT_LOSSY` warning with its JSON
path. Import reads the part of each syntax that maps onto the model and
reports every other line, with its line number, instead of guessing; the
result is validated like `uml validate`. Mapping tables and lossy cases:
[docs/formats.md](docs/formats.md).
```
