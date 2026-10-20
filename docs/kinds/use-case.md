# Use case diagram: notation checklist

Backend: own engine (see [docs/decisions/0002-state-machine-and-use-case-backend.md](../decisions/0002-state-machine-and-use-case-backend.md)
for why not PlantUML). Frame keyword: `uc`. Schema: `uml schema use-case`.
Code: `src/kinds/use-case/`. UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `uc` = `test/use-case.test.mjs`, `engine` =
`test/engine.test.mjs`; fixtures in `test/fixtures/use-case/`. Every fixture and
example passes every QA gate.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Actor | `type: "actor"`, `stereotypes` | Stick figure with the name below; «stereotype» above the name (18.1.4) | uc: "UML 2.5.1 notation of actors, use cases, subjects and relationships" |
| Use case | `type: "useCase"` | Ellipse with the name inside (18.1.4) | uc: ellipse, `data-uml-shape="ellipse"` |
| Extension points | `extensionPoints[]` | A line across the ellipse, then "extension points" and one point per line (18.1.4) | uc: chord line, heading and points; fixture "many extension points" |
| Subject (system boundary) | `type: "subject"`; each use case inside it sets `"subject": "<subject id>"` (the subject has no list of use cases) | Rectangle around its use cases, name at the top, optional «subsystem» (18.1.4) | uc: use cases' parent is the subject, bold name at the top |
| Association | `type: "association"` | Solid line between actor and use case, no arrowheads; optional name and end multiplicities (18.1.4) | uc: markers `none`, `1` and `0..*` at their ends |
| «include» | `type: "include"`, from base to included | Dashed line, open arrowhead at the included use case, «include» (18.1.4) | uc: dashed, `open-arrow` at the target |
| «extend» | `type: "extend"`, from extension to base | Dashed line, open arrowhead at the base use case, «extend» (18.1.4) | uc: dashed, `open-arrow` at the base |
| Extend condition | `condition` | Note `Condition: {...}` / `extension point: ...` attached to the «extend» line (18.1.4, Figure 18.3) | uc: note anchored to the extend relationship; engine: "edges ending on edges" gate |
| Generalization | `type: "generalization"` | Solid line, hollow triangle at the general actor or use case | uc: `hollow-triangle` for actors and use cases |
| Note | `type: "note"`, `attachedTo` | Folded-corner rectangle with dashed lines | fixture "notes attached to an actor and a use case" |
| Diagram frame | `title` | Pentagon heading **uc** name (Annex A) | uc: frame label |

