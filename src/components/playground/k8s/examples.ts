// Built-in examples of the Kubernetes playground.

export interface Example {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;
  /** First command suggested in the terminal. */
  hint?: string;
  /** URL of the Git remote the example's repo pretends to be (ArgoCD reads it). */
  remote?: string;
}

const HOLA = `# Un Deployment mantiene 3 réplicas de nginx y un Service las
# publica dentro del clúster con un nombre y una IP estables.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web        # qué pods son "míos"
  template:
    metadata:
      labels:
        app: web      # tiene que coincidir con el selector
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web          # reparte el tráfico entre los pods con esta etiqueta
  ports:
    - port: 80
      targetPort: 80
`;

const ROLLING = `# RollingUpdate: sustituye los pods de uno en uno sin cortar el servicio.
# 1) kubectl apply -f rolling.yaml
# 2) Cambia la imagen a 6.7.1 (aquí o con kubectl set image) y vuelve a aplicar.
# 3) Mira el diagrama: aparece un ReplicaSet nuevo que crece mientras el viejo encoge.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: podinfo
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # como mucho 1 pod de más durante la actualización
      maxUnavailable: 0    # nunca menos de 4 pods listos
  selector:
    matchLabels:
      app: podinfo
  template:
    metadata:
      labels:
        app: podinfo
    spec:
      containers:
        - name: podinfo
          image: ghcr.io/stefanprodan/podinfo:6.7.0
          ports:
            - containerPort: 9898
          readinessProbe:          # un pod no recibe tráfico hasta que responde
            httpGet:
              path: /readyz
              port: 9898
            initialDelaySeconds: 2
---
apiVersion: v1
kind: Service
metadata:
  name: podinfo
spec:
  selector:
    app: podinfo
  ports:
    - port: 80
      targetPort: 9898
`;

const RECREATE = `# Recreate: primero se borran TODOS los pods viejos y después se crean los
# nuevos. Hay un corte de servicio, pero nunca conviven dos versiones.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: legacy
spec:
  replicas: 3
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: legacy
  template:
    metadata:
      labels:
        app: legacy
    spec:
      containers:
        - name: app
          image: hashicorp/http-echo:1.0
          args: ["-text=versión 1"]
`;

const BLUE = `# Blue/green: dos Deployments completos (azul = actual, verde = nueva).
# El Service apunta a uno u otro cambiando su selector "version".
# 1) kubectl apply -f .
# 2) kubectl port-forward svc/tienda 8080:80 &   y   curl localhost:8080
# 3) Cambia version: blue → green en service.yaml, aplica y repite el curl.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tienda-blue
spec:
  replicas: 2
  selector:
    matchLabels: { app: tienda, version: blue }
  template:
    metadata:
      labels: { app: tienda, version: blue }
    spec:
      containers:
        - name: tienda
          image: hashicorp/http-echo:1.0
          args: ["-text=🔵 tienda v1 (blue)"]
          ports: [{ containerPort: 5678 }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tienda-green
spec:
  replicas: 2
  selector:
    matchLabels: { app: tienda, version: green }
  template:
    metadata:
      labels: { app: tienda, version: green }
    spec:
      containers:
        - name: tienda
          image: hashicorp/http-echo:1.0
          args: ["-text=🟢 tienda v2 (green)"]
          ports: [{ containerPort: 5678 }]
`;

const BLUE_SVC = `apiVersion: v1
kind: Service
metadata:
  name: tienda
spec:
  selector:
    app: tienda
    version: blue      # cámbialo a green para pasar todo el tráfico
  ports:
    - port: 80
      targetPort: 5678
`;

const CANARY = `# Canary: la versión nueva recibe una parte pequeña del tráfico.
# El Service selecciona app=api, así que reparte entre los 9 pods estables
# y el 1 canary: ~10 % del tráfico va a la v2.
#   kubectl apply -f canary.yaml
#   kubectl port-forward svc/api 8080:80 &
#   for i in $(seq 40); do curl -s localhost:8080; done | sort | uniq -c
# Para subir el porcentaje, escala: kubectl scale deploy api-canary --replicas=5
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-stable
spec:
  replicas: 9
  selector:
    matchLabels: { app: api, track: stable }
  template:
    metadata:
      labels: { app: api, track: stable }
    spec:
      containers:
        - name: api
          image: hashicorp/http-echo:1.0
          args: ["-text=api v1"]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-canary
spec:
  replicas: 1
  selector:
    matchLabels: { app: api, track: canary }
  template:
    metadata:
      labels: { app: api, track: canary }
    spec:
      containers:
        - name: api
          image: hashicorp/http-echo:1.0
          args: ["-text=api v2 (canary)"]
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api           # ¡sin "track"! selecciona las dos versiones
  ports:
    - port: 80
      targetPort: 5678
`;

