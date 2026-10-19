# UML semantics, correctness, and StarUML benchmark

Research date: 2026-10-17. Primary-source desk research, not product testing. Recommendations below are proposed acceptance policy, not claims of existing implementation.

## What coverage constitutes StarUML parity?

### Takeaway
Treat parity as a versioned capability matrix, not a claim that drawing boxes supports UML. Start with common software-architecture views and explicitly defer advanced constructs and non-UML languages.

### Cited Findings
- StarUML's current homepage advertises v7.1.1 and these **15 UML-labeled diagram types**: class, package, composite structure, object, component, deployment, use case, sequence, communication, timing, interaction overview, statechart, activity, information flow, profile. Its phrasing is “most of the UML 2 diagrams,” not a formal full-conformance certification. [StarUML](https://staruml.io/)
- The practical **14-kind UML 2.x checklist** is seven structural kinds: class, object, package, component, composite structure, deployment, profile; three other behavioral kinds: use case, activity, state machine; four interaction kinds: sequence, communication, timing, interaction overview. StarUML calls state machine “statechart” and additionally offers information flow. Its documentation index lists all these editors. [StarUML documentation index](https://docs.staruml.io/sitemap.md)
- Do not confuse counts across UML versions: OMG's introductory page explicitly dates itself to July 2005 and lists **13 UML 2.0** kinds without profile. This is historical material, not evidence against the modern 14-kind checklist. [OMG introduction](https://www.omg.org/uml/what-is-uml.htm)
- StarUML additionally claims ERD, data flow, flowchart, mindmap, C4, SysML, BPMN, UI wireframe, AWS, GCP and Azure architecture diagrams. Homepage marks SysML, BPMN, wireframe and all three cloud families **PRO**. The index documents SysML requirement, block definition, internal block and parametric diagrams. These are separate language/notation scopes, not extra UML diagram kinds. [Homepage](https://staruml.io/); [documentation index](https://docs.staruml.io/sitemap.md)
- StarUML already advertises CLI generation, asynchronous validation and MCP-based AI integration. Agent access alone is not differentiation. [Homepage](https://staruml.io/); [CLI documentation](https://docs.staruml.io/user-guide/cli-command-line-interface.md)

### Inferences
- **Phase 0:** freeze supported metaclasses, relationships, notation and prohibited constructs; build semantic/visual fixtures and a StarUML reference corpus. Keep semantic model, diagram/view selection and layout separate.
- **MVP:** class, package, component, deployment and sequence, with a deliberately bounded construct set. These cover domain structure, architectural decomposition, runtime placement and collaboration. Declare omissions such as advanced ports, nested interaction semantics or profiles rather than drawing misleading substitutes.
- **Phase 2:** activity, state machine and use case, then deepen composite/nested constructs and cross-view consistency. This yields eight pragmatic major types, not “full UML.”
- **Phase 3:** object, composite structure, communication, timing, interaction overview and profile complete the 14-kind checklist. Add information flow for StarUML's UML-labeled list. Prioritize ERD/C4 extras separately by user demand, then other languages with their own validation contracts.

### Gaps
- No independent performance, layout-quality or formal-conformance measurement was performed. Documentation proves advertised scope, not completeness of every UML construct or equal quality across editors.

## What do standards and validation establish?

### Takeaway
Use a precisely named UML subset and layered validators. Schema-valid or UML-well-formed is not equivalent to matching a repository, being behaviorally correct, or communicating clearly.

### Cited Findings
- OMG publishes formal **UML 2.5.1** (December 2017), including normative abstract-syntax, primitive-types, standard-profile and **UMLDI** XMI metamodels. This is the standards baseline to pin, not just a renderer grammar. [OMG UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/About-UML)
- Formal **Diagram Definition 1.1** (August 2015) provides Diagram Common, Diagram Graph and Diagram Interchange metamodels. OMG explicitly says DD conformance is for modeling-language specifications using it, not direct vendor/tool conformance. [OMG DD 1.1](https://www.omg.org/spec/DD/1.1/About-DD)
- Formal **XMI 2.5.1** specifies XML representations, links, identities and schema validation. XML-schema validity is an interchange-layer property. [OMG XMI 2.5.1](https://www.omg.org/spec/XMI/2.5.1/About-XMI)
- StarUML documents concrete rules including circular generalizations, instance classifier types, include cycles, initial/final state restrictions, fork/join transitions and activity object/control flows. These make useful benchmark fixtures, but its naming and visibility rules must not automatically be treated as exhaustive normative OMG requirements. [StarUML validation rules](https://docs.staruml.io/user-guide/validation-rules.md)

### Inferences
Define accuracy in four independently reported dimensions:
1. **Notation/semantics:** parsing, typed relationships, reference resolution, multiplicities, ownership and implemented UML constraints. Cite each rule's normative clause or identify it as project policy. Unsupported constructs must error, not silently degrade.
2. **Source-grounded traceability:** stable element/relation IDs; repository revision plus path/symbol/range or user requirement; label each assertion observed, inferred, proposed or unknown. Static analysis cannot establish every runtime collaboration.
3. **Visual quality:** correct arrowheads/compartments, legible labels, intentional grouping, no unintended overlap/clipping and predictable routing. Correctness cannot be reduced to graph connectivity.
4. **Unsupported assumptions:** do not invent multiplicities, deployment topology, message ordering or requirements. Strict evidence mode rejects unapproved inferences; future-design mode permits explicitly proposed decisions.

Proposed global gates: 100% positive fixtures accepted and negative fixtures rejected for the declared rule set; zero unresolved IDs; every assertion provenance-classified; zero unapproved assumptions; zero unintended node overlaps or clipped labels. Pin fonts/tool versions and require reproducible output hashes after metadata normalization. Compare complexity-matched reference diagrams blindly with expert reviewers using a predeclared rubric. Do not promise minimum crossings globally, zero crossings is often impossible. Record p50/p95 time, peak memory and semantic/visual quality on identical hardware and corpora; “highest performance” remains unproven without this.

### Gaps
- This time-box did not audit every normative clause/OCL constraint. Formal safety, liveness, guard completeness and implementation equivalence require additional domain assumptions, executable semantics, model checking or tests; a diagram validator alone cannot establish them.

## What acceptance and interoperability promises are defensible?

### Takeaway
Gate each family on semantic and visual fixtures. Treat native-project exchange, XMI model exchange and SVG/PDF publication as different deliverables with different preservation guarantees.

### Cited Findings
- Native StarUML projects are **`.mdj`**; project/fragment import and export are documented. The homepage identifies modeling data as JSON. Neither statement establishes a stable public format contract across releases. [Managing projects](https://docs.staruml.io/user-guide/managing-project.md); [homepage](https://staruml.io/)
- StarUML CLI loads `.mdj`, exports PNG/JPEG/**SVG**, **PDF** with page options and HTML documentation, and supports template output and command execution without launching the GUI. This documents publication/automation, not editable UML reconstruction from exported artwork. [CLI documentation](https://docs.staruml.io/user-guide/cli-command-line-interface.md)
- The official **staruml-xmi extension** says it targets **XMI 2.1 / UML 2.0**, explicitly excludes diagram interchange, and warns tool implementations can be incomplete/noncompliant. Repository is MIT licensed. Do not describe its output as UML 2.5.1/UMLDI support. [Official extension](https://github.com/staruml/staruml-xmi)
- StarUML's July 2025 EULA restricts modification, reverse engineering, redistribution and providing hosted/service-bureau access. The extension's MIT license does not license the desktop application. [EULA](https://staruml.io/legals/license)

### Inferences
Proposed release gates, in addition to the global gates above:

| Family | Minimum objective acceptance fixtures |
|---|---|
| Class/package/component/deployment | Correct namespace ownership, type/member/multiplicity rendering, association versus dependency versus realization/generalization and correct endpoint decoration. Reject inheritance cycles, dangling references and wrong instance classifier kinds. Verify component provided/required interfaces and deployment artifact/node mappings within supported scope. Do not reject all dependency cycles as invalid UML. |
| Sequence | Preserve declared occurrence ordering, lifeline identity, message kind, creation/destruction and activation bounds. Test nested `alt`, `opt`, `loop`, `par` and references only as supported; reject inconsistent occurrence constraints. Assert layout respects partial order without inventing total order between independent lifelines. |
| Activity | Distinguish control/object flows, pins, decisions/merges, forks/joins and activity-final versus flow-final. Positive/negative fixtures cover edge typing and node-degree constraints. Trace examples exercise branch and join behavior; warn when guard completeness is unproved. |
| State machine | Region ownership, initial/final restrictions, guards/triggers/effects, entry/exit and hierarchical/concurrent states. Negative tests cover illegal final outgoing transitions and initial guards. Flag unreachable states as analysis findings, not unconditional UML errors. |
| Use case | Actors/system boundary, associations, generalizations, correct `include`/`extend` direction and extension points. Reject include cycles; link each goal to requirements. Do not present diagram shape as proof of requirements completeness. |
| Long-tail interactions | Communication numbering maps to occurrence order; timing constraints use explicit units/bounds; interaction overview references resolve. Cross-render equivalent interaction fixtures and compare participant/message identities plus ordering constraints, not pixel equality. |

For interchange, publish a per-version supported/lossy/unsupported mapping. Round-trip fixtures must compare IDs or mapped identities, metaclasses, attributes, relationships and profiles separately from coordinates/styles. Fail explicitly or emit a machine-readable loss report. Offer `.mdj` only after testing the declared StarUML version; XMI compatibility requires separate target/version tests and does not preserve diagrams merely because UMLDI exists. SVG/PDF are publication outputs, not editable-model round trips. Obtain legal review before bundling StarUML or using it behind a hosted service; prefer an independent engine and optional licensed local interoperability tests.

### Gaps
- No actual `.mdj` or XMI round trip, installed-version extension compatibility or export font-fidelity tests were performed. No basis exists to promise perfect fidelity, full constraint coverage or licensing permission beyond the cited text.
