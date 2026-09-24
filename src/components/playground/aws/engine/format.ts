// Output formats of the AWS CLI: json, text, table and yaml.
// text and table follow awscli/formatter.py and awscli/text.py.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const isScalar = (v: unknown) => v === null || typeof v !== 'object';

/** Python's str(): True/False/None. */
function pyStr(v: unknown): string {
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null || v === undefined) return 'None';
  return String(v);
}

export function formatJson(data: Json): string {
  return JSON.stringify(data, null, 4) + '\n';
}

// ── text ─────────────────────────────────────────────────────────────

export function formatText(data: Json): string {
  const out: string[] = [];
  textItem(data, out);
  return out.join('');
}

function textItem(item: Json, out: string[], identifier?: string, scalarKeys?: string[]) {
  if (Array.isArray(item)) textList(item, out, identifier);
  else if (item !== null && typeof item === 'object') textDict(item, out, identifier, scalarKeys);
  else out.push(pyStr(item) + '\n');
}

function textList(items: Json[], out: string[], identifier?: string) {
  if (!items.length) return;
  if (items.some((e) => e !== null && typeof e === 'object' && !Array.isArray(e))) {
    const keys = new Set<string>();
    for (const el of items) {
      if (el && typeof el === 'object' && !Array.isArray(el)) {
        for (const [k, v] of Object.entries(el)) if (isScalar(v)) keys.add(k);
      }
    }
    const all = [...keys].sort();
    for (const el of items) textItem(el, out, identifier, all);
  } else if (items.some(Array.isArray)) {
    const scalars = items.filter(isScalar);
    if (scalars.length) textScalars(scalars, out, identifier);
    for (const el of items.filter((e) => !isScalar(e))) textItem(el, out, identifier);
  } else {
    textScalars(items, out, identifier);
  }
}

function textScalars(items: Json[], out: string[], identifier?: string) {
  if (identifier !== undefined) {
    for (const v of items) out.push(`${identifier.toUpperCase()}\t${pyStr(v)}\n`);
  } else {
    out.push(items.map(pyStr).join('\t') + '\n');
  }
}

function textDict(item: Record<string, Json>, out: string[], identifier?: string, scalarKeys?: string[]) {
  const sorted = Object.keys(item).sort();
  const scalars = scalarKeys
    ? scalarKeys.map((k) => (item[k] === undefined ? '' : pyStr(item[k])))
    : sorted.filter((k) => isScalar(item[k])).map((k) => pyStr(item[k]));
  if (scalars.length) {
    if (identifier !== undefined) scalars.unshift(identifier.toUpperCase());
    out.push(scalars.join('\t') + '\n');
  }
  for (const k of sorted) if (!isScalar(item[k])) textItem(item[k], out, k);
}

// ── table ────────────────────────────────────────────────────────────

type Row = { header: boolean; cells: string[] };
interface Section {
  title?: string;
  indent: number;
  rows: Row[];
}

export function formatTable(data: Json, title: string): string {
  const sections: Section[] = [];
  let current: Section | undefined;
  const newSection = (t: string | undefined, indent: number) => {
    current = { title: t, indent, rows: [] };
    sections.push(current);
  };
  const addRow = (cells: Json[], header = false) => {
    if (!current) newSection(undefined, 0);
    current!.rows.push({ header, cells: cells.map(pyStr) });
  };

  const groupKeys = (obj: Record<string, Json>) => {
    const headers: string[] = [];
    const more: string[] = [];
    for (const k of Object.keys(obj)) (isScalar(obj[k]) ? headers : more).push(k);
    return [headers.sort(), more.sort()] as const;
  };

  const build = (t: string | undefined, cur: Json, indent: number): void => {
    if (cur === null || cur === undefined || (Array.isArray(cur) && !cur.length) || (typeof cur === 'object' && !Array.isArray(cur) && !Object.keys(cur).length)) {
      if (isScalar(cur) && cur !== null && cur !== undefined) {
        if (t !== undefined) newSection(t, indent);
        addRow([cur]);
      }
      return;
    }
    if (isScalar(cur)) {
      if (t !== undefined) newSection(t, indent);
      addRow([cur]);
      return;
    }
    if (t !== undefined) newSection(t, indent);
    if (Array.isArray(cur)) {
      if (cur[0] !== null && typeof cur[0] === 'object' && !Array.isArray(cur[0])) {
        const headers = new Set<string>();
        const more = new Set<string>();
        for (const el of cur) {
          const [h, m] = groupKeys(el);
          h.forEach((x) => headers.add(x));
          m.forEach((x) => more.add(x));
        }
        const hs = [...headers].sort();
        const ms = [...more].sort();
        if (hs.length) addRow(hs, true);
        cur.forEach((el: Record<string, Json>, idx: number) => {
          if (idx > 0 && ms.length) {
            newSection(t, indent);
            if (hs.length) addRow(hs, true);
          }
          if (hs.length) addRow(hs.map((h) => (el[h] === undefined ? '' : el[h])));
          for (const k of ms) if (k in el) build(k, el[k], indent + 1);
        });
      } else {
        for (const el of cur) {
          if (isScalar(el)) addRow([el]);
          else if (Array.isArray(el) && el.every(isScalar)) addRow(el);
          else build(undefined, el, indent);
        }
      }
      return;
    }
    const [headers, more] = groupKeys(cur);
    if (headers.length === 1) addRow([headers[0], cur[headers[0]]]);
    else if (headers.length) {
      addRow(headers, true);
      addRow(headers.map((h) => cur[h]));
    }
    for (const k of more) build(k, cur[k], indent + 1);
  };

  build(title, data, 0);
  return renderSections(sections.filter((s) => s.rows.length || s.title !== undefined));
}

