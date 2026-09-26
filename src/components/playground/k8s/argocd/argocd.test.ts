import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Cluster } from '../engine/cluster';
import { runLine, type ShellCtx, type ShellResult } from '../engine/shell';
import { initRepo, type GitRepo } from '../engine/git';
import { EXAMPLES } from '../examples';
import { RepoServer } from './repoServer';
import type { Renderer } from '../wasm';
import type { Obj } from '../engine/types';

const T0 = Date.UTC(2026, 8, 26, 9, 0, 0);
const STATIC = fileURLToPath(new URL('../../../../../static/k8splay', import.meta.url));
const HAS_WASM = existsSync(`${STATIC}/k8splay.wasm`);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let renderer: Promise<Renderer> | undefined;
/** kustomize and Helm from the real Go/WASM engine (built by `bun run build:wasm`). */
function wasmRenderer(): Promise<Renderer> {
  renderer ??= (async () => {
    const g = globalThis as Json;
    g.self ??= g;
    new Function(readFileSync(`${STATIC}/wasm_exec.js`, 'utf8'))();
    const go = new g.Go();
    const ready = new Promise((r) => (g.__k8splayReady = r));
    const { instance } = await WebAssembly.instantiate(readFileSync(`${STATIC}/k8splay.wasm`), go.importObject);
    go.run(instance);
    await ready;
    const call = (m: string, a: unknown) => JSON.parse(g.k8splay[m](JSON.stringify(a)));
    return { kustomize: async (r) => call('kustomize', r), helm: async (r) => call('helm', r) };
  })();
  return renderer;
}

function session(files: Record<string, string>, remote?: string) {
  const cl = Cluster.create(T0, 7);
  const st: { files: Record<string, string>; git: GitRepo } = { files: { ...files }, git: initRepo(files, remote, T0) };
  const repo = new RepoServer({ git: () => st.git, renderer: wasmRenderer, fetchGitHub: async () => ({}) });
  const ctx = (): ShellCtx => ({ cl, files: st.files, git: st.git, kustomize: undefined });
  const absorb = (r: ShellResult) => {
    if (r.git) st.git = r.git;
    if (r.files) st.files = r.files;
    if (r.writeFiles) st.files = { ...st.files, ...r.writeFiles };
    return r;
  };
  const s = {
    cl,
    st,
    async run(line: string) {
      return absorb(await runLine(line, ctx()));
    },
    /** Advances simulated time, pumping the repo-server like the UI does. */
    async tick(ms: number) {
      for (let t = 0; t < ms; t += 500) {
        cl.advance(500);
        while (await repo.pump(cl));
      }
    },
    /** Runs a streaming command until it ends. */
    async stream(line: string, ms = 120_000) {
      const r = await s.run(line);
      let out = r.output;
      if (!r.stream) return { output: out, exitCode: r.exitCode };
      for (let t = 0; t < ms; t += 500) {
        await s.tick(500);
        const p = r.stream.poll(cl);
        out += p.text;
        if (p.done) return { output: out, exitCode: p.exitCode ?? 0 };
      }
      return { output: out + r.stream.stop(cl), exitCode: 130 };
    },
    app(name: string): Obj {
      return cl.get('Application', 'argocd', name)!;
    },
  };
  return s;
}

async function installed(files: Record<string, string>, remote?: string) {
  const s = session(files, remote);
  await s.run('kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -');
  await s.run('kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.3/manifests/install.yaml');
  const w = await s.stream('kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s');
  expect(w.exitCode).toBe(0);
  return s;
}

const example = EXAMPLES.find((e) => e.id === 'argocd')!;

const PLAIN_APP = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: web
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://git.playground.local/alumno/playground.git
    targetRevision: HEAD
    path: app
  destination:
    server: https://kubernetes.default.svc
    namespace: web
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
`;

const PLAIN_DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27
`;

const PLAIN_CM = `apiVersion: v1
kind: ConfigMap
metadata:
  name: extra
data:
  a: "1"
`;

describe('installation', () => {
  test('CRDs are needed first', async () => {
    const s = session({ 'argocd/app.yaml': PLAIN_APP });
    const r = await s.run('kubectl apply -f argocd/app.yaml');
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('ensure CRDs are installed first');
    expect((await s.run('kubectl get applications -n argocd')).output).toContain(`the server doesn't have a resource type "applications"`);
  });

  test('install.yaml by URL, like in class', async () => {
    const s = session({});
    const noNs = await s.run('kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.3/manifests/install.yaml');
    expect(noNs.output).toContain('namespaces "argocd" not found');
    await s.run('kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -');
    const r = await s.run('kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.3/manifests/install.yaml');
    // The CRDs got in on the first try (cluster-scoped); the rest is new now.
    expect(r.output).toContain('customresourcedefinition.apiextensions.k8s.io/applications.argoproj.io unchanged');
    expect(r.output).toContain('serviceaccount/argocd-server created');
    expect(r.output).toContain('statefulset.apps/argocd-application-controller created');
    const w = await s.stream('kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s');
    expect(w.exitCode).toBe(0);
    expect(w.output).toContain('argocd-application-controller-0 condition met');
    const pw = await s.run('kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d');
    expect(pw.output).toMatch(/^[A-Za-z0-9]{16}$/);
    expect((await s.run('kubectl get appproj -n argocd')).output).toContain('default');
  });
});

