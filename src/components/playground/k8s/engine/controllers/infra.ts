// The rest of the control plane: namespaces, garbage collection, storage
// (PVC ↔ PV binding and local-path provisioning), Endpoints, load balancer
// IPs, Ingress status and node failures.

import type { Cluster } from '../cluster';
import { INGRESS_IP } from '../bootstrap';
import type { Obj } from '../types';
import { fromMap, matches, parseQuantity } from '../util';
import { isTerminating, podReady, setCondition } from './common';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Seconds a pod on an unreachable node survives before eviction (real: 300). */
export const EVICTION_MS = 20_000;

export function namespaceController(cl: Cluster) {
  for (const ns of cl.list('Namespace')) {
    const name = ns.metadata.name;
    if (!isTerminating(ns)) {
      if (!cl.get('ServiceAccount', name, 'default')) cl.put({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: name } });
      if (!cl.get('ConfigMap', name, 'kube-root-ca.crt')) {
        cl.put({
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'kube-root-ca.crt',
            namespace: name,
            annotations: {
              'kubernetes.io/description':
                'Contains a CA bundle that can be used to verify the kube-apiserver when using internal endpoints such as the internal service IP or kubernetes.default.svc. No other usage is guaranteed across distributions of Kubernetes clusters.',
            },
          },
          data: { 'ca.crt': '-----BEGIN CERTIFICATE-----\n(simulado)\n-----END CERTIFICATE-----\n' },
        });
      }
      continue;
    }
    // Terminating: delete everything inside, then the namespace.
    let left = 0;
    for (const [key, o] of Object.entries(cl.s.objects)) {
      if (o.metadata.namespace !== name || key.startsWith('Namespace/')) continue;
      left++;
      if (o.kind === 'Pod') cl.deleteObject(o);
      else if (o.kind === 'PersistentVolumeClaim') cl.deleteObject(o);
      else if (!isTerminating(o)) cl.remove(o);
    }
    if (!left) {
      cl.s.events = cl.s.events.filter((e) => e.namespace !== name);
      cl.remove(ns);
    }
  }
}

export function garbageCollector(cl: Cluster) {
  for (const o of Object.values(cl.s.objects)) {
    const refs = o.metadata.ownerReferences as Json[] | undefined;
    if (!refs?.length) continue;
    const alive = refs.some((r) => {
      const owner = cl.get(r.kind, o.metadata.namespace, r.name);
      return owner && owner.metadata.uid === r.uid;
    });
    if (!alive) {
      if (o.kind === 'Pod' || o.kind === 'PersistentVolumeClaim') cl.deleteObject(o);
      else if (!isTerminating(o)) cl.remove(o);
    }
  }
  // Foreground deletion: the owner goes once its dependents are gone.
  for (const o of Object.values(cl.s.objects)) {
    if (!(o.metadata.finalizers || []).includes('foregroundDeletion')) continue;
    const kids = cl.children(o);
    for (const k of kids) {
      if (k.kind === 'Pod') cl.deleteObject(k);
      else if (!isTerminating(k)) cl.deleteObject(k, { cascade: 'foreground' });
    }
    if (!kids.length) cl.remove(o);
  }
}

// ── storage ──────────────────────────────────────────────────────────

function usedBy(cl: Cluster, pvc: Obj): Obj[] {
  return cl
    .list('Pod', pvc.metadata.namespace)
    .filter((p) => (p.spec.volumes || []).some((v: Json) => v.persistentVolumeClaim?.claimName === pvc.metadata.name));
}

function bindClaim(cl: Cluster, pvc: Obj, pv: Obj) {
  cl.mutate(pv, (v) => {
    v.spec.claimRef = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      name: pvc.metadata.name,
      namespace: pvc.metadata.namespace,
      uid: pvc.metadata.uid,
      resourceVersion: pvc.metadata.resourceVersion,
    };
    v.status = { phase: 'Bound', lastPhaseTransitionTime: cl.ts() };
  });
  cl.mutate(pvc, (c) => {
    c.spec.volumeName = pv.metadata.name;
    c.metadata.annotations = { ...(c.metadata.annotations || {}), 'pv.kubernetes.io/bind-completed': 'yes', 'pv.kubernetes.io/bound-by-controller': 'yes' };
    c.status = { phase: 'Bound', accessModes: pv.spec.accessModes, capacity: { ...pv.spec.capacity } };
  });
}

