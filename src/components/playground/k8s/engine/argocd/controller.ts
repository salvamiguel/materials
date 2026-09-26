// ArgoCD's application-controller. It only works while the
// argocd-application-controller pod is Running and Ready (it "runs inside"
// it, and logs there). The repo-server (UI side, asynchronous) leaves the
// rendered manifests in cl.s.argocd.manifests; this compares them with the
// cluster, computes sync and health, and syncs (automatically or when an
// operation is requested by the CLI or the UI).

import type { Cluster } from '../cluster';
import { LAST_APPLIED } from '../cluster';
import { ownerRef } from '../controllers/common';
import { resourceByKind, apiGroup } from '../resources';
import { ApiError, type ArgoState, type Obj, type RenderedDoc } from '../types';
import { clone, deepEqual, isObject } from '../util';
import { argo, componentUp, serverStartup } from './install';
import { healthOf, worst, type HealthStatus } from './health';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const TRACKING_LABEL = 'app.kubernetes.io/instance';
export const REFRESH_ANNOTATION = 'argocd.argoproj.io/refresh';
export const RESOURCES_FINALIZER = 'resources-finalizer.argocd.argoproj.io';
/** timeout.reconciliation (Git is polled this often). */
export const RECONCILE_MS = 180_000;
const SELF_HEAL_MS = 5_000;

export const appKey = (app: Obj) => `${app.metadata.namespace}/${app.metadata.name}`;

export interface ResourceStatus {
  group: string;
  version: string;
  kind: string;
  namespace?: string;
  name: string;
  status: 'Synced' | 'OutOfSync';
  health?: { status: HealthStatus; message?: string };
  requiresPruning?: boolean;
}

export interface Comparison {
  resources: ResourceStatus[];
  sync: 'Synced' | 'OutOfSync' | 'Unknown';
  health: HealthStatus;
  healthMessage?: string;
  /** Desired objects (with namespace and tracking label). */
  desired: RenderedDoc[];
  error?: string;
}

function destNs(app: Obj): string {
  return app.spec?.destination?.namespace || 'default';
}

function syncOptions(app: Obj, op?: Json): string[] {
  return [...(app.spec?.syncPolicy?.syncOptions || []), ...(op?.sync?.syncOptions || [])];
}

/** The desired objects: namespace defaulted to the destination, with the tracking label. */
export function desiredDocs(app: Obj, docs: RenderedDoc[]): RenderedDoc[] {
  const ns = destNs(app);
  return docs.map((d) => {
    const obj = clone(d.obj);
    obj.metadata ??= {};
    if (resourceByKind(obj.kind)?.namespaced !== false) obj.metadata.namespace ||= ns;
    obj.metadata.labels = { ...(obj.metadata.labels || {}), [TRACKING_LABEL]: app.metadata.name };
    return { ...d, obj };
  });
}

/** Every field of `want` has the same value in `have` (extra fields in `have` are fine). */
export function isSubset(want: Json, have: Json): boolean {
  if (Array.isArray(want)) return Array.isArray(have) && want.length === have.length && want.every((w, i) => isSubset(w, have[i]));
  if (isObject(want)) return isObject(have) && Object.entries(want).every(([k, v]) => v === undefined || isSubset(v, have[k]));
  if (typeof want === 'number' || typeof have === 'number') return String(want) === String(have);
  return want === have;
}

function normalized(cl: Cluster, obj: Obj): Obj {
  try {
    const p = cl.prepare(clone(obj), resourceByKind(obj.kind)?.namespaced === false ? undefined : obj.metadata.namespace);
    delete p.status;
    return p;
  } catch {
    return obj;
  }
}

function strip(o: Obj): Obj {
  const c = clone(o);
  delete c.status;
  if (c.metadata) {
    const keep: Json = { name: c.metadata.name, namespace: c.metadata.namespace };
    if (c.metadata.labels) keep.labels = c.metadata.labels;
    if (c.metadata.annotations) {
      keep.annotations = { ...c.metadata.annotations };
      delete keep.annotations[LAST_APPLIED];
      delete keep.annotations['deployment.kubernetes.io/revision'];
      if (!Object.keys(keep.annotations).length) delete keep.annotations;
    }
    c.metadata = keep;
  }
  return c;
}

export function liveOf(cl: Cluster, o: Obj): Obj | undefined {
  const t = resourceByKind(o.kind);
  if (!t) return undefined;
  return cl.get(o.kind, t.namespaced ? o.metadata?.namespace : undefined, o.metadata?.name);
}

