// ArgoCD's repo-server: resolves the Git revision of every Application and
// renders its manifests (plain YAML directory, Kustomize or Helm). It is
// asynchronous (Kustomize and Helm run in WebAssembly, GitHub is fetched),
// so the UI pumps it after every tick; the application-controller (sync, in
// the engine) reads what it leaves in cl.s.argocd.manifests.

import { parse as parseYaml } from 'yaml';
import type { Cluster } from '../engine/cluster';
import { argo, componentUp } from '../engine/argocd/install';
import { appKey, REFRESH_ANNOTATION, RECONCILE_MS } from '../engine/argocd/controller';
import { remoteSnapshot, sameRepo, short, type GitRepo } from '../engine/git';
import { clientValidate, parseManifests } from '../engine/manifests';
import type { ArgoManifests, Obj, RenderedDoc } from '../engine/types';
import { fnv32a, stableJson } from '../engine/util';
import { kustomizeDocs } from '../helm';
import type { Renderer } from '../wasm';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface RepoFiles {
  files: Record<string, string>;
  revision: string;
  message?: string;
  author?: string;
}

export interface RepoServerDeps {
  git: () => GitRepo | undefined;
  renderer: () => Promise<Renderer>;
  /** Downloads a public GitHub repo (the UI uses terraform/github.ts). */
  fetchGitHub: (owner: string, repo: string, ref: string) => Promise<Record<string, string>>;
}

/** After a push to the playground's remote, apps refresh this soon (a webhook). */
const WEBHOOK_MS = 5_000;

function fakeSha(files: Record<string, string>): string {
  const text = stableJson(files);
  let s = '';
  for (let i = 0; i < 5; i++)
    s += fnv32a(text + i)
      .toString(16)
      .padStart(8, '0');
  return s;
}

function sourceOf(app: Obj): Json {
  return app.spec?.source || app.spec?.sources?.[0] || {};
}

export class RepoServer {
  private busy = false;
  private github = new Map<string, Promise<RepoFiles>>();
  private webhookAt = new Map<string, number>();
  /** Apps a webhook asked to refresh. */
  private forced = new Set<string>();

  constructor(private deps: RepoServerDeps) {}

  /** Resolves a repo at a revision. */
  async resolve(repoURL: string, revision: string | undefined, hard = false): Promise<RepoFiles> {
    const git = this.deps.git();
    if (git && sameRepo(repoURL, git.remote)) {
      const c = remoteSnapshot(git, revision);
      if (!c) throw new Error(`rpc error: code = Unknown desc = unable to resolve '${revision || 'HEAD'}' to a commit SHA`);
      return { files: c.files, revision: c.sha, message: c.message, author: c.author };
    }
    const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(repoURL.trim());
    if (!m) {
      throw new Error(
        `rpc error: code = Unknown desc = failed to list refs: repository not found (el playground solo llega a su repo local ${git?.remote || ''} y a repos públicos de GitHub)`,
      );
    }
    const ref = !revision || revision === 'HEAD' ? 'HEAD' : revision;
    const key = `${m[1]}/${m[2]}@${ref}`.toLowerCase();
    if (hard) this.github.delete(key);
    if (!this.github.has(key)) {
      const p = this.deps.fetchGitHub(m[1], m[2], ref).then((files) => ({ files, revision: fakeSha(files), message: `github.com/${m[1]}/${m[2]}@${ref}` }));
      p.catch(() => this.github.delete(key));
      this.github.set(key, p);
    }
    return this.github.get(key)!;
  }

  /** Renders the manifests of `path` in the repo files. */
  async render(app: Obj, repo: RepoFiles): Promise<{ docs: RenderedDoc[]; sourceType: 'Directory' | 'Kustomize' | 'Helm' }> {
    const src = sourceOf(app);
    const path = String(src.path || '').replace(/^\.?\/+|\/+$/g, '');
    const prefix = path && path !== '.' ? path + '/' : '';
    const files = repo.files;
    if (!Object.keys(files).some((f) => f.startsWith(prefix))) throw new Error(`rpc error: code = Unknown desc = ${path}: app path does not exist`);
    if (files[`${prefix}Chart.yaml`] !== undefined) {
      const r = await this.deps.renderer();
      const helm = src.helm || {};
      let values: Record<string, unknown> | undefined = helm.valuesObject;
      if (!values && typeof helm.values === 'string') values = parseYaml(helm.values) || undefined;
      const res = await r.helm({
        files,
        chartDir: path,
        release: helm.releaseName || app.metadata.name,
        namespace: app.spec?.destination?.namespace || 'default',
        valueFiles: (helm.valueFiles || []).map((v: string) => `${prefix}${v}`),
        set: (helm.parameters || []).map((p: Json) => `${p.name}=${p.value}`),
        values,
      });
      if (res.error) throw new Error(`rpc error: code = Unknown desc = \`helm template\` failed: ${res.error}`);
      const docs: RenderedDoc[] = [];
      for (const m of res.manifests || []) for (const d of parseManifests(m.yaml, m.template)) docs.push({ obj: d.obj, file: m.template, line: 1 });
      return { docs, sourceType: 'Helm' };
    }
    if (['kustomization.yaml', 'kustomization.yml', 'Kustomization'].some((k) => files[`${prefix}${k}`] !== undefined)) {
      const r = await this.deps.renderer();
      try {
        const docs = await kustomizeDocs(r, files, path || '.');
        return { docs, sourceType: 'Kustomize' };
      } catch (e) {
        throw new Error(
          `rpc error: code = Unknown desc = \`kustomize build ${path}\` failed exit status 1: ${(e as Error).message.replace(/^error: /, 'Error: ')}`,
        );
      }
    }
    const recurse = !!src.directory?.recurse;
    const docs: RenderedDoc[] = [];
    for (const f of Object.keys(files).sort()) {
      if (!f.startsWith(prefix) || !/\.(ya?ml|json)$/.test(f)) continue;
      if (!recurse && f.slice(prefix.length).includes('/')) continue;
      for (const d of parseManifests(files[f], f)) {
        const v = clientValidate(d);
        if (v) throw new Error(`rpc error: code = Unknown desc = ${f}: ${v.replace(/^error: /, '')}`);
        docs.push(d);
      }
    }
    return { docs, sourceType: 'Directory' };
  }

