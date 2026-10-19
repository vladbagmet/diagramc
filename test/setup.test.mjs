import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupRenderer, downloadVerified } from '../scripts/setup-renderer.mjs';
import { workspace } from './helpers.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quiet = () => {};
function stubSetup(root, platform = 'darwin', arch = 'arm64') {
  const state = { extractions: 0, downloads: [], mode: 'ok' };
  const options = { root, platform, arch, log: quiet,
    download: async (directory, url, name, expected) => {
      assert.match(expected, /^[a-f0-9]{64}$/);
      state.downloads.push({ url, name, expected });
      await writeFile(join(directory, name), 'stub archive');
      return join(directory, name);
    },
    run: (command, args, settings) => {
      assert.ok(settings.timeout > 0);
      if (command === 'tar') {
        state.extractions++;
        if (state.mode === 'fail') return { status: 1, stderr: 'interrupted extraction' };
        if (state.mode === 'partial') return { status: 0, stderr: '' };
        const home = join(args.at(-1), 'jdk-21.0.11+10-jre', ...(platform === 'darwin' ? ['Contents', 'Home'] : []));
        for (const [name, content] of Object.entries({
          'bin/java': 'valid', release: `IMPLEMENTOR_VERSION="Temurin-21.0.11+10"\nJAVA_VERSION="${state.mode === 'wrong' ? '17' : '21.0.11'}"\n`,
          NOTICE: 'notice', 'legal/java.base/LICENSE': 'license',
        })) {
          const path = join(home, name);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
        }
        chmodSync(join(home, 'bin/java'), 0o755);
        return { status: 0, stderr: '' };
      }
      assert.deepEqual(args, ['-version']);
      assert.ok(!settings.env.JAVA_TOOL_OPTIONS);
      return readFileSync(command, 'utf8') === 'valid'
        ? { status: 0, stderr: 'OpenJDK Runtime Environment Temurin-21.0.11+10' }
        : { status: 1, stderr: 'broken java' };
    },
  };
  return { options, state };
}

test('setup repairs interrupted extraction, is idempotent and recovers a broken runtime', async t => {
  const root = await workspace(t), { options, state } = stubSetup(root);
  await mkdir(join(root, 'runtime', 'jdk-21.0.11+10-jre'), { recursive: true });
  await mkdir(join(root, '.runtime-stage-interrupted'));
  await writeFile(join(root, '.runtime-stage-interrupted', 'keep'), 'old interrupted stage');
  await setupRenderer(options);
  const manifest = JSON.parse(await readFile(join(root, 'renderer.json'), 'utf8'));
  assert.equal(manifest.plantuml, '1.2025.10');
  assert.equal(manifest.temurin, '21.0.11+10');
  assert.equal(manifest.fonts, 'Inter 4.1');
  const fonts = join(root, 'runtime', 'jdk-21.0.11+10-jre', 'Contents', 'Home', 'lib', 'fonts');
  assert.deepEqual((await readdir(fonts)).sort(), ['Inter-Bold.ttf', 'Inter-BoldItalic.ttf', 'Inter-Italic.ttf', 'Inter-Regular.ttf']);
  await writeFile(join(fonts, 'Inter-Bold.ttf'), 'corrupt');
  assert.equal(state.extractions, 1);
  await setupRenderer(options);
  assert.equal(state.extractions, 1);
  assert.notEqual(await readFile(join(fonts, 'Inter-Bold.ttf'), 'utf8'), 'corrupt', 'setup repairs installed fonts');
  await writeFile(join(root, manifest.java), 'broken');
  await setupRenderer(options);
  assert.equal(state.extractions, 2);
  assert.equal(await readFile(join(root, manifest.java), 'utf8'), 'valid');
  assert.equal(await readFile(join(root, '.runtime-stage-interrupted', 'keep'), 'utf8'), 'old interrupted stage');
  assert.ok(!(await readdir(root)).some(name => name.startsWith('.runtime-backup-') || name.endsWith('.tmp')));
});

test('failed, partial and wrong-version extractions do not replace the existing installation or manifest', async t => {
  const root = await workspace(t), { options, state } = stubSetup(root);
  await setupRenderer(options);
  const manifest = await readFile(join(root, 'renderer.json'), 'utf8');
  await writeFile(join(root, 'runtime', '.complete.json'), 'incomplete');
  for (const mode of ['fail', 'partial', 'wrong']) {
    state.mode = mode;
    await assert.rejects(setupRenderer(options));
    assert.equal(await readFile(join(root, 'renderer.json'), 'utf8'), manifest);
    assert.equal(await readFile(join(root, JSON.parse(manifest).java), 'utf8'), 'valid');
    assert.equal(await readFile(join(root, 'runtime', '.complete.json'), 'utf8'), 'incomplete');
    assert.ok(!(await readdir(root)).some(name => name.startsWith('.runtime-stage-')));
  }
});

