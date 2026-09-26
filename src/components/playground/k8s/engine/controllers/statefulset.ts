// StatefulSet controller: stable names (web-0, web-1…), one PVC per pod from
// volumeClaimTemplates, OrderedReady/Parallel and RollingUpdate with partition.

import type { Cluster } from '../cluster';
import type { Obj } from '../types';
import { clone, stableJson, templateHash } from '../util';
import { createPod, deletePod, isTerminating, podAvailable, podReady } from './common';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const REV_LABEL = 'controller-revision-hash';

export function ordinalOf(sts: Obj, pod: Obj): number {
  const m = new RegExp(`^${sts.metadata.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`).exec(pod.metadata.name);
  return m ? parseInt(m[1], 10) : -1;
}

function revisionName(sts: Obj) {
  return `${sts.metadata.name}-${templateHash(sts.spec.template)}`;
}

/** Templates of past revisions, so pods below the partition keep theirs. */
function revisions(cl: Cluster, sts: Obj): Record<string, Obj> {
  const all = (cl.s.revisions ??= {});
  const mine = (all[sts.metadata.uid] ??= {});
  const rev = revisionName(sts);
  if (!mine[rev]) mine[rev] = clone(sts.spec.template);
  return mine;
}

function ensureClaims(cl: Cluster, sts: Obj, ord: number) {
  for (const t of sts.spec.volumeClaimTemplates || []) {
    const name = `${t.metadata?.name}-${sts.metadata.name}-${ord}`;
    if (cl.get('PersistentVolumeClaim', sts.metadata.namespace, name)) continue;
    const pvc: Obj = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name, namespace: sts.metadata.namespace, labels: { ...(sts.spec.selector?.matchLabels || {}) } },
      spec: clone(t.spec || {}),
    };
    cl.admit(pvc);
    cl.put(pvc);
    cl.emit(sts, 'Normal', 'SuccessfulCreate', `create Claim ${name} Pod ${sts.metadata.name}-${ord} in StatefulSet ${sts.metadata.name} success`, 'statefulset-controller');
  }
}

function podTemplate(sts: Obj, template: Obj, ord: number): Obj {
  const t = clone(template);
  t.spec ??= {};
  t.spec.volumes = [...(t.spec.volumes || [])];
  for (const ct of sts.spec.volumeClaimTemplates || []) {
    if (!t.spec.volumes.some((v: Json) => v.name === ct.metadata?.name)) {
      t.spec.volumes.push({ name: ct.metadata?.name, persistentVolumeClaim: { claimName: `${ct.metadata?.name}-${sts.metadata.name}-${ord}` } });
    }
  }
  return t;
}

export function statefulSetController(cl: Cluster) {
  for (const sts of cl.list('StatefulSet')) {
    if (isTerminating(sts)) continue;
    const before = JSON.stringify(sts);
    const revs = revisions(cl, sts);
    const updateRev = revisionName(sts);
    const currentRev: string = sts.status?.currentRevision || updateRev;
    const replicas: number = sts.spec.replicas ?? 1;
    const ordered = sts.spec.podManagementPolicy !== 'Parallel';
    const partition: number = sts.spec.updateStrategy?.type === 'RollingUpdate' ? sts.spec.updateStrategy.rollingUpdate?.partition ?? 0 : 0;
    const onDelete = sts.spec.updateStrategy?.type === 'OnDelete';
    const pods = cl.children(sts, 'Pod');
    const byOrd = new Map<number, Obj>();
    for (const p of pods) byOrd.set(ordinalOf(sts, p), p);

    let busy = false;
    // Create missing pods (in order when OrderedReady).
    for (let ord = 0; ord < replicas; ord++) {
      const p = byOrd.get(ord);
      if (p) {
        if (ordered && (!podReady(p) || isTerminating(p))) {
          busy = true;
          break;
        }
        continue;
      }
      ensureClaims(cl, sts, ord);
      const rev = ord < partition || onDelete ? (revs[currentRev] ? currentRev : updateRev) : updateRev;
      const pod = createPod(cl, sts, podTemplate(sts, revs[rev] || sts.spec.template, ord), {
        name: `${sts.metadata.name}-${ord}`,
        labels: { [REV_LABEL]: rev, 'statefulset.kubernetes.io/pod-name': `${sts.metadata.name}-${ord}`, 'apps.kubernetes.io/pod-index': String(ord) },
        hostname: `${sts.metadata.name}-${ord}`,
        subdomain: sts.spec.serviceName,
      });
      if (pod) byOrd.set(ord, pod);
      if (ordered) {
        busy = true;
        break;
      }
    }
    // Scale down from the highest ordinal.
    const extra = [...byOrd.entries()].filter(([ord]) => ord >= replicas).sort(([a], [b]) => b - a);
    if (extra.length && !(ordered && busy)) {
      const terminating = extra.some(([, p]) => isTerminating(p));
      if (!ordered) extra.forEach(([, p]) => deletePod(cl, sts, p));
      else if (!terminating) deletePod(cl, sts, extra[0][1]);
      busy = true;
    }
    // Rolling update: highest ordinal first, one at a time, down to the partition.
    if (!busy && !onDelete) {
      const allReady = [...Array(replicas).keys()].every((o) => byOrd.get(o) && podReady(byOrd.get(o)!));
      if (allReady) {
        for (let ord = replicas - 1; ord >= partition; ord--) {
          const p = byOrd.get(ord)!;
          if (p.metadata.labels?.[REV_LABEL] !== updateRev) {
            deletePod(cl, sts, p);
            break;
          }
        }
      }
    }
    const live = cl.children(sts, 'Pod').filter((p) => !isTerminating(p));
    const updated = live.filter((p) => p.metadata.labels?.[REV_LABEL] === updateRev).length;
    const ready = live.filter(podReady).length;
    const status: Json = {
      observedGeneration: sts.metadata.generation,
      replicas: live.length,
      readyReplicas: ready,
      currentReplicas: live.filter((p) => p.metadata.labels?.[REV_LABEL] === currentRev).length,
      updatedReplicas: updated,
      availableReplicas: live.filter((p) => podAvailable(cl, p, sts.spec.minReadySeconds)).length,
      currentRevision: currentRev,
      updateRevision: updateRev,
      collisionCount: 0,
    };
    if (updated === replicas && ready === replicas && live.length === replicas) {
      status.currentRevision = updateRev;
      status.currentReplicas = updated;
    }
    for (const k of ['readyReplicas', 'currentReplicas', 'updatedReplicas', 'availableReplicas']) if (!status[k]) delete status[k];
    sts.status = status;
    if (JSON.stringify(sts) !== before) sts.metadata.resourceVersion = String(++cl.s.rv);
  }
}
