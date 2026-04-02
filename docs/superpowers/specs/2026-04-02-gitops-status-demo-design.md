# GitOps Status Demo - Design Spec

**Date**: 2026-04-02
**Status**: Approved
**Goal**: Create two real, executable repositories that demonstrate the full GitOps workflow (release -> CI -> image -> config update -> ArgoCD deploy) to replace generic examples in the materials documentation.

---

## 1. Overview

Two polyrepo repositories for teaching GitOps in live classroom demos:

| Repo | Purpose | Location |
|------|---------|----------|
| `gitops-status-demo-app` | Go Status Page app + CI pipeline | `/Users/salva/Documents/WORKING/otros/gitops-status-demo-app` |
| `gitops-status-demo-config` | Kustomize manifests + ArgoCD config + local setup | `/Users/salva/Documents/WORKING/otros/gitops-status-demo-config` |

The app repo publishes Docker images to GHCR on GitHub Release. The CI pushes the new image tag to the config repo. ArgoCD (running locally in kind) detects the change and deploys.

## 2. App Repo: `gitops-status-demo-app`

### 2.1 Directory structure

```
gitops-status-demo-app/
├── main.go
├── go.mod
├── static/
│   └── index.html
├── Dockerfile
├── .github/
│   └── workflows/
│       └── ci.yaml
├── Makefile
└── README.md
```

### 2.2 The Status Page app

A single Go binary that serves a visual status page. No external dependencies, no database.

**Endpoints:**

| Route | Response | Purpose |
|-------|----------|---------|
| `GET /` | HTML status page | Visual demo in browser |
| `GET /health` | `{"status":"ok","version":"v1.0.0"}` | K8s readinessProbe |
| `GET /api/status` | Full JSON (version, hostname, env, color, uptime) | Testing with curl |

**What the page displays:**

- **Version**: injected at build time via `-ldflags "-X main.Version=v1.0.0"`
- **Background color**: from `APP_COLOR` env var (defaults per version: v1=green, v2=blue, v3=purple)
- **Hostname**: `os.Hostname()` — shows which pod is responding
- **Environment**: from `ENV` env var (dev/staging/prod)
- **Uptime**: calculated from process start time

**Version progression for demos:**

| Version | Color | Visual change |
|---------|-------|---------------|
| v1.0.0 | Green | Base: "System Operational", version, hostname, env, uptime |
| v2.0.0 | Blue | Adds "Last checked" timestamp field, updated layout |
| v3.0.0 | Purple | Adds simulated service metrics (API latency, DB status) |

The `APP_COLOR` env var overrides the default color, giving full flexibility in Kustomize overlays.

### 2.3 Dockerfile

Multi-stage build:

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

Final image: ~15MB. No shell, no OS, just the binary and static files.

### 2.4 GitHub Actions workflow (`ci.yaml`)

**Trigger**: push of tags matching `v*` (created via GitHub Releases).

**Job 1: `build-and-push`**

```yaml
runs-on: ubuntu-latest
permissions:
  contents: read
  packages: write
```

Steps:
1. `actions/checkout@v5`
2. `docker/login-action@v3` — login to GHCR with `GITHUB_TOKEN`
3. `docker/build-push-action@v6` — build and push with tags:
   - `ghcr.io/salvamiguel/gitops-status-demo-app:v1.0.0` (from git tag)
   - `ghcr.io/salvamiguel/gitops-status-demo-app:latest`
   - `ghcr.io/salvamiguel/gitops-status-demo-app:sha-<short-sha>`
4. GHA cache enabled (`cache-from: type=gha`, `cache-to: type=gha,mode=max`)

**Job 2: `update-manifests`** (needs: build-and-push)

```yaml
runs-on: ubuntu-latest
permissions:
  contents: write
```

Steps:
1. `actions/checkout@v5` of `salvamiguel/gitops-status-demo-config` using `CONFIG_REPO_TOKEN` (PAT fine-grained)
2. `sed -i` to update image tag in `k8s/base/deployment.yaml`
3. `git commit` + `git push` with descriptive message including source repo, tag, and actor

**Required secret**: `CONFIG_REPO_TOKEN` — PAT fine-grained with `contents: write` scoped only to `gitops-status-demo-config`. Documented in README with creation steps.

### 2.5 App Makefile

```makefile
run          # go run main.go (local dev)
build        # go build with version flag
docker-build # docker build locally
docker-run   # docker run locally on port 8080
```

