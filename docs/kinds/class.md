# Class diagram: notation checklist

Backend: own engine (default); PlantUML fallback via `--backend plantuml`.
Frame keyword: `class`. Schema: `uml schema class`. Code: `src/kinds/class/`.
UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `class` = `test/class.test.mjs`, `engine` =
`test/engine.test.mjs`, `unit` = `test/unit.test.mjs`, `integration` =
`test/integration/class.test.mjs`; fixtures in `test/fixtures/class/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Class | `elements[].type = "class"` | Rectangle; name compartment, name bold and centered (9.2.4) | class: "UML notation: keywords, stereotypes..." |
| Abstract class | `"abstract": true` | Name in italics (9.2.4) | class: same test, `Vehicle` bold italic |
| Interface | `type: "interface"` | Keyword «interface» above the name (10.4.4) | class: «interface» present |
| Enumeration | `type: "enumeration"`, `literals` | «enumeration», literals compartment one per line (10.2.4) | class: «enumeration»; example `notation` |
| Data type, primitive | `type: "datatype"` / `"primitive"` | «dataType» / «primitive» (10.2.4) | class: keywords present |
| Stereotypes | `stereotypes: ["a","b"]` | «a, b» above the name, comma-separated in one pair of guillemets (22.3.4) | class: «component, replaceable» |
| Compartments | attributes, operations | Name, attributes, operations compartments (9.2.4). One rule for every classifier: with no attribute and no operation only the name compartment is shown; with any member both member compartments are shown, an empty one as a thin empty band, so the reader always knows which is which. Enumerations always show their literals compartment and other compartments only when non-empty | gallery `notation`, `ordering` |
| Visibility | `visibility` | `+` public, `-` private, `#` protected, `~` package (7.4.4) | class: member formats |
| Attribute | `name`, `type`, `multiplicity`, `default`, `readOnly`, `derived` | `[vis] [/]name [: Type] [[mult]] [= default] [{readOnly}]` (9.5.4) | class: `- vin : String {readOnly}`, `# wheels : Wheel [2..*]`, `~ /age : Integer` |
| Static member | `static: true` | Underlined (9.4.4) | class: underline geometry check |
| Operation | `name`, `parameters`, `returnType`, `query` | `[vis] name(dir p : T [m] = d, ...) [: R] [{query}]`, `in` omitted (9.6.4) | class: `+ drive(km : Double, out log : Trip)`, `{query}` |
| Abstract operation | `abstract: true` | Italic (9.6.4) | class: italic check |
| Generalization | `type: "generalization"`, from = specific | Solid line, hollow triangle at the general classifier; edges to one parent share one arrowhead (tree style) (9.9.3) | class: "each relationship type..."; engine: shared port proof |
| Realization | `type: "realization"`, to = interface | Dashed line, hollow triangle at the interface (10.4.4) | class: markers and dash check |
| Association | `type: "association"`, `name` | Solid line, name near the middle (11.5.4) | class: markers; fixture "parallel associations" |
| Role name, multiplicity | `fromEnd` / `toEnd`: `role`, `multiplicity` | Placed near their end, on either side of the line (11.5.4) | gate `label-proximity` (near and unambiguous) on every fixture and example |
| Navigability | `navigable: true` / `false` | Open arrowhead / small cross at that end; omitted = unspecified (11.5.4) | class: `cross` at source, `open-arrow` at target |
| Shared aggregation | `type: "aggregation"`, from = whole | Hollow diamond at the whole (11.5.4) | class: `hollow-diamond` at source |
| Composite aggregation | `type: "composition"`, from = whole | Filled diamond at the whole (11.5.4) | class: `filled-diamond` at source |
| Dependency | `type: "dependency"`, `keyword` | Dashed line, open arrowhead at the supplier, «keyword» near the middle (7.7.4) | class: dashed + `open-arrow`; «use» present |
| Containment (nesting) | `type: "containment"`, from = owner | Solid line, circle with a plus at the owner (9.2.4, owned classifiers) | class: `circle-plus` at source |
| Note (comment) | `type: "note"`, `attachedTo` | Rectangle with folded corner, thin dotted lighter anchor line to each annotated element, distinct from dashed dependencies (7.2.4) | gallery `ordering`, `notation`; fixture "single note" |
| Self-association | `from` = `to` | First loop on the top-right corner, second on the bottom-right corner, further loops nested on the right side; labels inside their loop; one or two loops keep the box at its natural size | class: "self-associations stay inside..."; engine: self-loop proof |
| Diagram frame | `title` | Frame with pentagon heading `class <title>` (Annex A) | class: frame heading check |
| v1 documents | no `kind`, `classes` | inheritance = generalization, association = association, members verbatim | unit: v1 tests; class: "v1 MVP documents..." |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements and relationship IDs | `/elements/1/id`, `/relationships/0/id` |
| MISSING_REFERENCE | `from`, `to`, `attachedTo` name existing elements | `/relationships/0/to`, `/elements/1/attachedTo/0` |
| INVALID_ATTACHMENT | a note is not attached to a note | `/elements/1/attachedTo/0` |
| NOTE_IN_RELATIONSHIP | relationships connect classifiers; notes use `attachedTo` | `/relationships/0/from` |
| INHERITANCE_CYCLE | generalization is acyclic, no self-generalization | `/relationships/1`, `/relationships/0` |
| INVALID_GENERALIZATION | interfaces specialize only interfaces, classes only non-interfaces | `/relationships/0/to` |
| INVALID_REALIZATION | target is an interface; source is not an interface | `/relationships/0/to`, `/relationships/0/from` |
| INVALID_MULTIPLICITY | lower <= upper, upper > 0, `*` only as upper bound | `/relationships/0/toEnd/multiplicity`, `/elements/0/attributes/0/multiplicity`, parameter |
| INVALID_COMPOSITION | the whole end of a composition has upper bound <= 1 | `/relationships/0/fromEnd/multiplicity` |
| INVALID_NAVIGABILITY | no navigability on the diamond end | `/relationships/0/fromEnd/navigable` |
| DUPLICATE_MEMBER | attribute names and literals unique per classifier (operations may overload) | `/elements/0/attributes/1/name`, `/elements/0/literals/1` |
| ABSTRACT_OPERATION_IN_CONCRETE_CLASS | abstract operations only in abstract classes or interfaces | `/elements/0/operations/0/abstract` |
| DUPLICATE_RELATIONSHIP | no repeated generalization, realization or containment of the same pair | `/relationships/1` |
| CONTAINMENT_CYCLE | nesting is acyclic | `/relationships/1` |
| MULTIPLE_OWNERS | a classifier is nested in at most one owner | `/relationships/1/to` |
| SCHEMA_INVALID | unknown properties (e.g. `literals` on a class, `keyword` on an association, ends on a dependency), bad multiplicity syntax, unknown relationship types, missing `elements`, multi-line text | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/name`, `/elements/0/attributes/0/type` |
| UNKNOWN_KIND | `kind` is not registered | `/kind` |

## Unsupported (rejected by the schema)

- Association classes, n-ary associations (diamond), qualifiers, association end
  properties beyond role/multiplicity/navigability (`{ordered}`, `{unique}`,
  subsets): not drawn yet; model them with notes.
- Template parameters (dashed box at the top-right corner) and bound templates.
- Generalization sets (`{complete, disjoint}`), powertypes.
- Packages inside class diagrams: the package kind (chunk 1) covers them.
- Ports, parts and interfaces in lollipop/socket notation: component and composite
  structure kinds.
- Member constraints other than `{readOnly}` and `{query}`.

## Known limitations

- Layout: top-down (superclasses and wholes above) is the convention; left to right
  and ELK graph wrapping are tried too and the most readable result wins
  (`chooseLayout`, src/engine/aspect.ts: close to 4:3 to 16:9, few crossings, short
  lines, no detours; the more of the diagram is generalization, the more top-down
  is preferred). A wrapped layout whose lines would run round the drawing loses
  against a taller one with direct lines, so ordinary models can come out portrait.
  Routes are then repaired (src/engine/repair.ts). Very large or chain-like models
  can still end up 3:1 (the 50-class stress example).
- Four or more associations between the same two classes stack their end labels
  along a side; the labels stay unambiguous (gate `label-proximity`) but are dense.
- Where many edges converge on one side of a node, end labels move up to the gate's
  48 px limit.
- v1 documents (`classes`, `attributes` and `methods` as strings) draw each member
  string exactly as written: no visibility is added and the spacing around `:` is
  the author's, since v1 has no structured members. Use v2 members (`name`, `type`,
  `visibility`) for the UML 2.5.1 formatting `- name : Type`.
- PlantUML fallback: Smetana can put labels on nodes and draw note pointers through
  nodes, so that backend only guarantees the layout-independent gates
  (integration test `FALLBACK_GATES`).
