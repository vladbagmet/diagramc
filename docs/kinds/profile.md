# Profile diagram: notation checklist

Backend: own engine. Frame keyword: `profile`. Schema: `uml schema profile`. Code:
`src/kinds/profile/` (model mapping) on the shared pipeline `src/engine/diagram.ts`.
UML references are to UML 2.5.1 (formal/17-12-05), clause 12.3 (Profiles).

Tests referenced below: `profile` = `test/profile.test.mjs`, `engine` =
`test/engine-diagram.test.mjs`; fixtures in `test/fixtures/profile/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Profile | `elements[].type = "profile"`, `members` | Package tab folder with the «profile» keyword above the name, in the tab when it shows contents (12.3.4) | profile: "«profile» package, «stereotype» boxes..." |
| Package | `type: "package"`, `members` | Tab folder, e.g. a model that applies a profile or a metamodel (12.2.4) | example `ejb` |
| Stereotype | `type: "stereotype"` | Class rectangle with «stereotype» above the name (12.3.4) | profile: same test |
| Abstract stereotype | `abstract: true` | Name in italics (9.2.4) | profile: same test, `Bean` italic |
| Tag definitions | `attributes[]`: `name`, `type`, `multiplicity`, `default` | Attributes compartment, `name : Type [m] = default` (12.3.4, 9.5.4) | profile: same test, `state : StateKind = stateless`, `table : String [0..1]` |
| Metaclass | `type: "metaclass"` | Class rectangle with «metaclass» above the name (12.3.4) | profile: same test |
| Enumeration | `type: "enumeration"`, `literals` | «enumeration» and a literals compartment (10.2.4), e.g. a tag type | profile: same test |
| Class with applied stereotypes | `type: "class"`, `stereotypes` | «Session» above the name (12.3.4, 22.3.4) | profile: same test, «Session» |
| Extension | `type: "extension"`, from = stereotype, to = metaclass | Solid line, filled triangle at the metaclass; each extension has its own arrowhead; metaclass laid out above (12.3.4) | profile: "extension is a solid line..."; "each extension of one metaclass has its own arrowhead" |
| Required extension | `required: true` | `{required}` near the extension end, the end at the stereotype (12.3.4) | profile: same test (end label at the source) |
| Generalization | `type: "generalization"`, between stereotypes | Solid line, hollow triangle at the general stereotype, tree style (12.3.3, 9.9.3) | profile: same test |
| Profile application | `type: "apply"`, from = package, to = profile | Dashed line, open arrowhead at the profile, «apply» (12.3.4) | profile: same test |
| Metaclass / metamodel reference | `type: "reference"`, from = profile, to = metaclass or package | Dashed line, open arrowhead, «reference» (12.3.4) | profile: same test |
| Nesting | `members` on profiles and packages | Members inside the body, name and keyword in the tab (12.2.4) | profile: `data-uml-parent` check; fixture "profile nested in a package..." |
| Note (comment) | `type: "note"`, `attachedTo` | Rectangle with folded corner, dashed anchor lines (7.2.4) | example `ejb` |
| Diagram frame | `title` | Frame with pentagon heading `profile <title>` (Annex A) | profile: frame heading check |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements and relationship IDs | `/elements/1/id` |
| MISSING_REFERENCE | `members`, `from`, `to`, `attachedTo` name existing elements | `/relationships/0/to`, `/elements/0/members/0` |
| INVALID_EXTENSION | an extension goes from a stereotype to a metaclass | `/relationships/0/from`, `/relationships/0/to` |
| INVALID_GENERALIZATION | generalization connects stereotypes | `/relationships/0/to`, `/relationships/0/from` |
| INHERITANCE_CYCLE | generalization is acyclic, no self-generalization | `/relationships/1`, `/relationships/0` |
| INVALID_APPLICATION | a package or profile applies a profile, not itself | `/relationships/0/from`, `/relationships/0/to` |
| INVALID_REFERENCE | a profile references a metaclass or a metamodel package | `/relationships/0/from`, `/relationships/0/to` |
| STEREOTYPE_OUTSIDE_PROFILE | a stereotype is owned by a profile, never by a plain package (top level is allowed: the diagram shows a profile's content) | `/elements/0/members/0` |
| MULTIPLE_OWNERS | an element has at most one owner | `/elements/1/members/0` |
| CONTAINMENT_CYCLE | nesting is acyclic | `/elements/1/members/0` |
| RELATIONSHIP_WITH_OWN_MEMBER | no application or reference between a package and its own member | `/relationships/0` |
| DUPLICATE_RELATIONSHIP | no repeated relationship of one type between one pair | `/relationships/1` |
| DUPLICATE_MEMBER | tagged value names and literals unique per element | `/elements/0/attributes/1/name`, `/elements/0/literals/1` |
| INVALID_MULTIPLICITY | lower <= upper, upper > 0 | `/elements/0/attributes/0/multiplicity` |
| NOTE_IN_RELATIONSHIP | relationships do not connect notes | `/relationships/0/to` |
| INVALID_ATTACHMENT | a note is not attached to a note | `/elements/1/attachedTo/0` |
| SCHEMA_INVALID | unknown properties (e.g. `required` on a generalization, `attributes` on a metaclass, `members` on a stereotype), unknown relationship types | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/name` |

## Unsupported (rejected by the schema)

- Stereotype icons and images, and the iconic notation of stereotyped elements.
- Associations between stereotypes and metaclasses or other stereotypes.
- Operations and constraints on stereotypes; `{strict}` profile application.
- Tagged values of applied stereotypes (shown in compartments or notes on the
  extended element): only stereotype names are drawn on classes.
- Profile and metamodel URIs.

## Known limitations

- Layout is always top-down (metaclasses above their stereotypes, as in the UML
  figures); a profile with many cross-cutting extensions (the stress example) gets
  wide and its extension lines cross.
- The frame keyword `profile` is not in Annex A's (non-exhaustive) list; it names
  the diagram kind.
