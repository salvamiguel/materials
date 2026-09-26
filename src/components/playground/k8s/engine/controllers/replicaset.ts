// ReplicaSet controller: keeps spec.replicas pods alive (self-healing).

import type { Cluster } from '../cluster';
import type { Obj } from '../types';
import { fromLabelSelector, matches } from '../util';
import { createPod, deletePod, isTerminating, ownerRef, podActive, podAvailable, podReady, scaleDownOrder } from './common';

export function replicaSetController(cl: Cluster) {
  for (const rs of cl.list('ReplicaSet')) {
    if (isTerminating(rs)) continue;
    const before = JSON.stringify(rs);
    const sel = fromLabelSelector(rs.spec.selector);
    // Adopt orphans that match (e.g. after `kubectl delete rs --cascade=orphan`).
    for (const p of cl.list('Pod', rs.metadata.namespace)) {
      if (!p.metadata.ownerReferences?.length && !isTerminating(p) && sel.length && matches(sel, p.metadata.labels)) {
        cl.mutate(p, (x) => (x.metadata.ownerReferences = [ownerRef(rs)]));
      }
    }
    const pods = cl.children(rs, 'Pod');
    const active = pods.filter(podActive);
    const want: number = rs.spec.replicas ?? 1;
    const diff = active.length - want;
    if (diff < 0) {
      for (let i = 0; i < Math.min(-diff, 50); i++) createPod(cl, rs, rs.spec.template, { generateName: `${rs.metadata.name}-` });
    } else if (diff > 0) {
      for (const p of scaleDownOrder(cl, active).slice(0, diff)) deletePod(cl, rs, p);
    }
    const now = cl.children(rs, 'Pod').filter(podActive);
    const status: Obj = {
      replicas: now.length,
      fullyLabeledReplicas: now.filter((p) => matches(sel, p.metadata.labels)).length,
      readyReplicas: now.filter(podReady).length,
      availableReplicas: now.filter((p) => podAvailable(cl, p, rs.spec.minReadySeconds)).length,
      observedGeneration: rs.metadata.generation,
    };
    const terminating = cl.children(rs, 'Pod').filter(isTerminating).length;
    if (terminating) status.terminatingReplicas = terminating;
    for (const k of ['fullyLabeledReplicas', 'readyReplicas', 'availableReplicas'] as const) if (!status[k]) delete status[k];
    rs.status = status;
    if (JSON.stringify(rs) !== before) rs.metadata.resourceVersion = String(++cl.s.rv);
  }
}
