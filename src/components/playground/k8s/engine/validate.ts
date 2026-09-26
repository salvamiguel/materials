// Server-side validation with the API server's messages
// ("The Deployment "web" is invalid: …").

import { dnsLabelError, dnsSubdomainError, fromLabelSelector, goMap, isObject, matches, parseQuantity } from './util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function validateObject(obj: Json): string[] {
  const errs: string[] = [];
  const name: string = obj.metadata?.name ?? '';
  if (!name) errs.push('metadata.name: Required value: name or generateName is required');
  else {
    const e = ['Service', 'Namespace'].includes(obj.kind) ? dnsLabelError(name) : dnsSubdomainError(name);
    if (e) errs.push(`metadata.name: Invalid value: ${JSON.stringify(name)}: ${e}`);
  }
  for (const [k, v] of Object.entries(obj.metadata?.labels || {})) {
    if (typeof v === 'string' && (v.length > 63 || !/^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/.test(v))) {
      errs.push(
        `metadata.labels: Invalid value: ${JSON.stringify(v)}: a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character`,
      );
    }
    if (!/^([a-z0-9.-]+\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(k)) {
      errs.push(`metadata.labels: Invalid value: ${JSON.stringify(k)}: name part must consist of alphanumeric characters, '-', '_' or '.'`);
    }
  }
  const s = obj.spec;
  switch (obj.kind) {
    case 'Pod':
      podSpec(s, 'spec', errs);
      break;
    case 'Deployment':
    case 'ReplicaSet':
    case 'StatefulSet':
    case 'DaemonSet':
      workload(obj, errs);
      if (obj.kind === 'Deployment' && s?.strategy?.type === 'RollingUpdate') {
        const ru = s.strategy.rollingUpdate || {};
        if ((ru.maxSurge === 0 || ru.maxSurge === '0%') && (ru.maxUnavailable === 0 || ru.maxUnavailable === '0%')) {
          errs.push(
            'spec.strategy.rollingUpdate.maxUnavailable: Invalid value: intstr.IntOrString{Type:0, IntVal:0, StrVal:""}: may not be 0 when `maxSurge` is 0',
          );
        }
      }
      if (obj.kind === 'Deployment' && s?.strategy?.type === 'Recreate' && s.strategy.rollingUpdate) {
        errs.push("spec.strategy.rollingUpdate: Forbidden: may not be specified when strategy `type` is 'Recreate'");
      }
      if (obj.kind === 'Deployment' && s?.strategy?.type && !['RollingUpdate', 'Recreate'].includes(s.strategy.type)) {
        errs.push(`spec.strategy.type: Unsupported value: ${JSON.stringify(s.strategy.type)}: supported values: "Recreate", "RollingUpdate"`);
      }
      if (obj.kind === 'StatefulSet' && s?.podManagementPolicy && !['OrderedReady', 'Parallel'].includes(s.podManagementPolicy)) {
        errs.push(`spec.podManagementPolicy: Unsupported value: ${JSON.stringify(s.podManagementPolicy)}: supported values: "OrderedReady", "Parallel"`);
      }
      break;
    case 'Job':
      if (!s?.template) errs.push('spec.template: Required value');
      else {
        podSpec(s.template.spec, 'spec.template.spec', errs);
        const rp = s.template.spec?.restartPolicy;
        if (rp && rp !== 'OnFailure' && rp !== 'Never') {
          errs.push(`spec.template.spec.restartPolicy: Required value: valid values: "OnFailure", "Never"`);
        }
      }
      break;
    case 'CronJob':
      if (!s?.schedule) errs.push('spec.schedule: Required value');
      else if (!validCron(s.schedule)) errs.push(`spec.schedule: Invalid value: ${JSON.stringify(s.schedule)}: unparseable cron expression`);
      if (!s?.jobTemplate?.spec?.template) errs.push('spec.jobTemplate.spec.template: Required value');
      else {
        podSpec(s.jobTemplate.spec.template.spec, 'spec.jobTemplate.spec.template.spec', errs);
        const rp = s.jobTemplate.spec.template.spec?.restartPolicy;
        if (rp && rp !== 'OnFailure' && rp !== 'Never') {
          errs.push(`spec.jobTemplate.spec.template.spec.restartPolicy: Required value: valid values: "OnFailure", "Never"`);
        }
      }
      break;
    case 'Service': {
      const type = s?.type || 'ClusterIP';
      if (!['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'].includes(type)) {
        errs.push(`spec.type: Unsupported value: ${JSON.stringify(type)}: supported values: "ClusterIP", "ExternalName", "LoadBalancer", "NodePort"`);
      }
      if (type !== 'ExternalName' && !(s?.ports || []).length) errs.push('spec.ports: Required value');
      const names = new Set<string>();
      (s?.ports || []).forEach((p: Json, i: number) => {
        if (!Number.isInteger(p?.port) || p.port < 1 || p.port > 65535)
          errs.push(`spec.ports[${i}].port: Invalid value: ${p?.port}: must be between 1 and 65535, inclusive`);
        if (s.ports.length > 1 && !p?.name) errs.push(`spec.ports[${i}].name: Required value`);
        if (p?.name) {
          if (names.has(p.name)) errs.push(`spec.ports[${i}].name: Duplicate value: ${JSON.stringify(p.name)}`);
          names.add(p.name);
        }
        if (p?.nodePort !== undefined) {
          if (type === 'ClusterIP') errs.push(`spec.ports[${i}].nodePort: Forbidden: may not be used when \`type\` is 'ClusterIP'`);
          else if (p.nodePort < 30000 || p.nodePort > 32767)
            errs.push(
              `spec.ports[${i}].nodePort: Invalid value: ${p.nodePort}: provided port is not in the valid range. The range of valid ports is 30000-32767`,
            );
        }
      });
      if (type === 'ExternalName' && !s?.externalName) errs.push('spec.externalName: Required value');
      break;
    }
    case 'Ingress':
      (s?.rules || []).forEach((r: Json, i: number) => {
        (r?.http?.paths || []).forEach((p: Json, j: number) => {
          const at = `spec.rules[${i}].http.paths[${j}]`;
          if (!p?.pathType) errs.push(`${at}.pathType: Required value: pathType must be specified`);
          else if (!['Prefix', 'Exact', 'ImplementationSpecific'].includes(p.pathType))
            errs.push(`${at}.pathType: Unsupported value: ${JSON.stringify(p.pathType)}: supported values: "Exact", "ImplementationSpecific", "Prefix"`);
          if (!p?.backend?.service?.name) errs.push(`${at}.backend: Invalid value: "": resource or service backend is required`);
          else if (!p.backend.service.port || (p.backend.service.port.number === undefined && !p.backend.service.port.name)) {
            errs.push(`${at}.backend.service.port: Invalid value: "": port name or number is required`);
          }
          if (p?.path && !String(p.path).startsWith('/')) errs.push(`${at}.path: Invalid value: ${JSON.stringify(p.path)}: must be an absolute path`);
        });
      });
      break;
    case 'ConfigMap':
    case 'Secret':
      for (const k of Object.keys({ ...(obj.data || {}), ...(obj.stringData || {}) })) {
        if (!/^[-._a-zA-Z0-9]+$/.test(k))
          errs.push(`data[${k}]: Invalid value: ${JSON.stringify(k)}: a valid config key must consist of alphanumeric characters, '-', '_' or '.'`);
      }
      if (obj.kind === 'Secret') {
        for (const [k, v] of Object.entries(obj.data || {})) {
          if (typeof v === 'string' && !/^[A-Za-z0-9+/]*={0,2}$/.test(v.replace(/\s/g, ''))) {
            errs.push(`data[${k}]: Invalid value: illegal base64 data (use stringData for plain text)`);
          }
        }
      }
      break;
    case 'PersistentVolumeClaim':
      if (!(s?.accessModes || []).length) errs.push('spec.accessModes: Required value: at least 1 access mode is required');
      if (!s?.resources?.requests?.storage) errs.push('spec.resources[storage]: Required value');
      else if (Number.isNaN(parseQuantity(s.resources.requests.storage)))
        errs.push(
          `spec.resources.requests[storage]: Invalid value: ${JSON.stringify(s.resources.requests.storage)}: quantities must match the regular expression '^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$'`,
        );
      break;
    case 'PersistentVolume':
      if (!s?.capacity?.storage) errs.push('spec.capacity: Required value');
      if (!(s?.accessModes || []).length) errs.push('spec.accessModes: Required value');
      break;
    case 'HorizontalPodAutoscaler':
      if (!s?.scaleTargetRef?.kind || !s?.scaleTargetRef?.name) errs.push('spec.scaleTargetRef: Required value');
      if (!Number.isInteger(s?.maxReplicas) || s.maxReplicas < 1) errs.push('spec.maxReplicas: Invalid value: must be greater than or equal to 1');
      if (Number.isInteger(s?.minReplicas) && s.minReplicas > s.maxReplicas)
        errs.push(`spec.maxReplicas: Invalid value: ${s.maxReplicas}: must be greater than or equal to \`minReplicas\``);
      break;
  }
  return errs;
}