describe('git', () => {
  test('status, commit, push, log, revert', async () => {
    const s = session({ 'a.yaml': PLAIN_CM });
    expect((await s.run('git status')).output).toContain('nothing to commit, working tree clean');
    s.st.files['a.yaml'] = PLAIN_CM.replace('"1"', '"2"');
    expect((await s.run('git status')).output).toContain('modified:   a.yaml');
    expect((await s.run('git diff')).output).toContain('+  a: "2"');
    const c = await s.run('git commit -am "Cambia a"');
    expect(c.output).toMatch(/\[main [0-9a-f]{7}\] Cambia a/);
    expect((await s.run('git status')).output).toContain('ahead of');
    const p = await s.run('git push');
    expect(p.output).toContain('main -> main');
    expect(s.st.git.pushed).toBe(s.st.git.head);
    expect((await s.run('git log --oneline')).output.split('\n')[0]).toContain('Cambia a');
    await s.run('git revert HEAD --no-edit');
    expect(s.st.files['a.yaml']).toContain('"1"');
  });

  test('not a repo without git state', async () => {
    const cl = Cluster.create(T0, 7);
    const r = await runLine('git status', { cl, files: {} });
    expect(r.exitCode).toBe(128);
  });
});

describe('application controller', () => {
  test('directory app: sync, selfHeal, prune, push', async () => {
    const s = await installed({ 'argocd/app.yaml': PLAIN_APP, 'app/deploy.yaml': PLAIN_DEPLOY, 'app/extra.yaml': PLAIN_CM });
    await s.run('kubectl apply -f argocd/app.yaml');
    await s.tick(20_000);
    const app = s.app('web');
    expect(app.status.sync.status).toBe('Synced');
    expect(app.status.health.status).toBe('Healthy');
    expect(s.cl.get('Deployment', 'web', 'web')!.metadata.labels['app.kubernetes.io/instance']).toBe('web');
    expect((await s.run('kubectl get applications -n argocd')).output).toMatch(/web\s+Synced\s+Healthy/);

    // selfHeal reverts a manual change.
    await s.run('kubectl scale deploy web -n web --replicas=5');
    await s.tick(15_000);
    expect(s.cl.get('Deployment', 'web', 'web')!.spec.replicas).toBe(2);

    // A push changes the desired state (the webhook refreshes in ~5 s).
    s.st.files['app/deploy.yaml'] = PLAIN_DEPLOY.replace('replicas: 2', 'replicas: 3');
    delete s.st.files['app/extra.yaml'];
    await s.run('git add -A');
    await s.run('git commit -m "3 réplicas y fuera extra"');
    const before = s.app('web').status.sync.revision;
    await s.tick(3_000);
    expect(s.cl.get('Deployment', 'web', 'web')!.spec.replicas).toBe(2); // not pushed yet
    await s.run('git push');
    await s.tick(15_000);
    expect(s.app('web').status.sync.revision).not.toBe(before);
    expect(s.app('web').status.sync.revision).toBe(s.st.git.pushed);
    expect(s.cl.get('Deployment', 'web', 'web')!.spec.replicas).toBe(3);
    expect(s.cl.get('ConfigMap', 'web', 'extra')).toBeUndefined(); // pruned
    expect(s.app('web').status.history.length).toBe(3); // initial, self-heal, push
  });

  test('controller pod down: nothing reconciles until the StatefulSet recreates it', async () => {
    const s = await installed({ 'argocd/app.yaml': PLAIN_APP.replace('prune: true\n      selfHeal: true', 'prune: true'), 'app/deploy.yaml': PLAIN_DEPLOY });
    await s.run('kubectl apply -f argocd/app.yaml');
    await s.tick(20_000);
    expect(s.app('web').status.sync.status).toBe('Synced');
    await s.run('kubectl delete pod argocd-application-controller-0 -n argocd --wait=false');
    await s.run('kubectl scale deploy web -n web --replicas=4');
    await s.tick(1_000);
    expect(s.app('web').status.sync.status).toBe('Synced'); // stale: nobody compares
    await s.tick(40_000);
    expect(s.app('web').status.sync.status).toBe('OutOfSync'); // back, no selfHeal
    const logs = await s.run('kubectl logs argocd-application-controller-0 -n argocd');
    expect(logs.output).toContain('Reconciliation completed');
  });

  test('deleting the app cascades through its finalizer', async () => {
    const s = await installed({
      'argocd/app.yaml': PLAIN_APP.replace(
        '  name: web\n  namespace: argocd',
        '  name: web\n  namespace: argocd\n  finalizers:\n    - resources-finalizer.argocd.argoproj.io',
      ),
      'app/deploy.yaml': PLAIN_DEPLOY,
    });
    await s.run('kubectl apply -f argocd/app.yaml');
    await s.tick(20_000);
    expect(s.cl.get('Deployment', 'web', 'web')).toBeDefined();
    await s.run('kubectl delete application web -n argocd --wait=false');
    await s.tick(5_000);
    expect(s.cl.get('Application', 'argocd', 'web')).toBeUndefined();
    expect(s.cl.get('Deployment', 'web', 'web')).toBeUndefined();
  });
});

