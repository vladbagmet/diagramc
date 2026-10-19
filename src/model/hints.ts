/**
 * "Did you mean" suggestions for agents that write models from memory: property
 * names and enumerated values from other tools and notations (PlantUML, Mermaid,
 * XMI) are mapped to this CLI's vocabulary, and typos to the nearest allowed word.
 */

/** Common names for a property -> the names this CLI uses. First match that is allowed wins. */
const PROPERTY_SYNONYMS: Record<string, readonly string[]> = {
  methods: ['operations'], method: ['operations'], functions: ['operations'], ops: ['operations'],
  fields: ['attributes', 'slots'], attributes: ['slots', 'attributes'], properties: ['attributes', 'slots'], members: ['attributes'], attrs: ['attributes'], tags: ['attributes', 'stereotypes'],
  values: ['literals', 'slots', 'states'], enumliterals: ['literals'], items: ['literals', 'items'],
  label: ['name', 'text', 'guard'], name: ['feature', 'name', 'text'], at: ['at', 'fromTime'], type: ['notation', 'sort', 'type'], title: ['name'], caption: ['name'], text: ['name', 'text'], description: ['text', 'name'], comment: ['text'], content: ['text'],
  source: ['from'], src: ['from'], start: ['from'], begin: ['from'], origin: ['from'], sender: ['from'], client: ['from'], parent: ['owner', 'from'],
  target: ['to'], dest: ['to'], destination: ['to'], end: ['to'], receiver: ['to'], supplier: ['to'],
  participants: ['lifelines'], actors: ['lifelines', 'elements'], objects: ['lifelines', 'elements'],
  messages: ['items', 'messages'], steps: ['items'], interactions: ['items'],
  classes: ['elements'], components: ['elements'], entities: ['elements'], states: ['states', 'vertices', 'elements'], vertices: ['vertices', 'nodes'],
  relations: ['relationships'], relationships: ['relationships', 'edges', 'links'], associations: ['relationships'], connections: ['relationships', 'edges', 'links'],
  edges: ['edges', 'relationships', 'transitions'], links: ['links', 'relationships'], flows: ['edges'], transitions: ['transitions'],
  stereotype: ['keyword', 'stereotypes', 'appliedStereotypes'], keywords: ['stereotypes', 'keyword'], tag: ['keyword'],
  extends: ['generalization', 'general'], inherits: ['generalization', 'general'], parents: ['generalization'],
  params: ['parameters', 'arguments'], args: ['arguments', 'parameters'], argument: ['arguments'], parameter: ['parameters'],
  returns: ['returnType', 'returnValue'], return: ['returnType', 'returnValue'], returntype: ['returnType'], result: ['returnValue', 'returnType'],
  multiplicity: ['fromEnd', 'toEnd', 'multiplicity'], cardinality: ['multiplicity', 'fromEnd', 'toEnd'],
  time: ['at'], timestamp: ['at'], t: ['at'], event: ['trigger', 'state'], action: ['effect'], effect: ['effect'],
  condition: ['guard'], when: ['guard'],
  lane: ['partition'], swimlane: ['partition'], swimlanes: ['partitions'], lanes: ['partitions'],
  children: ['members', 'parts', 'nested'], contains: ['members', 'parts'], elements: ['elements', 'members', 'nodes'],
  notation: ['notation'], style: ['notation'], kind: ['type'], category: ['type'],
  default: ['defaultValue', 'default'], value: ['value', 'defaultValue'], initial: ['defaultValue'],
};

