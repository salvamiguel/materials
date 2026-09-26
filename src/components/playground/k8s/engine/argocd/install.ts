// `kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/<version>/manifests/install.yaml`
// installs a lightweight ArgoCD: the same components (as system pods) and
// CRDs as the real manifest. The logic lives in controller.ts and only runs
// while the argocd-application-controller pod is up.

import { deploymentController } from '../controllers/deployment';
import { replicaSetController } from '../controllers/replicaset';
import { statefulSetController } from '../controllers/statefulset';
import { namespaceController } from '../controllers/infra';
import type { Cluster } from '../cluster';
import { ApiError, type ArgoState, type Obj } from '../types';

export const ARGOCD_VERSION = 'v2.13.3';
export const ARGOCD_IMAGE = `quay.io/argoproj/argocd:${ARGOCD_VERSION}`;

export const INSTALL_URL =
  /^https:\/\/(raw\.githubusercontent\.com\/argoproj\/argo-cd\/([^/]+)|github\.com\/argoproj\/argo-cd\/(?:raw|blob)\/([^/]+))\/manifests\/(install|namespace-install|core-install|ha\/install)\.yaml$/;
export const ROLLOUTS_URL = /argoproj\/argo-rollouts/;

export function argo(cl: Cluster): ArgoState | undefined {
  return cl.s.argocd?.installed ? cl.s.argocd : undefined;
}

const labels = (name: string, component: string) => ({
  'app.kubernetes.io/name': name,
  'app.kubernetes.io/part-of': 'argocd',
  'app.kubernetes.io/component': component,
});

function deployment(name: string, component: string, image: string, args: string[], port: number, extra: Obj = {}): Obj {
  return {
    apiVersion: 'apps/v1',
    kind: extra.kind || 'Deployment',
    metadata: { name, labels: labels(name, component) },
    spec: {
      ...(extra.kind === 'StatefulSet' ? { serviceName: name, replicas: 1 } : {}),
      selector: { matchLabels: { 'app.kubernetes.io/name': name } },
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': name } },
        spec: {
          serviceAccountName: 'default',
          containers: [
            {
              name: extra.container || name,
              image,
              args,
              ports: [{ containerPort: port }],
              ...(extra.probe === false ? {} : { readinessProbe: { httpGet: { path: '/healthz', port }, initialDelaySeconds: 3, periodSeconds: 10 } }),
              resources: { requests: { cpu: '10m', memory: '64Mi' } },
            },
          ],
        },
      },
    },
  };
}

function service(name: string, component: string, ports: { name: string; port: number; targetPort: number }[]): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, labels: labels(name, component) },
    spec: { selector: { 'app.kubernetes.io/name': name }, ports: ports.map((p) => ({ ...p, protocol: 'TCP' })) },
  };
}

const CRDS = ['applications', 'applicationsets', 'appprojects'];
const RBAC = [
  'serviceaccount/argocd-application-controller',
  'serviceaccount/argocd-applicationset-controller',
  'serviceaccount/argocd-dex-server',
  'serviceaccount/argocd-notifications-controller',
  'serviceaccount/argocd-redis',
  'serviceaccount/argocd-repo-server',
  'serviceaccount/argocd-server',
  'role.rbac.authorization.k8s.io/argocd-application-controller',
  'role.rbac.authorization.k8s.io/argocd-applicationset-controller',
  'role.rbac.authorization.k8s.io/argocd-dex-server',
  'role.rbac.authorization.k8s.io/argocd-notifications-controller',
  'role.rbac.authorization.k8s.io/argocd-redis',
  'role.rbac.authorization.k8s.io/argocd-server',
];
const CLUSTER_RBAC = [
  'clusterrole.rbac.authorization.k8s.io/argocd-application-controller',
  'clusterrole.rbac.authorization.k8s.io/argocd-applicationset-controller',
  'clusterrole.rbac.authorization.k8s.io/argocd-server',
  'clusterrolebinding.rbac.authorization.k8s.io/argocd-application-controller',
  'clusterrolebinding.rbac.authorization.k8s.io/argocd-applicationset-controller',
  'clusterrolebinding.rbac.authorization.k8s.io/argocd-server',
];