export function storageController(cl: Cluster) {
  for (const pvc of cl.list('PersistentVolumeClaim')) {
    if (isTerminating(pvc)) {
      const running = usedBy(cl, pvc).filter((p) => p.spec.nodeName);
      if (!running.length) {
        cl.remove(pvc);
        const pv = pvc.spec.volumeName ? cl.get('PersistentVolume', undefined, pvc.spec.volumeName) : undefined;
        if (pv) {
          if (pv.spec.persistentVolumeReclaimPolicy === 'Delete') cl.remove(pv);
          else cl.mutate(pv, (v) => (v.status = { phase: 'Released', lastPhaseTransitionTime: cl.ts() }));
        }
      }
      continue;
    }
    if (pvc.status?.phase === 'Bound') {
      const pv = cl.get('PersistentVolume', undefined, pvc.spec.volumeName);
      if (!pv) cl.mutate(pvc, (c) => (c.status = { phase: 'Lost' }));
      continue;
    }
    const want = parseQuantity(pvc.spec.resources?.requests?.storage);
    const modes: string[] = pvc.spec.accessModes || [];
    const scName: string = pvc.spec.storageClassName ?? '';
    // Pre-created volumes first.
    const pv = cl
      .list('PersistentVolume')
      .find(
        (v) =>
          v.status?.phase === 'Available' &&
          !v.spec.claimRef &&
          (pvc.spec.volumeName ? v.metadata.name === pvc.spec.volumeName : true) &&
          (v.spec.storageClassName ?? '') === scName &&
          parseQuantity(v.spec.capacity?.storage) >= want &&
          modes.every((m) => (v.spec.accessModes || []).includes(m)),
      );
    if (pv) {
      bindClaim(cl, pvc, pv);
      continue;
    }
    if (!scName) continue;
    const sc = cl.get('StorageClass', undefined, scName);
    if (!sc) {
      cl.emit(pvc, 'Warning', 'ProvisioningFailed', `storageclass.storage.k8s.io "${scName}" not found`, 'persistentvolume-controller');
      continue;
    }
    const node = pvc.metadata.annotations?.['volume.kubernetes.io/selected-node'];
    if (sc.volumeBindingMode === 'WaitForFirstConsumer' && !node) {
      cl.emit(pvc, 'Normal', 'WaitForFirstConsumer', 'waiting for first consumer to be created before binding', 'persistentvolume-controller');
      continue;
    }
    const age = cl.now - Date.parse(pvc.metadata.creationTimestamp);
    if (!pvc.metadata.annotations?.['volume.kubernetes.io/storage-provisioner']) {
      cl.mutate(
        pvc,
        (c) =>
          (c.metadata.annotations = {
            ...(c.metadata.annotations || {}),
            'volume.beta.kubernetes.io/storage-provisioner': sc.provisioner,
            'volume.kubernetes.io/storage-provisioner': sc.provisioner,
          }),
      );
      cl.emit(
        pvc,
        'Normal',
        'ExternalProvisioning',
        `Waiting for a volume to be created either by the external provisioner '${sc.provisioner}' or manually by the system administrator. If volume creation is delayed, please verify that the provisioner is running and correctly registered.`,
        'persistentvolume-controller',
      );
      cl.emit(
        pvc,
        'Normal',
        'Provisioning',
        `External provisioner is provisioning volume for claim "${pvc.metadata.namespace}/${pvc.metadata.name}"`,
        `${sc.provisioner}_local-path-provisioner`,
      );
      continue;
    }
    if (age < 1500) continue;
    const name = `pvc-${pvc.metadata.uid}`;
    const vol = cl.put({
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: {
        name,
        annotations: { 'local.path.provisioner/selected-node': node || 'playground-worker', 'pv.kubernetes.io/provisioned-by': sc.provisioner },
        finalizers: ['kubernetes.io/pv-protection'],
      },
      spec: {
        accessModes: modes,
        capacity: { storage: pvc.spec.resources.requests.storage },
        hostPath: { path: `/var/local-path-provisioner/${name}_${pvc.metadata.namespace}_${pvc.metadata.name}`, type: 'DirectoryOrCreate' },
        nodeAffinity: {
          required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'kubernetes.io/hostname', operator: 'In', values: [node || 'playground-worker'] }] }] },
        },
        persistentVolumeReclaimPolicy: sc.reclaimPolicy || 'Delete',
        storageClassName: scName,
        volumeMode: pvc.spec.volumeMode || 'Filesystem',
      },
      status: { phase: 'Available' },
    });
    cl.emit(pvc, 'Normal', 'ProvisioningSucceeded', `Successfully provisioned volume ${name}`, `${sc.provisioner}_local-path-provisioner`);
    bindClaim(cl, pvc, vol);
  }
  // Released volumes of deleted claims.
  for (const pv of cl.list('PersistentVolume')) {
    const ref = pv.spec.claimRef;
    if (!ref || pv.status?.phase !== 'Bound') continue;
    const pvc = cl.get('PersistentVolumeClaim', ref.namespace, ref.name);
    if (!pvc || pvc.metadata.uid !== ref.uid) {
      if (pv.spec.persistentVolumeReclaimPolicy === 'Delete') cl.remove(pv);
      else cl.mutate(pv, (v) => (v.status = { phase: 'Released', lastPhaseTransitionTime: cl.ts() }));
    }
  }
}

