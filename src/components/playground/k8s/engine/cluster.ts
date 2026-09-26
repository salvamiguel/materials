// The simulated API server: an in-memory object store with Kubernetes
// semantics (uids, resourceVersions, generations, owner references, garbage
// collection, events) plus the clock that drives the controllers.

import { applyDefaults } from './defaults';
import { checkSchema } from './schema';
import { qualifiedName, resolveResource, resourceByKind } from './resources';
import { ApiError, type ClusterState, type KEvent, type Obj, type Source } from './types';
import { validateObject } from './validate';
import { base64, clone, deepEqual, nextRandom, randomSuffix, stableJson, uuid } from './util';
import { runControllers } from './controllers';
import { bootstrap } from './bootstrap';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const STEP = 250;
export const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';

export interface ApplyResult {
  obj: Obj;
  action: 'created' | 'configured' | 'unchanged' | 'replaced';
}

export interface DeleteOptions {
  cascade?: 'background' | 'orphan' | 'foreground';
  /** Seconds; 0 with force removes the pod at once. */
  gracePeriod?: number;
  force?: boolean;
}

const CLUSTER_SCOPED = (kind: string) => resourceByKind(kind)?.namespaced === false;

export class Cluster {
  constructor(public s: ClusterState) {}

  static create(now = Date.UTC(2026, 8, 26, 9, 0, 0), seed = 42): Cluster {
    const c = new Cluster({
      version: 1,
      now,
      rng: seed,
      rv: 1000,
      eventSeq: 0,
      objects: {},
      events: [],
      pods: {},
      faults: {},
      load: {},
      sources: {},
      namespace: 'default',
      images: {},
      portForwards: [],
      rr: {},
      helm: [],
      progress: {},
      downNodes: {},
      hpa: {},
    });
    bootstrap(c);
    return c;
  }

  static fromJSON(json: string): Cluster {
    const s = JSON.parse(json) as ClusterState;
    if (s.version !== 1 || !s.objects) throw new Error('estado no válido');
    return new Cluster(s);
  }

  toJSON(): string {
    return JSON.stringify(this.s);
  }

  // ── time ──

  get now() {
    return this.s.now;
  }

  ts(ms = this.s.now): string {
    return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  }

  /** Advances the simulated clock, running the controllers every STEP ms. */
  advance(ms: number) {
    let left = ms;
    while (left > 0) {
      const d = Math.min(STEP, left);
      this.s.now += d;
      left -= d;
      runControllers(this);
    }
  }

  random() {
    return nextRandom(this.s);
  }

  suffix(n = 5) {
    return randomSuffix(this.s, n);
  }

  // ── store ──

  key(kind: string, ns: string | undefined, name: string) {
    return `${kind}/${CLUSTER_SCOPED(kind) ? '' : ns || 'default'}/${name}`;
  }

  get(kind: string, ns: string | undefined, name: string): Obj | undefined {
    return this.s.objects[this.key(kind, ns, name)];
  }

  /** Objects of a kind; `ns` undefined means all namespaces. */
  list(kind: string, ns?: string): Obj[] {
    const out: Obj[] = [];
    const prefix = `${kind}/`;
    for (const [k, o] of Object.entries(this.s.objects)) {
      if (!k.startsWith(prefix)) continue;
      if (ns !== undefined && !CLUSTER_SCOPED(kind) && o.metadata.namespace !== ns) continue;
      out.push(o);
    }
    return out.sort((a, b) => (a.metadata.namespace || '').localeCompare(b.metadata.namespace || '') || a.metadata.name.localeCompare(b.metadata.name));
  }

  byUid(uid: string): Obj | undefined {
    for (const o of Object.values(this.s.objects)) if (o.metadata.uid === uid) return o;
    return undefined;
  }

  /** Objects controlled by `owner` (optionally of one kind). */
  children(owner: Obj, kind?: string): Obj[] {
    const uid = owner.metadata.uid;
    const out: Obj[] = [];
    for (const [k, o] of Object.entries(this.s.objects)) {
      if (kind && !k.startsWith(kind + '/')) continue;
      if ((o.metadata.ownerReferences || []).some((r: Json) => r.uid === uid)) out.push(o);
    }
    return out;
  }

