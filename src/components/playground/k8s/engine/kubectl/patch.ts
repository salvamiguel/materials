// kubectl patch (merge, strategic merge and JSON patch) and kubectl diff.

import { clone, isObject } from '../util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** RFC 7386 JSON merge patch. */
export function mergePatch(target: Json, patch: Json): Json {
  if (!isObject(patch)) return clone(patch);
  const out = isObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

// Lists merged by a key in strategic merge patch (the common ones).
const MERGE_KEYS: Record<string, string> = {
  containers: 'name',
  initContainers: 'name',
  env: 'name',
  volumes: 'name',
  volumeMounts: 'mountPath',
  ports: 'containerPort',
  imagePullSecrets: 'name',
  tolerations: 'key',
};

export function strategicPatch(target: Json, patch: Json, key?: string): Json {
  if (Array.isArray(patch) && key && MERGE_KEYS[key] && Array.isArray(target)) {
    const mk = key === 'ports' && patch.some((p) => p?.port !== undefined) ? 'port' : MERGE_KEYS[key];
    const out = target.map((x) => clone(x));
    for (const item of patch) {
      if (isObject(item) && item.$patch === 'delete') {
        const i = out.findIndex((x) => x?.[mk] === item[mk]);
        if (i >= 0) out.splice(i, 1);
        continue;
      }
      const i = out.findIndex((x) => isObject(item) && x?.[mk] === item[mk]);
      if (i >= 0) out[i] = strategicPatch(out[i], item);
      else out.push(clone(item));
    }
    return out;
  }
  if (!isObject(patch)) return clone(patch);
  const out = isObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = strategicPatch(out[k], v, k);
  }
  return out;
}

/** RFC 6902 JSON patch (add, remove, replace, copy, move, test). */
export function jsonPatch(doc: Json, ops: Json[]): Json {
  const out = clone(doc);
  const parse = (p: string) => p.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const walk = (path: string[]) => {
    let cur = out;
    for (const seg of path.slice(0, -1)) {
      cur = Array.isArray(cur) ? cur[parseInt(seg, 10)] : cur?.[seg];
      if (cur === undefined) throw new Error(`jsonpatch: path ${'/' + path.join('/')} not found`);
    }
    return { parent: cur, last: path[path.length - 1] };
  };
  const get = (path: string[]) => path.reduce((c: Json, s) => (Array.isArray(c) ? c[parseInt(s, 10)] : c?.[s]), out);
  for (const op of ops) {
    const path = parse(op.path || '');
    const { parent, last } = walk(path);
    switch (op.op) {
      case 'add':
        if (Array.isArray(parent)) parent.splice(last === '-' ? parent.length : parseInt(last, 10), 0, op.value);
        else parent[last] = op.value;
        break;
      case 'replace':
        if (get(path) === undefined) throw new Error(`jsonpatch replace operation does not apply: doc is missing key: ${op.path}`);
        if (Array.isArray(parent)) parent[parseInt(last, 10)] = op.value;
        else parent[last] = op.value;
        break;
      case 'remove':
        if (get(path) === undefined) throw new Error(`jsonpatch remove operation does not apply: doc is missing path: ${op.path}`);
        if (Array.isArray(parent)) parent.splice(parseInt(last, 10), 1);
        else delete parent[last];
        break;
      case 'copy':
      case 'move': {
        const from = parse(op.from);
        const v = clone(get(from));
        if (op.op === 'move') {
          const f = walk(from);
          if (Array.isArray(f.parent)) f.parent.splice(parseInt(f.last, 10), 1);
          else delete f.parent[f.last];
        }
        if (Array.isArray(parent)) parent.splice(last === '-' ? parent.length : parseInt(last, 10), 0, v);
        else parent[last] = v;
        break;
      }
      case 'test':
        if (JSON.stringify(get(path)) !== JSON.stringify(op.value)) throw new Error(`testing value ${op.path} failed`);
        break;
      default:
        throw new Error(`Unexpected kind: ${op.op}`);
    }
  }
  return out;
}

/** Unified diff with 3 lines of context. */
export function unifiedDiff(a: string, b: string, nameA: string, nameB: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: { t: ' ' | '-' | '+'; s: string; i: number; j: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) ops.push({ t: ' ', s: x[i], i: i++, j: j++ });
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) ops.push({ t: '+', s: y[j], i, j: j++ });
    else ops.push({ t: '-', s: x[i], i: i++, j });
  }
  if (!ops.some((o) => o.t !== ' ')) return '';
  let out = `--- ${nameA}\n+++ ${nameB}\n`;
  let k = 0;
  while (k < ops.length) {
    while (k < ops.length && ops[k].t === ' ') k++;
    if (k >= ops.length) break;
    const start = Math.max(0, k - 3);
    let end = k;
    let lastChange = k;
    while (end < ops.length && (ops[end].t !== ' ' || end - lastChange <= 6)) {
      if (ops[end].t !== ' ') lastChange = end;
      end++;
    }
    end = Math.min(ops.length, lastChange + 4);
    const hunk = ops.slice(start, end);
    const aStart = hunk[0].i + 1;
    const bStart = hunk[0].j + 1;
    const aLen = hunk.filter((o) => o.t !== '+').length;
    const bLen = hunk.filter((o) => o.t !== '-').length;
    out += `@@ -${aStart},${aLen} +${bStart},${bLen} @@\n` + hunk.map((o) => o.t + o.s).join('\n') + '\n';
    k = end;
  }
  return out;
}