function workload(obj: Json, errs: string[]) {
  const s = obj.spec;
  if (!s) {
    errs.push('spec: Required value');
    return;
  }
  if (!s.selector) {
    errs.push('spec.selector: Required value');
  } else if (!Object.keys(s.selector.matchLabels || {}).length && !(s.selector.matchExpressions || []).length) {
    errs.push(
      'spec.selector: Invalid value: v1.LabelSelector{MatchLabels:map[string]string(nil), MatchExpressions:[]v1.LabelSelectorRequirement(nil)}: empty selector is invalid for deployment',
    );
  }
  if (!s.template) {
    errs.push('spec.template: Required value');
    return;
  }
  const labels = s.template.metadata?.labels;
  if (s.selector && !matches(fromLabelSelector(s.selector), labels)) {
    errs.push(`spec.template.metadata.labels: Invalid value: ${goMap(labels)}: \`selector\` does not match template \`labels\``);
  }
  if (Number.isInteger(s.replicas) && s.replicas < 0) errs.push(`spec.replicas: Invalid value: ${s.replicas}: must be greater than or equal to 0`);
  podSpec(s.template.spec, 'spec.template.spec', errs);
  const rp = s.template.spec?.restartPolicy;
  if (rp && rp !== 'Always') errs.push(`spec.template.spec.restartPolicy: Unsupported value: ${JSON.stringify(rp)}: supported values: "Always"`);
}