function objects(): Obj[] {
  const cm = (name: string, data: Record<string, string> = {}): Obj => ({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name, labels: labels(name, 'config') },
    data,
  });
  return [
    cm('argocd-cm', { 'timeout.reconciliation': '180s', 'admin.enabled': 'true' }),
    cm('argocd-cmd-params-cm'),
    cm('argocd-gpg-keys-cm'),
    cm('argocd-notifications-cm'),
    cm('argocd-rbac-cm', { 'policy.default': 'role:readonly' }),
    cm('argocd-ssh-known-hosts-cm'),
    cm('argocd-tls-certs-cm'),
    { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'argocd-notifications-secret' }, type: 'Opaque' },
    { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'argocd-secret', labels: labels('argocd-secret', 'server') }, type: 'Opaque' },
    service('argocd-applicationset-controller', 'applicationset-controller', [{ name: 'webhook', port: 7000, targetPort: 7000 }]),
    service('argocd-dex-server', 'dex-server', [{ name: 'http', port: 5556, targetPort: 5556 }]),
    service('argocd-redis', 'redis', [{ name: 'tcp-redis', port: 6379, targetPort: 6379 }]),
    service('argocd-repo-server', 'repo-server', [{ name: 'server', port: 8081, targetPort: 8081 }]),
    service('argocd-server', 'server', [
      { name: 'http', port: 80, targetPort: 8080 },
      { name: 'https', port: 443, targetPort: 8080 },
    ]),
    deployment('argocd-applicationset-controller', 'applicationset-controller', ARGOCD_IMAGE, ['/usr/local/bin/argocd-applicationset-controller'], 7000, {
      probe: false,
    }),
    deployment('argocd-dex-server', 'dex-server', 'ghcr.io/dexidp/dex:v2.41.1', ['rundex'], 5556, { container: 'dex', probe: false }),
    deployment('argocd-notifications-controller', 'notifications-controller', ARGOCD_IMAGE, ['/usr/local/bin/argocd-notifications'], 9001, { probe: false }),
    deployment('argocd-redis', 'redis', 'public.ecr.aws/docker/library/redis:7.0.15-alpine', ['--save', '', '--appendonly', 'no'], 6379, {
      container: 'redis',
      probe: false,
    }),
    deployment('argocd-repo-server', 'repo-server', ARGOCD_IMAGE, ['/usr/local/bin/argocd-repo-server'], 8081, {}),
    deployment('argocd-server', 'server', ARGOCD_IMAGE, ['/usr/local/bin/argocd-server'], 8080, {}),
    deployment('argocd-application-controller', 'application-controller', ARGOCD_IMAGE, ['/usr/local/bin/argocd-application-controller'], 8082, {
      kind: 'StatefulSet',
      probe: false,
    }),
  ];
}

