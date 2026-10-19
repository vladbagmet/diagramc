# Timing diagram: notation checklist

Backend: PlantUML 1.2025.10 (timing engine, styled through PlantUML's style
system from the theme tokens). Frame keyword: `sd`. Schema: `uml schema timing`.
Code: `src/kinds/timing/`. UML references are to UML 2.5.1 (formal/17-12-05),
clause 17.7.

Tests referenced below: `unit` = `test/timing.test.mjs` (no Java: generated
source, validation, QA reader on a stored render), `integration` =
`test/integration/timing.test.mjs` (real renders, every gate), `qa` = the
`message-endpoints` and `label-edge-crossing` gates, which run on every fixture
and example. Fixtures: `test/fixtures/timing/`.

## Supported constructs

| Construct | JSON | UML 2.5.1 notation | Proof |
|---|---|---|---|
| Lifeline | `lifelines[]`: `name`, `classifier` | Compartment per lifeline headed `name : Classifier`, stacked top to bottom (17.7.4) | unit: "UML notation: robust and concise..." (`robust "r : Lamp"`) |
| Robust (state) lifeline | `notation: "robust"`, `states`, `changes` | One row per state, listed at the left in declared order; a state line steps between rows at each change | integration: "robust states top to bottom in declared order" (row order and line height per state) |
| Concise (value) lifeline | `notation: "concise"` | The value written in a band between hexagonal transition marks | integration: values inside their bands; gate `text-fits` |
| State change | `changes[]`: `at`, `state` | Vertical step (robust) or transition mark (concise) at the time | integration: state line rows per time |
| Time axis with unit | `timeUnit` | Tick marks with round values and the unit `time (<unit>)` under the axis | integration: `time (ms)` drawn; unit: "time axis: about ten round ticks" |
| Message | `messages[]`: `from`, `fromTime`, `to`, `toTime`, `name`, `arguments` | Arrow from the sender's state line at the send time to the receiver's at the receive time, label `name(args)` beside it (17.7.4) | integration: "messages run between state lines"; qa `message-endpoints` |
| Duration constraint | `durationConstraints[]`: `lifeline`, `from`, `to`, `min`, `max` | Double-headed arrow between the two times labelled `{min..max}`, in its own band above the lifeline's states, with dotted extension lines down to the constrained changes (8.4.4, 17.7.4) | integration: `{0..60}` owned by a two-headed constraint arrow; unit: `<->` line |
| Time constraint | `timeConstraints[]`: `lifeline`, `at`, `from`, `to` | Allowed window for the state change at `at`: shaded and labelled `{from..to}` inside the constrained lifeline's row only (17.7.4) | integration: `{30..50}` drawn; validation `UNKNOWN_EVENT` |
| Highlighted interval | `highlights[]`: `from`, `to`, `label` | Shaded band across all lifelines (PlantUML extension, no UML semantics) | unit: `highlight 22 to 25 : idle`; gallery `stress` |
| Note | `notes[]` on concise lifelines | Rectangle with folded corner at the time (7.2.4) | unit: note block; gallery `door` |
| Diagram frame | `title` | Frame with pentagon heading `sd <title>` (Annex A: timing diagrams are interactions) | integration: frame labels `sd` (bold) and the title |

## Semantic rules