/** Common names for an enumerated value (mostly `type`) -> the values this CLI uses. */
const VALUE_SYNONYMS: Record<string, readonly string[]> = {
  inheritance: ['generalization'], extend: ['generalization', 'extend', 'extension'], inherit: ['generalization'], isa: ['generalization'], specialization: ['generalization'],
  implements: ['realization', 'interfaceRealization'], implementation: ['realization'], realizes: ['realization'], realize: ['realization'],
  uses: ['usage', 'dependency', 'use'], use: ['usage', 'dependency', 'use'], depends: ['dependency'], dependson: ['dependency'],
  has: ['association', 'composition'], aggregate: ['aggregation'], composite: ['composition'], contain: ['containment', 'composition'], containment: ['containment'],
  abstractclass: ['class'], abstract: ['class'], entity: ['class'], record: ['dataType'], struct: ['dataType'], enum: ['enumeration'],
  database: ['component', 'node', 'artifact'], db: ['component', 'node', 'artifact'], service: ['component'], module: ['component', 'package'], library: ['component', 'artifact'],
  server: ['node', 'device'], container: ['executionEnvironment', 'node'], vm: ['executionEnvironment', 'node'], file: ['artifact'], jar: ['artifact'],
  final: ['finalState', 'activityFinal', 'final'], end: ['finalState', 'activityFinal'], stop: ['activityFinal', 'finalState'], start: ['initial'],
  task: ['action'], activity: ['action'], step: ['action'], process: ['action'], condition: ['decision'], branch: ['decision'], if: ['decision'], join: ['merge'],
  sync: ['synchronous'], async: ['asynchronous'], synchronous: ['synchronous'], asynchronous: ['asynchronous'], reply: ['reply'], call: ['synchronous'], return: ['reply'], response: ['reply'], signal: ['asynchronous'], new: ['create'], destroy: ['delete'],
  alt: ['fragment'], opt: ['fragment'], loop: ['fragment'], par: ['fragment'], break: ['fragment'], critical: ['fragment'],
  person: ['actor'], user: ['actor'], system: ['subject'], boundary: ['subject', 'boundary'],
  instance: ['instance', 'instanceSpecification', 'object'], object: ['instance', 'instanceSpecification', 'object'], extends: ['extension', 'generalization'],
};

/** Lowercase letters and digits only: "use_case", "Use-Case" and "useCase" compare equal. */
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/gu, '');

/** Levenshtein distance, capped for speed. */
export function editDistance(a: string, b: string, cap = 8): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * The allowed word an agent most likely meant by `wrong`, or undefined:
 * same word in another spelling, a known synonym, a close typo, or an allowed
 * word contained in it ("abstract class" -> "class").
 */
export function suggest(wrong: string, allowed: readonly string[], what: 'property' | 'value' | 'id' = 'property'): string | undefined {
  if (!allowed.length) return undefined;
  // UML visibility symbols.
  const symbol = ({ '+': 'public', '-': 'private', '#': 'protected', '~': 'package' } as Record<string, string>)[wrong.trim()];
  if (symbol && allowed.includes(symbol)) return symbol;
  const w = squash(wrong);
  if (!w) return undefined;
  const same = allowed.find(a => squash(a) === w);
  if (same) return same;
  if (what !== 'id') {
    const hit = (what === 'property' ? PROPERTY_SYNONYMS : VALUE_SYNONYMS)[w]?.find(s => allowed.includes(s));
    if (hit) return hit;
  }
  // Plural and singular.
  const plural = allowed.find(a => squash(a) === `${w}s` || `${squash(a)}s` === w);
  if (plural) return plural;
  let best: string | undefined, bestDistance = Infinity;
  for (const a of allowed) {
    const d = editDistance(w, squash(a));
    if (d < bestDistance) { best = a; bestDistance = d; }
  }
  if (best !== undefined && bestDistance <= Math.max(1, Math.floor(Math.min(w.length, squash(best).length) / 3))) return best;
  if (what === 'id') return undefined;
  // An allowed word inside the wrong one ("abstract class", "databaseNode") or the other way round.
  const inside = allowed.filter(a => squash(a).length >= 3 && (w.includes(squash(a)) || (w.length >= 4 && squash(a).includes(w)))).sort((p, q) => q.length - p.length)[0];
  return inside;
}

/** Comma-separated quoted list, for messages. */
export const quoted = (values: readonly unknown[]): string => values.map(v => JSON.stringify(v)).join(', ');
