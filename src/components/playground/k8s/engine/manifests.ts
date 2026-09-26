// Reading manifests from the workspace: multi-document YAML (or JSON) with
// the line where each document starts, `kind: List`, and -f paths that are
// files, directories or URLs of workspace files.

import { LineCounter, parseAllDocuments } from 'yaml';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Doc {
  obj: Json;
  file: string;
  /** 1-based line where the document starts. */
  line: number;
}

export class ManifestError extends Error {}

export function parseManifests(text: string, file: string): Doc[] {
  const lc = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter: lc, uniqueKeys: false });
  const out: Doc[] = [];
  const list = Array.isArray(docs) ? docs : [docs];
  for (const d of list) {
    if (d.errors.length) {
      const e = d.errors[0];
      const line = e.linePos?.[0]?.line ?? 0;
      throw new ManifestError(`error: error parsing ${file}: error converting YAML to JSON: yaml: line ${line}: ${yamlMessage(e.message)}`);
    }
    const obj = d.toJS({ maxAliasCount: 100 });
    if (obj === null || obj === undefined) continue;
    const start = d.contents?.range?.[0] ?? 0;
    const line = lc.linePos(start).line;
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      throw new ManifestError(`error: error validating "${file}": error validating data: invalid object to validate`);
    }
    if (obj.kind === 'List' && Array.isArray(obj.items)) {
      for (const it of obj.items) out.push({ obj: it, file, line });
    } else out.push({ obj, file, line });
  }
  return out;
}

function yamlMessage(m: string): string {
  const first = m.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
  if (/Implicit map keys need to be followed by map values|Nested mappings are not allowed/.test(first)) return 'mapping values are not allowed in this context';
  if (/All mapping items must start at the same column|Implicit keys need to be on a single line/.test(first)) return 'did not find expected key';
  if (/Tabs are not allowed/.test(first)) return 'found character that cannot start any token';
  if (/Map keys must be unique/.test(first)) return first;
  return first.charAt(0).toLowerCase() + first.slice(1);
}

/** Checks kubectl does before sending: apiVersion and kind present. */
export function clientValidate(doc: Doc): string | undefined {
  const missing: string[] = [];
  if (!doc.obj.apiVersion) missing.push('apiVersion not set');
  if (!doc.obj.kind) missing.push('kind not set');
  if (missing.length) return `error: error validating "${doc.file}": error validating data: [${missing.join(', ')}]; if you choose to ignore these errors, turn validation off with --validate=false`;
  return undefined;
}

const MANIFEST = /\.(ya?ml|json)$/;

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/^\.\//, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Files a `-f` argument refers to (a file, or the manifests of a directory). */
export function resolveFiles(files: Record<string, string>, arg: string, recursive: boolean): string[] {
  const p = normalizePath(arg);
  if (files[p] !== undefined) return [p];
  const dir = p ? `${p}/` : '';
  const inDir = Object.keys(files)
    .filter((f) => f.startsWith(dir) && MANIFEST.test(f) && (recursive || !f.slice(dir.length).includes('/')))
    .filter((f) => !/(^|\/)(kustomization|Chart|values[^/]*)\.ya?ml$/.test(f) || false)
    .sort();
  if (inDir.length) return inDir;
  if (Object.keys(files).some((f) => f.startsWith(dir))) return [];
  throw new ManifestError(`error: the path "${arg}" does not exist`);
}
