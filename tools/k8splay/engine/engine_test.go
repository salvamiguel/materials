package engine

import (
	"strings"
	"testing"
)

var kfiles = map[string]string{
	"base/kustomization.yaml": `resources:
  - deployment.yaml
  - service.yaml
configMapGenerator:
  - name: web-config
    literals:
      - MENSAJE=base
`,
	"base/deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web}
    spec:
      containers:
        - name: web
          image: hashicorp/http-echo:1.0
          envFrom:
            - configMapRef:
                name: web-config
`,
	"base/service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector: {app: web}
  ports: [{port: 80, targetPort: 5678}]
`,
	"overlays/prod/kustomization.yaml": `namespace: prod
namePrefix: prod-
resources:
  - ../../base
replicas:
  - name: web
    count: 3
images:
  - name: hashicorp/http-echo
    newTag: "1.0.0"
patches:
  - path: patch.yaml
configMapGenerator:
  - name: web-config
    behavior: merge
    literals:
      - MENSAJE=prod
`,
	"overlays/prod/patch.yaml": `apiVersion: apps/v1
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
`,
}

func TestKustomizeOverlay(t *testing.T) {
	r := Kustomize(KustomizeRequest{Files: kfiles, Dir: "overlays/prod"})
	if r.Error != "" {
		t.Fatal(r.Error)
	}
	if len(r.Resources) != 3 {
		t.Fatalf("want 3 resources, got %d:\n%s", len(r.Resources), r.YAML)
	}
	for _, want := range []string{"name: prod-web", "namespace: prod", "replicas: 3", "image: hashicorp/http-echo:1.0.0", "cpu: 250m", "MENSAJE: prod", "name: prod-web-config-"} {
		if !strings.Contains(r.YAML, want) {
			t.Errorf("missing %q in:\n%s", want, r.YAML)
		}
	}
	cm, svc, dep := strings.Index(r.YAML, "kind: ConfigMap"), strings.Index(r.YAML, "kind: Service"), strings.Index(r.YAML, "kind: Deployment")
	if !(cm < svc && svc < dep) {
		t.Errorf("want legacy order (ConfigMap before Service/Deployment):\n%s", r.YAML)
	}
	if strings.Contains(r.YAML, "config.kubernetes.io/origin") {
		t.Errorf("origin annotation leaked:\n%s", r.YAML)
	}
	origins := map[string]bool{}
	for _, res := range r.Resources {
		origins[res.Origin] = true
	}
	if !origins["base/deployment.yaml"] || !origins["base/service.yaml"] {
		t.Errorf("origins: %v", origins)
	}
	// The ConfigMap reference was rewritten to the hashed name.
	if !strings.Contains(r.YAML, "name: prod-web-config-") {
		t.Error("configMapRef not rewritten")
	}
}

func TestKustomizeErrors(t *testing.T) {
	r := Kustomize(KustomizeRequest{Files: kfiles, Dir: "nope"})
	if !strings.Contains(r.Error, "unable to find one of 'kustomization.yaml'") {
		t.Errorf("got %q", r.Error)
	}
	bad := map[string]string{"k/kustomization.yaml": "resources:\n  - missing.yaml\n"}
	r = Kustomize(KustomizeRequest{Files: bad, Dir: "k"})
	if r.Error == "" || strings.Contains(r.Error, "/workspace") {
		t.Errorf("got %q", r.Error)
	}
}

var chartFiles = map[string]string{
	"tienda/Chart.yaml": "apiVersion: v2\nname: tienda\nversion: 0.1.0\nappVersion: \"1.27\"\n",
	"tienda/values.yaml": "replicaCount: 2\nimage:\n  repository: nginx\n  tag: \"\"\nmensaje: hola\ningress:\n  enabled: false\n",
	"tienda/values-prod.yaml": "replicaCount: 4\ningress:\n  enabled: true\n",
	"tienda/templates/_helpers.tpl": `{{- define "tienda.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}`,
	"tienda/templates/deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "tienda.fullname" . }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      containers:
        - name: web
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
`,
	"tienda/templates/configmap.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ include \"tienda.fullname\" . }}\ndata:\n  msg: {{ .Values.mensaje | quote }}\n",
	"tienda/templates/ingress.yaml": "{{- if .Values.ingress.enabled }}\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: x\n{{- end }}\n",
	"tienda/templates/NOTES.txt": "Instalado {{ .Release.Name }} rev {{ .Release.Revision }}\n",
}

func TestHelmRender(t *testing.T) {
	r := Helm(HelmRequest{Files: chartFiles, ChartDir: "./tienda", Release: "web", Namespace: "default", IsInstall: true})
	if r.Error != "" {
		t.Fatal(r.Error)
	}
	if len(r.Manifests) != 2 {
		t.Fatalf("want deployment + configmap, got %+v", r.Manifests)
	}
	all := r.Manifests[0].YAML + r.Manifests[1].YAML
	for _, want := range []string{"name: web-tienda", "replicas: 2", `image: "nginx:1.27"`, `msg: "hola"`, "checksum/config: "} {
		if !strings.Contains(all, want) {
			t.Errorf("missing %q in:\n%s", want, all)
		}
	}
	if r.Notes != "Instalado web rev 1\n" {
		t.Errorf("notes %q", r.Notes)
	}
	if r.Manifests[0].Template != "tienda/templates/configmap.yaml" {
		t.Errorf("template path %q", r.Manifests[0].Template)
	}
}

func TestHelmValues(t *testing.T) {
	r := Helm(HelmRequest{Files: chartFiles, ChartDir: "tienda", Release: "web", ValueFiles: []string{"tienda/values-prod.yaml"}, Set: []string{"image.tag=1.28", "mensaje=adiós"}, Revision: 3})
	if r.Error != "" {
		t.Fatal(r.Error)
	}
	var all string
	for _, m := range r.Manifests {
		all += m.YAML
	}
	for _, want := range []string{"replicas: 4", `image: "nginx:1.28"`, "kind: Ingress", `msg: "adiós"`} {
		if !strings.Contains(all, want) {
			t.Errorf("missing %q in:\n%s", want, all)
		}
	}
	if r.UserValues["replicaCount"] != float64(4) {
		t.Errorf("user values: %v", r.UserValues)
	}
}

func TestHelmErrors(t *testing.T) {
	bad := map[string]string{}
	for k, v := range chartFiles {
		bad[k] = v
	}
	bad["tienda/templates/configmap.yaml"] = "data: {{ .Values.nope.deeper }}\n"
	r := Helm(HelmRequest{Files: bad, ChartDir: "tienda", Release: "web"})
	if !strings.Contains(r.Error, "nil pointer evaluating interface {}.deeper") {
		t.Errorf("got %q", r.Error)
	}
	r = Helm(HelmRequest{Files: chartFiles, ChartDir: "otro", Release: "web"})
	if !strings.Contains(r.Error, "not found") {
		t.Errorf("got %q", r.Error)
	}
}