function podSpec(spec: Json, at: string, errs: string[]) {
  if (!spec) {
    errs.push(`${at}: Required value`);
    return;
  }
  const cs = spec.containers;
  if (!Array.isArray(cs) || cs.length === 0) {
    errs.push(`${at}.containers: Required value`);
    return;
  }
  const names = new Set<string>();
  const volumes = new Set<string>((spec.volumes || []).map((v: Json) => v?.name));
  [...(spec.initContainers || []).map((c: Json) => ['initContainers', c]), ...cs.map((c: Json) => ['containers', c])].forEach(
    ([list, c]: [string, Json], i: number) => {
      const idx = list === 'containers' ? i - (spec.initContainers || []).length : i;
      const p = `${at}.${list}[${idx}]`;
      if (!isObject(c)) return;
      if (!c.name) errs.push(`${p}.name: Required value`);
      else {
        const e = dnsLabelError(c.name);
        if (e) errs.push(`${p}.name: Invalid value: ${JSON.stringify(c.name)}: ${e}`);
        if (names.has(c.name)) errs.push(`${p}.name: Duplicate value: ${JSON.stringify(c.name)}`);
        names.add(c.name);
      }
      if (!c.image) errs.push(`${p}.image: Required value`);
      (c.ports || []).forEach((port: Json, j: number) => {
        if (!Number.isInteger(port?.containerPort) || port.containerPort < 1 || port.containerPort > 65535) {
          errs.push(`${p}.ports[${j}].containerPort: Invalid value: ${port?.containerPort}: must be between 1 and 65535, inclusive`);
        }
      });
      (c.volumeMounts || []).forEach((m: Json, j: number) => {
        if (m?.name && !volumes.has(m.name)) errs.push(`${p}.volumeMounts[${j}].name: Not found: ${JSON.stringify(m.name)}`);
      });
      (c.env || []).forEach((e: Json, j: number) => {
        if (!e?.name) errs.push(`${p}.env[${j}].name: Required value`);
      });
      for (const kind of ['requests', 'limits']) {
        for (const [r, q] of Object.entries(c.resources?.[kind] || {})) {
          if (Number.isNaN(parseQuantity(q))) {
            errs.push(`${p}.resources.${kind}[${r}]: Invalid value: ${JSON.stringify(q)}: must match the regex ^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$`);
          }
        }
      }
      for (const r of ['cpu', 'memory']) {
        const req = parseQuantity(c.resources?.requests?.[r]);
        const lim = parseQuantity(c.resources?.limits?.[r]);
        if (!Number.isNaN(req) && !Number.isNaN(lim) && req > lim) {
          errs.push(
            `${p}.resources.requests: Invalid value: ${JSON.stringify(c.resources.requests[r])}: must be less than or equal to ${r} limit of ${c.resources.limits[r]}`,
          );
        }
      }
    },
  );
  (spec.volumes || []).forEach((v: Json, i: number) => {
    if (!v?.name) errs.push(`${at}.volumes[${i}].name: Required value`);
  });
}

/** Five-field cron (plus @hourly…) as the CronJob controller accepts. */
export function validCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export type Cron = Set<number>[];

export function parseCron(expr: string): Cron {
  const e = MACROS[expr.trim()] || expr.trim();
  const parts = e.split(/\s+/);
  if (parts.length !== 5) throw new Error('expected 5 fields');
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  return parts.map((p, i) => {
    const [lo, hi] = ranges[i];
    const set = new Set<number>();
    for (const item of p.split(',')) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error(`bad field ${item}`);
      let a = lo;
      let b = hi;
      if (m[1] !== '*') {
        const [x, y] = m[1].split('-').map(Number);
        a = x;
        b = y ?? (m[2] ? hi : x);
      }
      const step = m[2] ? Number(m[2]) : 1;
      if (a < lo || b > hi || a > b || step < 1) throw new Error('out of range');
      for (let v = a; v <= b; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    return set;
  });
}

/** The first minute after `from` (ms) that the schedule matches (UTC). */
export function nextCron(cron: Cron, from: number): number {
  const d = new Date(Math.floor(from / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    if (
      cron[0].has(d.getUTCMinutes()) &&
      cron[1].has(d.getUTCHours()) &&
      cron[2].has(d.getUTCDate()) &&
      cron[3].has(d.getUTCMonth() + 1) &&
      cron[4].has(d.getUTCDay())
    ) {
      return d.getTime();
    }
    d.setTime(d.getTime() + 60_000);
  }
  return Infinity;
}
