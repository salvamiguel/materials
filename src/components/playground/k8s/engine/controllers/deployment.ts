// Deployment controller (pkg/controller/deployment): one ReplicaSet per pod
// template, RollingUpdate with maxSurge/maxUnavailable, Recreate, rollbacks,
// pause and the Progressing/Available conditions.

import type { Cluster } from '../cluster';
import type { Obj } from '../types';
import { clone, deepEqual, intOrPercent, stableJson, templateHash } from '../util';
import { isTerminating, ownerRef, podActive, removeCondition, setCondition } from './common';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const REVISION = 'deployment.kubernetes.io/revision';
export const HASH = 'pod-template-hash';
const CHANGE_CAUSE = 'kubernetes.io/change-cause';

export const revisionOf = (o: Obj) => parseInt(o.metadata.annotations?.[REVISION] || '0', 10) || 0;

/** The template without the pod-template-hash label the controller adds. */
export function stripHash(t: Obj): Obj {
  const c = clone(t);
  if (c?.metadata?.labels) {
    delete c.metadata.labels[HASH];
    if (!Object.keys(c.metadata.labels).length) delete c.metadata.labels;
  }
  return c;
}

export function sameTemplate(a: Obj, b: Obj) {
  return deepEqual(stripHash(a), stripHash(b));
}

export function maxSurge(d: Obj) {
  const desired = d.spec.replicas ?? 1;
  if (d.spec.strategy?.type !== 'RollingUpdate') return 0;
  return intOrPercent(d.spec.strategy.rollingUpdate?.maxSurge, desired, true, '25%');
}

export function maxUnavailable(d: Obj) {
  const desired = d.spec.replicas ?? 1;
  if (d.spec.strategy?.type !== 'RollingUpdate') return 0;
  let mu = intOrPercent(d.spec.strategy.rollingUpdate?.maxUnavailable, desired, false, '25%');
  if (mu === 0 && maxSurge(d) === 0) mu = 1;
  return Math.min(mu, desired);
}

export function deploymentReplicaSets(cl: Cluster, d: Obj): { newRS?: Obj; old: Obj[]; all: Obj[] } {
  const all = cl.children(d, 'ReplicaSet').filter((rs) => !isTerminating(rs));
  const hash = templateHash(d.spec.template);
  const newRS = all
    .filter((rs) => (rs.metadata.labels?.[HASH] ? rs.metadata.labels[HASH] === hash : sameTemplate(rs.spec.template, d.spec.template)))
    .sort((a, b) => revisionOf(b) - revisionOf(a))[0];
  const old = all
    .filter((rs) => rs !== newRS)
    .sort((a, b) => Date.parse(a.metadata.creationTimestamp) - Date.parse(b.metadata.creationTimestamp) || revisionOf(a) - revisionOf(b));
  return { newRS, old, all };
}

function scale(cl: Cluster, d: Obj, rs: Obj, to: number) {
  const from = rs.spec.replicas ?? 0;
  if (from === to) return;
  cl.mutate(rs, (r) => {
    r.spec.replicas = to;
    r.metadata.annotations = {
      ...(r.metadata.annotations || {}),
      'deployment.kubernetes.io/desired-replicas': String(d.spec.replicas),
      'deployment.kubernetes.io/max-replicas': String((d.spec.replicas ?? 1) + maxSurge(d)),
    };
  });
  cl.emit(
    d,
    'Normal',
    'ScalingReplicaSet',
    `Scaled ${to > from ? 'up' : 'down'} replica set ${rs.metadata.name} from ${from} to ${to}`,
    'deployment-controller',
  );
}

export function deploymentController(cl: Cluster) {
  for (const d of cl.list('Deployment')) {
    if (isTerminating(d)) continue;
    sync(cl, d);
  }
}

