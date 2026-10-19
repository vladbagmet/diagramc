# Package diagram: notation checklist

Backend: own engine. Frame keyword: `package`. Schema: `uml schema package`. Code:
`src/kinds/package/` (model mapping) on the shared pipeline `src/engine/diagram.ts`
and the package shape in `src/engine/packages.ts`. UML references are to UML 2.5.1
(formal/17-12-05).

Tests referenced below: `package` = `test/package-diagram.test.mjs`, `engine` =
`test/engine-diagram.test.mjs`; fixtures in `test/fixtures/package/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Package with contents | `elements[].type = "package"`, `members` | Tab folder: large rectangle with a small tab on its upper left; the members are drawn inside, the name in the tab (12.2.4) | package: "tab folders; name in the tab with contents..."; engine: package shape test |
| Package without contents | `type: "package"`, no `members` | Tab folder with an empty tab, name in the body (12.2.4) | package: same test, `java.util` below its tab |
| Nesting | `members: [ids]` | Members drawn inside the owning package's body, any depth (12.2.4) | package: same test (`data-uml-parent`, containment, below the tab); fixture "three levels of nesting..." |
| Package stereotypes | `stereotypes` | «library» above the name, in the tab or the body (12.3.4) | package: same test, «library» |
| Classifiers | `type: "class"`, `"interface"`, `"enumeration"`, `"datatype"` | Name-only boxes; «interface», «enumeration», «dataType» keywords; abstract class name in italics (9.2.4, 10.x) | package: «interface» check; fixture "long and Unicode names" |
| Package import | `type: "import"`, from = importing package | Dashed line, open arrowhead at the imported package or element, «import» (7.4.4) | package: "import, access, merge and dependency..." |
| Private import | `type: "access"` | Same line, «access» (7.4.4) | package: same test |
| Element import | `import`/`access` whose `to` is a classifier | Same line to the classifier (7.4.4) | package: same test as import, `eimp` |
| Package merge | `type: "merge"`, from = receiving package | Dashed line, open arrowhead at the merged package, «merge» (12.2.4) | package: same test |
| Dependency | `type: "dependency"`, `keyword`, `name` | Dashed line, open arrowhead at the supplier, «keyword» and name near the middle (7.7.4) | package: same test, `«use»needs` |
| Containment | `type: "containment"`, from = owner | Owned element drawn outside, solid line with a circle-plus at the owner (12.2.4, 7.4.4) | package: same test, `circle-plus` at source |
| Note (comment) | `type: "note"`, `attachedTo`; may be a member | Rectangle with folded corner, dashed line to each annotated element (7.2.4) | example `webshop`; fixture "nested empty package and nested note" |
| Diagram frame | `title` | Frame with pentagon heading `package <title>` (Annex A) | package: frame heading check |

Lines that end on a package meet its outline: the tab or the body. A line that
would stop in the empty corner right of the tab is extended to the body (package:
"lines ending at a package meet its tab or its body..."; gate `edge-endpoints`
uses the outline from `data-uml-tab`).

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements and relationship IDs | `/elements/1/id`, `/relationships/0/id` |
| MISSING_REFERENCE | `members`, `from`, `to`, `attachedTo` name existing elements | `/elements/0/members/0`, `/relationships/0/to`, `/elements/1/attachedTo/0` |
| MULTIPLE_OWNERS | an element is in at most one package (nesting and containment lines together) | `/elements/1/members/0`, `/relationships/0/to` |
| DUPLICATE_MEMBER | an element is listed once by its owner (not twice in `members`, not nested and contained) | `/elements/0/members/1`, `/relationships/0/to` |
| CONTAINMENT_CYCLE | ownership is acyclic, no package inside itself | `/elements/1/members/0`, `/elements/0/members/0`, `/relationships/1/to` |
| INVALID_IMPORT | only a package imports (`import`, `access`) | `/relationships/0/from` |
| INVALID_MERGE | merge connects two packages | `/relationships/0/to`, `/relationships/0/from` |
| INVALID_CONTAINMENT | a package is owned only by a package | `/relationships/0/from` |
| SELF_RELATIONSHIP | no relationship from an element to itself | `/relationships/0/to` |
| DUPLICATE_RELATIONSHIP | no repeated relationship of one type between one pair | `/relationships/1` |
| RELATIONSHIP_WITH_OWN_MEMBER | no import, access, merge or dependency between an element and its (transitive) owner | `/relationships/0` |
| NOTE_IN_RELATIONSHIP | relationships connect packages and classifiers; notes use `attachedTo` | `/relationships/0/from` |
| INVALID_ATTACHMENT | a note is not attached to a note | `/elements/1/attachedTo/0` |
| SCHEMA_INVALID | unknown properties (e.g. `members` on a class, `keyword` on an import), unknown element or relationship types, missing `elements` | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/name`, `/elements/0/stereotypes/0` |

## Unsupported (rejected by the schema)

- Element import aliases (`«import» name as alias`) and package URIs (`{uri=...}`).
- Member names listed as text in the package body, and visibility markers on
  members.
- Models (package with a small triangle) and other package subtypes: use a
  stereotype.
- Classifier compartments (attributes, operations): use the class kind.
- Generalization and realization between classifiers: use the class kind.

## Known limitations

- Edges into a package are not given ports (ELK 0.11 fails on some port setups of
  compound nodes), so several lines can meet a package close together; they are
  kept at least 28 px apart along its border.
- Lines between elements in different packages cross package borders; they never
  run through unrelated packages, leaf nodes or any tab text (gate
  `edge-endpoints`; the repair pass reroutes lines ELK puts over a tab).
- Layout tries top-down, left to right and graph wrapping and keeps the most
  readable result (`chooseLayout`). Large, highly connected diagrams (the stress
  example) still have long import lines to shared libraries.
- Many relationships between the same two packages follow the layered placement:
  when ELK puts the target several layers away (it must stay below everything that
  depends on it), the parallel dashed lines run long (the review's awkward model).
- An empty package beside a container is centered on the line between them, so
  their tabs are not top-aligned (the straight line wins).
