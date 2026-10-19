import { theme } from '../core/theme.js';

/**
 * PlantUML skinparams generated from the shared theme tokens, so PlantUML kinds
 * use the same font, colors, stroke widths and sizes as own-engine kinds.
 */

const SHAPES = [
  'class', 'object', 'package', 'component', 'interface', 'node', 'artifact', 'database', 'usecase', 'actor',
  'participant', 'state', 'activity', 'rectangle', 'frame', 'card', 'folder', 'file', 'collections',
  'boundary', 'control', 'entity', 'queue', 'agent', 'stack', 'storage', 'cloud', 'partition',
];

export function skinParams(): string[] {
  const { color, font, stroke } = theme;
  const lines = [
    `skinparam backgroundColor ${color.background}`,
    `skinparam defaultFontName ${font.family}`,
    `skinparam defaultFontSize ${font.size.body}`,
    `skinparam defaultFontColor ${color.text}`,
    'skinparam shadowing false',
    'skinparam roundcorner 0',
    'skinparam padding 4',
    'skinparam classAttributeIconSize 0',
    `skinparam arrowColor ${color.edge}`,
    `skinparam arrowThickness ${stroke.edge}`,
    `skinparam arrowFontSize ${font.size.label}`,
    `skinparam arrowFontColor ${color.edgeText}`,
    `skinparam noteBackgroundColor ${color.noteFill}`,
    `skinparam noteBorderColor ${color.noteStroke}`,
    `skinparam noteBorderThickness ${stroke.note}`,
    `skinparam noteFontSize ${font.size.body}`,
    `skinparam stereotypeFontSize ${font.size.label}`,
    `skinparam stereotypeFontColor ${color.mutedText}`,
    `skinparam titleFontSize ${font.size.name}`,
    `skinparam sequenceLifeLineBorderColor ${color.edge}`,
    `skinparam sequenceGroupBorderColor ${color.frameStroke}`,
    `skinparam sequenceGroupHeaderFontSize ${font.size.label}`,
  ];
  for (const shape of SHAPES) {
    lines.push(
      `skinparam ${shape}BackgroundColor ${color.nodeFill}`,
      `skinparam ${shape}BorderColor ${color.nodeStroke}`,
      `skinparam ${shape}BorderThickness ${stroke.node}`,
      `skinparam ${shape}FontColor ${color.text}`,
      `skinparam ${shape}FontSize ${font.size.name}`,
    );
  }
  lines.push(
    `skinparam classHeaderBackgroundColor ${color.nodeHeaderFill}`,
    `skinparam classAttributeFontSize ${font.size.body}`,
    `skinparam classAttributeFontColor ${color.text}`,
    'skinparam classFontStyle bold',
  );
  return lines;
}

/**
 * A complete PlantUML source: @startuml, the Smetana pragma when a graph layout is
 * needed (no Graphviz is ever used), the theme skinparams, the kind's body lines.
 */
export function plantUmlDocument(body: readonly string[], options: { layout?: 'smetana' } = {}): string {
  return ['@startuml', ...(options.layout === 'smetana' ? ['!pragma layout smetana'] : []), ...skinParams(), ...body, '@enduml', ''].join('\n');
}
