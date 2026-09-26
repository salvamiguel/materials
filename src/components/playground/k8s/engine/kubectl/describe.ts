// kubectl describe (k8s.io/kubectl/pkg/describe), for the common types.

import type { Cluster } from '../cluster';
import { LAST_APPLIED } from '../cluster';
import { condition } from '../controllers/common';
import { deploymentReplicaSets, maxSurge, maxUnavailable, revisionOf } from '../controllers/deployment';
import { resourceByKind } from '../resources';
import type { Obj } from '../types';
import { fromLabelSelector, humanDuration, labelsString, selectorString, unbase64 } from '../util';
import { age, hpaTargets, jobStatus, podStatus, toYaml } from './printers';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const rfc1123 = (ts: string | number) => {
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  return d.toUTCString().replace('GMT', '+0000');
};

/** Lines of "Key:  value" aligned per indentation level, like kubectl's tabwriter. */
class Writer {
  lines: { level: number; key?: string; value: string }[] = [];
  kv(level: number, key: string, value: string | number | undefined) {
    this.lines.push({ level, key, value: value === undefined || value === '' ? '' : String(value) });
  }
  raw(level: number, text: string) {
    this.lines.push({ level, value: text });
  }
  /** Multi-line maps (labels, annotations): first entry on the key's line. */
  map(level: number, key: string, m: Record<string, string> | undefined, skip: string[] = []) {
    const e = Object.entries(m || {})
      .filter(([k]) => !skip.includes(k))
      .sort(([a], [b]) => a.localeCompare(b));
    if (!e.length) return this.kv(level, key, '<none>');
    e.forEach(([k, v], i) => this.lines.push({ level, key: i === 0 ? key : '', value: `${k}=${v}` }));
  }
  toString() {
    const width = new Map<number, number>();
    for (const l of this.lines) if (l.key !== undefined) width.set(l.level, Math.max(width.get(l.level) || 0, l.key.length + 1));
    return (
      this.lines
        .map((l) => {
          const ind = '  '.repeat(l.level);
          if (l.key === undefined) return ind + l.value;
          const w = width.get(l.level)! + 2;
          return (ind + (l.key ? `${l.key}:` : '').padEnd(w) + l.value).trimEnd();
        })
        .join('\n') + '\n'
    );
  }
}

function events(cl: Cluster, o: Obj): string {
  const evs = cl.eventsFor(o);
  if (!evs.length) return 'Events:  <none>\n';
  const rows = [
    ['Type', 'Reason', 'Age', 'From', 'Message'],
    ['----', '------', '----', '----', '-------'],
  ];
  for (const e of evs.slice(-25)) {
    const ageStr = e.count > 1 ? `${humanDuration(cl.now - e.last)} (x${e.count} over ${humanDuration(cl.now - e.first)})` : humanDuration(cl.now - e.first);
    rows.push([e.type, e.reason, ageStr, e.source, e.message]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return 'Events:\n' + rows.map((r) => '  ' + r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] + 2))).join('')).join('\n') + '\n';
}

function header(w: Writer, cl: Cluster, o: Obj, withNs = true) {
  w.kv(0, 'Name', o.metadata.name);
  if (withNs && resourceByKind(o.kind)?.namespaced) w.kv(0, 'Namespace', o.metadata.namespace);
}

function probeString(p: Json): string {
  const how = p.httpGet
    ? `http-get ${p.httpGet.scheme === 'HTTPS' ? 'https' : 'http'}://:${p.httpGet.port}${p.httpGet.path || '/'}`
    : p.tcpSocket
      ? `tcp-socket :${p.tcpSocket.port}`
      : p.exec
        ? `exec [${(p.exec.command || []).join(' ')}]`
        : p.grpc
          ? `grpc <pod>:${p.grpc.port}`
          : 'unknown';
  return `${how} delay=${p.initialDelaySeconds || 0}s timeout=${p.timeoutSeconds || 1}s period=${p.periodSeconds || 10}s #success=${p.successThreshold || 1} #failure=${p.failureThreshold || 3}`;
}

