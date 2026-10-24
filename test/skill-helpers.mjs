import { spawn } from 'node:child_process';
import { mkdir, symlink } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { BIN } from '../dist/commands.js';
import { root } from './helpers.mjs';

/** The command lines of the ```sh blocks of a skill, comments removed, in order. */
export function skillCommands(markdown) {
  return [...markdown.matchAll(/^```sh\n([\s\S]*?)^```$/gmu)]
    .flatMap(m => m[1].split('\n'))
    .map(line => line.replace(/\s+#.*$/u, '').trim())
    .filter(Boolean);
}

/**
 * Runs each command line through /bin/sh in `dir`, in order, with the binary on
 * the PATH that is this checkout's dist/cli.js, as an agent would type them.
 * Lines for which `skip(line)` is true are left out.
 */
export async function runSkillCommands(dir, lines, { skip = () => false, env = {} } = {}) {
  const bin = join(dir, '.bin');
  await mkdir(bin, { recursive: true });
  await symlink(join(root, 'dist/cli.js'), join(bin, BIN)).catch(() => {});
  const results = [];
  for (const line of lines) {
    if (skip(line)) continue;
    results.push({ line, ...(await shell(line, dir, { ...process.env, ...env, PATH: `${bin}${delimiter}${process.env.PATH}` })) });
  }
  return results;
}

function shell(line, cwd, env) {
  return new Promise((accept, reject) => {
    const child = spawn('/bin/sh', ['-c', line], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', status => accept({ status, stdout, stderr }));
  });
}
