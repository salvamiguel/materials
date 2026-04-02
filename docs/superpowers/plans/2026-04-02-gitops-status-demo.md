# GitOps Status Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two polyrepo repositories (`gitops-status-demo-app` + `gitops-status-demo-config`) that demonstrate a complete GitOps workflow with real code: GitHub Release -> GHCR -> Kustomize -> ArgoCD -> kind.

**Architecture:** A Go Status Page app published to GHCR via GitHub Actions on release. A config repo with Kustomize base+overlays for dev/staging/prod and ArgoCD Applications. Strategy branches (blue-green, canary) in the config repo for deployment strategy demos. Local setup via kind + Makefile.

**Tech Stack:** Go 1.23 (stdlib only), Docker multi-stage builds, Kustomize, ArgoCD, Argo Rollouts, kind, GitHub Actions.

**Repos (already git init'd):**
- App: `/Users/salva/Documents/WORKING/otros/gitops-status-demo-app`
- Config: `/Users/salva/Documents/WORKING/otros/gitops-status-demo-config`

---

## Task 1: App — Go module + server

**Files:**
- Create: `go.mod`
- Create: `main.go`

- [ ] **Step 1: Create `go.mod`**

```
module github.com/salvamiguel/gitops-status-demo-app

go 1.23
```

- [ ] **Step 2: Create `main.go`**

```go
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

var (
	Version   = "dev"
	startTime = time.Now()
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/status", handleStatus)
	mux.HandleFunc("/", handleIndex)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("gitops-status-demo %s listening on :%s\n", Version, port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, "static/index.html")
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"version": Version,
	})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	color := os.Getenv("APP_COLOR")
	if color == "" {
		color = defaultColor()
	}
	env := os.Getenv("ENV")
	if env == "" {
		env = "local"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"version":  Version,
		"hostname": hostname,
		"env":      env,
		"color":    color,
		"uptime":   time.Since(startTime).Round(time.Second).String(),
	})
}

func defaultColor() string {
	switch {
	case strings.HasPrefix(Version, "v1"):
		return "#22c55e"
	case strings.HasPrefix(Version, "v2"):
		return "#3b82f6"
	case strings.HasPrefix(Version, "v3"):
		return "#a855f7"
	default:
		return "#6b7280"
	}
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app && go build -o server .`
Expected: binary `server` created with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
git add go.mod main.go
git commit -m "feat: add Go status page server with health and status endpoints"
```

---

## Task 2: App — Static HTML page

**Files:**
- Create: `static/index.html`

- [ ] **Step 1: Create `static/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Status</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.5s ease;
            background-color: #6b7280;
            color: white;
        }
        .container {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
            width: 100%;
        }
        .status-icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 2.5rem; margin-bottom: 0.5rem; font-weight: 700; }
        .subtitle { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }
        .version-badge {
            display: inline-block;
            background: rgba(255,255,255,0.25);
            padding: 0.3rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-top: 2rem;
        }
        .info-card {
            background: rgba(255,255,255,0.15);
            backdrop-filter: blur(10px);
            border-radius: 12px;
            padding: 1.2rem;
            border: 1px solid rgba(255,255,255,0.2);
        }
        .info-card .label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            opacity: 0.8;
            margin-bottom: 0.3rem;
        }
        .info-card .value {
            font-size: 1.1rem;
            font-weight: 600;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="status-icon">&#10003;</div>
        <div class="version-badge" id="version">Loading...</div>
        <h1>System Operational</h1>
        <p class="subtitle">All systems are running normally</p>
        <div class="info-grid">
            <div class="info-card">
                <div class="label">Hostname</div>
                <div class="value" id="hostname">-</div>
            </div>
            <div class="info-card">
                <div class="label">Environment</div>
                <div class="value" id="env">-</div>
            </div>
            <div class="info-card">
                <div class="label">Uptime</div>
                <div class="value" id="uptime">-</div>
            </div>
            <div class="info-card">
                <div class="label">Color</div>
                <div class="value" id="color">-</div>
            </div>
        </div>
    </div>
    <script>
        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                document.getElementById('version').textContent = data.version;
                document.getElementById('hostname').textContent = data.hostname;
                document.getElementById('env').textContent = data.env;
                document.getElementById('uptime').textContent = data.uptime;
                document.getElementById('color').textContent = data.color;
                document.body.style.backgroundColor = data.color;
            } catch (e) {
                document.getElementById('version').textContent = 'Error loading status';
            }
        }
        fetchStatus();
        setInterval(fetchStatus, 5000);
    </script>
