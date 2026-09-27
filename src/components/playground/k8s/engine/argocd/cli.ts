// The argocd CLI (v2.13), talking to the simulated argocd-server through a
// port-forward like in class: login, app list/get/sync/diff/history/rollback/
// create/delete/set/wait/manifests, proj/repo/cluster list, version.

import { Cluster } from '../cluster';
import { httpGet } from '../net';
import { apiGroup } from '../resources';
import { ApiError, type Obj, type RenderedDoc } from '../types';
import { clone, pad } from '../util';
import { toYaml } from '../kubectl/printers';
import { unifiedDiff } from '../kubectl/patch';
import type { Result } from '../kubectl';
import type { Stream } from '../kubectl/streams';
import { adminPassword, argo, ARGOCD_VERSION } from './install';
import { appKey, desiredDocs, liveOf, requestRefresh, requestSync, RESOURCES_FINALIZER } from './controller';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const IN_CLUSTER = 'https://kubernetes.default.svc';
const BUILD = `${ARGOCD_VERSION}+a25c8a0`;

const ok = (output: string, extra: Partial<Result> = {}): Result => ({ output, exitCode: 0, ...extra });
const fatal = (msg: string): Result => ({ output: `FATA[0000] ${msg}\n`, exitCode: 20 });

export const ARGOCD_HELP = `argocd controls a Argo CD server

Usage:
  argocd [command]

Comandos del playground:
  login SERVER --username admin --password PASS [--insecure]
  logout SERVER
  admin initial-password -n argocd
  version [--client]
  app list | get APP [--refresh|--hard-refresh] | sync APP [--prune] [--dry-run] [--revision R] [--async]
      diff APP | history APP | rollback APP [ID] | manifests APP | resources APP
      create APP --repo URL --path P --dest-server ${IN_CLUSTER} --dest-namespace NS
             [--revision R] [--sync-policy automated] [--auto-prune] [--self-heal] [--sync-option CreateNamespace=true]
      set APP [--revision R] [--path P] [--sync-policy automated|none] [--self-heal] [--auto-prune] [-p key=value]
      delete APP [-y] [--cascade=false] | wait APP [--health] [--sync] [--timeout N]
  proj list · repo list · cluster list

Primero: kubectl port-forward svc/argocd-server -n argocd 8080:443 &
Después:  argocd login localhost:8080 --insecure --username admin --password $(argocd admin initial-password -n argocd | head -1)
`;

interface Flags {
  pos: string[];
  f: Record<string, string[]>;
}

const BOOL = new Set([
  'insecure',
  'plaintext',
  'grpc-web',
  'refresh',
  'hard-refresh',
  'prune',
  'dry-run',
  'async',
  'auto-prune',
  'self-heal',
  'upsert',
  'y',
  'yes',
  'health',
  'sync',
  'client',
  'short',
  'core',
  'directory-recurse',
  'operation',
  'suspended',
  'degraded',
  'h',
  'help',
]);

function parseFlags(args: string[]): Flags {
  const pos: string[] = [];
  const f: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-') || a === '-') {
      pos.push(a);
      continue;
    }
    let name = a.replace(/^--?/, '');
    let val: string | undefined;
    const eq = name.indexOf('=');
    if (eq >= 0) {
      val = name.slice(eq + 1);
      name = name.slice(0, eq);
    } else if (!BOOL.has(name)) val = args[++i];
    (f[name] ??= []).push(val ?? 'true');
  }
  return { pos, f };
}

const flag = (fl: Flags, ...names: string[]) => {
  for (const n of names) if (fl.f[n]) return fl.f[n][fl.f[n].length - 1];
  return undefined;
};
const has = (fl: Flags, ...names: string[]) => names.some((n) => fl.f[n] && fl.f[n][fl.f[n].length - 1] !== 'false');

function ago(_cl: Cluster, ts: string | undefined) {
  if (!ts) return '';
  return new Date(Date.parse(ts))
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' +0000 UTC');
}

function syncPolicyText(app: Obj) {
  const a = app.spec?.syncPolicy?.automated;
  if (!a) return 'Manual';
  const extra = [a.prune ? 'Prune' : '', a.selfHeal ? 'SelfHeal' : ''].filter(Boolean);
  return extra.length ? `Automated (${extra.join(', ')})` : 'Automated';
}

