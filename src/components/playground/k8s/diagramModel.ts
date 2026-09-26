// What the diagram draws: the objects of the cluster, their relations and a
// layout. Namespaces are horizontal lanes; inside, each connected group
// ("an app") is laid out left to right:
//   Ingress → Service/HPA → Workload → ReplicaSet/Job → Pods → PVC/Config → PV

import type { Cluster } from './engine/cluster';
import { podReady } from './engine/controllers/common';
import { deploymentReplicaSets, revisionOf } from './engine/controllers/deployment';
import { jobFinished } from './engine/controllers/job';
import { hpaTargets, nodeStatus, podStatus } from './engine/kubectl/printers';
import type { FaultKind, Obj } from './engine/types';
import { fromMap, matches } from './engine/util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Health = 'ok' | 'warn' | 'err' | 'off' | 'done';

export interface DNode {
  id: string;
  kind: string;
  name: string;
  namespace?: string;
  health: Health;
  status: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  compact?: boolean;
  faded?: boolean;
  fault?: FaultKind;
  /** Rollout in progress: updated / total desired. */
  progress?: { updated: number; old: number; desired: number };
  badge?: string;
  terminating?: boolean;
}

export type EdgeKind = 'owner' | 'select' | 'route' | 'storage' | 'config' | 'scale' | 'manage';

export interface DEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** false: the relation exists but doesn't carry traffic (pod not ready…). */
  live: boolean;
  d: string;
}

export interface Lane {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  empty?: boolean;
  health?: Health;
  status?: string;
  kind: 'Namespace' | 'Node';
  /** A namespace an ArgoCD Application will create (it doesn't exist yet). */
  virtual?: boolean;
}

export interface Diagram {
  nodes: DNode[];
  edges: DEdge[];
  lanes: Lane[];
  width: number;
  height: number;
}

export const SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease', 'local-path-storage', 'ingress-nginx', 'argocd'];

const COLUMN: Record<string, number> = {
  Application: -1,
  Ingress: 0,
  Service: 1,
  HorizontalPodAutoscaler: 1,
  Deployment: 2,
  StatefulSet: 2,
  DaemonSet: 2,
  CronJob: 2,
  Job: 2,
  ReplicaSet: 3,
  Pod: 4,
  PersistentVolumeClaim: 5,
  ConfigMap: 5,
  Secret: 5,
  PersistentVolume: 6,
};

const W = 164;
const H = 56;
const POD_W = 160;
const POD_H = 40;
const COL_GAP = 36;
const ROW_GAP = 10;
const GROUP_GAP = 26;
const LANE_PAD = 16;
const LANE_HEAD = 30;

