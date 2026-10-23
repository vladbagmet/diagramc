import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { exportDocument, importText } from '../dist/formats/index.js';
import { plantumlAliases } from '../dist/formats/plantuml/text.js';
import { mermaidAliases } from '../dist/formats/mermaid/text.js';
import { root } from './helpers.mjs';

/** Kinds each format imports, so their examples must survive a round trip. */
export const ROUND_TRIP = {
  plantuml: ['class'],
  mermaid: [],
};

/** Every example model of a kind: [{ name, text }]. */
export async function examples(kind) {
  const dir = join(root, 'examples', kind);
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
  return Promise.all(files.map(async f => ({ name: `${kind}/${f}`, text: await readFile(join(dir, f), 'utf8') })));
}

/** Model -> text -> model. Returns the original, the export, its warnings and the imported model. */
export function roundTrip(text, format) {
  const parsed = parseDocument(text);
  const exported = exportDocument(parsed, format);
  const imported = importText(exported.text, format).model;
  return { original: parsed.model, exported, imported };
}

/**
 * Renames every ID of a model the way the exporter's aliases do ("-" -> "_",
 * keywords suffixed), in document order, everywhere it is used as a reference.
 */
export function aliasIds(model, format) {
  const aliases = format === 'plantuml' ? plantumlAliases() : mermaidAliases();
  const ids = new Set();
  const collect = node => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') ids.add(node.id);
    Object.values(node).forEach(collect);
  };
  collect(model);
  const map = new Map([...ids].map(id => [id, aliases.get(id)]));
  const rename = (node, key) => {
    if (Array.isArray(node)) return node.map(n => rename(n, key));
    if (typeof node === 'string') return REFERENCE_KEYS.has(key) && map.has(node) ? map.get(node) : node;
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rename(v, k)]));
  };
  return rename(model, '');
}

/** Properties whose string values (or lists of strings) are IDs. */
const REFERENCE_KEYS = new Set(['id', 'from', 'to', 'attachedTo', 'subject', 'partition', 'lifeline', 'lifelines', 'covered', 'members', 'submachine_ref']);

/** A copy with object keys sorted, so key order never matters in comparisons. */
export function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]));
}
