// The native resource types the simulated API server knows (kubectl api-resources).

export interface ResourceType {
  kind: string;
  /** Group/version, preferred first. "" group is the core group ("v1"). */
  versions: string[];
  plural: string;
  singular: string;
  short: string[];
  namespaced: boolean;
  /** Only the controllers create it (Endpoints, Events...). */
  readOnly?: boolean;
  /** Custom resource: only served once its CRD is installed (ArgoCD). */
  crd?: 'argocd';
  description: string;
}

export const RESOURCES: ResourceType[] = [
  {
    kind: 'Pod',
    versions: ['v1'],
    plural: 'pods',
    singular: 'pod',
    short: ['po'],
    namespaced: true,
    description: 'La unidad mínima: uno o varios contenedores que comparten red y volúmenes.',
  },
  {
    kind: 'Service',
    versions: ['v1'],
    plural: 'services',
    singular: 'service',
    short: ['svc'],
    namespaced: true,
    description: 'IP y nombre DNS estables que reparten el tráfico entre los pods que cumplen su selector.',
  },
  {
    kind: 'Endpoints',
    versions: ['v1'],
    plural: 'endpoints',
    singular: 'endpoints',
    short: ['ep'],
    namespaced: true,
    readOnly: true,
    description: 'Las IPs de los pods listos detrás de un Service (lo mantiene el control plane).',
  },
  {
    kind: 'ConfigMap',
    versions: ['v1'],
    plural: 'configmaps',
    singular: 'configmap',
    short: ['cm'],
    namespaced: true,
    description: 'Configuración no sensible en pares clave-valor, como variables de entorno o ficheros.',
  },
  {
    kind: 'Secret',
    versions: ['v1'],
    plural: 'secrets',
    singular: 'secret',
    short: [],
    namespaced: true,
    description: 'Como un ConfigMap pero para datos sensibles (codificados en base64, no cifrados).',
  },
  {
    kind: 'Namespace',
    versions: ['v1'],
    plural: 'namespaces',
    singular: 'namespace',
    short: ['ns'],
    namespaced: false,
    description: 'Divide el clúster en espacios con nombres independientes.',
  },
  {
    kind: 'Node',
    versions: ['v1'],
    plural: 'nodes',
    singular: 'node',
    short: ['no'],
    namespaced: false,
    readOnly: true,
    description: 'Una máquina del clúster donde el kubelet ejecuta pods.',
  },
  {
    kind: 'PersistentVolumeClaim',
    versions: ['v1'],
    plural: 'persistentvolumeclaims',
    singular: 'persistentvolumeclaim',
    short: ['pvc'],
    namespaced: true,
    description: 'Una petición de almacenamiento persistente que un pod puede montar.',
  },
  {
    kind: 'PersistentVolume',
    versions: ['v1'],
    plural: 'persistentvolumes',
    singular: 'persistentvolume',
    short: ['pv'],
    namespaced: false,
    description: 'Un disco del clúster, creado a mano o por un StorageClass.',
  },
  {
    kind: 'ServiceAccount',
    versions: ['v1'],
    plural: 'serviceaccounts',
    singular: 'serviceaccount',
    short: ['sa'],
    namespaced: true,
    description: 'La identidad con la que los pods hablan con la API.',
  },
  {
    kind: 'Deployment',
    versions: ['apps/v1'],
    plural: 'deployments',
    singular: 'deployment',
    short: ['deploy'],
    namespaced: true,
    description: 'Mantiene N réplicas de un pod y gestiona las actualizaciones (rolling update, rollback).',
  },
  {
    kind: 'ReplicaSet',
    versions: ['apps/v1'],
    plural: 'replicasets',
    singular: 'replicaset',
    short: ['rs'],
    namespaced: true,
    description: 'Garantiza que haya N pods iguales. Normalmente lo crea un Deployment.',
  },
  {
    kind: 'StatefulSet',
    versions: ['apps/v1'],
    plural: 'statefulsets',
    singular: 'statefulset',
    short: ['sts'],
    namespaced: true,
    description: 'Pods con identidad estable (nombre-0, nombre-1…) y su propio volumen cada uno.',
  },
  {
    kind: 'DaemonSet',
    versions: ['apps/v1'],
    plural: 'daemonsets',
    singular: 'daemonset',
    short: ['ds'],
    namespaced: true,
    description: 'Un pod en cada nodo (agentes de logs, monitorización, red).',
  },
  {
    kind: 'Job',
    versions: ['batch/v1'],
    plural: 'jobs',
    singular: 'job',
    short: [],
    namespaced: true,
    description: 'Ejecuta pods hasta que terminan con éxito.',
  },
  {
    kind: 'CronJob',
    versions: ['batch/v1'],
    plural: 'cronjobs',
    singular: 'cronjob',
    short: ['cj'],
    namespaced: true,
    description: 'Crea Jobs periódicamente según una expresión cron.',
  },
  {
    kind: 'Ingress',
    versions: ['networking.k8s.io/v1'],
    plural: 'ingresses',
    singular: 'ingress',
    short: ['ing'],
    namespaced: true,
    description: 'Reglas HTTP (host y ruta) que llevan el tráfico externo a Services.',
  },
  {
    kind: 'IngressClass',
    versions: ['networking.k8s.io/v1'],
    plural: 'ingressclasses',
    singular: 'ingressclass',
    short: [],
    namespaced: false,
    description: 'El controlador que implementa los Ingress (aquí, nginx).',
  },
  {
    kind: 'StorageClass',
    versions: ['storage.k8s.io/v1'],
    plural: 'storageclasses',
    singular: 'storageclass',
    short: ['sc'],
    namespaced: false,
    description: 'Cómo se crean los PersistentVolumes bajo demanda.',
  },
  {
    kind: 'HorizontalPodAutoscaler',
    versions: ['autoscaling/v2', 'autoscaling/v1'],
    plural: 'horizontalpodautoscalers',
    singular: 'horizontalpodautoscaler',
    short: ['hpa'],
    namespaced: true,
    description: 'Ajusta las réplicas de un Deployment o StatefulSet según el uso de CPU.',
  },
  {
    kind: 'Event',
    versions: ['v1', 'events.k8s.io/v1'],
    plural: 'events',
    singular: 'event',
    short: ['ev'],
    namespaced: true,
    readOnly: true,
    description: 'Lo que va pasando en el clúster (programación, descargas, reinicios…).',
  },
  {
    kind: 'Application',
    versions: ['argoproj.io/v1alpha1'],
    plural: 'applications',
    singular: 'application',
    short: ['app', 'apps'],
    namespaced: true,
    crd: 'argocd',
    description: 'Una aplicación de ArgoCD: qué hay que desplegar (un repo Git, una ruta y una revisión) y dónde.',
  },
  {
    kind: 'AppProject',
    versions: ['argoproj.io/v1alpha1'],
    plural: 'appprojects',
    singular: 'appproject',
    short: ['appproj', 'appprojs'],
    namespaced: true,
    crd: 'argocd',
    description: 'Un proyecto de ArgoCD: qué repos y destinos pueden usar sus Applications.',
  },
  {
    kind: 'ApplicationSet',
    versions: ['argoproj.io/v1alpha1'],
    plural: 'applicationsets',
    singular: 'applicationset',
    short: ['appset', 'appsets'],
    namespaced: true,
    crd: 'argocd',
    description: 'Genera Applications a partir de una plantilla y unos generadores (list, git…).',
  },
];

