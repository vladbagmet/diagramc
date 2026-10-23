/**
 * Minimal XML reader for SVG produced by this project and by PlantUML. It is a QA
 * tool, not a general XML parser: no DTDs, no namespaces resolution.
 */
export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

export function decodeXml(text: string): string {
  return text.replaceAll(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/gu, (_, entity: string) => {
    if (entity.startsWith('#')) return String.fromCodePoint(entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[entity]!;
  });
}

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { tag: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const top = stack.at(-1)!;
    if (lt === -1) { pushText(top, source.slice(i)); break; }
    if (lt > i) pushText(top, source.slice(i, lt));
    if (source.startsWith('<!--', lt)) { i = end(source, '-->', lt) ; continue; }
    if (source.startsWith('<![CDATA[', lt)) {
      const close = source.indexOf(']]>', lt);
      if (close === -1) throw new Error('Unterminated CDATA');
      top.children.push(source.slice(lt + 9, close));
      i = close + 3;
      continue;
    }
    if (source.startsWith('<?', lt)) { i = end(source, '?>', lt); continue; }
    if (source.startsWith('<!', lt)) { i = end(source, '>', lt); continue; }
    if (source.startsWith('</', lt)) {
      const close = source.indexOf('>', lt);
      const tag = source.slice(lt + 2, close).trim();
      const open = stack.pop();
      if (open?.tag !== tag) throw new Error(`Mismatched </${tag}>`);
      i = close + 1;
      continue;
    }
    const match = /^<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/u.exec(source.slice(lt));
    if (!match) throw new Error(`Malformed tag at ${lt}`);
    const element: XmlElement = { tag: match[1]!, attrs: {}, children: [] };
    for (const [, name, double, single] of match[2]!.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
      element.attrs[name!] = decodeXml(double ?? single ?? '');
    }
    top.children.push(element);
    if (!match[3]) stack.push(element);
    i = lt + match[0].length;
  }
  if (stack.length !== 1) throw new Error(`Unclosed <${stack.at(-1)!.tag}>`);
  return root;
}

function pushText(parent: XmlElement, raw: string): void {
  if (raw) parent.children.push(decodeXml(raw));
}

function end(source: string, terminator: string, from: number): number {
  const at = source.indexOf(terminator, from);
  if (at === -1) throw new Error(`Unterminated ${terminator}`);
  return at + terminator.length;
}

export function* walk(element: XmlElement, ancestors: XmlElement[] = []): Generator<{ element: XmlElement; ancestors: XmlElement[] }> {
  yield { element, ancestors };
  for (const child of element.children) if (typeof child !== 'string') yield* walk(child, [...ancestors, element]);
}

export function textContent(element: XmlElement): string {
  return element.children.map(c => typeof c === 'string' ? c : textContent(c)).join('');
}