  /** Does one pending render, if any. Resolves when done (tests await it). */
  async pump(cl: Cluster): Promise<boolean> {
    const a = argo(cl);
    if (!a || this.busy) return false;
    const git = this.deps.git();
    // A push to the local remote works like a webhook: refresh its apps soon.
    if (git && a.seenPush !== git.pushSeq) {
      if (a.seenPush !== undefined) this.webhookAt.set(git.remote, cl.now + WEBHOOK_MS);
      a.seenPush = git.pushSeq;
    }
    const due = git ? this.webhookAt.get(git.remote) : undefined;
    if (git && due !== undefined && cl.now >= due) {
      this.webhookAt.delete(git.remote);
      for (const app of cl.list('Application', a.namespace)) if (sameRepo(sourceOf(app).repoURL || '', git.remote)) this.forced.add(appKey(app));
    }
    for (const app of cl.list('Application', a.namespace)) {
      if (app.metadata.deletionTimestamp) continue;
      const key = appKey(app);
      const m = a.manifests[key];
      const refresh = app.metadata.annotations?.[REFRESH_ANNOTATION];
      const src = sourceOf(app);
      const specKey = stableJson(src);
      const stale =
        !m || !m.key.startsWith(specKey) || !!refresh || this.forced.has(key) || cl.now - m.at >= RECONCILE_MS || (!!m.error && cl.now - m.at >= 10_000);
      if (!stale) continue;
      this.busy = true;
      this.forced.delete(key);
      try {
        await this.update(cl, app, !!refresh && refresh === 'hard');
      } finally {
        this.busy = false;
      }
      return true;
    }
    for (const set of cl.list('ApplicationSet', a.namespace)) await this.appSetParams(cl, set);
    return false;
  }

  private async update(cl: Cluster, app: Obj, hard: boolean) {
    const a = argo(cl)!;
    const key = appKey(app);
    const src = sourceOf(app);
    const specKey = stableJson(src);
    const prev = a.manifests[key] as ArgoManifests | undefined;
    const done = (patch: Partial<ArgoManifests>) => {
      const base: ArgoManifests = prev || { key: specKey, revision: '', docs: [], at: cl.now, sourceType: 'Directory' };
      a.manifests[key] = { ...base, ...patch, at: cl.now };
      const live = cl.get('Application', app.metadata.namespace, app.metadata.name);
      if (live?.metadata.annotations?.[REFRESH_ANNOTATION]) cl.mutate(live, (x) => delete x.metadata.annotations[REFRESH_ANNOTATION]);
      cl.s.rv++;
    };
    if (!componentUp(cl, 'argocd-repo-server')) {
      done({
        error:
          'rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial tcp: lookup argocd-repo-server: connect: connection refused"',
        key: specKey + '#down',
      });
      return;
    }
    try {
      const repo = await this.resolve(src.repoURL || '', src.targetRevision, hard);
      const fullKey = `${specKey}@${repo.revision}`;
      if (prev && prev.key === fullKey && !prev.error && !hard) {
        done({});
        return;
      }
      const r = await this.render(app, repo);
      done({ key: fullKey, revision: repo.revision, message: repo.message, author: repo.author, docs: r.docs, sourceType: r.sourceType, error: undefined });
    } catch (e) {
      done({ error: (e as Error).message, key: specKey + '#error' });
    }
  }

  /** Git directories generator of an ApplicationSet. */
  private async appSetParams(cl: Cluster, set: Obj) {
    const a = argo(cl)!;
    const params: Record<string, string>[] = [];
    for (const g of set.spec?.generators || []) {
      if (!g.git?.directories) continue;
      try {
        const repo = await this.resolve(g.git.repoURL, g.git.revision);
        const dirs = new Set<string>();
        for (const f of Object.keys(repo.files)) {
          const parts = f.split('/');
          for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        }
        const glob = (pat: string) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`);
        for (const d of [...dirs].sort()) {
          const inc = g.git.directories.filter((x: Json) => !x.exclude).some((x: Json) => glob(x.path).test(d));
          const exc = g.git.directories.filter((x: Json) => x.exclude).some((x: Json) => glob(x.path).test(d));
          if (!inc || exc) continue;
          const segs = d.split('/');
          const p: Record<string, string> = {
            path: d,
            'path.path': d,
            'path.basename': segs[segs.length - 1],
            'path.basenameNormalized': segs[segs.length - 1].replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
          };
          segs.forEach((s, i) => (p[`path[${i}]`] = s));
          params.push(p);
        }
      } catch {
        // the controller shows no apps for it
      }
    }
    const k = appKey(set);
    if (stableJson(a.appsetParams[k] || []) !== stableJson(params)) {
      a.appsetParams[k] = params;
      cl.s.rv++;
    }
  }
}

export const shortRev = short;
