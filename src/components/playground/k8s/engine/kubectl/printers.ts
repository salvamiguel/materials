// kubectl's output: the table columns of each type (pkg/printers/internalversion),
// -o yaml/json/name/wide/jsonpath/custom-columns.

import { stringify } from 'yaml';
import type { Cluster } from '../cluster';
import { qualifiedName, resourceByKind } from '../resources';
import type { Obj } from '../types';
import { fromLabelSelector, humanDuration, intOrPercent, labelsString, pad, parseQuantity, selectorString, unbase64 } from '../util';
import { condition, podReady } from '../controllers/common';
import { jobFinished } from '../controllers/job';
import { eligibleNodes } from '../controllers/daemonset';
import { podCpu } from '../controllers/hpa';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const age = (cl: Cluster, ts: string | undefined) => (ts ? humanDuration(cl.now - Date.parse(ts)) : '<unknown>');

/** STATUS column of `kubectl get pods`. */
export function podStatus(cl: Cluster, p: Obj): string {
  let reason: string = p.status?.reason || p.status?.phase || 'Pending';
  const inits: Json[] = p.status?.initContainerStatuses || [];
  let initializing = false;
  for (let i = 0; i < inits.length; i++) {
    const c = inits[i];
    const t = c.state?.terminated;
    const w = c.state?.waiting;
    if (t && t.exitCode === 0) continue;
    if (t) reason = `Init:${t.reason || `ExitCode:${t.exitCode}`}`;
    else if (w?.reason && w.reason !== 'PodInitializing') reason = `Init:${w.reason}`;
    else reason = `Init:${i}/${(p.spec.initContainers || []).length}`;
    initializing = true;
    break;
  }
  if (!initializing) {
    let hasRunning = false;
    const cs: Json[] = p.status?.containerStatuses || [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      if (c.state?.waiting?.reason) reason = c.state.waiting.reason;
      else if (c.state?.terminated?.reason) reason = c.state.terminated.reason;
      else if (c.state?.terminated) reason = `ExitCode:${c.state.terminated.exitCode}`;
      else if (c.state?.running && c.ready) hasRunning = true;
    }
    if (reason === 'Completed' && hasRunning) reason = podReady(p) ? 'Running' : 'NotReady';
    if (!cs.length && p.spec.nodeName && reason === 'Pending') reason = 'ContainerCreating';
    if (!p.spec.nodeName && p.status?.phase === 'Pending') reason = 'Pending';
  }
  const node = p.spec.nodeName ? cl.get('Node', undefined, p.spec.nodeName) : undefined;
  if (node && cl.s.downNodes[node.metadata.uid] !== undefined && !p.metadata.deletionTimestamp && reason === 'Running') reason = 'Running';
  if (p.metadata.deletionTimestamp) reason = node && cl.s.downNodes[node.metadata.uid] !== undefined ? 'Unknown' : 'Terminating';
  return reason;
}

export function podRestarts(cl: Cluster, p: Obj): string {
  let n = 0;
  let last = 0;
  for (const c of [...(p.status?.initContainerStatuses || []), ...(p.status?.containerStatuses || [])]) {
    n += c.restartCount || 0;
    const f = Date.parse(c.lastState?.terminated?.finishedAt || '');
    if (!Number.isNaN(f)) last = Math.max(last, f);
  }
  return n && last ? `${n} (${humanDuration(cl.now - last)} ago)` : String(n);
}

export function podReadyCount(p: Obj): string {
  const cs: Json[] = p.status?.containerStatuses || [];
  const total = (p.spec.containers || []).length;
  return `${cs.filter((c) => c.ready).length}/${total}`;
}

function images(tpl: Obj) {
  return (tpl?.spec?.containers || []).map((c: Json) => c.image).join(',');
}

function containers(tpl: Obj) {
  return (tpl?.spec?.containers || []).map((c: Json) => c.name).join(',');
}

