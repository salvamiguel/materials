// Colours for AWS CLI output in the terminal: JSON, tables, s3 transfer
// lines, errors and help text.

import type { OutLine, OutToken } from '../shared/Terminal';

const TRANSFER = /^(\(dryrun\) )?(upload|download|copy|move|delete|make_bucket|remove_bucket):/;
const FAILED = /^(upload|download|copy|move|delete|make_bucket|remove_bucket) failed:/;

function jsonLine(line: string): OutToken[] | undefined {
  const m = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)(.*)$/.exec(line);
  if (m) return [{ text: m[1] }, { text: m[2], cls: 'key' }, { text: m[3] }, ...jsonValue(m[4])];
  const v = /^(\s+)(.*)$/.exec(line);
  if (v && /^("|-?\d|true|false|null)/.test(v[2])) return [{ text: v[1] }, ...jsonValue(v[2])];
  return undefined;
}

function jsonValue(rest: string): OutToken[] {
  const m = /^("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)(.*)$/.exec(rest);
  if (!m) return [{ text: rest }];
  return [{ text: m[1], cls: m[1].startsWith('"') ? 'str' : 'num' }, { text: m[2] }];
}

function tableLine(line: string): OutToken[] {
  const out: OutToken[] = [];
  let buf = '';
  let border = false;
  const flush = () => {
    if (buf) out.push(border ? { text: buf, cls: 'dim' } : { text: buf });
    buf = '';
  };
  for (const c of line) {
    const isBorder = c === '|' || c === '+' || (c === '-' && /^[-+|\s]*$/.test(line));
    if (isBorder !== border) {
      flush();
      border = isBorder;
    }
    buf += c;
  }
  flush();
  return out;
}

export function colorizeAws(text: string): OutLine[] {
  if (!text) return [];
  const lines = text.replace(/\n$/, '').split('\n');
  const isTable = lines.some((l) => /^-{10,}$/.test(l)) && lines.some((l) => /^\|.*\|$/.test(l));
  return lines.map((line): OutLine => {
    if (!line) return { tokens: [] };
    if (/^An error occurred \(/.test(line) || /^aws: error:/.test(line) || /^(fatal error|Error parsing|Parameter validation failed|Unknown options|Unable to locate|You must specify|Could not connect|The config profile|Waiter .* failed|bash: |[a-z]+: cannot)/.test(line)) {
      return { tokens: [{ text: line, cls: 'err' }] };
    }
    if (FAILED.test(line)) {
      const i = line.indexOf(' An error occurred');
      return { tokens: i > 0 ? [{ text: line.slice(0, i), cls: 'err bold' }, { text: line.slice(i), cls: 'err' }] : [{ text: line, cls: 'err' }] };
    }
    const t = TRANSFER.exec(line);
    if (t) {
      const cls = t[2] === 'delete' || t[2] === 'remove_bucket' ? 'del' : 'add';
      return { tokens: [{ text: t[0], cls: `${cls} bold` }, { text: line.slice(t[0].length) }] };
    }
    if (/^usage: aws|^To see help text|^\s+aws (help|<command>)/.test(line)) return { tokens: [{ text: line, cls: 'dim' }] };
    if (/^(NOMBRE|DESCRIPCIÓN|SINOPSIS|OPCIONES|EJEMPLO|Servicios:|Operaciones:|Opciones globales:|Uso:)/.test(line)) {
      return { tokens: [{ text: line, cls: 'bold' }] };
    }
    if (/^\s{27}PRE /.test(line)) return { tokens: [{ text: line.slice(0, 31), cls: 'dim' }, { text: line.slice(31), cls: 'read' }] };
    const ls = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)( .*)$/.exec(line);
    if (ls) return { tokens: [{ text: ls[1], cls: 'dim' }, { text: ls[2] }] };
    if (isTable && /^[-+|]/.test(line)) return { tokens: tableLine(line), nowrap: true };
    const j = jsonLine(line);
    if (j) return { tokens: j };
    const y = /^(\s*(?:- )?)([\w.-]+)(:)( .*)?$/.exec(line);
    if (y && !/^\s*(https?|s3)$/.test(y[2])) {
      return { tokens: [{ text: y[1] }, { text: y[2], cls: 'key' }, { text: y[3] }, ...(y[4] ? [{ text: y[4], cls: /^ '?-?\d/.test(y[4]) ? 'num' : 'str' }] : [])] };
    }
    return { tokens: [{ text: line }] };
  });
}
