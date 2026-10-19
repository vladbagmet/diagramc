# Tiny UML CLI engineering review

Date: 2026-10-19. Executed on macOS arm64, Node v23.11.0, pinned PlantUML
1.2025.10 and Temurin 21.0.11+10. The directory has no Git repository, branch or
HEAD. No repository was initialized, and research reports were left unchanged.

## Findings fixed

| Severity | Finding and reproduction | Fix and regression coverage |
| --- | --- | --- |
| Medium | `scripts/setup-renderer.mjs`: a nonempty, partially extracted runtime blocked every later setup attempt. A broken existing Java was not repaired. | Verify cached artifacts, extract into a unique stage, check version/executable/license files, then replace the managed runtime and atomically publish its manifest. `test/setup.test.mjs` covers interruption, broken runtimes, failed/partial/wrong-version extraction and preservation of the previous installation. |
| Medium | `package.json`: packing a source tree without ignored `dist/` produced no usable executable. Unrestricted packing also included research and QA files. | Added a prepack build and explicit package contents. `test/package.test.mjs` packs a clean source fixture, verifies schema/setup inclusion and runs its executable outside the source directory. Independent offline installation and rendering also passed. |
| Medium | `src/plantuml.ts`, `src/renderer.ts`: accepted leading/trailing spaces were trimmed, and browsers collapsed repeated spaces even when XML retained them. | Added fixed invisible text boundaries, inherited `xml:space` and explicit text `white-space:pre`. Integration tests cover all four text slots. Browser checks confirmed rendered character counts now include every space. |
| Medium | `src/plantuml.ts`, `schema/model-v1.schema.json`: U+100000 and above became visible `<U+...>` tokens. U+FFFE/U+FFFF passed validation but caused PlantUML XML failures. | Encode well-formed UTF-16 units so surrogate pairs survive PlantUML's four-digit decoder. Reject XML-forbidden BMP characters before launching Java. Unit and actual-renderer tests cover these cases, emoji and supplementary CJK. |
| Medium | `src/renderer.ts`: a labeled self-association placed its label at negative Y outside the SVG; unlabeled curves were also clipped. | Conservatively expand the viewport for the pinned renderer's self-edge paths and labels, without changing graph layout. Unit, actual-renderer and browser checks cover labeled, unlabeled and repeated loops. |
| Medium | `src/renderer.ts`: signaling the CLI process alone could leave Java running. | Handle SIGINT/SIGTERM while rendering, kill and reap Java, clean up listeners, return structured `RENDER_INTERRUPTED` errors with exit 130/143 and preserve output. Regression tests verify both signals and that the child PID is gone. |
| Low | `src/renderer.ts`: malformed manifest shapes could become `INTERNAL_ERROR`; one override could silently mix with local tools. | Validate manifest paths, including embedded NULs, and require both trusted overrides. Unit tests cover missing/malformed manifests and complete/partial overrides. |
| Low | `src/cli.ts`: `render -o -o output.svg` reported a file-read failure instead of invalid usage. | Reject flag-like input names, except stdin `-`. Regression coverage checks `USAGE`, exit 2. Use `./-name` for such filenames. |

Setup downloads now have a 128 MiB bound, unique temporary files and cleanup on
hash, HTTP, stream and size failures. HTTP error bodies are canceled. During
verification, stream-based cached hashing intermittently printed readiness without
exiting. Explicitly closed file-handle reads resolved the reproduced hang: 12
consecutive real setup runs then exited successfully. An eight-process cached-reader
regression test checks termination without Java or network access.

`README.md` now describes local bin discovery, Linux runtime requirements,
interruptions, literal text, package contents and dependency license scope. The
PlantUML license command, bundled notices, Temurin legal files and Node dependency
licenses were inspected. No new dependencies or global installations were added.

## Verification

Final commands all exited 0:

- `npm run build`
- `npm test`: **22 passed**, comprising 15 unit, six setup and one package test.
- `npm run test:integration`: **five passed**, exercising 12 actual renders,
  including all five examples, stdin, hostile text, Unicode, self-loops and
  byte-identical repeated output.
- `npm run setup:renderer`
- `npm run render:example`
- `npm audit`: zero reported npm vulnerabilities, not a Java or general security audit.

Additional isolated smoke checks passed: offline `npm ci`, build and local bin
discovery from a clean source copy; real extraction from verified cached archives;
offline idempotent setup; tarball installation in an independent npm project; and
installed-bin UTF-8 stdin rendering. All four pinned Temurin hashes matched their
official release checksum files. Setup failure tests did not damage the real `.tools/`.

`artifacts/review.svg` is **963 x 374**. Browser inspection confirmed six classes,
all 23 members, four readable association labels and the inheritance triangle at
Account, with no visible overlap or clipping. DOM bounds contained every text item
and no active SVG elements were present. `artifacts/review.puml` matches current
source generation, and the SVG matches a fresh render byte-for-byte. The refreshed
`artifacts/review-preview.png` is a 2000 x 820 browser QA screenshot, not a product export.

## Residual limitations

No unresolved substantiated in-scope findings remain from this review. Font coverage
and metrics remain machine-dependent, and dense graph routing is not guaranteed to
be attractive. The viewport correction targets the pinned Smetana SVG format, not
arbitrary renderer output. Only macOS arm64 was executed with real Java; other
platform selection/path cases use stubs. Node 22 itself was not exercised. Pinned
runtime dependencies still require ongoing security maintenance. This review and
its tests are not an exhaustive correctness or security proof.