function svcPorts(s: Obj): string {
  const ps = (s.spec.ports || []).map((p: Json) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol || 'TCP'}`);
  return ps.length ? ps.join(',') : '<none>';
}

function externalIp(s: Obj): string {
  if (s.spec.type === 'ExternalName') return s.spec.externalName;
  const lb = (s.status?.loadBalancer?.ingress || []).map((i: Json) => i.ip || i.hostname);
  if (s.spec.type === 'LoadBalancer') return lb.length ? lb.join(',') : '<pending>';
  return (s.spec.externalIPs || []).join(',') || '<none>';
}

function endpointsString(ep: Obj): string {
  const out: string[] = [];
  for (const s of ep.subsets || []) for (const a of s.addresses || []) for (const p of s.ports || []) out.push(`${a.ip}:${p.port}`);
  if (!out.length) return '<none>';
  return out.length > 3 ? `${out.slice(0, 3).join(',')} + ${out.length - 3} more...` : out.join(',');
}

function accessModes(m: string[] | undefined) {
  return (m || []).map((x) => ({ ReadWriteOnce: 'RWO', ReadOnlyMany: 'ROX', ReadWriteMany: 'RWX', ReadWriteOncePod: 'RWOP' })[x] || x).join(',');
}

function nodeRoles(n: Obj) {
  const roles = Object.keys(n.metadata.labels || {})
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.split('/')[1]);
  return roles.length ? roles.join(',') : '<none>';
}

export function nodeStatus(cl: Cluster, n: Obj) {
  const r = condition(n, 'Ready')?.status;
  let s = r === 'True' ? 'Ready' : r === 'Unknown' ? 'NotReady' : 'NotReady';
  if (n.spec.unschedulable) s += ',SchedulingDisabled';
  return s;
}

export function hpaTargets(h: Obj): string {
  const cur = h.status?.currentMetrics?.[0]?.resource?.current?.averageUtilization;
  const target =
    h.apiVersion === 'autoscaling/v1'
      ? h.spec.targetCPUUtilizationPercentage
      : (h.spec.metrics || []).find((m: Json) => m.resource?.name === 'cpu')?.resource?.target?.averageUtilization;
  return `cpu: ${cur === undefined ? '<unknown>' : `${cur}%`}/${target ?? '?'}%`;
}

function jobDuration(cl: Cluster, j: Obj) {
  const s = Date.parse(j.status?.startTime || '');
  if (Number.isNaN(s)) return '';
  const e = Date.parse(j.status?.completionTime || '');
  return humanDuration((Number.isNaN(e) ? cl.now : e) - s);
}

export function jobStatus(j: Obj) {
  const f = jobFinished(j);
  if (f) return f;
  if (j.spec.suspend) return 'Suspended';
  if (condition(j, 'FailureTarget')?.status === 'True') return 'FailureTarget';
  return 'Running';
}

export interface Table {
  headers: string[];
  rows: (o: Obj) => string[];
  wide?: { headers: string[]; rows: (o: Obj) => string[] };
}

export function tableFor(cl: Cluster, kind: string): Table {
  const a = (o: Obj) => age(cl, o.metadata.creationTimestamp);
  switch (kind) {
    case 'Pod':
      return {
        headers: ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'],
        rows: (p) => [p.metadata.name, podReadyCount(p), podStatus(cl, p), podRestarts(cl, p), a(p)],
        wide: {
          headers: ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'],
          rows: (p) => [p.status?.podIP || '<none>', p.spec.nodeName || '<none>', '<none>', '<none>'],
        },
      };
    case 'Deployment':
      return {
        headers: ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'],
        rows: (d) => [
          d.metadata.name,
          `${d.status?.readyReplicas || 0}/${d.spec.replicas ?? 1}`,
          String(d.status?.updatedReplicas || 0),
          String(d.status?.availableReplicas || 0),
          a(d),
        ],
        wide: {
          headers: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
          rows: (d) => [containers(d.spec.template), images(d.spec.template), selectorString(fromLabelSelector(d.spec.selector))],
        },
      };
    case 'ReplicaSet':
      return {
        headers: ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE'],
        rows: (r) => [r.metadata.name, String(r.spec.replicas ?? 1), String(r.status?.replicas || 0), String(r.status?.readyReplicas || 0), a(r)],
        wide: {
          headers: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
          rows: (r) => [containers(r.spec.template), images(r.spec.template), selectorString(fromLabelSelector(r.spec.selector))],
        },
      };
    case 'StatefulSet':
      return {
        headers: ['NAME', 'READY', 'AGE'],
        rows: (s) => [s.metadata.name, `${s.status?.readyReplicas || 0}/${s.spec.replicas ?? 1}`, a(s)],
        wide: { headers: ['CONTAINERS', 'IMAGES'], rows: (s) => [containers(s.spec.template), images(s.spec.template)] },
      };
    case 'DaemonSet':
      return {
        headers: ['NAME', 'DESIRED', 'CURRENT', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'NODE SELECTOR', 'AGE'],
        rows: (d) => [
          d.metadata.name,
          String(d.status?.desiredNumberScheduled ?? eligibleNodes(cl, d).length),
          String(d.status?.currentNumberScheduled || 0),
          String(d.status?.numberReady || 0),
          String(d.status?.updatedNumberScheduled || 0),
          String(d.status?.numberAvailable || 0),
          labelsString(d.spec.template.spec.nodeSelector).replace('<none>', '<none>'),
          a(d),
        ],
        wide: {
          headers: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
          rows: (d) => [containers(d.spec.template), images(d.spec.template), selectorString(fromLabelSelector(d.spec.selector))],
        },
      };
    case 'Job':
      return {
        headers: ['NAME', 'STATUS', 'COMPLETIONS', 'DURATION', 'AGE'],
        rows: (j) => [j.metadata.name, jobStatus(j), `${j.status?.succeeded || 0}/${j.spec.completions ?? 1}`, jobDuration(cl, j), a(j)],
        wide: {
          headers: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
          rows: (j) => [containers(j.spec.template), images(j.spec.template), selectorString(fromLabelSelector(j.spec.selector))],
        },
      };
    case 'CronJob':
      return {
        headers: ['NAME', 'SCHEDULE', 'TIMEZONE', 'SUSPEND', 'ACTIVE', 'LAST SCHEDULE', 'AGE'],
        rows: (c) => [
          c.metadata.name,
          c.spec.schedule,
          c.spec.timeZone || '<none>',
          c.spec.suspend ? 'True' : 'False',
          String((c.status?.active || []).length),
          c.status?.lastScheduleTime ? age(cl, c.status.lastScheduleTime) : '<none>',
          a(c),
        ],
        wide: {
          headers: ['CONTAINERS', 'IMAGES', 'SELECTOR'],
          rows: (c) => [containers(c.spec.jobTemplate?.spec?.template), images(c.spec.jobTemplate?.spec?.template), '<none>'],
        },
      };
    case 'Service':
      return {
        headers: ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'],
        rows: (s) => [s.metadata.name, s.spec.type, s.spec.clusterIP || '<none>', externalIp(s), svcPorts(s), a(s)],
        wide: { headers: ['SELECTOR'], rows: (s) => [labelsString(s.spec.selector)] },
      };
    case 'Endpoints':
      return { headers: ['NAME', 'ENDPOINTS', 'AGE'], rows: (e) => [e.metadata.name, endpointsString(e), a(e)] };
    case 'Ingress':
      return {
        headers: ['NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE'],
        rows: (i) => [
          i.metadata.name,
          i.spec?.ingressClassName || '<none>',
          (i.spec?.rules || []).map((r: Json) => r.host || '*').join(',') || '*',
          (i.status?.loadBalancer?.ingress || []).map((x: Json) => x.ip || x.hostname).join(','),
          i.spec?.tls?.length ? '80, 443' : '80',
          a(i),
        ],
      };
    case 'IngressClass':
      return { headers: ['NAME', 'CONTROLLER', 'PARAMETERS', 'AGE'], rows: (i) => [i.metadata.name, i.spec?.controller || '', '<none>', a(i)] };
    case 'ConfigMap':
      return {
        headers: ['NAME', 'DATA', 'AGE'],
        rows: (c) => [c.metadata.name, String(Object.keys(c.data || {}).length + Object.keys(c.binaryData || {}).length), a(c)],
      };
    case 'Secret':
      return { headers: ['NAME', 'TYPE', 'DATA', 'AGE'], rows: (s) => [s.metadata.name, s.type || 'Opaque', String(Object.keys(s.data || {}).length), a(s)] };
    case 'Namespace':
      return { headers: ['NAME', 'STATUS', 'AGE'], rows: (n) => [n.metadata.name, n.status?.phase || 'Active', a(n)] };
    case 'Node':
      return {
        headers: ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'],
        rows: (n) => [n.metadata.name, nodeStatus(cl, n), nodeRoles(n), a(n), n.status.nodeInfo.kubeletVersion],
        wide: {
          headers: ['INTERNAL-IP', 'EXTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION', 'CONTAINER-RUNTIME'],
          rows: (n) => [
            n.status.addresses[0].address,
            '<none>',
            n.status.nodeInfo.osImage,
            n.status.nodeInfo.kernelVersion,
            n.status.nodeInfo.containerRuntimeVersion,
          ],
        },
      };
    case 'PersistentVolumeClaim':
      return {
        headers: ['NAME', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS MODES', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'AGE'],
        rows: (p) => [
          p.metadata.name,
          p.metadata.deletionTimestamp ? 'Terminating' : p.status?.phase || 'Pending',
          p.spec.volumeName || '',
          p.status?.capacity?.storage || '',
          accessModes(p.status?.accessModes),
          p.spec.storageClassName ?? '',
          '<unset>',
          a(p),
        ],
        wide: { headers: ['VOLUMEMODE'], rows: (p) => [p.spec.volumeMode || 'Filesystem'] },
      };
    case 'PersistentVolume':
      return {
        headers: ['NAME', 'CAPACITY', 'ACCESS MODES', 'RECLAIM POLICY', 'STATUS', 'CLAIM', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'REASON', 'AGE'],
        rows: (p) => [
          p.metadata.name,
          p.spec.capacity?.storage || '',
          accessModes(p.spec.accessModes),
          p.spec.persistentVolumeReclaimPolicy,
          p.status?.phase || 'Available',
          p.spec.claimRef ? `${p.spec.claimRef.namespace}/${p.spec.claimRef.name}` : '',
          p.spec.storageClassName || '',
          '<unset>',
          '',
          a(p),
        ],
      };
    case 'StorageClass':
      return {
        headers: ['NAME', 'PROVISIONER', 'RECLAIMPOLICY', 'VOLUMEBINDINGMODE', 'ALLOWVOLUMEEXPANSION', 'AGE'],
        rows: (s) => [
          s.metadata.name + (s.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ? ' (default)' : ''),
          s.provisioner,
          s.reclaimPolicy || 'Delete',
          s.volumeBindingMode || 'Immediate',
          s.allowVolumeExpansion ? 'true' : 'false',
          a(s),
        ],
      };
    case 'ServiceAccount':
      return { headers: ['NAME', 'SECRETS', 'AGE'], rows: (s) => [s.metadata.name, String((s.secrets || []).length), a(s)] };
    case 'HorizontalPodAutoscaler':
      return {
        headers: ['NAME', 'REFERENCE', 'TARGETS', 'MINPODS', 'MAXPODS', 'REPLICAS', 'AGE'],
        rows: (h) => [
          h.metadata.name,
          `${h.spec.scaleTargetRef?.kind}/${h.spec.scaleTargetRef?.name}`,
          hpaTargets(h),
          String(h.spec.minReplicas ?? 1),
          String(h.spec.maxReplicas),
          String(h.status?.currentReplicas ?? 0),
          a(h),
        ],
      };
    case 'Application':
      return {
        headers: ['NAME', 'SYNC STATUS', 'HEALTH STATUS'],
        rows: (o) => [o.metadata.name, o.status?.sync?.status || 'Unknown', o.status?.health?.status || 'Unknown'],
        wide: { headers: ['REVISION', 'PROJECT'], rows: (o) => [o.status?.sync?.revision || '', o.spec?.project || ''] },
      };
    default:
      return { headers: ['NAME', 'AGE'], rows: (o) => [o.metadata.name, a(o)] };
  }
}

export interface PrintOptions {
  wide?: boolean;
  allNamespaces?: boolean;
  showLabels?: boolean;
  labelColumns?: string[];
  /** Prefix names with kind (get all, several types). */
  withKind?: boolean;
  noHeaders?: boolean;
}

export function printTable(cl: Cluster, kind: string, objs: Obj[], o: PrintOptions): string {
  const t = tableFor(cl, kind);
  const headers = [...t.headers];
  if (o.wide && t.wide) headers.push(...t.wide.headers);
  for (const l of o.labelColumns || []) headers.push(l.toUpperCase().split('/').pop()!);
  if (o.showLabels) headers.push('LABELS');
  if (o.allNamespaces && resourceByKind(kind)?.namespaced) headers.unshift('NAMESPACE');
  const rows: string[][] = o.noHeaders ? [] : [headers];
  for (const obj of objs) {
    const r = t.rows(obj);
    if (o.withKind) r[0] = `${qualifiedName(kind)}/${r[0]}`;
    if (o.wide && t.wide) r.push(...t.wide.rows(obj));
    for (const l of o.labelColumns || []) r.push(obj.metadata.labels?.[l] ?? '');
    if (o.showLabels) r.push(labelsString(obj.metadata.labels));
    if (o.allNamespaces && resourceByKind(kind)?.namespaced) r.unshift(obj.metadata.namespace);
    rows.push(r);
  }
  return pad(rows);
}

// ── -o yaml / json ───────────────────────────────────────────────────

function sortKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v === null || typeof v !== 'object') return v;
  const out: Json = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
  return out;
}

export function toYaml(v: Json): string {
  return stringify(sortKeys(v), { indentSeq: false, lineWidth: 0, minContentWidth: 0, defaultKeyType: 'PLAIN', aliasDuplicateObjects: false });
}

export function toJson(v: Json): string {
  return JSON.stringify(sortKeys(v), null, 4) + '\n';
}

export function asList(items: Obj[]): Obj {
  return { apiVersion: 'v1', items, kind: 'List', metadata: { resourceVersion: '' } };
}

export function objectName(o: Obj): string {
  return `${qualifiedName(o.kind)}/${o.metadata.name}`;
}

// ── jsonpath ─────────────────────────────────────────────────────────

type Seg = { key?: string; index?: number | '*'; filter?: { path: string[]; op: string; value: string } };

function parsePath(expr: string): Seg[] {
  const segs: Seg[] = [];
  let s = expr.trim();
  if (s.startsWith('$')) s = s.slice(1);
  const re = /\.([A-Za-z0-9_\-/]+|\*)|\[(\d+|\*|'[^']*'|"[^"]*")\]|\[\?\(@\.([\w.]+)\s*(==|!=)\s*(?:"([^"]*)"|'([^']*)'|(\S+?))\)\]|\['([^']+)'\]/g;
  let m: RegExpExecArray | null;
  let pos = 0;
  while ((m = re.exec(s))) {
    if (m.index !== pos) throw new Error(`unrecognized identifier ${s.slice(pos)}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) segs.push(m[1] === '*' ? { index: '*' } : { key: m[1] });
    else if (m[2] !== undefined) segs.push(/^\d+$/.test(m[2]) ? { index: parseInt(m[2], 10) } : m[2] === '*' ? { index: '*' } : { key: m[2].slice(1, -1) });
    else if (m[3] !== undefined) segs.push({ filter: { path: m[3].split('.'), op: m[4], value: m[5] ?? m[6] ?? m[7] } });
    else if (m[8] !== undefined) segs.push({ key: m[8] });
  }
  if (pos !== s.length && s.slice(pos).trim()) throw new Error(`unrecognized identifier ${s.slice(pos)}`);
  return segs;
}

