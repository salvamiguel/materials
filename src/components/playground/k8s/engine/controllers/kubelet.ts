// Scheduler + kubelet: puts pods on nodes and walks them through their life
// (image pull, init containers, start, probes, restarts with back-off,
// termination), writing a realistic pod status and events.

import type { Cluster } from '../cluster';
import { program, type Program } from '../runtime';
import type { ContainerRt, FaultKind, Obj, PodRt } from '../types';
import { parseQuantity, stableJson } from '../util';
import { condition, isTerminating, setCondition } from './common';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const BACKOFF_MAX = 300_000;

// program() parses commands and resolves env vars: cache it for a couple of simulated seconds.
const programs = new Map<string, { at: number; image: string; prog: Program }>();
function cachedProgram(cl: Cluster, pod: Obj, c: Json): Program {
  const key = `${pod.metadata.uid}/${c.name}`;
  const hit = programs.get(key);
  if (hit && hit.image === c.image && cl.now - hit.at < 2000 && cl.now >= hit.at) return hit.prog;
  const prog = program(cl, pod, c);
  programs.set(key, { at: cl.now, image: c.image, prog });
  if (programs.size > 2000) programs.clear();
  return prog;
}
/** Time for a container to stop after SIGTERM when it handles it. */
const QUICK_STOP = 1500;

export function faultFor(cl: Cluster, pod: Obj): FaultKind | undefined {
  let cur: Obj | undefined = pod;
  for (let i = 0; cur && i < 4; i++) {
    const f = cl.s.faults[cur.metadata.uid];
    if (f) return f;
    cur = cl.controllerOf(cur);
  }
  return undefined;
}

export function nodeReady(cl: Cluster, node: Obj) {
  return !cl.s.downNodes[node.metadata.uid];
}

// ── scheduler ────────────────────────────────────────────────────────

function tolerates(pod: Obj, taint: Json) {
  return (pod.spec.tolerations || []).some(
    (t: Json) =>
      (t.operator === 'Exists' && (!t.key || t.key === taint.key) && (!t.effect || t.effect === taint.effect)) ||
      (t.key === taint.key && (t.operator || 'Equal') === 'Equal' && (t.value || '') === (taint.value || '') && (!t.effect || t.effect === taint.effect)),
  );
}

export function podRequests(pod: Obj): { cpu: number; memory: number } {
  let cpu = 0;
  let memory = 0;
  for (const c of pod.spec.containers || []) {
    const r = c.resources?.requests || {};
    const l = c.resources?.limits || {};
    const cq = parseQuantity(r.cpu ?? l.cpu);
    const mq = parseQuantity(r.memory ?? l.memory);
    if (!Number.isNaN(cq)) cpu += cq;
    if (!Number.isNaN(mq)) memory += mq;
  }
  return { cpu, memory };
}

function nodeAffinityOk(pod: Obj, node: Obj) {
  const terms = pod.spec.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms;
  if (!terms?.length) return true;
  const labels = node.metadata.labels || {};
  return terms.some((t: Json) =>
    (t.matchExpressions || []).every((e: Json) => {
      const has = e.key in labels;
      switch (e.operator) {
        case 'In':
          return has && (e.values || []).includes(labels[e.key]);
        case 'NotIn':
          return !has || !(e.values || []).includes(labels[e.key]);
        case 'Exists':
          return has;
        case 'DoesNotExist':
          return !has;
        default:
          return true;
      }
    }),
  );
}

