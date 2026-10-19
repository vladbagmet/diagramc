# Layout engines and implementation stack

## Which architecture best balances quality, performance and deployment?

### Takeaway
Use a semantic UML model and shared measured scene graph, with replaceable layout backends. Rust is a strong CLI/rendering host, but a native-language rewrite is not evidence of parity with ELK's mature compound/port-aware layout. Treat JVM ELK as the quality reference and benchmark it against elkjs and Graphviz before fixing the default.

### Cited Findings
- ELK algorithms are plain Java and usable outside Eclipse. Kotlin can call these libraries directly; an Eclipse desktop installation is not required. [Upstream](https://github.com/eclipse-elk/elk)
- ELK Layered supports orthogonal, straight and spline routing, arbitrary port constraints with orthogonal routing, compound graphs and cross-hierarchy edges, edge labels, self-loops and multi-edges. It exposes model-order, layer/order constraints, interactive settings and a random seed. These are algorithm options, not a guarantee that every combination of UML/editor constraints works. [Reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- elkjs is generated from Java using GWT and computes positions only, not rendering or styling. Its API supports browser workers and Node workers via the separately installed `web-worker` wrapper around `worker_threads`; requesting workers without that package can fall back to non-worker execution. Version revisions can differ from Java ELK, and upstream documents transpilation/module limitations. [Upstream](https://github.com/kieler/elkjs)

| Candidate | Quality potential and integration | Deployment/licensing implications |
|---|---|---|
| Rust model/CLI/render + ELK JVM worker | Retains ELK capabilities without porting algorithms; own protocol/adapter required | Native executable plus JRE/JAR; IPC and lifecycle costs. ELK EPL-2.0. [ELK](https://github.com/eclipse-elk/elk), [license](https://raw.githubusercontent.com/eclipse-elk/elk/master/LICENSE.md) |
| Kotlin/Java + ELK in-process | Most direct access to ELK and extensions; fewer cross-runtime boundaries | JVM startup/memory and runtime packaging need measurement. Same ELK license. [ELK](https://github.com/eclipse-elk/elk) |
| TypeScript/Node + elkjs | Fastest route to a structured JSON layout integration; no browser needed for layout | Node and transpiled bundle; explicit worker packaging; EPL-2.0, not MIT. [elkjs](https://github.com/kieler/elkjs), [license](https://raw.githubusercontent.com/kieler/elkjs/master/LICENSE.md) |
| Rust + Graphviz | Good established directed-graph baseline; Graphviz is C, not a C++ layout framework | CLI process or C ABI; platform libraries/plugins must be packaged. Current Graphviz EPL-2.0. [license](https://graphviz.org/license/), [limitations](https://graphviz.org/docs/attrs/splines/) |
| Rust + OGDF C++ | Broad graph drawing algorithm toolkit; UML semantics/rendering still ours | C++ toolchain/ABI boundary; GPL v2 or v3 with narrow exceptions, not generally permissive. [upstream](https://github.com/ogdf/ogdf), [license](https://raw.githubusercontent.com/ogdf/ogdf/master/LICENSE.txt) |
| Rust + libavoid C++ | Supplement for obstacle-avoiding orthogonal/polyline routing, not a complete node-placement engine | FFI/build work; LGPL-2.1-or-later or paid commercial license. [Adaptagrams](https://github.com/mjwybrow/adaptagrams) |
| Python + PyGraphviz/Adaptagrams | Viable orchestration/prototyping; core layout can still execute native algorithms | Python plus binding/platform packaging. PyGraphviz BSD-3-Clause, Graphviz separately EPL; Adaptagrams supports SWIG Python/Java bindings. [PyGraphviz](https://raw.githubusercontent.com/pygraphviz/pygraphviz/main/README.rst), [Adaptagrams](https://github.com/mjwybrow/adaptagrams) |

### Inferences
- Recommended modular design: Rust for validation, stable IDs, agent JSON interface, caches, measured scene and export; headless ELK worker for compound node-link diagrams; specialized native sequence/activity/state orchestration. If a JVM is acceptable and team expertise favors it, Kotlin/Java monolith is an equally serious, simpler first implementation. Rust is not automatically the highest-quality choice.
- Use a persistent local worker with versioned, framed JSON requests containing only layout geometry, ports, constraints and prior positions. Return positioned geometry plus diagnostics; keep UML semantics and font selection outside ELK. Batch whole diagrams, not individual nodes. Process startup, JSON allocation/copying, Java warmup/GC and idle memory must be counted, especially for tiny one-shot commands. Worker isolation enables cancellation/timeouts/restart but adds protocol/version/recovery work. An embedded JNI/JVM bridge is not a free shortcut.
- A bundled runtime can remove the user's Java installation step, but increases release artifacts and per-platform maintenance. A persistent elkjs worker similarly amortizes startup; promises alone do not establish isolation or useful parallelism. Worker pools can increase throughput at a memory cost.
- Reimplementing ELK in Rust is a separate graph-algorithm research/maintenance project. Native code can replace selected pipelines, not credibly the entire feature set merely by changing language. Prefer bounded adapters and measured replacement of demonstrated bottlenecks.

### Gaps
- No task-specific benchmarks or StarUML comparison were run. No justified numerical speedup, memory ranking or all-platform reproducibility claim is available.
- OGDF's fetched official license page only offers GPL and named exceptions; a generally available commercial license was **not verified**. Do not budget on buying one without written confirmation. [Official licensing](https://ogdf.uos.de/license/)

## What must be diagram-specific, rather than delegated to graph layout?

### Takeaway
General graph layout places boxes and routes links. Publication-quality UML needs semantic preprocessing, text-driven sizing and diagram-specific constraints before that solver, plus collision/notation checks afterward.

### Cited Findings
- Graphviz explicitly warns that `splines=ortho` currently does not handle ports or, in dot, edge labels. This directly matters for member-level class attachments and labeled associations. [Reference](https://graphviz.org/docs/attrs/splines/)
- Adaptagrams separates placement/constraint solving (`libcola`, `libvpsc`) from connector routing (`libavoid`) and topology-preserving extensions. libavoid alone is not an ELK replacement. [Upstream](https://github.com/mjwybrow/adaptagrams)
- PlantUML uses Graphviz for several structural diagram types and state/legacy activity diagrams, but not all diagrams. It has a Java-based Smetana alternative for supported types. This is concrete evidence that one complete UML engine already uses multiple pipelines. [Official documentation](https://plantuml.com/graphviz-dot)
- elkjs explicitly links unresolved/recurring topics around considering previous layout results and incremental node/edge insertion. ELK Layered has interactive/model-order controls, but these should not be advertised as arbitrary stable incremental layout. [elkjs](https://github.com/kieler/elkjs), [ELK options](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)

### Inferences
- Structural diagrams: compile compartments, stereotypes, multiplicities and role labels into measured boxes/ports, then use compound layered layout and reserved label space. Activities: preserve branch/merge and fork/join semantics, swimlanes and flow direction. States: lay out nested regions recursively, account for pseudostates, transition labels and container boundaries. Sequences: use ordered lifelines, event/message precedence, activation stacks, self-calls and nested combined fragments, not generic Sugiyama placement.
- Separate hard constraints from aesthetic preferences and report unsupported/conflicting constraints rather than silently ignoring them. Expose pinned position/order/port-side hints and explicit reflow modes. Persist prior layout separately from semantic source; measure node displacement and route churn after small edits. Reproducibility of an unchanged input and stability after edits are different requirements.

### Gaps
- No engine in this review is established as a full semantic UML validator or as guaranteeing minimal crossings, exact pin preservation and stable incremental routing together. Capability must be tested per algorithm/version/options.

## How should rendering, complete engines and validation be handled?

### Takeaway
Own typography and a common scene representation; do not let independent export paths remeasure labels. Keep PlantUML/Mermaid as interoperability adapters and comparison baselines, not an assumed route to unrestricted StarUML-level semantics and styling.

### Cited Findings
- resvg provides Rust/C/CLI static SVG rendering and separates preprocessing (`usvg`) from rendering. Upstream emphasizes reproducible rasterization without system-library dependencies, but application font inputs and SVG feature coverage still need control. It does not supply UML layout. [Upstream](https://github.com/linebender/resvg)
- RustyBuzz now says it is archived/unmaintained and recommends HarfRust. HarfRust is a MIT-licensed HarfBuzz shaping port, with explicitly documented conformance gaps and no native font-loading integration. Do not blindly recommend RustyBuzz as the maintained default. [RustyBuzz](https://raw.githubusercontent.com/harfbuzz/rustybuzz/main/README.md), [HarfRust](https://raw.githubusercontent.com/harfbuzz/harfrust/main/README.md)
- `svg2pdf` says it is unmaintained and recommends krilla/krilla-svg. krilla supports positioned glyphs, font embedding/subsetting, SVG embedding and vector PDF primitives, but explicitly excludes text layout. It is MIT/Apache-2.0 dual licensed. [svg2pdf](https://raw.githubusercontent.com/typst/svg2pdf/main/README.md), [krilla](https://raw.githubusercontent.com/LaurenzV/krilla/main/README.md)
- Mermaid CLI produces SVG/PNG/PDF; its Node API is explicitly not covered by semver. Its package declares MIT and Puppeteer, so browser/runtime deployment remains relevant even though elkjs alone needs no browser. [README](https://raw.githubusercontent.com/mermaid-js/mermaid-cli/master/README.md), [package manifest](https://raw.githubusercontent.com/mermaid-js/mermaid-cli/master/package.json)
- PlantUML's fetched license page states GPL-3.0-or-later for that distribution and distinguishes generated diagrams from program licensing. Packaging/integration must review the exact artifact rather than assume image ownership settles engine redistribution. [License](https://plantuml.com/license)

### Inferences
- Shape and measure labels before layout, using pinned font files, features, language/direction, fallback chain and line-breaking policy. Cache glyph runs and dimensions. HarfRust/HarfBuzz is shaping, not a complete bidi/fallback/paragraph engine; budget those components separately. For fidelity, draw the same glyph placements in all formats.
- Export canonical SVG; offer outlined-text SVG for appearance portability and live-text SVG for accessibility/editing, with clear tradeoffs. Use resvg for PNG and krilla or krilla-svg for vector PDF. Pin fonts, engine versions, seeds, input ordering, geometry rounding, metadata timestamps/IDs and serialization. Test byte stability separately from visual equivalence. Neither Rust nor a seed alone guarantees deterministic output.
- Bake-off: identical semantic fixtures and font measurements across JVM ELK, elkjs, Graphviz and an optional legally cleared OGDF candidate. Include small/large class graphs, long Unicode labels, ports, nested packages, dense cycles, parallel edges, association labels, swimlanes, nested states and sequence fragments. Evaluate semantic violations, label/edge/node collisions, crossings/bends, containment and page fit, then blinded visual review against StarUML exports. Measure cold CLI latency, warmed batch latency, p50/p95, peak RSS, artifact size and edit displacement. Profile layout, shaping, IPC and export separately; do not substitute language microbenchmarks.
- Treat EPL/LGPL source/notice/relinking obligations as release-engineering work, not a reason to avoid all such libraries. Static linking and C++ integration need particular license review. A subprocess boundary is useful engineering isolation, not a blanket copyleft exemption.

### Gaps
- Sources are upstream pages/default branches fetched during this session, not a reproducible release audit. Pin releases and dependency/font licenses before implementation. No formal legal opinion or tested complete multilingual typography stack is supplied.
