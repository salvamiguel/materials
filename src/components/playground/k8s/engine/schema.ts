// A compact schema of the native types: enough to reject unknown or mistyped
// fields like the API server's strict decoding does, and to power
// `kubectl explain` and the editor's autocompletion.
//
// Field types: string, int, bool, number, quantity, intstr (int or string),
// map (string→string), object (anything), any, <Type>, <Type>[] and string[].

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Field = [type: string, doc?: string];

export interface TypeDef {
  doc?: string;
  fields: Record<string, Field>;
  required?: string[];
}

const meta: Field = ['ObjectMeta', 'Metadatos estándar: name, namespace, labels, annotations.'];

export const TYPES: Record<string, TypeDef> = {
  ObjectMeta: {
    doc: 'Metadatos comunes a todos los objetos.',
    fields: {
      name: ['string', 'Nombre único dentro del namespace (y del tipo).'],
      generateName: ['string', 'Prefijo para que el servidor genere un nombre único.'],
      namespace: ['string', 'Namespace del objeto. Si no se indica, el del contexto (default).'],
      labels: ['map', 'Etiquetas clave-valor para seleccionar y agrupar objetos.'],
      annotations: ['map', 'Metadatos libres que no sirven para seleccionar.'],
      uid: ['string'],
      resourceVersion: ['string'],
      generation: ['int'],
      creationTimestamp: ['any'],
      deletionTimestamp: ['any'],
      deletionGracePeriodSeconds: ['int'],
      ownerReferences: ['OwnerReference[]'],
      finalizers: ['string[]'],
      managedFields: ['object[]'],
      selfLink: ['string'],
    },
  },
  OwnerReference: {
    fields: { apiVersion: ['string'], kind: ['string'], name: ['string'], uid: ['string'], controller: ['bool'], blockOwnerDeletion: ['bool'] },
  },
  LabelSelector: {
    doc: 'Selecciona objetos por sus etiquetas.',
    fields: {
      matchLabels: ['map', 'Todas estas etiquetas deben coincidir.'],
      matchExpressions: ['LabelSelectorRequirement[]', 'Expresiones In, NotIn, Exists, DoesNotExist.'],
    },
  },
  LabelSelectorRequirement: { fields: { key: ['string'], operator: ['string'], values: ['string[]'] }, required: ['key', 'operator'] },

  // ── pods ──
  Pod: {
    doc: 'La unidad mínima de ejecución: uno o varios contenedores.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['PodSpec', 'Especificación del pod.'], status: ['object'] },
    required: ['spec'],
  },
  PodTemplateSpec: { doc: 'Plantilla de los pods que crea el controlador.', fields: { metadata: meta, spec: ['PodSpec', 'Especificación de los pods.'] } },
  PodSpec: {
    doc: 'Qué contenedores ejecuta el pod y cómo.',
    fields: {
      containers: ['Container[]', 'Los contenedores del pod (al menos uno).'],
      initContainers: ['Container[]', 'Contenedores que se ejecutan, en orden, antes que los normales.'],
      volumes: ['Volume[]', 'Volúmenes que pueden montar los contenedores.'],
      restartPolicy: ['string', 'Always (por defecto), OnFailure o Never.'],
      nodeSelector: ['map', 'Solo se programa en nodos con estas etiquetas.'],
      nodeName: ['string', 'Fija el nodo (se salta el scheduler).'],
      serviceAccountName: ['string', 'ServiceAccount con la que corre el pod.'],
      serviceAccount: ['string'],
      terminationGracePeriodSeconds: ['int', 'Segundos que se esperan a que el proceso termine al borrar el pod.'],
      hostname: ['string'],
      subdomain: ['string'],
      affinity: ['object', 'Reglas de afinidad y anti-afinidad.'],
      tolerations: ['Toleration[]', 'Permite programar el pod en nodos con taints.'],
      securityContext: ['object'],
      imagePullSecrets: ['object[]'],
      dnsPolicy: ['string'],
      dnsConfig: ['object'],
      hostNetwork: ['bool'],
      priorityClassName: ['string'],
      schedulerName: ['string'],
      automountServiceAccountToken: ['bool'],
      topologySpreadConstraints: ['object[]'],
      enableServiceLinks: ['bool'],
      shareProcessNamespace: ['bool'],
      activeDeadlineSeconds: ['int'],
      hostAliases: ['object[]'],
      runtimeClassName: ['string'],
      priority: ['int'],
      preemptionPolicy: ['string'],
      overhead: ['object'],
      readinessGates: ['object[]'],
      os: ['object'],
      hostPID: ['bool'],
      hostIPC: ['bool'],
      setHostnameAsFQDN: ['bool'],
      ephemeralContainers: ['object[]'],
    },
    required: ['containers'],
  },
  Toleration: { fields: { key: ['string'], operator: ['string'], value: ['string'], effect: ['string'], tolerationSeconds: ['int'] } },
  Container: {
    doc: 'Un contenedor: imagen, comando, puertos, variables, recursos y sondas.',
    fields: {
      name: ['string', 'Nombre del contenedor (único en el pod).'],
      image: ['string', 'Imagen del contenedor, p. ej. nginx:1.27.'],
      imagePullPolicy: ['string', 'Always, IfNotPresent o Never.'],
      command: ['string[]', 'Sustituye el ENTRYPOINT de la imagen.'],
      args: ['string[]', 'Sustituye el CMD de la imagen.'],
      workingDir: ['string'],
      ports: ['ContainerPort[]', 'Puertos que expone (informativo).'],
      env: ['EnvVar[]', 'Variables de entorno.'],
      envFrom: ['EnvFromSource[]', 'Carga todas las claves de un ConfigMap o Secret como variables.'],
      resources: ['ResourceRequirements', 'Peticiones (requests) y límites (limits) de CPU y memoria.'],
      volumeMounts: ['VolumeMount[]', 'Dónde montar los volúmenes del pod.'],
      livenessProbe: ['Probe', 'Si falla, el kubelet reinicia el contenedor.'],
      readinessProbe: ['Probe', 'Mientras falla, el pod no recibe tráfico de los Services.'],
      startupProbe: ['Probe', 'Retrasa las otras sondas hasta que la aplicación arranca.'],
      lifecycle: ['object'],
      securityContext: ['object'],
      stdin: ['bool'],
      tty: ['bool'],
      stdinOnce: ['bool'],
      terminationMessagePath: ['string'],
      terminationMessagePolicy: ['string'],
      restartPolicy: ['string'],
      volumeDevices: ['object[]'],
      resizePolicy: ['object[]'],
    },
    required: ['name', 'image'],
  },
  ContainerPort: {
    fields: {
      name: ['string'],
      containerPort: ['int', 'Número de puerto.'],
      protocol: ['string', 'TCP (por defecto), UDP o SCTP.'],
      hostPort: ['int'],
      hostIP: ['string'],
    },
    required: ['containerPort'],
  },
  EnvVar: {
    fields: {
      name: ['string', 'Nombre de la variable.'],
      value: ['string', 'Valor (siempre texto: pon los números entre comillas).'],
      valueFrom: ['EnvVarSource', 'Toma el valor de un ConfigMap, Secret o campo del pod.'],
    },
    required: ['name'],
  },
  EnvVarSource: {
    fields: { configMapKeyRef: ['KeySelector'], secretKeyRef: ['KeySelector'], fieldRef: ['object'], resourceFieldRef: ['object'] },
  },
  KeySelector: { fields: { name: ['string'], key: ['string'], optional: ['bool'] }, required: ['key'] },
  EnvFromSource: { fields: { prefix: ['string'], configMapRef: ['LocalRef'], secretRef: ['LocalRef'] } },
  LocalRef: { fields: { name: ['string'], optional: ['bool'] } },
  ResourceRequirements: {
    fields: {
      requests: ['object', 'Lo que el scheduler reserva: cpu (p. ej. 100m) y memory (p. ej. 128Mi).'],
      limits: ['object', 'El máximo que puede usar el contenedor.'],
      claims: ['object[]'],
    },
  },
  VolumeMount: {
    fields: {
      name: ['string', 'Nombre del volumen del pod.'],
      mountPath: ['string', 'Ruta dentro del contenedor.'],
      subPath: ['string'],
      readOnly: ['bool'],
      mountPropagation: ['string'],
      subPathExpr: ['string'],
      recursiveReadOnly: ['string'],
    },
    required: ['name', 'mountPath'],
  },
  Volume: {
    fields: {
      name: ['string'],
      configMap: ['object', 'Monta un ConfigMap como ficheros.'],
      secret: ['object', 'Monta un Secret como ficheros.'],
      emptyDir: ['object', 'Directorio vacío que vive lo que vive el pod.'],
      persistentVolumeClaim: ['object', 'Monta un PVC.'],
      hostPath: ['object'],
      projected: ['object'],
      downwardAPI: ['object'],
      nfs: ['object'],
      csi: ['object'],
      ephemeral: ['object'],
    },
    required: ['name'],
  },
  Probe: {
    doc: 'Una sonda de salud.',
    fields: {
      httpGet: ['object', 'Petición HTTP (path, port).'],
      tcpSocket: ['object'],
      exec: ['object'],
      grpc: ['object'],
      initialDelaySeconds: ['int', 'Espera antes de la primera comprobación.'],
      periodSeconds: ['int', 'Cada cuánto se comprueba (10 s).'],
      timeoutSeconds: ['int'],
      successThreshold: ['int'],
      failureThreshold: ['int', 'Fallos seguidos para darla por fallida (3).'],
      terminationGracePeriodSeconds: ['int'],
    },
  },

  // ── workloads ──
  Deployment: {
    doc: 'Mantiene réplicas de un pod y gestiona sus actualizaciones.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['DeploymentSpec'], status: ['object'] },
    required: ['spec'],
  },
  DeploymentSpec: {
    fields: {
      replicas: ['int', 'Número de pods deseado (1 por defecto).'],
      selector: ['LabelSelector', 'Qué pods son del Deployment. Debe coincidir con las etiquetas de la plantilla y no se puede cambiar.'],
      template: ['PodTemplateSpec', 'La plantilla de los pods.'],
      strategy: ['DeploymentStrategy', 'Cómo sustituir los pods viejos por los nuevos.'],
      minReadySeconds: ['int', 'Segundos que un pod debe estar listo para contar como disponible.'],
      revisionHistoryLimit: ['int', 'ReplicaSets antiguos que se guardan para poder hacer rollback (10).'],
      progressDeadlineSeconds: ['int', 'Segundos sin progreso antes de marcar el despliegue como fallido (600).'],
      paused: ['bool', 'Pausa el despliegue: los cambios de la plantilla no se aplican.'],
    },
    required: ['selector', 'template'],
  },
  DeploymentStrategy: {
    fields: { type: ['string', 'RollingUpdate (por defecto) o Recreate.'], rollingUpdate: ['RollingUpdateDeployment'] },
  },
  RollingUpdateDeployment: {
    fields: {
      maxSurge: ['intstr', 'Pods de más que se pueden crear durante la actualización (25%).'],
      maxUnavailable: ['intstr', 'Pods que pueden faltar durante la actualización (25%).'],
    },
  },
  ReplicaSet: { fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['ReplicaSetSpec'], status: ['object'] }, required: ['spec'] },
  ReplicaSetSpec: {
    fields: { replicas: ['int'], selector: ['LabelSelector'], template: ['PodTemplateSpec'], minReadySeconds: ['int'] },
    required: ['selector'],
  },
  StatefulSet: {
    doc: 'Pods con identidad y almacenamiento estables.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['StatefulSetSpec'], status: ['object'] },
    required: ['spec'],
  },
  StatefulSetSpec: {
    fields: {
      replicas: ['int'],
      selector: ['LabelSelector'],
      template: ['PodTemplateSpec'],
      serviceName: ['string', 'Service headless que da DNS a cada pod (pod-0.servicio).'],
      volumeClaimTemplates: ['PersistentVolumeClaim[]', 'Un PVC por pod, que sobrevive al pod.'],
      podManagementPolicy: ['string', 'OrderedReady (de uno en uno, por defecto) o Parallel.'],
      updateStrategy: ['StatefulSetUpdateStrategy'],
      revisionHistoryLimit: ['int'],
      minReadySeconds: ['int'],
      persistentVolumeClaimRetentionPolicy: ['object'],
      ordinals: ['object'],
    },
    required: ['selector', 'template'],
  },
  StatefulSetUpdateStrategy: {
    fields: {
      type: ['string', 'RollingUpdate (por defecto) u OnDelete.'],
      rollingUpdate: ['object', 'partition: solo se actualizan los pods con ordinal ≥ partition.'],
    },
  },
  DaemonSet: {
    doc: 'Un pod en cada nodo.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['DaemonSetSpec'], status: ['object'] },
    required: ['spec'],
  },
  DaemonSetSpec: {
    fields: { selector: ['LabelSelector'], template: ['PodTemplateSpec'], updateStrategy: ['object'], minReadySeconds: ['int'], revisionHistoryLimit: ['int'] },
    required: ['selector', 'template'],
  },
  Job: {
    doc: 'Ejecuta pods hasta completar una tarea.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['JobSpec'], status: ['object'] },
    required: ['spec'],
  },
  JobSpec: {
    fields: {
      template: ['PodTemplateSpec'],
      completions: ['int', 'Ejecuciones con éxito necesarias (1).'],
      parallelism: ['int', 'Pods a la vez (1).'],
      backoffLimit: ['int', 'Reintentos antes de marcar el Job como fallido (6).'],
      activeDeadlineSeconds: ['int'],
      ttlSecondsAfterFinished: ['int', 'Borra el Job este tiempo después de terminar.'],
      selector: ['LabelSelector'],
      manualSelector: ['bool'],
      completionMode: ['string'],
      suspend: ['bool'],
      podFailurePolicy: ['object'],
      backoffLimitPerIndex: ['int'],
      maxFailedIndexes: ['int'],
      podReplacementPolicy: ['string'],
    },
    required: ['template'],
  },
  JobTemplateSpec: { fields: { metadata: meta, spec: ['JobSpec'] } },
  CronJob: {
    doc: 'Crea Jobs según un horario cron.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['CronJobSpec'], status: ['object'] },
    required: ['spec'],
  },
  CronJobSpec: {
    fields: {
      schedule: ['string', 'Expresión cron de 5 campos, p. ej. "*/1 * * * *".'],
      jobTemplate: ['JobTemplateSpec'],
      suspend: ['bool'],
      concurrencyPolicy: ['string', 'Allow, Forbid o Replace.'],
      startingDeadlineSeconds: ['int'],
      successfulJobsHistoryLimit: ['int', 'Jobs terminados que se guardan (3).'],
      failedJobsHistoryLimit: ['int', 'Jobs fallidos que se guardan (1).'],
      timeZone: ['string'],
    },
    required: ['schedule', 'jobTemplate'],
  },

  // ── networking ──
  Service: {
    doc: 'Un nombre y una IP estables delante de un grupo de pods.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['ServiceSpec'], status: ['object'] },
  },
  ServiceSpec: {
    fields: {
      selector: ['map', 'Los pods con estas etiquetas reciben el tráfico.'],
      ports: ['ServicePort[]', 'Puertos del Service.'],
      type: ['string', 'ClusterIP (por defecto), NodePort, LoadBalancer o ExternalName.'],
      clusterIP: ['string', 'IP interna; "None" crea un Service headless.'],
      clusterIPs: ['string[]'],
      externalName: ['string'],
      externalIPs: ['string[]'],
      sessionAffinity: ['string'],
      loadBalancerIP: ['string'],
      loadBalancerSourceRanges: ['string[]'],
      externalTrafficPolicy: ['string'],
      internalTrafficPolicy: ['string'],
      publishNotReadyAddresses: ['bool'],
      ipFamilies: ['string[]'],
      ipFamilyPolicy: ['string'],
      loadBalancerClass: ['string'],
      allocateLoadBalancerNodePorts: ['bool'],
      healthCheckNodePort: ['int'],
      sessionAffinityConfig: ['object'],
      trafficDistribution: ['string'],
    },
  },
  ServicePort: {
    fields: {
      name: ['string'],
      port: ['int', 'Puerto del Service.'],
      targetPort: ['intstr', 'Puerto (o nombre de puerto) del contenedor.'],
      protocol: ['string'],
      nodePort: ['int', 'Puerto en cada nodo (30000-32767) para NodePort y LoadBalancer.'],
      appProtocol: ['string'],
    },
    required: ['port'],
  },
  Ingress: {
    doc: 'Enrutado HTTP de hosts y rutas a Services.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['IngressSpec'], status: ['object'] },
  },
  IngressSpec: { fields: { ingressClassName: ['string'], rules: ['IngressRule[]'], tls: ['object[]'], defaultBackend: ['IngressBackend'] } },
  IngressRule: { fields: { host: ['string', 'Host HTTP, p. ej. app.local.'], http: ['HTTPIngressRuleValue'] } },
  HTTPIngressRuleValue: { fields: { paths: ['HTTPIngressPath[]'] }, required: ['paths'] },
  HTTPIngressPath: {
    fields: { path: ['string'], pathType: ['string', 'Prefix, Exact o ImplementationSpecific.'], backend: ['IngressBackend'] },
    required: ['pathType', 'backend'],
  },
  IngressBackend: { fields: { service: ['IngressServiceBackend'], resource: ['object'] } },
  IngressServiceBackend: { fields: { name: ['string'], port: ['object', 'number o name del puerto del Service.'] }, required: ['name'] },
  IngressClass: { fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['object'] } },

  // ── config and storage ──
  ConfigMap: {
    doc: 'Configuración en pares clave-valor.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, data: ['map', 'Los valores (texto).'], binaryData: ['object'], immutable: ['bool'] },
  },
  Secret: {
    doc: 'Datos sensibles. data va en base64; stringData en claro (se convierte al guardar).',
    fields: {
      apiVersion: ['string'],
      kind: ['string'],
      metadata: meta,
      data: ['map', 'Valores en base64.'],
      stringData: ['map', 'Valores en claro.'],
      type: ['string', 'Opaque (por defecto), kubernetes.io/tls…'],
      immutable: ['bool'],
    },
  },
  Namespace: { fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['object'], status: ['object'] } },
  ServiceAccount: {
    fields: {
      apiVersion: ['string'],
      kind: ['string'],
      metadata: meta,
      secrets: ['object[]'],
      imagePullSecrets: ['object[]'],
      automountServiceAccountToken: ['bool'],
    },
  },
  PersistentVolumeClaim: {
    doc: 'Petición de almacenamiento.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['PersistentVolumeClaimSpec'], status: ['object'] },
  },
  PersistentVolumeClaimSpec: {
    fields: {
      accessModes: ['string[]', 'ReadWriteOnce, ReadOnlyMany, ReadWriteMany…'],
      resources: ['ResourceRequirements', 'requests.storage: tamaño pedido, p. ej. 1Gi.'],
      storageClassName: ['string', 'StorageClass (si no se indica, la de por defecto).'],
      volumeName: ['string'],
      selector: ['LabelSelector'],
      volumeMode: ['string'],
      dataSource: ['object'],
      dataSourceRef: ['object'],
      volumeAttributesClassName: ['string'],
    },
  },
  PersistentVolume: {
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['PersistentVolumeSpec'], status: ['object'] },
  },
  PersistentVolumeSpec: {
    fields: {
      capacity: ['object'],
      accessModes: ['string[]'],
      persistentVolumeReclaimPolicy: ['string'],
      storageClassName: ['string'],
      claimRef: ['object'],
      hostPath: ['object'],
      local: ['object'],
      nfs: ['object'],
      csi: ['object'],
      nodeAffinity: ['object'],
      volumeMode: ['string'],
      mountOptions: ['string[]'],
    },
  },
  StorageClass: {
    fields: {
      apiVersion: ['string'],
      kind: ['string'],
      metadata: meta,
      provisioner: ['string'],
      parameters: ['map'],
      reclaimPolicy: ['string'],
      volumeBindingMode: ['string'],
      allowVolumeExpansion: ['bool'],
      mountOptions: ['string[]'],
      allowedTopologies: ['object[]'],
    },
    required: ['provisioner'],
  },
  HorizontalPodAutoscaler: {
    doc: 'Escala un workload según sus métricas.',
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['HorizontalPodAutoscalerSpec'], status: ['object'] },
  },
  HorizontalPodAutoscalerSpec: {
    fields: {
      scaleTargetRef: ['object', 'El Deployment o StatefulSet que escala (apiVersion, kind, name).'],
      minReplicas: ['int'],
      maxReplicas: ['int'],
      metrics: ['object[]', 'Métricas: type Resource, resource.name cpu, target.averageUtilization.'],
      targetCPUUtilizationPercentage: ['int', '(autoscaling/v1) % de CPU objetivo.'],
      behavior: ['object'],
    },
    required: ['maxReplicas', 'scaleTargetRef'],
  },
};

