import { createHash } from 'node:crypto';

/**
 * Examples and fixtures that fail a QA gate added before the layout of their kind
 * was fixed. Each entry names the review finding that covers the defect, the
 * gate, and a pattern every tolerated problem of that gate must match; every
 * other gate, and every other problem, must still pass. When a kind is fixed, its
 * entries become stale and the tests fail until they are removed: this list only
 * ever shrinks.
 *
 * A document is matched by `kind` and `title`, or (untitled fixtures) by `hash`:
 * the first 12 hex digits of the SHA-1 of JSON.stringify(document).
 */
export const KNOWN_GATE_FAILURES = [
  { finding: 'F-B-08', kind: 'component', title: "Enterprise integration platform with an unusually long diagram title to test the frame heading", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/component-awkward.json and component-c2-awkward.json" },
  { finding: 'F-A-05', kind: 'composite-structure', title: "Awkward composite", gate: 'label-proximity', problem: /another line must be/, source: "test/fixtures/regression/cs-awkward.json" },
];

const hashOf = (doc) => createHash('sha1').update(JSON.stringify(doc)).digest('hex').slice(0, 12);

function entriesFor(document) {
  const doc = typeof document === 'string' ? JSON.parse(document) : document;
  const hash = hashOf(doc);
  return KNOWN_GATE_FAILURES.filter(e => e.hash ? e.hash === hash : e.kind === doc.kind && e.title === doc.title);
}

/**
 * Splits gate failures ({ gate, problems }) of a document into those no entry
 * tolerates (`unexpected`) and entries that no longer fail (`stale`).
 */
export function judgeFailures(document, failures) {
  const entries = entriesFor(document);
  const used = new Set();
  const unexpected = [];
  for (const { gate, problems } of failures) {
    for (const problem of problems) {
      const entry = entries.find(e => e.gate === gate && e.problem.test(problem));
      if (entry) used.add(entry); else unexpected.push(`${gate}: ${problem}`);
    }
  }
  const stale = entries.filter(e => !used.has(e)).map(e => `${e.finding} (${e.gate}, ${e.problem})`);
  return { unexpected, stale };
}

/** Message for a failed judgement, or undefined when the document is fine. */
export function judgementMessage(document, failures) {
  const { unexpected, stale } = judgeFailures(document, failures);
  const parts = [];
  if (unexpected.length > 0) {
    const doc = typeof document === 'string' ? JSON.parse(document) : document;
    parts.push(`QA gates failed (kind ${doc.kind}, ${doc.title === undefined ? `hash ${hashOf(doc)}` : `title ${JSON.stringify(doc.title)}`}):\n  ${unexpected.join('\n  ')}`);
  }
  if (stale.length > 0) parts.push(`fixed, remove from KNOWN_GATE_FAILURES (test/known-gate-failures.mjs): ${stale.join('; ')}`);
  return parts.length > 0 ? parts.join('\n') : undefined;
}
