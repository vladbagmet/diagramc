# Object diagram: notation checklist

Backend: own engine. Frame keyword: `object`. Schema: `diagramc schema object`. Code:
`src/kinds/object/` (model mapping) on the shared pipeline `src/engine/diagram.ts`.
UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `object` = `test/object.test.mjs`, `engine` =
`test/engine-diagram.test.mjs`; fixtures in `test/fixtures/object/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Instance specification | `elements[].type = "instance"`, `name`, `classifier` | Rectangle; name compartment with `name : Classifier` underlined (9.8.4) | object: "instance names underlined as name : Classifier..." |
| Anonymous instance | `classifier` only | `: Classifier` underlined (9.8.4) | object: same test, `: Person` |
| Instance with unknown classifier | `name` only | `name` underlined (9.8.4) | object: same test, `bob` |
| Stereotypes | `stereotypes: ["entity"]` | «entity» above the name (12.3.4) | object: same test, «entity» |
| Slots | `slots[]`: `feature`, `type`, `value` | Slots compartment, one per line, `feature = value` or `feature : Type = value`, not underlined (9.8.4) | object: same test, `age : Integer = 34`, `nick = "Al"` |
| Link | `relationships[].type = "link"` | Solid line between the instances, like an association (9.8.4, 11.5.4) | object: "links are solid lines..." |
| Link name | `name`, `association` | `name : association` underlined near the middle; `: association` or `name` alone (9.8.4) | object: same test, `l1 : owns`, `l2` underlined |
| Role names | `fromEnd.role`, `toEnd.role` | Near their end, on either side of the line (9.8.4, 11.5.4) | object: same test (`data-uml-end`); gate `label-proximity` on every fixture and example |
| Navigability | `fromEnd.navigable`, `toEnd.navigable` | Open arrowhead (true) or small cross (false) at that end; omitted = unspecified (11.5.4) | object: same test, `cross` at source, `open-arrow` at target |
| Self link | `from` = `to` | Loop on the node's top-right corner (then bottom-right, then nested on the right side), role names inside the loop | object: "notes attach... a self link loops on the top-right corner"; fixture "self links" |
| Parallel links | several links between one pair | Separate lines, each with its own labels | fixture "parallel links between the same instances" |
| Note (comment) | `type: "note"`, `attachedTo` | Rectangle with folded corner, thin dotted anchor line to each annotated element (7.2.4) | object: dotted anchors; example `notation` |
| Diagram frame | `title` | Frame with pentagon heading `object <title>` (Annex A) | object: frame heading check |
| Classifier declarations | `classifiers[]`: `name`, `attributes` | Not drawn; when present, instance classifiers and slot features are checked | fixtures `UNKNOWN_CLASSIFIER`, `UNKNOWN_FEATURE` |

Links have no layout direction of their own: each is laid out from the instance
listed first in `elements` to the one listed later, so document order reads top
to bottom. Markers and role names stay at the ends the document gives them.

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements and link IDs | `/elements/1/id`, `/relationships/0/id` |
| MISSING_REFERENCE | `from`, `to`, `attachedTo` name existing elements (links to unknown instances are rejected) | `/relationships/0/to`, `/relationships/0/from`, `/elements/1/attachedTo/0` |
| NOTE_IN_RELATIONSHIP | links connect instances; notes use `attachedTo` | `/relationships/0/to` |
| INVALID_ATTACHMENT | a note is not attached to a note | `/elements/1/attachedTo/0` |
| UNNAMED_UNTYPED_INSTANCE | an instance has a name, a classifier or both | `/elements/0` |
| UNKNOWN_CLASSIFIER | with `classifiers` declared, every instance classifier is one of them | `/elements/0/classifier` |
| UNKNOWN_FEATURE | slots of an instance whose declared classifier lists `attributes` use those attributes | `/elements/0/slots/0/feature` |
| DUPLICATE_SLOT | at most one slot per feature in an instance | `/elements/0/slots/1/feature` |
| DUPLICATE_CLASSIFIER | classifier names declared once | `/classifiers/1/name` |
| DUPLICATE_MEMBER | declared attribute names unique per classifier | `/classifiers/0/attributes/1` |
| SCHEMA_INVALID | unknown properties (e.g. multiplicity on a link end, operations on a declaration), missing slot value, unknown element or relationship types, multi-line text | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/name`, `/elements/0/slots/0/value` |

## Unsupported (rejected by the schema)

- Instances of several classifiers (`a : A, B`) and instance value specifications
  (`x : Integer = 5` in the name compartment): use one classifier and a slot.
- Slot values that refer to other instances: draw a link instead.
- Aggregation and composition diamonds on links, n-ary links (diamond), qualifiers,
  link objects (instances of association classes).
- Multiplicities on link ends: links have none in UML.

## Known limitations

- The frame keyword `object` is not in Annex A's (non-exhaustive) list of frame
  kinds; it is used so the heading names the diagram kind.
- Layout tries top-down, left-to-right, narrower layering and graph wrapping and
  keeps the most readable result (`chooseLayout`). Dense, cyclic link graphs (the
  stress example) stay readable, with long orthogonal routes.
- The PNG shows emoji as "□" (decision 0003); the SVG keeps them.
