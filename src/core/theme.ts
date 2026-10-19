/**
 * Visual tokens shared by both backends. The own engine reads them directly;
 * PlantUML kinds get skinparams generated from the same values
 * (see src/plantuml/skin.ts), so colors, strokes and sizes match across kinds.
 * Never hard-code a color, stroke width or font size in a kind: add a token here.
 */
export const theme = {
  font: {
    /** Family name of the pinned, embedded font (assets/fonts, SIL OFL 1.1). */
    family: 'Inter',
    /** CSS fallback chain for glyphs the pinned font lacks (CJK, emoji). */
    fallback: 'Inter, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", sans-serif',
    size: {
      /** Element names (class, component, ...). */
      name: 14,
      /** Compartment members, note text, frame heading. */
      body: 13,
      /** Edge labels, keywords and stereotypes in guillemets. */
      label: 12,
      /** Smallest permitted text anywhere; the QA gate enforces it. */
      min: 11,
    },
    /** Line height as a multiple of font size. */
    lineHeight: 1.4,
    weight: { regular: 400, bold: 700 },
  },
  color: {
    background: '#FFFFFF',
    text: '#0F172A',
    mutedText: '#334155',
    nodeFill: '#F8FAFC',
    nodeHeaderFill: '#EAF0F6',
    nodeStroke: '#334155',
    edge: '#334155',
    edgeText: '#1E293B',
    noteFill: '#FFF8DB',
    noteStroke: '#9A7B1C',
    frameStroke: '#475569',
    frameHeadingFill: '#F1F5F9',
    /** Halo painted behind edge labels so crossing lines never obscure them. */
    labelHalo: '#FFFFFF',
  },
  stroke: {
    node: 1.25,
    compartment: 1,
    edge: 1.25,
    frame: 1,
    note: 1,
    /** Dash pattern for dashed UML lines (dependency, realization, note anchors). */
    dash: '7 4',
  },
  spacing: {
    /** Empty margin around the whole drawing. */
    canvas: 16,
    /** Inner horizontal padding of compartments. */
    padX: 12,
    /** Inner vertical padding of compartments. */
    padY: 6,
    /** Vertical padding of a name compartment. */
    headerPadY: 8,
    /** Gap between nodes in the same layer. */
    nodeNode: 48,
    /** Gap between layers. */
    layer: 64,
    /** Gap between parallel edge segments. */
    edgeEdge: 14,
    /** Distance between an edge and its labels. */
    edgeLabel: 4,
    /** Bend radius of orthogonal edges. */
    bendRadius: 4,
    /** Diagram frame padding around the content. */
    frame: 14,
  },
  size: {
    minNodeWidth: 96,
    maxNameWidth: 260,
    maxNoteWidth: 220,
    /** Arrowhead dimensions (length along the line, half of the width across it). */
    triangle: { length: 14, halfWidth: 8 },
    arrow: { length: 11, halfWidth: 6 },
    diamond: { length: 18, halfWidth: 7 },
    cross: { offset: 12, half: 5 },
    circlePlus: { radius: 6.5 },
    noteFold: 10,
    /** Corner radius of activity actions (rounded rectangles). */
    actionRadius: 12,
    /** Rake symbol of call behavior actions (UML 16.3.4). */
    rake: { width: 12, height: 12 },
    packageTab: { minWidth: 48, height: 20 },
  },
} as const;

export type Theme = typeof theme;
