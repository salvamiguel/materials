// HorizontalPodAutoscaler: CPU utilization against the pods' requests. The
// load is simulated (context menu of the diagram or `kubectl` annotations).

import type { Cluster } from '../cluster';
import type { Obj } from '../types';
import { fromLabelSelector, matches, parseQuantity, stableJson } from '../util';
import { isTerminating, podReady, setCondition } from './common';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SYNC = 15_000;
/** Real default is 300 s; shortened so the class sees it happen. */
export const SCALE_DOWN_WINDOW = 60_000;

function cpuRequest(pod: Obj): number {
  let total = 0;
  for (const c of pod.spec.containers || []) {
    const q = parseQuantity(c.resources?.requests?.cpu ?? c.resources?.limits?.cpu);
    if (Number.isNaN(q)) return NaN;
    total += q;
  }
  return total;
}

export function workloadPods(cl: Cluster, target: Obj): Obj[] {
  const sel = fromLabelSelector(target.spec?.selector);
  if (!sel.length) return [];
  return cl.list('Pod', target.metadata.namespace).filter((p) => !isTerminating(p) && matches(sel, p.metadata.labels) && p.status?.phase === 'Running');
}

/** CPU used by a pod in cores: a small idle baseline plus its share of the workload's demand. */
export function podCpu(cl: Cluster, pod: Obj): number {
  let owner: Obj | undefined = pod;
  let demand: number | undefined;
  for (let i = 0; owner && i < 4 && demand === undefined; i++) {
    demand = cl.s.load[owner.metadata.uid];
    if (demand === undefined) owner = cl.controllerOf(owner);
  }
  const base = 0.001 + (parseInt(pod.metadata.uid.slice(0, 2), 16) % 4) * 0.001;
  if (demand === undefined || !owner) return base;
  const peers = owner.kind === 'Pod' ? [pod] : workloadPods(cl, owner).filter(podReady);
  return base + (podReady(pod) ? demand / Math.max(1, peers.length) : 0);
}

export function podMemory(pod: Obj): number {
  const seed = parseInt(pod.metadata.uid.slice(2, 4), 16);
  const img = pod.spec.containers?.[0]?.image || '';
  const base = /postgres|mysql|mongo/.test(img) ? 60 : /redis/.test(img) ? 8 : /nginx|httpd/.test(img) ? 3 : 12;
  return (base + (seed % 7)) * 1024 * 1024;
}

function targetUtilization(h: Obj): number | undefined {
  if (h.apiVersion === 'autoscaling/v1') return h.spec.targetCPUUtilizationPercentage ?? 80;
  const m = (h.spec.metrics || []).find((x: Json) => x.type === 'Resource' && x.resource?.name === 'cpu');
  return m?.resource?.target?.averageUtilization;
}

export function hpaController(cl: Cluster) {
  for (const h of cl.list('HorizontalPodAutoscaler')) {
    const before = JSON.stringify(h);
    const st = (cl.s.hpa[h.metadata.uid] ??= { at: cl.now - SYNC, recommendations: [] });
    if (cl.now - st.at < SYNC) continue;
    st.at = cl.now;
    const ref = h.spec.scaleTargetRef || {};
    const target = cl.get(ref.kind, h.metadata.namespace, ref.name);
    h.status ??= {};
    if (!target || !['Deployment', 'StatefulSet', 'ReplicaSet'].includes(ref.kind)) {
      setCondition(cl, h, 'AbleToScale', 'False', 'FailedGetScale', `the HPA controller was unable to get the target's current scale: ${(ref.kind || '').toLowerCase()}s.apps "${ref.name}" not found`);
      cl.emit(h, 'Warning', 'FailedGetScale', `${(ref.kind || '').toLowerCase()}s.apps "${ref.name}" not found`, 'horizontal-pod-autoscaler');
      if (JSON.stringify(h) !== before) h.metadata.resourceVersion = String(++cl.s.rv);
      continue;
    }
    setCondition(cl, h, 'AbleToScale', 'True', 'ReadyForNewScale', 'recommended size matches current size');
    const current: number = target.spec.replicas ?? 1;
    const pods = workloadPods(cl, target);
    const util = targetUtilization(h);
    let desired = current;
    if (util === undefined) {
      setCondition(cl, h, 'ScalingActive', 'False', 'InvalidMetricSourceType', 'the playground only simulates CPU resource metrics');
    } else {
      const noReq = pods.find((p) => Number.isNaN(cpuRequest(p)) || cpuRequest(p) === 0);
      if (noReq || !pods.length) {
        const msg = noReq ? `failed to get cpu utilization: missing request for cpu in container ${noReq.spec.containers[0].name} of Pod ${noReq.metadata.name}` : 'failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API';
        setCondition(cl, h, 'ScalingActive', 'False', 'FailedGetResourceMetric', `the HPA was unable to compute the replica count: ${msg}`);
        cl.emit(h, 'Warning', 'FailedGetResourceMetric', msg, 'horizontal-pod-autoscaler');
        h.status.currentMetrics = [{ type: 'Resource', resource: { name: 'cpu', current: {} } }];
      } else {
        const ready = pods.filter(podReady);
        const used = ready.reduce((n, p) => n + podCpu(cl, p), 0);
        const req = ready.reduce((n, p) => n + cpuRequest(p), 0);
        const pct = req ? Math.round((used / req) * 100) : 0;
        h.status.currentMetrics = [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: pct, averageValue: `${Math.round((used / Math.max(1, ready.length)) * 1000)}m` } } }];
        setCondition(cl, h, 'ScalingActive', 'True', 'ValidMetricFound', 'the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)');
        const ratio = pct / util;
        desired = Math.abs(ratio - 1) <= 0.1 ? current : Math.ceil(ready.length * ratio);
        if (desired === 0 && current > 0) desired = 1;
      }
    }
    const min = h.spec.minReplicas ?? 1;
    const max = h.spec.maxReplicas;
    let limited = false;
    if (desired > max) {
      desired = max;
      limited = true;
    }
    if (desired < min) {
      desired = min;
      limited = true;
    }
    setCondition(cl, h, 'ScalingLimited', limited ? 'True' : 'False', limited ? (desired === max ? 'TooManyReplicas' : 'TooFewReplicas') : 'DesiredWithinRange', limited ? `the desired replica count is ${desired === max ? 'more than the maximum' : 'less than the minimum'} replica count` : 'the desired count is within the acceptable range');
    // Scale-down stabilization: use the highest recommendation of the window.
    st.recommendations = [...st.recommendations.filter((r) => cl.now - r.t < SCALE_DOWN_WINDOW), { t: cl.now, r: desired }];
    if (desired < current) desired = Math.min(current, Math.max(...st.recommendations.map((r) => r.r)));
    if (desired !== current) {
      const metric = h.status.currentMetrics?.[0]?.resource?.current?.averageUtilization;
      cl.mutate(target, (t) => (t.spec.replicas = desired));
      h.status.lastScaleTime = cl.ts();
      cl.emit(h, 'Normal', 'SuccessfulRescale', `New size: ${desired}; reason: ${desired > current ? `cpu resource utilization (percentage of request) above target` : 'All metrics below target'}${metric !== undefined ? '' : ''}`, 'horizontal-pod-autoscaler');
    }
    h.status.currentReplicas = current;
    h.status.desiredReplicas = desired;
    if (JSON.stringify(h) !== before) h.metadata.resourceVersion = String(++cl.s.rv);
  }
}
