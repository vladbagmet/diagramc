# Releasing

A release is a GitHub Release with the npm tarball and its SHA-256 sum
attached. The package is marked `"private": true` and is not published to the
npm registry. The workflow `.github/workflows/release.yml` does the building and
publishing; the maintainer only prepares one commit and pushes one tag.

## Steps

1. Make sure `main` is green in CI and you have it checked out and up to date.
2. Set the new version in `package.json` and `package-lock.json` without
   creating a commit or tag:

   ```sh
   npm version 1.1.0 --no-git-tag-version
   ```

3. In `CHANGELOG.md`, rename the `## Unreleased` heading to the version and
   today's date, for example `## 1.1.0 (2026-11-02)`. Leave no entries under
   Unreleased; you can add an empty `## Unreleased` heading back on top.
4. Check the result locally. This runs the same check as the workflow:

   ```sh
   npm run release:check -- --tag v1.1.0
   npm run check
   npm run test:integration
   ```

5. Commit, tag and push:

   ```sh
   git commit -am "Release 1.1.0"
   git tag v1.1.0
   git push origin main
   git push origin v1.1.0
   ```

## What the workflow does

Pushing a tag that starts with `v` starts the Release workflow:

1. **Release check.** `npm run release:check -- --tag <tag>` fails unless the
   tag is `v` plus the `package.json` version, `package-lock.json` has the same
   version, `CHANGELOG.md` has a dated section for that version, and nothing is
   left under Unreleased.
2. **Checks.** Type check, lint, format check and unit tests with coverage on
   Node 22, and the integration tests and gallery with the PlantUML renderer,
   as in CI.
3. **Build.** `npm pack` builds `diagramc-<version>.tgz`. The tarball is
   installed into an empty scratch project, where `npx diagramc --version` must print
   the version and `npx diagramc example class | npx diagramc validate -` must pass.
4. **Publish.** It writes `SHA256SUMS.txt` and creates the GitHub Release named
   `diagramc <version>` with the tarball and the sums file attached. The release
   notes are that version's section of `CHANGELOG.md`.

If a step fails, no release is created. Fix the problem on `main`, then move
the tag to the fixed commit (`git tag -f v1.1.0`, `git push -f origin v1.1.0`)
or release the next patch version.

## Installing a release

Download the tarball and the sums file from the
[Releases page](https://github.com/vladbagmet/diagramc/releases), check the sum
and install the tarball into your project:

```sh
version=1.1.0
base=https://github.com/vladbagmet/diagramc/releases/download/v$version
curl -LO "$base/diagramc-$version.tgz" -LO "$base/SHA256SUMS.txt"
shasum -a 256 -c SHA256SUMS.txt         # or: sha256sum -c SHA256SUMS.txt
npm install "./diagramc-$version.tgz"
npx diagramc --version
```

`npm install -g ./diagramc-$version.tgz` installs the `diagramc` command
globally instead. For sequence, timing and activity diagrams, run the renderer
setup once afterwards, as described in the README.

## Repository settings the workflow needs

- Actions must be allowed to run (Settings, Actions, General).
- The workflow asks for `contents: write` itself, so the default read-only
  `GITHUB_TOKEN` setting is fine. If an organization policy forbids workflows
  from raising their permissions, allow it for this repository.
- If tag protection rules exist, the maintainer must be allowed to push `v*`
  tags.