| Code | Rule | Negative fixture (path) |
|---|---|---|
| DUPLICATE_ID | IDs unique across lifelines and optional item IDs | `/lifelines/1/id`, `/messages/0/id` |
| LIFELINE_NAME_REQUIRED | a lifeline has a name, a classifier or both | `/lifelines/0` |
| DUPLICATE_STATE | states declared once per lifeline | `/lifelines/0/states/1` |
| UNKNOWN_STATE | every change uses a declared state of its lifeline | `/lifelines/0/changes/1/state` |
| TIME_NOT_INCREASING | change times strictly increase per lifeline | `/lifelines/0/changes/2/at`, `/lifelines/0/changes/1/at` |
| REDUNDANT_STATE_CHANGE | a change moves to a different state | `/lifelines/0/changes/1/state` |
| MISSING_REFERENCE | messages, constraints and notes name declared lifelines | `/messages/0/to`, `/durationConstraints/0/lifeline`, `/notes/0/lifeline` |
| TIME_BEFORE_FIRST_STATE | messages, constraints and notes refer to times when the lifeline has a state | `/messages/0/fromTime` |
| MESSAGE_BACKWARDS_IN_TIME | a message is not received before it is sent | `/messages/0/toTime` |
| ZERO_LENGTH_MESSAGE | a message to the same lifeline needs a later receive time | `/messages/0/toTime` |
| TIMELINE_TOO_DENSE | every concise value, note, highlight caption and duration arrow fits between its two times on an axis at most 3200 px wide (text is never drawn over other text); the message names the room needed and available | `/lifelines/0/changes/1/state` |
| INVALID_TIME_INTERVAL | constraints and highlights end after they start | `/durationConstraints/0/to`, `/timeConstraints/0/to`, `/highlights/0/to` |
| UNKNOWN_EVENT | a time constraint names a time at which its lifeline changes state | `/timeConstraints/0/at` |
| UNSUPPORTED_NOTE_TARGET | notes attach to concise lifelines (PlantUML drops notes on robust ones) | `/notes/0/lifeline` |
| LABEL_TOO_LONG | a drawn label fits 200 UTF-16 code units | `/messages/0`, `/lifelines/0/states/0` |
| SCHEMA_INVALID | missing `timeUnit`, negative or fractional times, unknown notation, empty `changes`, unknown properties | see `invalid.json` |
| INVALID_TEXT | blank text, bidi controls, unpaired surrogates | `/lifelines/0/states/0` |

## QA on PlantUML output

PlantUML's timing SVG has no groups. `readTiming` in
`src/qa/plantuml-interaction.ts` classifies primitives by the fixed styles the
generator sets: robust state lines (the only lines at stroke width 1.5), concise
value shapes (nodeHeaderFill), notes (noteFill), messages (line with one
arrowhead), duration constraints (line with two), band separators (full-width
lines). Evaluated gates: `safe-markup`, `inside-canvas`, `node-overlap`,
`label-overlap` (every caption, tick, state and message label against each other,
values and notes), `label-edge-crossing` (labels against state lines, messages,
constraints and band separators), `literal-text`, `min-font-size`, `text-fits`
(values inside their band, note text inside its note), `message-endpoints`
(both ends on a state line or value band, arrowhead at the receiving end).
Skipped: `label-proximity`, `edge-endpoints`, `markers`, `ports`.

## PlantUML deviations fixed by the generator or post-processing

- Default colors (green lines, red constraints, lavender bands) are replaced by theme tokens through a `<style>` block.
- `scale` is chosen so ticks fall on round values (1, 2 or 5 x 10^k, about ten per axis) and the axis is as wide as what must fit between two times needs (`src/kinds/timing/scale.ts`: concise values with their hexagon ends, consecutive notes, highlight captions, duration arrows, a minimum step between changes), from 480 to 3200 px. Text widths come from Inter's advance table, so validation decides without loading fonts. Large time values no longer stretch the axis.
- Robust state lines stop at the last state change; each robust lifeline restates its final state at the last time used anywhere, so later messages and constraints end on a line.
- Rows get vertical room (`src/kinds/timing/rows.ts`): at least 8 px between a name tab and its first state label, 26 px between robust state levels, and a 26 px band per duration constraint and per lifeline with time constraints, opened by moving everything below (arrowheads move as a whole).
- Duration constraints are redrawn in their band with dotted extension lines; time-constraint windows and labels are confined to their lifeline's row.
- Robust state labels share the column of the lifeline names, with at least 10 px to the time axis; the last concise value is centered in its open band; the time axis reaches the end of the state lines; time grid lines stop at name tabs.
- PlantUML's inner box (a second border inside the frame) is dropped: rows are separated by full-width lines.
- A message label is written at the arrow tip, over the receiver; it is moved beside the arrow, to the right and away from the direction the line runs, at the first candidate position that crosses no line, text, value or note.
- The time unit is a footer, which PlantUML's frame does not enclose; the frame and canvas are extended around it.
- The `mainframe` heading is closed and filled like the own engine's frames.

## Unsupported (rejected by the schema)

- Clock and binary lifelines, analog signals: PlantUML extensions, not UML.
- Time observations (`t = now`) and constraints relative to observations: no PlantUML notation; use time constraints with absolute times.
- Notes on robust lifelines: PlantUML 1.2025.10 does not draw them (UNSUPPORTED_NOTE_TARGET).
- Non-integer times.

## Known limitations

- Timelines too dense for 3200 px are rejected (TIMELINE_TOO_DENSE) rather than drawn; split them into shorter time windows.
- Message label placement is a fixed candidate search; with many crossing messages a label may still land on a line, which the gates then report.
