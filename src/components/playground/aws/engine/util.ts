import type { PlaygroundState, Tag } from './types';

/** Thrown for AWS service errors: "An error occurred (Code) when calling the Op operation: message". */
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    /** API operation to name in the error, when it differs from the command's. */
    public api?: string,
  ) {
    super(message);
  }
}

/** Thrown for local CLI problems (usage, parameters, credentials). Printed as is. */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 252,
  ) {
    super(message);
  }
}

export const err = (code: string, message: string, api?: string) => new ServiceError(code, message, api);

export const serviceErrorText = (e: ServiceError, api: string) =>
  `An error occurred (${e.code}) when calling the ${e.api ?? api} operation: ${e.message}`;

// Deterministic pseudo-random generator: the same sequence of commands
// always produces the same identifiers.
function mix(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function randomChars(st: PlaygroundState, len: number, alphabet: string): string {
  let out = '';
  while (out.length < len) {
    st.seq += 1;
    let v = mix(st.seq * 2654435761);
    for (let i = 0; i < 4 && out.length < len; i++) {
      out += alphabet[v % alphabet.length];
      v = Math.floor(v / alphabet.length);
    }
  }
  return out;
}

const HEX = '0123456789abcdef';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** vpc-0a1b2c3d4e5f67890 style ids (17 hex chars). */
export const ec2Id = (st: PlaygroundState, prefix: string) => `${prefix}-0${randomChars(st, 16, HEX)}`;
/** AIDA/AROA/ANPA… style IAM unique ids. */
export const iamId = (st: PlaygroundState, prefix: string) => prefix + randomChars(st, 17, UPPER);
export const hexChars = (st: PlaygroundState, n: number) => randomChars(st, n, HEX);
export const secretChars = (st: PlaygroundState, n: number) => randomChars(st, n, B64);

/** Stable 32-hex digest for ETags (not real MD5, just deterministic). */
export function digest(text: string): string {
  let out = '';
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x01000193);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out += (mix(h) >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

/** AWS CLI v2 prints timestamps like 2026-09-24T10:12:30+00:00. */
export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');

/** "2026-09-24 12:12:30" in local time, as `aws s3 ls` prints it. */
export function localStamp(isoDate: string): string {
  const d = new Date(isoDate);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Case-sensitive glob with * and ?. */
export function globMatch(pattern: string, value: string, ignoreCase = false): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .split('')
        .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
    ignoreCase ? 'i' : '',
  );
  return re.test(value);
}

export const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function humanSize(n: number): string {
  const units = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${n} Bytes` : `${v.toFixed(1)} ${units[i]}`;
}

export function contentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    pem: 'application/x-pem-file',
  };
  return (ext && types[ext]) || 'binary/octet-stream';
}

export function tagsFromSpecs(specs: Json[] | undefined, resourceType: string): Tag[] | undefined {
  const tags: Tag[] = [];
  for (const s of specs || []) {
    if (s.ResourceType === resourceType) tags.push(...(s.Tags || []).map((t: Tag) => ({ Key: t.Key, Value: String(t.Value ?? '') })));
  }
  return tags.length ? tags : undefined;
}

// CIDR helpers (IPv4 only)
export function parseCidr(cidr: string): { base: number; bits: number } | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr);
  if (!m) return undefined;
  const octets = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (octets.some((o) => o > 255) || bits > 32) return undefined;
  const ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  if ((ip & mask) >>> 0 !== ip) return undefined; // host bits set
  return { base: ip, bits };
}

export const ipToString = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

export function cidrContains(outer: string, inner: string): boolean {
  const a = parseCidr(outer);
  const b = parseCidr(inner);
  if (!a || !b || b.bits < a.bits) return false;
  const mask = a.bits === 0 ? 0 : (~0 << (32 - a.bits)) >>> 0;
  return ((b.base & mask) >>> 0) === a.base;
}

export function cidrOverlaps(x: string, y: string): boolean {
  return cidrContains(x, y) || cidrContains(y, x);
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