  controllerOf(o: Obj): Obj | undefined {
    const ref = (o.metadata.ownerReferences || []).find((r: Json) => r.controller) || o.metadata.ownerReferences?.[0];
    if (!ref) return undefined;
    const owner = this.get(ref.kind, o.metadata.namespace, ref.name);
    return owner && owner.metadata.uid === ref.uid ? owner : undefined;
  }

  /** Low-level create, used by controllers (no validation). */
  put(obj: Obj): Obj {
    const md = obj.metadata;
    if (!md.name && md.generateName) md.name = md.generateName + this.suffix();
    if (CLUSTER_SCOPED(obj.kind)) delete md.namespace;
    else md.namespace ??= 'default';
    md.uid ??= uuid(this.s);
    md.creationTimestamp ??= this.ts();
    md.resourceVersion = String(++this.s.rv);
    if (['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'HorizontalPodAutoscaler', 'Ingress', 'PersistentVolumeClaim', 'Pod', 'Service', 'Namespace'].includes(obj.kind)) {
      if (obj.kind !== 'Pod' && obj.kind !== 'Service' && obj.kind !== 'Namespace' && obj.kind !== 'PersistentVolumeClaim') md.generation ??= 1;
    }
    this.s.objects[this.key(obj.kind, md.namespace, md.name)] = obj;
    return obj;
  }

  /** Low-level write of an object already in the store. Bumps resourceVersion only if it changed. */
  update(obj: Obj, before?: string): Obj {
    const k = this.key(obj.kind, obj.metadata.namespace, obj.metadata.name);
    if (before === undefined || before !== JSON.stringify(obj)) obj.metadata.resourceVersion = String(++this.s.rv);
    this.s.objects[k] = obj;
    return obj;
  }

  /** Runs `fn` on the object and bumps its resourceVersion if anything changed. */
  mutate(obj: Obj, fn: (o: Obj) => void): Obj {
    const before = JSON.stringify(obj);
    fn(obj);
    if (JSON.stringify(obj) !== before) obj.metadata.resourceVersion = String(++this.s.rv);
    return obj;
  }

  remove(obj: Obj) {
    delete this.s.objects[this.key(obj.kind, obj.metadata.namespace, obj.metadata.name)];
    const uid = obj.metadata.uid;
    delete this.s.pods[uid];
    delete this.s.faults[uid];
    delete this.s.load[uid];
    delete this.s.sources[uid];
    delete this.s.progress[uid];
    delete this.s.hpa[uid];
    this.s.rv++;
  }

  // ── events ──

  emit(obj: Obj, type: KEvent['type'], reason: string, message: string, source: string, fieldPath?: string) {
    const ns = obj.metadata.namespace || 'default';
    const uid = obj.metadata.uid;
    const prev = this.s.events.find((e) => e.involved.uid === uid && e.reason === reason && e.message === message);
    if (prev) {
      prev.count++;
      prev.last = this.s.now;
      this.s.rv++;
      return;
    }
    this.s.events.push({
      id: ++this.s.eventSeq,
      namespace: ns,
      involved: { kind: obj.kind, name: obj.metadata.name, uid, namespace: obj.metadata.namespace, fieldPath },
      type,
      reason,
      message,
      source,
      count: 1,
      first: this.s.now,
      last: this.s.now,
    });
    if (this.s.events.length > 600) this.s.events.splice(0, this.s.events.length - 500);
    this.s.rv++;
  }

  eventsFor(obj: Obj): KEvent[] {
    return this.s.events.filter((e) => e.involved.uid === obj.metadata.uid).sort((a, b) => a.last - b.last);
  }

  // ── API (what kubectl talks to) ──

  namespaceOf(manifest: Obj, fallback: string): string | undefined {
    if (CLUSTER_SCOPED(manifest.kind)) return undefined;
    return manifest.metadata?.namespace || fallback;
  }

  /** Checks a manifest and returns the defaulted object to store. Throws ApiError. */
  prepare(manifest: Obj, ns: string | undefined): Obj {
    const type = resourceByKind(manifest.kind);
    if (!type) throw new ApiError('NotFound', `no matches for kind "${manifest.kind}" in version "${manifest.apiVersion}"`);
    if (!type.versions.includes(manifest.apiVersion)) {
      throw new ApiError('NotFound', `no matches for kind "${manifest.kind}" in version "${manifest.apiVersion}"`);
    }
    if (type.readOnly && manifest.kind === 'Node') throw new ApiError('Forbidden', `nodes are managed by the playground`);
    const schemaErrs = checkSchema(manifest.kind, manifest);
    if (schemaErrs.length) {
      const unknown = schemaErrs.filter((e) => e.message.startsWith('unknown field'));
      const msg = unknown.length ? `strict decoding error: ${unknown.map((e) => e.message).join(', ')}` : `json: ${schemaErrs[0].message}`;
      throw new ApiError('BadRequest', `${manifest.kind} in version "${manifest.apiVersion.split('/').pop()}" cannot be handled as a ${manifest.kind}: ${msg}`);
    }
    const obj = clone(manifest);
    obj.metadata ??= {};
    if (ns !== undefined) obj.metadata.namespace = ns;
    else delete obj.metadata.namespace;
    if (obj.kind === 'Secret' && obj.stringData) {
      obj.data = { ...(obj.data || {}) };
      for (const [k, v] of Object.entries(obj.stringData)) obj.data[k] = base64(String(v));
      delete obj.stringData;
    }
    applyDefaults(obj);
    const errs = validateObject(obj);
    if (errs.length) throw new ApiError('Invalid', `The ${obj.kind} "${obj.metadata.name ?? ''}" is invalid: ${errs.length > 1 ? `\n* ${errs.join('\n* ')}` : errs[0]}`);
    if (ns !== undefined) {
      const nsObj = this.get('Namespace', undefined, ns);
      if (!nsObj) throw new ApiError('NotFound', `namespaces "${ns}" not found`);
      if (nsObj.metadata.deletionTimestamp && !this.get(obj.kind, ns, obj.metadata.name)) {
        throw new ApiError('Forbidden', `${type.plural} "${obj.metadata.name}" is forbidden: unable to create new content in namespace ${ns} because it is being terminated`);
      }
    }
    return obj;
  }

  /** kubectl create. */
  create(manifest: Obj, defaultNs: string, source?: Source): Obj {
    const ns = this.namespaceOf(manifest, defaultNs);
    const obj = this.prepare(manifest, ns);
    if (this.get(obj.kind, ns, obj.metadata.name)) {
      throw new ApiError('AlreadyExists', `${resourceByKind(obj.kind)!.plural}${qualifiedName(obj.kind).includes('.') ? '.' + qualifiedName(obj.kind).split('.').slice(1).join('.') : ''} "${obj.metadata.name}" already exists`);
    }
    this.admit(obj);
    this.put(obj);
    if (source) this.s.sources[obj.metadata.uid] = source;
    return obj;
  }

  /** kubectl apply: create, or merge into what's live keeping what controllers own. */
  apply(manifest: Obj, defaultNs: string, source?: Source): ApplyResult {
    const ns = this.namespaceOf(manifest, defaultNs);
    const live = manifest.metadata?.name ? this.get(manifest.kind, ns, manifest.metadata.name) : undefined;
    const lastApplied = JSON.stringify(stripForLastApplied(manifest, ns)) + '\n';
    if (!live) {
      const obj = this.prepare(manifest, ns);
      obj.metadata.annotations = { ...(obj.metadata.annotations || {}), [LAST_APPLIED]: lastApplied };
      this.admit(obj);
      this.put(obj);
      if (source) this.s.sources[obj.metadata.uid] = source;
      return { obj, action: 'created' };
    }
    if (source) this.s.sources[live.metadata.uid] = source;
    const prev = live.metadata.annotations?.[LAST_APPLIED];
    let prevManifest: Obj | undefined;
    try {
      prevManifest = prev ? JSON.parse(prev) : undefined;
    } catch {
      prevManifest = undefined;
    }
    const obj = this.prepare(manifest, ns);
    const merged = this.merge(live, obj, prevManifest, false, manifest);
    merged.metadata.annotations = { ...(merged.metadata.annotations || {}), [LAST_APPLIED]: lastApplied };
    if (deepEqual(strip(merged), strip(live))) return { obj: live, action: 'unchanged' };
    this.checkImmutable(live, merged);
    this.commitUpdate(live, merged);
    return { obj: merged, action: 'configured' };
  }

  /** kubectl replace / edit: the new object replaces the old one. */
  replace(manifest: Obj, defaultNs: string, source?: Source): ApplyResult {
    const ns = this.namespaceOf(manifest, defaultNs);
    const live = this.get(manifest.kind, ns, manifest.metadata?.name);
    if (!live) throw new ApiError('NotFound', `${resourceByKind(manifest.kind)?.plural || manifest.kind} "${manifest.metadata?.name}" not found`);
    const obj = this.prepare(manifest, ns);
    const merged = this.merge(live, obj, undefined, true);
    this.checkImmutable(live, merged);
    if (source) this.s.sources[live.metadata.uid] = source;
    this.commitUpdate(live, merged);
    return { obj: merged, action: 'replaced' };
  }

  /** Writes a user change to an existing object: generation, resourceVersion. */
  commitUpdate(live: Obj, next: Obj) {
    if (live.metadata.generation !== undefined && !deepEqual(specOf(live), specOf(next))) next.metadata.generation = (live.metadata.generation || 1) + 1;
    next.metadata.resourceVersion = String(++this.s.rv);
    this.s.objects[this.key(next.kind, next.metadata.namespace, next.metadata.name)] = next;
  }

  /** New desired state on top of the live object. */
  merge(live: Obj, obj: Obj, prevManifest: Obj | undefined, replace = false, raw?: Obj): Obj {
    const out = clone(obj);
    const lm = live.metadata;
    out.metadata.uid = lm.uid;
    out.metadata.creationTimestamp = lm.creationTimestamp;
    out.metadata.resourceVersion = lm.resourceVersion;
    if (lm.generation !== undefined) out.metadata.generation = lm.generation;
    if (lm.ownerReferences && !out.metadata.ownerReferences) out.metadata.ownerReferences = lm.ownerReferences;
    if (lm.deletionTimestamp) out.metadata.deletionTimestamp = lm.deletionTimestamp;
    if (!replace) {
      // Keys set by others (controllers, kubectl annotate) survive unless the
      // previous apply had them and this one dropped them.
      for (const field of ['labels', 'annotations'] as const) {
        const mine = obj.metadata[field] || {};
        const had = prevManifest?.metadata?.[field] || {};
        const keep: Record<string, string> = {};
        for (const [k, v] of Object.entries(lm[field] || {})) if (!(k in had) && !(k in mine) && k !== LAST_APPLIED) keep[k] = v as string;
        const m = { ...keep, ...mine };
        if (Object.keys(m).length) out.metadata[field] = m;
      }
      // spec.replicas scaled by hand (or by an HPA) stays if the manifest never set it.
      const setsReplicas = raw?.spec?.replicas !== undefined;
      const hadReplicas = prevManifest?.spec?.replicas !== undefined;
      if (out.spec && live.spec?.replicas !== undefined && !setsReplicas && !hadReplicas) out.spec.replicas = live.spec.replicas;
    }
    if (live.status !== undefined) out.status = live.status;
    if (obj.kind === 'Service') {
      if (!obj.spec.clusterIP && live.spec?.clusterIP) {
        out.spec.clusterIP = live.spec.clusterIP;
        out.spec.clusterIPs = live.spec.clusterIPs;
      }
      for (const p of out.spec.ports || []) {
        if (p.nodePort !== undefined) continue;
        const old = (live.spec?.ports || []).find((q: Json) => q.port === p.port && q.nodePort);
        if (old && (out.spec.type === 'NodePort' || out.spec.type === 'LoadBalancer')) p.nodePort = old.nodePort;
      }
    }
    if (obj.kind === 'PersistentVolumeClaim') {
      if (!out.spec.volumeName && live.spec?.volumeName) out.spec.volumeName = live.spec.volumeName;
      if (!out.spec.storageClassName && live.spec?.storageClassName) out.spec.storageClassName = live.spec.storageClassName;
    }
    if (obj.kind === 'Pod') {
      if (live.spec?.nodeName && !out.spec.nodeName) out.spec.nodeName = live.spec.nodeName;
    }
    return out;
  }

  checkImmutable(live: Obj, next: Obj) {
    const name = live.metadata.name;
    const fail = (msg: string) => {
      throw new ApiError('Invalid', `The ${live.kind} "${name}" is invalid: ${msg}`);
    };
    switch (live.kind) {
      case 'Deployment':
      case 'ReplicaSet':
      case 'StatefulSet':
      case 'DaemonSet':
        if (!deepEqual(live.spec.selector, next.spec.selector)) {
          fail(`spec.selector: Invalid value: v1.LabelSelector{MatchLabels:${JSON.stringify(next.spec.selector?.matchLabels || {})}}: field is immutable`);
        }
        if (live.kind === 'StatefulSet') {
          for (const f of ['serviceName', 'volumeClaimTemplates', 'podManagementPolicy']) {
            if (!deepEqual(live.spec[f], next.spec[f])) {
              fail(`spec: Forbidden: updates to statefulset spec for fields other than 'replicas', 'ordinals', 'template', 'updateStrategy', 'revisionHistoryLimit', 'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' are forbidden`);
            }
          }
        }
        break;
      case 'Job':
        if (!deepEqual(stripJobTemplate(live.spec.template), stripJobTemplate(next.spec.template))) {
          fail('spec.template: Invalid value: core.PodTemplateSpec{...}: field is immutable');
        }
        if (live.spec.completions !== next.spec.completions) fail(`spec.completions: Invalid value: ${next.spec.completions}: field is immutable`);
        break;
      case 'Pod': {
        const a = clone(live.spec);
        const b = clone(next.spec);
        (a.containers || []).forEach((c: Json) => delete c.image);
        (b.containers || []).forEach((c: Json) => delete c.image);
        delete a.activeDeadlineSeconds;
        delete b.activeDeadlineSeconds;
        delete a.tolerations;
        delete b.tolerations;
        if (!deepEqual(a, b)) {
          fail('spec: Forbidden: pod updates may not change fields other than `spec.containers[*].image`,`spec.initContainers[*].image`,`spec.activeDeadlineSeconds`,`spec.tolerations` (only additions to existing tolerations),`spec.terminationGracePeriodSeconds` (allow it to be set to 1 if it was previously negative)');
        }
        break;
      }
      case 'Service':
        if (live.spec.clusterIP && next.spec.clusterIP && live.spec.clusterIP !== next.spec.clusterIP && live.spec.type !== 'ExternalName') {
          fail(`spec.clusterIPs[0]: Invalid value: []string{${JSON.stringify(next.spec.clusterIP)}}: may not change once set`);
        }
        break;
      case 'PersistentVolumeClaim': {
        const a = clone(live.spec);
        const b = clone(next.spec);
        delete a.resources;
        delete b.resources;
        if (!deepEqual(a, b)) fail('spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims');
        break;
      }
      case 'ConfigMap':
      case 'Secret':
        if (live.immutable && (!deepEqual(live.data, next.data) || !deepEqual(live.binaryData, next.binaryData))) fail('data: Forbidden: field is immutable when `immutable` is set');
        break;
    }
  }

  /** Admission: things the API server fills in on create (Service IPs, node ports…). */
  admit(obj: Obj) {
    if (obj.kind === 'Service') {
      const s = obj.spec;
      if (s.type !== 'ExternalName') {
        if (!s.clusterIP) s.clusterIP = this.allocServiceIp();
        if (s.clusterIP !== 'None' && this.list('Service').some((o) => o.spec?.clusterIP === s.clusterIP)) {
          throw new ApiError('Invalid', `The Service "${obj.metadata.name}" is invalid: spec.clusterIPs: Invalid value: []string{"${s.clusterIP}"}: failed to allocate IP ${s.clusterIP}: provided IP is already allocated`);
        }
        s.clusterIPs = [s.clusterIP];
      }
      if (s.type === 'NodePort' || s.type === 'LoadBalancer') {
        for (const p of s.ports || []) {
          if (p.nodePort) {
            if (this.nodePortUsed(p.nodePort)) {
              throw new ApiError('Invalid', `The Service "${obj.metadata.name}" is invalid: spec.ports[0].nodePort: Invalid value: ${p.nodePort}: provided port is already allocated`);
            }
          } else p.nodePort = this.allocNodePort();
        }
      }
      obj.status = { loadBalancer: {} };
    }
    if (obj.kind === 'Namespace') {
      obj.metadata.labels = { 'kubernetes.io/metadata.name': obj.metadata.name, ...(obj.metadata.labels || {}) };
      obj.spec = { finalizers: ['kubernetes'] };
      obj.status = { phase: 'Active' };
    }
    if (obj.kind === 'PersistentVolumeClaim') {
      if (obj.spec.storageClassName === undefined) {
        const def = this.list('StorageClass').find((sc) => sc.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true');
        if (def) obj.spec.storageClassName = def.metadata.name;
      }
      obj.status = { phase: 'Pending' };
      obj.metadata.finalizers = ['kubernetes.io/pvc-protection'];
    }
    if (obj.kind === 'Pod') {
      obj.spec.serviceAccountName ??= obj.spec.serviceAccount || 'default';
      obj.spec.serviceAccount = obj.spec.serviceAccountName;
      obj.status = { phase: 'Pending', qosClass: qosClass(obj.spec) };
      obj.spec.enableServiceLinks ??= true;
      obj.spec.preemptionPolicy ??= 'PreemptLowerPriority';
      obj.spec.priority ??= 0;
      obj.spec.tolerations = [
        ...(obj.spec.tolerations || []),
        { key: 'node.kubernetes.io/not-ready', operator: 'Exists', effect: 'NoExecute', tolerationSeconds: 300 },
        { key: 'node.kubernetes.io/unreachable', operator: 'Exists', effect: 'NoExecute', tolerationSeconds: 300 },
      ];
      if (!this.get('ServiceAccount', obj.metadata.namespace, obj.spec.serviceAccountName)) {
        throw new ApiError('Forbidden', `pods "${obj.metadata.name}" is forbidden: error looking up service account ${obj.metadata.namespace}/${obj.spec.serviceAccountName}: serviceaccount "${obj.spec.serviceAccountName}" not found`);
      }
    }
    if (['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(obj.kind)) obj.status = {};
    if (obj.kind === 'Job') obj.status = {};
    if (obj.kind === 'CronJob') obj.status = {};
    if (obj.kind === 'HorizontalPodAutoscaler') obj.status = { currentReplicas: 0, desiredReplicas: 0 };
    if (obj.kind === 'Ingress') obj.status = { loadBalancer: {} };
    if (obj.kind === 'PersistentVolume') obj.status = { phase: 'Available' };
  }

  allocServiceIp(): string {
    const used = new Set(this.list('Service').map((s) => s.spec?.clusterIP));
    for (;;) {
      const ip = `10.96.${Math.floor(this.random() * 256)}.${1 + Math.floor(this.random() * 254)}`;
      if (!used.has(ip)) return ip;
    }
  }

  nodePortUsed(port: number) {
    return this.list('Service').some((s) => (s.spec?.ports || []).some((p: Json) => p.nodePort === port));
  }

  allocNodePort(): number {
    for (;;) {
      const p = 30000 + Math.floor(this.random() * 2768);
      if (!this.nodePortUsed(p)) return p;
    }
  }

  /** kubectl delete: pods terminate gracefully, the rest disappear and the GC removes their dependents. */
  delete(kind: string, ns: string | undefined, name: string, opts: DeleteOptions = {}): Obj {
    const obj = this.get(kind, ns, name);
    const type = resourceByKind(kind)!;
    if (!obj) throw new ApiError('NotFound', `${type.plural}${qualifiedName(kind).includes('.') ? '.' + qualifiedName(kind).split('.').slice(1).join('.') : ''} "${name}" not found`);
    if (kind === 'Namespace' && ['default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(name)) {
      throw new ApiError('Forbidden', `namespaces "${name}" is forbidden: this namespace may not be deleted`);
    }
    if (kind === 'Node') throw new ApiError('Forbidden', 'nodes are managed by the playground (usa el menú contextual del diagrama para tirar un nodo)');
    this.deleteObject(obj, opts);
    return obj;
  }

  deleteObject(obj: Obj, opts: DeleteOptions = {}) {
    const cascade = opts.cascade || 'background';
    if (cascade === 'orphan') {
      for (const child of this.children(obj)) {
        this.mutate(child, (c) => {
          c.metadata.ownerReferences = (c.metadata.ownerReferences || []).filter((r: Json) => r.uid !== obj.metadata.uid);
          if (!c.metadata.ownerReferences.length) delete c.metadata.ownerReferences;
        });
      }
    }
    if (obj.kind === 'Pod') {
      if (opts.force && opts.gracePeriod === 0) {
        this.remove(obj);
        return;
      }
      if (obj.metadata.deletionTimestamp) return;
      const grace = opts.gracePeriod ?? obj.spec?.terminationGracePeriodSeconds ?? 30;
      this.mutate(obj, (p) => {
        p.metadata.deletionTimestamp = this.ts(this.s.now + grace * 1000);
        p.metadata.deletionGracePeriodSeconds = grace;
      });
      if (!obj.spec?.nodeName) this.remove(obj);
      return;
    }
    if (obj.kind === 'Namespace') {
      this.mutate(obj, (n) => {
        n.metadata.deletionTimestamp = this.ts();
        n.status = { ...(n.status || {}), phase: 'Terminating' };
      });
      return;
    }
    if (obj.kind === 'PersistentVolumeClaim' && (obj.metadata.finalizers || []).length) {
      this.mutate(obj, (p) => {
        p.metadata.deletionTimestamp ??= this.ts();
      });
      return;
    }
    if (cascade === 'foreground' && this.children(obj).length) {
      this.mutate(obj, (o) => {
        o.metadata.deletionTimestamp ??= this.ts();
        o.metadata.finalizers = ['foregroundDeletion'];
      });
      return;
    }
    this.remove(obj);
    // PVs of deleted claims with reclaimPolicy Delete go too (handled in the storage controller).
  }

  /** The workspace file that declared this object, walking up its owners. */
  sourceOf(obj: Obj): { source: Source; obj: Obj } | undefined {
    let cur: Obj | undefined = obj;
    for (let i = 0; cur && i < 5; i++) {
      const src = this.s.sources[cur.metadata.uid];
      if (src) return { source: src, obj: cur };
      cur = this.controllerOf(cur);
    }
    // Pods of a StatefulSet's PVCs: the StatefulSet.
    if (obj.kind === 'PersistentVolumeClaim') {
      for (const sts of this.list('StatefulSet', obj.metadata.namespace)) {
        for (const t of sts.spec.volumeClaimTemplates || []) {
          if (obj.metadata.name.startsWith(`${t.metadata?.name}-${sts.metadata.name}-`)) {
            const src = this.s.sources[sts.metadata.uid];
            if (src) return { source: src, obj: sts };
          }
        }
      }
    }
    return undefined;
  }

  /** Resolves "deploy/web", ("deploy", "web") or ("pod", …). */
  find(kindOrPlural: string, ns: string, name: string): Obj | undefined {
    const t = resolveResource(kindOrPlural);
    return t ? this.get(t.kind, ns, name) : undefined;
  }
}

function specOf(o: Obj): Json {
  const { metadata, status, ...rest } = o; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

function strip(o: Obj): Json {
  const c = clone(o);
  delete c.metadata.resourceVersion;
  delete c.metadata.generation;
  delete c.status;
  return c;
}

function stripJobTemplate(t: Obj) {
  const c = clone(t || {});
  if (c.metadata?.labels) {
    delete c.metadata.labels['batch.kubernetes.io/controller-uid'];
    delete c.metadata.labels['controller-uid'];
    delete c.metadata.labels['batch.kubernetes.io/job-name'];
    delete c.metadata.labels['job-name'];
  }
  return c;
}

/** The manifest as kubectl stores it in last-applied-configuration. */
export function stripForLastApplied(manifest: Obj, ns: string | undefined): Obj {
  const m = clone(manifest);
  m.metadata ??= {};
  if (ns !== undefined && !CLUSTER_SCOPED(m.kind)) m.metadata.namespace = ns;
  m.metadata.annotations = { ...(m.metadata.annotations || {}) };
  delete m.metadata.annotations[LAST_APPLIED];
  return sortKeys(m);
}

function sortKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v === null || typeof v !== 'object') return v;
  const out: Json = {};
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
  return out;
}

export function qosClass(spec: Json): 'Guaranteed' | 'Burstable' | 'BestEffort' {
  const cs = spec?.containers || [];
  let any = false;
  let all = true;
  for (const c of cs) {
    const r = c.resources || {};
    if (Object.keys(r.requests || {}).length || Object.keys(r.limits || {}).length) any = true;
    for (const k of ['cpu', 'memory']) {
      const lim = r.limits?.[k];
      const req = r.requests?.[k] ?? lim;
      if (!lim || req !== lim) all = false;
    }
  }
  if (!any) return 'BestEffort';
  return all ? 'Guaranteed' : 'Burstable';
}
