import { kindSchema } from '../../model/schema.js';

export const MAX_TIME = 1_000_000;
const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const time = (description: string) => ({ type: 'integer', minimum: 0, maximum: MAX_TIME, description });

/** JSON Schema of a timing diagram document (`uml schema timing`). */
export const timingSchema = kindSchema({
  kind: 'timing',
  title: 'UML timing diagram',
  description: 'Lifelines whose state or value changes over a horizontal time axis (robust and concise notation), with messages between them at given times, duration and time constraints, highlighted intervals and notes. Drawn inside a frame headed `sd <title>`. All times are integers in `timeUnit`.',
  required: ['timeUnit', 'lifelines'],
  properties: {
    timeUnit: ref('keyword', 'Unit of every time value, shown with the time axis, e.g. "ms", "s", "cycles".'),
    lifelines: { type: 'array', minItems: 1, maxItems: 20, items: ref('lifeline'), description: 'Lifelines, drawn top to bottom in this order.' },
    messages: { type: 'array', maxItems: 100, items: ref('message') },
    durationConstraints: { type: 'array', maxItems: 40, items: ref('durationConstraint') },
    timeConstraints: { type: 'array', maxItems: 20, items: ref('timeConstraint') },
    highlights: { type: 'array', maxItems: 20, items: ref('highlight') },
    notes: { type: 'array', maxItems: 40, items: ref('note') },
  },
  definitions: {
    lifeline: {
      type: 'object', additionalProperties: false, required: ['id', 'notation', 'states', 'changes'],
      description: 'A lifeline headed `name : classifier`. At least one of `name` and `classifier` is required.',
      properties: {
        id: ref('id'),
        name: ref('name'),
        classifier: ref('name', 'Type of the represented element, drawn after a colon.'),
        notation: { enum: ['robust', 'concise'], description: 'robust: state rows with a stepped state line; concise: the value written in bands between hexagonal transitions.' },
        states: { type: 'array', minItems: 1, maxItems: 20, items: ref('text'), description: 'Declared states or values. Robust lifelines draw them top to bottom in this order.' },
        changes: { type: 'array', minItems: 1, maxItems: 200, items: ref('change'), description: 'State changes in strictly increasing time order. The first one gives the initial state.' },
      },
    },
    change: {
      type: 'object', additionalProperties: false, required: ['at', 'state'],
      properties: { at: time('Time of the change.'), state: ref('text', 'One of the lifeline\'s states.') },
    },
    message: {
      type: 'object', additionalProperties: false, required: ['from', 'fromTime', 'to', 'toTime', 'name'],
      description: 'A message sent by `from` at `fromTime` and received by `to` at `toTime` (not earlier). Drawn as an arrow between the two state lines.',
      properties: {
        id: ref('id'), from: ref('id'), fromTime: time('Send time.'), to: ref('id'), toTime: time('Receive time.'),
        name: ref('text'), arguments: { type: 'array', maxItems: 12, items: ref('text'), description: 'Drawn `name(a, b)`.' },
      },
    },
    durationConstraint: {
      type: 'object', additionalProperties: false, required: ['lifeline', 'from', 'to', 'min', 'max'],
      description: 'Duration constraint: a double-headed arrow on `lifeline` from `from` to `to` labelled {min..max}.',
      properties: {
        id: ref('id'), lifeline: ref('id'), from: time('Start of the constrained duration.'), to: time('End of the constrained duration.'),
        min: ref('keyword', 'Lower bound, e.g. "10" or "d".'), max: ref('keyword', 'Upper bound, e.g. "30" or "3*d".'),
      },
    },
    timeConstraint: {
      type: 'object', additionalProperties: false, required: ['lifeline', 'at', 'from', 'to'],
      description: 'Time constraint on the state change of `lifeline` at `at`: it must occur within [from, to]. Drawn as a highlighted window labelled {from..to}.',
      properties: { id: ref('id'), lifeline: ref('id'), at: time('Time of the constrained state change.'), from: time('Window start.'), to: time('Window end.') },
    },
    highlight: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      description: 'A shaded time interval across all lifelines, with an optional label.',
      properties: { id: ref('id'), from: time('Start.'), to: time('End.'), label: ref('text') },
    },
    note: {
      type: 'object', additionalProperties: false, required: ['lifeline', 'at', 'text'],
      description: 'A note on a concise lifeline at time `at`, above (default) or below its band.',
      properties: { id: ref('id'), lifeline: ref('id'), at: time('Time the note points at.'), position: { enum: ['top', 'bottom'] }, text: ref('longText') },
    },
  },
});
