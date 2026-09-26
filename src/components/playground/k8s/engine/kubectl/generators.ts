// Objects that `kubectl create <type>`, `run`, `expose` and `autoscale` generate.

import type { Obj } from '../types';
import { UsageError } from './args';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function containerNameFromImage(image: string) {
  return image.split('@')[0].split('/').pop()!.split(':')[0].replace(/[^a-z0-9-]/g, '-');
}

export function genDeployment(name: string, image: string, replicas: number, port?: number, command?: string[]): Obj {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { creationTimestamp: null, labels: { app: name }, name },
    spec: {
      replicas,
      selector: { matchLabels: { app: name } },
      strategy: {},
      template: {
        metadata: { creationTimestamp: null, labels: { app: name } },
        spec: {
          containers: [
            {
              image,
              name: containerNameFromImage(image),
              ...(command?.length ? { command } : {}),
              ...(port ? { ports: [{ containerPort: port }] } : {}),
              resources: {},
            },
          ],
        },
      },
    },
    status: {},
  };
}

export function genPod(name: string, image: string, opts: { restart?: string; port?: number; labels?: Record<string, string>; env?: string[]; command?: boolean; rest?: string[] }): Obj {
  const c: Json = { image, name, resources: {} };
  if (opts.rest?.length) {
    if (opts.command) c.command = opts.rest;
    else c.args = opts.rest;
  }
  if (opts.port) c.ports = [{ containerPort: opts.port }];
  if (opts.env?.length) c.env = opts.env.map((e) => ({ name: e.split('=')[0], value: e.split('=').slice(1).join('=') }));
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { creationTimestamp: null, labels: opts.labels || { run: name }, name },
    spec: { containers: [c], dnsPolicy: 'ClusterFirst', restartPolicy: opts.restart || 'Always' },
    status: {},
  };
}

export function genService(name: string, type: string, ports: { port: number; targetPort: number | string; name?: string }[], selector: Record<string, string>, labels?: Record<string, string>): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { creationTimestamp: null, labels: labels || selector, name },
    spec: {
      ports: ports.map((p) => ({ ...(ports.length > 1 ? { name: p.name || `port-${p.port}` } : p.name ? { name: p.name } : {}), port: p.port, protocol: 'TCP', targetPort: p.targetPort })),
      selector,
      ...(type !== 'ClusterIP' ? { type } : {}),
    },
    status: { loadBalancer: {} },
  };
}

export function genConfigMap(name: string, data: Record<string, string>): Obj {
  return { apiVersion: 'v1', data, kind: 'ConfigMap', metadata: { creationTimestamp: null, name } };
}

export function genSecret(name: string, data: Record<string, string>, type = 'Opaque'): Obj {
  const b64: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) b64[k] = btoa(unescape(encodeURIComponent(v)));
  return { apiVersion: 'v1', data: b64, kind: 'Secret', metadata: { creationTimestamp: null, name }, type };
}

export function genNamespace(name: string): Obj {
  return { apiVersion: 'v1', kind: 'Namespace', metadata: { creationTimestamp: null, name }, spec: {}, status: {} };
}

export function genJob(name: string, image: string, command?: string[]): Obj {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { creationTimestamp: null, name },
    spec: { template: { metadata: { creationTimestamp: null }, spec: { containers: [{ image, name, ...(command?.length ? { command } : {}), resources: {} }], restartPolicy: 'Never' } } },
    status: {},
  };
}

export function genCronJob(name: string, image: string, schedule: string, command?: string[]): Obj {
  return {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: { creationTimestamp: null, name },
    spec: {
      jobTemplate: { metadata: { creationTimestamp: null, name }, spec: { template: { metadata: { creationTimestamp: null }, spec: { containers: [{ image, name, ...(command?.length ? { command } : {}), resources: {} }], restartPolicy: 'OnFailure' } } } },
      schedule,
    },
    status: {},
  };
}

/** --rule="host/path=service:port[,tls]" */
export function genIngress(name: string, rules: string[], cls?: string): Obj {
  const byHost = new Map<string, Json[]>();
  for (const r of rules) {
    const m = /^([^/=]*)(\/[^=]*)?=([^:]+):(\S+?)(,tls.*)?$/.exec(r);
    if (!m) throw new UsageError(`error: rule ${r} is invalid and should be in format host/path=svcname:svcport[,tls[=secret]]`);
    const [, host, path = '/', svc, port] = m;
    const exact = !path.endsWith('*');
    const list = byHost.get(host) || [];
    list.push({ backend: { service: { name: svc, port: /^\d+$/.test(port) ? { number: parseInt(port, 10) } : { name: port } } }, path: path.replace(/\*$/, ''), pathType: exact ? 'Exact' : 'Prefix' });
    byHost.set(host, list);
  }
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { creationTimestamp: null, name },
    spec: { ...(cls ? { ingressClassName: cls } : {}), rules: [...byHost.entries()].map(([host, paths]) => ({ ...(host ? { host } : {}), http: { paths } })) },
    status: { loadBalancer: {} },
  };
}

export function genHpa(target: Obj, min: number | undefined, max: number, cpu: number | undefined, name?: string): Obj {
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { creationTimestamp: null, name: name || target.metadata.name },
    spec: {
      maxReplicas: max,
      ...(min !== undefined ? { minReplicas: min } : {}),
      ...(cpu !== undefined ? { metrics: [{ resource: { name: 'cpu', target: { averageUtilization: cpu, type: 'Utilization' } }, type: 'Resource' }] } : {}),
      scaleTargetRef: { apiVersion: target.apiVersion, kind: target.kind, name: target.metadata.name },
    },
    status: { currentMetrics: null, desiredReplicas: 0 },
  };
}
