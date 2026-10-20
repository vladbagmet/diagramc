# Component diagram: notation checklist

Backend: own engine. Frame keyword: `cmp`. Schema: `uml schema component`.
Code: `src/kinds/component/` (model, schema, validation, mapping) on the shared
structure layout in `src/kinds/structure/` (also used by the deployment and
composite structure kinds). UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `component` = `test/component.test.mjs`, `engine` =
`test/engine-structure.test.mjs`; fixtures in `test/fixtures/component/`. Every
fixture and example also passes all QA gates, including the `ports` gate.

## Layout conventions

- Left to right. Provided interfaces face left (WEST), required interfaces right
  (EAST), so an assembly runs from the requiring element on the left, through its
  ball-and-socket joint, to the providing element on the right.
- A drawing larger than 1000 x 1000 px is also laid out top to bottom (provided
  interfaces up, required down) and the more readable result wins
  (`chooseLayout`, src/engine/aspect.ts); a layout within 2.5:1 wins over any
  wider or taller one unless it is much worse, and a wrapped layout is tried
  only when no plain one comes close to square.
- Lines never cross a container's name compartment: a port on its top border, or
  level with the compartment, moves onto the side border below it, with room
  kept outside for its name (ports with their own lollipops or sockets keep
  their place beside the name).
- Joints line up with their ports (ELK straightness priority on stems and
  assembly halves); zig-zags and small jogs between neighbours are straightened.
- An interface is drawn once. With its own box (a relationship or note touches
  it, nothing provides or requires it, or it would otherwise appear as several
  unconnected lollipops and sockets), every element or port providing it is
  joined to the box by a realization line and every one requiring it by a «use»
  line; none gets a second, unconnected symbol. An element whose own port
  provides or requires the interface shows it at the port only.
- A port's side follows its connections: outward connectors leave from the side
  facing their partner; delegations into the owner come from the opposite side.