function src(app: Obj): Json {
  return app.spec?.source || app.spec?.sources?.[0] || {};
}

function syncStatusText(app: Obj) {
  const s = app.status?.sync;
  if (!s) return 'Unknown';
  const target = src(app).targetRevision || 'HEAD';
  return `${s.status}${s.revision ? ` to ${target} (${s.revision.slice(0, 7)})` : ''}`;
}

function resourceTable(app: Obj, withMessage = true): string {
  const msgs = new Map<string, string>();
  for (const r of app.status?.operationState?.syncResult?.resources || []) msgs.set(`${r.kind}/${r.namespace || ''}/${r.name}`, r.message || '');
  const rows = [['GROUP', 'KIND', 'NAMESPACE', 'NAME', 'STATUS', 'HEALTH', 'HOOK', 'MESSAGE']];
  for (const r of app.status?.resources || []) {
    rows.push([
      r.group || '',
      r.kind,
      r.namespace || '',
      r.name,
      r.status + (r.requiresPruning ? '' : ''),
      r.health?.status || '',
      '',
      withMessage ? msgs.get(`${r.kind}/${r.namespace || ''}/${r.name}`) || (r.requiresPruning ? 'ignored (requires pruning)' : '') : '',
    ]);
  }
  return pad(rows);
}

function appGet(cl: Cluster, app: Obj, server: string): string {
  const s = src(app);
  const lines: [string, string][] = [
    ['Name:', `${app.metadata.namespace}/${app.metadata.name}`],
    ['Project:', app.spec?.project || 'default'],
    ['Server:', app.spec?.destination?.server || app.spec?.destination?.name || ''],
    ['Namespace:', app.spec?.destination?.namespace || ''],
    ['URL:', `https://${server}/applications/${app.metadata.name}`],
    ['Source:', ''],
    ['- Repo:', s.repoURL || ''],
    ['  Target:', s.targetRevision || ''],
    ['  Path:', s.path || ''],
    ['SyncWindow:', 'Sync Allowed'],
    ['Sync Policy:', syncPolicyText(app)],
    ['Sync Status:', syncStatusText(app)],
    ['Health Status:', app.status?.health?.status || 'Unknown'],
  ];
  if (s.helm?.valueFiles?.length) lines.splice(9, 0, ['  Helm Values:', s.helm.valueFiles.join(',')]);
  let out = lines.map(([k, v]) => (v ? k.padEnd(20) + v : k)).join('\n') + '\n';
  for (const c of app.status?.conditions || []) out += `\nCONDITION        MESSAGE\n${c.type.padEnd(17)}${c.message}\n`;
  const op = app.status?.operationState;
  if (op) {
    const dur = op.finishedAt && op.startedAt ? Math.max(0, Math.round((Date.parse(op.finishedAt) - Date.parse(op.startedAt)) / 1000)) : 0;
    out +=
      '\n' +
      [
        ['Operation:', 'Sync'],
        ['Sync Revision:', op.syncResult?.revision || op.operation?.sync?.revision || ''],
        ['Phase:', op.phase],
        ['Start:', ago(cl, op.startedAt)],
        ['Finished:', ago(cl, op.finishedAt)],
        ['Duration:', `${dur}s`],
        ['Message:', op.message || ''],
      ]
        .map(([k, v]) => k.padEnd(20) + v)
        .join('\n') +
      '\n';
  }
  return out + '\n' + resourceTable(app);
}

export interface ArgoCliCtx {
  cl: Cluster;
  files: Record<string, string>;
}

/** The server of the session, reachable through the port-forward. */
function connect(cl: Cluster): { server: string } | { err: Result } {
  const a = argo(cl);
  const sess = a?.session;
  if (!sess) return { err: fatal('Argo CD server address unspecified') };
  const r = httpGet(cl, `https://${sess.server}/`, {});
  if ('error' in r || !r.argocd) {
    return {
      err: fatal(
        `rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial tcp ${sess.server.replace('localhost', '127.0.0.1')}: connect: connection refused"`,
      ),
    };
  }
  return { server: sess.server };
}

function findApp(cl: Cluster, name: string): Obj | undefined {
  const a = argo(cl)!;
  const [ns, n] = name.includes('/') ? name.split('/') : [a.namespace, name];
  return cl.get('Application', ns, n);
}

const notFound = (name: string) => fatal(`rpc error: code = NotFound desc = applications.argoproj.io "${name.split('/').pop()}" not found`);

