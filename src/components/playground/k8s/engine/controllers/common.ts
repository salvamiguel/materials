import type { Cluster } from '../cluster';
import { applyDefaults } from '../defaults';
import type { Obj } from '../types';
import { clone } from '../util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function ownerRef(owner: Obj) {
  return {
    apiVersion: owner.apiVersion,
    kind: owner.kind,
    name: owner.metadata.name,
    uid: owner.metadata.uid,
    controller: true,
    blockOwnerDeletion: true,
  };
}

export const isTerminating = (o: Obj) => !!o.metadata.deletionTimestamp;

export function condition(o: Obj, type: string): Json | undefined {
  return (o.status?.conditions || []).find((c: Json) => c.type === type);
}

export function podReady(p: Obj): boolean {
  return !isTerminating(p) && condition(p, 'Ready')?.status === 'True';
}

/** Ready for at least minReadySeconds. */
export function podAvailable(cl: Cluster, p: Obj, minReadySeconds = 0): boolean {
  if (!podReady(p)) return false;
  if (!minReadySeconds) return true;
  const since = Date.parse(condition(p, 'Ready')?.lastTransitionTime || '');
  return !Number.isNaN(since) && cl.now - since >= minReadySeconds * 1000;
}

export function podActive(p: Obj): boolean {
  return !isTerminating(p) && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed';
}

/** Sets a condition, touching lastTransitionTime only when the status changes. */
export function setCondition(cl: Cluster, o: Obj, type: string, status: string, reason?: string, message?: string, extra: Json = {}) {
  o.status ??= {};
  o.status.conditions ??= [];
  const c = o.status.conditions.find((x: Json) => x.type === type);
  if (c) {
    if (c.status === status && (reason === undefined || c.reason === reason) && (message === undefined || c.message === message)) return;
    if (c.status !== status) c.lastTransitionTime = cl.ts();
    c.status = status;
    if (reason !== undefined) c.reason = reason;
    if (message !== undefined) c.message = message;
    Object.assign(c, extra);
  } else {
    o.status.conditions.push({ type, status, ...extra, lastTransitionTime: cl.ts(), ...(reason ? { reason } : {}), ...(message ? { message } : {}) });
  }
}

export function removeCondition(o: Obj, type: string) {
  if (o.status?.conditions) o.status.conditions = o.status.conditions.filter((c: Json) => c.type !== type);
}

/** Creates a pod from a template owned by `owner`. */
export function createPod(cl: Cluster, owner: Obj, template: Obj, opts: { name?: string; generateName?: string; labels?: Record<string, string>; hostname?: string; subdomain?: string; nodeName?: string; annotations?: Record<string, string> } = {}): Obj | undefined {
  const t = clone(template || {});
  const pod: Obj = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      ...(opts.name ? { name: opts.name } : { generateName: opts.generateName || `${owner.metadata.name}-` }),
      namespace: owner.metadata.namespace,
      labels: { ...(t.metadata?.labels || {}), ...(opts.labels || {}) },
      ...(t.metadata?.annotations || opts.annotations ? { annotations: { ...(t.metadata?.annotations || {}), ...(opts.annotations || {}) } } : {}),
      ownerReferences: [ownerRef(owner)],
    },
    spec: { ...(t.spec || {}) },
  };
  if (opts.hostname) pod.spec.hostname = opts.hostname;
  if (opts.subdomain) pod.spec.subdomain = opts.subdomain;
  if (opts.nodeName) pod.spec.nodeName = opts.nodeName;
  applyDefaults(pod);
  try {
    cl.admit(pod);
  } catch (err) {
    cl.emit(owner, 'Warning', 'FailedCreate', `Error creating: ${(err as Error).message}`, controllerName(owner.kind));
    return undefined;
  }
  cl.put(pod);
  cl.emit(owner, 'Normal', owner.kind === 'StatefulSet' ? 'SuccessfulCreate' : 'SuccessfulCreate', owner.kind === 'StatefulSet' ? `create Pod ${pod.metadata.name} in StatefulSet ${owner.metadata.name} successful` : `Created pod: ${pod.metadata.name}`, controllerName(owner.kind));
  return pod;
}

export function deletePod(cl: Cluster, owner: Obj, pod: Obj) {
  if (isTerminating(pod)) return;
  cl.deleteObject(pod);
  cl.emit(owner, 'Normal', 'SuccessfulDelete', owner.kind === 'StatefulSet' ? `delete Pod ${pod.metadata.name} in StatefulSet ${owner.metadata.name} successful` : `Deleted pod: ${pod.metadata.name}`, controllerName(owner.kind));
}

export function controllerName(kind: string) {
  return (
    {
      ReplicaSet: 'replicaset-controller',
      Deployment: 'deployment-controller',
      StatefulSet: 'statefulset-controller',
      DaemonSet: 'daemonset-controller',
      Job: 'job-controller',
      CronJob: 'cronjob-controller',
      HorizontalPodAutoscaler: 'horizontal-pod-autoscaler',
    } as Record<string, string>
  )[kind] || 'controller-manager';
}

/** Ranks pods for scale-down like the ReplicaSet controller: worst first. */
export function scaleDownOrder(cl: Cluster, pods: Obj[]): Obj[] {
  const rank = (p: Obj) => {
    if (!p.spec.nodeName) return 0;
    if (p.status?.phase === 'Pending') return 1;
    if (!podReady(p)) return 2;
    return 3;
  };
  const restarts = (p: Obj) => (p.status?.containerStatuses || []).reduce((n: number, c: Json) => n + (c.restartCount || 0), 0);
  return [...pods].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      restarts(b) - restarts(a) ||
      Date.parse(b.metadata.creationTimestamp) - Date.parse(a.metadata.creationTimestamp) ||
      b.metadata.name.localeCompare(a.metadata.name),
  );
}
