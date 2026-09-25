// A tolerant HCL scanner for autocompletion. The code being edited is
// usually incomplete, so instead of parsing it this walks the text once,
// tracking the open blocks, attributes, brackets and strings. It returns an
// outline of the blocks (to know what a configuration declares) and a
// snapshot of what was open at the cursor (to know what to suggest there).

export interface AttrNode {
  name: string;
  nameStart: number;
  /** Raw expression: src.slice(valueStart, valueEnd). */
  valueStart: number;
  valueEnd: number;
}

export interface BlockNode {
  /** Block type ("resource", "lifecycle"...); "" for the file itself. */
  type: string;
  labels: string[];
  start: number;
  end: number;
  attrs: AttrNode[];
  blocks: BlockNode[];
}

/** A token on the current line of a body: the header of a block being typed. */
export interface LineToken {
  kind: 'ident' | 'string' | 'other';
  text: string;
  start: number;
  end: number;
}

export type Frame =
  | { t: 'body'; node: BlockNode; line: LineToken[] }
  | { t: 'attr'; node: AttrNode; body: BlockNode }
  /** Object constructor: `key = value` pairs. */
  | { t: 'brace'; start: number; afterEq: boolean; key?: string }
  | { t: 'brack'; start: number }
  | { t: 'paren'; start: number; fn?: string }
  /** Quoted string; `label` when it is a block label (index among the labels). */
  | { t: 'string'; start: number; label?: { type: string; index: number } }
  | { t: 'heredoc'; start: number; marker: string }
  /** ${ … } or %{ … } inside a string or heredoc. */
  | { t: 'interp'; start: number };

export interface Scan {
  root: BlockNode;
  /** The frames open at the cursor, outermost first (only when a cursor was given). */
  at?: Frame[];
  /** The cursor is inside a comment. */
  inComment?: boolean;
}

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string) => /[A-Za-z0-9_-]/.test(c);

