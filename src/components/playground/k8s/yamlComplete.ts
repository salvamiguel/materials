// Autocompletion for manifests: the fields that are valid where the cursor
// is (from engine/schema.ts), a few enum values, and whole skeletons for an
// empty document. Pure: works on the text and the caret offset.

import type { CompletionItem, CompletionResult } from '../terraform/completion/complete';
import { RESOURCES, resourceByKind } from './engine/resources';
import { TYPES, typeAt } from './engine/schema';

interface Line {
  text: string;
  /** Column of the key (after "- " if any), or -1 for blank/comment lines. */
  keyCol: number;
  dashCol: number;
  key?: string;
  /** "key:" with nothing after it (a block follows). */
  opens: boolean;
}

function parseLine(text: string): Line {
  if (!text.trim() || /^\s*#/.test(text)) return { text, keyCol: -1, dashCol: -1, opens: false };
  const m = /^(\s*)(-\s+)?(.*)$/.exec(text)!;
  const dashCol = m[2] ? m[1].length : -1;
  const keyCol = m[1].length + (m[2]?.length || 0);
  const km = /^([\w./-]+)\s*:(\s*(#.*)?)?$/.exec(m[3]);
  const kv = /^([\w./-]+)\s*:/.exec(m[3]);
  return { text, keyCol, dashCol, key: kv?.[1], opens: !!km };
}

const ENUMS: Record<string, string[]> = {
  restartPolicy: ['Always', 'OnFailure', 'Never'],
  imagePullPolicy: ['IfNotPresent', 'Always', 'Never'],
  pathType: ['Prefix', 'Exact', 'ImplementationSpecific'],
  protocol: ['TCP', 'UDP', 'SCTP'],
  podManagementPolicy: ['OrderedReady', 'Parallel'],
  concurrencyPolicy: ['Allow', 'Forbid', 'Replace'],
  storageClassName: ['standard'],
  ingressClassName: ['nginx'],
  volumeMode: ['Filesystem', 'Block'],
  persistentVolumeReclaimPolicy: ['Retain', 'Delete'],
  operator: ['In', 'NotIn', 'Exists', 'DoesNotExist', 'Equal'],
  effect: ['NoSchedule', 'PreferNoSchedule', 'NoExecute'],
};

const IMAGES = [
  'nginx:1.27',
  'nginx:1.28',
  'busybox:1.36',
  'hashicorp/http-echo:1.0',
  'traefik/whoami:v1.10',
  'ghcr.io/stefanprodan/podinfo:6.7.0',
  'redis:7',
  'postgres:17',
  'mysql:8.4',
  'httpd:2.4',
  'curlimages/curl:8.10.1',
  'alpine:3.20',
];

const SKELETONS: Record<string, string> = {
  Deployment: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: \${1:web}
spec:
  replicas: \${2:3}
  selector:
    matchLabels:
      app: \${1:web}
  template:
    metadata:
      labels:
        app: \${1:web}
    spec:
      containers:
        - name: \${3:app}
          image: \${4:nginx:1.27}
          ports:
            - containerPort: \${5:80}$0`,
  Service: `apiVersion: v1
kind: Service
metadata:
  name: \${1:web}
spec:
  selector:
    app: \${2:web}
  ports:
    - port: \${3:80}
      targetPort: \${4:80}$0`,
  ConfigMap: `apiVersion: v1
kind: ConfigMap
metadata:
  name: \${1:config}
data:
  \${2:CLAVE}: "\${3:valor}"$0`,
  Secret: `apiVersion: v1
kind: Secret
metadata:
  name: \${1:secreto}
type: Opaque
stringData:
  \${2:password}: "\${3:cambia-me}"$0`,
  Ingress: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: \${1:web}
spec:
  ingressClassName: nginx
  rules:
    - host: \${2:web.local}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: \${3:web}
                port:
                  number: \${4:80}$0`,
  StatefulSet: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: \${1:db}
spec:
  serviceName: \${1:db}
  replicas: \${2:3}
  selector:
    matchLabels:
      app: \${1:db}
  template:
    metadata:
      labels:
        app: \${1:db}
    spec:
      containers:
        - name: \${3:redis}
          image: \${4:redis:7}
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: \${5:1Gi}$0`,
  Job: `apiVersion: batch/v1
kind: Job
metadata:
  name: \${1:tarea}
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: \${1:tarea}
          image: \${2:busybox:1.36}
          command: ["sh", "-c", "\${3:echo hola}"]$0`,
  CronJob: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: \${1:periodica}
spec:
  schedule: "\${2:*/1 * * * *}"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: \${1:periodica}
              image: \${3:busybox:1.36}
              command: ["sh", "-c", "\${4:date}"]$0`,
  PersistentVolumeClaim: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: \${1:datos}
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: \${2:1Gi}$0`,
  HorizontalPodAutoscaler: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: \${1:web}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: \${1:web}
  minReplicas: \${2:1}
  maxReplicas: \${3:5}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: \${4:50}$0`,
  Namespace: `apiVersion: v1
kind: Namespace
metadata:
  name: \${1:dev}$0`,
  Pod: `apiVersion: v1
kind: Pod
metadata:
  name: \${1:pod}
spec:
  containers:
    - name: \${1:pod}
      image: \${2:nginx:1.27}$0`,
};

/** Snippets for fields whose value is a list of objects or a block. */
function fieldSnippet(name: string, type: string): string {
  switch (name) {
    case 'containers':
    case 'initContainers':
      return `${name}:\n  - name: \${1:app}\n    image: \${2:nginx:1.27}$0`;
    case 'ports':
      return type.startsWith('ServicePort') ? `ports:\n  - port: \${1:80}\n    targetPort: \${2:80}$0` : `ports:\n  - containerPort: \${1:80}$0`;
    case 'env':
      return 'env:\n  - name: ${1:NOMBRE}\n    value: "${2:valor}"$0';
    case 'selector':
      return type === 'map' ? 'selector:\n  app: ${1:web}$0' : 'selector:\n  matchLabels:\n    app: ${1:web}$0';
    case 'resources':
      return type === 'ResourceRequirements' ? 'resources:\n  requests:\n    cpu: ${1:100m}\n    memory: ${2:128Mi}$0' : 'resources:\n  - ${1}$0';
    case 'readinessProbe':
    case 'livenessProbe':
    case 'startupProbe':
      return `${name}:\n  httpGet:\n    path: \${1:/}\n    port: \${2:80}\n  initialDelaySeconds: \${3:5}$0`;
    case 'volumeMounts':
      return 'volumeMounts:\n  - name: ${1:datos}\n    mountPath: ${2:/data}$0';
    case 'volumes':
      return 'volumes:\n  - name: ${1:datos}\n    ${2:emptyDir: {\\}}$0';
    case 'labels':
    case 'annotations':
    case 'matchLabels':
    case 'data':
    case 'stringData':
    case 'nodeSelector':
      return `${name}:\n  \${1:clave}: \${2:valor}$0`;
    case 'strategy':
      return 'strategy:\n  type: ${1:RollingUpdate}\n  rollingUpdate:\n    maxSurge: ${2:1}\n    maxUnavailable: ${3:0}$0';
  }
  if (type.endsWith('[]')) return type === 'string[]' ? `${name}: [\${1}]$0` : `${name}:\n  - \${1}$0`;
  if (type === 'map' || type === 'object' || TYPES[type]) return `${name}:\n  $0`;
  return `${name}: $0`;
}

function typeLabel(t: string) {
  return t === 'int' ? 'integer' : t === 'bool' ? 'boolean' : t === 'map' ? 'map[string]string' : t === 'intstr' ? 'int o string' : t;
}

export function completeYaml(text: string, offset: number): CompletionResult | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const prefix = text.slice(lineStart, offset);
  if (/\{\{/.test(prefix)) return undefined;
  const allLines = text.split('\n');
  const lineNo = text.slice(0, lineStart).split('\n').length - 1;
  // The document around the caret.
  let docStart = lineNo;
  while (docStart > 0 && !/^---/.test(allLines[docStart - 1] ?? '')) docStart--;
  let docEnd = lineNo;
  while (docEnd + 1 < allLines.length && !/^---/.test(allLines[docEnd + 1])) docEnd++;
  const doc = allLines.slice(docStart, docEnd + 1);
  const kind = doc.map((l) => /^kind:\s*["']?(\w+)/.exec(l)?.[1]).find(Boolean);

  // Value after "key: "
  const vm = /^(\s*)(-\s+)?([\w./-]+):\s+(["']?)([^"'#]*)$/.exec(prefix);
  if (vm) {
    const key = vm[3];
    const typed = vm[5];
    const from = offset - typed.length;
    let values: string[] = [];
    if (key === 'kind' && vm[1] === '') values = RESOURCES.filter((r) => !r.readOnly).map((r) => r.kind);
    else if (key === 'apiVersion' && vm[1] === '')
      values = kind && resourceByKind(kind) ? resourceByKind(kind)!.versions : [...new Set(RESOURCES.flatMap((r) => r.versions))];
    else if (key === 'image') values = IMAGES;
    else if (key === 'type') {
      const parent = pathAt(allLines, docStart, lineNo, prefix).slice(-1)[0];
      values =
        parent === 'strategy'
          ? ['RollingUpdate', 'Recreate']
          : parent === 'updateStrategy'
            ? ['RollingUpdate', 'OnDelete']
            : kind === 'Secret' && vm[1] === ''
              ? ['Opaque', 'kubernetes.io/tls', 'kubernetes.io/dockerconfigjson']
              : kind === 'Service'
                ? ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName']
                : ['Resource', 'Utilization'];
    } else values = ENUMS[key] || [];
    if (!values.length) return undefined;
    return { from, to: offset, items: values.map((v) => ({ label: v, kind: 'value', insert: v })) };
  }

  const km = /^(\s*)(-\s+)?([\w./-]*)$/.exec(prefix);
  if (!km) return undefined;
  const typed = km[3];
  const from = offset - typed.length;
  const keyCol = km[1].length + (km[2]?.length || 0);
  const extra = km[2] ? ' '.repeat(km[2].length) : '';
  const indentSnippet = (s: string) => s.replace(/\n/g, '\n' + extra);

  // Empty document: whole skeletons.
  if (keyCol === 0 && !kind && !km[2]) {
    const items: CompletionItem[] = Object.entries(SKELETONS).map(([k, snip]) => ({
      label: k,
      kind: 'type',
      detail: 'plantilla',
      doc: resourceByKind(k)?.description,
      insert: snip,
      group: 0,
    }));
    items.push(
      ...['apiVersion', 'kind', 'metadata'].map((k) => ({
        label: k,
        kind: 'attribute' as const,
        insert: k === 'metadata' ? 'metadata:\n  name: $0' : `${k}: $0`,
        group: 1,
        retrigger: k !== 'metadata',
      })),
    );
    return { from, to: offset, items };
  }
  if (!kind || !TYPES[kind]) return undefined;
  const path = pathAt(allLines, docStart, lineNo, prefix);
  const at = path.length ? typeAt(kind, path) : { type: kind, def: TYPES[kind] };
  const def = at?.def;
  if (!def) return undefined;
  const present = siblings(allLines, docStart, docEnd, lineNo, keyCol, !!km[2]);
  const items: CompletionItem[] = Object.entries(def.fields)
    .filter(
      ([name]) =>
        !present.has(name) &&
        ![
          'status',
          'uid',
          'resourceVersion',
          'generation',
          'creationTimestamp',
          'deletionTimestamp',
          'deletionGracePeriodSeconds',
          'managedFields',
          'selfLink',
          'ownerReferences',
        ].includes(name),
    )
    .map(([name, f]) => ({
      label: name,
      kind: TYPES[f[0].replace(/\[\]$/, '')] || f[0] === 'map' || f[0] === 'object' || f[0].endsWith('[]') ? ('block' as const) : ('attribute' as const),
      detail: typeLabel(f[0]),
      doc: f[1],
      required: def.required?.includes(name),
      insert: indentSnippet(fieldSnippet(name, f[0])),
      retrigger: ['kind', 'apiVersion', 'type', 'image', 'restartPolicy', 'imagePullPolicy', 'pathType', 'protocol'].includes(name) || !!ENUMS[name],
      group: def.required?.includes(name) ? 0 : 1,
    }));
  items.sort((a, b) => (a.group ?? 1) - (b.group ?? 1) || a.label.localeCompare(b.label));
  return { from, to: offset, items };
}

/** Keys from the document root down to the block the caret is in. */
function pathAt(lines: string[], docStart: number, lineNo: number, prefix: string): string[] {
  const cur = parseLine(prefix + 'x');
  let target = cur.keyCol;
  let inList = cur.dashCol >= 0;
  if (inList) target = cur.dashCol;
  const path: string[] = [];
  for (let i = lineNo - 1; i >= docStart && (target > 0 || inList); i--) {
    const l = parseLine(lines[i]);
    if (l.keyCol < 0) continue;
    if (l.dashCol >= 0 && l.keyCol === target && !inList) {
      // A sibling on the first line of our list item: continue from the dash.
      target = l.dashCol;
      inList = true;
      continue;
    }
    const limit = inList ? l.keyCol <= target : l.keyCol < target;
    if (!limit) continue;
    if (l.dashCol >= 0) {
      // Another list item's key at our level: we are nested in it.
      if (l.opens && l.key) path.push(l.key);
      target = l.dashCol;
      inList = true;
      continue;
    }
    if (l.key && l.opens) {
      path.push(l.key);
      target = l.keyCol;
      inList = false;
    } else if (l.keyCol < target) break;
  }
  return path.reverse();
}

/** Keys already written in the same mapping. */
function siblings(lines: string[], docStart: number, docEnd: number, lineNo: number, keyCol: number, dash: boolean): Set<string> {
  const out = new Set<string>();
  const walk = (from: number, step: 1 | -1) => {
    for (let i = from; i >= docStart && i <= docEnd; i += step) {
      const l = parseLine(lines[i]);
      if (l.keyCol < 0) continue;
      if (l.keyCol < keyCol && !(l.dashCol >= 0 && l.keyCol === keyCol)) break;
      if (l.keyCol === keyCol && l.key) {
        out.add(l.key);
        // A new list item starts a new mapping.
        if (l.dashCol >= 0 && step === -1) break;
        if (l.dashCol >= 0 && step === 1) break;
      }
    }
  };
  walk(lineNo - 1, -1);
  if (!dash) walk(lineNo + 1, 1);
  return out;
}
