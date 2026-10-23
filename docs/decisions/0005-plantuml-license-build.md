# 0005: Use the MIT build of PlantUML

Status: accepted. Date: 2026-10-23.

## Context

Sequence, timing and activity diagrams (and class diagrams with
`--backend plantuml`) are drawn by PlantUML 1.2025.10, which
`scripts/setup-renderer.mjs` downloads into `.tools/` and pins by SHA-256. Until
now it downloaded the default `plantuml-1.2025.10.jar`, which is licensed under
the GNU GPL version 3 or later.

That was already legally sound: the jar runs unmodified as a separate process
and is neither copied into this repository nor shipped in the npm package, so it
does not relicense this project, and PlantUML states that generated images
belong to the author of their source. It still meant that every user ended up
with a GPL component next to an MIT tool, which is one more thing to explain
and a reason for some companies to say no.

PlantUML publishes the same version in several license builds on its official
GitHub release (https://github.com/plantuml/plantuml/releases/tag/v1.2025.10):
GPL (default), GPLv2, LGPL, Apache (`asl`), EPL, BSD and MIT. The MIT build is
`plantuml-mit-1.2025.10.jar` (15,655,170 bytes, SHA-256
`a0e2f8f176e812fe1118246e4ffbf2d9c2bf2a0977024b3d533459f5e2df838c`). Its
`-license` output states that it is under the MIT License. It is smaller than
the default jar (25,281,989 bytes) because it leaves out bundled libraries that
are not MIT-compatible: the Eclipse ELK layout engine (used only by
`!pragma layout elk`), JCCKit (charts) and the Scilab LaTeX renderer. This tool
uses none of them; class diagrams use the Smetana layout, which is part of the
MIT build.

## Check

- Rendered all 39 PlantUML-backed inputs (every sequence, timing and activity
  model and every class model with `--backend plantuml` under `examples/` and
  `test/fixtures/`) with both jars on the same Temurin runtime. All 39 outputs
  are byte-identical, including the 8 intentionally invalid fixtures, which fail
  with the same error.
- Ran `npm run setup:renderer` into a fresh `.tools/`: it downloaded and
  verified the MIT jar and wrote `renderer.json` pointing at it.
- `npm run build`, `npm test` (309 tests) and `npm run test:integration`
  (41 tests) all pass with the MIT jar.

## Decision

`scripts/setup-renderer.mjs` downloads `plantuml-mit-1.2025.10.jar` with the
SHA-256 above. Version, Java runtime, fonts and all rendering options are
unchanged.

## Consequences

- Every component a user installs through this project is under a permissive
  license, except the Temurin JRE (GPL version 2 with the Classpath Exception,
  which permits running any program on it). The JRE is downloaded, not shipped.
- Existing installations keep working: the CLI reads the jar name from
  `.tools/renderer.json`. Running `npm run setup:renderer` again downloads the
  MIT jar and repoints `renderer.json`; the old GPL jar can be deleted by hand.
- When PlantUML is upgraded, pick the `plantuml-mit-<version>.jar` asset of the
  new release and pin its hash. If a future release stops publishing the MIT
  build, the Apache or BSD build is an equivalent choice.
