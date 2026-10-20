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
  { finding: 'F-A-13', kind: 'component', title: "Component notation", gate: 'edge-endpoints', problem: /runs through the header/, source: "examples/component/notation.json" },
  { finding: 'F-B-08', kind: 'component', title: "Component notation", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/component/notation.json" },
  { finding: 'F-B-08', kind: 'component', title: "Streaming platform", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/component/stress.json" },
  { finding: 'F-A-05', kind: 'composite-structure', title: "Robot arm controller", gate: 'label-proximity', problem: /another line must be/, source: "examples/composite-structure/stress.json" },
  { finding: 'F-A-04', kind: 'composite-structure', title: "Robot arm controller", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/composite-structure/stress.json" },
  { finding: 'F-A-13', kind: 'composite-structure', title: "Smart thermostat", gate: 'edge-endpoints', problem: /runs through the header/, source: "examples/composite-structure/thermostat.json" },
  { finding: 'F-A-04', kind: 'composite-structure', title: "Smart thermostat", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/composite-structure/thermostat.json" },
  { finding: 'F-B-08', kind: 'deployment', title: "Multi-region SaaS", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/deployment/stress.json" },
  { finding: 'F-B-16', kind: 'interaction-overview', title: "Notation reference", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/interaction-overview/notation.json" },
  { finding: 'F-B-16', kind: 'interaction-overview', title: "Onboarding (stress)", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/interaction-overview/stress.json" },
  { finding: 'F-B-15', kind: 'interaction-overview', title: "Onboarding (stress)", gate: 'route-length', problem: / detours$| wraps around/, source: "examples/interaction-overview/stress.json" },
  { finding: 'F-B-16', kind: 'interaction-overview', title: "WithdrawCash", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/interaction-overview/withdraw-cash.json" },
  { finding: 'F-A-10', kind: 'package', title: "Shop platform", gate: 'route-length', problem: / detours$| wraps around/, source: "examples/package/stress.json" },
  { finding: 'F-B-08', kind: 'state-machine', title: "Order lifecycle", gate: 'edge-endpoints', problem: /runs through the header/, source: "examples/state-machine/notation.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Online shop", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/use-case/online-shop.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Hospital", gate: 'edge-endpoints', problem: /runs through the header/, source: "examples/use-case/stress.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Hospital", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "examples/use-case/stress.json" },
  { finding: 'F-A-01', kind: 'component', hash: '726e47c27536', gate: 'route-length', problem: / detours$| wraps around/, source: "test/fixtures/component/valid.json: assemblies in both directions (a cycle)" },
  { finding: 'F-B-08', kind: 'component', hash: '4e38578be907', gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/component/valid.json: port providing and requiring unconnected interfaces" },
  { finding: 'F-B-08', kind: 'component', hash: '2ee2ab4da134', gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/component/valid.json: three requirers of one provided port" },
  { finding: 'F-A-04', kind: 'composite-structure', hash: 'b3cc5e8dd959', gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/composite-structure/valid.json: two collaboration uses of one collaboration and a dependency" },
  { finding: 'F-B-16', kind: 'interaction-overview', hash: '178ff3c12f55', gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/interaction-overview/valid.json: decision with four branches and a shared final" },
  { finding: 'F-B-08', kind: 'component', title: "Enterprise integration platform with an unusually long diagram title to test the frame heading", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/component-awkward.json and component-c2-awkward.json" },
  { finding: 'F-A-13', kind: 'component', title: "Ride sharing backend", gate: 'edge-endpoints', problem: /runs through the header/, source: "test/fixtures/regression/component-c1-ridesharing.json" },
  { finding: 'F-B-08', kind: 'component', title: "Ride sharing backend", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/component-c1-ridesharing.json" },
  { finding: 'F-A-05', kind: 'composite-structure', title: "Awkward composite", gate: 'label-proximity', problem: /another line must be/, source: "test/fixtures/regression/cs-awkward.json" },
  { finding: 'F-A-04', kind: 'composite-structure', title: "Awkward composite", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/cs-awkward.json" },
  { finding: 'F-A-13', kind: 'composite-structure', title: "Build agent", gate: 'edge-endpoints', problem: /runs through the header/, source: "test/fixtures/regression/cs-ci.json" },
  { finding: 'F-A-04', kind: 'composite-structure', title: "Build agent", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/cs-ci.json" },
  { finding: 'F-A-05', kind: 'deployment', title: "Wide-area network", gate: 'label-proximity', problem: /another line must be/, source: "test/fixtures/regression/deployment-awkward.json and deployment-d2-awkward.json" },
  { finding: 'F-B-16', kind: 'interaction-overview', title: "Negotiation with a really long overview title for the frame", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/interaction-overview-i2-awkward.json" },
  { finding: 'F-B-08', kind: 'state-machine', title: "Autonomous delivery robot mission controller", gate: 'edge-endpoints', problem: /runs through the header/, source: "test/fixtures/regression/state-machine-sm-awk.json" },
  { finding: 'F-B-08', kind: 'state-machine', title: "Autonomous delivery robot mission controller", gate: 'route-length', problem: / detours$| wraps around/, source: "test/fixtures/regression/state-machine-sm-awk.json" },
  { finding: 'F-B-08', kind: 'state-machine', title: "Subscription lifecycle", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/state-machine-sm-sub.json" },
  { finding: 'F-B-08', kind: 'state-machine', title: "Subscription lifecycle", gate: 'route-length', problem: / detours$| wraps around/, source: "test/fixtures/regression/state-machine-sm-sub.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "ATM", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/use-case-u1-atm.json" },
  { finding: 'F-B-18', kind: 'use-case', title: "Permits", gate: 'label-proximity', problem: /another line must be/, source: "test/fixtures/regression/use-case-u2-awkward.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Permits", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/use-case-u2-awkward.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Expense management", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/fixtures/regression/use-case-uc-awk.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Expense management", gate: 'route-length', problem: / detours$| wraps around/, source: "test/fixtures/regression/use-case-uc-awk.json" },
  { finding: 'F-B-08', kind: 'use-case', title: "Food delivery platform", gate: 'edge-endpoints', problem: /runs through the header/, source: "test/fixtures/regression/use-case-uc-lib.json" },
  { finding: 'F-B-16', kind: 'interaction-overview', title: "<script>x</script>", gate: 'shared-segments', problem: / share \d+px of line | meet at /, source: "test/interaction-overview.test.mjs: hostile text" },
  { finding: 'F-B-08', kind: 'use-case', title: "Hospital", gate: 'route-length', problem: / detours$| wraps around/, source: "examples/use-case/stress.json" },
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
  if (unexpected.length) {
    const doc = typeof document === 'string' ? JSON.parse(document) : document;
    parts.push(`QA gates failed (kind ${doc.kind}, ${doc.title !== undefined ? `title ${JSON.stringify(doc.title)}` : `hash ${hashOf(doc)}`}):\n  ${unexpected.join('\n  ')}`);
  }
  if (stale.length) parts.push(`fixed, remove from KNOWN_GATE_FAILURES (test/known-gate-failures.mjs): ${stale.join('; ')}`);
  return parts.length ? parts.join('\n') : undefined;
}