export function evalPath(root: Json, expr: string): Json[] {
  let cur: Json[] = [root];
  for (const seg of parsePath(expr)) {
    const next: Json[] = [];
    for (const v of cur) {
      if (v === null || v === undefined) continue;
      if (seg.key !== undefined) {
        if (typeof v === 'object' && seg.key in v) next.push(v[seg.key]);
      } else if (seg.index === '*') {
        if (Array.isArray(v)) next.push(...v);
        else if (typeof v === 'object') next.push(...Object.values(v));
      } else if (typeof seg.index === 'number') {
        if (Array.isArray(v) && v[seg.index] !== undefined) next.push(v[seg.index]);
      } else if (seg.filter && Array.isArray(v)) {
        for (const it of v) {
          let x: Json = it;
          for (const k of seg.filter.path) x = x?.[k];
          const eq = String(x) === seg.filter.value;
          if (seg.filter.op === '==' ? eq : !eq) next.push(it);
        }
      }
    }
    cur = next;
  }
  return cur;
}

const scalar = (v: Json) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** kubectl -o jsonpath='{...}' (with range/end and literals). */
export function jsonpath(root: Json, template: string): string {
  const tokens: { text?: string; expr?: string }[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m.index > last) tokens.push({ text: template.slice(last, m.index) });
    tokens.push({ expr: m[1].trim() });
    last = re.lastIndex;
  }
  if (last < template.length) tokens.push({ text: template.slice(last) });
  const run = (toks: typeof tokens, ctx: Json): string => {
    let out = '';
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.text !== undefined) out += t.text;
      else if (t.expr!.startsWith('range ')) {
        let depth = 1;
        let j = i + 1;
        for (; j < toks.length; j++) {
          if (toks[j].expr?.startsWith('range ')) depth++;
          if (toks[j].expr === 'end' && --depth === 0) break;
        }
        for (const item of evalPath(ctx, t.expr!.slice(6))) out += run(toks.slice(i + 1, j), item);
        i = j;
      } else if (/^"(.*)"$/.test(t.expr!)) {
        out += JSON.parse(t.expr!);
      } else if (/^'(.*)'$/.test(t.expr!)) {
        out += t.expr!.slice(1, -1);
      } else {
        out += evalPath(ctx, t.expr!.startsWith('.') || t.expr!.startsWith('[') ? t.expr! : `.${t.expr!}`)
          .map(scalar)
          .join(' ');
      }
    }
    return out;
  };
  return run(tokens, root);
}

export function customColumns(objs: Obj[], spec: string, noHeaders = false): string {
  const cols = spec.split(',').map((c) => {
    const i = c.indexOf(':');
    if (i < 0) throw new Error(`expected <header>:<json-path-expr>, got ${c}`);
    return { header: c.slice(0, i), path: c.slice(i + 1) };
  });
  const rows = noHeaders ? [] : [cols.map((c) => c.header)];
  for (const o of objs)
    rows.push(
      cols.map(
        (c) =>
          evalPath(o, c.path.startsWith('.') || c.path.startsWith('{') ? c.path.replace(/^\{|\}$/g, '') : `.${c.path}`)
            .map(scalar)
            .join(',') || '<none>',
      ),
    );
  return pad(rows);
}

// ── kubectl top ──────────────────────────────────────────────────────

export function cpuMillis(cl: Cluster, p: Obj): number {
  return Math.round(podCpu(cl, p) * 1000);
}

export function secretValue(v: string) {
  return unbase64(v);
}

export function limitString(q: Json) {
  return q === undefined ? '' : String(q);
}

export const memMi = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}Mi`;

export function quantityPct(used: number, cap: string) {
  return `${Math.round((used / parseQuantity(cap)) * 100)}%`;
}

export { intOrPercent };
