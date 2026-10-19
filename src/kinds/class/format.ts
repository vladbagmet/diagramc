import { isLegacy, type Attribute, type ClassifierType, type LegacyMember, type Operation, type Visibility } from './model.js';

/** UML 2.5.1 textual notation of members (clauses 9.5.4 and 9.6.4), shared by both backends. */

export const VISIBILITY: Record<Visibility, string> = { public: '+', private: '-', protected: '#', package: '~' };

/** Keyword shown in guillemets above the name, per classifier type. */
export function classifierKeyword(type: ClassifierType): string | undefined {
  switch (type) {
    case 'interface': return 'interface';
    case 'enumeration': return 'enumeration';
    case 'datatype': return 'dataType';
    case 'primitive': return 'primitive';
    default: return undefined;
  }
}

export const guillemets = (names: readonly string[]): string => `«${names.join(', ')}»`;

/** `+ /name : Type [0..1] = default {readOnly}` */
export function formatAttribute(member: Attribute | LegacyMember): string {
  if (isLegacy(member)) return member.text;
  let text = member.visibility ? `${VISIBILITY[member.visibility]} ` : '';
  text += `${member.derived ? '/' : ''}${member.name}`;
  if (member.type !== undefined) text += ` : ${member.type}`;
  if (member.multiplicity !== undefined) text += ` [${member.multiplicity}]`;
  if (member.default !== undefined) text += ` = ${member.default}`;
  if (member.readOnly) text += ' {readOnly}';
  return text;
}

/** `+ name(in p : T [m] = d, out q : U) : R {query}` ("in" is implied and omitted). */
export function formatOperation(member: Operation | LegacyMember): string {
  if (isLegacy(member)) return member.text;
  const parameters = (member.parameters ?? []).map(p => {
    let text = p.direction && p.direction !== 'in' ? `${p.direction} ` : '';
    text += p.name;
    if (p.type !== undefined) text += ` : ${p.type}`;
    if (p.multiplicity !== undefined) text += ` [${p.multiplicity}]`;
    if (p.default !== undefined) text += ` = ${p.default}`;
    return text;
  });
  let text = member.visibility ? `${VISIBILITY[member.visibility]} ` : '';
  text += `${member.name}(${parameters.join(', ')})`;
  if (member.returnType !== undefined) text += ` : ${member.returnType}`;
  if (member.query) text += ' {query}';
  return text;
}

export const isStatic = (member: Attribute | Operation | LegacyMember): boolean => !isLegacy(member) && !!member.static;
export const isAbstractOperation = (member: Operation | LegacyMember): boolean => !isLegacy(member) && !!member.abstract;