- Nested elements are laid out inside their component's body, below the name
  compartment (tinted, with a separator line).

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Component | `elements[].type = "component"` | Rectangle, «component» above the bold name and the component icon (box with two tabs) in the top-right corner (11.6.4) | component: "UML notation: component keyword and icon..." |
| Stereotypes | `stereotypes` | «a, b» above the name (22.3.4) | component: same test («external») |
| Nested components and classes | `elements` of a component | Drawn inside the component, below its name compartment (11.6.4, 11.2.4) | component: same test (parent and containment checks); fixture "four nesting levels..." |
| Port | `ports[]` | Small square centered on the owner's border; name (`name : Type`) next to it, outside the owner (11.3.4) | component: "UML notation: ports sit centered..."; engine: ports gate (off-border port fails) |
| Provided interface | `provides` on a component, class or port | Lollipop: a stem from the border or port ending in a ball, interface name next to the ball (10.4.4, 11.6.4) | component: "lollipops, sockets and ball-and-socket assemblies..."; engine: ball must be outside its owner |
| Required interface | `requires` on a component, class or port | Socket: a stem ending in a half circle that opens away from its owner (10.4.4) | component: "unconnected required interfaces are sockets opening away..."; engine: socket facing its owner fails |
| Assembly connector | `relationships[].type = "assembly"`, `from` requires, `to` provides `interface` | Ball-and-socket joint: the provider's ball sits in the requirer's socket, named by the interface; the requiring line meets the socket's back, the providing line enters through the opening, all on one axis (11.6.4) | component: same test (axis, concentric); engine: flipped socket, off-center ball, off-axis line all fail |
| Several requirers of one provided interface | several assemblies to one provider port | One joint per assembly, all lines into the provider port | fixture "three requirers of one provided port" |
| Delegation connector | `type = "delegation"` | Solid line from the delegating end to the handling end, open arrowhead at the handler, «delegate» (11.6.4) | component: "ports sit centered..." (markers, solid, «delegate») |
| Interface shown once across a delegation | interface listed on both delegation ends | The ball or socket is drawn at the outer port only | component: "an interface only used as lollipop..." |
| Interface as classifier | `type = "interface"`, `operations` | Rectangle with «interface», operations compartment (10.4.4); drawn when a realization, usage, dependency or note touches it, or when nothing provides or requires it | component: same test; "UML notation: component keyword..." (operation text) |
| Interface realization | `type = "realization"` | Dashed line, hollow triangle at the interface (10.4.4) | component: "realization, usage, manifest and dependency..." |
| Usage | `type = "usage"` | Dashed line, open arrowhead at the interface, «use» (7.7.4) | same test |
| Artifact | `type = "artifact"` | Rectangle with «artifact» and the document icon (19.3.4) | component: "UML notation: component keyword..." |
| Manifestation | `type = "manifest"`, from artifact to component | Dashed line, open arrowhead at the component, «manifest» (19.3.4) | component: "realization, usage, manifest..." |
| Dependency | `type = "dependency"`, `keyword`, `name` | Dashed line, open arrowhead at the supplier, «keyword» and name at the middle (7.7.4) | same test («trace», telemetry) |
| Note | `type = "note"`, `attachedTo` | Rectangle with folded corner, dashed line to each annotated element (7.2.4) | examples `webshop`, fixture "dependency between ports, a note..." |
| Diagram frame | `title` | Frame with pentagon heading `cmp <title>` (Annex A) | component: "UML notation: component keyword..." |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements (any depth), ports and relationship IDs | `/elements/1/id`, `/elements/1/ports/0/id`, `/elements/1/elements/0/id`, `/relationships/0/id` |
| MISSING_REFERENCE | `provides`, `requires`, `from`, `to`, `interface`, `attachedTo` name existing IDs | `/elements/0/provides/0`, `/elements/0/ports/0/requires/0`, `/relationships/0/to`, `/relationships/0/interface`, `/elements/0/attachedTo/0` |
| NOT_AN_INTERFACE | `provides`, `requires` and an assembly's `interface` name interfaces | `/elements/0/provides/0`, `/relationships/0/interface` |
| DUPLICATE_INTERFACE | an interface appears at most once per `provides` / `requires` list | `/elements/0/requires/1` |
| ASSEMBLY_MISMATCH | the `from` end requires the assembly's interface and the `to` end provides it | `/relationships/0/from`, `/relationships/0/to` |
| INVALID_CONNECTOR_END | assemblies and delegations connect ports, components or classes | `/relationships/0/from`, `/relationships/0/to` |
| SELF_CONNECTION | the two ends of an assembly or dependency belong to different elements | `/relationships/0/to` |
| INVALID_ASSEMBLY | an assembly does not connect an element to its own part (use a delegation) | `/relationships/0/to` |
| DELEGATION_OUTSIDE_CONTAINER | a delegation links a component's port to a direct part of that component (or a port of one), never siblings or deeper levels | `/relationships/0/to` |
| INVALID_DELEGATION | the outer end of a delegation is a port | `/relationships/0/from` |
| DELEGATION_INTERFACE_MISMATCH | when both ends declare interfaces, they share one (provided with provided, required with required) | `/relationships/0/to` |
| INVALID_REALIZATION | a component or class realizes an interface | `/relationships/0/to`, `/relationships/0/from` |
| INVALID_USAGE | a component or class uses an interface | `/relationships/0/to` |
| INVALID_MANIFEST | an artifact manifests a component | `/relationships/0/from`, `/relationships/0/to` |
| NOTE_IN_RELATIONSHIP | relationships do not connect notes | `/relationships/0/from` |
| INVALID_ATTACHMENT | a note is not attached to a note or to a port (attach it to the port's owner) | `/elements/1/attachedTo/0` |
| NESTING_TOO_DEEP | at most four levels of nesting | `/elements/0/elements/0/elements/0/elements/0/elements/0/elements/0` |
| SCHEMA_INVALID | unknown properties, ports on an interface, an interface nested in a component, an assembly without `interface`, unknown relationship types, multi-line text | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/name` |

## Unsupported (rejected by the schema)

- Component compartments («provided interfaces», «required interfaces», «realizations»
  as text lists, 11.6.4): use lollipops, sockets and realizations instead.
- Behavior ports, service ports, port multiplicity: the composite structure kind
  draws port multiplicity and conjugated ports.
- Interfaces nested in components, packages around components (the package kind
  covers packages).
- n-ary assembly connectors with one shared ball for several sockets: each
  assembly gets its own joint.
- Notes attached to ports (rejected as INVALID_ATTACHMENT): a port has a single
  attachment point that its connectors share.

## Known limitations

- Long chains of large containers grow horizontally (the stress example is about
  4700 x 1100 px, top to bottom would be about 1600 x 2900); ELK's graph wrapping
  routes cut lines around whole rows, so it is not used.
- When one port fans out to several symbols or connectors, the lines split just
  outside the port.
- Leaf components that carry many interfaces or ports grow taller than their name
  needs, so their stems can stay straight.
