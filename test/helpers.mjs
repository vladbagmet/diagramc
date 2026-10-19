import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const root = resolve(import.meta.dirname, '..');
export async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uml-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
export async function fakeJava(dir, code, name = 'java') {
  const path = join(dir, name);
  await writeFile(path, `#!${process.execPath}\n${code}\n`);
  await chmod(path, 0o755);
  return path;
}
export function cli(args, options = {}) {
  return spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000, ...options,
  });
}
export const minimal = { classes: [{ id: 'a', name: 'A' }], relationships: [] };
export const fakeSvg = '<svg xml:space="preserve" data-diagram-type="CLASS"></svg>';