(HAS_WASM ? describe : (_n: string, _f: () => void) => undefined)('class repo: gitops-status-demo-config', () => {
  test('dev/staging auto, prod manual; argocd CLI; status page', async () => {
    const s = await installed(example.files, example.remote);
    const a = await s.run('kubectl apply -f argocd/');
    expect(a.output).toContain('application.argoproj.io/status-dev created');
    await s.tick(40_000);
    expect(s.app('status-dev').status.sync.status).toBe('Synced');
    expect(s.app('status-dev').status.health.status).toBe('Healthy');
    expect(s.app('status-staging').status.sync.status).toBe('Synced');
    expect(s.app('status-prod').status.sync.status).toBe('OutOfSync');
    expect(s.app('status-prod').status.health.status).toBe('Missing');
    expect(s.cl.list('Pod', 'status-staging').length).toBe(2);

    // CLI through a port-forward, like in class.
    expect((await s.run('argocd app list')).output).toContain('Argo CD server address unspecified');
    await s.run('kubectl port-forward svc/argocd-server -n argocd 8443:443 &');
    const bad = await s.run('argocd login localhost:8443 --insecure --username admin --password nope');
    expect(bad.output).toContain('Invalid username or password');
    const login = await s.run('argocd login localhost:8443 --insecure --username admin --password $(argocd admin initial-password -n argocd | head -1)');
    expect(login.output).toContain("'admin:login' logged in successfully");
    const list = await s.run('argocd app list');
    expect(list.output).toMatch(/argocd\/status-prod\s+https:\/\/kubernetes.default.svc\s+status-prod\s+default\s+OutOfSync\s+Missing\s+Manual/);
    const diff = await s.run('argocd app diff status-prod');
    expect(diff.exitCode).toBe(1);
    expect(diff.output).toContain('===== apps/Deployment status-prod/gitops-status-demo ======');
    const sync = await s.stream('argocd app sync status-prod');
    expect(sync.exitCode).toBe(0);
    expect(sync.output).toContain('Phase:              Succeeded');
    await s.tick(30_000);
    expect(s.app('status-prod').status.health.status).toBe('Healthy');
    expect(s.cl.list('Pod', 'status-prod').length).toBe(4);
    const get = await s.run('argocd app get status-prod');
    expect(get.output).toContain('Sync Status:        Synced to HEAD (');
    expect((await s.run('argocd app rollback status-dev 0')).output).toContain('rollback cannot be initiated when auto-sync is enabled');

    // The app serves the class page.
    await s.run('kubectl port-forward svc/gitops-status-demo -n status-dev 8080:80 &');
    const health = await s.run('curl -s localhost:8080/health');
    expect(JSON.parse(health.output)).toEqual({ status: 'ok', version: 'v1' });
    const status = JSON.parse((await s.run('curl -s localhost:8080/api/status')).output);
    expect(status).toMatchObject({ version: 'v1', env: 'development', color: 'green' });
    expect((await s.run('curl https://localhost:8443')).output).toContain('SSL certificate problem');
    expect((await s.run('curl -sk https://localhost:8443')).output).toContain('<title>Argo CD</title>');

    // GitOps: v2 through Git.
    s.st.files['k8s/base/kustomization.yaml'] = s.st.files['k8s/base/kustomization.yaml'].replace('newTag: v1', 'newTag: v2');
    await s.run('git commit -am "Sube a v2" && git push');
    await s.tick(40_000);
    expect(s.app('status-dev').status.summary.images).toEqual(['ghcr.io/salvamiguel/gitops-status-demo-app:v2']);
    expect(JSON.parse((await s.run('curl -s localhost:8080/api/status')).output).version).toBe('v2');
    expect(s.app('status-prod').status.sync.status).toBe('OutOfSync');

    // Manual rollback of prod after a second sync.
    await s.stream('argocd app sync status-prod');
    await s.tick(20_000);
    expect(s.app('status-prod').status.history.length).toBe(2);
    const hist = await s.run('argocd app history status-prod');
    expect(hist.output).toMatch(/ID\s+DATE\s+REVISION\n0\s/);
    const rb = await s.stream('argocd app rollback status-prod 0');
    expect(rb.exitCode).toBe(0);
    await s.tick(10_000);
    expect(s.cl.get('Deployment', 'status-prod', 'gitops-status-demo')!.spec.template.spec.containers[0].image).toBe(
      'ghcr.io/salvamiguel/gitops-status-demo-app:v1',
    );
  }, 60_000);
});
