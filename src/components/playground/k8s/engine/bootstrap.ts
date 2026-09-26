// A fresh cluster like `kind create cluster --name playground` with an
// ingress controller and metrics-server: three nodes, system namespaces and
// the kube-system workloads.

import type { Cluster } from './cluster';
import type { Obj } from './types';
import { applyDefaults } from './defaults';

export const NODES = [
  { name: 'playground-control-plane', ip: '172.18.0.2', cp: true },
  { name: 'playground-worker', ip: '172.18.0.3', cp: false },
  { name: 'playground-worker2', ip: '172.18.0.4', cp: false },
];

export const INGRESS_IP = '172.18.255.200';
export const K8S_VERSION = 'v1.33.1';

const CP_TOLERATION = { key: 'node-role.kubernetes.io/control-plane', operator: 'Exists', effect: 'NoSchedule' };

function node(cl: Cluster, n: (typeof NODES)[number], i: number): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: {
      name: n.name,
      labels: {
        'beta.kubernetes.io/arch': 'amd64',
        'beta.kubernetes.io/os': 'linux',
        'kubernetes.io/arch': 'amd64',
        'kubernetes.io/hostname': n.name,
        'kubernetes.io/os': 'linux',
        ...(n.cp ? { 'node-role.kubernetes.io/control-plane': '', 'node.kubernetes.io/exclude-from-external-load-balancers': '' } : {}),
        ...(n.cp ? {} : { 'ingress-ready': i === 1 ? 'true' : 'false' }),
      },
      annotations: { 'node.alpha.kubernetes.io/ttl': '0', 'volumes.kubernetes.io/controller-managed-attach-detach': 'true' },
    },
    spec: {
      podCIDR: `10.244.${i}.0/24`,
      podCIDRs: [`10.244.${i}.0/24`],
      providerID: `kind://docker/playground/${n.name}`,
      ...(n.cp ? { taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] } : {}),
    },
    status: {
      capacity: { cpu: '4', 'ephemeral-storage': '102626232Ki', 'hugepages-2Mi': '0', memory: '8138112Ki', pods: '110' },
      allocatable: { cpu: '4', 'ephemeral-storage': '102626232Ki', 'hugepages-2Mi': '0', memory: '8138112Ki', pods: '110' },
      conditions: ['MemoryPressure', 'DiskPressure', 'PIDPressure', 'Ready'].map((type) => ({
        type,
        status: type === 'Ready' ? 'True' : 'False',
        lastHeartbeatTime: cl.ts(),
        lastTransitionTime: cl.ts(),
        reason:
          type === 'Ready'
            ? 'KubeletReady'
            : `KubeletHasNo${type === 'PIDPressure' ? 'PID' : type.replace('Pressure', '')}Pressure`
                .replace('HasNoMemoryPressure', 'HasSufficientMemory')
                .replace('HasNoDiskPressure', 'HasNoDiskPressure')
                .replace('HasNoPIDPressure', 'HasSufficientPID'),
        message:
          type === 'Ready'
            ? 'kubelet is posting ready status'
            : `kubelet has ${type === 'MemoryPressure' ? 'sufficient memory available' : type === 'DiskPressure' ? 'no disk pressure' : 'sufficient PID available'}`,
      })),
      addresses: [
        { type: 'InternalIP', address: n.ip },
        { type: 'Hostname', address: n.name },
      ],
      nodeInfo: {
        architecture: 'amd64',
        bootID: `${i}b7c9e1e-5d0a-4a6b-9a1f-0c${i}e3d2f1a9b`,
        containerRuntimeVersion: 'containerd://2.1.1',
        kernelVersion: '6.8.0-45-generic',
        kubeProxyVersion: '',
        kubeletVersion: K8S_VERSION,
        machineID: `8e1f${i}c3a0d9b4e7f8a2c5d6b1e0f9a3${i}`,
        operatingSystem: 'linux',
        osImage: 'Debian GNU/Linux 12 (bookworm)',
        systemUUID: `4f1c${i}e2a-9d3b-4c7e-8a1f-2b6d0e9c3a7${i}`,
      },
    },
  };
}

