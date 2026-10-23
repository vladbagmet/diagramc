/**
 * Identifier handling shared by every format. Model IDs may contain "-", which
 * neither PlantUML nor Mermaid accepts in an alias: it becomes "_" (and a
 * numeric suffix when that collides with another ID). Imported names without
 * an alias get an ID derived from the name.
 */

const ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

/** Export side: model ID -> alias that is valid in both formats, stable and unique. */
export class Aliases {
  private readonly byId = new Map<string, string>();
  private readonly used = new Set<string>();
  constructor(reserved: Iterable<string> = []) {
    for (const r of reserved) this.used.add(r.toLowerCase());
  }
  get(id: string): string {
    const known = this.byId.get(id);
    if (known !== undefined) return known;
    const alias = unique(id.replaceAll('-', '_'), this.used);
    this.byId.set(id, alias);
    return alias;
  }
}

/** Import side: names and aliases -> model IDs that satisfy the ID pattern, unique per document. */
export class IdMaker {
  private readonly used = new Set<string>();
  /** Reserves an ID written in the source (an alias); undefined when it is not a valid model ID. */
  claim(alias: string): string | undefined {
    if (!ID.test(alias) && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(alias)) return undefined;
    if (this.used.has(alias.toLowerCase())) return alias;
    this.used.add(alias.toLowerCase());
    return alias;
  }
  /** A fresh ID derived from a display name or a fixed prefix ("order item" -> "order_item"). */
  fresh(from: string): string {
    let base = from
      .normalize('NFKD')
      .replaceAll(/[̀-ͯ]/gu, '')
      .replaceAll(/[^A-Za-z0-9_]+/gu, '_')
      .replaceAll(/^_+|_+$/gu, '')
      .slice(0, 56);
    if (!/^[A-Za-z]/u.test(base)) base = `n${base ? `_${base}` : ''}`;
    return unique(base, this.used);
  }
}

function unique(base: string, used: Set<string>): string {
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base}_${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Splits `text` at top-level commas (outside parentheses, brackets, braces and angle brackets). */
export function splitTopLevel(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(p => p.trim());
}

/** Removes properties whose value is undefined (the model never stores them). */
export function compact<T extends Record<string, unknown>>(value: T): Compact<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Compact<T>;
}

/** `T` with every property that may be undefined made optional instead (for `exactOptionalPropertyTypes`). */
export type Compact<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};
