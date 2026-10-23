// Regenerates the README images in docs/images/: one PNG per diagram kind,
// rendered at scale 2 by the real CLI with --strict (so a picture that fails a
// layout check is never committed), and docs/images/hero.png, a 2 x 2 collage
// of four of them composed with resvg. Needs `npm run build` and, for
// sequence, timing and activity, the PlantUML runtime (`npm run setup:renderer`).
// Usage: npm run screenshots
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'docs', 'images');
const cli = join(root, 'dist', 'cli.js');
const run = promisify(execFile);

// The example shown for each kind: the tidiest realistic model, never a stress test.
// Keep this list and the README gallery in step.
const shots = [
  ['class', 'notation'],
  ['object', 'order-snapshot'],
  ['package', 'webshop'],
  ['profile', 'ejb'],
  ['communication', 'place-order'],
  ['interaction-overview', 'notation'],
  ['component', 'webshop'],
  ['deployment', 'webshop'],
  ['composite-structure', 'thermostat'],
  ['sequence', 'checkout'],
  ['timing', 'door'],
  ['activity', 'order-handling'],
  ['state-machine', 'media-player'],
  ['use-case', 'notation'],
];

// The hero collage, read left to right, top to bottom.
const hero = ['class', 'sequence', 'state-machine', 'deployment'];

const size = png => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

async function renderShots() {
  for (const [kind, example] of shots) {
    const model = join(root, 'examples', kind, `${example}.json`);
    const target = join(out, `${kind}.png`);
    await run(process.execPath, [cli, 'render', model, '-o', target, '--scale', '2', '--strict']);
    const { width, height } = size(await readFile(target));
    console.log(`${kind}.png  ${width} x ${height}  ${Math.round((await stat(target)).size / 1024)} KiB  (examples/${kind}/${example}.json)`);
  }
}

async function renderHero() {
  const cell = { width: 1200, height: 960 };
  const gap = 32;
  const pad = 24;
  const width = 2 * cell.width + 3 * gap;
  const height = 2 * cell.height + 3 * gap;
  const tiles = [];
  for (const [index, kind] of hero.entries()) {
    const png = await readFile(join(out, `${kind}.png`));
    const image = size(png);
    const scale = Math.min((cell.width - 2 * pad) / image.width, (cell.height - 2 * pad) / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = gap + (index % 2) * (cell.width + gap);
    const y = gap + Math.floor(index / 2) * (cell.height + gap);
    tiles.push(
      `<rect x="${x}" y="${y}" width="${cell.width}" height="${cell.height}" rx="12" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>`,
      `<image x="${x + (cell.width - w) / 2}" y="${y + (cell.height - h) / 2}" width="${w}" height="${h}" href="data:image/png;base64,${png.toString('base64')}"/>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#F1F5F9"/>${tiles.join('')}</svg>`;
  const target = join(out, 'hero.png');
  await writeFile(target, new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
  console.log(`hero.png  ${width} x ${height}  ${Math.round((await stat(target)).size / 1024)} KiB  (${hero.join(', ')})`);
}

await mkdir(out, { recursive: true });
await renderShots();
await renderHero();