function sync(cl: Cluster, d: Obj) {
  const desired: number = d.spec.replicas ?? 1;
  let { newRS, old, all } = deploymentReplicaSets(cl, d);
  const maxRev = all.reduce((m, rs) => Math.max(m, revisionOf(rs)), 0);
  const before = JSON.stringify(d);
  let created = false;

  if (d.spec.paused) {
    if (newRS && !old.some((rs) => rs.spec.replicas > 0) && newRS.spec.replicas !== desired) scale(cl, d, newRS, desired);
    finish(cl, d, newRS, all, before, false);
    return;
  }

  if (!newRS) {
    const hash = templateHash(d.spec.template);
    const template = clone(d.spec.template);
    template.metadata ??= {};
    template.metadata.labels = { ...(template.metadata.labels || {}), [HASH]: hash };
    const name = `${d.metadata.name}-${hash}`;
    const existing = cl.get('ReplicaSet', d.metadata.namespace, name);
    if (existing) cl.remove(existing); // hash collision with an orphan: replace it
    const annotations: Record<string, string> = {
      'deployment.kubernetes.io/desired-replicas': String(desired),
      'deployment.kubernetes.io/max-replicas': String(desired + maxSurge(d)),
      [REVISION]: String(maxRev + 1),
    };
    if (d.metadata.annotations?.[CHANGE_CAUSE]) annotations[CHANGE_CAUSE] = d.metadata.annotations[CHANGE_CAUSE];
    const recreate = d.spec.strategy?.type === 'Recreate';
    const oldPods = old.reduce((n, rs) => n + (rs.spec.replicas || 0), 0);
    newRS = cl.put({
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name,
        namespace: d.metadata.namespace,
        labels: { ...(d.spec.template.metadata?.labels || {}), [HASH]: hash },
        annotations,
        ownerReferences: [ownerRef(d)],
      },
      spec: {
        replicas: recreate || oldPods > 0 ? 0 : desired,
        selector: { ...clone(d.spec.selector), matchLabels: { ...(d.spec.selector.matchLabels || {}), [HASH]: hash } },
        template,
        ...(d.spec.minReadySeconds ? { minReadySeconds: d.spec.minReadySeconds } : {}),
      },
      status: { replicas: 0 },
    });
    all = [...all, newRS];
    created = true;
    if (newRS.spec.replicas > 0)
      cl.emit(d, 'Normal', 'ScalingReplicaSet', `Scaled up replica set ${name} from 0 to ${newRS.spec.replicas}`, 'deployment-controller');
    setCondition(cl, d, 'Progressing', 'True', 'NewReplicaSetCreated', `Created new replica set "${name}"`, { lastUpdateTime: cl.ts() });
    cl.s.progress[d.metadata.uid] = { at: cl.now, key: '' };
  } else if (revisionOf(newRS) < maxRev) {
    // Rolled back to an old template: it becomes the newest revision.
    const prevRev = revisionOf(newRS);
    cl.mutate(newRS, (rs) => {
      const hist = rs.metadata.annotations['deployment.kubernetes.io/revision-history'];
      rs.metadata.annotations[REVISION] = String(maxRev + 1);
      rs.metadata.annotations['deployment.kubernetes.io/revision-history'] = hist ? `${hist},${prevRev}` : String(prevRev);
      if (d.metadata.annotations?.[CHANGE_CAUSE]) rs.metadata.annotations[CHANGE_CAUSE] = d.metadata.annotations[CHANGE_CAUSE];
    });
    cl.s.progress[d.metadata.uid] = { at: cl.now, key: '' };
  }
  const nrs = newRS!;

  if (d.spec.strategy?.type === 'Recreate') {
    const oldActive = old.filter((rs) => rs.spec.replicas > 0);
    if (oldActive.length) {
      oldActive.forEach((rs) => scale(cl, d, rs, 0));
    } else {
      const oldPodsRunning = old.some((rs) => cl.children(rs, 'Pod').some((p) => podActive(p) || isTerminating(p)));
      if (!oldPodsRunning && nrs.spec.replicas !== desired) scale(cl, d, nrs, desired);
    }
  } else {
    rollingUpdate(cl, d, nrs, old);
  }

  cleanup(cl, d, old);
  finish(cl, d, nrs, all, before, created);
}

function rollingUpdate(cl: Cluster, d: Obj, newRS: Obj, old: Obj[]) {
  const desired: number = d.spec.replicas ?? 1;
  const all = [newRS, ...old];
  const total = () => all.reduce((n, rs) => n + (rs.spec.replicas || 0), 0);

  // Scale up the new ReplicaSet within maxSurge.
  if (newRS.spec.replicas > desired) {
    scale(cl, d, newRS, desired);
  } else if (newRS.spec.replicas < desired) {
    const room = desired + maxSurge(d) - total();
    if (room > 0) scale(cl, d, newRS, newRS.spec.replicas + Math.min(room, desired - newRS.spec.replicas));
  }

  // Scale down old ReplicaSets within maxUnavailable.
  const minAvailable = desired - maxUnavailable(d);
  const newUnavailable = Math.max(0, (newRS.spec.replicas || 0) - (newRS.status?.availableReplicas || 0));
  let maxScaledDown = total() - minAvailable - newUnavailable;
  if (maxScaledDown <= 0) return;
  // First, old replicas that aren't available anyway.
  for (const rs of old) {
    if (maxScaledDown <= 0) break;
    const unhealthy = (rs.spec.replicas || 0) - (rs.status?.availableReplicas || 0);
    if (unhealthy <= 0) continue;
    const n = Math.min(unhealthy, maxScaledDown);
    scale(cl, d, rs, rs.spec.replicas - n);
    maxScaledDown -= n;
  }
  // Then healthy ones, while enough pods stay available.
  const available = all.reduce((n, rs) => n + Math.min(rs.status?.availableReplicas || 0, rs.spec.replicas || 0), 0);
  let canDown = available - minAvailable;
  for (const rs of old) {
    if (canDown <= 0) break;
    if (!rs.spec.replicas) continue;
    const n = Math.min(rs.spec.replicas, canDown);
    scale(cl, d, rs, rs.spec.replicas - n);
    canDown -= n;
  }
}