const STS = `# StatefulSet: cada pod tiene nombre fijo (db-0, db-1…) y su propio disco
# (un PVC por pod que sobrevive aunque borres el pod).
# Borra db-1 con el botón derecho: vuelve a nacer como db-1 con el mismo PVC.
apiVersion: v1
kind: Secret
metadata:
  name: db-credenciales
stringData:
  password: s3cr3t
---
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  clusterIP: None        # headless: DNS por pod (db-0.db, db-1.db…)
  selector:
    app: db
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db
  replicas: 3
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: postgres
          image: postgres:17
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-credenciales
                  key: password
          volumeMounts:
            - name: datos
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: datos
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
`;

const BATCH = `# Job: ejecuta hasta terminar.  CronJob: crea un Job según un horario.
# DaemonSet: un pod en cada nodo (fíjate en la vista "Nodos" del diagrama).
apiVersion: batch/v1
kind: Job
metadata:
  name: pi
spec:
  completions: 3
  parallelism: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: pi
          image: perl:5.34
          command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(100)"]
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: saludo
spec:
  schedule: "*/1 * * * *"        # cada minuto (sube la velocidad del reloj)
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: saludo
              image: busybox:1.36
              command: ["sh", "-c", "date; echo Hola desde el CronJob"]
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: agente-logs
spec:
  selector:
    matchLabels:
      app: agente-logs
  template:
    metadata:
      labels:
        app: agente-logs
    spec:
      containers:
        - name: agente
          image: busybox:1.36
          command: ["sh", "-c", "while true; do echo recogiendo logs de $(NODE); sleep 10; done"]
          env:
            - name: NODE
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
`;

const CONFIG = `# ConfigMap y Secret: la configuración fuera de la imagen.
# 1) kubectl apply -f config.yaml
# 2) kubectl port-forward deploy/portal 8080:80 &    y    curl localhost:8080
# 3) kubectl exec deploy/portal -- env   (mira SALUDO y DB_PASSWORD)
# Prueba a borrar el ConfigMap y reinicia: kubectl rollout restart deploy/portal
apiVersion: v1
kind: ConfigMap
metadata:
  name: portal-config
data:
  SALUDO: "Hola desde un ConfigMap"
  index.html: |
    <h1>Portal</h1>
    <p>Esta página viene de un ConfigMap montado como fichero.</p>
---
apiVersion: v1
kind: Secret
metadata:
  name: portal-secret
type: Opaque
stringData:
  DB_PASSWORD: "no-la-subas-a-git"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: portal
spec:
  replicas: 2
  selector:
    matchLabels:
      app: portal
  template:
    metadata:
      labels:
        app: portal
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          env:
            - name: SALUDO
              valueFrom:
                configMapKeyRef:
                  name: portal-config
                  key: SALUDO
          envFrom:
            - secretRef:
                name: portal-secret
          volumeMounts:
            - name: html
              mountPath: /usr/share/nginx/html
      volumes:
        - name: html
          configMap:
            name: portal-config
            items:
              - key: index.html
                path: index.html
`;

const INGRESS = `# Ingress: un único punto de entrada HTTP que enruta por host y ruta.
# El clúster trae el controlador ingress-nginx (172.18.255.200).
#   kubectl apply -f ingress.yaml
#   curl http://tienda.local/        → frontend
#   curl http://tienda.local/api     → api
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 2
  selector:
    matchLabels: { app: frontend }
  template:
    metadata:
      labels: { app: frontend }
    spec:
      containers:
        - name: web
          image: hashicorp/http-echo:1.0
          args: ["-text=frontend"]
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  selector: { app: frontend }
  ports: [{ port: 80, targetPort: 5678 }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: traefik/whoami:v1.10
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector: { app: api }
  ports: [{ port: 80, targetPort: 80 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tienda
spec:
  ingressClassName: nginx
  rules:
    - host: tienda.local
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
`;

