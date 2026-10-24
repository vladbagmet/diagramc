import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { root } from './helpers.mjs';

// What `npm pack` would put in the tarball (without running prepack: dist is built by `npm test`).
test('the npm package ships the CLI, schemas, fonts, setup script and notices, and nothing from development', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout)[0].files.map(f => f.path);
  for (const required of [
    'dist/cli.js',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'THIRD_PARTY_NOTICES.md',
    'schema/model-v1.schema.json',
    'scripts/setup-renderer.mjs',
    'assets/fonts/OFL.txt',
    'assets/fonts/Inter-Regular.ttf',
    'assets/fonts/Inter-Bold.ttf',
    'assets/fonts/Inter-Italic.ttf',
    'assets/fonts/Inter-BoldItalic.ttf',
    'examples/class/minimal.json',
  ]) {
    assert.ok(files.includes(required), `missing ${required}`);
  }
  // `diagramc example <kind>` reads examples/<kind>/minimal.json from the installed package.
  const kinds = JSON.parse(spawnSync(process.execPath, ['dist/cli.js', 'kinds'], { cwd: root, encoding: 'utf8' }).stdout).map(k => k.kind);
  for (const kind of kinds) assert.ok(files.includes(`examples/${kind}/minimal.json`), `missing example of ${kind}`);
  const forbidden = files.filter(
    f =>
      /^(test|src|artifacts|docs|node_modules)\/|^\./.test(f) ||
      /\.(tmp|log|tgz)$|\.DS_Store$|worktree/.test(f) ||
      (f.startsWith('scripts/') && f !== 'scripts/setup-renderer.mjs'),
  );
  assert.deepEqual(forbidden, []);
});
