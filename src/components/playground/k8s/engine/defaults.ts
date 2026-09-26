// API server defaulting: the fields `kubectl get -o yaml` shows even though
// the manifest didn't set them.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function podSpec(spec: Json) {
  if (!spec) return;
  spec.restartPolicy ??= 'Always';
  spec.terminationGracePeriodSeconds ??= 30;
  spec.dnsPolicy ??= 'ClusterFirst';
  spec.schedulerName ??= 'default-scheduler';
  spec.securityContext ??= {};
  for (const c of [...(spec.initContainers || []), ...(spec.containers || [])]) {
    if (c && typeof c === 'object') {
      if (typeof c.image === 'string') {
        const tag = /:([^/:@]+)$/.exec(c.image)?.[1];
        c.imagePullPolicy ??= !tag || tag === 'latest' ? 'Always' : 'IfNotPresent';
      }
      c.terminationMessagePath ??= '/dev/termination-log';
      c.terminationMessagePolicy ??= 'File';
      c.resources ??= {};
      for (const p of c.ports || []) if (p && typeof p === 'object') p.protocol ??= 'TCP';
      for (const probe of [c.livenessProbe, c.readinessProbe, c.startupProbe]) {
        if (!probe || typeof probe !== 'object') continue;
        probe.timeoutSeconds ??= 1;
        probe.periodSeconds ??= 10;
        probe.successThreshold ??= 1;
        probe.failureThreshold ??= 3;
        if (probe.httpGet) probe.httpGet.scheme ??= 'HTTP';
        if (probe.httpGet) probe.httpGet.path ??= '/';
      }
    }
  }
  for (const v of spec.volumes || []) {
    if (v?.configMap) v.configMap.defaultMode ??= 420;
    if (v?.secret) v.secret.defaultMode ??= 420;
  }
}

function template(t: Json) {
  if (t && typeof t === 'object') {
    t.metadata ??= {};
    podSpec(t.spec);
  }
}

export function applyDefaults(obj: Json) {
  const s = obj.spec;
  switch (obj.kind) {
    case 'Pod':
      podSpec(s);
      break;
    case 'Deployment':
      if (!s) break;
      s.replicas ??= 1;
      s.revisionHistoryLimit ??= 10;
      s.progressDeadlineSeconds ??= 600;
      s.strategy ??= {};
      s.strategy.type ??= 'RollingUpdate';
      if (s.strategy.type === 'RollingUpdate') {
        s.strategy.rollingUpdate ??= {};
        s.strategy.rollingUpdate.maxSurge ??= '25%';
        s.strategy.rollingUpdate.maxUnavailable ??= '25%';
      }
      template(s.template);
      break;
    case 'ReplicaSet':
      if (!s) break;
      s.replicas ??= 1;
      template(s.template);
      break;
    case 'StatefulSet':
      if (!s) break;
      s.replicas ??= 1;
      s.podManagementPolicy ??= 'OrderedReady';
      s.revisionHistoryLimit ??= 10;
      s.updateStrategy ??= {};
      s.updateStrategy.type ??= 'RollingUpdate';
      if (s.updateStrategy.type === 'RollingUpdate') {
        s.updateStrategy.rollingUpdate ??= {};
        s.updateStrategy.rollingUpdate.partition ??= 0;
      }
      s.persistentVolumeClaimRetentionPolicy ??= { whenDeleted: 'Retain', whenScaled: 'Retain' };
      for (const t of s.volumeClaimTemplates || []) {
        t.apiVersion ??= 'v1';
        t.kind ??= 'PersistentVolumeClaim';
        t.spec ??= {};
        t.spec.volumeMode ??= 'Filesystem';
      }
      template(s.template);
      break;
    case 'DaemonSet':
      if (!s) break;
      s.revisionHistoryLimit ??= 10;
      s.updateStrategy ??= {};
      s.updateStrategy.type ??= 'RollingUpdate';
      if (s.updateStrategy.type === 'RollingUpdate') {
        s.updateStrategy.rollingUpdate ??= {};
        s.updateStrategy.rollingUpdate.maxUnavailable ??= 1;
        s.updateStrategy.rollingUpdate.maxSurge ??= 0;
      }
      template(s.template);
      break;
    case 'Job':
      if (!s) break;
      s.completions ??= 1;
      s.parallelism ??= 1;
      s.backoffLimit ??= 6;
      s.completionMode ??= 'NonIndexed';
      s.suspend ??= false;
      s.podReplacementPolicy ??= 'TerminatingOrFailed';
      template(s.template);
      break;
    case 'CronJob':
      if (!s) break;
      s.suspend ??= false;
      s.concurrencyPolicy ??= 'Allow';
      s.successfulJobsHistoryLimit ??= 3;
      s.failedJobsHistoryLimit ??= 1;
      if (s.jobTemplate?.spec) {
        s.jobTemplate.metadata ??= {};
        s.jobTemplate.spec.backoffLimit ??= 6;
        s.jobTemplate.spec.completionMode ??= 'NonIndexed';
        template(s.jobTemplate.spec.template);
      }
      break;
    case 'Service':
      obj.spec ??= {};
      obj.spec.type ??= 'ClusterIP';
      obj.spec.sessionAffinity ??= 'None';
      if (obj.spec.type !== 'ExternalName') {
        obj.spec.internalTrafficPolicy ??= 'Cluster';
        obj.spec.ipFamilies ??= ['IPv4'];
        obj.spec.ipFamilyPolicy ??= 'SingleStack';
      }
      if (obj.spec.type === 'NodePort' || obj.spec.type === 'LoadBalancer') obj.spec.externalTrafficPolicy ??= 'Cluster';
      for (const p of obj.spec.ports || []) {
        if (!p || typeof p !== 'object') continue;
        p.protocol ??= 'TCP';
        p.targetPort ??= p.port;
      }
      break;
    case 'Secret':
      obj.type ??= 'Opaque';
      break;
    case 'PersistentVolumeClaim':
      if (!s) break;
      s.volumeMode ??= 'Filesystem';
      break;
    case 'PersistentVolume':
      if (!s) break;
      s.persistentVolumeReclaimPolicy ??= 'Retain';
      s.volumeMode ??= 'Filesystem';
      break;
    case 'HorizontalPodAutoscaler':
      if (!s) break;
      s.minReplicas ??= 1;
      if (obj.apiVersion === 'autoscaling/v1') {
        s.targetCPUUtilizationPercentage ??= 80;
      } else if (!s.metrics) {
        s.metrics = [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 80 } } }];
      }
      break;
    case 'Ingress':
      for (const r of s?.rules || []) for (const p of r?.http?.paths || []) if (p && typeof p === 'object') p.path ??= '/';
      break;
  }
}