// ── ArgoCD (argoproj.io/v1alpha1) ──
Object.assign(TYPES, {
  Application: {
    doc: 'Una aplicación de ArgoCD: despliega lo que hay en una ruta de un repo Git en un namespace.',
    fields: {
      apiVersion: ['string'], kind: ['string'], metadata: meta,
      spec: ['ApplicationSpec', 'Qué desplegar (source), dónde (destination) y cómo sincronizar (syncPolicy).'],
      operation: ['object', 'Operación en curso (la crean argocd app sync y la UI).'], status: ['object'],
    },
    required: ['spec'],
  },
  ApplicationSpec: {
    fields: {
      project: ['string', 'AppProject al que pertenece (default).'],
      source: ['ApplicationSource', 'El repositorio Git y la ruta con los manifiestos.'],
      sources: ['ApplicationSource[]', 'Varias fuentes (multi-source).'],
      destination: ['ApplicationDestination', 'El clúster y el namespace donde se despliega.'],
      syncPolicy: ['SyncPolicy', 'Sincronización automática, prune, selfHeal y opciones.'],
      ignoreDifferences: ['object[]', 'Campos que no cuentan como diferencia (p. ej. /spec/replicas si hay HPA).'],
      revisionHistoryLimit: ['int', 'Entradas del historial que se guardan (10).'],
      info: ['object[]'],
    },
    required: ['destination', 'project'],
  },
  ApplicationSource: {
    fields: {
      repoURL: ['string', 'URL del repositorio Git (o del repo de Helm).'],
      targetRevision: ['string', 'Rama, tag o commit. HEAD sigue la rama por defecto.'],
      path: ['string', 'Directorio del repo con los manifiestos, la kustomization o el chart.'],
      chart: ['string', 'Nombre del chart (si repoURL es un repositorio de Helm).'],
      directory: ['object', 'Opciones de un directorio de YAML: recurse, include, exclude.'],
      kustomize: ['object', 'Opciones de Kustomize: images, namePrefix, commonLabels…'],
      helm: ['object', 'Opciones de Helm: valueFiles, parameters, values, releaseName.'],
      ref: ['string'], plugin: ['object'],
    },
    required: ['repoURL'],
  },
  ApplicationDestination: {
    fields: {
      server: ['string', 'API del clúster: https://kubernetes.default.svc es el propio clúster.'],
      name: ['string', 'Nombre del clúster registrado (in-cluster).'],
      namespace: ['string', 'Namespace de destino.'],
    },
  },
  SyncPolicy: {
    fields: {
      automated: ['object', 'Sincroniza sola cuando cambia Git. prune: borra lo que ya no está en Git; selfHeal: deshace cambios manuales.'],
      syncOptions: ['string[]', 'Opciones como CreateNamespace=true o PruneLast=true.'],
      retry: ['object', 'Reintentos si falla la sincronización.'],
      managedNamespaceMetadata: ['object'],
    },
  },
  AppProject: {
    fields: { apiVersion: ['string'], kind: ['string'], metadata: meta, spec: ['object'], status: ['object'] },
  },
  ApplicationSet: {
    doc: 'Genera Applications con una plantilla y generadores (list, git, clusters…).',
    fields: {
      apiVersion: ['string'], kind: ['string'], metadata: meta,
      spec: ['ApplicationSetSpec'], status: ['object'],
    },
    required: ['spec'],
  },
  ApplicationSetSpec: {
    fields: {
      generators: ['object[]', 'De dónde salen los parámetros: list, git (directories), clusters…'],
      template: ['object', 'La Application que se genera; {{parametro}} se sustituye.'],
      syncPolicy: ['object'], goTemplate: ['bool'], goTemplateOptions: ['string[]'], strategy: ['object'], preservedFields: ['object'],
    },
    required: ['generators', 'template'],
  },
} as Record<string, TypeDef>);