/** Runs the install manifest. Returns kubectl's output and exit code. */
export function installArgoCD(cl: Cluster, ns: string, url: string): { output: string; exitCode: number } {
  const ver = INSTALL_URL.exec(url);
  const version = ver?.[2] || ver?.[3] || 'stable';
  let out = '';
  let code = 0;
  const first = !cl.s.argocd?.installed;
  for (const c of CRDS) out += `customresourcedefinition.apiextensions.k8s.io/${c}.argoproj.io ${first ? 'created' : 'unchanged'}\n`;
  cl.s.argocd = cl.s.argocd?.installed
    ? cl.s.argocd
    : { installed: true, version: /^v\d/.test(version) ? version : ARGOCD_VERSION, namespace: ns, manifests: {}, apps: {}, historyDocs: {}, appsetParams: {} };
  const nsExists = !!cl.get('Namespace', undefined, ns);
  // Namespaced objects are new unless a previous install got them in.
  const nsFirst = !cl.get('ConfigMap', ns, 'argocd-cm');
  for (const r of RBAC) {
    if (nsExists) out += `${r} ${nsFirst ? 'created' : 'unchanged'}\n`;
    else {
      out += `Error from server (NotFound): error when creating "${url}": namespaces "${ns}" not found\n`;
      code = 1;
    }
  }
  for (const r of CLUSTER_RBAC) out += `${r} ${first ? 'created' : 'unchanged'}\n`;
  for (const o of objects()) {
    try {
      const res = cl.apply(o, ns, { file: url, line: 1, via: 'ArgoCD install.yaml' });
      out += `${qn(o.kind)}/${o.metadata.name} ${res.action}\n`;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      out += `Error from server (${e.reason}): error when creating "${url}": ${e.message}\n`;
      code = 1;
    }
  }
  for (const n of [
    'argocd-application-controller-network-policy',
    'argocd-applicationset-controller-network-policy',
    'argocd-dex-server-network-policy',
    'argocd-notifications-controller-network-policy',
    'argocd-redis-network-policy',
    'argocd-repo-server-network-policy',
    'argocd-server-network-policy',
  ]) {
    out += nsExists ? `networkpolicy.networking.k8s.io/${n} ${nsFirst ? 'created' : 'unchanged'}\n` : '';
  }
  // The Deployments' pods exist right away (so `kubectl wait --all` has something to wait for).
  if (nsExists) {
    namespaceController(cl);
    for (let i = 0; i < 2; i++) {
      deploymentController(cl);
      replicaSetController(cl);
      statefulSetController(cl);
    }
  }
  if (ns !== 'argocd' && nsExists) out += `Warning: el playground espera ArgoCD en el namespace "argocd" (lo has instalado en "${ns}").\n`;
  return { output: out, exitCode: code };
}

function qn(kind: string) {
  return (
    { Deployment: 'deployment.apps', StatefulSet: 'statefulset.apps', Service: 'service', ConfigMap: 'configmap', Secret: 'secret' }[kind] || kind.toLowerCase()
  );
}

/** Things argocd-server does when it starts: the admin password and the default project. */
export function serverStartup(cl: Cluster) {
  const a = argo(cl);
  if (!a) return;
  const ns = a.namespace;
  if (!cl.get('Namespace', undefined, ns)) return;
  const server = cl.list('Pod', ns).find((p) => p.metadata.labels?.['app.kubernetes.io/name'] === 'argocd-server' && p.status?.phase === 'Running');
  if (!server) return;
  if (!cl.get('Secret', ns, 'argocd-initial-admin-secret') && !(a as ArgoState & { adminChanged?: boolean }).adminChanged) {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pw = '';
    for (let i = 0; i < 16; i++) pw += chars[Math.floor(cl.random() * chars.length)];
    cl.put({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'argocd-initial-admin-secret', namespace: ns },
      type: 'Opaque',
      data: { password: btoa(pw) },
    });
  }
  if (!cl.get('AppProject', ns, 'default')) {
    cl.put({
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'AppProject',
      metadata: { name: 'default', namespace: ns },
      spec: { sourceRepos: ['*'], destinations: [{ namespace: '*', server: '*' }], clusterResourceWhitelist: [{ group: '*', kind: '*' }] },
    });
  }
}

/** The admin password (from the initial secret), if argocd-server created it. */
export function adminPassword(cl: Cluster): string | undefined {
  const a = argo(cl);
  const s = a && cl.get('Secret', a.namespace, 'argocd-initial-admin-secret');
  return s?.data?.password ? atob(s.data.password) : undefined;
}

/** A pod of the component, Running and Ready. */
export function componentUp(cl: Cluster, name: string): boolean {
  const a = argo(cl);
  if (!a) return false;
  return cl
    .list('Pod', a.namespace)
    .some(
      (p) =>
        p.metadata.labels?.['app.kubernetes.io/name'] === name &&
        !p.metadata.deletionTimestamp &&
        (p.status?.conditions || []).some((c: Obj) => c.type === 'Ready' && c.status === 'True'),
    );
}