function deployment(ns: string, name: string, image: string, replicas: number, labels: Record<string, string>, extra: Obj = {}): Obj {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: ns, labels, annotations: { 'deployment.kubernetes.io/revision': '1' } },
    spec: {
      replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [{ name: name.replace(/-controller$/, '').replace('local-path-provisioner', 'local-path-provisioner'), image, ...extra.container }],
          ...extra.pod,
        },
      },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: extra.maxUnavailable ?? 1 } },
      revisionHistoryLimit: 10,
      progressDeadlineSeconds: 600,
    },
    status: {},
  };
}

export function bootstrap(cl: Cluster) {
  const start = cl.now;
  // The cluster was created a few minutes ago.
  cl.s.now = start - 7 * 60_000;
  NODES.forEach((n, i) => cl.put(node(cl, n, i)));
  for (const ns of ['default', 'kube-system', 'kube-public', 'kube-node-lease', 'local-path-storage', 'ingress-nginx']) {
    const o: Obj = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } };
    cl.admit(o);
    cl.put(o);
  }
  cl.put({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'kube-root-ca.crt', namespace: 'default' },
    data: { 'ca.crt': '-----BEGIN CERTIFICATE-----\nMIIDBTCCAe2gAwIBAgIIX2... (simulado)\n-----END CERTIFICATE-----\n' },
  });
  cl.put({
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: 'standard', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
    provisioner: 'rancher.io/local-path',
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'WaitForFirstConsumer',
  });
  cl.put({
    apiVersion: 'networking.k8s.io/v1',
    kind: 'IngressClass',
    metadata: { name: 'nginx', annotations: { 'ingressclass.kubernetes.io/is-default-class': 'true' }, labels: { 'app.kubernetes.io/name': 'ingress-nginx' } },
    spec: { controller: 'k8s.io/ingress-nginx' },
  });
  const svc = (
    ns: string,
    name: string,
    ip: string,
    ports: Obj[],
    selector: Record<string, string> | undefined,
    type = 'ClusterIP',
    labels?: Record<string, string>,
  ) => {
    const o: Obj = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace: ns, ...(labels ? { labels } : {}) },
      spec: {
        type,
        clusterIP: ip,
        ports,
        ...(selector ? { selector } : {}),
        sessionAffinity: 'None',
        internalTrafficPolicy: 'Cluster',
        ipFamilies: ['IPv4'],
        ipFamilyPolicy: 'SingleStack',
      },
    };
    cl.admit(o);
    cl.put(o);
  };
  svc('default', 'kubernetes', '10.96.0.1', [{ name: 'https', port: 443, protocol: 'TCP', targetPort: 6443 }], undefined, 'ClusterIP', {
    component: 'apiserver',
    provider: 'kubernetes',
  });
  svc(
    'kube-system',
    'kube-dns',
    '10.96.0.10',
    [
      { name: 'dns', port: 53, protocol: 'UDP', targetPort: 53 },
      { name: 'dns-tcp', port: 53, protocol: 'TCP', targetPort: 53 },
      { name: 'metrics', port: 9153, protocol: 'TCP', targetPort: 9153 },
    ],
    { 'k8s-app': 'kube-dns' },
    'ClusterIP',
    { 'k8s-app': 'kube-dns', 'kubernetes.io/name': 'CoreDNS' },
  );
  svc('kube-system', 'metrics-server', '10.96.83.21', [{ name: 'https', port: 443, protocol: 'TCP', targetPort: 10250 }], { 'k8s-app': 'metrics-server' });
  svc(
    'ingress-nginx',
    'ingress-nginx-controller',
    '10.96.140.12',
    [
      { name: 'http', port: 80, protocol: 'TCP', targetPort: 80, nodePort: 31080, appProtocol: 'http' },
      { name: 'https', port: 443, protocol: 'TCP', targetPort: 443, nodePort: 31443, appProtocol: 'https' },
    ],
    { 'app.kubernetes.io/name': 'ingress-nginx', 'app.kubernetes.io/component': 'controller' },
    'LoadBalancer',
  );

  const sys = [
    deployment(
      'kube-system',
      'coredns',
      'registry.k8s.io/coredns/coredns:v1.12.0',
      2,
      { 'k8s-app': 'kube-dns' },
      {
        container: {
          args: ['-conf', '/etc/coredns/Corefile'],
          ports: [{ containerPort: 53, name: 'dns', protocol: 'UDP' }],
          resources: { requests: { cpu: '100m', memory: '70Mi' }, limits: { memory: '170Mi' } },
        },
        pod: { tolerations: [CP_TOLERATION], nodeSelector: { 'kubernetes.io/os': 'linux' }, priorityClassName: 'system-cluster-critical' },
      },
    ),
    deployment(
      'kube-system',
      'metrics-server',
      'registry.k8s.io/metrics-server/metrics-server:v0.7.2',
      1,
      { 'k8s-app': 'metrics-server' },
      {
        container: { args: ['--kubelet-insecure-tls'], resources: { requests: { cpu: '100m', memory: '200Mi' } } },
        maxUnavailable: 0,
      },
    ),
    deployment(
      'local-path-storage',
      'local-path-provisioner',
      'docker.io/kindest/local-path-provisioner:v20250214-acbabc1a',
      1,
      { app: 'local-path-provisioner' },
      {
        pod: { tolerations: [CP_TOLERATION], nodeSelector: { 'kubernetes.io/os': 'linux' } },
      },
    ),
    deployment(
      'ingress-nginx',
      'ingress-nginx-controller',
      'registry.k8s.io/ingress-nginx/controller:v1.11.2',
      1,
      { 'app.kubernetes.io/name': 'ingress-nginx', 'app.kubernetes.io/component': 'controller' },
      {
        container: {
          args: ['/nginx-ingress-controller', '--election-id=ingress-nginx-leader', '--controller-class=k8s.io/ingress-nginx'],
          ports: [
            { containerPort: 80, name: 'http' },
            { containerPort: 443, name: 'https' },
          ],
          resources: { requests: { cpu: '100m', memory: '90Mi' } },
        },
        pod: { nodeSelector: { 'ingress-ready': 'true', 'kubernetes.io/os': 'linux' }, tolerations: [CP_TOLERATION] },
      },
    ),
  ];
  const ds = (name: string, image: string, labels: Record<string, string>) => ({
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: { name, namespace: 'kube-system', labels },
    spec: {
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: { containers: [{ name, image }], tolerations: [{ operator: 'Exists' }], hostNetwork: true, priorityClassName: 'system-node-critical' },
      },
      updateStrategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } },
      revisionHistoryLimit: 10,
    },
    status: {},
  });
  for (const o of [
    ...sys,
    ds('kube-proxy', `registry.k8s.io/kube-proxy:${K8S_VERSION}`, { 'k8s-app': 'kube-proxy' }),
    ds('kindnet', 'docker.io/kindest/kindnetd:v20250214-acbabc1a', { app: 'kindnet', 'k8s-app': 'kindnet', tier: 'node' }),
  ]) {
    applyDefaults(o);
    cl.put(o);
  }
  // Static pods of the control plane (mirror pods owned by the node).
  const cp = cl.get('Node', undefined, NODES[0].name)!;
  const statics: [string, string, string][] = [
    ['etcd', 'registry.k8s.io/etcd:3.5.21-0', '100m'],
    ['kube-apiserver', `registry.k8s.io/kube-apiserver:${K8S_VERSION}`, '250m'],
    ['kube-controller-manager', `registry.k8s.io/kube-controller-manager:${K8S_VERSION}`, '200m'],
    ['kube-scheduler', `registry.k8s.io/kube-scheduler:${K8S_VERSION}`, '100m'],
  ];
  for (const [name, image, cpu] of statics) {
    const pod: Obj = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: `${name}-${NODES[0].name}`,
        namespace: 'kube-system',
        labels: { component: name, tier: 'control-plane' },
        annotations: { 'kubernetes.io/config.mirror': 'a1b2c3', 'kubernetes.io/config.source': 'file' },
        ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: cp.metadata.name, uid: cp.metadata.uid, controller: true }],
      },
      spec: {
        containers: [{ name, image, resources: { requests: { cpu } } }],
        nodeName: NODES[0].name,
        hostNetwork: true,
        priorityClassName: 'system-node-critical',
        priority: 2000001000,
        tolerations: [{ operator: 'Exists', effect: 'NoExecute' }],
        restartPolicy: 'Always',
        terminationGracePeriodSeconds: 30,
      },
    };
    applyDefaults(pod);
    pod.status = { phase: 'Pending', qosClass: 'Burstable' };
    cl.put(pod);
  }
  // Let the controllers bring everything up, then jump to "now".
  cl.advance(20_000);
  cl.s.now = start;
  cl.advance(1000);
  // Nobody needs bootstrap noise in `kubectl get events`.
  cl.s.events = [];
}
