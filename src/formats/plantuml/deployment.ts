import type { DeploymentDiagram, Element, End } from '../../kinds/deployment/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted, stereotypeText } from './text.js';

/**
 * Deployment diagram -> PlantUML deployment diagram (export only). Nodes,
 * devices (<<device>>) and execution environments (<<executionEnvironment>>)
 * are `node` blocks holding what is deployed on them; a deployment
 * specification is an artifact marked <<deployment spec>> that lists its
 * properties under its name. Communication paths keep their multiplicities,
 * name and <<protocol>>.
 */

const NODE_KEYWORD = { node: [], device: ['device'], executionEnvironment: ['executionEnvironment'] } as const;

const endLabel = (end: End | undefined): string => (end?.multiplicity === undefined ? '' : ` "${end.multiplicity}"`);
const keyword = (k: string): string => `<<${encode(k, '<>,')}>>`;

export function exportDeployment(model: DeploymentDiagram, _losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  const emit = (e: Element, indent: string): void => {
    const alias = ids.get(e.id);
    switch (e.type) {
      case 'note':
        lines.push(`${indent}note ${quoted(e.text)} as ${alias}`);
        return;
      case 'artifact':
        lines.push(`${indent}artifact ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}`);
        return;
      case 'component':
        lines.push(`${indent}component ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}`);
        return;
      case 'deploymentSpecification': {
        // `\n` (written by the exporter, never taken from model text) starts a new line of the name.
        const rows = [
          e.name,
          ...(e.properties ?? []).map(p => `${p.name}${p.type === undefined ? '' : ` : ${p.type}`}${p.value === undefined ? '' : ` = ${p.value}`}`),
        ];
        lines.push(`${indent}artifact "${rows.map(r => encode(r, '"')).join(String.raw`\n`)}" as ${alias} <<deployment spec>>`);
        return;
      }
      default: {
        const head = `${indent}node ${quoted(e.name)} as ${alias}${stereotypeText([...NODE_KEYWORD[e.type], ...(e.stereotypes ?? [])])}`;
        if (!e.elements?.length) {
          lines.push(head);
          return;
        }
        lines.push(`${head} {`);
        for (const n of e.elements) emit(n, `${indent}  `);
        lines.push(`${indent}}`);
      }
    }
  };
  for (const e of model.elements) emit(e, '');
  for (const r of model.relationships ?? []) {
    const from = ids.get(r.from),
      to = ids.get(r.to);
    switch (r.type) {
      case 'communicationPath': {
        const rows = [...(r.name === undefined ? [] : [encode(r.name, '<>«»')]), ...(r.protocol === undefined ? [] : [keyword(r.protocol)])];
        lines.push(`${from}${endLabel(r.fromEnd)} --${endLabel(r.toEnd)} ${to}${rows.length > 0 ? ` : ${rows.join(String.raw`\n`)}` : ''}`);
        break;
      }
      case 'deploy':
        lines.push(`${from} ..> ${to} : ${keyword('deploy')}`);
        break;
      case 'manifest':
        lines.push(`${from} ..> ${to} : ${keyword('manifest')}`);
        break;
      case 'dependency': {
        const label = [r.keyword === undefined ? undefined : keyword(r.keyword), r.name === undefined ? undefined : encode(r.name, '<>«»')]
          .filter(t => t !== undefined)
          .join(' ');
        lines.push(`${from} ..> ${to}${label ? ` : ${label}` : ''}`);
      }
    }
  }
  for (const e of model.elements) if (e.type === 'note') for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  return document(model.title, lines);
}

export const plantumlDeployment: KindFormat<DeploymentDiagram> = { kind: 'deployment', export: exportDeployment };