/** Waits until the app finished the requested operation, then prints it. */
function waitOperation(cl: Cluster, name: string, server: string, since: string | undefined, header = ''): Result {
  const stream: Stream = {
    poll(c) {
      const app = findApp(c, name);
      if (!app) return { text: notFound(name).output, done: true, exitCode: 20 };
      const op = app.status?.operationState;
      if (app.operation || !op || op.finishedAt === since) return { text: '' };
      const failed = op.phase !== 'Succeeded';
      return {
        text: appGet(c, app, server) + (failed ? `FATA[0000] Operation has completed with phase: ${op.phase}\n` : ''),
        done: true,
        exitCode: failed ? 20 : 0,
      };
    },
    stop: () => '^C\n',
  };
  return ok(header, { stream });
}

export interface ResourceDiff {
  group: string;
  kind: string;
  namespace?: string;
  name: string;
  /** Unified diff (live → target) without file headers. */
  text: string;
  live: string;
  target: string;
}

function cleanObj(o: Obj): Obj {
  const c = clone(o);
  delete c.status;
  for (const k of ['managedFields', 'resourceVersion', 'generation', 'uid', 'creationTimestamp', 'ownerReferences']) delete c.metadata[k];
  if (c.metadata.annotations) {
    for (const k of Object.keys(c.metadata.annotations))
      if (k.startsWith('kubectl.kubernetes.io/') || k.startsWith('deployment.kubernetes.io/')) delete c.metadata.annotations[k];
    if (!Object.keys(c.metadata.annotations).length) delete c.metadata.annotations;
  }
  return c;
}

/** Live vs desired, per resource that differs (argocd app diff, the UI's App Diff). */
export function appDiff(cl: Cluster, app: Obj, docs: RenderedDoc[]): ResourceDiff[] {
  const sim = Cluster.fromJSON(cl.toJSON());
  const out: ResourceDiff[] = [];
  for (const d of desiredDocs(app, docs)) {
    const live = liveOf(cl, d.obj);
    let merged: Obj;
    try {
      merged = sim.apply(d.obj, d.obj.metadata.namespace || 'default').obj;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      merged = d.obj; // e.g. the namespace doesn't exist yet
    }
    const a = live ? toYaml(cleanObj(live)) : '';
    const b = toYaml(cleanObj(merged));
    const text = unifiedDiff(a, b, 'live', 'target');
    if (!text) continue;
    const body = text
      .split('\n')
      .filter((l) => !l.startsWith('---') && !l.startsWith('+++'))
      .join('\n');
    out.push({
      group: apiGroup(d.obj.kind),
      kind: d.obj.kind,
      namespace: d.obj.metadata.namespace,
      name: d.obj.metadata.name,
      text: body.endsWith('\n') ? body : body + '\n',
      live: a,
      target: b,
    });
  }
  for (const res of app.status?.resources || []) {
    if (!res.requiresPruning) continue;
    const live = cl.get(res.kind, res.namespace, res.name);
    if (!live) continue;
    const a = toYaml(cleanObj(live));
    out.push({
      group: res.group,
      kind: res.kind,
      namespace: res.namespace,
      name: res.name,
      text:
        a
          .split('\n')
          .filter(Boolean)
          .map((l) => '< ' + l)
          .join('\n') + '\n',
      live: a,
      target: '',
    });
  }
  return out;
}