function containerBlock(w: Writer, cl: Cluster, pod: Obj | undefined, c: Json, status: Json | undefined, level: number) {
  w.raw(level, `${c.name}:`);
  const l = level + 1;
  if (status?.containerID) w.kv(l, 'Container ID', status.containerID);
  w.kv(l, 'Image', c.image);
  if (pod) w.kv(l, 'Image ID', status?.imageID || '');
  const ports: Json[] = c.ports || [];
  w.kv(l, ports.length > 1 ? 'Ports' : 'Port', ports.length ? ports.map((p) => `${p.containerPort}/${p.protocol || 'TCP'}`).join(', ') : '<none>');
  w.kv(l, ports.length > 1 ? 'Host Ports' : 'Host Port', ports.length ? ports.map((p) => `${p.hostPort || 0}/${p.protocol || 'TCP'}`).join(', ') : '<none>');
  if (c.command) {
    w.raw(l, 'Command:');
    for (const x of c.command) w.raw(l + 1, x);
  }
  if (c.args) {
    w.raw(l, 'Args:');
    for (const x of c.args) w.raw(l + 1, x);
  }
  if (pod) {
    const st = status?.state || {};
    if (st.running) {
      w.kv(l, 'State', 'Running');
      w.kv(l + 1, 'Started', rfc1123(st.running.startedAt));
    } else if (st.waiting) {
      w.kv(l, 'State', 'Waiting');
      w.kv(l + 1, 'Reason', st.waiting.reason);
      if (st.waiting.message && !/ContainerCreating|PodInitializing/.test(st.waiting.reason)) w.kv(l + 1, 'Message', st.waiting.message);
    } else if (st.terminated) {
      w.kv(l, 'State', 'Terminated');
      w.kv(l + 1, 'Reason', st.terminated.reason);
      w.kv(l + 1, 'Exit Code', st.terminated.exitCode);
      w.kv(l + 1, 'Started', rfc1123(st.terminated.startedAt));
      w.kv(l + 1, 'Finished', rfc1123(st.terminated.finishedAt));
    }
    const last = status?.lastState?.terminated;
    if (last) {
      w.kv(l, 'Last State', 'Terminated');
      w.kv(l + 1, 'Reason', last.reason);
      w.kv(l + 1, 'Exit Code', last.exitCode);
      w.kv(l + 1, 'Started', rfc1123(last.startedAt));
      w.kv(l + 1, 'Finished', rfc1123(last.finishedAt));
    }
    w.kv(l, 'Ready', status?.ready ? 'True' : 'False');
    w.kv(l, 'Restart Count', status?.restartCount || 0);
  }
  for (const kind of ['limits', 'requests'] as const) {
    const r = c.resources?.[kind];
    if (r && Object.keys(r).length) {
      w.raw(l, `${kind === 'limits' ? 'Limits' : 'Requests'}:`);
      for (const [k, v] of Object.entries(r)) w.kv(l + 1, k, String(v));
    }
  }
  if (c.livenessProbe) w.kv(l, 'Liveness', probeString(c.livenessProbe));
  if (c.readinessProbe) w.kv(l, 'Readiness', probeString(c.readinessProbe));
  if (c.startupProbe) w.kv(l, 'Startup', probeString(c.startupProbe));
  if (c.envFrom?.length) {
    w.raw(l, 'Environment Variables from:');
    for (const ef of c.envFrom) {
      const ref = ef.configMapRef || ef.secretRef;
      w.raw(l + 1, `${ref.name}  ${ef.configMapRef ? 'ConfigMap' : 'Secret'}  Optional: ${ref.optional ? 'true' : 'false'}`);
    }
  }
  if (c.env?.length) {
    w.raw(l, 'Environment:');
    for (const e of c.env) {
      let v = e.value;
      if (e.valueFrom?.configMapKeyRef)
        v = `<set to the key '${e.valueFrom.configMapKeyRef.key}' of config map '${e.valueFrom.configMapKeyRef.name}'>  Optional: ${e.valueFrom.configMapKeyRef.optional ? 'true' : 'false'}`;
      else if (e.valueFrom?.secretKeyRef)
        v = `<set to the key '${e.valueFrom.secretKeyRef.key}' in secret '${e.valueFrom.secretKeyRef.name}'>  Optional: ${e.valueFrom.secretKeyRef.optional ? 'true' : 'false'}`;
      else if (e.valueFrom?.fieldRef) v = ` (v1:${e.valueFrom.fieldRef.fieldPath})`;
      w.kv(l + 1, e.name, v ?? '');
    }
  } else if (!c.envFrom?.length) w.kv(l, 'Environment', '<none>');
  w.raw(l, 'Mounts:');
  for (const m of c.volumeMounts || []) w.raw(l + 1, `${m.mountPath} from ${m.name} (${m.readOnly ? 'ro' : 'rw'}${m.subPath ? `,path="${m.subPath}"` : ''})`);
  if (pod) w.raw(l + 1, `/var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-${pod.metadata.uid.slice(0, 5)} (ro)`);
  else if (!(c.volumeMounts || []).length) w.lines[w.lines.length - 1].value = 'Mounts:       <none>';
}