export interface SchemaError {
  path: string;
  message: string;
}

const SCALAR_GO: Record<string, string> = { string: 'string', int: 'int32', bool: 'bool', number: 'float64' };

function goTypeName(t: string) {
  return t.replace(/\[\]$/, '');
}

/** Checks unknown fields and scalar types. Returns the first problems (strict decoding). */
export function checkSchema(kind: string, obj: Json): SchemaError[] {
  const errs: SchemaError[] = [];
  if (!TYPES[kind]) return errs;
  walk(kind, obj, '', errs, kind);
  return errs;
}

function walk(type: string, v: Json, path: string, errs: SchemaError[], parentType: string) {
  if (v === null || v === undefined) return;
  if (type.endsWith('[]')) {
    if (!Array.isArray(v)) {
      errs.push({
        path,
        message: `cannot unmarshal ${jsonKind(v)} into Go struct field ${parentType}.${path} of type []${goTypeName(type.slice(0, -2)) === 'string' ? 'string' : 'v1.' + type.slice(0, -2)}`,
      });
      return;
    }
    v.forEach((item) => walk(type.slice(0, -2), item, path, errs, parentType));
    return;
  }
  const scalar = SCALAR_GO[type];
  if (scalar) {
    const ok =
      type === 'string' ? typeof v === 'string' : type === 'bool' ? typeof v === 'boolean' : typeof v === 'number' && (type !== 'int' || Number.isInteger(v));
    if (!ok) errs.push({ path, message: `cannot unmarshal ${jsonKind(v)} into Go struct field ${parentType}.${path} of type ${scalar}` });
    return;
  }
  if (type === 'map') {
    if (typeof v !== 'object' || Array.isArray(v)) {
      errs.push({ path, message: `cannot unmarshal ${jsonKind(v)} into Go struct field ${parentType}.${path} of type map[string]string` });
      return;
    }
    for (const [k, val] of Object.entries(v)) {
      if (typeof val !== 'string')
        errs.push({ path: `${path}.${k}`, message: `cannot unmarshal ${jsonKind(val)} into Go struct field ${parentType}.${path} of type string` });
    }
    return;
  }
  if (type === 'intstr') {
    if (typeof v !== 'string' && typeof v !== 'number')
      errs.push({ path, message: `cannot unmarshal ${jsonKind(v)} into Go value of type intstr.IntOrString` });
    return;
  }
  if (type === 'quantity' || type === 'any' || type === 'object' || type === 'object[]') return;
  const def = TYPES[type];
  if (!def) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    errs.push({ path, message: `cannot unmarshal ${jsonKind(v)} into Go struct field ${parentType}.${path} of type v1.${type}` });
    return;
  }
  for (const [k, val] of Object.entries(v)) {
    const f = def.fields[k];
    const p = path ? `${path}.${k}` : k;
    if (!f) {
      errs.push({ path: p, message: `unknown field "${p}"` });
      continue;
    }
    walk(f[0], val, p, errs, parentType);
  }
}

function jsonKind(v: Json) {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  return 'object';
}

/** Resolves a dotted path (as in `kubectl explain deploy.spec.strategy`) to its type. */
export function typeAt(kind: string, path: string[]): { type: string; field?: Field; def?: TypeDef } | undefined {
  let type = kind;
  let field: Field | undefined;
  for (const p of path) {
    const def = TYPES[type.replace(/\[\]$/, '')];
    if (!def) return undefined;
    field = def.fields[p];
    if (!field) return undefined;
    type = field[0];
  }
  return { type, field, def: TYPES[type.replace(/\[\]$/, '')] };
}