function cleanup(cl: Cluster, d: Obj, old: Obj[]) {
  const limit = d.spec.revisionHistoryLimit ?? 10;
  const idle = old.filter((rs) => !rs.spec.replicas && !rs.status?.replicas && !cl.children(rs, 'Pod').length).sort((a, b) => revisionOf(a) - revisionOf(b));
  while (idle.length > limit) cl.remove(idle.shift()!);
}

function finish(cl: Cluster, d: Obj, newRS: Obj | undefined, all: Obj[], before: string, created: boolean) {
  const desired: number = d.spec.replicas ?? 1;
  const sum = (f: (rs: Obj) => number) => all.reduce((n, rs) => n + f(rs), 0);
  const status: Json = d.status || {};
  const replicas = sum((rs) => rs.status?.replicas || 0);
  const updated = newRS?.status?.replicas || 0;
  const ready = sum((rs) => rs.status?.readyReplicas || 0);
  const available = sum((rs) => rs.status?.availableReplicas || 0);
  const upd: Json = {
    ...status,
    observedGeneration: d.metadata.generation,
    replicas,
    updatedReplicas: updated,
    readyReplicas: ready,
    availableReplicas: available,
  };
  if (replicas - available > 0) upd.unavailableReplicas = replicas - available;
  else delete upd.unavailableReplicas;
  for (const k of ['replicas', 'updatedReplicas', 'readyReplicas', 'availableReplicas'] as const) if (!upd[k]) delete upd[k];
  d.status = upd;
  if (newRS && d.metadata.annotations?.[REVISION] !== String(revisionOf(newRS))) {
    d.metadata.annotations = { ...(d.metadata.annotations || {}), [REVISION]: String(revisionOf(newRS)) };
  }

  const minAvail = desired - maxUnavailable(d);
  if (available >= minAvail)
    setCondition(cl, d, 'Available', 'True', 'MinimumReplicasAvailable', 'Deployment has minimum availability.', { lastUpdateTime: cl.ts() });
  else setCondition(cl, d, 'Available', 'False', 'MinimumReplicasUnavailable', 'Deployment does not have minimum availability.', { lastUpdateTime: cl.ts() });

  const rsName = newRS?.metadata.name || '';
  const key = stableJson(all.map((rs) => [rs.metadata.name, rs.spec.replicas, rs.status?.availableReplicas || 0]));
  const prog = (cl.s.progress[d.metadata.uid] ??= { at: cl.now, key });
  const complete = updated === desired && replicas === desired && available === desired && (newRS?.spec.replicas ?? 0) === desired;
  if (d.spec.paused) {
    setCondition(cl, d, 'Progressing', 'Unknown', 'DeploymentPaused', 'Deployment is paused', { lastUpdateTime: cl.ts() });
    prog.at = cl.now;
  } else if (complete) {
    const c = (d.status.conditions || []).find((x: Json) => x.type === 'Progressing');
    if (!c || c.reason !== 'NewReplicaSetAvailable') {
      setCondition(cl, d, 'Progressing', 'True', 'NewReplicaSetAvailable', `ReplicaSet "${rsName}" has successfully progressed.`, { lastUpdateTime: cl.ts() });
    }
    prog.at = cl.now;
    prog.key = key;
  } else if (prog.key !== key || created) {
    prog.key = key;
    prog.at = cl.now;
    if (!created) setCondition(cl, d, 'Progressing', 'True', 'ReplicaSetUpdated', `ReplicaSet "${rsName}" is progressing.`, { lastUpdateTime: cl.ts() });
  } else if (cl.now - prog.at > (d.spec.progressDeadlineSeconds ?? 600) * 1000) {
    const c = (d.status.conditions || []).find((x: Json) => x.type === 'Progressing');
    if (c?.reason !== 'ProgressDeadlineExceeded') {
      setCondition(cl, d, 'Progressing', 'False', 'ProgressDeadlineExceeded', `ReplicaSet "${rsName}" has timed out progressing.`, { lastUpdateTime: cl.ts() });
      cl.emit(d, 'Warning', 'ProgressDeadlineExceeded', `Deployment "${d.metadata.name}" has timed out progressing.`, 'deployment-controller');
    }
  }
  if (!d.status.conditions?.length) removeCondition(d, 'Progressing');
  // Available first, like the real controller.
  d.status.conditions?.sort((a: Json, b: Json) => (a.type === 'Available' ? -1 : b.type === 'Available' ? 1 : 0));
  if (JSON.stringify(d) !== before) d.metadata.resourceVersion = String(++cl.s.rv);
}
