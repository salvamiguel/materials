// Minimal syntax highlighters for the editor overlay (HCL and JSON) and a
// colouriser for Terraform's CLI output.

export interface Token {
  text: string;
  cls?: string;
}

const BLOCK_KEYWORDS = new Set([
  'resource', 'data', 'variable', 'output', 'locals', 'module', 'provider', 'terraform',
  'moved', 'import', 'removed', 'check', 'dynamic', 'lifecycle', 'content', 'validation',
  'precondition', 'postcondition', 'required_providers', 'backend', 'cloud', 'provisioner',
  'connection',
]);
const EXPR_KEYWORDS = new Set(['for', 'in', 'if', 'else', 'endif', 'endfor']);
const LITERALS = new Set(['true', 'false', 'null']);

function isIdentStart(c: string) {
  return /[A-Za-z_]/.test(c);
}

function isIdent(c: string) {
  return /[A-Za-z0-9_-]/.test(c);
}

export function highlightHcl(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let lineStart = true;
  const push = (text: string, cls?: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ text, cls });
  };

  // Reads a quoted string starting at i (on the opening quote), splitting
  // ${...} interpolations into their own tokens.
  const readString = () => {
    let buf = '"';
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        buf += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if ((c === '$' || c === '%') && src[i + 1] === '{') {
        push(buf, 'str');
        buf = '';
        let depth = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}') {
            depth--;
            if (depth === 0) break;
          } else if (src[j] === '\n') break;
        }
        push(src.slice(i, j + 1), 'interp');
        i = j + 1;
        continue;
      }
      if (c === '"' || c === '\n') {
        buf += c === '"' ? c : '';
        if (c === '"') i++;
        break;
      }
      buf += c;
      i++;
    }
    push(buf, 'str');
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      push(c);
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      push(c);
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      push(src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      push(src.slice(i, j), 'comment');
      i = j;
      lineStart = false;
      continue;
    }
    if (c === '"') {
      readString();
      lineStart = false;
      continue;
    }
    if (c === '<' && src[i + 1] === '<') {
      const m = /^<<-?([A-Za-z_][A-Za-z0-9_]*)\n/.exec(src.slice(i));
      if (m) {
        const marker = m[1];
        const re = new RegExp('\\n\\s*' + marker + '(?=\\s*(\\n|$))');
        const rest = src.slice(i + m[0].length - 1);
        const found = re.exec(rest);
        const j = found ? i + m[0].length - 1 + found.index + found[0].length : src.length;
        push(src.slice(i, j), 'str');
        i = j;
        lineStart = false;
        continue;
      }
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      const text = m ? m[0] : c;
      push(text, 'num');
      i += text.length;
      lineStart = false;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      const next = src[k];
      let cls: string | undefined;
      if (LITERALS.has(word)) cls = 'lit';
      else if (next === '(') cls = 'fn';
      else if (next === '=' && src[k + 1] !== '=' && src[k + 1] !== '>') cls = 'attr';
      else if (lineStart && BLOCK_KEYWORDS.has(word)) cls = 'kw';
      else if (EXPR_KEYWORDS.has(word)) cls = 'kw';
      else if (lineStart && (next === '{' || next === '"')) cls = 'kw';
      else if (/^(var|local|module|data|each|count|self|path|terraform)$/.test(word)) cls = 'ref';
      push(word, cls);
      i = j;
      lineStart = false;
      continue;
    }
    push(c, 'punct');
    i++;
    lineStart = false;
  }
  return out;
}

