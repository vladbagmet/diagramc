import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { UmlError } from '../core/errors.js';
import { MAX_OUTPUT_BYTES } from '../core/limits.js';

/** PlantUML's -charset takes a Java charset name. */
const JAVA_CHARSET = 'UTF-8'; // eslint-disable-line unicorn/text-encoding-identifier-case -- Java's name for the charset

export interface RendererOptions {
  java: string;
  jar: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Expected `data-diagram-type` of the root element, e.g. "CLASS". Any type when omitted. */
  diagramType?: string;
}

/** Locates the pinned local Java and PlantUML jar, or trusted UML_JAVA/PLANTUML_JAR overrides. */
export async function rendererOptions(tools = fileURLToPath(new URL('../../.tools/', import.meta.url))): Promise<RendererOptions> {
  const setup = fileURLToPath(new URL('../../scripts/setup-renderer.mjs', import.meta.url));
  const missing = () => new UmlError('RENDERER_MISSING',
    `The PlantUML renderer is not set up. Run: node ${JSON.stringify(setup)} (npm run setup:renderer in a source checkout), or set both UML_JAVA and PLANTUML_JAR`, 3,
    { setup: `node ${JSON.stringify(setup)}`, env: ['UML_JAVA', 'PLANTUML_JAR'] });
  if (process.env.UML_JAVA || process.env.PLANTUML_JAR) {
    if (!process.env.UML_JAVA || !process.env.PLANTUML_JAR) throw missing();
    return { java: process.env.UML_JAVA, jar: process.env.PLANTUML_JAR };
  }
  try {
    const local: unknown = JSON.parse(await readFile(resolve(tools, 'renderer.json'), 'utf8'));
    if (!local || typeof local !== 'object' || !('java' in local) || !('jar' in local) ||
        typeof local.java !== 'string' || !local.java || local.java.includes('\0') ||
        typeof local.jar !== 'string' || !local.jar || local.jar.includes('\0')) throw missing();
    return { java: resolve(tools, local.java), jar: resolve(tools, local.jar) };
  } catch { throw missing(); }
}

/**
 * Runs PlantUML once on `source` and returns its SVG. No shell, SECURE profile,
 * bounded heap, time, output and diagnostics. Signals stop Java and reject.
 */