export function scan(src: string, cursor?: number): Scan {
  const root: BlockNode = { type: '', labels: [], start: 0, end: src.length, attrs: [], blocks: [] };
  const stack: Frame[] = [{ t: 'body', node: root, line: [] }];
  const n = src.length;
  let i = 0;
  let at: Frame[] | undefined;
  let inComment = false;
  // Identifier just read in an expression: names the function of a following "(".
  let lastIdent: { text: string; end: number } | undefined;

  const top = () => stack[stack.length - 1];
  const snapshot = () => {
    at = stack.map((f) => (f.t === 'body' ? { ...f, line: [...f.line] } : { ...f }));
  };
  const endAttr = (f: Extract<Frame, { t: 'attr' }>) => {
    f.node.valueEnd = i;
    stack.pop();
  };

  while (i < n) {
    if (cursor !== undefined && !at && i >= cursor) snapshot();
    const f = top();
    const c = src[i];

    if (f.t === 'string') {
      if (c === '\\') {
        i += 2;
      } else if ((c === '$' || c === '%') && src[i + 1] === '{') {
        if (src[i - 1] === c) {
          i += 2; // $${ and %%{ are escapes
        } else {
          stack.push({ t: 'interp', start: i });
          i += 2;
        }
      } else if (c === '"' || c === '\n') {
        // A newline ends an unterminated string (tolerance); the outer frame handles it.
        stack.pop();
        const body = top();
        if (f.label && body.t === 'body') {
          body.line.push({ kind: 'string', text: src.slice(f.start + 1, i), start: f.start, end: c === '"' ? i + 1 : i });
        }
        if (c === '"') i++;
      } else {
        i++;
      }
      continue;
    }

    if (f.t === 'heredoc') {
      if (i === 0 || src[i - 1] === '\n') {
        const eol = src.indexOf('\n', i);
        const line = src.slice(i, eol < 0 ? n : eol);
        if (line.trim() === f.marker) {
          stack.pop();
          i += line.length;
          continue;
        }
      }
      if ((c === '$' || c === '%') && src[i + 1] === '{' && src[i - 1] !== c) {
        stack.push({ t: 'interp', start: i });
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // Code: a block body or an expression.
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      if (f.t === 'attr') endAttr(f);
      else if (f.t === 'body') f.line = [];
      else if (f.t === 'brace') {
        f.afterEq = false;
        f.key = undefined;
      }
      lastIdent = undefined;
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*'))) {
      const start = i;
      const block = c === '/' && src[i + 1] === '*';
      if (block) {
        const close = src.indexOf('*/', i + 2);
        i = close < 0 ? n : close + 2;
      } else {
        const eol = src.indexOf('\n', i);
        i = eol < 0 ? n : eol;
      }
      // A line comment runs to the end of the line; a block one ends before "*/" is closed.
      if (cursor !== undefined && start < cursor && (block ? cursor < i || !src.endsWith('*/', i) : cursor <= i)) {
        inComment = true;
      }
      continue;
    }
    if (c === '"') {
      const label = f.t === 'body' && f.line.length > 0 && f.line[0].kind === 'ident' ? { type: f.line[0].text, index: f.line.length - 1 } : undefined;
      if (f.t === 'body' && !label) f.line.push({ kind: 'other', text: c, start: i, end: i + 1 });
      stack.push({ t: 'string', start: i, label });
      i++;
      continue;
    }
    if (c === '<' && src[i + 1] === '<') {
      const m = /^<<-?([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\r?\n/.exec(src.slice(i, i + 80));
      if (m) {
        stack.push({ t: 'heredoc', start: i, marker: m[1] });
        i += m[0].length;
        continue;
      }
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentChar(src[j])) j++;
      const text = src.slice(i, j);
      if (f.t === 'body') f.line.push({ kind: 'ident', text, start: i, end: j });
      else if (f.t === 'brace' && !f.afterEq) f.key = text;
      lastIdent = { text, end: j };
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i, i + 40));
      const len = m ? m[0].length : 1;
      if (f.t === 'body') f.line.push({ kind: 'other', text: src.slice(i, i + len), start: i, end: i + len });
      i += len;
      continue;
    }

    const prev = lastIdent;
    lastIdent = undefined;
    switch (c) {
      case '=': {
        const op = src[i + 1] === '=' || src[i + 1] === '>' || '=!<>'.includes(src[i - 1]);
        if (!op && f.t === 'body' && f.line.length === 1 && f.line[0].kind === 'ident') {
          const name = f.line[0];
          const node: AttrNode = { name: name.text, nameStart: name.start, valueStart: i + 1, valueEnd: n };
          f.node.attrs.push(node);
          f.line = [];
          stack.push({ t: 'attr', node, body: f.node });
        } else if (!op && f.t === 'brace') {
          f.afterEq = true;
        } else if (f.t === 'body') {
          f.line.push({ kind: 'other', text: c, start: i, end: i + 1 });
        }
        i += src[i + 1] === '=' || src[i + 1] === '>' ? 2 : 1;
        break;
      }
      case ':':
        if (f.t === 'brace') f.afterEq = true;
        i++;
        break;
      case ',':
        if (f.t === 'brace') {
          f.afterEq = false;
          f.key = undefined;
        }
        i++;
        break;
      case '{':
        if (f.t === 'body') {
          const [head, ...labels] = f.line;
          const node: BlockNode = {
            type: head?.kind === 'ident' ? head.text : '',
            labels: labels.filter((t) => t.kind !== 'other').map((t) => t.text),
            start: head ? head.start : i,
            end: n,
            attrs: [],
            blocks: [],
          };
          f.node.blocks.push(node);
          f.line = [];
          stack.push({ t: 'body', node, line: [] });
        } else {
          stack.push({ t: 'brace', start: i, afterEq: false });
        }
        i++;
        break;
      case '}':
        if (f.t === 'attr') {
          endAttr(f); // `{ a = 1 }` on one line: the "}" closes the block
          break;
        }
        if (f.t === 'body') {
          if (stack.length > 1) {
            f.node.end = i + 1;
            stack.pop();
          }
          i++;
          break;
        }
        if (f.t === 'brace' || f.t === 'interp') {
          stack.pop();
          i++;
          break;
        }
        stack.pop(); // an unclosed ( or [: close it and try again
        break;
      case '[':
        if (f.t === 'body') f.line.push({ kind: 'other', text: c, start: i, end: i + 1 });
        else stack.push({ t: 'brack', start: i });
        i++;
        break;
      case '(':
        if (f.t === 'body') f.line.push({ kind: 'other', text: c, start: i, end: i + 1 });
        else stack.push({ t: 'paren', start: i, fn: prev && /^\s*$/.test(src.slice(prev.end, i)) ? prev.text : undefined });
        i++;
        break;
      case ']':
      case ')':
        if (f.t === (c === ']' ? 'brack' : 'paren')) stack.pop();
        i++;
        break;
      default:
        if (f.t === 'body') f.line.push({ kind: 'other', text: c, start: i, end: i + 1 });
        i++;
    }
  }
  if (cursor !== undefined && !at) snapshot();
  // Close what is still open at the end of the file.
  for (let k = stack.length - 1; k >= 0; k--) {
    const f = stack[k];
    if (f.t === 'attr') f.node.valueEnd = n;
  }
  return { root, at, inComment };
}