function schedule(cl: Cluster, pod: Obj, rt: PodRt) {
  if (rt.lastSchedAttempt !== undefined && cl.now - rt.lastSchedAttempt < 1000) return;
  rt.lastSchedAttempt = cl.now;
  const nodes = cl.list('Node');
  const reasons: Record<string, number> = {};
  const add = (r: string) => (reasons[r] = (reasons[r] || 0) + 1);

  // PVCs must exist, and immediate-binding ones must be bound.
  for (const v of pod.spec.volumes || []) {
    if (!v.persistentVolumeClaim) continue;
    const pvc = cl.get('PersistentVolumeClaim', pod.metadata.namespace, v.persistentVolumeClaim.claimName);
    if (!pvc) return unschedulable(cl, pod, `0/${nodes.length} nodes are available: persistentvolumeclaim "${v.persistentVolumeClaim.claimName}" not found. preemption: 0/${nodes.length} nodes are available: ${nodes.length} Preemption is not helpful for scheduling.`);
    if (isTerminating(pvc)) return unschedulable(cl, pod, `0/${nodes.length} nodes are available: persistentvolumeclaim "${pvc.metadata.name}" is being deleted.`);
    const sc = cl.get('StorageClass', undefined, pvc.spec.storageClassName || '');
    if (pvc.status?.phase !== 'Bound' && (!sc || sc.volumeBindingMode !== 'WaitForFirstConsumer')) {
      return unschedulable(cl, pod, `0/${nodes.length} nodes are available: pod has unbound immediate PersistentVolumeClaims. preemption: 0/${nodes.length} nodes are available: ${nodes.length} Preemption is not helpful for scheduling.`);
    }
  }

  const req = podRequests(pod);
  const fits: { node: Obj; score: number }[] = [];
  for (const node of nodes) {
    if (!nodeReady(cl, node)) {
      add("node(s) had untolerated taint {node.kubernetes.io/unreachable: }");
      continue;
    }
    if (node.spec.unschedulable && !tolerates(pod, { key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' })) {
      add('node(s) were unschedulable');
      continue;
    }
    const taint = (node.spec.taints || []).find((t: Json) => (t.effect === 'NoSchedule' || t.effect === 'NoExecute') && !tolerates(pod, t));
    if (taint) {
      add(`node(s) had untolerated taint {${taint.key}: ${taint.value || ''}}`);
      continue;
    }
    const sel = pod.spec.nodeSelector || {};
    if (Object.entries(sel).some(([k, v]) => node.metadata.labels?.[k] !== v) || !nodeAffinityOk(pod, node)) {
      add("node(s) didn't match Pod's node affinity/selector");
      continue;
    }
    const onNode = cl.list('Pod').filter((p) => p.spec.nodeName === node.metadata.name && p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed');
    const used = onNode.reduce((a, p) => {
      const r = podRequests(p);
      return { cpu: a.cpu + r.cpu, memory: a.memory + r.memory };
    }, { cpu: 0, memory: 0 });
    const cap = { cpu: parseQuantity(node.status.allocatable.cpu), memory: parseQuantity(node.status.allocatable.memory) };
    if (onNode.length >= parseInt(node.status.allocatable.pods, 10)) {
      add('Too many pods');
      continue;
    }
    if (used.cpu + req.cpu > cap.cpu) {
      add('Insufficient cpu');
      continue;
    }
    if (used.memory + req.memory > cap.memory) {
      add('Insufficient memory');
      continue;
    }
    // Spread: fewer pods of the same owner and less requested CPU score higher.
    const owner = pod.metadata.ownerReferences?.[0]?.uid;
    const siblings = onNode.filter((p) => owner && p.metadata.ownerReferences?.[0]?.uid === owner).length;
    fits.push({ node, score: -siblings * 10 - used.cpu / cap.cpu - onNode.length * 0.01 + cl.random() * 0.001 });
  }
  if (!fits.length) {
    const parts = Object.entries(reasons)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([r, n]) => `${n} ${r}`);
    return unschedulable(cl, pod, `0/${nodes.length} nodes are available: ${parts.join(', ')}. preemption: 0/${nodes.length} nodes are available: ${nodes.length} Preemption is not helpful for scheduling.`);
  }
  fits.sort((a, b) => b.score - a.score);
  bind(cl, pod, rt, fits[0].node.metadata.name);
}

function unschedulable(cl: Cluster, pod: Obj, message: string) {
  setCondition(cl, pod, 'PodScheduled', 'False', 'Unschedulable', message, { lastProbeTime: null });
  cl.emit(pod, 'Warning', 'FailedScheduling', message, 'default-scheduler');
}

function bind(cl: Cluster, pod: Obj, rt: PodRt, nodeName: string) {
  pod.spec.nodeName = nodeName;
  setCondition(cl, pod, 'PodScheduled', 'True', undefined, undefined, { lastProbeTime: null });
  const c = condition(pod, 'PodScheduled');
  delete c.reason;
  delete c.message;
  cl.emit(pod, 'Normal', 'Scheduled', `Successfully assigned ${pod.metadata.namespace}/${pod.metadata.name} to ${nodeName}`, 'default-scheduler');
  // WaitForFirstConsumer claims get provisioned on this node now.
  for (const v of pod.spec.volumes || []) {
    if (!v.persistentVolumeClaim) continue;
    const pvc = cl.get('PersistentVolumeClaim', pod.metadata.namespace, v.persistentVolumeClaim.claimName);
    if (pvc && pvc.status?.phase !== 'Bound' && !pvc.metadata.annotations?.['volume.kubernetes.io/selected-node']) {
      cl.mutate(pvc, (p) => (p.metadata.annotations = { ...(p.metadata.annotations || {}), 'volume.kubernetes.io/selected-node': nodeName }));
    }
  }
  rt.stage = 'pulling';
  rt.since = cl.now;
}

// ── kubelet ──────────────────────────────────────────────────────────

function allocIp(cl: Cluster, pod: Obj): string {
  const node = cl.get('Node', undefined, pod.spec.nodeName);
  if (pod.spec.hostNetwork) return node?.status.addresses[0].address || '172.18.0.2';
  const cidr = node?.spec.podCIDR || '10.244.1.0/24';
  const prefix = cidr.split('.').slice(0, 3).join('.');
  const used = new Set(cl.list('Pod').map((p) => p.status?.podIP));
  for (let i = 2; i < 255; i++) {
    const ip = `${prefix}.${2 + ((i * 37 + Math.floor(cl.random() * 7)) % 252)}`;
    if (!used.has(ip)) return ip;
  }
  return `${prefix}.254`;
}

function crt(cl: Cluster): ContainerRt {
  return { state: 'waiting', reason: 'ContainerCreating', since: cl.now, restarts: 0, ready: false, logs: [], prevLogs: [] };
}

function log(cl: Cluster, c: ContainerRt, lines: string[]) {
  for (const text of lines) c.logs.push({ t: cl.now, text });
  if (c.logs.length > 400) c.logs.splice(0, c.logs.length - 400);
}

/** ConfigMaps/Secrets/PVCs the pod needs that don't exist (or aren't bound). */
function missingMount(cl: Cluster, pod: Obj): string | undefined {
  const ns = pod.metadata.namespace;
  for (const v of pod.spec.volumes || []) {
    if (v.configMap && !v.configMap.optional && !cl.get('ConfigMap', ns, v.configMap.name)) return `MountVolume.SetUp failed for volume "${v.name}" : configmap "${v.configMap.name}" not found`;
    if (v.secret && !v.secret.optional && !cl.get('Secret', ns, v.secret.secretName)) return `MountVolume.SetUp failed for volume "${v.name}" : secret "${v.secret.secretName}" not found`;
    if (v.persistentVolumeClaim) {
      const pvc = cl.get('PersistentVolumeClaim', ns, v.persistentVolumeClaim.claimName);
      if (!pvc || pvc.status?.phase !== 'Bound') return `WAIT:${v.persistentVolumeClaim.claimName}`;
    }
  }
  return undefined;
}

function missingEnv(cl: Cluster, pod: Obj, c: Json): string | undefined {
  const ns = pod.metadata.namespace;
  for (const e of c.env || []) {
    const cm = e.valueFrom?.configMapKeyRef;
    if (cm && !cm.optional) {
      const o = cl.get('ConfigMap', ns, cm.name);
      if (!o) return `configmap "${cm.name}" not found`;
      if (!(cm.key in (o.data || {}))) return `couldn't find key ${cm.key} in ConfigMap ${ns}/${cm.name}`;
    }
    const sk = e.valueFrom?.secretKeyRef;
    if (sk && !sk.optional) {
      const o = cl.get('Secret', ns, sk.name);
      if (!o) return `secret "${sk.name}" not found`;
      if (!(sk.key in (o.data || {}))) return `couldn't find key ${sk.key} in Secret ${ns}/${sk.name}`;
    }
  }
  for (const ef of c.envFrom || []) {
    if (ef.configMapRef && !ef.configMapRef.optional && !cl.get('ConfigMap', ns, ef.configMapRef.name)) return `configmap "${ef.configMapRef.name}" not found`;
    if (ef.secretRef && !ef.secretRef.optional && !cl.get('Secret', ns, ef.secretRef.name)) return `secret "${ef.secretRef.name}" not found`;
  }
  return undefined;
}

function probePort(c: Json, probe: Json): number | undefined {
  const p = probe.httpGet?.port ?? probe.tcpSocket?.port ?? probe.grpc?.port;
  if (p === undefined) return undefined;
  if (typeof p === 'number') return p;
  const named = (c.ports || []).find((x: Json) => x.name === p);
  return named ? named.containerPort : parseInt(p, 10);
}

/** Whether a probe passes against the running program. */
function probePasses(pod: Obj, c: Json, prog: Program, probe: Json, fault: FaultKind | undefined, kind: 'readiness' | 'liveness'): { ok: boolean; msg: string } {
  if (fault === 'unready' && kind === 'readiness') {
    return { ok: false, msg: probe?.httpGet ? `HTTP probe failed with statuscode: 503` : 'probe failed (marcado como degradado)' };
  }
  if (!probe) return { ok: true, msg: '' };
  if (probe.exec) return { ok: true, msg: '' };
  const port = probePort(c, probe);
  const ip = pod.status?.podIP;
  if (port !== undefined && !prog.ports.includes(port)) {
    return {
      ok: false,
      msg: probe.httpGet ? `Get "http://${ip}:${port}${probe.httpGet.path || '/'}": dial tcp ${ip}:${port}: connect: connection refused` : `dial tcp ${ip}:${port}: connect: connection refused`,
    };
  }
  if (probe.httpGet && prog.mode !== 'server') return { ok: false, msg: `Get "http://${ip}:${port}${probe.httpGet.path}": net/http: HTTP/1.x transport connection broken: malformed HTTP response` };
  if (probe.httpGet && /nginx/.test(c.image) && !['/', '/index.html', ''].includes(probe.httpGet.path || '/') && !/health|ready|live|status/.test(probe.httpGet.path)) {
    return { ok: false, msg: `HTTP probe failed with statuscode: 404` };
  }
  return { ok: true, msg: '' };
}

function backoff(restarts: number) {
  return Math.min(BACKOFF_MAX, 10_000 * 2 ** Math.max(0, restarts - 1));
}

export function kubelet(cl: Cluster) {
  for (const pod of cl.list('Pod')) {
    const before = JSON.stringify(pod);
    const uid = pod.metadata.uid;
    const rt: PodRt = (cl.s.pods[uid] ??= { stage: 'scheduling', since: cl.now, containers: {} });

    if (isTerminating(pod)) {
      terminate(cl, pod, rt);
      if (cl.get('Pod', pod.metadata.namespace, pod.metadata.name) && JSON.stringify(pod) !== before) pod.metadata.resourceVersion = String(++cl.s.rv);
      continue;
    }
    if (!pod.spec.nodeName) {
      schedule(cl, pod, rt);
      if (!pod.spec.nodeName) {
        writeStatus(cl, pod, rt);
        if (JSON.stringify(pod) !== before) pod.metadata.resourceVersion = String(++cl.s.rv);
        continue;
      }
    }
    if (!condition(pod, 'PodScheduled')) setCondition(cl, pod, 'PodScheduled', 'True', undefined, undefined, { lastProbeTime: null });
    const node = cl.get('Node', undefined, pod.spec.nodeName);
    if (node && !nodeReady(cl, node)) {
      // The kubelet is gone: nothing changes until the node comes back.
      if (JSON.stringify(pod) !== before) pod.metadata.resourceVersion = String(++cl.s.rv);
      continue;
    }
    if (rt.stage === 'scheduling') {
      rt.stage = 'pulling';
      rt.since = cl.now;
    }
    runPod(cl, pod, rt);
    writeStatus(cl, pod, rt);
    if (JSON.stringify(pod) !== before) pod.metadata.resourceVersion = String(++cl.s.rv);
  }
}

function terminate(cl: Cluster, pod: Obj, rt: PodRt) {
  const deadline = Date.parse(pod.metadata.deletionTimestamp);
  const graceStart = deadline - (pod.metadata.deletionGracePeriodSeconds ?? 30) * 1000;
  for (const c of Object.values(rt.containers)) c.ready = false;
  for (const cs of pod.status?.containerStatuses || []) cs.ready = false;
  setCondition(cl, pod, 'Ready', 'False', undefined, undefined, { lastProbeTime: null });
  setCondition(cl, pod, 'ContainersReady', 'False', undefined, undefined, { lastProbeTime: null });
  const node = pod.spec.nodeName ? cl.get('Node', undefined, pod.spec.nodeName) : undefined;
  if (node && !nodeReady(cl, node)) return; // stuck Terminating until the node returns (or --force)
  if (!rt.killed) {
    rt.killed = true;
    for (const c of pod.spec.containers || []) {
      if (rt.containers[c.name]?.state === 'running') cl.emit(pod, 'Normal', 'Killing', `Stopping container ${c.name}`, 'kubelet', `spec.containers{${c.name}}`);
    }
  }
  // Processes that handle SIGTERM stop quickly; a shell running `sleep` (PID 1) ignores it and waits for SIGKILL.
  const running = Object.entries(rt.containers).filter(([, c]) => c.state === 'running');
  const slow = running.some(([name]) => {
    const c = (pod.spec.containers || []).find((x: Json) => x.name === name);
    if (!c) return false;
    const p = cachedProgram(cl, pod, c);
    return p.mode === 'forever' && ((c.command || []).length > 0 || (c.args || []).length > 0) && !p.ports.length;
  });
  const doneAt = running.length === 0 ? graceStart : slow ? deadline : Math.min(deadline, graceStart + QUICK_STOP);
  if (cl.now >= doneAt) {
    cl.remove(pod);
  }
}

function runPod(cl: Cluster, pod: Obj, rt: PodRt) {
  const fault = faultFor(cl, pod);
  const node: string = pod.spec.nodeName;
  const cache = (cl.s.images[node] ??= []);

  if (!pod.status.podIP && rt.stage !== 'blocked') {
    const miss = missingMount(cl, pod);
    if (miss) {
      rt.stage = 'blocked';
      rt.blockedBy = miss;
    }
  }
  if (rt.stage === 'blocked') {
    const miss = missingMount(cl, pod);
    if (miss) {
      if (!miss.startsWith('WAIT:') && cl.now - rt.since >= 2000) cl.emit(pod, 'Warning', 'FailedMount', miss, 'kubelet');
      rt.blockedBy = miss;
      return;
    }
    rt.stage = 'pulling';
    rt.blockedBy = undefined;
    rt.since = cl.now;
  }
  if (!pod.status.podIP && cl.now - rt.since >= 300) {
    pod.status.podIP = allocIp(cl, pod);
    pod.status.podIPs = [{ ip: pod.status.podIP }];
    pod.status.hostIP = cl.get('Node', undefined, node)?.status.addresses[0].address;
    pod.status.hostIPs = [{ ip: pod.status.hostIP }];
    pod.status.startTime = cl.ts();
    setCondition(cl, pod, 'PodReadyToStartContainers', 'True', undefined, undefined, { lastProbeTime: null });
  }
  if (!pod.status.podIP) return;

  const inits: Json[] = pod.spec.initContainers || [];
  const mains: Json[] = pod.spec.containers || [];
  const restartPolicy = pod.spec.restartPolicy || 'Always';

  // Init containers, one after another.
  for (const c of inits) {
    const st = (rt.containers[c.name] ??= crt(cl));
    if (st.state === 'terminated' && st.exitCode === 0) continue;
    step(cl, pod, rt, c, st, cache, fault, restartPolicy === 'Always' ? 'OnFailure' : restartPolicy, true);
    const now = rt.containers[c.name];
    if (!(now.state === 'terminated' && now.exitCode === 0)) {
      setCondition(cl, pod, 'Initialized', 'False', 'ContainersNotInitialized', `containers with incomplete status: [${inits.filter((x) => !(rt.containers[x.name]?.state === 'terminated' && rt.containers[x.name]?.exitCode === 0)).map((x) => x.name).join(' ')}]`, { lastProbeTime: null });
      for (const m of mains) {
        const ms = (rt.containers[m.name] ??= crt(cl));
        ms.reason = 'PodInitializing';
      }
      return;
    }
  }
  setCondition(cl, pod, 'Initialized', 'True', undefined, undefined, { lastProbeTime: null });
  const ic = condition(pod, 'Initialized');
  delete ic.reason;
  delete ic.message;

  for (const c of mains) {
    const st = (rt.containers[c.name] ??= crt(cl));
    if (st.reason === 'PodInitializing') st.reason = 'ContainerCreating';
    step(cl, pod, rt, c, st, cache, fault, restartPolicy, false);
  }
}

/** Advances one container. */
function step(cl: Cluster, pod: Obj, rt: PodRt, c: Json, st: ContainerRt, cache: string[], fault: FaultKind | undefined, restartPolicy: string, init: boolean) {
  const field = `spec.${init ? 'initContainers' : 'containers'}{${c.name}}`;
  const prog = cachedProgram(cl, pod, c);
  const now = cl.now;

  if (st.state === 'waiting') {
    // Back-off after a crash or a failed pull.
    if (st.next !== undefined && now < st.next) {
      if (st.reason === 'CrashLoopBackOff' || st.reason === 'ImagePullBackOff') {
        if (Math.floor((now - st.since) / 5000) !== Math.floor((now - 250 - st.since) / 5000)) {
          cl.emit(pod, 'Warning', 'BackOff', st.reason === 'CrashLoopBackOff' ? `Back-off restarting failed container ${c.name} in pod ${pod.metadata.name}_${pod.metadata.namespace}(${pod.metadata.uid})` : `Back-off pulling image "${c.image}"`, 'kubelet', field);
        }
      }
      return;
    }
    // Pull.
    const pullErr = prog.pullError || (fault === 'imagepull' ? `failed to pull and unpack image "docker.io/library/${c.image}": failed to resolve reference: unexpected status from HEAD request: 404 Not Found (fallo simulado)` : undefined);
    const cached = cache.includes(c.image);
    const alwaysPull = c.imagePullPolicy === 'Always';
    if (!st.pulledAt || st.reason === 'ErrImagePull' || st.reason === 'ImagePullBackOff') {
      if (pullErr) {
        if (!st.pulling) {
          st.pulling = now;
          cl.emit(pod, 'Normal', 'Pulling', `Pulling image "${c.image}"`, 'kubelet', field);
          return;
        }
        if (now - st.pulling < 1500) return;
        st.pulling = undefined;
        const attempts = (st.pullFails = (st.pullFails || 0) + 1);
        cl.emit(pod, 'Warning', 'Failed', `Failed to pull image "${c.image}": ${pullErr === 'InvalidImageName' ? 'invalid reference format' : pullErr}`, 'kubelet', field);
        cl.emit(pod, 'Warning', 'Failed', pullErr === 'InvalidImageName' ? 'Error: InvalidImageName' : 'Error: ErrImagePull', 'kubelet', field);
        const reason = pullErr === 'InvalidImageName' ? 'InvalidImageName' : attempts > 1 ? 'ImagePullBackOff' : 'ErrImagePull';
        st.reason = reason;
        st.message = reason === 'ImagePullBackOff' ? `Back-off pulling image "${c.image}": ErrImagePull: ${pullErr}` : pullErr;
        st.since = now;
        st.next = now + (attempts > 1 ? backoff(attempts - 1) : 2000);
        if (reason === 'ErrImagePull') {
          st.next = now + 2000;
          st.toBackoff = true;
        }
        return;
      }
      if (st.toBackoff) st.toBackoff = false;
      if (cached && !alwaysPull) {
        cl.emit(pod, 'Normal', 'Pulled', `Container image "${c.image}" already present on machine`, 'kubelet', field);
        st.pulledAt = now;
      } else {
        if (!st.pulling) {
          st.pulling = now;
          cl.emit(pod, 'Normal', 'Pulling', `Pulling image "${c.image}"`, 'kubelet', field);
          return;
        }
        const took = cached ? 700 : prog.pullMs;
        if (now - st.pulling < took) return;
        st.pulling = undefined;
        const secs = (took / 1000).toFixed(3);
        cl.emit(pod, 'Normal', 'Pulled', `Successfully pulled image "${c.image}" in ${secs}s (${secs}s including waiting). Image size: ${40 + Math.floor(cl.random() * 60)}${Math.floor(cl.random() * 900 + 100)}${Math.floor(cl.random() * 900 + 100)} bytes.`, 'kubelet', field);
        if (!cache.includes(c.image)) cache.push(c.image);
        st.pulledAt = now;
      }
      st.pullFails = 0;
    }
    // Config errors surface once the image is there.
    const envErr = missingEnv(cl, pod, c);
    if (envErr) {
      if (st.reason !== 'CreateContainerConfigError') cl.emit(pod, 'Warning', 'Failed', `Error: ${envErr}`, 'kubelet', field);
      st.reason = 'CreateContainerConfigError';
      st.message = envErr;
      return;
    }
    // Start.
    if (!st.createdAt) {
      st.createdAt = now;
      cl.emit(pod, 'Normal', 'Created', `Created container: ${c.name}`, 'kubelet', field);
      return;
    }
    if (now - st.createdAt < 300) return;
    st.createdAt = undefined;
    cl.emit(pod, 'Normal', 'Started', `Started container ${c.name}`, 'kubelet', field);
    st.state = 'running';
    st.reason = undefined;
    st.message = undefined;
    st.since = now;
    st.next = undefined;
    st.loopAt = 0;
    st.livenessFailAt = undefined;
    st.ready = false;
    st.pulledAt = undefined;
    log(cl, st, prog.startLogs);
    if (fault === 'crash') log(cl, st, ['panic: runtime error: invalid memory address or nil pointer dereference (fallo simulado)', '[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x6a4b2c]']);
    return;
  }

  if (st.state === 'running') {
    const up = now - st.since;
    // Loop output.
    if (prog.loop && up >= (st.loopAt ?? 0) * prog.loop.periodMs) {
      log(cl, st, prog.loop.lines.map((l) => (l === '{DATE}' ? new Date(now).toUTCString().replace('GMT', 'UTC') : l)));
      st.loopAt = (st.loopAt ?? 0) + 1;
    }
    // Exits.
    let exit: { code: number; reason: string; logs: string[] } | undefined;
    if (fault === 'crash' && up >= 2000) exit = { code: 1, reason: 'Error', logs: ['exit status 1'] };
    else if (fault === 'oom' && up >= 3000) exit = { code: 137, reason: 'OOMKilled', logs: [] };
    else if (prog.mode === 'exit' && up >= prog.runMs) exit = { code: prog.exitCode, reason: prog.exitCode === 0 ? 'Completed' : 'Error', logs: prog.exitLogs };
    if (!exit && !init) {
      // Liveness.
      const lp = c.livenessProbe;
      if (lp) {
        const delay = (lp.initialDelaySeconds || 0) * 1000;
        const r = probePasses(pod, c, prog, lp, fault, 'liveness');
        if (up >= delay && !r.ok) {
          st.livenessFailAt ??= now;
          const period = (lp.periodSeconds || 10) * 1000;
          if (Math.floor((now - st.livenessFailAt) / period) !== Math.floor((now - 250 - st.livenessFailAt) / period) || now === st.livenessFailAt) {
            cl.emit(pod, 'Warning', 'Unhealthy', `Liveness probe failed: ${r.msg}`, 'kubelet', field);
          }
          if (now - st.livenessFailAt >= period * ((lp.failureThreshold || 3) - 1) + 250) {
            cl.emit(pod, 'Normal', 'Killing', `Container ${c.name} failed liveness probe, will be restarted`, 'kubelet', field);
            exit = { code: 137, reason: 'Error', logs: [] };
          }
        } else if (r.ok) st.livenessFailAt = undefined;
      }
      // Readiness.
      const rp = c.readinessProbe;
      const delay = (rp?.initialDelaySeconds || 0) * 1000 + (rp ? 500 : 0);
      const r = probePasses(pod, c, prog, rp, fault, 'readiness');
      if (!exit) {
        if (r.ok && up >= delay) {
          if (!st.ready) st.readyAt = now;
          st.ready = true;
        } else if (!r.ok && up >= delay) {
          if (st.ready || up - delay < 250 || Math.floor((up - delay) / ((rp?.periodSeconds || 10) * 1000)) !== Math.floor((up - delay - 250) / ((rp?.periodSeconds || 10) * 1000))) {
            cl.emit(pod, 'Warning', 'Unhealthy', `Readiness probe failed: ${r.msg}`, 'kubelet', field);
          }
          st.ready = false;
        }
      }
    }
    if (exit) {
      log(cl, st, exit.logs);
      st.last = { reason: exit.reason, exitCode: exit.code, startedAt: st.since, finishedAt: now };
      st.state = 'terminated';
      st.exitCode = exit.code;
      st.reason = exit.reason;
      st.ready = false;
      st.since = now;
      const restart = restartPolicy === 'Always' || (restartPolicy === 'OnFailure' && exit.code !== 0);
      if (restart) {
        st.restarts++;
        st.next = now + backoff(st.restarts);
      }
    }
    return;
  }

  // terminated
  const restart = restartPolicy === 'Always' || (restartPolicy === 'OnFailure' && st.exitCode !== 0);
  if (!restart) return;
  if (st.next !== undefined && now < st.next) {
    // Show CrashLoopBackOff while waiting (after the first restart).
    if (now - st.since >= 250) {
      st.prevLogs = st.logs;
      st.logs = [];
      st.state = 'waiting';
      st.reason = 'CrashLoopBackOff';
      st.message = `back-off ${Math.round(backoff(st.restarts) / 1000) >= 60 ? `${Math.round(backoff(st.restarts) / 60000)}m0s` : `${Math.round(backoff(st.restarts) / 1000)}s`} restarting failed container=${c.name} pod=${pod.metadata.name}_${pod.metadata.namespace}(${pod.metadata.uid})`;
      st.since = now;
      st.pulledAt = now; // image is there
    }
    return;
  }
}

function writeStatus(cl: Cluster, pod: Obj, rt: PodRt) {
  const s = pod.status;
  const statuses = (list: Json[]) =>
    list.map((c) => {
      const st = rt.containers[c.name];
      const cs: Json = {
        name: c.name,
        image: c.image,
        imageID: '',
        ready: !!st?.ready,
        restartCount: st?.restarts || 0,
        started: st?.state === 'running',
      };
      if (!st || st.state === 'waiting') {
        cs.state = { waiting: { reason: st?.reason || 'ContainerCreating', ...(st?.message ? { message: st.message } : {}) } };
      } else if (st.state === 'running') {
        cs.state = { running: { startedAt: cl.ts(st.since) } };
        cs.containerID = `containerd://${pod.metadata.uid.replace(/-/g, '')}${c.name.length}`;
        cs.imageID = `docker.io/library/${c.image}@sha256:${pod.metadata.uid.replace(/-/g, '').slice(0, 16)}`;
      } else {
        cs.state = { terminated: { exitCode: st.exitCode, reason: st.reason, startedAt: cl.ts(st.last?.startedAt ?? st.since), finishedAt: cl.ts(st.since), containerID: `containerd://${pod.metadata.uid.replace(/-/g, '')}` } };
      }
      if (st?.last && !(st.state === 'terminated')) {
        cs.lastState = { terminated: { exitCode: st.last.exitCode, reason: st.last.reason, startedAt: cl.ts(st.last.startedAt), finishedAt: cl.ts(st.last.finishedAt), containerID: `containerd://${pod.metadata.uid.replace(/-/g, '')}` } };
      } else cs.lastState = {};
      return cs;
    });
  const mains: Json[] = pod.spec.containers || [];
  const inits: Json[] = pod.spec.initContainers || [];
  if (pod.spec.nodeName) {
    s.containerStatuses = statuses(mains);
    if (inits.length) s.initContainerStatuses = statuses(inits);
  }
  const allReady = mains.every((c) => rt.containers[c.name]?.ready);
  // Phase.
  const states = mains.map((c) => rt.containers[c.name]);
  const policy = pod.spec.restartPolicy || 'Always';
  let phase = 'Pending';
  const allDone = states.every((st) => st?.state === 'terminated');
  if (allDone && policy === 'Never') {
    phase = states.every((st) => st!.exitCode === 0) ? 'Succeeded' : 'Failed';
  } else if (allDone && policy === 'OnFailure' && states.every((st) => st!.exitCode === 0)) {
    phase = 'Succeeded';
  } else if (states.some((st) => st && (st.state === 'running' || st.state === 'terminated' || (st.state === 'waiting' && st.restarts > 0)))) {
    phase = 'Running';
  }
  s.phase = phase;
  if (pod.spec.nodeName) {
    const readyStatus = allReady && phase === 'Running' ? 'True' : 'False';
    const notReady = mains.filter((c) => !rt.containers[c.name]?.ready).map((c) => c.name);
    const reason = phase === 'Succeeded' || phase === 'Failed' ? 'PodCompleted' : 'ContainersNotReady';
    const msg = phase === 'Succeeded' || phase === 'Failed' ? undefined : `containers with unready status: [${notReady.join(' ')}]`;
    for (const t of ['ContainersReady', 'Ready']) {
      if (readyStatus === 'True') {
        setCondition(cl, pod, t, 'True', undefined, undefined, { lastProbeTime: null });
        const cond = condition(pod, t);
        delete cond.reason;
        delete cond.message;
      } else setCondition(cl, pod, t, 'False', reason, msg, { lastProbeTime: null });
    }
    if (phase === 'Succeeded' || phase === 'Failed') setCondition(cl, pod, 'PodReadyToStartContainers', 'False', undefined, undefined, { lastProbeTime: null });
  }
  // Canonical condition order.
  const order = ['PodReadyToStartContainers', 'Initialized', 'Ready', 'ContainersReady', 'PodScheduled'];
  s.conditions?.sort((a: Json, b: Json) => order.indexOf(a.type) - order.indexOf(b.type));
}
