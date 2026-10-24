/**
 * A strict structural check of Mermaid text, written from Mermaid's documented
 * grammar and independent of the exporters: front matter, one header, every
 * statement in a known form for its diagram type, balanced blocks and quotes,
 * IDs from [A-Za-z0-9_], declared participants and nodes. There is no official
 * Mermaid parser without a dependency, so this is what the tests hold every
 * Mermaid export to. Returns the problems found (empty when the text is valid).
 */

const ID = '[A-Za-z0-9_]+';
const QUOTED = '"[^"]*"';
const DIRECTION = /^direction\s+(?:TB|TD|BT|LR|RL)$/u;

/** Problems with the quoted strings of a line: unbalanced quotes. */
function quoteProblems(text) {
  return (text.match(/"/gu)?.length ?? 0) % 2 ? ['unbalanced quotes'] : [];
}

export function checkMermaid(text) {
  const problems = [];
  const lines = text.split('\n');
  let i = 0;
  const report = (n, message) => {
    problems.push(`line ${n + 1}: ${message}`);
  };
  while (i < lines.length && !lines[i].trim()) i++;
  if (lines[i]?.trim() === '---') {
    const start = i++;
    let closed = false;
    for (; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '---') {
        closed = true;
        i++;
        break;
      }
      const m = /^title:\s*(.*)$/u.exec(t);
      if (!m) {
        report(i, `unexpected front matter ${JSON.stringify(t)}`);
        continue;
      }
      try {
        if (typeof JSON.parse(m[1]) !== 'string') throw new TypeError('not a string');
      } catch {
        report(i, 'the title must be a double-quoted string');
      }
    }
    if (!closed) report(start, 'front matter is not closed with ---');
  }
  while (i < lines.length && !lines[i].trim()) i++;
  const header = lines[i]?.trim();
  let check;
  switch (header) {
    case 'classDiagram': {
      check = classLine;
      break;
    }
    case 'sequenceDiagram': {
      check = sequenceLine;
      break;
    }
    case 'stateDiagram-v2': {
      check = stateLine;
      break;
    }
    default:
      if (/^flowchart\s+(?:TD|TB|LR|RL|BT)$/u.test(header ?? '')) check = flowchartLine;
      else {
        report(i, `expected a diagram header, got ${JSON.stringify(header)}`);
        return problems;
      }
  }
  const state = { stack: [], declared: new Set(), note: false };
  for (i++; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('%%')) continue;
    for (const p of [...quoteProblems(t), ...check(t, state)]) report(i, p);
  }
  for (const open of state.stack) problems.push(`line ${open.line + 1}: "${open.kind}" is not closed`);
  return problems;

  // Each checker returns the problems of one line; blocks are tracked on state.stack with their line.
  function open(state, kind) {
    state.stack.push({ kind, line: i });
  }
  function close(state, kinds) {
    const top = state.stack.at(-1);
    if (!top || !kinds.includes(top.kind)) return [`unmatched close of ${kinds.join('/')}`];
    state.stack.pop();
    return [];
  }

  function classLine(t, state) {
    if (state.stack.at(-1)?.kind === 'class') {
      if (t === '}') return close(state, ['class']);
      if (/^<<[^<>]+>>$/u.test(t)) return [];
      return /[{}]/u.test(t) && !/\{\s*\}$/u.test(t) ? [`member ${JSON.stringify(t)} contains a brace`] : [];
    }
    let m = new RegExp(String.raw`^class\s+(${ID})(?:\[${QUOTED}\])?(?:~[^~]+~)?\s*(\{)?$`, 'u').exec(t);
    if (m) {
      state.declared.add(m[1]);
      if (m[2]) open(state, 'class');
      return [];
    }
    if (DIRECTION.test(t)) return [];
    if (new RegExp(String.raw`^${ID}\s*:\s*.+$`, 'u').test(t) && !/(--|\.\.)/u.test(t.split(':', 1)[0])) return [];
    if (
      new RegExp(String.raw`^note\s+for\s+${ID}\s+${QUOTED}$`, 'u').test(t) ||
      new RegExp(String.raw`^note\s+${QUOTED}$`, 'u').test(t) ||
      new RegExp(String.raw`^<<[^<>]+>>\s+${ID}$`, 'u').test(t)
    )
      return [];
    const arrow = String.raw`(?:<\|--|--\|>|\*--|--\*|o--|--o|<-->|-->|<--|--|<\.\.|\.\.>|\.\.\|>|<\|\.\.|\.\.|\(\)--|--\(\))`;
    m = new RegExp(String.raw`^(${ID})\s*(?:${QUOTED}\s*)?${arrow}\s*(?:${QUOTED}\s*)?(${ID})(?:\s*:\s*(.*))?$`, 'u').exec(t);
    return m || /^classDef\b|^style\b|^cssClass\b/u.test(t) ? [] : [`not a classDiagram statement: ${JSON.stringify(t)}`];
  }

  // Entity codes (#59;, #quot;) end in ";" but do not split a statement.
  function rawSemicolon(s) {
    return s.replaceAll(/#(?:\d{1,7}|[A-Za-z]+);/gu, '').includes(';');
  }

  function sequenceLine(t, state) {
    const known = id => (state.declared.has(id) ? [] : [`participant "${id}" is used before it is declared`]);
    let m = new RegExp(String.raw`^(?:create\s+)?(?:participant|actor)\s+(${ID})(?:\s+as\s+(.+))?$`, 'u').exec(t);
    if (m) {
      state.declared.add(m[1]);
      return m[2] !== undefined && rawSemicolon(m[2]) ? ['raw ";" in a participant label'] : [];
    }
    m = new RegExp(String.raw`^(?:destroy|activate|deactivate)\s+(${ID})$`, 'u').exec(t);
    if (m) return known(m[1]);
    m = new RegExp(String.raw`^(${ID})\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?(${ID})\s*:(.*)$`, 'u').exec(t);
    if (m) return [...known(m[1]), ...known(m[3]), ...(rawSemicolon(m[4]) ? ['raw ";" in message text'] : [])];
    m = new RegExp(String.raw`^Note\s+(?:left of|right of|over)\s+(${ID})(?:\s*,\s*(${ID}))?\s*:(.*)$`, 'u').exec(t);
    if (m) return [...known(m[1]), ...(m[2] ? known(m[2]) : []), ...(rawSemicolon(m[3]) ? ['raw ";" in note text'] : [])];
    m = /^(loop|alt|opt|par|critical|break|rect|box)\b(.*)$/u.exec(t);
    if (m) {
      open(state, m[1]);
      return rawSemicolon(m[2]) ? ['raw ";" in a block label'] : [];
    }
    m = /^(else|and|option)\b(.*)$/u.exec(t);
    if (m) {
      const owner = { else: 'alt', and: 'par', option: 'critical' }[m[1]];
      return state.stack.at(-1)?.kind === owner ? [] : [`"${m[1]}" outside ${owner}`];
    }
    if (t === 'end') return close(state, ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect', 'box']);
    return t === 'autonumber' || /^title\s+\S/u.test(t) ? [] : [`not a sequenceDiagram statement: ${JSON.stringify(t)}`];
  }

  function stateLine(t, state) {
    if (state.note) {
      if (t === 'end note') state.note = false;
      return [];
    }
    const ref = String.raw`(?:${ID}|\[\*\])`;
    let m = new RegExp(String.raw`^state\s+(?:${QUOTED}\s+as\s+(${ID})|(${ID}))\s*(<<(?:choice|fork|join)>>)?\s*(\{)?$`, 'u').exec(t);
    if (m) {
      if (m[4]) open(state, 'state');
      return [];
    }
    if (t === '}') return close(state, ['state']);
    if (t === '--') return state.stack.length > 0 ? [] : ['"--" outside a composite state'];
    if (
      DIRECTION.test(t) ||
      /^classDef\b|^class\s/u.test(t) ||
      new RegExp(String.raw`^${ref}\s*-->\s*${ref}(?:\s*:\s*.*)?$`, 'u').test(t) ||
      new RegExp(String.raw`^note\s+(?:left|right)\s+of\s+${ID}\s*:\s*.+$`, 'u').test(t)
    )
      return [];
    if (new RegExp(String.raw`^note\s+(?:left|right)\s+of\s+${ID}$`, 'u').test(t)) {
      state.note = true;
      return [];
    }
    return new RegExp(String.raw`^${ID}\s*:\s*.+$`, 'u').test(t) ? [] : [`not a stateDiagram-v2 statement: ${JSON.stringify(t)}`];
  }

  function flowchartLine(t, state) {
    const KEYWORDS = new Set([
      'end',
      'graph',
      'subgraph',
      'flowchart',
      'style',
      'class',
      'classDef',
      'click',
      'linkStyle',
      'direction',
      'call',
      'href',
      'default',
    ]);
    const SHAPES = [
      String.raw`\[${QUOTED}\]`,
      String.raw`\(${QUOTED}\)`,
      String.raw`\(\[${QUOTED}\]\)`,
      String.raw`\(\(${QUOTED}\)\)`,
      String.raw`\(\(\(${QUOTED}\)\)\)`,
      String.raw`\{${QUOTED}\}`,
      String.raw`\{\{${QUOTED}\}\}`,
      String.raw`\[\[${QUOTED}\]\]`,
      String.raw`\[\(${QUOTED}\)\]`,
      String.raw`>${QUOTED}\]`,
      String.raw`\[/${QUOTED}/\]`,
      `\\[\\\\${QUOTED}\\\\\\]`,
      String.raw`\[/${QUOTED}\\\]`,
      `\\[\\\\${QUOTED}/\\]`,
      String.raw`@\{\s*shape:\s*[a-z-]+(?:\s*,\s*label:\s*${QUOTED})?\s*\}`,
    ];
    const NODE = `(${ID})(${SHAPES.join('|')})?`;
    const useNode = (id, shape) => {
      if (KEYWORDS.has(id)) return [`"${id}" is a Mermaid keyword and cannot be a node ID`];
      if (shape) {
        state.declared.add(id);
        return [];
      }
      return state.declared.has(id) ? [] : [`node "${id}" is used before it is declared`];
    };
    let m = new RegExp(String.raw`^subgraph\s+(${ID})(?:\s*\[${QUOTED}\])?$`, 'u').exec(t);
    if (m) {
      open(state, 'subgraph');
      return KEYWORDS.has(m[1]) ? [`"${m[1]}" is a keyword`] : [];
    }
    if (t === 'end') return close(state, ['subgraph']);
    if (DIRECTION.test(t) || /^(?:classDef|style|linkStyle)\s/u.test(t) || new RegExp(String.raw`^class\s+${ID}(?:,${ID})*\s+${ID}$`, 'u').test(t)) return [];
    m = new RegExp(`^${NODE}$`, 'u').exec(t);
    if (m) return m[2] ? useNode(m[1], m[2]) : [`a bare ID ${JSON.stringify(t)} declares nothing`];
    const ARROW = String.raw`(?:<-->|-->|---|-\.->|-\.-|==>|--o|--x)`;
    m = new RegExp(String.raw`^${NODE}\s*${ARROW}(?:\|${QUOTED}\||\|[^|"]*\|)?\s*${NODE}$`, 'u').exec(t);
    if (m) return [...useNode(m[1], m[2]), ...useNode(m[3], m[4])];
    m = new RegExp(String.raw`^${NODE}\s*--\s+[^-]+?\s+-->\s*${NODE}$`, 'u').exec(t);
    return m ? [...useNode(m[1], m[2]), ...useNode(m[3], m[4])] : [`not a flowchart statement: ${JSON.stringify(t)}`];
  }
}
