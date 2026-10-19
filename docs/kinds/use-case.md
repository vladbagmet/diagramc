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

Lines end on the ellipse outline (`src/engine/clip.ts`), use polyline routing
(slanted segments, as use case diagrams are usually drawn) with small jogs removed,
and labels on slanted segments are pushed off the line along its normal
(`src/engine/labels.ts`). Actor names are captions under the figure (QA role
`label`, owned by the actor) for which ELK keeps room (`labelBelow`).

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
- Many associations of one actor fan out from the figure's side close together.
- Notes are laid out after the element they annotate, which can put them a layer
  width away in large diagrams.