const HPA = `# HorizontalPodAutoscaler: más pods cuando sube la CPU.
# 1) kubectl apply -f hpa.yaml
# 2) Botón derecho en el Deployment → "Carga de CPU: alta"
# 3) kubectl get hpa -w   (sube el reloj a 5x: el HPA evalúa cada 15 s)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: calculadora
spec:
  replicas: 1
  selector:
    matchLabels: { app: calculadora }
  template:
    metadata:
      labels: { app: calculadora }
    spec:
      containers:
        - name: app
          image: registry.k8s.io/hpa-example
          ports: [{ containerPort: 80 }]
          resources:
            requests:
              cpu: 200m        # sin requests el HPA no puede calcular el %
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: calculadora
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: calculadora
  minReplicas: 1
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
`;

const PROBES = `# Sondas: readiness decide si el pod recibe tráfico; liveness, si hay que
# reiniciarlo. Este ejemplo tiene un fallo a propósito: ¿cuál?
# Pistas: kubectl describe pod …, kubectl get endpoints web-sondas
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-sondas
spec:
  replicas: 2
  selector:
    matchLabels: { app: web-sondas }
  template:
    metadata:
      labels: { app: web-sondas }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          readinessProbe:
            httpGet:
              path: /
              port: 8080        # nginx escucha en el 80…
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: web-sondas
spec:
  selector: { app: web-sondas }
  ports: [{ port: 80, targetPort: 80 }]
`;

const K_BASE_DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: hashicorp/http-echo:1.0
          args: ["-text=$(MENSAJE)"]
          env:
            - name: MENSAJE
              valueFrom:
                configMapKeyRef:
                  name: web-config
                  key: MENSAJE
`;

const K_BASE_SVC = `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 5678
`;

const K_BASE = `# Base común a todos los entornos.
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: tienda
configMapGenerator:
  - name: web-config
    literals:
      - MENSAJE=hola desde la base
`;

const K_DEV = `# Entorno dev: namespace propio, prefijo y otro mensaje.
#   kubectl kustomize overlays/dev        (ver el resultado)
#   kubectl apply -k overlays/dev
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
namePrefix: dev-
resources:
  - ../../base
  - namespace.yaml
configMapGenerator:
  - name: web-config
    behavior: merge
    literals:
      - MENSAJE=hola desde dev
`;

const K_PROD = `# Entorno prod: más réplicas, otra imagen y un parche.
#   kubectl apply -k overlays/prod
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: prod
namePrefix: prod-
resources:
  - ../../base
  - namespace.yaml
replicas:
  - name: web
    count: 3
images:
  - name: hashicorp/http-echo
    newTag: "1.0.0"
patches:
  - path: recursos.yaml
configMapGenerator:
  - name: web-config
    behavior: merge
    literals:
      - MENSAJE=hola desde PRODUCCIÓN
`;

const K_PROD_PATCH = `# Parche estratégico: añade requests de CPU y memoria en prod.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: web
          resources:
            requests:
              cpu: 250m
              memory: 128Mi
`;

const ns = (n: string) => `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${n}\n`;

const CHART = `apiVersion: v2
name: tienda
description: Un chart sencillo para practicar Helm
type: application
version: 0.1.0
appVersion: "1.27"
`;

const VALUES = `# Valores por defecto del chart. Sobrescríbelos con -f o --set:
#   helm install tienda ./tienda --set replicaCount=3
#   helm upgrade tienda ./tienda -f tienda/values-prod.yaml
replicaCount: 2

image:
  repository: nginx
  tag: ""            # vacío: usa appVersion del Chart.yaml

service:
  type: ClusterIP
  port: 80

mensaje: "Hola desde Helm"

ingress:
  enabled: false
  host: tienda.local
`;

const VALUES_PROD = `replicaCount: 4
image:
  tag: "1.28"
mensaje: "Hola desde Helm (producción)"
ingress:
  enabled: true
  host: tienda.local