test('setup selects all four official platform archives and rejects unsupported platforms', async t => {
  const root = await workspace(t);
  for (const platform of ['darwin', 'linux']) for (const arch of ['arm64', 'x64']) {
    const { options, state } = stubSetup(join(root, `${platform}-${arch}`), platform, arch);
    await setupRenderer(options);
    const runtime = state.downloads[1];
    assert.match(runtime.url, /^https:\/\/github\.com\/adoptium\/temurin21-binaries\/releases\/download\/jdk-21\.0\.11%2B10\//);
    assert.ok(runtime.name.includes(`${arch === 'arm64' ? 'aarch64' : 'x64'}_${platform === 'darwin' ? 'mac' : 'linux'}`));
    const manifest = JSON.parse(await readFile(join(options.root, 'renderer.json'), 'utf8'));
    await access(join(options.root, manifest.java));
  }
  await assert.rejects(setupRenderer({ root: join(root, 'unsupported'), platform: 'win32', arch: 'x64' }), /macOS\/Linux/);
  await assert.rejects(access(join(root, 'unsupported')));
});

test('downloads verify cached bytes, replace corrupt caches and preserve files on bad hashes or HTTP errors', async t => {
  const root = await workspace(t), good = Buffer.from('verified content'), expected = sha(good);
  const path = join(root, 'artifact');
  const get = fetchImpl => downloadVerified(root, 'https://example.invalid/artifact', 'artifact', expected, { fetchImpl, log: quiet });
  await writeFile(path, good);
  await get(() => { throw new Error('must stay offline'); });
  await writeFile(path, 'corrupt cache');
  await assert.rejects(get(async () => new Response('bad bytes')), /SHA-256 mismatch/);
  assert.equal(await readFile(path, 'utf8'), 'corrupt cache');
  let cancelled = false;
  const errorBody = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(get(async () => new Response(errorBody, { status: 503 })), /HTTP 503/);
  assert.equal(cancelled, true);
  await get(async (_, options) => { assert.ok(options.signal); return new Response(good); });
  assert.deepEqual(await readFile(path), good);
  assert.deepEqual(await readdir(root), ['artifact']);
});

test('interrupted and over-limit downloads clean up staging files without clobbering the cache', async t => {
  const root = await workspace(t), path = join(root, 'artifact');
  await writeFile(path, 'original');
  let chunks = 0;
  const interrupted = new ReadableStream({ pull(controller) {
    if (chunks++) controller.error(new Error('connection interrupted'));
    else controller.enqueue(new Uint8Array([1, 2, 3]));
  } });
  await assert.rejects(downloadVerified(root, 'https://example.invalid', 'artifact', sha('valid'), {
    fetchImpl: async () => new Response(interrupted), log: quiet,
  }), /connection interrupted/);
  const megabyte = new Uint8Array(1024 * 1024);
  const oversized = new ReadableStream({ pull(controller) { controller.enqueue(megabyte); } });
  await assert.rejects(downloadVerified(root, 'https://example.invalid', 'artifact', sha('valid'), {
    fetchImpl: async () => new Response(oversized), log: quiet,
  }), /exceeds 128 MiB/);
  assert.equal(await readFile(path, 'utf8'), 'original');
  assert.deepEqual(await readdir(root), ['artifact']);
});

test('cached checksum readers close before tool checks and allow the setup process to exit', async t => {
  const root = await workspace(t), bytes = Buffer.alloc(4 * 1024 * 1024, 42);
  await writeFile(join(root, 'cached'), bytes);
  const code = `
    import { spawnSync } from 'node:child_process';
    import { downloadVerified } from ${JSON.stringify(new URL('../scripts/setup-renderer.mjs', import.meta.url).href)};
    for (let i = 0; i < 2; i++) await downloadVerified(${JSON.stringify(root)}, 'https://example.invalid', 'cached', ${JSON.stringify(sha(bytes))}, {
      fetchImpl: () => { throw new Error('must use cache'); }, log: () => {},
    });
    const check = spawnSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 2000 });
    if (check.status !== 0) throw new Error('tool check failed');
    console.log('ready');
  `;
  for (let i = 0; i < 8; i++) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, `attempt ${i + 1}: ${child.error?.message ?? child.stderr}`);
    assert.equal(child.stdout, 'ready\n');
  }
});