/** Live objects tracked by the app that aren't in Git any more. */
function extras(cl: Cluster, app: Obj, desired: RenderedDoc[]): Obj[] {
  const keys = new Set(desired.map((d) => `${d.obj.kind}/${d.obj.metadata.namespace || ''}/${d.obj.metadata.name}`));
  const prev: ResourceStatus[] = app.status?.resources || [];
  const out: Obj[] = [];
  for (const r of prev) {
    const key = `${r.kind}/${r.namespace || ''}/${r.name}`;
    if (keys.has(key)) continue;
    const live = cl.get(r.kind, r.namespace, r.name);
    if (live && live.metadata.labels?.[TRACKING_LABEL] === app.metadata.name) out.push(live);
  }
  return out;
}

export function compare(cl: Cluster, app: Obj, docs: RenderedDoc[] | undefined, error?: string): Comparison {
  if (error || !docs) return { resources: app.status?.resources || [], sync: 'Unknown', health: app.status?.health?.status || 'Healthy', desired: [], error };
  const desired = desiredDocs(app, docs);
  const resources: ResourceStatus[] = [];
  let health: HealthStatus = 'Healthy';
  let healthMessage: string | undefined;
  for (const d of desired) {
    const live = liveOf(cl, d.obj);
    const inSync = !!live && isSubset(strip(normalized(cl, d.obj)), live);
    const h = healthOf(cl, live);
    if (h) {
      const next = worst(health, h.status);
      if (next !== health) healthMessage = h.message;
      health = next;
    }
    const gv = (resourceByKind(d.obj.kind)?.versions[0] || d.obj.apiVersion || 'v1').split('/');
    resources.push({
      group: apiGroup(d.obj.kind),
      version: gv[gv.length - 1],
      kind: d.obj.kind,
      namespace: resourceByKind(d.obj.kind)?.namespaced === false ? undefined : d.obj.metadata.namespace,
      name: d.obj.metadata.name,
      status: inSync ? 'Synced' : 'OutOfSync',
      ...(h ? { health: h } : {}),
    });
  }
  for (const x of extras(cl, app, desired)) {
    resources.push({
      group: apiGroup(x.kind),
      version: (x.apiVersion || 'v1').split('/').pop()!,
      kind: x.kind,
      namespace: x.metadata.namespace,
      name: x.metadata.name,
      status: 'OutOfSync',
      requiresPruning: true,
      ...(healthOf(cl, x) ? { health: healthOf(cl, x)! } : {}),
    });
  }
  const sync = resources.some((r) => r.status === 'OutOfSync') ? 'OutOfSync' : 'Synced';
  return { resources, sync, health, healthMessage, desired };
}

// Sync waves, then kinds in the order ArgoCD applies them.
const KIND_ORDER = [
  'Namespace',
  'ResourceQuota',
  'LimitRange',
  'ServiceAccount',
  'Secret',
  'ConfigMap',
  'StorageClass',
  'PersistentVolume',
  'PersistentVolumeClaim',
  'Service',
  'DaemonSet',
  'Pod',
  'ReplicaSet',
  'Deployment',
  'HorizontalPodAutoscaler',
  'StatefulSet',
  'Job',
  'CronJob',
  'Ingress',
  'Application',
];
const waveOf = (o: Obj) => parseInt(o.metadata?.annotations?.['argocd.argoproj.io/sync-wave'] || '0', 10) || 0;
const kindRank = (k: string) => (KIND_ORDER.indexOf(k) < 0 ? KIND_ORDER.length : KIND_ORDER.indexOf(k));

export interface SyncResult {
  phase: 'Succeeded' | 'Failed';
  message: string;
  resources: Json[];
}

