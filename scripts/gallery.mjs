// Renders every example of every registered kind to SVG and PNG (2x) under
// artifacts/gallery/<kind>/, runs every QA gate on each, and writes an
// index.html overview. Exits non-zero if any example fails a gate.
// Usage: npm run gallery [-- <kind> ...]
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kinds } from '../dist/model/registry.js';
import { renderAndCheck, formatReport } from '../dist/qa/index.js';
import { rasterize } from '../dist/engine/png.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'artifacts', 'gallery');
const only = process.argv.slice(2);
const escape = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

async function jsonFiles(dir) {
  try { return (await readdir(dir)).filter(f => f.endsWith('.json')).sort().map(f => join(dir, f)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

const sections = [];
let failures = 0;
for (const kind of kinds) {
  if (only.length && !only.includes(kind.kind)) continue;
  const files = [...await jsonFiles(join(root, 'examples', kind.kind))];
  // Legacy documents (the MVP's v1 format) are class diagrams; show them with the class kind.
  if (kind.legacy) files.push(...(await jsonFiles(join(root, 'examples', 'v1'))));
  const dir = join(out, kind.kind);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const cards = [];
  for (const file of files) {
    const name = (file.includes(`${join('examples', 'v1')}`) ? 'v1-' : '') + basename(file, '.json');
    const { svg, report, ms } = await renderAndCheck(await readFile(file, 'utf8'));
    await writeFile(join(dir, `${name}.svg`), svg);
    await writeFile(join(dir, `${name}.png`), await rasterize(svg, 2));
    const failed = report.gates.filter(g => !g.ok);
    if (failed.length) { failures++; console.error(`FAIL ${kind.kind}/${name}\n${formatReport(report)}`); }
    else console.log(`ok   ${kind.kind}/${name} (${ms.toFixed(0)} ms)`);
    cards.push({ name, ms, failed, skipped: report.gates.filter(g => g.skipped).map(g => g.gate) });
  }
  sections.push({ kind, cards });
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>UML gallery</title>
<style>
body{font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;background:#F1F5F9;color:#0F172A}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}p{margin:0 0 16px;color:#334155}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #CBD5E1;border-radius:6px;padding:12px}
figure a{display:block}img{width:100%;height:auto;max-height:520px;object-fit:contain;background:#fff}
figcaption{margin-top:8px;font-size:13px;display:flex;justify-content:space-between;gap:8px}
.ok{color:#166534}.fail{color:#B91C1C;white-space:pre-wrap}
</style></head><body>
<h1>UML gallery</h1>
<p>Every example of every kind, rendered with its default backend. Click an image for the SVG. Gates: all hard QA gates of src/qa.</p>
${sections.map(({ kind, cards }) => `<h2>${escape(kind.title)} <small>(${escape(kind.kind)}, ${escape(kind.backends[0].name)})</small></h2>
<div class="grid">${cards.map(c => `<figure><a href="${escape(kind.kind)}/${escape(c.name)}.svg"><img src="${escape(kind.kind)}/${escape(c.name)}.png" alt="${escape(c.name)}"></a>
<figcaption><strong>${escape(c.name)}</strong><span>${c.ms.toFixed(0)} ms</span>${c.failed.length
    ? `<span class="fail">FAIL: ${escape(c.failed.map(g => g.gate).join(', '))}</span>`
    : `<span class="ok">all gates pass${c.skipped.length ? ` (skipped: ${escape(c.skipped.join(', '))})` : ''}</span>`}</figcaption></figure>`).join('\n')}</div>`).join('\n')}
</body></html>
`;
await mkdir(out, { recursive: true });
await writeFile(join(out, 'index.html'), html);
console.log(`Gallery: ${join(out, 'index.html')}`);
if (failures) { console.error(`${failures} example(s) failed QA gates`); process.exitCode = 1; }