</body>
</html>
```

- [ ] **Step 2: Run server and verify HTML loads**

Run:
```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
go run main.go &
sleep 1
curl -s http://localhost:8080/ | head -5
curl -s http://localhost:8080/api/status | python3 -m json.tool
curl -s http://localhost:8080/health | python3 -m json.tool
kill %1
```

Expected: HTML output from `/`, JSON from `/api/status` with version/hostname/env/color/uptime fields, JSON from `/health` with status=ok.

- [ ] **Step 3: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
git add static/index.html
git commit -m "feat: add status page HTML with auto-refresh"
```

---

## Task 3: App — Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM golang:1.23-alpine AS builder
ARG VERSION=dev
WORKDIR /app
COPY go.mod ./
COPY main.go ./
COPY static/ ./static/
RUN CGO_ENABLED=0 go build -ldflags="-X main.Version=${VERSION}" -o server .

FROM scratch
COPY --from=builder /app/server /server
COPY --from=builder /app/static /static
EXPOSE 8080
ENTRYPOINT ["/server"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
.git
server
README.md
Makefile
.github
```

- [ ] **Step 3: Build Docker image**

Run:
```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
docker build --build-arg VERSION=v1.0.0 -t gitops-status-demo-app:v1.0.0 .
```

Expected: image builds successfully, final stage is FROM scratch.

- [ ] **Step 4: Run and verify container**

Run:
```bash
docker run --rm -d -p 8080:8080 --name status-test gitops-status-demo-app:v1.0.0
sleep 1
curl -s http://localhost:8080/api/status | python3 -m json.tool
curl -s http://localhost:8080/health | python3 -m json.tool
docker stop status-test
```

Expected: version shows `v1.0.0`, color shows `#22c55e` (green default for v1).

- [ ] **Step 5: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
git add Dockerfile .dockerignore
git commit -m "feat: add multi-stage Dockerfile (scratch-based, ~15MB)"
```

---

## Task 4: App — GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yaml`

- [ ] **Step 1: Create `.github/workflows/ci.yaml`**

```yaml
name: CI/CD Pipeline

on:
  push:
    tags:
      - 'v*'

env:
  IMAGE_NAME: ghcr.io/${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v5

      - name: Extract version from tag
        run: echo "VERSION=${GITHUB_REF#refs/tags/}" >> $GITHUB_ENV

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          push: true
          build-args: VERSION=${{ env.VERSION }}
          tags: |
            ${{ env.IMAGE_NAME }}:${{ env.VERSION }}
            ${{ env.IMAGE_NAME }}:sha-${{ github.sha }}
            ${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  update-manifests:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          repository: salvamiguel/gitops-status-demo-config
          token: ${{ secrets.CONFIG_REPO_TOKEN }}

      - name: Update image tag in manifests
        run: |
          VERSION="${GITHUB_REF#refs/tags/}"
          sed -i "s|newTag:.*|newTag: ${VERSION}|" k8s/base/kustomization.yaml
          echo "Updated image tag to ${VERSION}"
          cat k8s/base/kustomization.yaml

      - name: Commit and push
        run: |
          VERSION="${GITHUB_REF#refs/tags/}"
          git config user.email "ci@github.com"
          git config user.name "GitHub Actions"
          git add k8s/base/kustomization.yaml
          git diff --cached --quiet && echo "No changes to commit" && exit 0
          git commit -m "chore: update image to ${VERSION}

          Triggered by: ${{ github.repository }}@${{ github.sha }}
          Actor: ${{ github.actor }}
          Workflow: ${{ github.workflow }}"
          git push
```

- [ ] **Step 2: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
git add .github/workflows/ci.yaml
git commit -m "ci: add build-push-deploy workflow triggered on tags"
```

---

## Task 5: App — Makefile, README, .gitignore

**Files:**
- Create: `.gitignore`
- Create: `Makefile`
- Create: `README.md`

- [ ] **Step 1: Create `.gitignore`**

```
server
*.exe
.idea/
.vscode/
*.swp
.DS_Store
```

- [ ] **Step 2: Create `Makefile`**

```makefile
VERSION ?= dev

.PHONY: run build docker-build docker-run clean

run:
	go run main.go

build:
	CGO_ENABLED=0 go build -ldflags="-X main.Version=$(VERSION)" -o server .

docker-build:
	docker build --build-arg VERSION=$(VERSION) -t gitops-status-demo-app:$(VERSION) .

docker-run: docker-build
	docker run --rm -p 8080:8080 -e APP_COLOR= -e ENV=local gitops-status-demo-app:$(VERSION)

clean:
	rm -f server
```

- [ ] **Step 3: Create `README.md`**

```markdown
# gitops-status-demo-app

A minimal Go status page for demonstrating GitOps workflows with ArgoCD.

## What it does

Serves a visual status page showing version, hostname, environment, and background color. Designed for classroom demos where version changes need to be **visually obvious**.

## Endpoints

| Route | Response | Purpose |
|-------|----------|---------|
| `GET /` | HTML status page | Visual demo in browser |
| `GET /health` | `{"status":"ok","version":"..."}` | K8s readinessProbe |
| `GET /api/status` | Full JSON | Testing with curl |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `APP_COLOR` | Per version | Background color (CSS value) |
| `ENV` | `local` | Environment name shown on page |

## Local development

```bash
make run              # Run locally
make build VERSION=v1.0.0  # Build binary
make docker-build VERSION=v1.0.0  # Build Docker image
make docker-run VERSION=v1.0.0    # Run in Docker
```

## CI/CD

On GitHub Release (tag `v*`):
1. GitHub Actions builds and pushes the image to `ghcr.io/salvamiguel/gitops-status-demo-app`
2. Updates the image tag in [gitops-status-demo-config](https://github.com/salvamiguel/gitops-status-demo-config)

**Required secret:** `CONFIG_REPO_TOKEN` — a fine-grained PAT with `contents: write` on `gitops-status-demo-config`.

### Creating the PAT

1. Go to GitHub Settings > Developer Settings > Personal Access Tokens > Fine-grained tokens
2. Create a token with:
   - Repository access: Only `gitops-status-demo-config`
   - Permissions: Contents → Read and write
3. In `gitops-status-demo-app` repo Settings > Secrets > Actions, add `CONFIG_REPO_TOKEN` with the token value.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
git add .gitignore Makefile README.md
git commit -m "chore: add Makefile, README, and .gitignore"
```

---

## Task 6: Config — Kustomize base

**Files:**
- Create: `k8s/base/deployment.yaml`
- Create: `k8s/base/service.yaml`
- Create: `k8s/base/kustomization.yaml`

- [ ] **Step 1: Create `k8s/base/deployment.yaml`**

```yaml
apiVersion: apps/v1
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
```

- [ ] **Step 2: Create `k8s/base/service.yaml`**

```yaml
apiVersion: v1
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
```

- [ ] **Step 3: Create `k8s/base/kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml

images:
  - name: ghcr.io/salvamiguel/gitops-status-demo-app
    newTag: latest
```

Note: The CI updates `newTag` in this file via `sed`. The `images` transformer in the base kustomization is the single source of truth for the image tag. Overlays do NOT have their own `images` section — the base controls the tag for all environments. `commonLabels` is not used because Kustomize doesn't understand Argo Rollouts CRDs, which would cause selector mismatches on strategy branches.

- [ ] **Step 4: Verify base renders**

Run:
```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
kubectl kustomize k8s/base/
```

Expected: rendered Deployment + Service YAML with image tag `latest`. The deployment references `app-config` configmap (which will be defined by `configMapGenerator` in overlays).

- [ ] **Step 5: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add k8s/base/
git commit -m "feat: add Kustomize base with deployment and service"
```

---

## Task 7: Config — Kustomize overlays

**Files:**
- Create: `k8s/overlays/dev/kustomization.yaml`
- Create: `k8s/overlays/dev/patch-replicas.yaml`
- Create: `k8s/overlays/staging/kustomization.yaml`
- Create: `k8s/overlays/staging/patch-replicas.yaml`
- Create: `k8s/overlays/prod/kustomization.yaml`
- Create: `k8s/overlays/prod/patch-replicas.yaml`

- [ ] **Step 1: Create dev overlay**

`k8s/overlays/dev/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
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
```

`k8s/overlays/dev/patch-replicas.yaml`:
```yaml
apiVersion: apps/v1
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
```

- [ ] **Step 2: Create staging overlay**

`k8s/overlays/staging/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
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
      - APP_COLOR=yellow
```

`k8s/overlays/staging/patch-replicas.yaml`:
```yaml
apiVersion: apps/v1
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
```

- [ ] **Step 3: Create prod overlay**

`k8s/overlays/prod/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
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
```

`k8s/overlays/prod/patch-replicas.yaml`:
```yaml
apiVersion: apps/v1
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
```

- [ ] **Step 4: Verify all overlays render correctly**

Run:
```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
echo "=== DEV ===" && kubectl kustomize k8s/overlays/dev/ | grep -E 'namespace:|replicas:|newTag:|ENV|APP_COLOR'
echo "=== STAGING ===" && kubectl kustomize k8s/overlays/staging/ | grep -E 'namespace:|replicas:|newTag:|ENV|APP_COLOR'
echo "=== PROD ===" && kubectl kustomize k8s/overlays/prod/ | grep -E 'namespace:|replicas:|newTag:|ENV|APP_COLOR'
```

Expected: each overlay shows its own namespace, replica count, and env vars. All three render without errors.

- [ ] **Step 5: Verify diff between environments**

Run:
```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
diff <(kubectl kustomize k8s/overlays/dev/) <(kubectl kustomize k8s/overlays/prod/) || true
```

Expected: differences in namespace, replicas, resource limits, and configmap literals.

- [ ] **Step 6: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add k8s/overlays/
git commit -m "feat: add Kustomize overlays for dev, staging, and prod"
```

---

## Task 8: Config — ArgoCD Applications

**Files:**
- Create: `argocd/application-dev.yaml`
- Create: `argocd/application-staging.yaml`
- Create: `argocd/application-prod.yaml`

- [ ] **Step 1: Create `argocd/application-dev.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
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
```

- [ ] **Step 2: Create `argocd/application-staging.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
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
```

- [ ] **Step 3: Create `argocd/application-prod.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
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
```

Note: prod has **no `automated` sync policy** — requires manual sync via ArgoCD UI or CLI.

- [ ] **Step 4: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add argocd/
git commit -m "feat: add ArgoCD Applications for dev, staging, and prod"
```

---

## Task 9: Config — Kind config + Makefile

**Files:**
- Create: `kind-config.yaml`
- Create: `Makefile`

- [ ] **Step 1: Create `kind-config.yaml`**

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080
        hostPort: 8080
        protocol: TCP
      - containerPort: 30443
        hostPort: 8443
        protocol: TCP
```

- [ ] **Step 2: Create `Makefile`**

```makefile
CLUSTER_NAME   := gitops-demo
KIND_CONFIG    := kind-config.yaml
ARGOCD_VERSION := v2.13.3

.PHONY: cluster argocd apps port-forward status rollouts clean help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

cluster: ## Create kind cluster
	kind create cluster --config $(KIND_CONFIG) --name $(CLUSTER_NAME)
	@echo "Waiting for node to be ready..."
	kubectl wait --for=condition=Ready nodes --all --timeout=120s
	@echo "Cluster $(CLUSTER_NAME) is ready."

argocd: ## Install ArgoCD and print admin password
	kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/$(ARGOCD_VERSION)/manifests/install.yaml
	@echo "Waiting for ArgoCD pods to be ready (this may take a few minutes)..."
	kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s
	@echo ""
	@echo "====================================="
	@echo "ArgoCD admin password:"
	@kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
	@echo ""
	@echo "====================================="

apps: ## Apply ArgoCD Applications
	kubectl apply -f argocd/
	@echo "Applications created. Run 'make status' to check sync state."

port-forward: ## Port-forward ArgoCD UI (8443) and app (8080)
	@echo "ArgoCD UI:  https://localhost:8443  (admin / password from 'make argocd')"
	@echo "App (dev):  http://localhost:8080"
	@echo ""
	@echo "Press Ctrl+C to stop."
	@kubectl port-forward svc/argocd-server -n argocd 8443:443 > /dev/null 2>&1 &
	@sleep 2
	@kubectl port-forward svc/gitops-status-demo -n status-dev 8080:80 2>/dev/null || \
		echo "App not deployed yet. Waiting for ArgoCD to sync..."

status: ## Show ArgoCD application status
	@echo "=== ArgoCD Applications ==="
	@kubectl get applications -n argocd 2>/dev/null || echo "ArgoCD not installed"
	@echo ""
	@echo "=== Pods ==="
	@kubectl get pods -A -l app=gitops-status-demo 2>/dev/null || echo "No pods found"

rollouts: ## Install Argo Rollouts controller
	kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
	@echo "Waiting for Argo Rollouts to be ready..."
	kubectl wait --for=condition=Ready pods --all -n argo-rollouts --timeout=120s
	@echo "Argo Rollouts installed."

clean: ## Delete the kind cluster
	kind delete cluster --name $(CLUSTER_NAME)
```

- [ ] **Step 3: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add kind-config.yaml Makefile
git commit -m "feat: add kind cluster config and Makefile for local setup"
```

---

## Task 10: Config — README + .gitignore

**Files:**
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Create `.gitignore`**

```
rendered-*.yaml
.idea/
.vscode/
*.swp
.DS_Store
```

- [ ] **Step 2: Create `README.md`**

```markdown
# gitops-status-demo-config

Kubernetes manifests and ArgoCD configuration for [gitops-status-demo-app](https://github.com/salvamiguel/gitops-status-demo-app). Uses Kustomize base+overlays for multi-environment management.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- (Optional) [argocd CLI](https://argo-cd.readthedocs.io/en/stable/cli_installation/)
- (Optional) [kubectl-argo-rollouts](https://argo-rollouts.readthedocs.io/en/stable/installation/#kubectl-plugin-installation) (for strategy branches)

## Quick start

```bash
make cluster    # Create kind cluster
make argocd     # Install ArgoCD (prints admin password)
make apps       # Create ArgoCD Applications (dev, staging, prod)
make port-forward  # Access ArgoCD UI (localhost:8443) and app (localhost:8080)
```

## Environments

| Environment | Namespace | Replicas | Sync | Color |
|-------------|-----------|----------|------|-------|
| dev | `status-dev` | 1 | Auto | green |
| staging | `status-staging` | 2 | Auto | yellow |
| prod | `status-prod` | 4 | Manual | blue |

## Kustomize structure

```
k8s/
├── base/           # Shared deployment + service
└── overlays/
    ├── dev/        # 1 replica, auto-sync
    ├── staging/    # 2 replicas, auto-sync
    └── prod/       # 4 replicas, manual sync
```

Preview rendered manifests:
```bash
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/prod
diff <(kubectl kustomize k8s/overlays/dev) <(kubectl kustomize k8s/overlays/prod)
```

## Deployment strategy branches

| Branch | Strategy | Requires |
|--------|----------|----------|
| `main` | Rolling Update | Nothing extra |
| `strategy/blue-green` | Blue-Green | `make rollouts` |
| `strategy/canary` | Canary | `make rollouts` |

To switch strategies:
```bash
git checkout strategy/blue-green
make rollouts       # Install Argo Rollouts
kubectl apply -f argocd/  # Re-apply Applications
```

## Makefile targets

```
make help          # Show all targets
make cluster       # Create kind cluster
make argocd        # Install ArgoCD
make apps          # Apply ArgoCD Applications
make port-forward  # Port-forward UI + app
make status        # Show app status
make rollouts      # Install Argo Rollouts
make clean         # Delete kind cluster
```

## Cleanup

```bash
make clean
```
```

- [ ] **Step 3: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add .gitignore README.md
git commit -m "chore: add README and .gitignore"
```

---

## Task 11: Config — strategy/blue-green branch

**Files (modified from main):**
- Replace: `k8s/base/deployment.yaml` -> `k8s/base/rollout.yaml`
- Replace: `k8s/base/service.yaml` -> `k8s/base/service-active.yaml` + `k8s/base/service-preview.yaml`
- Modify: `k8s/base/kustomization.yaml`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git checkout -b strategy/blue-green main
```

- [ ] **Step 2: Remove deployment.yaml and service.yaml from base**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
rm k8s/base/deployment.yaml k8s/base/service.yaml
```

- [ ] **Step 3: Create `k8s/base/rollout.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: gitops-status-demo
spec:
  replicas: 1
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
  strategy:
    blueGreen:
      activeService: status-demo-active
      previewService: status-demo-preview
      autoPromotionEnabled: false
      scaleDownDelaySeconds: 30
```

- [ ] **Step 4: Create `k8s/base/service-active.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: status-demo-active
spec:
  type: ClusterIP
  selector:
    app: gitops-status-demo
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
```

- [ ] **Step 5: Create `k8s/base/service-preview.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: status-demo-preview
spec:
  type: ClusterIP
  selector:
    app: gitops-status-demo
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
```

- [ ] **Step 6: Update `k8s/base/kustomization.yaml`**

Replace the file contents with:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - rollout.yaml
  - service-active.yaml
  - service-preview.yaml

images:
  - name: ghcr.io/salvamiguel/gitops-status-demo-app
    newTag: latest
```

- [ ] **Step 7: Update overlay patches to target Rollout instead of Deployment**

For each overlay (`dev`, `staging`, `prod`), update `kustomization.yaml` to change the patch target from `kind: Deployment` to `kind: Rollout`:

`k8s/overlays/dev/kustomization.yaml` — change `kind: Deployment` to `kind: Rollout` in the patches target.
`k8s/overlays/staging/kustomization.yaml` — same change.
`k8s/overlays/prod/kustomization.yaml` — same change.

Update each `patch-replicas.yaml` (`dev`, `staging`, `prod`) to use Rollout API:

`k8s/overlays/dev/patch-replicas.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
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
```

`k8s/overlays/staging/patch-replicas.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
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
```

`k8s/overlays/prod/patch-replicas.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
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
```

- [ ] **Step 8: Update ArgoCD Applications to reference this branch**

In all three files under `argocd/`, change `targetRevision`:
```yaml
    targetRevision: strategy/blue-green
```

- [ ] **Step 9: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add -A
git commit -m "feat: add blue-green deployment strategy with Argo Rollouts"
```

- [ ] **Step 10: Return to main**

```bash
git checkout main
```

---

## Task 12: Config — strategy/canary branch

**Files (modified from main):**
- Replace: `k8s/base/deployment.yaml` -> `k8s/base/rollout.yaml`
- Replace: `k8s/base/service.yaml` -> `k8s/base/service-stable.yaml` + `k8s/base/service-canary.yaml`
- Modify: `k8s/base/kustomization.yaml`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git checkout -b strategy/canary main
```

- [ ] **Step 2: Remove deployment.yaml and service.yaml from base**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
rm k8s/base/deployment.yaml k8s/base/service.yaml
```

- [ ] **Step 3: Create `k8s/base/rollout.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: gitops-status-demo
spec:
  replicas: 1
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
  strategy:
    canary:
      canaryService: status-demo-canary
      stableService: status-demo-stable
      steps:
        - setWeight: 10
        - pause: { duration: 30s }
        - setWeight: 25
        - pause: { duration: 30s }
        - setWeight: 50
        - pause: { duration: 30s }
        - setWeight: 100
```

- [ ] **Step 4: Create `k8s/base/service-stable.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: status-demo-stable
spec:
  type: ClusterIP
  selector:
    app: gitops-status-demo
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
```

- [ ] **Step 5: Create `k8s/base/service-canary.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: status-demo-canary
spec:
  type: ClusterIP
  selector:
    app: gitops-status-demo
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
```

- [ ] **Step 6: Update `k8s/base/kustomization.yaml`**

Replace the file contents with:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - rollout.yaml
  - service-stable.yaml
  - service-canary.yaml

images:
  - name: ghcr.io/salvamiguel/gitops-status-demo-app
    newTag: latest
```

- [ ] **Step 7: Update overlay patches to target Rollout instead of Deployment**

Same changes as Task 11 Step 7 — update all three overlays:

`k8s/overlays/dev/kustomization.yaml` — change `kind: Deployment` to `kind: Rollout` in the patches target.
`k8s/overlays/staging/kustomization.yaml` — same change.
`k8s/overlays/prod/kustomization.yaml` — same change.

Update each `patch-replicas.yaml` (`dev`, `staging`, `prod`) to use Rollout API:

`k8s/overlays/dev/patch-replicas.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
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
```

`k8s/overlays/staging/patch-replicas.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
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
```

`k8s/overlays/prod/patch-replicas.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
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
```

- [ ] **Step 8: Update ArgoCD Applications to reference this branch**

In all three files under `argocd/`, change `targetRevision`:
```yaml
    targetRevision: strategy/canary
```

- [ ] **Step 9: Commit**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git add -A
git commit -m "feat: add canary deployment strategy with Argo Rollouts"
```

- [ ] **Step 10: Return to main**

```bash
git checkout main
```

---

## Task 13: Local verification

- [ ] **Step 1: Verify Go app builds and runs**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
make build VERSION=v1.0.0
./server &
sleep 1
curl -s http://localhost:8080/health | python3 -m json.tool
curl -s http://localhost:8080/api/status | python3 -m json.tool
curl -s http://localhost:8080/ | head -3
kill %1
make clean
```

Expected: health returns `{"status":"ok","version":"v1.0.0"}`, status returns all fields, HTML starts with `<!DOCTYPE html>`.

- [ ] **Step 2: Verify Docker build**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-app
make docker-build VERSION=v1.0.0
docker images gitops-status-demo-app:v1.0.0 --format "{{.Size}}"
```

Expected: image size ~15-20MB.

- [ ] **Step 3: Verify all Kustomize overlays on main**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
for env in dev staging prod; do
  echo "=== $env ===" && kubectl kustomize k8s/overlays/$env/ > /dev/null && echo "OK"
done
```

Expected: all three render without errors.

- [ ] **Step 4: Verify strategy branches render**

```bash
cd /Users/salva/Documents/WORKING/otros/gitops-status-demo-config
git checkout strategy/blue-green
kubectl kustomize k8s/overlays/dev/ | grep "kind: Rollout" && echo "blue-green OK"
git checkout strategy/canary
kubectl kustomize k8s/overlays/dev/ | grep "kind: Rollout" && echo "canary OK"
git checkout main
```

Expected: both branches render Rollout resources.

---

## Task 14: Update materials documentation

**Files:**
- Modify: `/Users/salva/Documents/WORKING/materials/docs/gitops/teoria/multi-env.mdx`
- Modify: `/Users/salva/Documents/WORKING/materials/docs/gitops/teoria/estrategias-despliegue.mdx`
- Modify: `/Users/salva/Documents/WORKING/materials/docs/gitops/teoria/pipeline-end-to-end.mdx`

- [ ] **Step 1: Update `multi-env.mdx`**

Replace generic `mi-app` references with `gitops-status-demo-app`. Add a note at the top of the file linking to the real repos:

```markdown
:::tip Repositorios de ejemplo reales
Los ejemplos de esta seccin usan los repositorios reales del demo:
- **App**: [gitops-status-demo-app](https://github.com/salvamiguel/gitops-status-demo-app)
- **Config**: [gitops-status-demo-config](https://github.com/salvamiguel/gitops-status-demo-config)

Puedes clonarlos y ejecutar el flujo completo en local con `kind`.
:::
```

Update the image references from `ghcr.io/salvamiguel/mi-app` to `ghcr.io/salvamiguel/gitops-status-demo-app`, deployment name from `mi-app` to `gitops-status-demo`, namespace from `mi-app-dev` to `status-dev`, etc.

- [ ] **Step 2: Update `estrategias-despliegue.mdx`**

Add a note linking to the strategy branches in the config repo:

```markdown
:::tip Ejemplos reales con Argo Rollouts
El repositorio [gitops-status-demo-config](https://github.com/salvamiguel/gitops-status-demo-config) tiene branches con implementaciones reales:
- `strategy/blue-green` — Blue-Green con Argo Rollouts
- `strategy/canary` — Canary con pasos progresivos (10% → 25% → 50% → 100%)
:::
```

Update the Rollout examples to use `gitops-status-demo` instead of `mi-app`.

- [ ] **Step 3: Update `pipeline-end-to-end.mdx`**

Replace the generic GitHub Actions workflow with the real one from `gitops-status-demo-app/.github/workflows/ci.yaml`. Update repo names and image references throughout.

- [ ] **Step 4: Commit in materials repo**

```bash
cd /Users/salva/Documents/WORKING/materials
git add docs/gitops/teoria/multi-env.mdx docs/gitops/teoria/estrategias-despliegue.mdx docs/gitops/teoria/pipeline-end-to-end.mdx
git commit -m "docs: update GitOps docs with real gitops-status-demo repo references"
```