export function renderSvg(source: string, options: RendererOptions): Promise<Buffer> {
  return new Promise((accept, reject) => {
    const env = { ...process.env, PLANTUML_SECURITY_PROFILE: 'SECURE', PLANTUML_LIMIT_SIZE: '8192' };
    for (const key of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH']) Reflect.deleteProperty(env, key);
    const child = spawn(options.java, [
      '-Xmx256m', '-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=SECURE',
      '-jar', options.jar, '-charset', JAVA_CHARSET, '-tsvg', '-pipe', '-nometadata', '-failfast2',
    ], { shell: false, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0, stderrSize = 0, failure: UmlError | undefined;
    const stop = (error: UmlError): void => { failure ??= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => { stop(new UmlError('RENDER_TIMEOUT', 'Renderer exceeded time limit', 3)); }, options.timeoutMs ?? 20_000);
    const interrupt = () => { stop(new UmlError('RENDER_INTERRUPTED', 'Renderer interrupted by SIGINT', 130)); };
    const terminate = () => { stop(new UmlError('RENDER_INTERRUPTED', 'Renderer interrupted by SIGTERM', 143)); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    const cleanup = (): void => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutputBytes ?? MAX_OUTPUT_BYTES)) {
        stop(new UmlError('RENDER_OUTPUT_LIMIT', 'Renderer output exceeded byte limit', 3));
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > 64 * 1024) stop(new UmlError('RENDER_OUTPUT_LIMIT', 'Renderer diagnostics exceeded byte limit', 3));
    });
    child.on('error', () => {
      cleanup();
      reject(new UmlError('RENDER_START_FAILED', 'Could not start Java renderer; check UML_JAVA and local setup', 3));
    });
    child.on('close', (code, signal) => {
      cleanup();
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new UmlError('RENDER_FAILED', 'PlantUML renderer failed', 3, { exitCode: code, signal })); return; }
      const svg = Buffer.concat(chunks);
      const text = svg.toString('utf8');
      const type = options.diagramType && /^[A-Z_]+$/u.test(options.diagramType) ? options.diagramType : '[A-Z_]+';
      if (!new RegExp(String.raw`^\s*(?:<\?xml[^>]*>\s*)?<svg\s[^>]*data-diagram-type="${type}"`, 'u').test(text) || !text.trimEnd().endsWith('</svg>')) {
        reject(new UmlError('RENDER_INVALID_OUTPUT', 'Renderer did not return a complete SVG of the expected diagram type', 3)); return;
      }
      // Preserve spaces in both legacy SVG viewers and SVG2 browsers, whose text
      // defaults can override inherited xml:space. Only fixed CSS is introduced.
      const output = Buffer.from(fitSelfAssociations(text).replace(/<svg\s[^>]*>/u, root => root
        .replace(/\s+xml:space=(?:"[^"]*"|'[^']*')/u, '')
        .replace(/^<svg\s/u, '<svg xml:space="preserve" '))
        .replaceAll(/<text\b[^>]*>/gu, tag => tag.includes(' style="')
          ? tag.replace(/ style="([^"]*)"/u, (_, style: string) => ` style="${style};white-space:pre"`)
          : tag.replace(/^<text/u, '<text style="white-space:pre"')), 'utf8');
      if (output.length > (options.maxOutputBytes ?? MAX_OUTPUT_BYTES)) {
        reject(new UmlError('RENDER_OUTPUT_LIMIT', 'Renderer output exceeded byte limit', 3)); return;
      }
      accept(output);
    });
    child.stdin.on('error', () => { /* Early renderer exit is reported by close/error. */ });
    child.stdin.end(source, 'utf8');
  });
}

// Pinned Smetana omits the top extent of self-association curves and labels from
// its viewport. Expand only that edge case, without changing its graph layout.
function fitSelfAssociations(svg: string): string {
  let top = 0;
  const number = (attributes: string, name: string): number =>
    Number((new RegExp(String.raw`(?:^|\s)${name}="(-?[\d.]+)"`, 'u').exec(attributes))?.[1]);
  for (const [, attributes, content] of svg.matchAll(/<g class="link"([^>]*)>([\s\S]*?)<\/g>/gu)) {
    const from = (/ data-entity-1="([^"]+)"/u.exec((attributes!)))?.[1];
    const to = (/ data-entity-2="([^"]+)"/u.exec((attributes!)))?.[1];
    if (!from || from !== to) continue;
    for (const [, text] of content!.matchAll(/<text\b([^>]*)>/gu)) {
      const y = number(text!, 'y'), size = number(text!, 'font-size');
      if (Number.isFinite(y) && Number.isFinite(size)) top = Math.min(top, y - size);
    }
    // These undirected self-edges use absolute M/C paths. Control points provide
    // conservative bounds for the cubic curves, including unlabeled loops.
    for (const [, path] of content!.matchAll(/<path\b[^>]* d="([MC\d., -]+)"/gu)) {
      const points = path!.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
      for (let i = 1; i < points.length; i += 2) top = Math.min(top, points[i]!);
    }
  }
  if (top >= 0) return svg;
  top = Math.floor(top - 4);
  return svg.replace(/<svg\s[^>]*>/u, root => {
    const dimensions = / viewBox="0 0 ([\d.]+) ([\d.]+)"/u.exec(root);
    if (!dimensions) return root;
    const height = Number(dimensions[2]) - top;
    return root.replace(dimensions[0], ` viewBox="0 ${top} ${dimensions[1]} ${height}"`)
      .replace(/ height="[\d.]+px"/u, ` height="${height}px"`)
      .replace(/height:[\d.]+px;/u, `height:${height}px;`);
  });
}