## 3. Config Repo: `gitops-status-demo-config`

### 3.1 Directory structure (main branch)

```
gitops-status-demo-config/
├── k8s/
│   ├── base/
│   │   ├── kustomization.yaml
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   └── overlays/
│       ├── dev/
│       │   ├── kustomization.yaml
│       │   └── patch-replicas.yaml
│       ├── staging/
│       │   ├── kustomization.yaml
│       │   └── patch-replicas.yaml
│       └── prod/
│           ├── kustomization.yaml
│           └── patch-replicas.yaml
├── argocd/
│   ├── application-dev.yaml
│   ├── application-staging.yaml
│   └── application-prod.yaml
├── kind-config.yaml
├── Makefile
└── README.md
```

### 3.2 Kustomize base

**`base/kustomization.yaml`:**
- Resources: deployment.yaml, service.yaml
- Common labels: `app: gitops-status-demo`, `managed-by: kustomize`

**`base/deployment.yaml`:**
- Image: `ghcr.io/salvamiguel/gitops-status-demo-app:latest`
- 1 replica
- Port 8080
- readinessProbe: `httpGet /health` port 8080, initialDelaySeconds 3, periodSeconds 5
- Minimal resources: 50m CPU request, 64Mi memory request

**`base/service.yaml`:**
- ClusterIP, port 80 -> targetPort 8080
- Selector: `app: gitops-status-demo`

### 3.3 Kustomize overlays

**dev overlay:**

| Field | Value |
|-------|-------|
| namespace | `status-dev` |
| image tag | `latest` |
| replicas | 1 |
| ENV | `development` |
| APP_COLOR | `green` |
| CPU request | 50m |
| Memory request | 64Mi |

**staging overlay:**

| Field | Value |
|-------|-------|
| namespace | `status-staging` |
| image tag | (set by CI, e.g. `v1.0.0-rc1`) |
| replicas | 2 |
| ENV | `staging` |
| APP_COLOR | `yellow` |
| CPU request | 100m |
| Memory request | 128Mi |

**prod overlay:**

| Field | Value |
|-------|-------|
| namespace | `status-prod` |
| image tag | (set by CI, e.g. `v1.0.0`) |
| replicas | 4 |
| ENV | `production` |
| APP_COLOR | `blue` |
| CPU request | 250m |
| Memory request | 256Mi |

Each overlay has:
- `kustomization.yaml`: references `../../base`, sets namespace, images, configMapGenerator for env vars
- `patch-replicas.yaml`: strategic merge patch for replica count and resource limits

### 3.4 ArgoCD Applications

Three Application resources in `argocd/`:

**Common fields:**
- `spec.source.repoURL`: `https://github.com/salvamiguel/gitops-status-demo-config`
- `spec.source.targetRevision`: `HEAD`
- `spec.destination.server`: `https://kubernetes.default.svc`
- `syncOptions: [CreateNamespace=true]`

**Per-environment:**

| App | Path | Namespace | Sync policy |
|-----|------|-----------|-------------|
| `status-dev` | `k8s/overlays/dev` | `status-dev` | automated (prune + selfHeal) |
| `status-staging` | `k8s/overlays/staging` | `status-staging` | automated (prune + selfHeal) |
| `status-prod` | `k8s/overlays/prod` | `status-prod` | manual |

### 3.5 Deployment strategy branches

All branches share the same overlays structure. The difference is in what resource type is used.

**`main` branch — Rolling Update:**
- Standard `Deployment` with `strategy.type: RollingUpdate`
- `maxUnavailable: 1`, `maxSurge: 1`
- No extra tooling required

**`strategy/blue-green` branch — Blue-Green with Argo Rollouts:**
- `base/deployment.yaml` replaced by `base/rollout.yaml` (kind: Rollout)
- `base/service.yaml` replaced by `base/service-active.yaml` + `base/service-preview.yaml`
- `kustomization.yaml` updated to reference new files
- `strategy.blueGreen.activeService: status-demo-active`
- `strategy.blueGreen.previewService: status-demo-preview`
- `strategy.blueGreen.autoPromotionEnabled: false`
- `strategy.blueGreen.scaleDownDelaySeconds: 30`
- Makefile adds `rollouts` target to install Argo Rollouts controller

