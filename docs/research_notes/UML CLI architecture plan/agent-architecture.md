# UML CLI architecture and delivery

Research date: October 17, 2026. Recommendations below are proposals, not measured implementation results. Starting state is research-only, no Git repository or implementation.

## 1. Which implementation and rendering stack?

### Takeaway
Prefer a Rust library core and thin CLI, with replaceable layout backends. Keep an optional TypeScript or JVM layout worker behind a protocol rather than choosing the entire product language around one layout engine.

### Cited Findings
- `clap` supplies CLI parsing and derive APIs; Serde handles typed serialization; Schemars generates JSON Schema aligned with Serde attributes. None substitutes for UML semantic validation. [clap](https://docs.rs/clap/latest/clap/), [Serde](https://serde.rs/), [Schemars](https://graham.cool/schemars/).
- `usvg` resolves supported SVG into a simplified tree, including text and external images; unsupported features may be ignored. `resvg` renders static SVG and separates parsing from rendering. [usvg](https://github.com/linebender/resvg/tree/main/crates/usvg), [resvg](https://github.com/linebender/resvg).
- `tiny-skia` is CPU rasterization, not a text shaper or PDF generator. Its license is BSD; resvg/usvg offer MIT or Apache-2.0. [tiny-skia](https://github.com/linebender/tiny-skia), [resvg](https://github.com/linebender/resvg).
- Important dependency changes: RustyBuzz now declares itself archived and recommends HarfRust. HarfRust is a HarfBuzz shaping port with documented conformance gaps, not a complete text-layout system. [RustyBuzz](https://github.com/harfbuzz/rustybuzz), [HarfRust](https://github.com/harfbuzz/harfrust).
- `svg2pdf` now declares itself unmaintained and recommends krilla/krilla-svg. Krilla supports positioned glyphs, paths, font subsetting, SVG embedding and PDF links, but not document layout. MIT/Apache-2.0 licensing is documented. [svg2pdf](https://github.com/typst/svg2pdf), [krilla](https://github.com/LaurenzV/krilla).
- Go is native ahead-of-time compiled with GC; its FAQ describes C interoperability caveats. TypeScript adds a type system to JavaScript. Kotlin/Native produces binaries without a VM and has a tracing GC. [Go FAQ](https://go.dev/doc/faq), [TypeScript](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html), [Kotlin/Native](https://kotlinlang.org/docs/native-overview.html).

### Inferences
- **Rust:** strongest fit for sharing typed model, geometry and rendering in one native artifact; explicit ownership helps bound resource use. Costs: build/toolchain complexity and more engineering effort. Select subject to a layout/shaping feasibility spike.
- **Go:** attractive simple CLI/service delivery and concurrency. Using the Rust rendering stack introduces FFI or workers; evaluate this integration cost rather than asserting language-level speed superiority.
- **TypeScript:** fastest route if JavaScript layout engines dominate requirements, and useful for generated SDKs. Runtime packaging and latency require measurement; static types do not validate untrusted JSON. Viable fallback: TS coordinator plus native renderer.
- **Kotlin:** credible when JVM layout/library reuse outweighs packaging costs. Distinguish JVM distribution from Native: Java libraries do not automatically become Native dependencies. Consider a JVM worker, not an assumed Native port.
- Pipeline: parse → normalize → semantic validation → view projection → shape/measure → layout/route → geometry checks → scene graph → SVG/PNG/PDF. Sequence, timing and activity need specialized layouts, not just general node-edge placement.
- Default SVG plus resvg PNG; spike krilla PDF separately. Use one font/shaping contract across measurement and export. Provide selectable text-preserving SVG and outlined-text deterministic SVG; test searchable PDF and links separately. Pin fonts, fallback, bidi and line-breaking behavior. No browser, network or LLM API required.

### Gaps
No comparative project benchmark exists. Dependency README claims are not product performance evidence. Pin release tags and verify resolved shaper/PDF versions, APIs and licenses before commitment; current default-branch documentation can move.

## 2. What makes the interface agent-first and reproducible?

### Takeaway
Treat the versioned semantic model and operation protocol as the product API. Text DSLs, extraction and future editors are adapters, not competing sources of truth.

### Cited Findings
- OMG publishes separate UML abstract-syntax and diagram-interchange metamodels, a useful precedent for model/view separation. [UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/About-UML).
- JSON Schema distinguishes dialect declarations and schema identifiers; 2020-12 also documents bundling external references. [JSON Schema](https://json-schema.org/draft/2020-12/release-notes).
- Tree-sitter produces incremental concrete syntax trees and tolerates syntax errors. That stated capability is not whole-program type or runtime resolution. [Tree-sitter](https://tree-sitter.github.io/tree-sitter/).

### Inferences
- Store stable caller-assigned opaque IDs for elements, relationships, member features, views and occurrences. Never derive identity from label, position or array index. Renames preserve identity; copies allocate IDs. Views reference the shared typed model, with independent filtering, presentation, ordering, constraints and pins. Keep occurrence IDs distinct when one semantic element appears repeatedly.
- Publish bundled JSON Schema 2020-12 with immutable `$id`, explicit application `schemaVersion`, migrations and compatibility fixtures. Dialect version is not application version. Reject unknown fields except a namespaced extension bag. Review generated schema diffs in CI and run schema/Serde agreement tests; do not let dependency upgrades redefine the contract.
- Commands: `schema`, `capabilities`, `validate`, `normalize`, `render`, `inspect`, `apply`, `batch`. JSON/stdin is first-class; stdout carries only documented results, stderr human logs. Diagnostics contain stable code, severity, stage, JSON Pointer/source span, element/view IDs, related IDs and repair suggestions.
- `apply` accepts typed operations such as create, rename, connect, reparent, delete, select and constrain. Require base revision/hash; validate the candidate state, then commit all-or-nothing. Return new revision and semantic diff; support dry-run and idempotency keys. Explicitly reject dangling references or require explicit cascade. Atomic file replacement is not a promise of portable multi-file transactions.
- Proposed exit contract: 0 success, 2 invocation/schema, 3 semantic, 4 geometry/quality gate, 5 I/O/export, 6 revision conflict, 7 timeout/resource limit, 70 internal fault. Document cancellation separately. Batch returns per-job status and a defined aggregate failure rule.
- Reproducibility manifest: normalized model/view hash, tool/backend versions, fonts and hashes, theme, seed, locale, output settings. Stable sorting, deterministic tie-breaks and numeric serialization; strip timestamps. Test cross-platform equality before promising it.
- Cache parsed model, shaped text, layout and output separately using complete content-addressed keys. Bound disk/memory caches, atomically publish entries and invalidate by engine/font versions. Warm NDJSON worker: version handshake, request IDs, cancellation, bounded queues, deadlines and structured responses. Batch independent views with controlled parallelism; geometry algorithms may remain sequential. No network daemon by default.
- Extraction adapters emit proposed facts with file/span, extractor version, build configuration, evidence and unresolved references. Compiler/LSP adapters may improve resolution within available project context. Neither syntax nor missing edges establishes semantic truth; user-authored models remain viable without extraction.

### Gaps
Supported UML subset, compatibility duration and operation conflict semantics require explicit product decisions. No claim of full UML or source-language semantic conformance is justified yet.

## 3. Which quality, performance and delivery gates?

### Takeaway
Ship narrow, verified slices through the full pipeline before expanding notation. Measure semantic correctness, geometric validity and human visual preference separately.

### Cited Findings
- Cargo documents `--frozen` as locked plus offline, requiring available local dependencies. This alone is not a complete hermetic-build guarantee. [Cargo](https://doc.rust-lang.org/cargo/commands/cargo-build.html).
- Krilla describes snapshot, structural and multi-viewer PDF testing, supporting more than a single-viewer visual check. [krilla testing](https://github.com/LaurenzV/krilla#testing).

### Inferences
- **Corpus:** small 10 nodes/15 edges; medium 100/200; large 1,000/2,000. Add adversarial dense 100/1,000, cycles, disconnected/nested graphs, ports, long members, empty/invalid inputs, multilingual/RTL/CJK/combining fonts and missing glyphs. Interaction fixtures cover 10/100/1,000 messages, nesting, fragments and timing constraints. Include paired semantic errors and expected diagnostics.
- **Provisional targets, not results:** p95 cold small SVG ≤200 ms; medium ≤1 s; large ≤10 s; warm cached small ≤30 ms; validation of large ≤200 ms; peak RSS medium ≤256 MiB, large ≤1 GiB. Benchmark PNG separately at fixed 2,048² pixels. Confirm or revise after naming reference hardware, OS, release build, cache state and concurrency; report stage timings and p50/p95 over repeated trials. Dense cases may exceed interactive limits but must cancel predictably.
- `inspect --geometry` returns ID-linked node/label bounds, ports, routed polylines, crossings, overlaps, clipping and violated constraints, with units/tolerances. Property tests check references, operation rollback/idempotency, finite coordinates, containment and endpoint attachment. Snapshot normalized JSON, diagnostics, scene geometry and SVG; raster goldens use explicit tolerances. Fonts/backend upgrades require reviewed rebaselines. Human blinded comparisons judge readability, spacing and hierarchy; crossing counts alone do not define beauty.
- **G0:** contract, corpus, UML rule matrix and time-budget spikes for layout, typography and PDF; exit with chosen dependencies and failure cases.
- **G1:** typed model/schema, transactions and diagnostics; gate on negative fixtures, migrations and property tests.
- **G2:** class + sequence vertical slices, SVG/PNG, geometry inspection and deterministic builds; gate on semantics, typography, visual review and targets.
- **G3:** caching/batch, PDF, signed cross-platform packaging and offline/security tests; gate on cancellation, resource limits and reproducibility.
- **G4:** dependency-ordered expansion: object/package/component/deployment/composite structure/profile; activity/state machine/use case; communication/interaction overview/timing. Together with class/sequence this covers the 14-type roadmap. Each needs explicit notation/semantic subset, specialized layout and corpus gates. Extraction follows, not blocks, diagram delivery.
- Default-deny network/external assets and executable plugins; allowlisted resource root, escaped SVG, no script/DTD, input/decompression/pixel/time limits, isolated optional workers. Pin toolchain and vendored dependencies, audit build scripts, emit SBOM/notices and font-embedding provenance. Test offline installation as well as execution.
- Biggest risks: layout quality, font/export drift, UML scope and dependency churn. Alternatives: worker-backed mature layout, separate interaction layouts, outlines for fidelity, SVG-first PDF deferral, and deliberately scoped UML conformance rather than generic boxes claiming completeness.

### Gaps
Reference hardware, measured baselines, user-rated visual thresholds and dense-graph degradation policy remain unvalidated.
