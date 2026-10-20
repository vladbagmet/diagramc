# Composite structure diagram: notation checklist

Backend: own engine. Frame keyword: `class` (the frame names the structured
classifier). Schema: `uml schema composite-structure`. Code:
`src/kinds/composite-structure/` on the shared structure layout in
`src/kinds/structure/`. UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `composite` = `test/composite-structure.test.mjs`,
`engine` = `test/engine-structure.test.mjs`; fixtures in
`test/fixtures/composite-structure/`. Every fixture and example passes all QA
gates, including the `ports` gate.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Structured class | `elements[].type = "class"` | Rectangle with the bold name in its name compartment and, below a line, the internal structure compartment holding the parts (11.2.4) | composite: "UML notation: parts inside the structured class..." |
| Part | `parts[]` with `name`, `type`, `multiplicity` | Rectangle inside the class, `name : Type [multiplicity]` in regular weight (11.2.4) | same test |
| Non-composite property | `aggregation: "shared"` or `"none"` | Same rectangle with a dashed outline (11.2.4) | same test (dashed check per part) |
| Nested internal structure | `parts` of a part | Parts drawn inside the part, below its name (11.2.4) | fixture "connectors through ports of nested parts..." |
| Port | `ports[]` on a class or a part, `name`, `type`, `multiplicity` | Small square centered on the border; `name : Type [multiplicity]` next to it, outside (11.3.4) | composite: "UML notation: ports on the class and on parts..."; engine: ports gate |
| Conjugated port | `conjugated: true` | Type drawn with a tilde, `~Type` (11.3.4) | same test (`: ~Serial`) |
| Connector | `relationships[].type = "connector"` between parts, ports or roles | Solid line without arrowheads; `name : association` at the middle; end names and multiplicities near their ends (11.2.4) | composite: "parts inside the structured class..." (markers, solid, end labels) |
| Connector to a port | an end is a port | The line ends on the port square (11.3.4) | composite: "ports on the class and on parts..." |
| Collaboration | `type = "collaboration"`, `roles` | Dashed ellipse; name above a dashed line; roles as rectangles `name : Type [multiplicity]` inside, linked by connectors (11.7.4) | composite: "collaborations are dashed ellipses..." (roles inside the ellipse itself) |
| Collaboration use | `collaborationUses[]` of a class | Dashed ellipse `name : Collaboration` inside the class (11.7.4) | same test |
| Role binding | `bindings[]` (`role`, `part`) | Dashed line from the collaboration use to the bound part, labelled with the role name near the part (11.7.4) | same test (dashed, starts on the ellipse, role names) |
| Dependency | `type = "dependency"` between classes and collaborations | Dashed line, open arrowhead, «keyword» (7.7.4) | same test («occurrence») |
| Note | `type = "note"`, `attachedTo` | Rectangle with folded corner, dashed lines (7.2.4); a note on a role points at its collaboration | example `thermostat`; fixture "two collaboration uses..." |
| Diagram frame | `title` | Frame with pentagon heading `class <title>` (Annex A) | composite: "frame heading uses the class keyword" |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across classes, parts, ports, roles, collaboration uses and relationship IDs | `/elements/0/parts/1/id`, `/elements/0/ports/0/id`, `/elements/1/roles/0/id` |
| MISSING_REFERENCE | `from`, `to`, `collaboration`, binding `role` and `part`, `attachedTo` name existing IDs | `/relationships/0/to`, `/elements/0/collaborationUses/0/collaboration` |
| INVALID_CONNECTOR_END | connectors connect parts, ports or roles; into a part's own structure only through one of its ports | `/relationships/0/to`, `/relationships/0/from` |
| CONNECTOR_CONTEXT | both ends of a connector are in the same structured class or the same collaboration | `/relationships/0/to` |
| SELF_CONNECTION | a connector joins two different parts (not a part and its own port); a dependency two different elements | `/relationships/0/to` |
| INVALID_MULTIPLICITY | lower <= upper, upper > 0, `*` only as upper bound (parts, ports, roles, connector ends) | `/elements/0/parts/0/multiplicity`, `/elements/0/ports/0/multiplicity`, `/relationships/0/fromEnd/multiplicity` |
| CONJUGATED_WITHOUT_TYPE | a conjugated port has a type to draw as `~Type` | `/elements/0/ports/0/conjugated` |
| NOT_A_COLLABORATION | a collaboration use applies a collaboration | `/elements/0/collaborationUses/0/collaboration` |
| INVALID_ROLE_BINDING | a binding names a role of the applied collaboration and a part of the use's own class | `.../bindings/0/role`, `.../bindings/0/part` |
| DUPLICATE_BINDING | each role is bound once per collaboration use | `/elements/0/collaborationUses/0/bindings/1/role` |
| INVALID_DEPENDENCY | dependencies connect structured classes and collaborations | `/relationships/0/from` |
| NOTE_IN_RELATIONSHIP | relationships do not connect notes | `/relationships/0/to` |
| INVALID_ATTACHMENT | a note is not attached to a note or a port | `/elements/1/attachedTo/0` |
| NESTING_TOO_DEEP | at most four levels of parts below a class | `/elements/0/parts/0/parts/0/parts/0/parts/0/parts/0` |
| SCHEMA_INVALID | unknown aggregation kinds, parts without a name, collaborations without roles, keywords on connectors, unknown element types | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/roles/0/name` |

## Unsupported (rejected by the schema)

- Provided and required interfaces on composite structure ports: use the
  component kind, which draws lollipops, sockets and assemblies.
- Behavior ports, service ports, part multiplicity in the top-right corner
  (multiplicity is drawn `[m]` after the type instead), connector end
  navigability and qualifiers.
- Collaboration uses at the top level (outside a class), dependencies from a
  collaboration use to a collaboration (the use names its collaboration in its label).
- A connector from a part to itself (UML allows it for links between instances
  of one multi-valued part): rejected as SELF_CONNECTION.

## Known limitations

- Layout: left to right or top to bottom, whichever is more readable
  (`StructGraph.directions`, `chooseLayout`), within 2.5:1 when a layout achieves
  it; top to bottom, ports on a part's top border move onto its side border below
  the name compartment, so no line crosses it.
- A collaboration's ellipse is sized to circumscribe its roles' layout, so wide
  role layouts give flat, wide ellipses and tall ones (top to bottom) tall ellipses.
- Each role binding leaves its collaboration use from its own point on the
  ellipse, facing its part, and is routed around other nodes and whole name
  compartments; bindings never share a segment. When no clean route exists (a
  crowded drawing), a binding may start with a short hook. Role names on bindings
  are italic and muted, so they do not read as connector end labels. In drawings
  with more than 24 nodes the bindings are routed only in the chosen layout
  (render time), so they do not take part in choosing it.
- When ELK cannot lay out a role binding or note anchor into a nested part, the
  layout runs without it and the router draws it; such lines can be long.
