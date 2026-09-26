// DaemonSet controller: one pod on every node that accepts it.

import type { Cluster } from '../cluster';
import type { Obj } from '../types';
import { intOrPercent, templateHash } from '../util';
import { createPod, deletePod, isTerminating, podAvailable, podReady } from './common';
import { REV_LABEL } from './statefulset';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function tolerates(tpl: Obj, taint: Json) {
  return (tpl.spec?.tolerations || []).some(
    (t: Json) => (t.operator === 'Exists' && (!t.key || t.key === taint.key)) || (t.key === taint.key && (t.value || '') === (taint.value || '')),
  );
}

export function eligibleNodes(cl: Cluster, ds: Obj): Obj[] {
  const tpl = ds.spec.template;
  return cl.list('Node').filter((n) => {
    if (
      (n.spec.taints || []).some(
        (t: Json) => (t.effect === 'NoSchedule' || t.effect === 'NoExecute') && !t.key.startsWith('node.kubernetes.io/') && !tolerates(tpl, t),
      )
    )
      return false;
    return Object.entries(tpl.spec?.nodeSelector || {}).every(([k, v]) => n.metadata.labels?.[k] === v);
  });
}

export function daemonSetController(cl: Cluster) {
  for (const ds of cl.list('DaemonSet')) {
    if (isTerminating(ds)) continue;
    const before = JSON.stringify(ds);
    const hash = templateHash(ds.spec.template);
    const nodes = eligibleNodes(cl, ds);
    const names = new Set(nodes.map((n) => n.metadata.name));
    const pods = cl.children(ds, 'Pod');
    for (const n of nodes) {
      const mine = pods.filter((p) => p.spec.nodeName === n.metadata.name && !isTerminating(p) && p.status?.phase !== 'Failed');
      if (!mine.length && !pods.some((p) => p.spec.nodeName === n.metadata.name && isTerminating(p) && !cl.s.downNodes[n.metadata.uid])) {
        createPod(cl, ds, ds.spec.template, {
          generateName: `${ds.metadata.name}-`,
          nodeName: n.metadata.name,
          labels: { [REV_LABEL]: hash, 'pod-template-generation': String(ds.metadata.generation || 1) },
        });
      }
    }
    for (const p of pods) if (!names.has(p.spec.nodeName) && !isTerminating(p)) deletePod(cl, ds, p);

    const live = cl.children(ds, 'Pod').filter((p) => !isTerminating(p));
    if (ds.spec.updateStrategy?.type !== 'OnDelete') {
      const maxUnavailable = Math.max(1, intOrPercent(ds.spec.updateStrategy?.rollingUpdate?.maxUnavailable, nodes.length, true, '1'));
      const unavailable = nodes.length - live.filter((p) => podAvailable(cl, p, ds.spec.minReadySeconds)).length;
      const old = live.filter((p) => p.metadata.labels?.[REV_LABEL] !== hash).sort((a, b) => a.spec.nodeName.localeCompare(b.spec.nodeName));
      // Unready old pods first, then as many as maxUnavailable allows.
      for (const p of old.filter((x) => !podReady(x))) deletePod(cl, ds, p);
      let room = maxUnavailable - unavailable;
      for (const p of old.filter(podReady)) {
        if (room <= 0) break;
        deletePod(cl, ds, p);
        room--;
      }
    }
    const now = cl.children(ds, 'Pod').filter((p) => !isTerminating(p));
    const status: Json = {
      currentNumberScheduled: now.length,
      desiredNumberScheduled: nodes.length,
      numberMisscheduled: 0,
      numberReady: now.filter(podReady).length,
      numberAvailable: now.filter((p) => podAvailable(cl, p, ds.spec.minReadySeconds)).length,
      updatedNumberScheduled: now.filter((p) => p.metadata.labels?.[REV_LABEL] === hash).length,
      observedGeneration: ds.metadata.generation,
    };
    if (nodes.length - status.numberAvailable > 0) status.numberUnavailable = nodes.length - status.numberAvailable;
    if (!status.numberAvailable) delete status.numberAvailable;
    ds.status = status;
    if (JSON.stringify(ds) !== before) ds.metadata.resourceVersion = String(++cl.s.rv);
  }
}