// ── networking ───────────────────────────────────────────────────────

/** Resolves a Service targetPort (number or named port) for a pod. */
export function targetPortFor(pod: Obj, tp: Json): number | undefined {
  if (typeof tp === 'number') return tp;
  if (/^\d+$/.test(String(tp))) return parseInt(tp, 10);
  for (const c of pod.spec.containers || []) {
    const p = (c.ports || []).find((x: Json) => x.name === tp);
    if (p) return p.containerPort;
  }
  return undefined;
}

export function serviceEndpoints(cl: Cluster, svc: Obj): { ready: Obj[]; notReady: Obj[] } {
  const sel = fromMap(svc.spec.selector);
  if (!sel.length) return { ready: [], notReady: [] };
  const pods = cl
    .list('Pod', svc.metadata.namespace)
    .filter((p) => matches(sel, p.metadata.labels) && p.status?.podIP && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed');
  const ready = pods.filter((p) => podReady(p) || (svc.spec.publishNotReadyAddresses && !isTerminating(p)));
  return { ready, notReady: pods.filter((p) => !ready.includes(p)) };
}

export function networkController(cl: Cluster) {
  const services = cl.list('Service');
  const names = new Set(services.map((s) => `${s.metadata.namespace}/${s.metadata.name}`));
  for (const svc of services) {
    if (!svc.spec.selector || svc.spec.type === 'ExternalName') continue;
    const { ready, notReady } = serviceEndpoints(cl, svc);
    const addr = (p: Obj) => ({
      ip: p.status.podIP,
      nodeName: p.spec.nodeName,
      targetRef: { kind: 'Pod', name: p.metadata.name, namespace: p.metadata.namespace, uid: p.metadata.uid },
      ...(p.spec.hostname && p.spec.subdomain ? { hostname: p.spec.hostname } : {}),
    });
    const ports = (svc.spec.ports || []).map((sp: Json) => ({
      ...(sp.name ? { name: sp.name } : {}),
      port: targetPortFor(ready[0] || notReady[0] || { spec: {} }, sp.targetPort) ?? sp.targetPort,
      protocol: sp.protocol || 'TCP',
      ...(sp.appProtocol ? { appProtocol: sp.appProtocol } : {}),
    }));
    const subsets =
      ready.length || notReady.length
        ? [{ ...(ready.length ? { addresses: ready.map(addr) } : {}), ...(notReady.length ? { notReadyAddresses: notReady.map(addr) } : {}), ports }]
        : undefined;
    const ep = cl.get('Endpoints', svc.metadata.namespace, svc.metadata.name);
    const body: Obj = {
      apiVersion: 'v1',
      kind: 'Endpoints',
      metadata: {
        name: svc.metadata.name,
        namespace: svc.metadata.namespace,
        labels: { ...(svc.metadata.labels || {}), 'endpoints.kubernetes.io/managed-by': 'endpoint-controller' },
      },
      ...(subsets ? { subsets } : {}),
    };
    if (!ep) cl.put(body);
    else {
      const before = JSON.stringify({ s: ep.subsets, l: ep.metadata.labels });
      ep.subsets = body.subsets;
      if (!ep.subsets) delete ep.subsets;
      ep.metadata.labels = body.metadata.labels;
      if (JSON.stringify({ s: ep.subsets, l: ep.metadata.labels }) !== before) ep.metadata.resourceVersion = String(++cl.s.rv);
    }
    if (svc.spec.type === 'LoadBalancer' && !svc.status?.loadBalancer?.ingress && cl.now - Date.parse(svc.metadata.creationTimestamp) >= 1500) {
      const used = new Set(services.flatMap((s) => (s.status?.loadBalancer?.ingress || []).map((i: Json) => i.ip)));
      let ip = svc.metadata.name === 'ingress-nginx-controller' ? INGRESS_IP : '';
      for (let i = 201; !ip || used.has(ip); i++) ip = `172.18.255.${i}`;
      cl.mutate(svc, (s) => (s.status = { loadBalancer: { ingress: [{ ip, ipMode: 'VIP' }] } }));
      cl.emit(svc, 'Normal', 'EnsuredLoadBalancer', 'Ensured load balancer', 'service-controller');
    }
    if (svc.spec.type !== 'LoadBalancer' && svc.status?.loadBalancer?.ingress) cl.mutate(svc, (s) => (s.status = { loadBalancer: {} }));
  }
  for (const ep of cl.list('Endpoints')) {
    if (!names.has(`${ep.metadata.namespace}/${ep.metadata.name}`)) cl.remove(ep);
    else {
      const svc = cl.get('Service', ep.metadata.namespace, ep.metadata.name);
      if (!svc?.spec.selector) cl.remove(ep);
    }
  }
  for (const ing of cl.list('Ingress')) {
    const cls =
      ing.spec?.ingressClassName ??
      cl.list('IngressClass').find((c) => c.metadata.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true')?.metadata.name;
    const ok = cls && cl.get('IngressClass', undefined, cls);
    if (ok && !ing.status?.loadBalancer?.ingress && cl.now - Date.parse(ing.metadata.creationTimestamp) >= 2000) {
      cl.mutate(ing, (i) => (i.status = { loadBalancer: { ingress: [{ ip: INGRESS_IP }] } }));
      cl.emit(ing, 'Normal', 'Sync', 'Scheduled for sync', 'nginx-ingress-controller');
    }
  }
}

// ── nodes ────────────────────────────────────────────────────────────

const UNREACHABLE = 'node.kubernetes.io/unreachable';

export function nodeController(cl: Cluster) {
  for (const node of cl.list('Node')) {
    const down = cl.s.downNodes[node.metadata.uid];
    const before = JSON.stringify(node);
    if (down !== undefined) {
      for (const c of node.status.conditions) {
        if (c.status !== 'Unknown') {
          c.status = 'Unknown';
          c.reason = 'NodeStatusUnknown';
          c.message = 'Kubelet stopped posting node status.';
          c.lastTransitionTime = cl.ts();
        }
      }
      if (!(node.spec.taints || []).some((t: Json) => t.key === UNREACHABLE)) {
        node.spec.taints = [
          ...(node.spec.taints || []),
          { key: UNREACHABLE, effect: 'NoSchedule', timeAdded: cl.ts() },
          { key: UNREACHABLE, effect: 'NoExecute', timeAdded: cl.ts() },
        ];
        cl.emit(node, 'Normal', 'NodeNotReady', `Node ${node.metadata.name} status is now: NodeNotReady`, 'node-controller');
      }
      for (const p of cl.list('Pod').filter((x) => x.spec.nodeName === node.metadata.name)) {
        if (podReady(p)) {
          cl.mutate(p, (x) => {
            setCondition(cl, x, 'Ready', 'False', undefined, undefined, { lastProbeTime: null });
            for (const cs of x.status.containerStatuses || []) cs.ready = false;
          });
          cl.emit(p, 'Warning', 'NodeNotReady', 'Node is not ready', 'node-controller');
        }
        if (
          !isTerminating(p) &&
          cl.now - down >= EVICTION_MS &&
          !(p.metadata.ownerReferences || []).some((r: Json) => r.kind === 'DaemonSet' || r.kind === 'Node')
        ) {
          cl.deleteObject(p);
          cl.emit(p, 'Normal', 'TaintManagerEviction', `Marking for deletion Pod ${p.metadata.namespace}/${p.metadata.name}`, 'taint-eviction-controller');
        }
      }
    } else {
      for (const c of node.status.conditions) {
        const ok = c.type === 'Ready' ? 'True' : 'False';
        if (c.status !== ok) {
          c.status = ok;
          c.reason = c.type === 'Ready' ? 'KubeletReady' : `KubeletHasSufficient${c.type === 'DiskPressure' ? 'Disk' : c.type.replace('Pressure', '')}`;
          c.message = c.type === 'Ready' ? 'kubelet is posting ready status' : c.message;
          c.lastTransitionTime = cl.ts();
          if (c.type === 'Ready') cl.emit(node, 'Normal', 'NodeReady', `Node ${node.metadata.name} status is now: NodeReady`, 'kubelet');
        }
      }
      if ((node.spec.taints || []).some((t: Json) => t.key === UNREACHABLE)) {
        node.spec.taints = node.spec.taints.filter((t: Json) => t.key !== UNREACHABLE);
        if (!node.spec.taints.length) delete node.spec.taints;
      }
    }
    if (JSON.stringify(node) !== before) node.metadata.resourceVersion = String(++cl.s.rv);
  }
}
