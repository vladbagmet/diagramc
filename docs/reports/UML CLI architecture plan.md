# UML CLI architecture and implementation plan

**Build a Rust library and agent-first CLI around an explicit UML model, measured typography and specialized layout pipelines.** Use headless JVM ELK as the preferred structural-layout candidate and quality reference, but confirm that choice through a bake-off against elkjs and Graphviz before committing. This is a native executable plus a bundled JRE/JAR, not a single-native-binary architecture. Prioritize class, package, component, deployment and sequence diagrams, then expand through a declared UML subset. Own validation, geometry inspection and the rendering contract rather than expecting one graph solver to produce perfect diagrams. Rust is a provisional engineering choice, not a demonstrated performance winner. Research dated **2026-10-17** used upstream documentation; no project benchmarks, StarUML product tests or interoperability trials were performed.

## 1. Define parity as verified capabilities, not perfect pictures

Assume offline, local execution on macOS, Linux and Windows; SVG first, PNG next and vector PDF after feasibility testing. The product serves agents, not a GUI, and requires neither an embedded LLM nor a network service. “Perfect” should mean passing explicit semantic, evidence and presentation contracts for supported constructs. Unconstrained automatic layout cannot guarantee optimal aesthetics or eliminate crossings in arbitrary graphs.

StarUML advertises broad modeling support and already offers CLI generation and MCP integration. Agent access alone is not differentiation. Its CLI exports SVG, raster images and PDF without opening the GUI. Compete through reliable model operations, diagnostic feedback, predictable layout and transparent limitations, not a claim that automation itself is new ([StarUML](https://staruml.io/), [CLI](https://docs.staruml.io/user-guide/cli-command-line-interface.md)).

| Priority | UML diagram kinds | Initial contract |
|---|---|---|
| Five-type MVP | Class, package, component, deployment, sequence | Common software structure and interactions; enumerate supported relationships, compartments, ports and fragments |
| Next three | Activity, state machine, use case | Add flow, hierarchy, regions and requirements-oriented relationships with dedicated rules |
| Remaining six | Object, composite structure, communication, timing, interaction overview, profile | Complete the 14-kind checklist, each with a declared notation subset |
| Optional extension | Information flow | Match StarUML's additional UML-labeled editor, separately scoped |

This covers the practical 14-kind UML checklist, not every construct in the standard. StarUML calls state machines “statecharts” and additionally lists information flow. C4, ERD, SysML and BPMN remain outside the initial UML promise ([StarUML documentation](https://docs.staruml.io/sitemap.md)). Pin **UML 2.5.1** as the standards baseline and maintain a rule matrix linking implemented checks to normative clauses or clearly identified product policy. JSON Schema validates document shape, not UML semantics, behavioral correctness or agreement with software ([OMG UML](https://www.omg.org/spec/UML/2.5.1/About-UML)).

Report accuracy separately as semantic well-formedness, source-grounded evidence and visual quality. Assertions carry **observed, inferred, proposed or unknown** provenance, with repository revision, symbol/path/span or requirement references where available. Strict evidence mode rejects unapproved inference; design mode permits explicitly proposed architecture. AST extraction cannot establish runtime message order, deployment truth or absent relationships. Compiler adapters can improve resolution later, not prove arbitrary execution behavior. Tree-sitter supplies concrete syntax trees, not whole-program truth ([Tree-sitter](https://tree-sitter.github.io/tree-sitter/)).

## 2. Reuse layout maturity while owning the product contract

**Rust stable, clap and Serde** provide the proposed library/CLI foundation. Publish a reviewed, versioned JSON Schema, optionally generated with Schemars and checked against serialization behavior. Rust suits shared typed models, geometry and rendering, but implementation effort, dependency maintenance and cross-runtime integration matter more than language microbenchmarks ([clap](https://docs.rs/clap/latest/clap/), [Serde](https://serde.rs/), [Schemars](https://graham.cool/schemars/)).

| Stack | Decision and tradeoff |
|---|---|
| Rust core + JVM ELK worker | Preferred candidate: retain mature compound/port-aware layout while owning semantics and export. Pay for IPC, worker recovery, bundled runtime, startup, memory and per-platform packaging |
| Kotlin/Java + in-process ELK | Credible simpler fallback if a JVM is acceptable. Removes a runtime boundary; rendering integration still needs validation |
| TypeScript/Node + elkjs | Fastest development alternative for JSON-centric integration. Measure transpiled engine behavior, runtime costs and worker packaging |
| Rust + Graphviz | Essential established baseline; attractive for simpler structures, not unrestricted UML layout |
| Go or Python | Viable orchestration, but less direct access to the proposed rendering stack; bindings/workers add packaging and integration work |
| C++/OGDF | Substantial graph-drawing toolkit, but C++ build/ABI and GPL obligations complicate adoption; not the default |

ELK works as plain Java outside Eclipse. ELK Layered documents compound graphs, cross-hierarchy edges, labels, orthogonal routing and port constraints, but not universal compatibility between every option. elkjs is a GWT-generated port that computes geometry, not rendering; its version and worker behavior require independent verification ([ELK](https://github.com/eclipse-elk/elk), [Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html), [elkjs](https://github.com/kieler/elkjs)). Graphviz explicitly warns that orthogonal splines do not handle ports or, in dot, edge labels, directly relevant to UML associations ([Graphviz](https://graphviz.org/docs/attrs/splines/)).

Put a bounded, versioned geometry protocol between Rust and the layout worker. Send measured boxes, ports, constraints and optional previous positions; retain UML semantics and font selection in the core. Batch whole views rather than individual nodes. Stateless commands remain deterministic; an opt-in warm worker amortizes JRE startup. Measure startup, warmup, GC, IPC and all child-process memory. A future native Rust fast path can optimize proven simple cases; rewriting a mature general solver is a separate research project.

**First test whether wrapping an existing engine is sufficient.** A PlantUML wrapper buys broad notation and established specialized pipelines quickly, with less control over semantic transactions, diagnostics and precise layout. PlantUML itself uses different layout paths across diagram families ([PlantUML layout](https://plantuml.com/graphviz-dot)). Mermaid CLI offers SVG/PNG/PDF and rapid documentation integration, but its UML scope is narrower than the target; browser/runtime packaging and a Node API outside semver add constraints ([Mermaid CLI](https://github.com/mermaid-js/mermaid-cli)). Keep both as baselines or optional adapters. Choose an independent renderer only if structured repair and visual-control requirements justify its greater cost.

Release review must cover exact artifacts and dependencies: ELK, elkjs and current Graphviz use EPL-2.0; OGDF uses GPL with specified exceptions; libavoid offers LGPL-2.1-or-later or commercial terms and supplies routing, not complete placement. PlantUML's cited distribution uses GPL-3.0-or-later; Mermaid CLI declares MIT, with dependencies reviewed separately. A subprocess is not an automatic copyleft exemption. These are engineering flags, not legal advice ([Graphviz license](https://graphviz.org/license/), [OGDF license](https://ogdf.uos.de/license/), [Adaptagrams](https://github.com/mjwybrow/adaptagrams), [PlantUML license](https://plantuml.com/license)). Do not bundle or reverse-engineer StarUML; its application license is separate from extension licenses ([EULA](https://staruml.io/legals/license)).

## 3. Separate meaning, presentation and geometry throughout

The pipeline is **model → layered validators → view projection → font shaping/measurement → specialized layout/routing → collision and constraint checks → bounded repair → shared scene → export**. Keep three artifacts distinct: the semantic model, view definitions and derived layout state. Reusable typed elements appear across multiple views without duplication; occurrences have separate identities. Stable caller-assigned IDs cover elements, relationships, members, views and occurrences, independent of names or array positions. Renaming preserves identity. Views select content, presentation, ordering and hard constraints; prior coordinates support edit stability without becoming semantic truth.

Layered validation checks schema, references, ownership, relationship types, implemented UML rules, evidence policy and geometry. Distinguish invalid generalization cycles from legal dependency cycles; distinguish activity control/object flows and state-region ownership. Validate sequence occurrence constraints without inventing a total order between independent lifelines. Strict mode fails unsupported notation or conflicting constraints rather than silently drawing approximations. Every rule needs positive and negative fixtures. StarUML's documented rules provide comparison cases, not a substitute for the normative baseline ([Validation rules](https://docs.staruml.io/user-guide/validation-rules.md)).

Family-specific acceptance should verify association versus dependency/realization decoration, member and multiplicity placement, component interfaces and deployment artifact/node mappings. Interaction fixtures check creation/destruction, activation bounds and supported fragment nesting. Activity tests distinguish activity-final from flow-final; state tests enforce initial/final restrictions and concurrent-region ownership. Use-case tests verify include/extend direction and reject include cycles. Unreachable states, guard completeness, safety and liveness require separate analysis assumptions; do not relabel every warning as a UML error or imply that well-formed pictures prove executable behavior. For every omitted construct, capabilities output states whether rejection or an explicitly requested lossy adapter is available.

Structural layouts compile compartments, multiplicities, stereotypes, endpoint decorations and reserved label space into measured geometry. Sequence orchestration handles ordered lifelines, partial event order, activations, self-calls and nested combined fragments. Activities need swimlanes, branch/merge and fork/join semantics; states need recursive regions, pseudostates and boundary-crossing transitions. Timing requires explicit time units, intervals and aligned state/value tracks. These are separate orchestration strategies, even when they reuse placement or routing libraries. Bounded repair can increase spacing, move labels or reroute connectors, but must stop with actionable diagnostics if constraints remain unsatisfied.

**Typography is an architectural dependency.** The research found RustyBuzz archived/unmaintained and svg2pdf unmaintained. Evaluate HarfRust as the shaping candidate, or HarfBuzz if required capabilities are missing; add explicit bidi handling, font fallback and line breaking. Shaping alone is not paragraph layout ([RustyBuzz](https://github.com/harfbuzz/rustybuzz), [HarfRust](https://github.com/harfbuzz/harfrust), [svg2pdf](https://github.com/typst/svg2pdf)). Pin redistributable fonts, hashes, language, features and fallback order before measurement. Use one scene with positioned glyph runs across exports, resvg for PNG, and a **krilla/krilla-svg PDF feasibility spike**, including searchable text, embedding and viewer tests ([resvg](https://github.com/linebender/resvg), [krilla](https://github.com/LaurenzV/krilla)).

Offer outlined SVG for appearance fidelity and live-text SVG for editing, search and accessibility. Live text can vary with viewer/font behavior; it is not identical to outlines. Never independently remeasure labels in each exporter. Normalize metadata, ordering, seeds, rounding and serialization; record tool/backend/font versions and content hashes. Promise only tested per-platform reproducibility initially. Byte identity, visual equivalence and incremental edit stability are different contracts.

The canonical input is versioned JSON plus typed operations, not a premature DSL. Publish bundled schemas with immutable identifiers, migrations and compatibility tests; review generated schema diffs. JSON Schema's dialect version is distinct from the application's schema version ([JSON Schema](https://json-schema.org/draft/2020-12/release-notes)). `apply` requires a base revision, validates the candidate state and commits atomically or rejects everything. Include dry-run, idempotency keys, explicit delete/cascade semantics and a returned revision/diff. Do not promise portable multi-file transactions.

Expose `schema`, `capabilities`, `validate`, `apply`, `render`, `inspect` and `batch`. JSON uses stdin/stdout; human logs use stderr. Diagnostics carry stable codes, stage, severity, JSON Pointer/span, IDs and repair suggestions. `inspect --geometry` exposes bounds, ports, routes, crossings, clipping and violated constraints with tolerances. Proposed exit codes are 0 success, 2 invocation/schema, 3 semantics, 4 quality, 5 I/O/export, 6 revision conflict, 7 resource limit and 70 internal fault. Define batch aggregation and cancellation explicitly.

Agents iterate validate, render, inspect, apply and retry within fixed budgets. Warm-worker requests need IDs, protocol handshake, deadlines, cancellation and bounded queues. Bound concurrency and content-addressed caches for models, text, layout and output; include backend, font and configuration versions in keys. MCP can later adapt this interface, not replace it or become mandatory. Source extraction/compiler adapters and a human DSL remain separate later tracks.

Keep hard constraints separate from preferences. A pinned node, mandatory port side or precedence requirement must either hold or produce a conflict diagnostic naming the involved IDs. Preferred ordering and spacing can be relaxed under a documented policy. Offer explicit preserve-layout and full-reflow modes: a deterministic full reflow can still move many unchanged elements after one edit. Store prior geometry as optional input, report displacement and route changes, and never conceal a failed constraint behind a successful export status.

## 4. Prove quality before claiming performance leadership

Build shared fixtures spanning 10-node/15-edge, 100/200 and sparse 1,000/2,000 structures, plus dense 100/1,000 cases. Cover nested containers and ports, cycles, parallel links, long labels, missing glyphs, multilingual/RTL/CJK/combining text, and interactions with **1,000 messages**. Include invalid models, conflicting pins, fragments, swimlanes and hierarchical states. Use identical measured inputs for JVM ELK, elkjs and Graphviz; compare semantic/geometry failures before aesthetics or speed.

Choose the default backend by required-capability coverage first, blinded visual results second, and measured latency, memory and release complexity third. Reject a fast candidate that silently loses labels or constraints. If no backend clears the gate, narrow the advertised subset or change the stack before building extensive adapters. Record failing fixtures in the decision, not only attractive examples.

Hard gates require all declared positive/negative semantic fixtures to pass, resolved IDs, provenance classification, correct endpoint notation, finite geometry, valid containment and zero unintended node overlaps or clipped labels. Deliberately crossing connectors are not categorically invalid: zero crossings is impossible for some graphs. Track label/edge collisions, crossings, bends and whitespace alongside expert blinded reviews against complexity-matched, legally produced StarUML references. Predeclare a readability rubric and preference threshold. Automatic-render latency is not comparable to a person's diagram-design time.

| Provisional performance target | Boundary and qualification |
|---|---|
| Native parse/validate ≤200 ms p95 | 1,000-node fixture, excluding worker startup and layout |
| Small warm SVG ≤200 ms p95 | End-to-end, already-running backend, output cache disabled |
| 100-node warm SVG ≤1 s p95 | Same boundary and declared complexity |
| Sparse 1,000-node SVG ≤10 s p95 | Dense pathological cases separately bounded and cancellable |
| Small cold SVG initially ≤2 s p95 | Includes startup; subject to G0 benchmark and revision |

These are **targets, not results**. Freeze reference hardware, OS, versions, release settings, font files, concurrency and cache state; report repeated p50/p95, stage timings, backend cold/warm costs, peak process-tree RSS and artifact size. Count the JRE and every worker, not just native memory. Set memory budgets after G0 rather than inventing a native-only ceiling. Benchmark PNG at fixed resolution and PDF separately. Measure edit displacement and route churn independently of unchanged-input determinism.

Add transaction rollback/property tests, semantic and geometry snapshots, tolerance-based raster goldens and cross-view consistency fixtures. Review all font/backend rebaselines. Offline operation also needs offline installation tests, SBOM/notices, signed packaging, escaped SVG, denied network/external assets, allowlisted file roots and input/pixel/time limits. Isolate optional workers and test timeout recovery. Layout quality, typography drift, scope expansion and runtime packaging are the principal risks, not language selection alone.

## 5. Expand only after complete vertical slices pass

| Milestone | Deliverable | Objective exit gate |
|---|---|---|
| G0: resolve feasibility | Standards/subset matrix, shared corpus, wrapper comparison, backend bake-off, typography/PDF spikes and architecture decision records | Select backend and runtime; demonstrate required ports/containers, multilingual measurement and viable PDF glyph handling; publish measured budgets and explicit go/no-go decisions |
| G1: establish meaning | Typed model, reviewed schema, stable IDs, transactions, provenance and diagnostics | Positive/negative fixtures, migration tests, rollback and revision-conflict tests pass |
| G2: prove end-to-end quality | Class and sequence SVG vertical slices, geometry inspection and separate layout orchestration | Semantic/geometry gates, pinned-font snapshots and blinded visual threshold pass; measured latency meets or explicitly revises G0 budgets |
| G3: complete five-type MVP | Package, component and deployment join class/sequence; PNG quality and bounded caching | All five declared subsets pass corpus, cross-view consistency and SVG/PNG fidelity checks |
| G4: deepen and operationalize | Activity, state machine, use case; batch, cancellation, PDF and cross-platform packaging | Eight-type suite, process-tree resource limits, PDF viewer checks, offline install and recovery tests pass |
| G5: complete declared coverage | Remaining six standard kinds; optional information flow and interchange | Each new kind passes its rule/notation matrix; publish supported/lossy/unsupported mappings and version-tested round trips |

Coverage completion means the **declared subset for each kind**, not exhaustive UML conformance. Source extraction and compiler integrations follow as separate tracks; exchange adapters must not block useful standalone diagrams. No credible staffing or schedule estimate exists until G0 establishes complexity and team constraints.

Treat publication and editable interchange separately. StarUML's XMI extension targets **XMI 2.1/UML 2.0 and excludes diagrams**. UML 2.5.1/UMLDI's existence does not make StarUML exchange lossless ([XMI extension](https://github.com/staruml/staruml-xmi), [OMG UML](https://www.omg.org/spec/UML/2.5.1/About-UML)). An optional `.mdj` adapter requires declared StarUML-version tests, identity mapping and machine-readable loss reports. SVG/PDF do not preserve editable model semantics. Never promise zero-loss round trips from file-format resemblance.

The starting backlog is six bounded items: define the MVP capability/rule matrix; assemble licensed semantic/visual fixtures; implement the backend benchmark harness; spike multilingual shaping and shared-glyph PDF export; draft schema/transaction/diagnostic contracts; write the backend, runtime-distribution and licensing decision records. Resolve these feasibility and contract questions before committing to broad feature implementation.

Confirm with the user whether bundled JRE distribution is acceptable, whether delivery is proprietary or open source, which source languages eventually matter, and whether editable StarUML exchange is essential. Keep those assumptions reversible through backend and import adapters; do not obscure the dual-runtime cost while calling the product native.

## Conclusion

The defensible advantage is a closed quality loop: explicit intent, verifiable semantics, measured layout and machine-actionable repair. If G0 shows an existing-engine wrapper already satisfies that contract, ship the wrapper instead. Otherwise, preserve investment in the model and fixture corpus while allowing the initial Rust/JVM decision to change with evidence.

## Key source groups

| Area | Primary references |
|---|---|
| UML baseline | [OMG UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/About-UML) |
| Product benchmark | [StarUML](https://staruml.io/), [CLI](https://docs.staruml.io/user-guide/cli-command-line-interface.md) |
| Validation and exchange | [Rules](https://docs.staruml.io/user-guide/validation-rules.md), [XMI extension](https://github.com/staruml/staruml-xmi) |
| Application rights | [StarUML EULA](https://staruml.io/legals/license) |
| Native API foundation | [clap](https://docs.rs/clap/latest/clap/), [Serde](https://serde.rs/) |
| JSON contract | [Schema 2020-12](https://json-schema.org/draft/2020-12/release-notes), [Schemars](https://graham.cool/schemars/) |
| JVM layout | [ELK](https://github.com/eclipse-elk/elk), [Layered options](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) |
| JavaScript layout | [elkjs](https://github.com/kieler/elkjs) |
| Baseline layout | [Graphviz limitations](https://graphviz.org/docs/attrs/splines/), [license](https://graphviz.org/license/) |
| C++ alternatives | [OGDF licensing](https://ogdf.uos.de/license/), [Adaptagrams](https://github.com/mjwybrow/adaptagrams) |
| Reusable UML engine | [PlantUML layout](https://plantuml.com/graphviz-dot), [license](https://plantuml.com/license) |
| Documentation engine | [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli) |
| Shaping maintenance | [RustyBuzz](https://github.com/harfbuzz/rustybuzz), [HarfRust](https://github.com/harfbuzz/harfrust) |
| Raster export | [resvg](https://github.com/linebender/resvg) |
| PDF maintenance | [svg2pdf](https://github.com/typst/svg2pdf), [krilla](https://github.com/LaurenzV/krilla) |
| Extraction boundary | [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) |