`;

const HELPERS = `{{/* Nombre completo: <release>-<chart> (o solo el release si ya lo contiene). */}}
{{- define "tienda.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "tienda.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "tienda.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
`;

const H_DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "tienda.fullname" . }}
  labels:
    {{- include "tienda.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "tienda.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "tienda.selectorLabels" . | nindent 8 }}
      annotations:
        # Cambia el hash si cambia el ConfigMap: fuerza un rollout.
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          ports:
            - containerPort: 80
          volumeMounts:
            - name: html
              mountPath: /usr/share/nginx/html
      volumes:
        - name: html
          configMap:
            name: {{ include "tienda.fullname" . }}
`;

const H_CM = `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "tienda.fullname" . }}
  labels:
    {{- include "tienda.labels" . | nindent 4 }}
data:
  index.html: |
    <h1>{{ .Values.mensaje }}</h1>
    <p>Release {{ .Release.Name }}, revisión {{ .Release.Revision }}.</p>
`;

const H_SVC = `apiVersion: v1
kind: Service
metadata:
  name: {{ include "tienda.fullname" . }}
  labels:
    {{- include "tienda.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  selector:
    {{- include "tienda.selectorLabels" . | nindent 4 }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: 80
`;

const H_ING = `{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "tienda.fullname" . }}
  labels:
    {{- include "tienda.labels" . | nindent 4 }}
spec:
  ingressClassName: nginx
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "tienda.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
`;

const H_NOTES = `¡{{ .Chart.Name }} instalado como "{{ .Release.Name }}"!

Pruébalo:
{{- if .Values.ingress.enabled }}
  curl http://{{ .Values.ingress.host }}/
{{- else }}
  kubectl port-forward svc/{{ include "tienda.fullname" . }} 8080:{{ .Values.service.port }} &
  curl localhost:8080
{{- end }}
`;

// ── ArgoCD: réplica del repo de clase salvamiguel/gitops-status-demo-config ──

const GS_K8S_BASE_KUSTOMIZATION = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml

images:
  - name: ghcr.io/salvamiguel/gitops-status-demo-app
    newTag: v1
`;

const GS_K8S_BASE_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitops-status-demo
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: gitops-status-demo
  template:
    metadata:
      labels:
        app: gitops-status-demo
    spec:
      containers:
        - name: gitops-status-demo
          image: ghcr.io/salvamiguel/gitops-status-demo-app:latest
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: app-config
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 5
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "100m"
              memory: "128Mi"
`;

const GS_K8S_BASE_SERVICE = `apiVersion: v1
kind: Service
metadata:
  name: gitops-status-demo
spec:
  type: ClusterIP
  selector:
    app: gitops-status-demo
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
`;

const GS_K8S_OVERLAYS_DEV_KUSTOMIZATION = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

namespace: status-dev

patches:
  - path: patch-replicas.yaml
    target:
      kind: Deployment
      name: gitops-status-demo

configMapGenerator:
  - name: app-config
    literals:
      - ENV=development
      - APP_COLOR=green
`;

const GS_K8S_OVERLAYS_DEV_PATCH_REPLICAS = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitops-status-demo
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: gitops-status-demo
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "100m"
              memory: "128Mi"
`;

const GS_K8S_OVERLAYS_STAGING_KUSTOMIZATION = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

namespace: status-staging

patches:
  - path: patch-replicas.yaml
    target:
      kind: Deployment
      name: gitops-status-demo

configMapGenerator:
  - name: app-config
    literals:
      - ENV=staging
      - APP_COLOR=orange
`;

const GS_K8S_OVERLAYS_STAGING_PATCH_REPLICAS = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitops-status-demo
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: gitops-status-demo
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "250m"
              memory: "256Mi"
`;

const GS_K8S_OVERLAYS_PROD_KUSTOMIZATION = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

namespace: status-prod

patches:
  - path: patch-replicas.yaml
    target:
      kind: Deployment
      name: gitops-status-demo

configMapGenerator:
  - name: app-config
    literals:
      - ENV=production
      - APP_COLOR=blue
`;

const GS_K8S_OVERLAYS_PROD_PATCH_REPLICAS = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitops-status-demo
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: gitops-status-demo
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
`;

const GS_ARGOCD_APPLICATION_DEV = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: status-dev
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/salvamiguel/gitops-status-demo-config
    targetRevision: HEAD
    path: k8s/overlays/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: status-dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
`;

const GS_ARGOCD_APPLICATION_STAGING = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: status-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/salvamiguel/gitops-status-demo-config
    targetRevision: HEAD
    path: k8s/overlays/staging
  destination:
    server: https://kubernetes.default.svc
    namespace: status-staging
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
`;

const GS_ARGOCD_APPLICATION_PROD = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: status-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/salvamiguel/gitops-status-demo-config
    targetRevision: HEAD
    path: k8s/overlays/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: status-prod
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
`;

const GS_README = `# gitops-status-demo-config (réplica offline del repo de clase)

Este playground tiene su propio Git: los ficheros del editor son el working
tree y \`git push\` publica en el remoto que lee ArgoCD
(https://github.com/salvamiguel/gitops-status-demo-config, simulado).

## 1. Instala ArgoCD (como en \`make argocd\`)

    kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
    kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.3/manifests/install.yaml
    kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s
    kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

## 2. Crea las Applications (\`make apps\`)

    kubectl apply -f argocd/
    kubectl get applications -n argocd -w

## 3. UI de ArgoCD y la app (\`make port-forward\`)

    kubectl port-forward svc/argocd-server -n argocd 8443:443 &
    kubectl port-forward svc/gitops-status-demo -n status-dev 8080:80 &
    open https://localhost:8443      # usuario admin + la contraseña del paso 1
    open http://localhost:8080       # la página de estado (verde en dev)

O con el CLI:

    argocd login localhost:8443 --insecure --username admin --password $(argocd admin initial-password -n argocd | head -1)
    argocd app list

## 4. GitOps: cambia Git, no el clúster

- Edita \`k8s/base/kustomization.yaml\` → \`newTag: v2\` y publica:

      git commit -am "Sube a v2" && git push

  dev y staging se sincronizan solos (la página muestra v2; el color lo fija
  APP_COLOR en cada overlay); prod es manual:
  \`argocd app sync status-prod\` o el botón SYNC de la UI.
- Prueba el selfHeal: \`kubectl scale deploy gitops-status-demo -n status-dev --replicas=5\`
- Rollback: \`git revert HEAD && git push\` (o History and Rollback en prod).
`;

export const EXAMPLES: Example[] = [
  {
    id: 'hola',
    label: 'Deployment + Service',
    description: 'Tres réplicas de nginx detrás de un Service. Aplica, borra un pod (botón derecho) y mira cómo el ReplicaSet lo vuelve a crear.',
    files: { 'web.yaml': HOLA },
    hint: 'kubectl apply -f web.yaml',
  },
  {
    id: 'rolling',
    label: 'Rolling update',
    description: 'Actualización gradual con maxSurge/maxUnavailable y readinessProbe. Cambia la imagen y observa los dos ReplicaSets.',
    files: { 'rolling.yaml': ROLLING },
    hint: 'kubectl apply -f rolling.yaml',
  },
  {
    id: 'recreate',
    label: 'Estrategia Recreate',
    description: 'Todos los pods viejos se borran antes de crear los nuevos. Cambia el texto a "versión 2" y aplica.',
    files: { 'recreate.yaml': RECREATE },
    hint: 'kubectl apply -f recreate.yaml',
  },
  {
    id: 'bluegreen',
    label: 'Blue/green',
    description: 'Dos versiones completas en paralelo; el Service cambia de una a otra de golpe editando su selector.',
    files: { 'deployments.yaml': BLUE, 'service.yaml': BLUE_SVC },
    hint: 'kubectl apply -f .',
  },
  {
    id: 'canary',
    label: 'Canary',
    description: 'Un 10 % del tráfico va a la versión nueva porque el Service selecciona los pods de las dos. Escala para cambiar el porcentaje.',
    files: { 'canary.yaml': CANARY },
    hint: 'kubectl apply -f canary.yaml',
  },
  {
    id: 'statefulset',
    label: 'StatefulSet + PVC',
    description: 'Postgres con identidad estable (db-0, db-1, db-2), un Service headless y un volumen por pod.',
    files: { 'postgres.yaml': STS },
    hint: 'kubectl apply -f postgres.yaml',
  },
  {
    id: 'batch',
    label: 'Job, CronJob y DaemonSet',
    description: 'Tareas que terminan, tareas periódicas y un agente en cada nodo.',
    files: { 'batch.yaml': BATCH },
    hint: 'kubectl apply -f batch.yaml',
  },
  {
    id: 'config',
    label: 'ConfigMap y Secret',
    description: 'Variables de entorno y ficheros montados desde un ConfigMap y un Secret.',
    files: { 'config.yaml': CONFIG },
    hint: 'kubectl apply -f config.yaml',
  },
  {
    id: 'ingress',
    label: 'Ingress',
    description: 'Enrutado por host y ruta a dos Services, con el controlador ingress-nginx del clúster.',
    files: { 'ingress.yaml': INGRESS },
    hint: 'kubectl apply -f ingress.yaml',
  },
  {
    id: 'hpa',
    label: 'Autoescalado (HPA)',
    description: 'Un HorizontalPodAutoscaler que añade pods cuando sube la CPU (simúlala con el botón derecho).',
    files: { 'hpa.yaml': HPA },
    hint: 'kubectl apply -f hpa.yaml',
  },
  {
    id: 'probes',
    label: 'Sondas (con un fallo)',
    description: 'Readiness y liveness probes, con un error para depurar con describe y endpoints.',
    files: { 'sondas.yaml': PROBES },
    hint: 'kubectl apply -f sondas.yaml',
  },
  {
    id: 'kustomize',
    label: 'Kustomize: base y overlays',
    description: 'Una base y dos entornos (dev y prod) con namespace, prefijo, réplicas, imagen, parches y configMapGenerator.',
    files: {
      'base/kustomization.yaml': K_BASE,
      'base/deployment.yaml': K_BASE_DEPLOY,
      'base/service.yaml': K_BASE_SVC,
      'overlays/dev/kustomization.yaml': K_DEV,
      'overlays/dev/namespace.yaml': ns('dev'),
      'overlays/prod/kustomization.yaml': K_PROD,
      'overlays/prod/namespace.yaml': ns('prod'),
      'overlays/prod/recursos.yaml': K_PROD_PATCH,
    },
    hint: 'kubectl kustomize overlays/dev',
  },
  {
    id: 'helm',
    label: 'Helm: un chart',
    description: 'Un chart con plantillas, helpers, valores y NOTES. Instálalo, actualízalo con otros valores y haz rollback.',
    files: {
      'tienda/Chart.yaml': CHART,
      'tienda/values.yaml': VALUES,
      'tienda/values-prod.yaml': VALUES_PROD,
      'tienda/templates/_helpers.tpl': HELPERS,
      'tienda/templates/deployment.yaml': H_DEPLOY,
      'tienda/templates/configmap.yaml': H_CM,
      'tienda/templates/service.yaml': H_SVC,
      'tienda/templates/ingress.yaml': H_ING,
      'tienda/templates/NOTES.txt': H_NOTES,
    },
    hint: 'helm install tienda ./tienda',
  },
  {
    id: 'argocd',
    label: 'ArgoCD: gitops-status-demo',
    description:
      'El repo de clase (Kustomize base + overlays dev/staging/prod y las Applications). Instala ArgoCD, sincroniza, cambia Git con commit y push y mira cómo reconcilia.',
    files: {
      'README.md': GS_README,
      'k8s/base/kustomization.yaml': GS_K8S_BASE_KUSTOMIZATION,
      'k8s/base/deployment.yaml': GS_K8S_BASE_DEPLOYMENT,
      'k8s/base/service.yaml': GS_K8S_BASE_SERVICE,
      'k8s/overlays/dev/kustomization.yaml': GS_K8S_OVERLAYS_DEV_KUSTOMIZATION,
      'k8s/overlays/dev/patch-replicas.yaml': GS_K8S_OVERLAYS_DEV_PATCH_REPLICAS,
      'k8s/overlays/staging/kustomization.yaml': GS_K8S_OVERLAYS_STAGING_KUSTOMIZATION,
      'k8s/overlays/staging/patch-replicas.yaml': GS_K8S_OVERLAYS_STAGING_PATCH_REPLICAS,
      'k8s/overlays/prod/kustomization.yaml': GS_K8S_OVERLAYS_PROD_KUSTOMIZATION,
      'k8s/overlays/prod/patch-replicas.yaml': GS_K8S_OVERLAYS_PROD_PATCH_REPLICAS,
      'argocd/application-dev.yaml': GS_ARGOCD_APPLICATION_DEV,
      'argocd/application-staging.yaml': GS_ARGOCD_APPLICATION_STAGING,
      'argocd/application-prod.yaml': GS_ARGOCD_APPLICATION_PROD,
    },
    remote: 'https://github.com/salvamiguel/gitops-status-demo-config',
    hint: 'kubectl create namespace argocd',
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
