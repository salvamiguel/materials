// ArgoCD's health assessment (gitops-engine pkg/health) for the native kinds.

import type { Cluster } from '../cluster';
import { podReady } from '../controllers/common';
import { jobFinished } from '../controllers/job';
import { rolloutStatusOnce } from '../kubectl/streams';
import type { Obj } from '../types';

export type HealthStatus = 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown';

export interface Health {
  status: HealthStatus;
  message?: string;
}

/** Worst first, like ArgoCD aggregates an Application. */
const ORDER: HealthStatus[] = ['Healthy', 'Suspended', 'Progressing', 'Missing', 'Degraded', 'Unknown'];

export function worst(a: HealthStatus, b: HealthStatus): HealthStatus {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** undefined: the kind has no health (ConfigMap, Secret…). */
export function healthOf(cl: Cluster, o: Obj | undefined): Health | undefined {
  if (!o) return { status: 'Missing' };
  switch (o.kind) {
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet': {
      if (o.kind === 'Deployment' && o.spec.paused) return { status: 'Suspended', message: 'Deployment is paused' };
      const r = rolloutStatusOnce(cl, o);
      if (r.error) return { status: 'Degraded', message: r.error.replace(/^error: /, '') };
      if (!r.done) return { status: 'Progressing', message: r.msg };
      return { status: 'Healthy' };
    }
    case 'ReplicaSet':
      return (o.status?.availableReplicas || 0) >= (o.spec.replicas ?? 1)
        ? { status: 'Healthy' }
        : {
            status: 'Progressing',
            message: `Waiting for rollout to finish: ${o.status?.availableReplicas || 0} of ${o.spec.replicas} replicas are available...`,
          };
    case 'Pod': {
      const phase = o.status?.phase;
      if (phase === 'Succeeded') return { status: 'Healthy', message: 'Pod completed successfully' };
      if (phase === 'Failed') return { status: 'Degraded', message: o.status?.message || 'Pod failed' };
      const bad = (o.status?.containerStatuses || []).find((c: Json) =>
        /CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|InvalidImageName/.test(c.state?.waiting?.reason || ''),
      );
      if (bad) return { status: 'Degraded', message: bad.state.waiting.message || bad.state.waiting.reason };
      if (phase === 'Running' && podReady(o)) return { status: 'Healthy' };
      return { status: 'Progressing' };
    }
    case 'Service':
      if (o.spec.type === 'LoadBalancer' && !o.status?.loadBalancer?.ingress?.length) return { status: 'Progressing', message: 'Waiting for load balancer' };
      return { status: 'Healthy' };
    case 'Ingress':
      return o.status?.loadBalancer?.ingress?.length ? { status: 'Healthy' } : { status: 'Progressing' };
    case 'PersistentVolumeClaim':
      if (o.status?.phase === 'Bound') return { status: 'Healthy' };
      if (o.status?.phase === 'Lost') return { status: 'Degraded' };
      return { status: 'Progressing', message: 'PVC is not bound' };
    case 'Job': {
      const f = jobFinished(o);
      if (f === 'Complete') return { status: 'Healthy', message: 'Job completed' };
      if (f === 'Failed') return { status: 'Degraded', message: 'Job has reached the specified backoff limit' };
      return o.spec.suspend ? { status: 'Suspended' } : { status: 'Progressing' };
    }
    case 'CronJob':
      return o.spec.suspend ? { status: 'Suspended' } : { status: 'Healthy' };
    case 'HorizontalPodAutoscaler':
      return { status: 'Healthy' };
    case 'Application':
      return o.status?.health?.status ? { status: o.status.health.status } : { status: 'Unknown' };
    default:
      return undefined;
  }
}