const BY_KIND = new Map(RESOURCES.map((r) => [r.kind, r]));

export function resourceByKind(kind: string): ResourceType | undefined {
  return BY_KIND.get(kind);
}

/** Resolves what kubectl accepts: "po", "pods", "Pod", "deployment.apps", "deploy". */
export function resolveResource(name: string): ResourceType | undefined {
  const n = name.toLowerCase().replace(/\.(apps|batch|networking\.k8s\.io|storage\.k8s\.io|autoscaling|argoproj\.io|v1)$/, '');
  return RESOURCES.find((r) => r.plural === n || r.singular === n || r.short.includes(n) || r.kind.toLowerCase() === n);
}

/** "deployment.apps", "service", "ingress.networking.k8s.io": the name kubectl prints. */
export function qualifiedName(kind: string): string {
  const r = BY_KIND.get(kind);
  if (!r) return kind.toLowerCase();
  const gv = r.versions[0];
  const group = gv.includes('/') ? gv.split('/')[0] : '';
  return group ? `${r.singular}.${group}` : r.singular;
}

export function apiGroup(kind: string): string {
  const gv = BY_KIND.get(kind)?.versions[0] || 'v1';
  return gv.includes('/') ? gv.split('/')[0] : '';
}

/** Controllers and workloads whose pods belong to them (for the diagram and describe). */
export const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ReplicaSet'];
