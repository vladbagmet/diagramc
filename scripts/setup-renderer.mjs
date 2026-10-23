import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, open, readFile, writeFile, rename, rm, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Official release artifacts, pinned by version AND SHA-256. Never installs globally.
const defaultRoot = fileURLToPath(new URL('../.tools/', import.meta.url));
const jreVersion = '21.0.11_10';
const runtimes = {
  'darwin-arm64': ['aarch64_mac', '4b7a8cd23102c251c8b8be42a9a5f1263fb337cf1037f6f64b25f3070efe4b76'],
  'darwin-x64': ['x64_mac', 'b341fb8ed5b70d49066b98176bc98e30f55082192403deb60e0cd5948b6e7923'],
  'linux-arm64': ['aarch64_linux', 'fa23d9d9945053e67bcc7638410eabf1e17a7672c7c95a24f70cd08b8407d36e'],
  'linux-x64': ['x64_linux', 'e5038aae3ca9ff670bc696496b0728dbd23d280026bad30291cb919221ecfdcb'],
};
const maxDownloadBytes = 128 * 1024 * 1024;

async function checksum(path) {
  const hash = createHash('sha256');
  let size = 0;
  let file;
  try {
    file = await open(path, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maxDownloadBytes) return;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    await file?.close();
  }
}

export async function downloadVerified(root, url, name, expected, { fetchImpl = fetch, log = console.log } = {}) {
  const path = join(root, name);
  if ((await checksum(path)) === expected) return path;
  log(`Downloading ${name}`);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Download failed: HTTP ${response.status}: ${url}`);
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxDownloadBytes) throw new Error(`Download exceeds 128 MiB: ${name}`);
      hash.update(chunk);
      await file.writeFile(chunk);
    }
    if (hash.digest('hex') !== expected) throw new Error(`SHA-256 mismatch for ${name}; refusing to use download`);
    await file.close();
    file = undefined;
    await rename(temporary, path);
    return path;
  } finally {
    await file?.close();
    await unlink(temporary).catch(() => {});
  }
}

// The pinned Inter faces (SIL OFL 1.1, assets/fonts) are installed into the local
// Java runtime's font directory, so PlantUML measures text with the same font the
// own engine embeds in every SVG. The repository copy is the single source.
const fontSource = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const fontNames = ['Inter-Regular.ttf', 'Inter-Italic.ttf', 'Inter-Bold.ttf', 'Inter-BoldItalic.ttf'];

const runtimeHome = (directory, platform) => join(directory, 'jdk-21.0.11+10-jre', ...(platform === 'darwin' ? ['Contents', 'Home'] : []));

export async function installFonts(home) {
  const target = join(home, 'lib', 'fonts');
  await mkdir(target, { recursive: true });
  for (const name of fontNames) {
    const expected = await checksum(join(fontSource, name));
    if (!expected) throw new Error(`Missing bundled font ${name}`);
    if ((await checksum(join(target, name))) === expected) continue;
    const temporary = join(target, `.${name}.${randomUUID()}.tmp`);
    try {
      await copyFile(join(fontSource, name), temporary);
      await rename(temporary, join(target, name));
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}

async function checkRuntime(directory, platform, run) {
  const home = runtimeHome(directory, platform);
  const release = await readFile(join(home, 'release'), 'utf8');
  if (!release.includes('IMPLEMENTOR_VERSION="Temurin-21.0.11+10"') || !release.includes('JAVA_VERSION="21.0.11"')) {
    throw new Error('Extracted runtime has an unexpected version');
  }
  await access(join(home, 'bin/java'), constants.X_OK);
  await access(join(home, 'legal/java.base/LICENSE'));
  await access(join(home, 'NOTICE'));
  const env = { ...process.env };
  for (const key of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH']) delete env[key];
  const check = run(join(home, 'bin/java'), ['-version'], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024, env });
  if (check.error || check.status !== 0 || !check.stderr?.includes('Temurin-21.0.11+10')) {
    throw new Error(`Local Java failed: ${check.error?.message ?? check.stderr}`);
  }
  return check.stderr.trim();
}

export async function setupRenderer({
  root = defaultRoot,
  platform = process.platform,
  arch = process.arch,
  download = downloadVerified,
  run = spawnSync,
  log = console.log,
} = {}) {
  const runtime = runtimes[`${platform}-${arch}`];
  if (!runtime) throw new Error('Automatic setup supports macOS/Linux on arm64/x64 only. Set UML_JAVA and PLANTUML_JAR manually.');
  await mkdir(root, { recursive: true });
  const jar = 'plantuml-1.2025.10.jar';
  await download(
    root,
    `https://github.com/plantuml/plantuml/releases/download/v1.2025.10/${jar}`,
    jar,
    '4a01ea09b317180fb8e7eef712dfdca725409d2ee1919e4b5adfe9d8362b6fe5',
    { log },
  );
  const archiveName = `OpenJDK21U-jre_${runtime[0]}_hotspot_${jreVersion}.tar.gz`;
  const archive = await download(
    root,
    `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/${archiveName}`,
    archiveName,
    runtime[1],
    { log },
  );
  const unpack = join(root, 'runtime');
  const marker = JSON.stringify({ sha256: runtime[1], platform, arch });
  let version;
  try {
    if ((await readFile(join(unpack, '.complete.json'), 'utf8')) === marker) version = await checkRuntime(unpack, platform, run);
  } catch {
    /* Recover missing, interrupted or broken installations from the verified archive. */
  }
  if (!version) {
    const stage = await mkdtemp(join(root, '.runtime-stage-'));
    let backup;
    let installed = false;
    try {
      const tar = run('tar', ['-xzf', archive, '-C', stage], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
      if (tar.error || tar.status !== 0) throw new Error(`Could not extract runtime: ${tar.error?.message ?? tar.stderr}`);
      version = await checkRuntime(stage, platform, run);
      await writeFile(join(stage, '.complete.json'), marker);
      const previous = join(root, `.runtime-backup-${randomUUID()}`);
      try {
        await rename(unpack, previous);
        backup = previous;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        await rename(stage, unpack);
        installed = true;
      } catch (error) {
        if (backup) {
          await rename(backup, unpack);
          backup = undefined;
        }
        throw error;
      }
    } finally {
      // Only remove our own stage and the replaced, setup-managed runtime.
      await rm(stage, { recursive: true, force: true });
      if (backup && installed) await rm(backup, { recursive: true, force: true });
    }
  }
  await installFonts(runtimeHome(unpack, platform));
  const java = join('runtime', 'jdk-21.0.11+10-jre', platform === 'darwin' ? 'Contents/Home/bin/java' : 'bin/java');
  const temporary = join(root, `renderer.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ jar, java, plantuml: '1.2025.10', temurin: '21.0.11+10', fonts: 'Inter 4.1' }, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, join(root, 'renderer.json'));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  log(version);
  log(`Renderer ready in ${root}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await setupRenderer();
  } catch (error) {
    console.error(`Renderer setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
