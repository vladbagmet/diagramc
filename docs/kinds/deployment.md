# Deployment diagram: notation checklist

Backend: own engine. Frame keyword: `dep`. Schema: `uml schema deployment`.
Code: `src/kinds/deployment/` on the shared structure layout in
`src/kinds/structure/`. UML references are to UML 2.5.1 (formal/17-12-05).

Tests referenced below: `deployment` = `test/deployment.test.mjs`; fixtures in
`test/fixtures/deployment/`. Every fixture and example passes all QA gates.

## Layout conventions

Left to right, in the direction of `from` to `to`. Nested nodes, execution
environments and deployed artifacts are laid out inside the front face of their
node, below its name.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Node | `elements[].type = "node"` | 3D box (front face with top and right faces), name bold at the top of the front face (19.4.4) | deployment: "UML notation: nodes are 3D boxes..." (two face polygons, no keyword) |
| Device | `type = "device"` | Node with «device» above the name (19.4.4) | same test |
| Execution environment | `type = "executionEnvironment"` | Node with «executionEnvironment» above the name (19.4.4) | same test |
| Stereotypes | `stereotypes` | «a, b» above the name, below the keyword (22.3.4) | same test («blade») |
| Nesting | `elements` of a node, device or execution environment | Nested nodes and deployed elements drawn inside the front face (19.4.4, 19.2.4) | same test (parent and containment for four levels; up to six are allowed, e.g. data centre, rack, server, hypervisor, JVM, WAR) |
| Artifact | `type = "artifact"` | Rectangle with «artifact» and the document icon in the top-right corner (19.3.4) | same test |
| Deployment of an artifact | an artifact nested in a node, or `type = "deploy"` | Artifact drawn inside the node, or a dashed line with an open arrowhead from the artifact to the node and «deploy» (19.2.4) | deployment: "«deploy» and «manifest» are dashed..."; fixture "deploy dependencies onto nested execution environments" |
| Deployment specification | `type = "deploymentSpecification"`, `properties` | Rectangle with «deployment spec» and the document icon, properties `name : type = value` in a compartment (19.2.4) | deployment: "UML notation: nodes are 3D boxes..." (`heap = 2g`) |
| Component | `type = "component"` | Rectangle with «component» and the component icon (11.6.4) | same test |
| Manifestation | `type = "manifest"`, from artifact to component | Dashed line, open arrowhead at the component, «manifest» (19.3.4) | deployment: "«deploy» and «manifest»..." |
| Communication path | `type = "communicationPath"`, `protocol`, `name`, `fromEnd` / `toEnd` multiplicity | Solid line without arrowheads; «protocol» and name at the middle, multiplicities near their ends (19.4.4) | deployment: "communication paths are solid..." |
| Dependency | `type = "dependency"`, `keyword`, `name` | Dashed line, open arrowhead at the supplier, «keyword» (7.7.4), e.g. a deployment specification configuring an artifact | deployment: "«deploy» and «manifest»..." («configures») |
| Note | `type = "note"`, `attachedTo` | Rectangle with folded corner, dashed lines (7.2.4) | example `webshop`; fixture "paths between nested nodes..." |
| Diagram frame | `title` | Frame with pentagon heading `dep <title>` (Annex A) | deployment: "communication paths are solid..." |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across elements at any depth and relationship IDs | `/elements/1/id`, `/elements/1/elements/0/id`, `/relationships/0/id` |
| MISSING_REFERENCE | `from`, `to`, `attachedTo` name existing elements | `/relationships/0/to`, `/elements/0/attachedTo/0` |
| INVALID_COMMUNICATION_PATH | a communication path links two separate nodes, devices or execution environments (not an artifact, not a node and its own nested node) | `/relationships/0/from`, `/relationships/0/to` |
| SELF_CONNECTION | a relationship connects two different elements | `/relationships/0/to` |
| INVALID_MULTIPLICITY | lower <= upper, upper > 0, `*` only as upper bound | `/relationships/0/toEnd/multiplicity` |
| INVALID_DEPLOYMENT | only artifacts and deployment specifications are deployed, onto nodes, devices or execution environments, and not onto the node they are already drawn in | `/relationships/0/from`, `/relationships/0/to` |
| INVALID_MANIFEST | an artifact manifests a component | `/relationships/0/from`, `/relationships/0/to` |
| INVALID_DEPENDENCY | a dependency does not connect an element to something nested in it | `/relationships/0/to` |
| INVALID_NESTING | an execution environment contains no devices (nodes, such as virtual machines in a hypervisor, are allowed) | `/elements/0/elements/0/type` |
| NOTE_IN_RELATIONSHIP | relationships do not connect notes | `/relationships/0/to` |
| INVALID_ATTACHMENT | a note is not attached to a note | `/elements/1/attachedTo/0` |
| NESTING_TOO_DEEP | at most six levels of nesting | `/elements/0/elements/0/elements/0/elements/0/elements/0/elements/0/elements/0/elements/0` |
| SCHEMA_INVALID | unknown properties, nested elements in an artifact, notes nested in nodes, roles on path ends, `protocol` on a deploy, unknown relationship types | see `invalid.json` |
| INVALID_TEXT | blank text, unpaired surrogates, bidi controls | `/elements/0/name` |

## Unsupported (rejected by the schema)

- Instance-level deployment diagrams (underlined `name : Type` node and artifact
  instances): not drawn yet.
- Deployment specifications attached to a deployment relationship (UML 2.5.1
  Figure 19.10 style): use a dependency from the specification to the artifact.
- Artifacts nested in artifacts, generalization between nodes, associations other
  than communication paths.

## Known limitations

- Where several long lines run side by side down a narrow corridor (the stress
  example's right edge), a center label may find no spot twice as far from the
  neighbouring line as from its own (gate label-proximity, a known failure).

- The cut corners of a 3D box (top left and bottom right) are inside the node's
  bounds: a line arriving exactly there ends a few pixels short of the outline.
- Drawings larger than 1000 x 1000 px are also laid out top to bottom (and, when
  neither is close to square, wrapped) and the more readable one wins, within
  2.5:1 when a layout achieves it; top to bottom, line ends on a container attach
  to the container itself (ELK 0.11 fails on side-fixed ports of crossed containers).
- Large nested deployments grow wide; nested nodes keep generous padding, so
  regions with many small hosts leave white space (see the stress example).
- Lines leaving a nested element cross its containers' borders (and the 3D side
  faces) where ELK routes them.
