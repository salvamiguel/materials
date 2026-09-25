// What a module (a directory of .tf files) declares, for references
// (var.x, aws_instance.web, module.net.id...) and module inputs.

import { scan, type AttrNode, type BlockNode, type Scan } from './scan';

export interface VariableInfo {
  type?: string;
  description?: string;
  default?: string;
}

export interface ModuleOutline {
  variables: Map<string, VariableInfo>;
  /** Local value name → its expression. */
  locals: Map<string, string>;
  resources: BlockNode[];
  data: BlockNode[];
  /** Module call name → source argument. */
  modules: Map<string, string | undefined>;
  outputs: Map<string, { description?: string }>;
  /** provider blocks: name and alias. */
  providers: { name: string; alias?: string }[];
  /** required_providers: local name → source and version. */
  requiredProviders: Map<string, { source?: string; version?: string }>;
}

export const dirOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/** Joins a relative module source to a directory ("" is the root module). */
export function joinDir(dir: string, rel: string): string | undefined {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

// Scanning is cheap, but completion runs on every keystroke: reuse the
// outline of files that did not change.
const cache = new Map<string, Scan>();
function scanCached(src: string): Scan {
  let s = cache.get(src);
  if (!s) {
    if (cache.size > 64) cache.clear();
    s = scan(src);
    cache.set(src, s);
  }
  return s;
}

export function raw(src: string, a: AttrNode): string {
  return src.slice(a.valueStart, a.valueEnd).trim();
}

/** The value of a quoted string literal, or undefined for other expressions. */
export function literal(src: string, a?: AttrNode): string | undefined {
  if (!a) return undefined;
  const m = /^"((?:\\.|[^"\\])*)"$/.exec(raw(src, a));
  return m ? m[1].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)) : undefined;
}

export const attrOf = (b: BlockNode, name: string) => b.attrs.find((a) => a.name === name);

export function outlineModule(files: Record<string, string>, dir: string): ModuleOutline {
  const o: ModuleOutline = {
    variables: new Map(),
    locals: new Map(),
    resources: [],
    data: [],
    modules: new Map(),
    outputs: new Map(),
    providers: [],
    requiredProviders: new Map(),
  };
  const names = Object.keys(files)
    .filter((f) => f.endsWith('.tf') && dirOf(f) === dir)
    .sort();
  for (const file of names) {
    const src = files[file];
    for (const b of scanCached(src).root.blocks) {
      const [l0, l1] = b.labels;
      switch (b.type) {
        case 'variable':
          if (l0) {
            const def = attrOf(b, 'default');
            o.variables.set(l0, {
              type: attrOf(b, 'type') && raw(src, attrOf(b, 'type')!),
              description: literal(src, attrOf(b, 'description')),
              default: def && raw(src, def),
            });
          }
          break;
        case 'locals':
          for (const a of b.attrs) o.locals.set(a.name, raw(src, a));
          break;
        case 'resource':
          if (l0 && l1) o.resources.push(b);
          break;
        case 'data':
          if (l0 && l1) o.data.push(b);
          break;
        case 'module':
          if (l0) o.modules.set(l0, literal(src, attrOf(b, 'source')));
          break;
        case 'output':
          if (l0) o.outputs.set(l0, { description: literal(src, attrOf(b, 'description')) });
          break;
        case 'provider':
          if (l0) o.providers.push({ name: l0, alias: literal(src, attrOf(b, 'alias')) });
          break;
        case 'terraform':
          for (const rp of b.blocks.filter((x) => x.type === 'required_providers')) {
            for (const a of rp.attrs) {
              const v = raw(src, a);
              const source = /\bsource\s*=\s*"([^"]*)"/.exec(v)?.[1] ?? (/^"([^"]*)"$/.exec(v)?.[1] || undefined);
              o.requiredProviders.set(a.name, { source, version: /\bversion\s*=\s*"([^"]*)"/.exec(v)?.[1] });
            }
          }
          break;
      }
    }
  }
  return o;
}

/** Directories (other than dir) that contain .tf files, as module sources relative to dir. */
export function moduleDirs(files: Record<string, string>, dir: string): string[] {
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) if (f.endsWith('.tf') && dirOf(f) !== dir) dirs.add(dirOf(f));
  const out: string[] = [];
  for (const d of dirs) {
    if (!d) continue;
    const from = dir ? dir.split('/') : [];
    const to = d.split('/');
    let k = 0;
    while (k < from.length && k < to.length && from[k] === to[k]) k++;
    const up = from.slice(k).map(() => '..');
    out.push([up.length ? up.join('/') : '.', ...to.slice(k)].join('/'));
  }
  return out.sort();
}