function appCommand(sub: string, fl: Flags, cl: Cluster, server: string): Result {
  const a = argo(cl)!;
  const name = fl.pos[0];
  const needApp = () => {
    if (!name) return { err: fatal(`the name of the application is required: argocd app ${sub} APPNAME`) };
    const app = findApp(cl, name);
    if (!app) return { err: notFound(name) };
    return { app };
  };
  switch (sub) {
    case 'list':
    case 'ls': {
      const apps = cl.list('Application', a.namespace);
      if (flag(fl, 'o', 'output') === 'name') return ok(apps.map((x) => `${x.metadata.namespace}/${x.metadata.name}\n`).join(''));
      const rows = [['NAME', 'CLUSTER', 'NAMESPACE', 'PROJECT', 'STATUS', 'HEALTH', 'SYNCPOLICY', 'CONDITIONS', 'REPO', 'PATH', 'TARGET']];
      for (const x of apps) {
        const s = src(x);
        const pol = x.spec?.syncPolicy?.automated ? (x.spec.syncPolicy.automated.prune ? 'Auto-Prune' : 'Auto') : 'Manual';
        rows.push([
          `${x.metadata.namespace}/${x.metadata.name}`,
          x.spec?.destination?.server || x.spec?.destination?.name || '',
          x.spec?.destination?.namespace || '',
          x.spec?.project || 'default',
          x.status?.sync?.status || 'Unknown',
          x.status?.health?.status || 'Unknown',
          pol,
          (x.status?.conditions || []).map((c: Json) => c.type).join(',') || '<none>',
          s.repoURL || '',
          s.path || '',
          s.targetRevision || '',
        ]);
      }
      return ok(apps.length ? pad(rows) : pad([rows[0]]));
    }
    case 'get': {
      const r = needApp();
      if ('err' in r) return r.err!;
      if (has(fl, 'refresh', 'hard-refresh')) {
        requestRefresh(cl, r.app, has(fl, 'hard-refresh'));
        const before = r.app.status?.reconciledAt;
        const start = cl.now;
        const stream: Stream = {
          poll(c) {
            const app = findApp(c, name);
            if (!app) return { text: notFound(name).output, done: true, exitCode: 20 };
            if (app.metadata.annotations?.['argocd.argoproj.io/refresh'] || (app.status?.reconciledAt === before && c.now - start < 3000)) return { text: '' };
            return { text: appGet(c, app, server), done: true, exitCode: 0 };
          },
          stop: () => '^C\n',
        };
        return ok('', { stream });
      }
      const o = flag(fl, 'o', 'output');
      if (o === 'yaml') return ok(toYaml(r.app));
      if (o === 'json') return ok(JSON.stringify(r.app, null, 2) + '\n');
      return ok(appGet(cl, r.app, server));
    }
    case 'sync': {
      const r = needApp();
      if ('err' in r) return r.err!;
      if (r.app.operation) return fatal('rpc error: code = FailedPrecondition desc = another operation is already in progress');
      const since = r.app.status?.operationState?.finishedAt;
      requestSync(cl, r.app, { prune: has(fl, 'prune'), dryRun: has(fl, 'dry-run'), revision: flag(fl, 'revision') });
      if (has(fl, 'async')) return ok('');
      return waitOperation(cl, name, server, since);
    }
    case 'rollback': {
      const r = needApp();
      if ('err' in r) return r.err!;
      if (r.app.spec?.syncPolicy?.automated) return fatal('rpc error: code = FailedPrecondition desc = rollback cannot be initiated when auto-sync is enabled');
      const hist: Json[] = r.app.status?.history || [];
      const id = fl.pos[1];
      const h = id !== undefined ? hist.find((x) => String(x.id) === id) : hist[hist.length - 2];
      if (!h)
        return fatal(
          id !== undefined
            ? `rpc error: code = InvalidArgument desc = application ${r.app.metadata.name} does not have deployment with id ${id}`
            : 'Application has no previous deployment to roll back to',
        );
      const since = r.app.status?.operationState?.finishedAt;
      requestSync(cl, r.app, { revision: h.revision, prune: has(fl, 'prune') });
      return waitOperation(cl, name, server, since);
    }
    case 'history': {
      const r = needApp();
      if ('err' in r) return r.err!;
      const hist: Json[] = r.app.status?.history || [];
      const rows = [['ID', 'DATE', 'REVISION']];
      for (const h of hist) rows.push([String(h.id), ago(cl, h.deployedAt), `${h.source?.targetRevision || 'HEAD'} (${String(h.revision).slice(0, 7)})`]);
      return ok(`SOURCE  ${src(r.app).repoURL || ''}\n${pad(rows)}`);
    }
    case 'diff': {
      const r = needApp();
      if ('err' in r) return r.err!;
      const m = a.manifests[appKey(r.app)];
      if (!m || m.error) return fatal(`rpc error: code = Unknown desc = ${m?.error || 'manifests not rendered yet (espera un momento)'}`);
      const out = appDiff(cl, r.app, m.docs)
        .map((d) => `\n===== ${d.group}/${d.kind} ${d.namespace || ''}/${d.name} ======\n${d.text}`)
        .join('');
      return { output: out, exitCode: out ? 1 : 0 };
    }
    case 'manifests': {
      const r = needApp();
      if ('err' in r) return r.err!;
      const m = a.manifests[appKey(r.app)];
      if (flag(fl, 'source') === 'live') {
        const objs = (r.app.status?.resources || []).map((x: Json) => cl.get(x.kind, x.namespace, x.name)).filter(Boolean);
        return ok(objs.map((o: Obj) => '---\n' + toYaml(o)).join(''));
      }
      if (!m || m.error) return fatal(`rpc error: code = Unknown desc = ${m?.error || 'manifests not rendered yet'}`);
      return ok(
        desiredDocs(r.app, m.docs)
          .map((d) => '---\n' + toYaml(d.obj))
          .join(''),
      );
    }
    case 'resources': {
      const r = needApp();
      if ('err' in r) return r.err!;
      const rows = [['GROUP', 'KIND', 'NAMESPACE', 'NAME', 'ORPHANED']];
      for (const x of r.app.status?.resources || []) rows.push([x.group || '', x.kind, x.namespace || '', x.name, 'No']);
      return ok(pad(rows));
    }
    case 'create': {
      if (!name) return fatal('app name or file must be specified');
      if (findApp(cl, name) && !has(fl, 'upsert'))
        return fatal(`rpc error: code = InvalidArgument desc = existing application spec is different, use upsert flag to force update`);
      const repo = flag(fl, 'repo');
      const path = flag(fl, 'path');
      if (!repo) return fatal('repository URL is required when application is not specified via file');
      const auto = /^auto/.test(flag(fl, 'sync-policy') || '');
      const opts = fl.f['sync-option'] || [];
      const helmParams = (fl.f['p'] || fl.f['helm-set'] || []).map((kv) => ({ name: kv.split('=')[0], value: kv.split('=').slice(1).join('=') }));
      const source: Json = { repoURL: repo, targetRevision: flag(fl, 'revision') || 'HEAD', ...(path ? { path } : {}) };
      if (helmParams.length) source.helm = { parameters: helmParams };
      if (has(fl, 'directory-recurse')) source.directory = { recurse: true };
      const manifest = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'Application',
        metadata: { name: name.split('/').pop(), namespace: a.namespace },
        spec: {
          project: flag(fl, 'project') || 'default',
          source,
          destination: {
            server: flag(fl, 'dest-server') || (flag(fl, 'dest-name') ? undefined : IN_CLUSTER),
            ...(flag(fl, 'dest-name') ? { name: flag(fl, 'dest-name') } : {}),
            namespace: flag(fl, 'dest-namespace'),
          },
          ...(auto || opts.length
            ? {
                syncPolicy: {
                  ...(auto ? { automated: { prune: has(fl, 'auto-prune'), selfHeal: has(fl, 'self-heal') } } : {}),
                  ...(opts.length ? { syncOptions: opts } : {}),
                },
              }
            : {}),
        },
      };
      try {
        cl.apply(manifest, a.namespace);
      } catch (e) {
        return fatal(`rpc error: code = InvalidArgument desc = ${(e as Error).message}`);
      }
      return ok(`application '${manifest.metadata.name}' ${findApp(cl, name) && has(fl, 'upsert') ? 'updated' : 'created'}\n`);
    }
    case 'set': {
      const r = needApp();
      if ('err' in r) return r.err!;
      cl.mutate(r.app, (x) => {
        const s = (x.spec.source ??= {});
        if (flag(fl, 'revision')) s.targetRevision = flag(fl, 'revision');
        if (flag(fl, 'path')) s.path = flag(fl, 'path');
        if (flag(fl, 'repo')) s.repoURL = flag(fl, 'repo');
        if (flag(fl, 'dest-namespace')) x.spec.destination.namespace = flag(fl, 'dest-namespace');
        const sp = flag(fl, 'sync-policy');
        if (sp) {
          x.spec.syncPolicy ??= {};
          if (/^(none|manual)$/.test(sp)) delete x.spec.syncPolicy.automated;
          else x.spec.syncPolicy.automated ??= {};
        }
        if (fl.f['self-heal'] || fl.f['auto-prune']) {
          x.spec.syncPolicy ??= {};
          x.spec.syncPolicy.automated ??= {};
          if (fl.f['self-heal']) x.spec.syncPolicy.automated.selfHeal = has(fl, 'self-heal');
          if (fl.f['auto-prune']) x.spec.syncPolicy.automated.prune = has(fl, 'auto-prune');
        }
        for (const kv of fl.f['p'] || fl.f['helm-set'] || []) {
          const [k, ...v] = kv.split('=');
          s.helm ??= {};
          s.helm.parameters = [...(s.helm.parameters || []).filter((p: Json) => p.name !== k), { name: k, value: v.join('=') }];
        }
        for (const img of fl.f['kustomize-image'] || []) {
          s.kustomize ??= {};
          const base = img.split(/[:=@]/)[0];
          s.kustomize.images = [...(s.kustomize.images || []).filter((i: string) => i.split(/[:=@]/)[0] !== base), img];
        }
        for (const o of fl.f['sync-option'] || []) {
          x.spec.syncPolicy ??= {};
          x.spec.syncPolicy.syncOptions = [...new Set([...(x.spec.syncPolicy.syncOptions || []), o])];
        }
      });
      return ok('');
    }
    case 'delete':
    case 'rm': {
      const r = needApp();
      if ('err' in r) return r.err!;
      const cascade = flag(fl, 'cascade') !== 'false';
      cl.mutate(r.app, (x) => {
        const fin: string[] = (x.metadata.finalizers || []).filter((f: string) => f !== RESOURCES_FINALIZER);
        if (cascade) fin.push(RESOURCES_FINALIZER);
        x.metadata.finalizers = fin;
      });
      cl.deleteObject(r.app);
      const prompt = has(fl, 'y', 'yes') ? '' : `Are you sure you want to delete '${r.app.metadata.name}' and all its resources? [y/n] y\n`;
      return ok(`${prompt}application '${r.app.metadata.name}' deleted\n`);
    }
    case 'wait': {
      const r = needApp();
      if ('err' in r) return r.err!;
      const wantHealth = has(fl, 'health') || !has(fl, 'sync');
      const wantSync = has(fl, 'sync') || !has(fl, 'health');
      const timeout = parseInt(flag(fl, 'timeout') || '0', 10);
      const start = cl.now;
      const stream: Stream = {
        poll(c) {
          const app = findApp(c, name);
          if (!app) return { text: notFound(name).output, done: true, exitCode: 20 };
          const good = (!wantHealth || app.status?.health?.status === 'Healthy') && (!wantSync || app.status?.sync?.status === 'Synced') && !app.operation;
          if (good) return { text: appGet(c, app, server), done: true, exitCode: 0 };
          if (timeout && c.now - start > timeout * 1000)
            return { text: `FATA[0000] timed out (${timeout}s) waiting for app "${app.metadata.name}" match desired state\n`, done: true, exitCode: 20 };
          return { text: '' };
        },
        stop: () => '^C\n',
      };
      return ok('', { stream });
    }
    default:
      return fatal(`unknown command "${sub}" for "argocd app"`);
  }
}

