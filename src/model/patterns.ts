import { commonDefinitions } from '../core/text.js';

const ID = commonDefinitions.id.pattern;
const MULTIPLICITY = commonDefinitions.multiplicity.pattern;

/**
 * A corrected value for a string that fails a shared pattern, when the intent is
 * clear: IDs with spaces, dots or other characters ("engine.tank" -> "engine-tank"),
 * multiplicities written in words or with letters ("many" -> "*", "0..n" -> "0..*").
 * Undefined when there is no safe correction.
 */
export function fixPattern(pattern: string, value: string): string | undefined {
  if (pattern === ID) {
    let id = value
      .normalize('NFKD')
      .replaceAll(/[̀-ͯ]/gu, '')
      .replaceAll(/[^A-Za-z0-9_-]+/gu, '-')
      .replace(/^[^A-Za-z]+/u, '')
      .replace(/-+$/u, '')
      .slice(0, 64);
    if (!id) id = 'id';
    return new RegExp(ID, 'u').test(id) ? id : undefined;
  }
  if (pattern === MULTIPLICITY) {
    const v = value.trim().toLowerCase().replaceAll(/\s+/gu, '');
    const words: Record<string, string> = {
      many: '*',
      n: '*',
      m: '*',
      'zero-or-more': '*',
      zeroormore: '*',
      'one-or-more': '1..*',
      oneormore: '1..*',
      one: '1',
      'zero-or-one': '0..1',
      zeroorone: '0..1',
      optional: '0..1',
    };
    if (words[v]) return words[v];
    const fixed = v.replaceAll(/\.{3,}|-|…/gu, '..').replaceAll(/\b[nm]\b|∞/gu, '*');
    return new RegExp(MULTIPLICITY, 'u').test(fixed) ? fixed : undefined;
  }
  return undefined;
}