function volumes(w: Writer, spec: Json, pod?: Obj) {
  const vols: Json[] = spec.volumes || [];
  if (!vols.length && !pod) {
    w.kv(1, 'Volumes', '<none>');
    return;
  }
  w.raw(pod ? 0 : 1, 'Volumes:');
  const l = pod ? 1 : 2;
  for (const v of vols) {
    w.raw(l, `${v.name}:`);
    if (v.configMap) {
      w.kv(l + 1, 'Type', 'ConfigMap (a volume populated by a ConfigMap)');
      w.kv(l + 1, 'Name', v.configMap.name);
      w.kv(l + 1, 'Optional', v.configMap.optional ? 'true' : 'false');
    } else if (v.secret) {
      w.kv(l + 1, 'Type', 'Secret (a volume populated by a Secret)');
      w.kv(l + 1, 'SecretName', v.secret.secretName);
      w.kv(l + 1, 'Optional', v.secret.optional ? 'true' : 'false');
    } else if (v.persistentVolumeClaim) {
      w.kv(l + 1, 'Type', 'PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)');
      w.kv(l + 1, 'ClaimName', v.persistentVolumeClaim.claimName);
      w.kv(l + 1, 'ReadOnly', v.persistentVolumeClaim.readOnly ? 'true' : 'false');
    } else if (v.emptyDir) {
      w.kv(l + 1, 'Type', "EmptyDir (a temporary directory that shares a pod's lifetime)");
      w.kv(l + 1, 'Medium', v.emptyDir.medium || '');
      w.kv(l + 1, 'SizeLimit', v.emptyDir.sizeLimit || '<unset>');
    } else if (v.hostPath) {
      w.kv(l + 1, 'Type', 'HostPath (bare host directory volume)');
      w.kv(l + 1, 'Path', v.hostPath.path);
    } else {
      w.kv(l + 1, 'Type', Object.keys(v).filter((k) => k !== 'name')[0] || 'unknown');
    }
  }
  if (pod) {
    w.raw(l, `kube-api-access-${pod.metadata.uid.slice(0, 5)}:`);
    w.kv(l + 1, 'Type', 'Projected (a volume that contains injected data from multiple sources)');
    w.kv(l + 1, 'TokenExpirationSeconds', '3607');
    w.kv(l + 1, 'ConfigMapName', 'kube-root-ca.crt');
    w.kv(l + 1, 'Optional', 'false');
    w.kv(l + 1, 'DownwardAPI', 'true');
  }
}

function podTemplate(w: Writer, cl: Cluster, t: Json) {
  w.raw(0, 'Pod Template:');
  w.map(1, 'Labels', t.metadata?.labels);
  if (t.metadata?.annotations) w.map(1, 'Annotations', t.metadata.annotations);
  if (t.spec?.serviceAccountName) w.kv(1, 'Service Account', t.spec.serviceAccountName);
  if (t.spec?.initContainers?.length) {
    w.raw(1, 'Init Containers:');
    for (const c of t.spec.initContainers) containerBlock(w, cl, undefined, c, undefined, 2);
  }
  w.raw(1, 'Containers:');
  for (const c of t.spec?.containers || []) containerBlock(w, cl, undefined, c, undefined, 2);
  volumes(w, t.spec || {});
  w.kv(1, 'Node-Selectors', labelsString(t.spec?.nodeSelector));
  w.kv(1, 'Tolerations', (t.spec?.tolerations || []).length ? t.spec.tolerations.map(tolerationString).join(', ') : '<none>');
}