**`strategy/canary` branch — Canary with Argo Rollouts:**
- `base/deployment.yaml` replaced by `base/rollout.yaml` (kind: Rollout)
- `base/service.yaml` replaced by `base/service-stable.yaml` + `base/service-canary.yaml`
- Canary steps: 10% (pause 30s) -> 25% (pause 30s) -> 50% (pause 30s) -> 100%
- Pause durations shortened from production values for classroom demos
- Makefile adds `rollouts` target to install Argo Rollouts controller

### 3.6 Kind cluster configuration

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

Access to the app and ArgoCD UI is via `kubectl port-forward` (managed by the Makefile `port-forward` target). The `extraPortMappings` in the kind config reserve the host ports so port-forward binds reliably. The base Service stays as ClusterIP — no kind-specific patches needed.

### 3.7 Config Makefile

```makefile
cluster          # kind create cluster --config kind-config.yaml --name gitops-demo
argocd           # kubectl apply ArgoCD manifests, wait for ready, print admin password
apps             # kubectl apply -f argocd/ (all 3 Applications)
port-forward     # kubectl port-forward for ArgoCD UI (8443) + app (8080)
status           # argocd app list (shows sync status of all apps)
rollouts         # install Argo Rollouts controller (only needed for strategy branches)
clean            # kind delete cluster --name gitops-demo
```

## 4. CI/CD Flow (end to end)

```
Developer                App Repo                    GHCR                    Config Repo              ArgoCD              K8s
   |                        |                          |                        |                      |                  |
   |-- create Release v2 -->|                          |                        |                      |                  |
   |                        |-- GH Action triggers --->|                        |                      |                  |
   |                        |   build + push image --->|                        |                      |                  |
   |                        |   (v2.0.0, latest, sha)  |                        |                      |                  |
   |                        |                          |                        |                      |                  |
   |                        |-- checkout config repo --|----------------------->|                      |                  |
   |                        |   sed image tag ---------|----------------------->|                      |                  |
   |                        |   git push --------------|----------------------->|                      |                  |
   |                        |                          |                        |                      |                  |
   |                        |                          |                        |<-- poll/webhook ------|                  |
   |                        |                          |                        |   detect new commit ->|                  |
   |                        |                          |                        |                      |-- kubectl apply ->|
   |                        |                          |                        |                      |   (dev: auto)     |
   |                        |                          |                        |                      |   (prod: manual)  |
```

## 5. Classroom demo flow

### Basic flow (Rolling Update on main branch)

1. `make cluster && make argocd && make apps` in config repo
2. Open browser: `localhost:8443` (ArgoCD UI), `localhost:8080` (app)
3. Show app v1.0.0: green background, "System Operational"
4. In app repo: make a code change (e.g., new text, new field)
5. Create GitHub Release v2.0.0
6. Watch GH Actions run in the app repo
7. Watch ArgoCD detect the change in the config repo
8. Refresh browser: blue background, new features visible
9. Show `kubectl get pods` — pods replaced via rolling update

### Switching deployment strategies

1. In config repo: `git checkout strategy/blue-green`
2. `make rollouts` (install Argo Rollouts if not already)
3. Update ArgoCD Application to point to the new branch (or re-apply from branch)
4. Trigger a version change
5. Show preview service with new version, promote manually
6. Repeat with `strategy/canary` for progressive rollout

### Rollback demo

1. Deploy v2.0.0
2. `git revert` the image tag commit in config repo
3. ArgoCD auto-syncs back to v1.0.0
4. Or: `argocd app history` + `argocd app rollback`

## 6. Documentation updates

After repos are created and working, update these files in `materials`:

| File | Change |
|------|--------|
| `docs/gitops/teoria/multi-env.mdx` | Replace `mi-app` with `gitops-status-demo-app`. Add links to real repos. |
| `docs/gitops/teoria/estrategias-despliegue.mdx` | Add reference to `strategy/*` branches with real examples. |
| `docs/gitops/teoria/pipeline-end-to-end.mdx` | Replace generic workflow with the real `ci.yaml` from the app repo. |

## 7. Prerequisites

For students replicating the setup:

- Docker
- kind
- kubectl
- (Optional) `argocd` CLI
- (Optional) `kubectl-argo-rollouts` plugin (for strategy branches)

For the CI pipeline (instructor setup only):
- GitHub account with access to both repos
- PAT fine-grained with `contents: write` on `gitops-status-demo-config`
- PAT stored as `CONFIG_REPO_TOKEN` secret in `gitops-status-demo-app`
