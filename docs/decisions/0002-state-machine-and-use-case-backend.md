# 0002: State machine and use case diagrams on the own engine

Status: accepted. Date: 2026-10-19.

## Context

The original plan for the 14 kinds assigned state machine and
use case diagrams to PlantUML, with one rule: if they fail the quality gates on
realistic fixtures, they move to the own engine. Both go through PlantUML's Smetana
graph layout (no Graphviz is allowed), which the MVP review already found weak
(clipped self-loops, labels on nodes). Activity diagrams use PlantUML's dedicated
activity engine instead and are not part of this decision.

## Evidence

Probes were rendered with the pinned PlantUML 1.2025.10, the project's skinparams
and the SECURE runner, then checked with the QA gates and looked at.

**State machine** (a composite state with two orthogonal regions, behaviors, a
choice, history, self-transition):

```
state "Active" as s1 {
  [*] --> s2
  state "Loading" as s2 : entry / start timer\ndo / fetch\nexit / stop timer
  ...
  --
  [*] --> s4
  state "Online" as s4
  state "Offline" as s5
  ...
}
```

- Smetana silently dropped the second orthogonal region: "Online" and "Offline" do
  not appear in the SVG at all (0 occurrences). A diagram that loses model content
  without an error is disqualifying on its own; the literal-text gate fails as soon
  as the expected texts are passed.
- The QA reader finds 1 node and 0 edges in the state SVG: nested states are not
  emitted as `g.entity` groups the gates can read, so the edge-endpoints, markers,
  label-edge-crossing and label-proximity gates can only be reported as skipped.
- Visual review: transitions are curves that end short of the target, the initial
  transition of a region starts outside the composite, a label sits on a curve, and
  the shared theme's square corners (needed for classes) also square the states
  unless kind-specific styles are added.

**Use case** (15 use cases in a subject, 3 actors, 8 «include»/«extend»):

- Gates: text-fits fails 3 times (actor names wider than the stick figure entity),
  and the 4 edge gates are skipped (links carry no exact geometry).
- Visual review: association lines stop short of the ellipses and actors, a line
  runs across the subject's title area and loops around the boundary, the secondary
  actor is placed under the boundary with its line not reaching the figure.

## Decision

State machine and use case diagrams are drawn by the own engine (elkjs layered
layout and the shared SVG writer), like class diagrams. Activity diagrams stay on
PlantUML's activity engine, whose output passes every gate once read by
`src/qa/plantuml-activity.ts` and fixed up by the activity post-processor.

What the own engine needed, all generic and tested in `test/engine.test.mjs`:

- `src/engine/clip.ts`: route ends moved onto ellipse and diamond outlines; the
  edge-endpoints gate reads `data-uml-shape` (ellipse, diamond).
- `src/engine/elk.ts`: polyline routing (use cases), `labelBelow` (actor names),
  `fixedSize` (pseudostates do not grow with their ports), the elkjs workaround
  for compound minimum sizes in vertical layouts, root option overrides
  (depth-first cycle breaking for state machines).
- `src/engine/labels.ts`: label candidates beside slanted segments.
- `src/engine/geometry.ts`: `straightenJogs` for small route jogs.
- QA: nodes on their owner's border (entry/exit points), note anchors ending on a
  relationship (extend conditions), and lines must not cross the name or behaviors
  of a composite state or subject.

## Consequences

- Both kinds pass every gate on minimal, realistic, notation and stress examples
  and on all fixtures, render in well under the 2 s engine budget, need no Java and
  are byte-identical across runs.
- No PlantUML backend is offered for these kinds (`diagramc kinds` lists only `engine`).
- Layout quality depends on ELK: orthogonal regions are stacked vertically, and
  transitions into nested states may detour around a composite's header.
