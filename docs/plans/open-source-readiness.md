# Open-source readiness plan

Temporary working document. It coordinates the work that prepares this repository
for public release and is deleted once every item below is done. Do not link to
it from the README or any shipped file.

State at the start (2026-10-23, main at 9be7f97): TypeScript CLI, version
1.0.0, 14 UML kinds, 305 node:test tests, no coverage measurement, no CI, no
linter, no LICENSE file, no contributor documentation, a tracked `artifacts/`
folder and internal planning documents under `docs/`.

## Ground rules for everyone working on this plan

- Every change is committed to a branch of its own with clear commit messages.
  Commits and pull requests carry no AI attribution of any kind: no
  `Co-Authored-By` lines naming an assistant, no "generated with" notes, no
  session links. This is a hard rule of the repository owner.
- Prose in code comments, docs and commit messages uses plain English, full
  sentences, no em-dashes (use a comma, colon or en-dash instead).
- Nothing is published or pushed. The work is local on branches; the owner
  reviews and pushes. The public home will be
  https://github.com/vladbagmet/uml_cli : use that URL for badges, the
  `repository`, `bugs` and `homepage` fields of `package.json`, CONTRIBUTING
  links and the CODEOWNERS entry (`@vladbagmet`). Do not add the remote and do
  not push.
- `npm test` must stay green at the end of every branch. Existing known gate
  exceptions in `test/known-gate-failures.mjs` stay as they are unless fixed for
  real.
- PlantUML (sequence, timing, activity) runs from the private runtime in
  `.tools/`. A fresh worktree does not have it: symlink the main checkout's
  folder with `ln -s /Users/Vlad/Development/cli_uml/.tools .tools` instead of
  downloading it again.
- Shared vocabulary for npm scripts, so that documents written in parallel agree:
  `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm test`, `npm run test:integration`, `npm run test:coverage`,
  `npm run check` (everything a pull request must pass, in one command).

## 1. README with product screenshots

Owner: README agent (runs last, after items 2 to 6 are merged, so it describes
the final state).

- Keep the current README's accuracy; it is long and correct but reads as a
  manual. Restructure it as a product page followed by the manual:
  1. One-paragraph pitch, badges (CI, license, Node version, coverage), and a
     hero image: a collage or a single striking diagram.
  2. A gallery: one rendered PNG per diagram kind (14 images), each with a
     one-line caption and a link to the example model that produced it. Choose
     the most attractive example per kind (`notation.json` or a tidy one, never
     the stress tests).
  3. A 30-second quick start, then the install section, then export/import
     (item 4), then the detailed manual sections that exist today, trimmed of
     anything that belongs in `docs/`.
  4. Contributing pointer, license line, acknowledgements (PlantUML, ELK,
     Inter, resvg, HarfBuzz).
- Screenshots: render with the real CLI at scale 2 into `docs/images/<kind>.png`
  (committed). Add `npm run screenshots` (a script under `scripts/`) that
  regenerates them so they never go stale. Keep the total image weight under
  about 3 MiB; crop or pick smaller examples where needed. Verify each image
  opens and shows what the caption says.
- Every command shown in the README is run once to prove it works as written.

## 2. Every component open source

Owner: licensing and contributor-docs agent.

- Add a `LICENSE` file. Choice: MIT (permissive, matches the npm dependency
  landscape: MIT, BSD, MPL-2.0, EPL-2.0 for elkjs, all compatible with an MIT
  wrapper). The owner has not stated a preference; MIT is the recommended
  default and is called out in the final report so it can be swapped before
  publishing. Set `"license": "MIT"` in `package.json`, remove `"private": true`
  only if the owner wants npm publishing (leave it, mention it in the report).
