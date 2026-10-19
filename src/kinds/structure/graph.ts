import { theme } from '../../core/theme.js';
import type { LineStyle, Marker } from '../../engine/edges.js';
import type { BoxLine } from '../../engine/shapes.js';

/**
 * The structure graph: a kind-neutral description of a nested, port-aware
 * diagram, shared by the component, deployment and composite structure kinds.
 * Each kind maps its validated model to a graph; `layout.ts` positions it with
 * ELK and `draw.ts` writes the SVG, so the three kinds share one look and one
 * set of proven geometry rules.
 */

export type NodeShape = 'box' | 'node3d' | 'ellipse' | 'note';

export interface StructNode {
  /** Element ID (data-uml-id). */
  id: string;
  /** UML element type (data-uml-type), e.g. "component", "device", "part". */
  type: string;
  shape: NodeShape;
  /** Centered header lines: keywords, stereotypes, name. Unused for notes. */
  header: BoxLine[];
  /** Further compartments of a leaf (properties, operations), left-aligned lines. */
  compartments?: BoxLine[][];
  /** Icon in the top-right corner. */
  icon?: 'component' | 'artifact';
  /** Dashed outline (non-composite properties, collaborations). */
  dashed?: boolean;
  /** Note text (shape "note"). */
  noteText?: string;
  /** Nested nodes, drawn inside this one. An ellipse with children is laid out on its own first. */
  children?: StructNode[];
  ports?: StructPort[];
  /** Interfaces provided or required directly by this node (no port): lollipops and sockets on its border. */
  stubs?: StructStub[];
}

export interface StructPort {
  id: string;
  /** Drawn next to the port, outside its owner. */
  label?: string;
  /** Interfaces this port provides or requires that no assembly connects: lollipops and sockets. */
  stubs?: StructStub[];
}

export interface StructStub {
  /** ID of the symbol (data-uml-id), unique in the document. */
  id: string;
  kind: 'provided' | 'required';
  /** Interface name, drawn next to the ball or socket. */
  name: string;
}

export interface StructEdge {
  id: string;
  type: string;
  /** Node or port ID. */
  source: string;
  target: string;
  style: LineStyle;
  sourceMarker: Marker;
  targetMarker: Marker;
  /** Drawn «keyword» at the middle, above the name. */
  keyword?: string;
  name?: string;
  ends?: { end: 'source' | 'target'; text: string; kind: 'multiplicity' | 'role' }[];
}

/** An assembly connector drawn as a ball-and-socket joint between a requiring and a providing node or port. */
export interface StructAssembly {
  id: string;
  requirer: string;
  provider: string;
  /** Interface name, drawn next to the joint. */
  name: string;
}

export interface StructGraph {
  /** Kind name for the SVG root (data-uml-kind). */
  kind: string;
  frameKeyword: string;
  title?: string | undefined;
  nodes: StructNode[];
  edges: StructEdge[];
  assemblies: StructAssembly[];
  /** Notes' anchors: note ID to annotated node IDs. */
  anchors: { note: string; target: string }[];
  /**
   * Layout directions to try, the conventional one first (default: RIGHT only);
   * the most readable result wins (src/engine/aspect.ts). Left to right, provided
   * interfaces face left and required ones right; top to bottom, up and down.
   */
  directions?: ('RIGHT' | 'DOWN')[];
}

export const KEYWORD_STYLE = { size: theme.font.size.label };
export const NAME_STYLE = { size: theme.font.size.name, bold: true };
export const BODY_STYLE = { size: theme.font.size.body };

export const guillemets = (names: readonly string[]): string => `«${names.join(', ')}»`;

/** Header lines: «keyword» and «stereotypes» in muted label text above the (wrapped, bold) name. */
export function headerLines(options: { keyword?: string | undefined; stereotypes?: readonly string[] | undefined; name: string; bold?: boolean; italic?: boolean; underline?: boolean }): BoxLine[] {
  const lines: BoxLine[] = [];
  const muted = theme.color.mutedText;
  if (options.keyword) lines.push({ text: guillemets([options.keyword]), style: KEYWORD_STYLE, align: 'center', fill: muted });
  if (options.stereotypes?.length) lines.push({ text: guillemets(options.stereotypes), style: KEYWORD_STYLE, align: 'center', fill: muted });
  lines.push({
    text: options.name, style: { ...NAME_STYLE, bold: options.bold ?? true, italic: !!options.italic }, align: 'center',
    // Underlined names (instances) are not wrapped so the underline stays one line.
    ...(options.underline ? { underline: true } : { wrap: theme.size.maxNameWidth }),
  });
  return lines;
}
