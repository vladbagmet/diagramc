import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, workspace } from './helpers.mjs';

test('packing a clean source tree builds its executable and includes the runtime schema and setup script', async t => {
  const directory = await workspace(t), source = join(directory, 'source'), extracted = join(directory, 'unpacked');
  await mkdir(source);
  await mkdir(extracted);
  for (const name of ['src', 'schema', 'scripts', 'examples', 'package.json', 'tsconfig.json', 'README.md']) {
    await cp(join(root, name), join(source, name), { recursive: true });
  }
  await symlink(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const packed = spawnSync('npm', ['pack', '--offline', '--json', '--pack-destination', directory], {
    cwd: source, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(packed.status, 0, packed.stderr);
  const [metadata] = JSON.parse(packed.stdout), files = metadata.files.map(file => file.path);
  for (const path of ['dist/cli.js', 'dist/model.js', 'schema/model-v1.schema.json', 'scripts/setup-renderer.mjs']) {
    assert.ok(files.includes(path), `missing packaged ${path}`);
  }
  assert.ok(!files.some(path => /^(?:\.tools|node_modules|docs|artifacts|src|test)\//.test(path)));
  const unpacked = spawnSync('tar', ['-xzf', join(directory, metadata.filename), '-C', extracted], { encoding: 'utf8' });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  await symlink(join(root, 'node_modules'), join(extracted, 'package', 'node_modules'), 'dir');
  const help = spawnSync(join(extracted, 'package', 'dist/cli.js'), ['--help'], {
    cwd: directory, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /validated JSON class models to SVG/);
});