- Audit every runtime and dev dependency license against `package-lock.json`
  (use `npm ls --all --json` plus each package's license field). Confirm
  `THIRD_PARTY_NOTICES.md` matches exactly; fix drift.
- PlantUML: the setup script downloads the default jar, which is GPL. It runs as
  a separate process and is not redistributed, so it does not relicense this
  project, but PlantUML also publishes MIT and Apache builds of the same
  version (`plantuml-mit-<version>.jar`). Check whether the MIT build exists
  for 1.2025.10 on the official GitHub release, whether it renders every
  sequence, timing and activity test fixture identically (run the suite), and
  if so switch `scripts/setup-renderer.mjs` to it with the new SHA-256. Record
  the outcome either way in `THIRD_PARTY_NOTICES.md` and `docs/decisions/`.
- Temurin JRE: GPLv2 with Classpath Exception, downloaded not shipped. Document.
- Inter font: OFL, already documented. Confirm the OFL text file is intact.
- Add license headers? No. A single LICENSE file plus `package.json` is enough
  for a Node project; do not add per-file headers.

## 3. High test coverage

Owner: quality and CI agent.

- Add coverage measurement with Node's built-in `node --test
  --experimental-test-coverage` (no new dependency) through
  `npm run test:coverage`, with a line, branch and function threshold enforced
  by the `--test-coverage-lines` family of flags. Report the baseline first,
  then raise coverage of `src/` until lines are at or above 90 percent and
  branches at or above 80 percent, by adding targeted tests, not by excluding
  files. The only acceptable exclusions are `src/types/` and generated output.
- Tests that depend on the PlantUML runtime must skip cleanly with a clear
  message when it is absent, so a contributor without Java still gets a green
  unit suite, and CI installs the runtime for the integration job.
- Keep the suite fast: unit tests under about 90 seconds on a laptop. The
  existing 2-second wall-clock stress budgets are known to flake on a loaded
  machine; make them judge CPU time or raise the budget in CI.
- Coverage report lands in the final report as a table per top-level directory
  before and after.

## 4. Export and import of diagrams

Owner: formats agent.

Decision: the tool's own JSON model stays the source format. Two text formats
are added because they are what people and agents already have and share:

- PlantUML text. Reason: the most widely used text UML notation, every one of
  the 14 kinds has a PlantUML syntax, and the repository already generates it
  for sequence, timing, activity and class (`to-plantuml.ts`). Export covers all
  14 kinds. Import covers class, sequence, state machine, use case and activity
  (the common ones), accepting the subset of PlantUML that maps onto the model
  and reporting every unsupported line with its line number in the usual
  `diagnostics` error object rather than guessing.
- Mermaid text. Reason: rendered natively by GitHub, GitLab, Notion, Obsidian
  and most wikis, so it is the format a README or an issue wants. Export covers
  the kinds Mermaid can express: class (`classDiagram`), sequence
  (`sequenceDiagram`), state machine (`stateDiagram-v2`), activity (`flowchart`),
  use case and component where a faithful mapping exists; other kinds return a
  clear `UNSUPPORTED_EXPORT` error naming the kind and the formats that work.
  Import covers class, sequence and state machine.
- Not chosen: XMI. It is the official interchange standard but every tool
  writes a different dialect, files are huge, and no agent or developer writes
  it by hand. Record this in `docs/decisions/0004-exchange-formats.md`.

Commands:

```sh
uml export model.json --to plantuml            # stdout, or -o file.puml
uml export model.json --to mermaid -o d.mmd
uml import diagram.puml --from plantuml -o model.json   # --from inferred from .puml/.mmd when omitted
uml import diagram.mmd  --from mermaid
cat x.puml | uml import - --from plantuml      # stdin, like render
```

Rules: an imported model must pass `uml validate` and render; round trips
(JSON to PlantUML to JSON) must preserve every element and relationship of the
example models for the supported kinds, checked by tests over `examples/`.
Lossy mappings are documented per kind in `docs/formats.md`, which also carries
the full mapping tables. The README section for this feature is written as a
short, copy-ready block in `docs/formats.md` under a heading "README excerpt"
so the README agent can paste it. `uml --help` and `uml kinds` reflect the new
commands and per-kind format support.

## 5. Contributors: welcome, collaboration, agent-written code, quality bar

Owner: licensing and contributor-docs agent (documents) and quality and CI
agent (enforcement).

Documents (plain, friendly, short; no corporate tone):

- `CONTRIBUTING.md`: how to set up, run tests, add a diagram kind, add a
  notation feature, write an example and a fixture, the pull request checklist,
  how review works, and an explicit section "Contributions written with AI
  agents are welcome" stating the rule: the human who opens the pull request is
  responsible for it, has read every line, has run `npm run check`, and says in
  the description which parts were agent-written. Agent output that was not
  reviewed by a person is not accepted.
- `AGENTS.md` at the root: the instructions an agent needs to work in this repo
  well (layout, commands, conventions, what the QA gates mean, where the
  notation checklists live, the no-attribution rule for commits). Link it from
  CONTRIBUTING.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, contact address left as a
  placeholder the owner fills in).
- `SECURITY.md`: how to report a vulnerability (placeholder address), what is
  in scope (the setup script downloads binaries; pinned hashes).
- `.github/ISSUE_TEMPLATE/` (bug report asking for the model JSON and the
  rendered output, feature request, new diagram notation) and
  `.github/PULL_REQUEST_TEMPLATE.md` with the checklist.

Enforcement (so quality does not depend on reviewer stamina):

- `tsc --noEmit` with `strict` and `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` if the codebase bears it; fix what it finds.
- ESLint 9 flat config with `typescript-eslint` strict-type-checked and
  stylistic-type-checked, plus `eslint-plugin-unicorn` recommended with
  justified disables, on `src/`, `test/` and `scripts/`. Fix all findings
  rather than silencing them; where a rule is turned off, the config says why.
- Prettier for formatting with `npm run format:check` in CI.
- `npm run check` runs typecheck, lint, format check, unit tests with coverage
  thresholds, and the gallery gate (`npm run gallery`, which fails if any
  example fails a layout check and is not a documented exception).
- GitHub Actions: `ci.yml` on push and pull request, matrix on Node 22 and
  24 on ubuntu-latest, plus one macos-latest job; the integration job installs
  the renderer through `npm run setup:renderer` with the download cached by
  hash. A `CODEOWNERS` file naming the owner. Branch protection is a settings
  change the owner does on GitHub; list it in the report.
- Keep `npm audit` clean at the moment of release and say so in the report.

## 6. Audit of what must not go public

Owner: licensing and contributor-docs agent. Deliverable: a section "Audit
result" appended to this document (which is itself deleted at the end) and the
deletions applied on the branch.

Known candidates, to be confirmed one by one:

- `artifacts/review-preview.png`, `artifacts/review.puml`, `artifacts/review.svg`:
  review leftovers tracked by mistake. Remove, and gitignore `artifacts/`
  entirely.
- `docs/plans/full-uml-plan.md`, `docs/reports/`, `docs/research_notes/`,
  `docs/reviews/mvp-review.md`: internal planning and review history. Anything
  with lasting value (architecture decisions) is distilled into
  `docs/decisions/` or `docs/architecture.md`; the rest is deleted.
- `docs/plans/open-source-readiness.md` (this file): deleted at the end by the
  orchestrator.
- `.claude/` is ignored but confirm nothing from it is tracked.
- `.tools/` is ignored; confirm no binary (jar, JRE, tarball) ever entered the
  history: `git log --all --stat` size check. If one did, say so; rewriting
  history is the owner's decision.
- `package-lock.json` and `THIRD_PARTY_NOTICES.md` stay.
- Grep the tracked tree and the full git history for absolute home paths,
  e-mail addresses other than the git author, API keys, tokens, hostnames and
  internal URLs. Report findings; remove hits in the tree.
- Check `examples/` and `test/fixtures/` content for anything that looks like a
  real company's internal design. They look synthetic; confirm.
- Confirm `.gitignore` covers `.DS_Store`, editor folders, coverage output
  (`coverage/`, `.nyc_output/`), and the screenshots script's scratch output.

## Order of work and verification

1. In parallel on separate branches: formats agent (item 4), quality and CI
   agent (items 3 and 5 enforcement), licensing and contributor-docs agent
   (items 2, 5 documents, 6).
2. Orchestrator merges the three branches into main, resolving conflicts, and
   runs `npm run check`.
3. README agent (item 1) on the merged main.
4. Orchestrator end-to-end verification: clean clone into a temporary folder,
   `npm ci`, `npm run check`, renderer setup, integration tests, export and
   import round trip of one example per supported kind, every README command,
   every README image present and referenced, grep for sensitive strings, then
   delete this file.

## Audit result (docs agent)

Checked on 2026-10-23 on branch `worktree-agent-a29b20ed973e412a8`, history
scanned over `--all` (162 commits at the time).

Deleted on the branch:

- `artifacts/review-preview.png`, `artifacts/review.puml`, `artifacts/review.svg`:
  leftovers of the MVP review (a class render, its PlantUML source and a browser
  screenshot). Synthetic content. `artifacts/` is now ignored entirely.
- `docs/plans/full-uml-plan.md`: the plan for the 14 kinds, executed and
  closed. Its lasting content (backend per kind and why, layout, quality bar) is
  in the new `docs/architecture.md`, checked against `src/`.
- `docs/reports/UML CLI architecture plan.md` and
  `docs/research_notes/UML CLI architecture plan/` (3 files): pre-implementation
  research proposing a Rust design that was not built. Nothing current to keep.
- `docs/reviews/mvp-review.md`: the MVP review; every finding was fixed and is
  covered by tests.
- References fixed: decision 0002 linked the deleted plan; the kinds recipe and
  decisions 0001, 0002 and `docs/kinds/class.md` mentioned internal "chunks".

Findings, one by one:

- `.claude/`: ignored, nothing tracked, and no path under it ever entered history.
- `.tools/` and binaries: no jar, JRE, tarball, zip or native library has ever
  been committed. The largest blobs in history are the four Inter fonts (about
  410 KiB each, intended) and `artifacts/review-preview.png` (152 KiB, now deleted
  but still in history; harmless).
- Home paths: none in the tree except this plan (`/Users/Vlad/...` in the ground
  rules). In history, the same line in commit 42334ba only.
- E-mail addresses: in the tree only `ann@example.org` (example data) and the
  upstream authors' addresses inside license texts in `THIRD_PARTY_NOTICES.md`.
  Every commit's author and committer is `Vlad Bagmet <git@vladbagmet.com>`.
- Keys, tokens, passwords, private keys: none in the tree or history (searched
  for common key formats, `api_key`, `bearer`, `BEGIN ... PRIVATE`; the only hits
  are words like "password" and "TokenService" in example models).
- Hostnames and URLs: only public ones (github.com, plantuml.com, adoptium.net,
  omg.org, w3.org, npm registry in the lockfile, and `.invalid` test hosts). No
  internal hosts, IP addresses or `localhost`.
- AI attribution: no `Co-Authored-By`, "generated with" or session links in any
  commit message or tracked file.
- `examples/` and `test/fixtures/`: synthetic (web shop, hospital, library, ATM,
  thermostat, elevator, generic "Billing/Catalog" services). No company names or
  anything that reads like a real internal design.
- `package-lock.json` and `THIRD_PARTY_NOTICES.md` stay; the notices match the
  lockfile and the installed license files exactly.
- `.gitignore`: now covers `node_modules/`, `dist/`, `*.tgz`, `.tools`,
  `artifacts/` (gallery and any screenshot scratch output), `coverage/`,
  `.nyc_output/`, `*.log`, `*.tmp`, `.DS_Store`, `.vscode/`, `.idea/`, `*.swp`,
  `*~`, `.claude/`. The screenshots script should write its scratch files under
  `artifacts/`.

Needs the owner's decision:

- History rewrite: not needed for secrets. The deleted planning documents and
  the home path in commit 42334ba stay readable in history; if that matters,
  publish from a squashed or filtered history.
- Author e-mail: `git@vladbagmet.com` becomes public with the history. Use a
  GitHub no-reply address for future commits if that is not wanted.
- Placeholders to fill: the contact address in `CODE_OF_CONDUCT.md` and the
  e-mail address in `SECURITY.md` (private vulnerability reporting must also be
  enabled in the GitHub repository settings for the link there to work).
- License: MIT was chosen as the default; swap `LICENSE` and `package.json`
  before publishing if another license is wanted. `"private": true` is still in
  `package.json`; remove it only if the package will be published to npm.
- README (owned by the README agent): the "PlantUML renderer" and "Licenses"
  sections still describe the PlantUML jar as GPL; since decision 0005 it is the
  MIT build.