/** argocd … */
export function argocdCli(args: string[], ctx: ArgoCliCtx): Result {
  const cl = ctx.cl;
  const fl = parseFlags(args);
  const [cmd, sub, ...rest] = fl.pos;
  const a = argo(cl);
  if (!cmd || cmd === 'help' || has(fl, 'help', 'h')) return ok(ARGOCD_HELP);
  if (cmd === 'version') {
    const client = `argocd: ${BUILD}\n  BuildDate: 2025-01-03T17:27:03Z\n  GitCommit: a25c8a0eef7830be0c2c9074c92dbea8ff23a962\n  GitTreeState: clean\n  GoVersion: go1.22.9\n  Compiler: gc\n  Platform: linux/amd64\n`;
    if (has(fl, 'client')) return ok(client);
    const c = connect(cl);
    if ('err' in c) return { ...c.err, output: client + c.err.output };
    return ok(`${client}argocd-server: ${BUILD}\n`);
  }
  if (cmd === 'admin' && sub === 'initial-password') {
    if (!a) return fatal('secrets "argocd-initial-admin-secret" not found');
    const ns = flag(fl, 'n', 'namespace') || 'default';
    const pw = ns === a.namespace ? adminPassword(cl) : undefined;
    if (!pw) return fatal(`secrets "argocd-initial-admin-secret" not found`);
    return ok(
      `${pw}\n\n This password must be only used for first time login. We strongly recommend you update the password using \`argocd account update-password\`.\n`,
    );
  }
  if (cmd === 'login') {
    const server = sub;
    if (!server) return fatal('Argo CD server address unspecified');
    if (!a) return fatal(`dial tcp: lookup ${server}: no such host`);
    const r = httpGet(cl, `https://${server}/`, {});
    if ('error' in r || !r.argocd)
      return fatal(
        `dial tcp ${server.replace('localhost', '127.0.0.1')}: connect: connection refused (¿has lanzado kubectl port-forward svc/argocd-server -n argocd ${server.split(':')[1] || '8080'}:443 &?)`,
      );
    const user = flag(fl, 'username') || 'admin';
    const pw = flag(fl, 'password');
    let out = '';
    if (!has(fl, 'insecure', 'plaintext'))
      out +=
        'WARNING: server certificate had error: tls: failed to verify certificate: x509: certificate signed by unknown authority. Proceed insecurely (y/n)? y\n';
    if (pw === undefined) return { output: out + 'FATA[0000] el playground no puede preguntar la contraseña: pásala con --password\n', exitCode: 20 };
    if (user !== 'admin' || pw !== adminPassword(cl))
      return { output: out + 'FATA[0000] rpc error: code = Unauthenticated desc = Invalid username or password\n', exitCode: 20 };
    a.session = { server, user };
    cl.s.rv++;
    return ok(`${out}'${user}:login' logged in successfully\nContext '${server}' updated\n`);
  }
  if (cmd === 'logout') {
    if (a?.session) {
      const s = a.session.server;
      delete a.session;
      cl.s.rv++;
      return ok(`Logged out from '${s}'\n`);
    }
    return fatal(`Context ${sub || ''} does not exist`);
  }
  if (!['app', 'proj', 'repo', 'cluster', 'account', 'context'].includes(cmd)) return fatal(`unknown command "${cmd}" for "argocd"`);
  const c = connect(cl);
  if ('err' in c) return c.err;
  switch (cmd) {
    case 'app':
      return appCommand(sub || 'list', { pos: rest, f: fl.f }, cl, c.server);
    case 'proj':
      return ok(
        pad([
          [
            'NAME',
            'DESCRIPTION',
            'DESTINATIONS',
            'SOURCES',
            'CLUSTER-RESOURCE-WHITELIST',
            'NAMESPACE-RESOURCE-BLACKLIST',
            'SIGNATURE-KEYS',
            'ORPHANED-RESOURCES',
            'DESTINATION-SERVICE-ACCOUNTS',
          ],
          ...cl
            .list('AppProject', a!.namespace)
            .map((p) => [
              p.metadata.name,
              p.spec?.description || '',
              (p.spec?.destinations || []).map((d: Json) => `${d.server || d.name},${d.namespace}`).join(';') || '<none>',
              (p.spec?.sourceRepos || []).join(',') || '<none>',
              (p.spec?.clusterResourceWhitelist || []).map((w: Json) => `${w.group}/${w.kind}`).join(',') || '<none>',
              '<none>',
              '<none>',
              'disabled',
              '<none>',
            ]),
        ]),
      );
    case 'repo': {
      if (sub === 'add') return ok(`Repository '${rest[0] || ''}' added\n`);
      const repos = [
        ...new Set(
          cl
            .list('Application', a!.namespace)
            .map((x) => src(x).repoURL)
            .filter(Boolean),
        ),
      ];
      return ok(
        pad([
          ['TYPE', 'NAME', 'REPO', 'INSECURE', 'OCI', 'LFS', 'CREDS', 'STATUS', 'MESSAGE', 'PROJECT'],
          ...repos.map((r) => ['git', '', r, 'false', 'false', 'false', 'false', 'Successful', '', '']),
        ]),
      );
    }
    case 'cluster':
      return ok(
        pad([
          ['SERVER', 'NAME', 'VERSION', 'STATUS', 'MESSAGE', 'PROJECT'],
          [
            IN_CLUSTER,
            'in-cluster',
            '1.31',
            cl.list('Application').length ? 'Successful' : 'Unknown',
            cl.list('Application').length ? '' : 'Cluster has no applications and is not being monitored.',
            '',
          ],
        ]),
      );
    case 'account':
      return ok(`Logged In: true\nUsername: ${a!.session!.user}\nIssuer: argocd\nGroups: \n`);
    default:
      return ok(`CURRENT  NAME            SERVER\n*        ${a!.session!.server.padEnd(16)}${a!.session!.server}\n`);
  }
}
