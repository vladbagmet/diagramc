import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRelease, releaseNotes, sections } from '../scripts/release-check.mjs';
import { workspace } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/release-check.mjs', import.meta.url));

const changelog = (unreleased = '') => `# Changelog

## Unreleased
${unreleased}
## 1.1.0 (2026-11-02)

- New command \`diagramc export\`.

### Development

- Releases are built by GitHub Actions.

## 1.0.0 (2026-10-20)

First stable release.
`;

const ready = { version: '1.1.0', lockVersion: '1.1.0', tag: 'v1.1.0', changelog: changelog() };

test('a tree with a matching tag, lock file and dated changelog section is ready', () => {
  const { problems, notes } = checkRelease(ready);
  assert.deepEqual(problems, []);
  assert.equal(notes, '- New command `diagramc export`.\n\n### Development\n\n- Releases are built by GitHub Actions.');
});

test('the tag is optional for a local check', () => {
  assert.deepEqual(checkRelease({ ...ready, tag: undefined }).problems, []);
});

test('a tag that is not v plus the package version fails', () => {
  for (const tag of ['v1.0.0', '1.1.0', 'v1.1.0-rc.1']) {
    const { problems } = checkRelease({ ...ready, tag });
    assert.equal(problems.length, 1, tag);
    assert.match(problems[0], /does not match the package.json version 1\.1\.0/);
  }
});

test('a lock file with another version fails', () => {
  const { problems } = checkRelease({ ...ready, lockVersion: '1.0.0' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /package-lock\.json has version 1\.0\.0/);
});

test('entries under Unreleased fail, an empty Unreleased heading does not', () => {
  assert.match(
    checkRelease({ ...ready, changelog: changelog('\n- Something not released yet.\n') }).problems.join('\n'),
    /still has entries under "Unreleased"/,
  );
  assert.deepEqual(checkRelease({ ...ready, changelog: changelog('\n\n') }).problems, []);
  assert.deepEqual(checkRelease({ ...ready, changelog: changelog().replace('## Unreleased\n', '') }).problems, []);
});

test('a missing, undated or empty version section fails', () => {
  assert.match(checkRelease({ ...ready, version: '1.2.0', lockVersion: '1.2.0', tag: 'v1.2.0' }).problems.join('\n'), /no heading "## 1\.2\.0/);
  assert.match(checkRelease({ ...ready, changelog: changelog().replace('1.1.0 (2026-11-02)', '1.1.0') }).problems.join('\n'), /has no release date/);
  const empty = '# Changelog\n\n## 1.1.0 (2026-11-02)\n\n## 1.0.0 (2026-10-20)\n\nFirst.\n';
  assert.match(checkRelease({ ...ready, changelog: empty }).problems.join('\n'), /section for 1\.1\.0 is empty/);
});

test('a version heading is matched exactly, not by prefix', () => {
  const notes = releaseNotes('## 1.1.10 (2026-12-01)\n\nLater.\n\n## 1.1.1 (2026-11-05)\n\nFix.\n', '1.1.1');
  assert.equal(notes, 'Fix.');
  assert.equal(releaseNotes(changelog(), '1.1'), undefined);
});

test('an invalid package version is reported on its own', () => {
  const { problems } = checkRelease({ ...ready, version: undefined });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no valid version/);
});

test('sections ignore the title and keep CRLF changelogs readable', () => {
  assert.deepEqual(sections('# Changelog\r\n\r\n## 2.0.0 (2027-01-01)\r\n\r\n- Big.\r\n'), [{ heading: '2.0.0 (2027-01-01)', body: '- Big.' }]);
});

async function tree(t, { version = '1.1.0', lockVersion = version, log = changelog() } = {}) {
  const directory = await workspace(t);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'x', version }));
  await writeFile(join(directory, 'package-lock.json'), JSON.stringify({ name: 'x', version: lockVersion, lockfileVersion: 3 }));
  await writeFile(join(directory, 'CHANGELOG.md'), log);
  return directory;
}

test('the command writes the notes and exits 0 for a ready tree', async t => {
  const directory = await tree(t);
  const result = spawnSync(process.execPath, [script, '--tag', 'v1.1.0', '--notes', 'notes.md'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\.1\.0 is ready to release as v1\.1\.0/);
  assert.match(await readFile(join(directory, 'notes.md'), 'utf8'), /^- New command `diagramc export`\.\n[\s\S]*GitHub Actions\.\n$/);
});

test('the command lists every problem and exits 1', async t => {
  const directory = await tree(t, { lockVersion: '1.0.0', log: changelog('\n- Pending.\n') });
  const result = spawnSync(process.execPath, [script, '--tag', 'v9.9.9'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim().split('\n').length, 3, result.stderr);
  assert.match(result.stderr, /package-lock\.json[\s\S]*v9\.9\.9[\s\S]*Unreleased/);
});