function renderSections(sections: Section[]): string {
  if (!sections.length) return '';
  // Column widths per section; the whole table shares one total width.
  const natural = sections.map((s) => {
    const cols = Math.max(0, ...s.rows.map((r) => r.cells.length));
    const widths = Array.from({ length: cols }, (_, c) => Math.max(...s.rows.map((r) => (r.cells[c] ?? '').length + 4)));
    const inner = widths.reduce((a, b) => a + b, 0) + Math.max(0, cols - 1);
    return { widths, inner: Math.max(inner, (s.title?.length ?? 0) + 4) };
  });
  const total = Math.max(...sections.map((s, i) => natural[i].inner + s.indent * 2));

  const lines: string[] = [];
  lines.push('-'.repeat(total + 2));
  sections.forEach((s, i) => {
    const pad = s.indent;
    const inner = total - pad * 2;
    const left = '|'.repeat(pad + 1);
    const right = '|'.repeat(pad + 1);
    // Stretch the columns to fill the section width.
    const widths = [...natural[i].widths];
    if (widths.length) {
      const used = widths.reduce((a, b) => a + b, 0) + widths.length - 1;
      let extra = inner - used;
      let c = 0;
      while (extra > 0) {
        widths[c % widths.length]++;
        extra--;
        c++;
      }
    }
    const border = left.slice(0, -1) + '+' + widths.map((w) => '-'.repeat(w)).join('+') + '+' + right.slice(1);
    if (s.title !== undefined) {
      lines.push(left + center(s.title, inner) + right);
      // A title with nothing under it (only nested sections) is closed by a plain border.
      if (!s.rows.length) lines.push(left.slice(0, -1) + '+' + '-'.repeat(inner) + '+' + right.slice(1));
    }
    let lastHeader = false;
    s.rows.forEach((r, ri) => {
      if (r.header || ri === 0 || lastHeader) lines.push(border);
      const cells = widths.map((w, c) => (r.header ? center(r.cells[c] ?? '', w) : ('  ' + (r.cells[c] ?? '')).padEnd(w)));
      lines.push(left.slice(0, -1) + '|' + cells.join('|') + '|' + right.slice(1));
      lastHeader = r.header;
    });
    if (s.rows.length) lines.push(border);
  });
  return lines.join('\n') + '\n';
}

function center(text: string, width: number): string {
  const total = Math.max(0, width - text.length);
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + text + ' '.repeat(total - left);
}

// ── yaml ─────────────────────────────────────────────────────────────

export function formatYaml(data: Json): string {
  return yaml(data, 0).replace(/^\n/, '') + '\n';
}

function yamlScalar(v: Json): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (
    s === '' ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |\s#|\n|\s$/.test(s)
  ) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

function yaml(v: Json, indent: number): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return ' []';
    return v
      .map((el) => {
        if (el !== null && typeof el === 'object' && Object.keys(el).length) {
          const body = yaml(el, indent + 1).replace(/^\n/, '');
          return '\n' + pad + '- ' + body.slice(pad.length + 2);
        }
        return '\n' + pad + '-' + (isScalar(el) ? ' ' + yamlScalar(el) : yaml(el, indent + 1));
      })
      .join('');
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return ' {}';
    return keys.map((k) => '\n' + pad + k + ':' + (isScalar(v[k]) ? ' ' + yamlScalar(v[k]) : yaml(v[k], indent + 1))).join('');
  }
  return ' ' + yamlScalar(v);
}
