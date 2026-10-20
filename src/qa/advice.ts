/**
 * What usually helps when a QA gate (src/qa/gates.ts) reports a problem, in terms
 * of the model. Each rule matches one kind of problem message; a problem no rule
 * matches is a renderer defect the model cannot avoid.
 */

const RENDERER_DEFECT = 'This is a renderer defect, not a problem in the model; the diagram may still be usable.';

/** [gate, pattern of the problem message, advice]; the first match wins. */
const RULES: readonly (readonly [string, RegExp, string])[] = [
  ['node-overlap', /overlap/, 'Shapes overlap. Fewer elements per diagram or shorter names usually help.'],
  ['label-overlap', /from the border of/, 'A label sits too close to a shape. Shorter labels, or fewer relationships at that element, usually help.'],
  ['label-overlap', /overlaps (node|text|the frame heading)|labels .* overlap/, 'A label overlaps a shape or another text. Shorter labels or names usually help.'],
  ['label-edge-crossing', /crosses edge/, 'A line runs through a label. Shorter labels or fewer crossing relationships usually help.'],
  ['label-proximity', /^end label .* from its (source|target) end/, 'A role name or multiplicity found no room next to its end. Fewer relationships ending at the same element, or shorter end labels, usually help.'],
  ['label-proximity', /closer to an end of/, 'An end label is nearer another line\'s end than its own. Fewer relationships ending at the same element usually help.'],
  ['label-proximity', /another line must be/, 'A label sits between two lines, so it is unclear which one it names. Fewer parallel relationships between the same elements, or shorter labels, usually help.'],
  ['label-proximity', /from its line/, 'A label is far from its line. Fewer relationships between the same elements usually help.'],
  ['edge-endpoints', /passes through node/, 'A line runs through a shape it does not connect. Fewer crossing relationships, less deeply nested structure, or splitting the diagram usually helps.'],
  ['edge-endpoints', /runs along the border/, 'A line runs along the outline of a shape it does not connect, so it reads as part of that shape. Fewer relationships around that element usually help.'],
  ['edge-endpoints', /header|crosses text/, 'A line runs through the name area of a container. Fewer relationships into nested elements, or connecting to the container itself, usually help.'],
  ['shared-segments', /share/, 'Two lines run on top of each other, so a reader cannot tell where either goes. Fewer relationships at the same element usually help.'],
  ['shared-segments', /meet at/, 'A line bends on another line, so the two look connected. Fewer crossing relationships usually help.'],
  ['route-length', /wraps around|detours|long for a/, 'A line takes a long way round the drawing. Relationships that run against the others (a cycle), or splitting the diagram, usually cause this; reversing or removing one usually helps.'],
  ['end-spacing', /apart/, 'Lines end too close together on one element. Fewer relationships at that element usually help.'],
  ['markers', /overlaps/, 'Arrowheads touch each other. Fewer relationships ending at the same element usually help.'],
  ['message-arrows', /./, 'A message arrow collides with something. Fewer messages on one link usually help.'],
];

/** Advice for one problem of a gate. */
export function adviceFor(gate: string, problem: string): string {
  return RULES.find(([g, pattern]) => g === gate && pattern.test(problem))?.[2] ?? RENDERER_DEFECT;
}

/** Advice for a gate's problems: each distinct piece once, in order of first appearance. */
export function adviceForAll(gate: string, problems: readonly string[]): string {
  return [...new Set(problems.map(p => adviceFor(gate, p)))].join(' ');
}