export function highlightJson(src: string): Token[] {
  const out: Token[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    if (m[1]) {
      out.push({ text: m[1], cls: m[2] ? 'attr' : 'str' });
      if (m[2]) out.push({ text: m[2] });
    } else if (m[3]) out.push({ text: m[3], cls: 'num' });
    else out.push({ text: m[4], cls: 'lit' });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

export function highlight(src: string, filename: string): Token[] {
  if (filename.endsWith('.json')) return highlightJson(src);
  if (/\.(tf|tfvars|hcl|tftpl)$/.test(filename)) return highlightHcl(src);
  return [{ text: src }];
}

// --- terminal output ---

export interface OutLine {
  tokens: Token[];
}

const SYMBOL_RE = /^(\s*)(-\/\+|\+\/-|<=|[+~-])( )(.*)$/;

export function colorizeOutput(text: string): OutLine[] {
  const lines = text.replace(/\n$/, '').split('\n');
  let box: 'err' | 'warn' | undefined;
  return lines.map((line) => {
    const tokens: Token[] = [];
    // Diagnostic boxes: ╷ │ ╵
    if (/^[╷│╵]/.test(line)) {
      if (line.startsWith('╷')) box = undefined;
      const rest = line.slice(1);
      if (/^ Error: /.test(rest)) box = 'err';
      else if (/^ Warning: /.test(rest)) box = 'warn';
      tokens.push({ text: line[0], cls: box });
      const m = /^ (Error|Warning): (.*)$/.exec(rest);
      if (m) {
        tokens.push({ text: ' ' });
        tokens.push({ text: m[1] + ':', cls: (box || '') + ' bold' });
        tokens.push({ text: ' ' + m[2], cls: 'bold' });
      } else {
        tokens.push({ text: rest });
      }
      return { tokens };
    }
    if (/^(Error|Warning): /.test(line)) {
      const isErr = line.startsWith('Error');
      tokens.push({ text: line, cls: (isErr ? 'err' : 'warn') + ' bold' });
      return { tokens };
    }
    if (/^(Plan:|Changes to Outputs:|Outputs:|Terraform will perform|Terraform has been successfully initialized!|Initializing )/.test(line)) {
      tokens.push({ text: line, cls: /successfully/.test(line) ? 'ok bold' : 'bold' });
      return { tokens };
    }
    if (/^(Apply complete!|Destroy complete!|No changes\.|Success!)/.test(line)) {
      tokens.push({ text: line, cls: 'ok bold' });
      return { tokens };
    }
    if (/^\s*# .* (will be|must be|has moved)/.test(line)) {
      tokens.push({ text: line, cls: 'bold' });
      return { tokens };
    }
    const act = /^([^\s:]+(?: \(deposed object \w+\))?): (.*)$/.exec(line);
    if (act && /^(Creating|Creation|Modifying|Modifications|Destroying|Destruction|Refreshing|Reading|Read complete|Still)/.test(act[2])) {
      tokens.push({ text: act[1], cls: 'bold' });
      tokens.push({ text: ': ' + act[2], cls: /complete/.test(act[2]) ? undefined : 'dim' });
      return { tokens };
    }
    const m = SYMBOL_RE.exec(line);
    if (m) {
      const sym = m[2];
      const cls = sym === '+' ? 'add' : sym === '-' ? 'del' : sym === '~' ? 'chg' : sym === '<=' ? 'read' : 'rep';
      tokens.push({ text: m[1] });
      if (sym === '-/+' || sym === '+/-') {
        tokens.push({ text: sym[0], cls: sym[0] === '-' ? 'del' : 'add' });
        tokens.push({ text: '/' });
        tokens.push({ text: sym[2], cls: sym[2] === '-' ? 'del' : 'add' });
      } else {
        tokens.push({ text: sym, cls });
      }
      tokens.push({ text: m[3] });
      pushRest(tokens, m[4]);
      return { tokens };
    }
    pushRest(tokens, line);
    return { tokens };
  });
}

function pushRest(tokens: Token[], text: string) {
  const re = /(\(known after apply\)|\(sensitive value\)|# forces replacement|# \(\d+ unchanged [a-z]+ hidden\)|-> null)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    const t = m[1];
    tokens.push({ text: t, cls: t === '# forces replacement' ? 'del' : 'dim' });
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
}
