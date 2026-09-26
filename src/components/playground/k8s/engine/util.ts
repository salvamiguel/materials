// Small helpers shared by the simulated cluster: deterministic randomness,
// hashes, quantities, durations and label selectors.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** mulberry32: tiny seeded PRNG whose state fits in one number (so it can be saved). */
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// The alphabet Kubernetes uses for generated names (no vowels, no 0/1/3).
const SAFE = 'bcdfghjklmnpqrstvwxz2456789';

export function randomSuffix(state: { rng: number }, n = 5): string {
  let s = '';
  for (let i = 0; i < n; i++) s += SAFE[Math.floor(nextRandom(state) * SAFE.length)];
  return s;
}

export function uuid(state: { rng: number }): string {
  const hex = () => Math.floor(nextRandom(state) * 16).toString(16);
  const part = (n: number) => Array.from({ length: n }, hex).join('');
  return `${part(8)}-${part(4)}-4${part(3)}-${'89ab'[Math.floor(nextRandom(state) * 4)]}${part(3)}-${part(12)}`;
}

/** FNV-1a 32 bits. */
export function fnv32a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable JSON (sorted keys), so equal objects hash equally. */
export function stableJson(v: Json): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
    .join(',')}}`;
}

/** Like pod-template-hash: a short, safe-encoded hash of an object. */
export function templateHash(v: Json): string {
  let h = fnv32a(stableJson(v));
  let s = '';
  for (let i = 0; i < 10 && (h > 0 || s.length < 9); i++) {
    s += SAFE[h % SAFE.length];
    h = Math.floor(h / SAFE.length);
  }
  return s;
}

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function deepEqual(a: Json, b: Json): boolean {
  return stableJson(a) === stableJson(b);
}

export const isObject = (v: unknown): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── quantities ───────────────────────────────────────────────────────

const SUFFIX: Record<string, number> = {
  '': 1, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
};

/** Parses a Kubernetes quantity ("250m", "1.5", "128Mi"). NaN if invalid. */
export function parseQuantity(q: unknown): number {
  if (typeof q === 'number') return q;
  if (typeof q !== 'string') return NaN;
  const m = /^([+-]?[0-9.]+(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/.exec(q.trim());
  if (!m || !(m[2] in SUFFIX)) return NaN;
  return parseFloat(m[1]) * SUFFIX[m[2]];
}

export function formatCpu(cores: number): string {
  return `${Math.round(cores * 1000)}m`;
}

export function formatMem(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 2)}Mi`;
}

// ── durations ────────────────────────────────────────────────────────

/** kubectl's HumanDuration (k8s.io/apimachinery/pkg/util/duration). */
export function humanDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60 * 2) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return s % 60 === 0 ? `${m}m` : `${m}m${s % 60}s`;
  if (m < 60 * 3) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 8) return m % 60 === 0 ? `${h}h` : `${h}h${m % 60}m`;
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (h < 24 * 8) return h % 24 === 0 ? `${d}d` : `${d}d${h % 24}h`;
  if (d < 365 * 2) return `${d}d`;
  const y = Math.floor(d / 365);
  if (y < 8) return d % 365 === 0 ? `${y}y` : `${y}y${d % 365}d`;
  return `${y}y`;
}

/** Parses a Go-style duration: "30s", "5m", "1h30m". */
export function parseDuration(s: string): number {
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched += m[0];
    total += parseFloat(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] as 'ms']!;
  }
  if (!matched || matched !== s) return NaN;
  return total;
}

// ── label selectors ──────────────────────────────────────────────────

export interface Requirement {
  key: string;
  op: 'in' | 'notin' | 'exists' | '!' | '=' | '!=';
  values: string[];
}

export type Selector = Requirement[];

/** Parses "app=web,tier!=db,env in (a,b),!legacy,release". Throws on bad syntax. */
export function parseSelector(s: string): Selector {
  const out: Selector = [];
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^([\w./-]+)\s+(in|notin)\s+\(([^)]*)\)$/.exec(p))) {
      out.push({ key: m[1], op: m[2] as 'in', values: m[3].split(',').map((v) => v.trim()).filter(Boolean) });
    } else if ((m = /^([\w./-]+)\s*(==|=|!=)\s*([\w./-]*)$/.exec(p))) {
      out.push({ key: m[1], op: m[2] === '!=' ? '!=' : '=', values: [m[3]] });
    } else if ((m = /^!\s*([\w./-]+)$/.exec(p))) {
      out.push({ key: m[1], op: '!', values: [] });
    } else if ((m = /^([\w./-]+)$/.exec(p))) {
      out.push({ key: m[1], op: 'exists', values: [] });
    } else {
      throw new Error(`unable to parse requirement: ${p}`);
    }
  }
  return out;
}

