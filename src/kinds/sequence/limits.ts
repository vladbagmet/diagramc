/** Size limits of sequence diagrams, chosen so the largest document renders well within the 5 s budget. */
export const MAX_LIFELINES = 30;
/** Items per list (top level or operand). The total over all nesting levels is limited by MAX_TOTAL_ITEMS. */
export const MAX_ITEMS = 300;
export const MAX_TOTAL_ITEMS = 400;
export const MAX_FRAGMENT_DEPTH = 8;
/**
 * Longest formatted message or interaction-use label, in UTF-16 code units. PlantUML
 * rejects source lines above about 2 KB and every code unit is encoded as an
 * 8-character token, so longer labels could not be drawn.
 */
export const MAX_LABEL_UNITS = 200;