function health(cl: Cluster, o: Obj): { health: Health; status: string; sub?: string; progress?: DNode['progress']; badge?: string } {
  switch (o.kind) {
    case 'Pod': {
      const st = podStatus(cl, o);
      const ready = podReady(o);
      const restarts = (o.status?.containerStatuses || []).reduce((n: number, c: Json) => n + (c.restartCount || 0), 0);
      const sub = `${(o.status?.containerStatuses || []).filter((c: Json) => c.ready).length}/${o.spec.containers.length}${restarts ? ` · ${restarts} reinicios` : ''}${o.spec.nodeName ? ` · ${o.spec.nodeName.replace('playground-', '')}` : ''}`;
      if (st === 'Terminating') return { health: 'off', status: st, sub };
      if (st === 'Completed' || st === 'Succeeded') return { health: 'done', status: 'Completed', sub };
      if (st === 'Running') return ready ? { health: 'ok', status: st, sub } : { health: 'warn', status: 'Running (no listo)', sub };
      if (/Pending|ContainerCreating|PodInitializing|^Init:\d/.test(st)) return { health: 'warn', status: st, sub };
      return { health: 'err', status: st, sub };
    }
    case 'Deployment': {
      const s = o.status || {};
      const want = o.spec.replicas ?? 1;
      const prog = (s.conditions || []).find((c: Json) => c.type === 'Progressing');
      const { newRS, old } = deploymentReplicaSets(cl, o);
      const oldPods = old.reduce((n, rs) => n + (rs.status?.replicas || 0), 0);
      const updated = newRS?.status?.replicas || 0;
      const progress = updated < want || oldPods > 0 ? { updated: s.updatedReplicas || 0, old: oldPods, desired: want } : undefined;
      const img = o.spec.template.spec.containers.map((c: Json) => c.image).join(', ');
      const status = `${s.readyReplicas || 0}/${want} listos`;
      if (prog?.reason === 'ProgressDeadlineExceeded') return { health: 'err', status: 'rollout atascado', sub: img, progress };
      if (o.spec.paused)
        return {
          health: 'warn',
          status: `${status} · pausado`,
          sub: img,
          progress,
          badge: `rev ${o.metadata.annotations?.['deployment.kubernetes.io/revision'] || 1}`,
        };
      const h: Health = (s.availableReplicas || 0) >= want && !progress ? 'ok' : (s.availableReplicas || 0) === 0 && want > 0 ? 'err' : 'warn';
      return { health: want === 0 ? 'off' : h, status, sub: img, progress, badge: `rev ${o.metadata.annotations?.['deployment.kubernetes.io/revision'] || 1}` };
    }
    case 'ReplicaSet': {
      const want = o.spec.replicas ?? 1;
      const ready = o.status?.readyReplicas || 0;
      const rev = revisionOf(o);
      return {
        health: want === 0 && !(o.status?.replicas || 0) ? 'off' : ready >= want ? 'ok' : 'warn',
        status: `${ready}/${want} listos`,
        sub: o.spec.template.spec.containers.map((c: Json) => c.image).join(', '),
        badge: rev ? `rev ${rev}` : undefined,
      };
    }
    case 'StatefulSet': {
      const want = o.spec.replicas ?? 1;
      const ready = o.status?.readyReplicas || 0;
      const s = o.status || {};
      const rolling = s.updateRevision && s.currentRevision !== s.updateRevision;
      return {
        health: want === 0 ? 'off' : ready >= want && !rolling ? 'ok' : ready === 0 ? 'err' : 'warn',
        status: `${ready}/${want} listos`,
        sub: o.spec.template.spec.containers.map((c: Json) => c.image).join(', '),
        progress: rolling ? { updated: s.updatedReplicas || 0, old: (s.replicas || 0) - (s.updatedReplicas || 0), desired: want } : undefined,
      };
    }
    case 'DaemonSet': {
      const s = o.status || {};
      const want = s.desiredNumberScheduled || 0;
      return {
        health: (s.numberReady || 0) >= want ? 'ok' : 'warn',
        status: `${s.numberReady || 0}/${want} nodos`,
        sub: o.spec.template.spec.containers.map((c: Json) => c.image).join(', '),
      };
    }
    case 'Job': {
      const f = jobFinished(o);
      const s = o.status || {};
      const sub = `${s.succeeded || 0}/${o.spec.completions ?? 1} completados${s.failed ? ` · ${s.failed} fallos` : ''}`;
      if (f === 'Complete') return { health: 'done', status: 'Complete', sub };
      if (f === 'Failed') return { health: 'err', status: 'Failed', sub };
      return { health: 'warn', status: o.spec.suspend ? 'Suspended' : 'Running', sub };
    }
    case 'CronJob':
      return {
        health: o.spec.suspend ? 'off' : 'ok',
        status: o.spec.suspend ? 'suspendido' : o.spec.schedule,
        sub: o.status?.lastScheduleTime ? `última: ${new Date(o.status.lastScheduleTime).toISOString().slice(11, 19)}` : 'sin ejecuciones',
      };
    case 'Service': {
      const ep = cl.get('Endpoints', o.metadata.namespace, o.metadata.name);
      const n = (ep?.subsets || []).reduce((c: number, s: Json) => c + (s.addresses || []).length, 0);
      const ports = (o.spec.ports || []).map((p: Json) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}`).join(',');
      const ip = o.spec.type === 'LoadBalancer' ? o.status?.loadBalancer?.ingress?.[0]?.ip || '<pending>' : o.spec.clusterIP;
      const hasSel = Object.keys(o.spec.selector || {}).length > 0;
      return {
        health: !hasSel ? 'ok' : n ? 'ok' : 'err',
        status: hasSel ? `${n} endpoint${n === 1 ? '' : 's'}` : 'sin selector',
        sub: `${o.spec.type} ${ip} :${ports}`,
      };
    }
    case 'Ingress': {
      const hosts = (o.spec?.rules || []).map((r: Json) => r.host || '*').join(', ');
      const addr = o.status?.loadBalancer?.ingress?.[0]?.ip;
      return { health: addr ? 'ok' : 'warn', status: addr ? addr : 'sin dirección', sub: hosts || '*' };
    }
    case 'HorizontalPodAutoscaler':
      return {
        health: 'ok',
        status: hpaTargets(o).replace('cpu: ', 'CPU '),
        sub: `${o.status?.currentReplicas ?? 0} réplicas (${o.spec.minReplicas ?? 1}–${o.spec.maxReplicas})`,
      };
    case 'PersistentVolumeClaim':
      return {
        health: o.metadata.deletionTimestamp ? 'off' : o.status?.phase === 'Bound' ? 'ok' : 'warn',
        status: o.metadata.deletionTimestamp ? 'Terminating' : o.status?.phase || 'Pending',
        sub: `${o.spec.resources?.requests?.storage || ''} ${o.spec.storageClassName || ''}`,
      };
    case 'PersistentVolume':
      return {
        health: o.status?.phase === 'Bound' ? 'ok' : o.status?.phase === 'Available' ? 'ok' : 'warn',
        status: o.status?.phase || 'Available',
        sub: `${o.spec.capacity?.storage || ''} ${o.spec.persistentVolumeReclaimPolicy}`,
      };
    case 'Application': {
      const sync = o.status?.sync?.status || 'Unknown';
      const h = o.status?.health?.status || 'Unknown';
      const op = o.operation || o.status?.operationState?.phase === 'Running';
      const err = (o.status?.conditions || []).some((c: Json) => /Error/.test(c.type));
      const src = o.spec?.source || o.spec?.sources?.[0] || {};
      const rev = o.status?.sync?.revision ? ` @ ${String(o.status.sync.revision).slice(0, 7)}` : '';
      return {
        health: err || h === 'Degraded' ? 'err' : op ? 'warn' : sync === 'Synced' && h === 'Healthy' ? 'ok' : h === 'Suspended' ? 'off' : 'warn',
        status: op ? 'Syncing…' : err ? 'ComparisonError' : `${sync} · ${h}`,
        sub: `${src.path || src.chart || '.'}${rev}`,
        badge: o.spec?.syncPolicy?.automated ? 'auto' : 'manual',
      };
    }
    case 'ConfigMap':
    case 'Secret': {
      const n = Object.keys(o.data || {}).length;
      return { health: 'ok', status: `${n} clave${n === 1 ? '' : 's'}`, sub: o.kind === 'Secret' ? o.type : undefined };
    }
  }
  return { health: 'ok', status: '' };
}

function podRefs(pod: Obj): { cm: Set<string>; secret: Set<string>; pvc: Set<string> } {
  const cm = new Set<string>();
  const secret = new Set<string>();
  const pvc = new Set<string>();
  const spec = pod.spec || {};
  for (const v of spec.volumes || []) {
    if (v.configMap) cm.add(v.configMap.name);
    if (v.secret) secret.add(v.secret.secretName);
    if (v.persistentVolumeClaim) pvc.add(v.persistentVolumeClaim.claimName);
    for (const s of v.projected?.sources || []) {
      if (s.configMap) cm.add(s.configMap.name);
      if (s.secret) secret.add(s.secret.name);
    }
  }
  for (const c of [...(spec.containers || []), ...(spec.initContainers || [])]) {
    for (const e of c.env || []) {
      if (e.valueFrom?.configMapKeyRef) cm.add(e.valueFrom.configMapKeyRef.name);
      if (e.valueFrom?.secretKeyRef) secret.add(e.valueFrom.secretKeyRef.name);
    }
    for (const ef of c.envFrom || []) {
      if (ef.configMapRef) cm.add(ef.configMapRef.name);
      if (ef.secretRef) secret.add(ef.secretRef.name);
    }
  }
  return { cm, secret, pvc };
}

function templateOf(o: Obj): Obj | undefined {
  if (o.kind === 'Pod') return o;
  if (o.kind === 'CronJob') return o.spec?.jobTemplate?.spec?.template;
  return o.spec?.template;
}

function curve(a: DNode, b: DNode): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  if (x2 <= x1) {
    // Same column (rare): go around on the right.
    const r = Math.max(a.x + a.w, b.x + b.w) + 24;
    return `M${x1},${y1} C${r},${y1} ${r},${y2} ${b.x + b.w},${y2}`;
  }
  const dx = Math.max(24, (x2 - x1) * 0.5);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export function buildDiagram(cl: Cluster, opts: { showSystem: boolean }): Diagram {
  const visibleNs = cl
    .list('Namespace')
    .map((n) => n.metadata.name)
    .filter((n) => opts.showSystem || !SYSTEM_NAMESPACES.includes(n));
  const kinds = Object.keys(COLUMN).filter((k) => k !== 'PersistentVolume' && k !== 'Application');
  const objs: Obj[] = [];
  // ArgoCD Applications live in argocd but are drawn next to what they manage,
  // in their destination namespace (a virtual lane if it doesn't exist yet).
  const apps = cl.s.argocd?.installed ? cl.list('Application') : [];
  const destOf = (a: Obj): string => a.spec?.destination?.namespace || 'default';
  for (const a of apps) if (!visibleNs.includes(destOf(a))) visibleNs.push(destOf(a));
  for (const k of kinds) {
    for (const o of cl.list(k)) {
      if (!visibleNs.includes(o.metadata.namespace)) continue;
      if (k === 'Service' && o.metadata.name === 'kubernetes' && o.metadata.namespace === 'default') continue;
      if (k === 'ConfigMap' && o.metadata.name === 'kube-root-ca.crt') continue;
      if (k === 'Secret' && o.type === 'helm.sh/release.v1') continue;
      if (k === 'ReplicaSet') {
        // Old revisions without pods: only the latest two, faded.
        const owner = cl.controllerOf(o);
        if (owner && !(o.spec.replicas || 0) && !cl.children(o, 'Pod').length) {
          const idle = cl
            .children(owner, 'ReplicaSet')
            .filter((r) => !(r.spec.replicas || 0) && !cl.children(r, 'Pod').length)
            .sort((a, b) => revisionOf(b) - revisionOf(a));
          if (idle.indexOf(o) > 1) continue;
        }
      }
      objs.push(o);
    }
  }
  // PVs bound to visible claims (and loose ones when showing everything).
  for (const pv of cl.list('PersistentVolume')) {
    const ref = pv.spec.claimRef;
    if (ref ? visibleNs.includes(ref.namespace) : opts.showSystem) objs.push(pv);
  }
  objs.push(...apps);
  const byUid = new Map(objs.map((o) => [o.metadata.uid, o]));
  const nsOf = (o: Obj) => (o.kind === 'Application' ? destOf(o) : (o.metadata.namespace ?? o.spec?.claimRef?.namespace ?? 'default'));

  // Relations.
  const rel: { from: Obj; to: Obj; kind: EdgeKind; live: boolean }[] = [];
  const add = (from: Obj | undefined, to: Obj | undefined, kind: EdgeKind, live = true) => {
    if (from && to && byUid.has(from.metadata.uid) && byUid.has(to.metadata.uid) && from !== to) rel.push({ from, to, kind, live });
  };
  const pods = objs.filter((o) => o.kind === 'Pod');
  for (const o of objs) {
    const owner = cl.controllerOf(o);
    if (owner && byUid.has(owner.metadata.uid)) add(owner, o, 'owner', !o.metadata.deletionTimestamp);
    if (o.kind === 'Service' && Object.keys(o.spec.selector || {}).length) {
      const sel = fromMap(o.spec.selector);
      for (const p of pods) if (p.metadata.namespace === o.metadata.namespace && matches(sel, p.metadata.labels)) add(o, p, 'select', podReady(p));
    }
    if (o.kind === 'Ingress') {
      const names = new Set<string>();
      for (const r of o.spec?.rules || []) for (const p of r.http?.paths || []) if (p.backend?.service?.name) names.add(p.backend.service.name);
      if (o.spec?.defaultBackend?.service?.name) names.add(o.spec.defaultBackend.service.name);
      for (const n of names) add(o, cl.get('Service', o.metadata.namespace, n), 'route');
    }
    if (o.kind === 'Application') {
      // Only the top of each managed tree (the rest hangs from its owner).
      for (const r of o.status?.resources || []) {
        const live = cl.get(r.kind, r.namespace, r.name);
        if (live && !cl.controllerOf(live)) add(o, live, 'manage', r.status === 'Synced');
      }
    }
    if (o.kind === 'HorizontalPodAutoscaler') add(o, cl.get(o.spec.scaleTargetRef?.kind, o.metadata.namespace, o.spec.scaleTargetRef?.name), 'scale');
    if (o.kind === 'PersistentVolumeClaim' && o.spec.volumeName) add(o, cl.get('PersistentVolume', undefined, o.spec.volumeName), 'storage');
    // Config and storage: from the top-most workload, or the pod when standalone.
    const tpl = templateOf(o);
    const isTop =
      o.kind !== 'Pod'
        ? ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob'].includes(o.kind) || (o.kind === 'Job' && !cl.controllerOf(o))
        : !cl.controllerOf(o);
    if (tpl && isTop) {
      const refs = podRefs(tpl);
      for (const n of refs.cm) add(o, cl.get('ConfigMap', o.metadata.namespace, n), 'config');
      for (const n of refs.secret) add(o, cl.get('Secret', o.metadata.namespace, n), 'config');
    }
    if (o.kind === 'Pod') for (const n of podRefs(o).pvc) add(o, cl.get('PersistentVolumeClaim', o.metadata.namespace, n), 'storage');
  }

  // Connected groups (union-find), per namespace.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const o of objs) parent.set(o.metadata.uid, o.metadata.uid);
  for (const r of rel) parent.set(find(r.from.metadata.uid), find(r.to.metadata.uid));

  // Columns actually used.
  const used = [...new Set(objs.map((o) => COLUMN[o.kind]))].sort((a, b) => a - b);
  const colX = new Map<number, number>();
  used.forEach((c, i) => colX.set(c, LANE_PAD + i * (W + COL_GAP)));
  const width = LANE_PAD * 2 + Math.max(1, used.length) * (W + COL_GAP) - COL_GAP;

  const nodes: DNode[] = [];
  const lanes: Lane[] = [];
  let y = 0;
  const nsList = [...visibleNs].sort((a, b) =>
    a === 'default'
      ? -1
      : b === 'default'
        ? 1
        : SYSTEM_NAMESPACES.includes(a) === SYSTEM_NAMESPACES.includes(b)
          ? a.localeCompare(b)
          : SYSTEM_NAMESPACES.includes(a)
            ? 1
            : -1,
  );
  for (const ns of nsList) {
    const inNs = objs.filter((o) => nsOf(o) === ns);
    const nsObj = cl.get('Namespace', undefined, ns);
    if (!inNs.length && ns !== 'default' && !nsObj?.metadata.deletionTimestamp && SYSTEM_NAMESPACES.includes(ns)) continue;
    const laneY = y;
    y += LANE_HEAD;
    const groups = new Map<string, Obj[]>();
    for (const o of inNs) {
      const g = find(o.metadata.uid);
      groups.set(g, [...(groups.get(g) || []), o]);
    }
    // Groups with workloads first, oldest first.
    const ordered = [...groups.values()].sort((a, b) => {
      const score = (g: Obj[]) => (g.some((o) => COLUMN[o.kind] === 2) ? 0 : g.some((o) => o.kind === 'Pod') ? 1 : 2);
      const first = (g: Obj[]) => Math.min(...g.map((o) => Date.parse(o.metadata.creationTimestamp)));
      return score(a) - score(b) || first(a) - first(b) || a[0].metadata.name.localeCompare(b[0].metadata.name);
    });
    for (const g of ordered) {
      const cols = new Map<number, Obj[]>();
      for (const o of g) cols.set(COLUMN[o.kind], [...(cols.get(COLUMN[o.kind]) || []), o]);
      // Order: workloads by age; RS newest revision first; pods following their owner's order.
      const ownerRank = new Map<string, number>();
      for (const c of [2, 3]) {
        const list = cols.get(c) || [];
        list.sort((a, b) =>
          a.kind === 'ReplicaSet' && b.kind === 'ReplicaSet'
            ? revisionOf(b) - revisionOf(a)
            : Date.parse(a.metadata.creationTimestamp) - Date.parse(b.metadata.creationTimestamp) || a.metadata.name.localeCompare(b.metadata.name),
        );
        list.forEach((o, i) => ownerRank.set(o.metadata.uid, c * 1000 + i));
      }
      const podRank = (p: Obj) => {
        const own = cl.controllerOf(p);
        return own ? (ownerRank.get(own.metadata.uid) ?? 9999) : 9999;
      };
      cols.get(4)?.sort((a, b) => podRank(a) - podRank(b) || a.metadata.name.localeCompare(b.metadata.name));
      for (const c of [-1, 0, 1, 5, 6]) cols.get(c)?.sort((a, b) => a.kind.localeCompare(b.kind) || a.metadata.name.localeCompare(b.metadata.name));
      const heightOf = (c: number) => (cols.get(c) || []).reduce((h, o) => h + (o.kind === 'Pod' ? POD_H : H) + ROW_GAP, -ROW_GAP);
      const gh = Math.max(...[...cols.keys()].map(heightOf));
      for (const [c, list] of cols) {
        let cy = y + (gh - heightOf(c)) / 2;
        for (const o of list) {
          const hh = health(cl, o);
          const compact = o.kind === 'Pod';
          const n: DNode = {
            id: o.metadata.uid,
            kind: o.kind,
            name: o.metadata.name,
            namespace: o.metadata.namespace,
            ...hh,
            x: colX.get(c)! + (compact ? (W - POD_W) / 2 : 0),
            y: cy,
            w: compact ? POD_W : W,
            h: compact ? POD_H : H,
            compact,
            faded: (o.kind === 'ReplicaSet' && !(o.spec.replicas || 0) && !(o.status?.replicas || 0)) || !!o.metadata.deletionTimestamp,
            fault: cl.s.faults[o.metadata.uid],
            terminating: !!o.metadata.deletionTimestamp,
          };
          nodes.push(n);
          cy += n.h + ROW_GAP;
        }
      }
      y += gh + GROUP_GAP;
    }
    if (!ordered.length) y += 40;
    y += LANE_PAD - GROUP_GAP + (ordered.length ? 0 : GROUP_GAP);
    lanes.push({
      id: nsObj?.metadata.uid || ns,
      label: ns,
      x: 0,
      y: laneY,
      w: width,
      h: y - laneY,
      empty: !ordered.length,
      kind: 'Namespace',
      health: nsObj?.metadata.deletionTimestamp ? 'off' : 'ok',
      status: nsObj?.metadata.deletionTimestamp ? 'Terminating' : nsObj ? undefined : '(todavía no existe: ArgoCD lo creará al sincronizar)',
      virtual: !nsObj,
    });
    y += 14;
  }
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges: DEdge[] = rel
    .filter((r) => pos.has(r.from.metadata.uid) && pos.has(r.to.metadata.uid))
    .map((r) => ({
      id: `${r.kind}:${r.from.metadata.uid}:${r.to.metadata.uid}`,
      from: r.from.metadata.uid,
      to: r.to.metadata.uid,
      kind: r.kind,
      live: r.live,
      d: curve(pos.get(r.from.metadata.uid)!, pos.get(r.to.metadata.uid)!),
    }));
  return { nodes, edges, lanes, width, height: Math.max(y - 14, 120) };
}

/** Pods by node: one lane per node, pods in rows. */
export function buildNodesView(cl: Cluster, opts: { showSystem: boolean }): Diagram {
  const nodes: DNode[] = [];
  const lanes: Lane[] = [];
  const perRow = 4;
  const colW = POD_W + 12;
  const width = LANE_PAD * 2 + perRow * colW - 12;
  let y = 0;
  for (const node of cl.list('Node')) {
    const down = cl.s.downNodes[node.metadata.uid] !== undefined;
    const pods = cl.list('Pod').filter((p) => p.spec.nodeName === node.metadata.name && (opts.showSystem || !SYSTEM_NAMESPACES.includes(p.metadata.namespace)));
    pods.sort((a, b) => a.metadata.namespace.localeCompare(b.metadata.namespace) || a.metadata.name.localeCompare(b.metadata.name));
    const st = nodeStatus(cl, node);
    pods.forEach((p, i) => {
      const hh = health(cl, p);
      nodes.push({
        id: p.metadata.uid,
        kind: 'Pod',
        name: p.metadata.name,
        namespace: p.metadata.namespace,
        ...hh,
        health: down && hh.health !== 'off' ? 'err' : hh.health,
        status: down && !p.metadata.deletionTimestamp ? 'Unknown (nodo caído)' : hh.status,
        x: LANE_PAD + (i % perRow) * colW,
        y: y + LANE_HEAD + 4 + Math.floor(i / perRow) * (POD_H + ROW_GAP),
        w: POD_W,
        h: POD_H,
        compact: true,
        faded: !!p.metadata.deletionTimestamp,
        fault: cl.s.faults[p.metadata.uid],
        terminating: !!p.metadata.deletionTimestamp,
      });
    });
    const h = LANE_HEAD + 4 + Math.max(1, Math.ceil(pods.length / perRow)) * (POD_H + ROW_GAP) + LANE_PAD - ROW_GAP;
    lanes.push({
      id: node.metadata.uid,
      label: node.metadata.name,
      x: 0,
      y,
      w: width,
      h,
      empty: !pods.length,
      kind: 'Node',
      health: down ? 'err' : node.spec.unschedulable ? 'warn' : 'ok',
      status: `${st} · ${node.status.addresses[0].address}${node.spec.taints?.some((t: Json) => t.key === 'node-role.kubernetes.io/control-plane') ? ' · control-plane' : ''}`,
    });
    y += h + 14;
  }
  return { nodes, edges: [], lanes, width, height: Math.max(y - 14, 120) };
}