export function matches(sel: Selector, labels: Record<string, string> | undefined): boolean {
  const l = labels || {};
  return sel.every((r) => {
    const has = Object.prototype.hasOwnProperty.call(l, r.key);
    switch (r.op) {
      case '=':
        return has && l[r.key] === r.values[0];
      case '!=':
        return !has || l[r.key] !== r.values[0];
      case 'in':
        return has && r.values.includes(l[r.key]);
      case 'notin':
        return !has || !r.values.includes(l[r.key]);
      case 'exists':
        return has;
      case '!':
        return !has;
    }
    return false;
  });
}

/** metav1.LabelSelector ({matchLabels, matchExpressions}) → Selector. */
export function fromLabelSelector(ls: Json): Selector {
  if (!ls) return [];
  const out: Selector = Object.entries(ls.matchLabels || {}).map(([key, v]) => ({ key, op: '=' as const, values: [String(v)] }));
  for (const e of ls.matchExpressions || []) {
    const op = { In: 'in', NotIn: 'notin', Exists: 'exists', DoesNotExist: '!' }[e.operator as string] as Requirement['op'];
    if (op) out.push({ key: e.key, op, values: (e.values || []).map(String) });
  }
  return out;
}

/** Service-style selector (a plain map). An empty map selects nothing for services. */
export function fromMap(m: Record<string, string> | undefined): Selector {
  return Object.entries(m || {}).map(([key, v]) => ({ key, op: '=' as const, values: [String(v)] }));
}

export function selectorString(sel: Selector): string {
  return sel
    .map((r) => {
      switch (r.op) {
        case '=':
          return `${r.key}=${r.values[0]}`;
        case '!=':
          return `${r.key}!=${r.values[0]}`;
        case 'in':
        case 'notin':
          return `${r.key} ${r.op} (${r.values.join(',')})`;
        case 'exists':
          return r.key;
        case '!':
          return `!${r.key}`;
      }
      return '';
    })
    .join(',');
}

export function labelsString(l: Record<string, string> | undefined): string {
  const e = Object.entries(l || {});
  return e.length ? e.map(([k, v]) => `${k}=${v}`).join(',') : '<none>';
}

// ── int-or-percent (maxSurge, maxUnavailable) ────────────────────────

export function intOrPercent(v: unknown, total: number, roundUp: boolean, fallback: string): number {
  const x = v === undefined || v === null ? fallback : v;
  if (typeof x === 'number') return x;
  const m = /^(\d+)%$/.exec(String(x));
  if (m) {
    const f = (parseInt(m[1], 10) * total) / 100;
    return roundUp ? Math.ceil(f) : Math.floor(f);
  }
  const n = parseInt(String(x), 10);
  return Number.isNaN(n) ? 0 : n;
}

// ── validation helpers ───────────────────────────────────────────────

const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function dnsSubdomainError(name: string): string | undefined {
  if (name.length > 253) return 'must be no more than 253 characters';
  if (!DNS1123_SUBDOMAIN.test(name))
    return `a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')`;
  return undefined;
}

export function dnsLabelError(name: string): string | undefined {
  if (name.length > 63) return 'must be no more than 63 characters';
  if (!DNS1123_LABEL.test(name))
    return `a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')`;
  return undefined;
}

/** Go's %v of a map[string]string, as in "Invalid value: map[string]string{...}". */
export function goMap(m: Record<string, string> | undefined): string {
  const e = Object.entries(m || {}).sort(([a], [b]) => a.localeCompare(b));
  return `map[string]string{${e.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(', ')}}`;
}

export function pad(rows: string[][]): string {
  if (!rows.length) return '';
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] || 0, c.length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] + 3))).join('').trimEnd()).join('\n') + '\n';
}

export function base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function unbase64(s: string): string {
  try {
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}