/** Applies the desired state (and prunes). Used by auto-sync, the CLI and the UI. */
export function applyDesired(cl: Cluster, app: Obj, desired: RenderedDoc[], opts: { prune: boolean; dryRun?: boolean; options: string[] }): SyncResult {
  const results: Json[] = [];
  const errors: string[] = [];
  const ns = destNs(app);
  if (opts.options.includes('CreateNamespace=true') && !cl.get('Namespace', undefined, ns) && !opts.dryRun) {
    cl.create({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } }, ns);
    results.push({
      group: '',
      version: 'v1',
      kind: 'Namespace',
      name: ns,
      status: 'Synced',
      message: `namespace/${ns} created`,
      syncPhase: 'PreSync',
      hookPhase: 'Running',
    });
  }
  const ordered = [...desired].sort((a, b) => waveOf(a.obj) - waveOf(b.obj) || kindRank(a.obj.kind) - kindRank(b.obj.kind));
  for (const d of ordered) {
    const o = d.obj;
    const base = {
      group: apiGroup(o.kind),
      version: (o.apiVersion || 'v1').split('/').pop(),
      kind: o.kind,
      namespace: o.metadata.namespace,
      name: o.metadata.name,
      syncPhase: 'Sync',
    };
    try {
      if (opts.dryRun) {
        normalized(cl, o);
        results.push({ ...base, status: 'Synced', message: `${o.kind.toLowerCase()}/${o.metadata.name} configured (dry run)` });
        continue;
      }
      const r = cl.apply(o, o.metadata.namespace || ns, { file: d.file, line: d.line, via: `ArgoCD ${app.metadata.name}` });
      results.push({
        ...base,
        status: 'Synced',
        message: `${o.kind.toLowerCase()}${apiGroup(o.kind) ? '.' + apiGroup(o.kind) : ''}/${o.metadata.name} ${r.action}`,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String((e as Error).message);
      errors.push(msg);
      results.push({ ...base, status: 'SyncFailed', message: msg });
    }
  }
  const stale = extras(cl, app, desired);
  for (const x of stale) {
    const base = {
      group: apiGroup(x.kind),
      version: (x.apiVersion || 'v1').split('/').pop(),
      kind: x.kind,
      namespace: x.metadata.namespace,
      name: x.metadata.name,
      syncPhase: 'Sync',
    };
    if (opts.prune && !opts.dryRun) {
      cl.deleteObject(x);
      results.push({ ...base, status: 'Pruned', message: 'pruned' });
    } else results.push({ ...base, status: 'PruneSkipped', message: 'ignored (requires pruning)' });
  }
  if (errors.length) return { phase: 'Failed', message: `one or more objects failed to apply, reason: ${errors.join(', ')}`, resources: results };
  return { phase: 'Succeeded', message: `successfully synced (all tasks run)${opts.dryRun ? ' (dry run)' : ''}`, resources: results };
}

function state(cl: Cluster): ArgoState {
  return cl.s.argocd!;
}

/** Appends to the logs of the application-controller pod. */
export function controllerLog(cl: Cluster, level: string, msg: string, app?: Obj) {
  const a = argo(cl);
  if (!a) return;
  const pod = cl.list('Pod', a.namespace).find((p) => p.metadata.labels?.['app.kubernetes.io/name'] === 'argocd-application-controller');
  const rt = pod && cl.s.pods[pod.metadata.uid]?.containers['argocd-application-controller'];
  if (!rt) return;
  const t = new Date(cl.now).toISOString().replace(/\.\d+Z$/, 'Z');
  rt.logs.push({ t: cl.now, text: `time="${t}" level=${level} msg="${msg}"${app ? ` application=${appKey(app)}` : ''}` });
  if (rt.logs.length > 400) rt.logs.splice(0, rt.logs.length - 400);
}

/** Docs of a history entry (for rollbacks) or of the current render. */
function docsForRevision(cl: Cluster, app: Obj, revision: string | undefined): RenderedDoc[] | undefined {
  const a = state(cl);
  const m = a.manifests[appKey(app)];
  if (!revision || revision === m?.revision) return m?.docs;
  const hist = a.historyDocs[appKey(app)] || {};
  for (const h of [...(app.status?.history || [])].reverse()) if (h.revision === revision && hist[h.id]) return hist[h.id];
  return undefined;
}

function runOperation(cl: Cluster, app: Obj, op: Json, automated: boolean) {
  const a = state(cl);
  const key = appKey(app);
  const m = a.manifests[key];
  const revision: string = op.sync?.revision || m?.revision || '';
  const docs = docsForRevision(cl, app, revision);
  const started = cl.ts();
  const dryRun = !!op.sync?.dryRun;
  if (!automated) cl.emit(app, 'Normal', 'OperationStarted', `Initiated sync to '${revision.slice(0, 7)}'`, 'argocd-server');
  else cl.emit(app, 'Normal', 'OperationStarted', `Initiated automated sync to '${revision}'`, 'argocd-application-controller');
  controllerLog(cl, 'info', `Initiated ${automated ? 'automated ' : ''}sync to '${revision}'`, app);
  let result: SyncResult;
  if (!docs) result = { phase: 'Failed', message: `ComparisonError: manifests for revision ${revision.slice(0, 7)} are not available`, resources: [] };
  else {
    const prune = !!op.sync?.prune || (automated && !!app.spec?.syncPolicy?.automated?.prune);
    result = applyDesired(cl, app, desiredDocs(app, docs), { prune, dryRun, options: syncOptions(app, op) });
  }
  const finished = cl.ts();
  cl.mutate(app, (x) => {
    x.status ??= {};
    x.status.operationState = {
      operation: {
        sync: { revision, ...(op.sync?.prune ? { prune: true } : {}), ...(dryRun ? { dryRun: true } : {}), syncOptions: syncOptions(app, op) },
        initiatedBy: automated ? { automated: true } : op.initiatedBy || { username: 'admin' },
        retry: {},
      },
      phase: result.phase,
      message: result.message,
      startedAt: started,
      finishedAt: finished,
      syncResult: { resources: result.resources, revision, source: clone(app.spec.source) },
    };
    if (result.phase === 'Succeeded' && !dryRun) {
      const hist: Json[] = x.status.history || [];
      const id = (hist[hist.length - 1]?.id ?? -1) + 1;
      hist.push({
        id,
        revision,
        deployStartedAt: started,
        deployedAt: finished,
        source: clone(app.spec.source),
        initiatedBy: automated ? { automated: true } : { username: 'admin' },
      });
      const limit = app.spec.revisionHistoryLimit ?? 10;
      while (hist.length > limit) hist.shift();
      x.status.history = hist;
      const hd = (a.historyDocs[key] ??= {});
      hd[id] = docs || [];
      for (const k of Object.keys(hd)) if (!hist.some((h) => String(h.id) === k)) delete hd[k];
    }
    delete x.operation;
  });
  cl.emit(
    app,
    result.phase === 'Succeeded' ? 'Normal' : 'Warning',
    'OperationCompleted',
    `Sync operation to ${revision.slice(0, 7)} ${result.phase === 'Succeeded' ? 'succeeded' : `failed: ${result.message}`}`,
    'argocd-application-controller',
  );
  controllerLog(cl, result.phase === 'Succeeded' ? 'info' : 'warning', `sync/terminate complete${result.phase === 'Failed' ? `: ${result.message}` : ''}`, app);
  a.apps[key] = { ...(a.apps[key] || { comparedAt: 0 }), lastAutoSync: automated ? revision : a.apps[key]?.lastAutoSync, driftSince: undefined, comparedAt: 0 };
}

function reconcileApp(cl: Cluster, app: Obj) {
  const a = state(cl);
  const key = appKey(app);
  const bk = (a.apps[key] ??= { comparedAt: -Infinity });
  const m = a.manifests[key];
  // Deleting: the resources finalizer cascades.
  if (app.metadata.deletionTimestamp) {
    if ((app.metadata.finalizers || []).includes(RESOURCES_FINALIZER)) {
      for (const r of app.status?.resources || []) {
        const live = cl.get(r.kind, r.namespace, r.name);
        if (live && live.metadata.labels?.[TRACKING_LABEL] === app.metadata.name) cl.deleteObject(live);
      }
      controllerLog(cl, 'info', 'Deleted resources and removed finalizer', app);
    }
    delete a.manifests[key];
    delete a.apps[key];
    delete a.historyDocs[key];
    cl.remove(app);
    return;
  }
  if (app.operation) {
    runOperation(cl, app, app.operation, false);
    return;
  }
  if (cl.now - bk.comparedAt < 1000 && !(m && m.at > bk.comparedAt)) return;
  const fresh = !!m && m.at > bk.comparedAt;
  bk.comparedAt = cl.now;
  const c = compare(cl, app, m?.docs, m?.error);
  const prevSync = app.status?.sync?.status;
  const prevHealth = app.status?.health?.status;
  cl.mutate(app, (x) => {
    x.status ??= {};
    x.status.sync = {
      status: c.sync,
      ...(m ? { revision: m.revision } : {}),
      comparedTo: { source: clone(app.spec.source), destination: clone(app.spec.destination) },
    };
    x.status.health = { status: c.health, ...(c.healthMessage && c.health !== 'Healthy' ? { message: c.healthMessage } : {}) };
    if (!c.error) x.status.resources = c.resources;
    x.status.sourceType = m?.sourceType || 'Directory';
    x.status.summary = {
      images: [
        ...new Set(
          c.desired.flatMap((d) => [...(d.obj.spec?.template?.spec?.containers || []), ...(d.obj.spec?.containers || [])].map((ct: Json) => ct.image)),
        ),
      ].filter(Boolean),
    };
    if (fresh || !x.status.reconciledAt) x.status.reconciledAt = cl.ts();
    const cond = c.error ? [{ type: 'ComparisonError', message: c.error, lastTransitionTime: cl.ts() }] : [];
    if (cond.length) x.status.conditions = cond;
    else delete x.status.conditions;
  });
  if (fresh || prevSync !== c.sync || prevHealth !== c.health) controllerLog(cl, 'info', `Reconciliation completed`, app);
  if (prevSync && prevSync !== c.sync)
    cl.emit(app, 'Normal', 'ResourceUpdated', `Updated sync status: ${prevSync} -> ${c.sync}`, 'argocd-application-controller');
  if (prevHealth && prevHealth !== c.health)
    cl.emit(app, 'Normal', 'ResourceUpdated', `Updated health status: ${prevHealth} -> ${c.health}`, 'argocd-application-controller');

  // Automated sync: once per new revision, and again on drift with selfHeal.
  const auto = app.spec?.syncPolicy?.automated;
  if (!auto || c.error || !m || c.sync !== 'OutOfSync') {
    bk.driftSince = undefined;
    return;
  }
  const onlyPrune = c.resources.filter((r) => r.status === 'OutOfSync').every((r) => r.requiresPruning);
  if (onlyPrune && !auto.prune) return;
  if (bk.lastAutoSync !== m.revision) {
    runOperation(cl, app, { sync: { revision: m.revision } }, true);
    return;
  }
  if (auto.selfHeal) {
    bk.driftSince ??= cl.now;
    if (cl.now - bk.driftSince >= SELF_HEAL_MS) {
      controllerLog(cl, 'info', 'Self-healing: live state differs from Git', app);
      runOperation(cl, app, { sync: { revision: m.revision } }, true);
    }
  }
}

function render(template: Json, params: Record<string, string>): Json {
  const text = JSON.stringify(template).replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, k) => (k in params ? params[k] : `{{${k}}}`).replace(/"/g, '\\"'));
  return JSON.parse(text);
}

/** ApplicationSet controller: list and git-directories generators. */
function applicationSets(cl: Cluster) {
  const a = state(cl);
  if (!componentUp(cl, 'argocd-applicationset-controller')) return;
  for (const set of cl.list('ApplicationSet', a.namespace)) {
    const params: Record<string, string>[] = [];
    for (const g of set.spec?.generators || []) {
      if (g.list?.elements) params.push(...g.list.elements.map((e: Json) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, String(v)]))));
      if (g.git) params.push(...(a.appsetParams[appKey(set)] || []));
    }
    const want = new Set<string>();
    for (const p of params) {
      const t = render(set.spec.template || {}, p);
      const name = t.metadata?.name;
      if (!name) continue;
      want.add(name);
      const manifest = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'Application',
        metadata: { ...t.metadata, name, namespace: a.namespace, ownerReferences: [ownerRef(set)] },
        spec: t.spec,
      };
      const live = cl.get('Application', a.namespace, name);
      if (!live) {
        try {
          cl.create(manifest, a.namespace);
          cl.emit(set, 'Normal', 'created', `created Application "${name}"`, 'applicationset-controller');
        } catch (e) {
          cl.emit(set, 'Warning', 'ApplicationGenerationFromParamsError', (e as Error).message, 'applicationset-controller');
        }
      } else if (!deepEqual(live.spec, normalized(cl, manifest).spec)) {
        cl.mutate(live, (x) => (x.spec = normalized(cl, manifest).spec));
      }
    }
    for (const app of cl.children(set, 'Application')) {
      if (!want.has(app.metadata.name)) cl.deleteObject(app);
    }
  }
}

export function argocdController(cl: Cluster) {
  const a = argo(cl);
  if (!a) return;
  serverStartup(cl);
  if (!componentUp(cl, 'argocd-application-controller')) return;
  applicationSets(cl);
  for (const app of cl.list('Application', a.namespace)) reconcileApp(cl, app);
}

/** Requests from the CLI/UI. */
export function requestSync(cl: Cluster, app: Obj, opts: { prune?: boolean; dryRun?: boolean; revision?: string } = {}) {
  cl.mutate(app, (x) => {
    x.operation = {
      sync: { ...(opts.revision ? { revision: opts.revision } : {}), ...(opts.prune ? { prune: true } : {}), ...(opts.dryRun ? { dryRun: true } : {}) },
      initiatedBy: { username: 'admin' },
    };
  });
}

export function requestRefresh(cl: Cluster, app: Obj, hard = false) {
  cl.mutate(app, (x) => (x.metadata.annotations = { ...(x.metadata.annotations || {}), [REFRESH_ANNOTATION]: hard ? 'hard' : 'normal' }));
}