ELK places the elements (layered, left to right); primary actors stand in the
first column, secondary actors (only ever the `to` end of associations) and
external systems (keyword «system») in the last, as long as some actor stays left,
and a specialised actor in the column of its general actor. Within a column, two
elements trade places, and actors and use cases no actor uses move into free space,
whenever that removes a crossing of the straight lines between them. Lines are
drawn by `src/kinds/use-case/route.ts`: straight, as use case diagrams are usually
drawn, and bent around any element, note, actor name or subject header in the way
(shortest path over the corners of the obstacles, with costs for bends, crossings
and running along another line, at any angle, so lines toward nearly the same
point do not share a trunk; each corner offers several lanes). A subject's whole
header band is an obstacle, so a line into a subject from above bends round its
corner and enters below the header. Running within the `shared-segments` gate's
tolerance of a routed line (a shallow crossing counts) and a bend on another line
cost heavily; lines of one generalization tree do not count against each other. A
cheapest route that wraps round an element (turns the same way three times) is
replaced by the cheapest one with one or two bends that does not. Pairs of lines
the gate would still reject are routed again against all other lines (each line
was routed only against the lines before it), kept when fewer pairs and crowded
ends remain. An actor's lines fan out from one point per side
of the figure (never its bottom, where the name is); lines meet a use case aiming
at its center, and ends with a multiplicity near the ellipse's left or right
vertex so the label sits next to them. Ends on one ellipse keep apart
(`spreadEllipseEnds`), so arrowheads at a much-included use case never overlap.
Note anchors are routed the same way; a condition note is anchored to the nearest
clear point of its «extend» line. Lines between use cases of two subjects are left
out of the layering when both subjects are used by actors, so the subjects can
stand above each other; both layouts are made and `layoutScore` picks the more
readable one, counting every 40 px of association line that runs past a subject
holding neither of its ends (within 24 px of it) as a crossing, so actors stand
beside the subject they use. Two or more generalizations to one element share one
hollow triangle and a short trunk (a generalization tree; the trunk grows when a
member's line would wrap round its column to reach it); a repeated association
between the same two elements bends beside the first. Actor names are captions under the figure (QA role `label`, owned
by the actor) for which ELK keeps room (`labelBelow`).

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements and relationship IDs | `/elements/2/id` |
| MISSING_REFERENCE | relationship ends, subjects and note attachments exist | `/relationships/0/to`, `/elements/1/subject`, `/elements/4/attachedTo/0` |
| INVALID_SUBJECT | a use case's `subject` names a subject | `/elements/1/subject` |
| INVALID_ATTACHMENT | notes do not attach to notes | `/elements/5/attachedTo/0` |
| NOTE_IN_RELATIONSHIP, SUBJECT_IN_RELATIONSHIP | relationships connect actors and use cases | `/relationships/3/to` |
| INVALID_ASSOCIATION | an association connects an actor and a use case | `/relationships/3/to`, `/relationships/3/from` |
| INVALID_INCLUDE, INVALID_EXTEND | «include» and «extend» connect two use cases | `/relationships/3/from`, `/relationships/3/to` |
| UNKNOWN_EXTENSION_POINT | an «extend» names an extension point the base (`to`) declares; this also catches a reversed «extend» | `/relationships/2/extensionPoint` |
| DUPLICATE_EXTENSION_POINT | extension point names unique per use case | `/elements/1/extensionPoints/1` |
| INCLUDE_CYCLE, EXTEND_CYCLE | no use case includes or extends itself, directly or indirectly | `/relationships/3` |
| DUPLICATE_RELATIONSHIP | no repeated include, extend or generalization of the same pair | `/relationships/3` |
| INVALID_GENERALIZATION, INHERITANCE_CYCLE | generalization between two actors or two use cases, acyclic | `/relationships/3/to`, `/relationships/4` |
| INVALID_MULTIPLICITY | lower bound at most the upper bound | `/relationships/0/toEnd/multiplicity` |
| SCHEMA_INVALID, INVALID_TEXT, UNKNOWN_KIND | shared rules (an «extend» needs `extensionPoint`; `condition` only on «extend») | see `invalid.json` |

## Unsupported (rejected by the schema)

- Use cases shown as classifier rectangles with the ellipse icon, use case
  realization by collaborations, owned behaviors.
- Associations between actors and classes or components, navigability arrows and
  n-ary associations.
- Several extension points referenced by one «extend» (one per relationship).
- Nested subjects.

## Known limitations

- The layout reads left to right: an association's `from` end is placed left of its
  `to` end. Actors that are only `to` ends become secondary actors on the right.
- Many associations of one actor fan out from one point on the figure's side; at
  small angles the first few pixels of those lines lie close together (the
  `shared-segments` gate allows 60 px around the shared point).
- Use cases keep the input order within the group of each actor, not globally:
  ELK's crossing minimisation reorders them where that saves crossings.
- Notes are laid out after the element they annotate, which can put them a layer
  width away in large diagrams.
- Lines between subjects stacked above each other cannot cross a subject's header,
  so they go round the subject's side; in large diagrams (`examples/use-case/stress.json`)
  such lines run long ways past the actor fans, and lines from one actor into a
  subject below it can run as close parallel pairs round its corner.
