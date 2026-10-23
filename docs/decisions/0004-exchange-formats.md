# 0004: Exchange formats: PlantUML and Mermaid, not XMI

Status: accepted. Date: 2026-10-23.

## Context

The JSON model is the tool's source format: agents write it, `uml validate`
checks it, `uml render` draws it. People and agents also hold diagrams in other
text formats, and want to put diagrams where those formats render. An export
and import path was needed, and the question was which formats to support.

## Decision

The JSON model stays the source format. Two text formats are added, through
`uml export` and `uml import` (`src/formats/<format>/<kind>.ts`, one mapping
file per kind, mapping tables in [docs/formats.md](../formats.md)):

- **PlantUML.** The most widely used text notation for UML. Every one of the
  14 kinds has a PlantUML syntax, so export covers all of them; the repository
  already generated PlantUML for sequence, timing, activity and class.
  Import covers class, sequence, state machine, use case and activity, the
  kinds people most often write by hand.
- **Mermaid.** Rendered natively by GitHub, GitLab, Notion, Obsidian and most
  wikis, so it is the format a README or an issue wants. Export covers the
  kinds Mermaid can draw faithfully (class, sequence, state machine, and
  activity and use case as flowcharts); the other kinds fail with
  `UNSUPPORTED_EXPORT` naming the formats that work. Import covers class,
  sequence and state machine, the Mermaid diagram types that are UML.

Both directions are honest about what does not fit: an export reports every
construct the format cannot express as an `EXPORT_LOSSY` warning with its JSON
Pointer, and an import reads only the part of the syntax that maps onto the
model, reports every other line with its line number, and never guesses. The
imported model is validated like any other.

## Not chosen: XMI

XMI is the official OMG interchange standard for UML models, and the obvious
candidate on paper. It was not chosen:

- Every tool writes a different dialect (different XMI and UML versions,
  vendor extensions, diagram interchange present or not), so "XMI support"
  means supporting a handful of tools one by one, and files from the others
  still do not load.
- Files are large and verbose (several kilobytes for a diagram that is a few
  lines of PlantUML), with generated IDs everywhere.
- No agent or developer writes XMI by hand or reads it in a review, and no
  wiki or code host renders it. It would not serve the people this tool is for.

If a modelling tool integration is needed later, XMI can be added as a third
format behind the same `uml export`/`uml import` commands and registry, for
the dialect of that tool.

## Consequences

- Round trips JSON -> text -> JSON over every example are tested for every
  import kind and format; the differences are exactly the documented losses.
- Two examples cannot round trip to a valid model (`state-machine/notation.json`
  through either format), because neither format can draw a transition into a
  second orthogonal region (PlantUML) or across a composite state's border
  (Mermaid); the export reports the transition and the import reports the
  invalid model instead of producing a different one.
- Exported PlantUML is checked by the pinned PlantUML in the integration
  tests; exported Mermaid by a structural check of the Mermaid grammar
  (`test/mermaid-check.mjs`), since running Mermaid would need a browser and a
  new dependency.
