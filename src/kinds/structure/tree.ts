import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';

/**
 * Containment index shared by the validators of the structural kinds: every
 * element (at any nesting depth), port and relationship ID with its JSON
 * Pointer, its container and its type, plus the checks all three kinds share.
 */

export interface TreeItem {
  id: string;
  /** JSON Pointer of the object that declares the ID. */
  path: string;
  /** Element `type`, or "port" / "role" / ... for owned features. */
  type: string;
  /** Containing element (for ports: the owner). */
  parent: string | undefined;
  value: Record<string, unknown>;
}

export class Tree {
  readonly items = new Map<string, TreeItem>();
  private readonly all: TreeItem[] = [];

  add(item: TreeItem): void {
    this.all.push(item);
    if (!this.items.has(item.id)) this.items.set(item.id, item);
  }

  /** DUPLICATE_ID across everything added, plus relationship IDs. */
  checkIds(relationships: readonly { id?: string }[], diagnostics: Diagnostic[], relationshipsKey = 'relationships'): void {
    uniqueIds([
      ...this.all.map(i => ({ id: i.id, path: i.path })),
      ...relationships.flatMap((r, i) => r.id === undefined ? [] : [{ id: r.id, path: pointer('', relationshipsKey, i) }]),
    ], diagnostics);
  }

  get(id: string): TreeItem | undefined { return this.items.get(id); }

  /** The element an endpoint belongs to: a port's owner, or the element itself. */
  owner(id: string, featureTypes: readonly string[] = ['port']): string {
    const item = this.items.get(id);
    return item && featureTypes.includes(item.type) && item.parent !== undefined ? item.parent : id;
  }

  /** Containers of `id`, innermost first (excluding `id`). */
  ancestors(id: string): string[] {
    const out: string[] = [];
    for (let at = this.items.get(id)?.parent; at !== undefined; at = this.items.get(at)?.parent) out.push(at);
    return out;
  }

  /** True when `id` is strictly inside `container` (at any depth). */
  inside(id: string, container: string): boolean { return this.ancestors(id).includes(container); }

  depth(id: string): number { return this.ancestors(id).length; }

  /** MISSING_REFERENCE unless `id` exists; returns the item. */
  ref(id: string, path: string, diagnostics: Diagnostic[], what = 'element'): TreeItem | undefined {
    return reference(id, path, this.items, diagnostics, what) ? this.items.get(id) : undefined;
  }
}

/** Notes: `attachedTo` names existing elements, never another note or a relationship. */
export function checkNotes(notes: readonly { note: { id: string; attachedTo?: string[] }; path: string }[], tree: Tree, diagnostics: Diagnostic[]): void {
  for (const { note, path } of notes) {
    (note.attachedTo ?? []).forEach((id, j) => {
      const at = pointer(path, 'attachedTo', j);
      const target = tree.ref(id, at, diagnostics);
      if (target?.type === 'note') diagnostics.push({ code: 'INVALID_ATTACHMENT', path: at, message: `Note "${note.id}" cannot be attached to another note ("${id}")` });
    });
  }
}

/** NESTING_TOO_DEEP: at most `max` levels of nesting keep diagrams readable and layouts fast. */
export function checkDepth(tree: Tree, max: number, diagnostics: Diagnostic[], featureTypes: readonly string[] = ['port']): void {
  for (const item of tree.items.values()) {
    if (featureTypes.includes(item.type)) continue;
    if (tree.depth(item.id) > max) diagnostics.push({ code: 'NESTING_TOO_DEEP', path: item.path, message: `"${item.id}" is nested ${tree.depth(item.id)} levels deep; at most ${max} levels are supported` });
  }
}