function tolerationString(t: Json) {
  return `${t.key || ''}${t.value ? `=${t.value}` : ''}${t.effect ? `:${t.effect}` : ''}${t.operator === 'Exists' ? ' op=Exists' : ''}${t.tolerationSeconds !== undefined ? ` for ${t.tolerationSeconds}s` : ''}`;
}

function annotations(w: Writer, o: Obj) {
  w.map(0, 'Annotations', o.metadata.annotations, [LAST_APPLIED]);
}

export function describe(cl: Cluster, o: Obj): string {
  const w = new Writer();
  header(w, cl, o);
  switch (o.kind) {
    case 'Pod': {
      const ctrl = cl.controllerOf(o);
      w.kv(0, 'Priority', o.spec.priority ?? 0);
      if (o.spec.priorityClassName) w.kv(0, 'Priority Class Name', o.spec.priorityClassName);
      w.kv(0, 'Service Account', o.spec.serviceAccountName || 'default');
      const node = o.spec.nodeName ? cl.get('Node', undefined, o.spec.nodeName) : undefined;
      w.kv(0, 'Node', node ? `${node.metadata.name}/${node.status.addresses[0].address}` : '<none>');
      if (o.status?.startTime) w.kv(0, 'Start Time', rfc1123(o.status.startTime));
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      const st = podStatus(cl, o);
      w.kv(
        0,
        'Status',
        o.metadata.deletionTimestamp
          ? `Terminating (lasts ${humanDuration(cl.now - Date.parse(o.metadata.deletionTimestamp) + (o.metadata.deletionGracePeriodSeconds || 0) * 1000)})`
          : o.status?.phase,
      );
      if (o.metadata.deletionTimestamp) w.kv(0, 'Termination Grace Period', `${o.metadata.deletionGracePeriodSeconds}s`);
      void st;
      w.kv(0, 'IP', o.status?.podIP || '');
      w.raw(0, 'IPs:');
      if (o.status?.podIP) w.kv(1, 'IP', o.status.podIP);
      else w.lines[w.lines.length - 1].value = 'IPs:              <none>';
      if (ctrl) w.kv(0, 'Controlled By', `${ctrl.kind}/${ctrl.metadata.name}`);
      if (o.spec.initContainers?.length) {
        w.raw(0, 'Init Containers:');
        for (const c of o.spec.initContainers)
          containerBlock(
            w,
            cl,
            o,
            c,
            (o.status?.initContainerStatuses || []).find((s: Json) => s.name === c.name),
            1,
          );
      }
      w.raw(0, 'Containers:');
      for (const c of o.spec.containers)
        containerBlock(
          w,
          cl,
          o,
          c,
          (o.status?.containerStatuses || []).find((s: Json) => s.name === c.name),
          1,
        );
      w.raw(0, 'Conditions:');
      const conds: Json[] = o.status?.conditions || [];
      const cw = Math.max(4, ...conds.map((c) => c.type.length)) + 3;
      w.raw(1, 'Type'.padEnd(cw) + 'Status');
      for (const c of conds) w.raw(1, c.type.padEnd(cw) + c.status + ' ');
      volumes(w, o.spec, o);
      w.kv(0, 'QoS Class', o.status?.qosClass || 'BestEffort');
      w.kv(0, 'Node-Selectors', labelsString(o.spec.nodeSelector));
      const tol: Json[] = o.spec.tolerations || [];
      if (!tol.length) w.kv(0, 'Tolerations', '<none>');
      tol.forEach((t, i) => w.lines.push({ level: 0, key: i === 0 ? 'Tolerations' : '', value: tolerationString(t) }));
      break;
    }
    case 'Deployment': {
      w.kv(0, 'CreationTimestamp', rfc1123(o.metadata.creationTimestamp));
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'Selector', selectorString(fromLabelSelector(o.spec.selector)));
      const s = o.status || {};
      w.kv(
        0,
        'Replicas',
        `${o.spec.replicas} desired | ${s.updatedReplicas || 0} updated | ${s.replicas || 0} total | ${s.availableReplicas || 0} available | ${s.unavailableReplicas || 0} unavailable`,
      );
      w.kv(0, 'StrategyType', o.spec.strategy?.type);
      w.kv(0, 'MinReadySeconds', o.spec.minReadySeconds || 0);
      if (o.spec.strategy?.type === 'RollingUpdate') {
        const ru = o.spec.strategy.rollingUpdate || {};
        w.kv(0, 'RollingUpdateStrategy', `${ru.maxUnavailable ?? '25%'} max unavailable, ${ru.maxSurge ?? '25%'} max surge`);
        void maxSurge;
        void maxUnavailable;
      }
      podTemplate(w, cl, o.spec.template);
      w.raw(0, 'Conditions:');
      w.raw(1, 'Type           Status  Reason');
      w.raw(1, '----           ------  ------');
      for (const c of o.status?.conditions || []) w.raw(1, `${c.type.padEnd(15)}${c.status.padEnd(8)}${c.reason}`);
      const { newRS, old } = deploymentReplicaSets(cl, o);
      const rsStr = (r: Obj) => `${r.metadata.name} (${r.status?.replicas || 0}/${r.spec.replicas} replicas created)`;
      const olds = old.filter((r) => r.spec.replicas > 0 || r.status?.replicas > 0);
      w.kv(0, 'OldReplicaSets', olds.length ? olds.map(rsStr).join(', ') : '<none>');
      w.kv(0, 'NewReplicaSet', newRS ? rsStr(newRS) : '<none>');
      break;
    }
    case 'ReplicaSet':
    case 'StatefulSet':
    case 'DaemonSet': {
      if (o.kind === 'StatefulSet') w.kv(0, 'CreationTimestamp', rfc1123(o.metadata.creationTimestamp));
      w.kv(0, 'Selector', selectorString(fromLabelSelector(o.spec.selector)));
      if (o.kind === 'DaemonSet') w.kv(0, 'Node-Selector', labelsString(o.spec.template.spec.nodeSelector));
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      const ctrl = cl.controllerOf(o);
      if (ctrl) w.kv(0, 'Controlled By', `${ctrl.kind}/${ctrl.metadata.name}`);
      const pods = cl.children(o, 'Pod');
      const count = (ph: string) => pods.filter((p) => p.status?.phase === ph && !p.metadata.deletionTimestamp).length;
      if (o.kind === 'DaemonSet') {
        w.kv(0, 'Desired Number of Nodes Scheduled', o.status?.desiredNumberScheduled || 0);
        w.kv(0, 'Current Number of Nodes Scheduled', o.status?.currentNumberScheduled || 0);
        w.kv(0, 'Number of Nodes Scheduled with Up-to-date Pods', o.status?.updatedNumberScheduled || 0);
        w.kv(0, 'Number of Nodes Scheduled with Available Pods', o.status?.numberAvailable || 0);
        w.kv(0, 'Number of Nodes Misscheduled', 0);
      } else {
        w.kv(
          0,
          'Replicas',
          o.kind === 'StatefulSet'
            ? `${o.spec.replicas} desired | ${o.status?.replicas || 0} total`
            : `${o.status?.replicas || 0} current / ${o.spec.replicas} desired`,
        );
      }
      if (o.kind === 'StatefulSet') {
        w.kv(0, 'Update Strategy', o.spec.updateStrategy?.type);
        if (o.spec.updateStrategy?.rollingUpdate) w.kv(1, 'Partition', o.spec.updateStrategy.rollingUpdate.partition ?? 0);
      }
      w.kv(0, 'Pods Status', `${count('Running')} Running / ${count('Pending')} Waiting / ${count('Succeeded')} Succeeded / ${count('Failed')} Failed`);
      podTemplate(w, cl, o.spec.template);
      if (o.kind === 'StatefulSet') {
        const vct: Json[] = o.spec.volumeClaimTemplates || [];
        if (!vct.length) w.kv(0, 'Volume Claims', '<none>');
        else {
          w.raw(0, 'Volume Claims:');
          for (const t of vct) {
            w.kv(1, 'Name', t.metadata?.name);
            w.kv(1, 'StorageClass', t.spec?.storageClassName || '');
            w.map(1, 'Labels', t.metadata?.labels);
            w.map(1, 'Annotations', t.metadata?.annotations);
            w.kv(1, 'Capacity', t.spec?.resources?.requests?.storage);
            w.kv(1, 'Access Modes', (t.spec?.accessModes || []).join(','));
          }
        }
      }
      break;
    }
    case 'Job': {
      w.kv(0, 'Selector', selectorString(fromLabelSelector(o.spec.selector)));
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      const ctrl = cl.controllerOf(o);
      if (ctrl) w.kv(0, 'Controlled By', `${ctrl.kind}/${ctrl.metadata.name}`);
      w.kv(0, 'Parallelism', o.spec.parallelism ?? 1);
      w.kv(0, 'Completions', o.spec.completions ?? 1);
      w.kv(0, 'Completion Mode', o.spec.completionMode || 'NonIndexed');
      w.kv(0, 'Suspend', o.spec.suspend ? 'true' : 'false');
      w.kv(0, 'Backoff Limit', o.spec.backoffLimit ?? 6);
      if (o.status?.startTime) w.kv(0, 'Start Time', rfc1123(o.status.startTime));
      if (o.status?.completionTime) w.kv(0, 'Completed At', rfc1123(o.status.completionTime));
      w.kv(
        0,
        'Pods Statuses',
        `${o.status?.active || 0} Active (${o.status?.ready || 0} Ready) / ${o.status?.succeeded || 0} Succeeded / ${o.status?.failed || 0} Failed`,
      );
      podTemplate(w, cl, o.spec.template);
      w.kv(0, 'Status', jobStatus(o));
      break;
    }
    case 'CronJob': {
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'Schedule', o.spec.schedule);
      w.kv(0, 'Concurrency Policy', o.spec.concurrencyPolicy || 'Allow');
      w.kv(0, 'Suspend', o.spec.suspend ? 'True' : 'False');
      w.kv(0, 'Successful Job History Limit', o.spec.successfulJobsHistoryLimit ?? 3);
      w.kv(0, 'Failed Job History Limit', o.spec.failedJobsHistoryLimit ?? 1);
      w.kv(0, 'Starting Deadline Seconds', o.spec.startingDeadlineSeconds ?? '<unset>');
      w.kv(0, 'Selector', '<unset>');
      w.kv(0, 'Parallelism', o.spec.jobTemplate?.spec?.parallelism ?? '<unset>');
      w.kv(0, 'Completions', o.spec.jobTemplate?.spec?.completions ?? '<unset>');
      podTemplate(w, cl, o.spec.jobTemplate?.spec?.template || {});
      w.kv(0, 'Last Schedule Time', o.status?.lastScheduleTime ? rfc1123(o.status.lastScheduleTime) : '<unset>');
      w.kv(0, 'Active Jobs', (o.status?.active || []).map((j: Json) => j.name).join(', ') || '<none>');
      break;
    }
    case 'Service': {
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'Selector', labelsString(o.spec.selector));
      w.kv(0, 'Type', o.spec.type);
      w.kv(0, 'IP Family Policy', o.spec.ipFamilyPolicy || 'SingleStack');
      w.kv(0, 'IP Families', (o.spec.ipFamilies || ['IPv4']).join(','));
      w.kv(0, 'IP', o.spec.clusterIP);
      w.kv(0, 'IPs', (o.spec.clusterIPs || [o.spec.clusterIP]).join(','));
      if (o.status?.loadBalancer?.ingress)
        w.kv(0, 'LoadBalancer Ingress', o.status.loadBalancer.ingress.map((i: Json) => `${i.ip} (${i.ipMode || 'VIP'})`).join(', '));
      const ep = cl.get('Endpoints', o.metadata.namespace, o.metadata.name);
      for (const p of o.spec.ports || []) {
        w.kv(0, 'Port', `${p.name || '<unset>'}  ${p.port}/${p.protocol}`);
        w.kv(0, 'TargetPort', `${p.targetPort}/${p.protocol}`);
        if (p.nodePort) w.kv(0, 'NodePort', `${p.name || '<unset>'}  ${p.nodePort}/${p.protocol}`);
        const addrs = (ep?.subsets || []).flatMap((s: Json) =>
          (s.addresses || []).map((a: Json) => `${a.ip}:${(s.ports || []).find((x: Json) => x.name === p.name || (s.ports || []).length === 1)?.port}`),
        );
        w.kv(0, 'Endpoints', addrs.length ? addrs.join(',') : '');
      }
      w.kv(0, 'Session Affinity', o.spec.sessionAffinity || 'None');
      if (o.spec.externalTrafficPolicy) w.kv(0, 'External Traffic Policy', o.spec.externalTrafficPolicy);
      w.kv(0, 'Internal Traffic Policy', o.spec.internalTrafficPolicy || 'Cluster');
      break;
    }
    case 'Ingress': {
      w.map(0, 'Labels', o.metadata.labels);
      w.kv(0, 'Namespace', undefined);
      w.lines.pop();
      w.kv(0, 'Address', (o.status?.loadBalancer?.ingress || []).map((x: Json) => x.ip || x.hostname).join(','));
      w.kv(0, 'Ingress Class', o.spec?.ingressClassName || '<none>');
      w.kv(
        0,
        'Default backend',
        o.spec?.defaultBackend?.service
          ? `${o.spec.defaultBackend.service.name}:${o.spec.defaultBackend.service.port?.number ?? o.spec.defaultBackend.service.port?.name}`
          : '<default>',
      );
      w.raw(0, 'Rules:');
      w.raw(1, 'Host        Path  Backends');
      w.raw(1, '----        ----  --------');
      for (const r of o.spec?.rules || []) {
        w.raw(1, r.host || '*');
        for (const p of r.http?.paths || []) {
          const svc = cl.get('Service', o.metadata.namespace, p.backend?.service?.name);
          const ep = svc ? cl.get('Endpoints', o.metadata.namespace, svc.metadata.name) : undefined;
          const ips = (ep?.subsets || []).flatMap((s: Json) => (s.addresses || []).map((a: Json) => `${a.ip}:${s.ports?.[0]?.port}`));
          w.raw(
            3,
            `${p.path || '/'}   ${p.backend?.service?.name}:${p.backend?.service?.port?.number ?? p.backend?.service?.port?.name} (${svc ? ips.join(',') || '<none>' : `<error: services "${p.backend?.service?.name}" not found>`})`,
          );
        }
      }
      annotations(w, o);
      break;
    }
    case 'Node': {
      w.kv(
        0,
        'Roles',
        Object.keys(o.metadata.labels || {})
          .filter((k) => k.startsWith('node-role.kubernetes.io/'))
          .map((k) => k.split('/')[1])
          .join(',') || '<none>',
      );
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'CreationTimestamp', rfc1123(o.metadata.creationTimestamp));
      w.kv(
        0,
        'Taints',
        (o.spec.taints || []).map((t: Json) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`).join('\n                    ') || '<none>',
      );
      w.kv(0, 'Unschedulable', o.spec.unschedulable ? 'true' : 'false');
      w.raw(0, 'Conditions:');
      w.raw(1, 'Type             Status  Reason                       Message');
      w.raw(1, '----             ------  ------                       -------');
      for (const c of o.status.conditions) w.raw(1, `${c.type.padEnd(17)}${c.status.padEnd(8)}${(c.reason || '').padEnd(29)}${c.message || ''}`);
      w.raw(0, 'Addresses:');
      for (const a of o.status.addresses) w.kv(1, a.type, a.address);
      w.raw(0, 'Capacity:');
      for (const [k, v] of Object.entries(o.status.capacity)) w.kv(1, k, String(v));
      w.raw(0, 'System Info:');
      const ni = o.status.nodeInfo;
      w.kv(1, 'Kernel Version', ni.kernelVersion);
      w.kv(1, 'OS Image', ni.osImage);
      w.kv(1, 'Container Runtime Version', ni.containerRuntimeVersion);
      w.kv(1, 'Kubelet Version', ni.kubeletVersion);
      w.kv(0, 'PodCIDR', o.spec.podCIDR);
      const pods = cl.list('Pod').filter((p) => p.spec.nodeName === o.metadata.name && !['Succeeded', 'Failed'].includes(p.status?.phase));
      w.raw(0, `Non-terminated Pods:          (${pods.length} in total)`);
      const rows = [
        ['Namespace', 'Name', 'CPU Requests', 'Memory Requests', 'Age'],
        ['---------', '----', '------------', '---------------', '---'],
      ];
      for (const p of pods) {
        const r = p.spec.containers[0]?.resources?.requests || {};
        rows.push([p.metadata.namespace, p.metadata.name, r.cpu || '0 (0%)', r.memory || '0 (0%)', age(cl, p.metadata.creationTimestamp)]);
      }
      const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
      for (const r of rows)
        w.raw(
          1,
          r
            .map((c, i) => c.padEnd(widths[i] + 2))
            .join('')
            .trimEnd(),
        );
      break;
    }
    case 'ConfigMap':
    case 'Secret': {
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      if (o.kind === 'Secret') w.raw(0, `\nType:  ${o.type || 'Opaque'}`);
      w.raw(0, '\nData\n====');
      for (const [k, v] of Object.entries(o.data || {})) {
        if (o.kind === 'Secret') w.raw(0, `${k}:  ${unbase64(String(v)).length} bytes`);
        else w.raw(0, `${k}:\n----\n${v}\n`);
      }
      if (o.kind === 'ConfigMap') w.raw(0, '\nBinaryData\n====\n');
      break;
    }
    case 'PersistentVolumeClaim': {
      w.kv(0, 'StorageClass', o.spec.storageClassName || '');
      w.kv(0, 'Status', o.metadata.deletionTimestamp ? 'Terminating' : o.status?.phase);
      w.kv(0, 'Volume', o.spec.volumeName || '');
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'Finalizers', `[${(o.metadata.finalizers || []).join(' ')}]`);
      w.kv(0, 'Capacity', o.status?.capacity?.storage || '');
      w.kv(
        0,
        'Access Modes',
        (o.status?.accessModes || []).map((m: string) => ({ ReadWriteOnce: 'RWO', ReadOnlyMany: 'ROX', ReadWriteMany: 'RWX' })[m] || m).join(','),
      );
      w.kv(0, 'VolumeMode', o.spec.volumeMode || 'Filesystem');
      const users = cl
        .list('Pod', o.metadata.namespace)
        .filter((p) => (p.spec.volumes || []).some((v: Json) => v.persistentVolumeClaim?.claimName === o.metadata.name));
      w.kv(0, 'Used By', users.map((p) => p.metadata.name).join('\n                 ') || '<none>');
      break;
    }
    case 'HorizontalPodAutoscaler': {
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'CreationTimestamp', rfc1123(o.metadata.creationTimestamp));
      w.kv(0, 'Reference', `${o.spec.scaleTargetRef?.kind}/${o.spec.scaleTargetRef?.name}`);
      w.raw(0, 'Metrics:                                               ( current / target )');
      w.raw(1, `resource cpu on pods  (as a percentage of request):  ${hpaTargets(o).replace('cpu: ', '').replace('/', ' / ')}`);
      w.kv(0, 'Min replicas', o.spec.minReplicas ?? 1);
      w.kv(0, 'Max replicas', o.spec.maxReplicas);
      w.kv(0, `${o.spec.scaleTargetRef?.kind} pods`, `${o.status?.currentReplicas ?? 0} current / ${o.status?.desiredReplicas ?? 0} desired`);
      w.raw(0, 'Conditions:');
      w.raw(1, 'Type            Status  Reason            Message');
      w.raw(1, '----            ------  ------            -------');
      for (const c of o.status?.conditions || []) w.raw(1, `${c.type.padEnd(16)}${c.status.padEnd(8)}${(c.reason || '').padEnd(18)}${c.message || ''}`);
      break;
    }
    case 'Namespace': {
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      w.kv(0, 'Status', o.status?.phase || 'Active');
      w.raw(0, '\nNo resource quota.\n\nNo LimitRange resource.');
      break;
    }
    default: {
      w.map(0, 'Labels', o.metadata.labels);
      annotations(w, o);
      const { apiVersion, kind, metadata, ...rest } = o; // eslint-disable-line @typescript-eslint/no-unused-vars
      void condition;
      w.raw(0, toYaml(rest).trimEnd());
    }
  }
  if (o.kind === 'Deployment' || o.kind === 'ReplicaSet') void revisionOf;
  return w.toString() + events(cl, o);
}
