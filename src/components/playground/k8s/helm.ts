// helm (v3) and kustomize on top of the Go/WASM renderer: releases are kept
// like Helm keeps them (Secrets sh.helm.release.v1.<name>.v<revision>) and
// every object carries Helm's ownership metadata.

import { stringify } from 'yaml';
import type { Cluster } from './engine/cluster';
import { LAST_APPLIED } from './engine/cluster';
import { flagBool, flagStr, parseArgs, UsageError, type Parsed } from './engine/kubectl/args';
import { rolloutStatusOnce, type Stream } from './engine/kubectl/streams';
import { clientValidate, parseManifests, type Doc } from './engine/manifests';
import type { Result } from './engine/kubectl';
import type { ShellCtx } from './engine/shell';
import { resourceByKind } from './engine/resources';
import { ApiError, type HelmRelease, type Obj } from './engine/types';
import { base64, pad } from './engine/util';
import type { Renderer } from './wasm';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── kustomize ────────────────────────────────────────────────────────

function lineOfDoc(text: string | undefined, kind: string, name: string): number {
  if (!text) return 1;
  try {
    const docs = parseManifests(text, 'x');
    const hit = docs.find((d) => d.obj?.kind === kind && name.endsWith(d.obj?.metadata?.name)) || docs.find((d) => d.obj?.kind === kind) || docs[0];
    return hit?.line || 1;
  } catch {
    return 1;
  }
}

/** kubectl apply -k / kubectl kustomize: the rendered documents, mapped back to their files. */
export async function kustomizeDocs(r: Renderer, files: Record<string, string>, dir: string): Promise<Doc[]> {
  const clean = dir.replace(/^\.\/?/, '').replace(/\/$/, '');
  const res = await r.kustomize({ files, dir: clean });
  if (res.error) throw new UsageError(`error: ${res.error}`);
  const docs: Doc[] = [];
  for (const it of res.resources || []) {
    for (const d of parseManifests(it.yaml, it.origin || it.configuredIn || `${clean || '.'}/kustomization.yaml`)) {
      const kind = d.obj.kind;
      const name = d.obj.metadata?.name || '';
      if (it.origin) docs.push({ ...d, file: it.origin, line: lineOfDoc(files[it.origin], kind, name) });
      else {
        const k = it.configuredIn || `${clean ? clean + '/' : ''}kustomization.yaml`;
        const text = files[k] || '';
        const idx = text.split('\n').findIndex((l) => /Generator:/.test(l));
        docs.push({ ...d, file: k, line: idx >= 0 ? idx + 1 : 1 });
      }
    }
  }
  return docs;
}

// ── helm ─────────────────────────────────────────────────────────────

const HELM_VERSION = 'v3.17.0';

// Helm's install order (pkg/releaseutil/kind_sorter.go).
const INSTALL_ORDER = [
  'PriorityClass',
  'Namespace',
  'NetworkPolicy',
  'ResourceQuota',
  'LimitRange',
  'PodSecurityPolicy',
  'PodDisruptionBudget',
  'ServiceAccount',
  'Secret',
  'SecretList',
  'ConfigMap',
  'StorageClass',
  'PersistentVolume',
  'PersistentVolumeClaim',
  'CustomResourceDefinition',
  'ClusterRole',
  'ClusterRoleList',
  'ClusterRoleBinding',
  'ClusterRoleBindingList',
  'Role',
  'RoleList',
  'RoleBinding',
  'RoleBindingList',
  'Service',
  'DaemonSet',
  'Pod',
  'ReplicationController',
  'ReplicaSet',
  'Deployment',
  'HorizontalPodAutoscaler',
  'StatefulSet',
  'Job',
  'CronJob',
  'IngressClass',
  'Ingress',
  'APIService',
];
const orderOf = (k: string) => (INSTALL_ORDER.indexOf(k) < 0 ? INSTALL_ORDER.length : INSTALL_ORDER.indexOf(k));

const HELP = `The Kubernetes package manager

Usage:
  helm [command]

Available Commands:
  create      create a new chart with the given name
  get         download extended information of a named release
  history     fetch release history
  install     install a chart
  lint        examine a chart for possible issues
  list        list releases
  rollback    roll back a release to a previous revision
  show        show information of a chart
  status      display the status of the named release
  template    locally render templates
  uninstall   uninstall a release
  upgrade     upgrade a release
  version     print the client version information

En el playground los charts están en el editor (p. ej. helm install web ./tienda);
no hay repositorios remotos.
`;

const VALUE_FLAGS = [
  'namespace',
  'values',
  'set',
  'set-string',
  'set-file',
  'version',
  'output',
  'show-only',
  'description',
  'timeout',
  'name-template',
  'revision',
  'max',
];
const ALIASES: Record<string, string> = { n: 'namespace', f: 'values', o: 'output', s: 'show-only', A: 'all-namespaces', a: 'all', g: 'generate-name' };

const ok = (output: string, extra: Partial<Result> = {}): Result => ({ output, exitCode: 0, ...extra });
const fail = (output: string): Result => ({ output: output.endsWith('\n') ? output : output + '\n', exitCode: 1 });

function helmDate(ms: number) {
  const d = new Date(ms);
  return d
    .toUTCString()
    .replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, (_, wd, day, mon, y, t) => `${wd} ${mon} ${String(day).padStart(2, ' ')} ${t} ${y}`);
}

function listDate(ms: number) {
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '.000000000 +0000 UTC');
}

function chartDirOf(ref: string, files: Record<string, string>): string | undefined {
  const clean = ref.replace(/^\.\//, '').replace(/\/$/, '');
  if (files[`${clean ? clean + '/' : ''}Chart.yaml`] !== undefined) return clean;
  return undefined;
}

function releases(cl: Cluster, name: string, ns: string): HelmRelease[] {
  return cl.s.helm.filter((r) => r.name === name && r.namespace === ns).sort((a, b) => a.revision - b.revision);
}

function current(cl: Cluster, name: string, ns: string): HelmRelease | undefined {
  return releases(cl, name, ns)
    .filter((r) => r.status === 'deployed')
    .pop();
}

function statusText(r: HelmRelease, showNotes = true) {
  return `NAME: ${r.name}\nLAST DEPLOYED: ${helmDate(r.updated)}\nNAMESPACE: ${r.namespace}\nSTATUS: ${r.status}\nREVISION: ${r.revision}\nTEST SUITE: None\n${showNotes && r.notes ? `NOTES:\n${r.notes.replace(/\n?$/, '\n')}` : ''}`;
}

type HDoc = Doc & { source?: string };

function toManifest(docs: HDoc[]): string {
  return docs.map((d) => `---\n# Source: ${d.source || d.file}\n${stringify(d.obj, { lineWidth: 0 })}`).join('');
}

function storeSecret(cl: Cluster, r: HelmRelease) {
  const name = `sh.helm.release.v1.${r.name}.v${r.revision}`;
  const existing = cl.get('Secret', r.namespace, name);
  const body = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace: r.namespace, labels: { name: r.name, owner: 'helm', status: r.status, version: String(r.revision) } },
    type: 'helm.sh/release.v1',
    data: { release: base64(JSON.stringify({ name: r.name, version: r.revision, chart: r.chart, info: { status: r.status } })) },
  };
  if (existing) cl.mutate(existing, (s) => (s.metadata.labels = body.metadata.labels));
  else cl.put(body);
}

/** Renders the chart into documents with their source template. */
async function render(
  r: Renderer,
  ctx: ShellCtx,
  p: Parsed,
  chartDir: string,
  release: string,
  ns: string,
  revision: number,
  mode: 'install' | 'upgrade' | 'template',
  base?: Record<string, unknown>,
) {
  const res = await r.helm({
    files: ctx.files,
    chartDir,
    release,
    namespace: ns,
    revision,
    isInstall: mode !== 'upgrade',
    isUpgrade: mode === 'upgrade',
    valueFiles: p.multi.values || [],
    set: p.multi.set || [],
    setString: p.multi['set-string'] || [],
    values: base,
  });
  if (res.error) return { error: res.error };
  const docs: HDoc[] = [];
  for (const m of res.manifests || []) {
    const tplText = ctx.files[m.template] || '';
    const starts = [0, ...[...tplText.matchAll(/^---.*$/gm)].map((x) => tplText.slice(0, x.index).split('\n').length)];
    let parsed: Doc[];
    try {
      parsed = parseManifests(m.yaml, m.name);
    } catch (e) {
      return { error: `YAML parse error on ${m.name}: ${(e as Error).message.replace(/^error: error parsing [^:]+: /, '')}` };
    }
    parsed.forEach((d, i) => docs.push({ ...d, file: m.template, line: (starts[i] ?? 0) + 1, source: m.name }));
  }
  docs.sort((a, b) => orderOf(a.obj.kind) - orderOf(b.obj.kind));
  return { docs, res };
}

function ownership(obj: Obj, release: string, ns: string): Obj {
  const o = JSON.parse(JSON.stringify(obj));
  o.metadata ??= {};
  o.metadata.labels = { ...(o.metadata.labels || {}), 'app.kubernetes.io/managed-by': 'Helm' };
  o.metadata.annotations = { ...(o.metadata.annotations || {}), 'meta.helm.sh/release-name': release, 'meta.helm.sh/release-namespace': ns };
  return o;
}

function applyDocs(cl: Cluster, docs: Doc[], release: string, ns: string, adopt: boolean): string | undefined {
  // Ownership check first (like Helm's "invalid ownership metadata").
  for (const d of docs) {
    const v = clientValidate(d);
    if (v) return v.replace(/^error: /, '');
    const type = resourceByKind(d.obj.kind);
    const ons = type?.namespaced ? d.obj.metadata?.namespace || ns : undefined;
    const live = type ? cl.get(d.obj.kind, ons, d.obj.metadata?.name) : undefined;
    if (live && !adopt) {
      const owner = live.metadata.annotations?.['meta.helm.sh/release-name'];
      if (owner !== release) {
        return `Unable to continue with install: ${d.obj.kind} "${d.obj.metadata.name}" in namespace "${ons ?? ''}" exists and cannot be imported into the current release: invalid ownership metadata; ${owner ? `annotation validation error: key "meta.helm.sh/release-name" must equal "${release}": current value is "${owner}"` : `label validation error: missing key "app.kubernetes.io/managed-by": must be set to "Helm"; annotation validation error: missing key "meta.helm.sh/release-name": must be set to "${release}"; annotation validation error: missing key "meta.helm.sh/release-namespace": must be set to "${ns}"`}`;
      }
    }
  }
  for (const d of docs) {
    const res = cl.apply(ownership(d.obj, release, ns), ns, { file: d.file, line: d.line, via: `helm release ${release}` });
    // Helm doesn't use kubectl's last-applied annotation.
    const live = res.obj;
    if (live.metadata.annotations?.[LAST_APPLIED]) cl.mutate(live, (o) => delete o.metadata.annotations[LAST_APPLIED]);
  }
  return undefined;
}

/** The documents of a stored release manifest, pointing back at the chart's templates. */
function docsFromManifest(manifest: string, chartPath: string): Doc[] {
  const out: Doc[] = [];
  for (const chunk of manifest.split(/^---\n/m)) {
    if (!chunk.trim()) continue;
    const src = /^# Source: [^/]+\/(.+)$/m.exec(chunk)?.[1];
    const file = src ? `${chartPath ? chartPath + '/' : ''}${src}` : chartPath;
    for (const d of parseManifests(chunk, file)) out.push({ ...d, line: 1 });
  }
  return out;
}

function removeStale(cl: Cluster, previous: string, next: Doc[], ns: string) {
  let old: Doc[] = [];
  try {
    old = docsFromManifest(previous, '');
  } catch {
    return;
  }
  const keep = new Set(next.map((d) => `${d.obj.kind}/${d.obj.metadata?.namespace || ns}/${d.obj.metadata?.name}`));
  for (const d of old) {
    const key = `${d.obj.kind}/${d.obj.metadata?.namespace || ns}/${d.obj.metadata?.name}`;
    if (keep.has(key)) continue;
    const type = resourceByKind(d.obj.kind);
    const live = type ? cl.get(d.obj.kind, type.namespaced ? d.obj.metadata?.namespace || ns : undefined, d.obj.metadata?.name) : undefined;
    if (live) cl.deleteObject(live);
  }
}

function waitStream(cl: Cluster, docs: Doc[], ns: string, after: string, timeoutMs = 300_000): Stream {
  const start = cl.now;
  const targets = docs.filter((d) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(d.obj.kind));
  return {
    poll(c) {
      const pending = targets.filter((d) => {
        const o = c.get(d.obj.kind, d.obj.metadata?.namespace || ns, d.obj.metadata?.name);
        return !o || !rolloutStatusOnce(c, o).done || rolloutStatusOnce(c, o).error;
      });
      if (!pending.length) return { text: after, done: true, exitCode: 0 };
      if (c.now - start > timeoutMs) return { text: `Error: context deadline exceeded\n`, done: true, exitCode: 1 };
      return { text: '' };
    },
    stop: () => '^C\n',
  };
}

export async function helmCommand(args: string[], ctx: ShellCtx, r: Renderer): Promise<Result> {
  if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return ok(HELP);
  const [cmd, ...rest] = args;
  let p: Parsed;
  try {
    p = parseArgs(rest, VALUE_FLAGS, ALIASES, ['all-namespaces', 'generate-name', 'all']);
  } catch (e) {
    return fail((e as Error).message.replace(/^error:/, 'Error:'));
  }
  const cl = ctx.cl;
  const ns = flagStr(p, 'namespace') || cl.s.namespace;
  try {
    switch (cmd) {
      case 'version':
        return ok(
          flagBool(p, 'short')
            ? `${HELM_VERSION}+gplayground\n`
            : `version.BuildInfo{Version:"${HELM_VERSION}", GitCommit:"playground", GitTreeState:"clean", GoVersion:"go1.24"}\n`,
        );
      case 'list':
      case 'ls': {
        const all = flagBool(p, 'all-namespaces');
        const latest = new Map<string, HelmRelease>();
        for (const x of cl.s.helm) {
          if (!all && x.namespace !== ns) continue;
          if (x.status === 'uninstalled' && !flagBool(p, 'all')) continue;
          const k = `${x.namespace}/${x.name}`;
          if (!latest.has(k) || latest.get(k)!.revision < x.revision) latest.set(k, x);
        }
        const rows = [['NAME', 'NAMESPACE', 'REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION']];
        for (const x of latest.values())
          if (x.status !== 'superseded')
            rows.push([x.name, x.namespace, String(x.revision), listDate(x.updated), x.status, `${x.chart}-${x.chartVersion}`, x.appVersion]);
        return ok(pad(rows));
      }
      case 'history':
      case 'hist': {
        const name = p.pos[0];
        const hs = releases(cl, name, ns);
        if (!hs.length) return fail('Error: release: not found');
        const rows = [['REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION', 'DESCRIPTION']];
        for (const h of hs)
          rows.push([
            String(h.revision),
            helmDate(h.updated),
            h.status,
            `${h.chart}-${h.chartVersion}`,
            h.appVersion,
            (h as Json).description || (h.revision === 1 ? 'Install complete' : 'Upgrade complete'),
          ]);
        return ok(pad(rows));
      }
      case 'status': {
        const cur = current(cl, p.pos[0], ns) || releases(cl, p.pos[0], ns).pop();
        if (!cur) return fail('Error: release: not found');
        return ok(statusText(cur));
      }
      case 'get': {
        const [what, name] = p.pos;
        const revFlag = flagStr(p, 'revision');
        const rel = revFlag ? releases(cl, name, ns).find((x) => String(x.revision) === revFlag) : current(cl, name, ns);
        if (!rel) return fail('Error: release: not found');
        if (what === 'values') {
          const userVals = rel.values && Object.keys(rel.values).length ? rel.values : null;
          if (flagStr(p, 'output') === 'json') return ok(JSON.stringify(userVals) + '\n');
          return ok(`USER-SUPPLIED VALUES:\n${userVals ? stringify(userVals) : 'null\n'}`);
        }
        if (what === 'manifest') return ok(rel.manifest);
        if (what === 'notes') return ok(`NOTES:\n${rel.notes}`);
        if (what === 'all') return ok(`${statusText(rel)}\nMANIFEST:\n${rel.manifest}`);
        return fail('Error: unknown command "' + (what || '') + '" for "helm get"\nAvailable: values, manifest, notes, all');
      }
      case 'show':
      case 'inspect': {
        const [what, ref] = p.pos;
        const dir = chartDirOf(ref || '', ctx.files);
        if (dir === undefined) return fail(`Error: path "${ref}" not found`);
        if (what === 'values') return ok(ctx.files[`${dir ? dir + '/' : ''}values.yaml`] || '');
        if (what === 'chart') return ok(ctx.files[`${dir ? dir + '/' : ''}Chart.yaml`]);
        if (what === 'readme') return ok(ctx.files[`${dir ? dir + '/' : ''}README.md`] || '');
        return ok(`${ctx.files[`${dir ? dir + '/' : ''}Chart.yaml`]}\n---\n${ctx.files[`${dir ? dir + '/' : ''}values.yaml`] || ''}`);
      }
      case 'template': {
        const [a, b] = p.pos;
        const ref = b ?? a;
        const name = b ? a : 'release-name';
        const dir = chartDirOf(ref || '', ctx.files);
        if (dir === undefined) return fail(`Error: ${ref ? `path "${ref}" not found` : 'must either provide a name or specify --generate-name'}`);
        const out = await render(r, ctx, p, dir, name, ns, 1, 'template');
        if ('error' in out) return fail(`Error: ${out.error}\n\nUse --debug flag to render out invalid YAML`);
        let docs = out.docs;
        const only = flagStr(p, 'show-only');
        if (only) {
          docs = docs.filter((d) => d.file.endsWith(only));
          if (!docs.length) return fail(`Error: could not find template ${only} in chart`);
        }
        return ok(toManifest(docs));
      }
      case 'lint': {
        const ref = p.pos[0] || '.';
        const dir = chartDirOf(ref, ctx.files);
        if (dir === undefined)
          return fail(
            `==> Linting ${ref}\nError unable to check Chart.yaml file in chart: stat ${ref}/Chart.yaml: no such file or directory\n\nError: 1 chart(s) linted, 1 chart(s) failed`,
          );
        const out = await render(r, ctx, p, dir, 'release-name', ns, 1, 'template');
        const info = ctx.files[`${dir ? dir + '/' : ''}Chart.yaml`]?.includes('icon:') ? '' : '[INFO] Chart.yaml: icon is recommended\n';
        if ('error' in out) return fail(`==> Linting ${ref}\n${info}[ERROR] templates/: ${out.error}\n\nError: 1 chart(s) linted, 1 chart(s) failed`);
        const warns = out.docs
          .filter((d) => !d.obj.metadata?.name)
          .map((d) => `[ERROR] ${d.file}: object name does not conform to Kubernetes naming requirements: ""`);
        return warns.length
          ? fail(`==> Linting ${ref}\n${info}${warns.join('\n')}\n\nError: 1 chart(s) linted, 1 chart(s) failed`)
          : ok(`==> Linting ${ref}\n${info}\n1 chart(s) linted, 0 chart(s) failed\n`);
      }
      case 'install':
      case 'upgrade': {
        const upgrade = cmd === 'upgrade';
        let [name, ref] = p.pos;
        if (!upgrade && flagBool(p, 'generate-name')) {
          ref = name;
          name = `${(ref || 'chart').split('/').pop()}-${Math.floor(cl.now / 1000) % 10_000_000_000}`;
        }
        if (!name || !ref) return fail(`Error: "helm ${cmd}" requires 2 arguments\n\nUsage:  helm ${cmd} [NAME] [CHART] [flags]`);
        const verb = upgrade ? 'UPGRADE FAILED' : 'INSTALLATION FAILED';
        const dir = chartDirOf(ref, ctx.files);
        if (dir === undefined) {
          if (/^[\w-]+\/[\w-]+$/.test(ref) && !ctx.files[`${ref}/Chart.yaml`])
            return fail(
              `Error: ${verb}: repo ${ref.split('/')[0]} not found\n(en el playground no hay repositorios: usa un chart del editor, p. ej. ./tienda, o créalo con "helm create mi-chart")`,
            );
          return fail(`Error: ${verb}: path "${ref}" not found`);
        }
        const hist = releases(cl, name, ns);
        const cur = current(cl, name, ns);
        if (!upgrade && cur) return fail(`Error: ${verb}: cannot re-use a name that is still in use`);
        if (upgrade && !cur && !flagBool(p, 'install')) return fail(`Error: ${verb}: "${name}" has no deployed releases`);
        const installing = !cur;
        if (!cl.get('Namespace', undefined, ns)) {
          if (!flagBool(p, 'create-namespace')) return fail(`Error: ${verb}: create: failed to create: namespaces "${ns}" not found`);
          cl.create({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } }, ns);
        }
        const revision = (hist[hist.length - 1]?.revision || 0) + 1;
        const base = upgrade && flagBool(p, 'reuse-values') && cur ? (cur.values as Record<string, unknown>) : undefined;
        const out = await render(r, ctx, p, dir, name, ns, revision, installing ? 'install' : 'upgrade', base);
        if ('error' in out) return fail(`Error: ${verb}: ${out.error}`);
        const manifest = toManifest(out.docs);
        const rel: HelmRelease = {
          name,
          namespace: ns,
          chart: out.res.chart.name,
          chartVersion: out.res.chart.version,
          appVersion: out.res.chart.appVersion || '',
          revision,
          status: 'deployed',
          updated: cl.now,
          values: out.res.userValues || {},
          manifest,
          notes: out.res.notes || '',
          path: dir,
        };
        if (flagBool(p, 'dry-run'))
          return ok(
            `${statusText({ ...rel, status: installing ? ('pending-install' as never) : ('pending-upgrade' as never) }, false)}HOOKS:\nMANIFEST:\n${manifest}${rel.notes ? `\nNOTES:\n${rel.notes}` : ''}`,
          );
        const err = applyDocs(cl, out.docs, name, ns, !installing);
        if (err) {
          const failed = { ...rel, status: 'failed' as const };
          cl.s.helm.push(failed);
          storeSecret(cl, failed);
          return fail(`Error: ${verb}: ${err}`);
        }
        if (cur) {
          removeStale(cl, cur.manifest, out.docs, ns);
          cur.status = 'superseded';
          storeSecret(cl, cur);
        }
        cl.s.helm.push(rel);
        storeSecret(cl, rel);
        const head = installing ? '' : `Release "${name}" has been upgraded. Happy Helming!\n`;
        const text = head + statusText(rel);
        if (flagBool(p, 'wait') || flagBool(p, 'atomic')) return { output: '', exitCode: 0, stream: waitStream(cl, out.docs, ns, text) };
        return ok(text);
      }
      case 'rollback': {
        const [name, revStr] = p.pos;
        const hs = releases(cl, name, ns);
        const cur = current(cl, name, ns);
        if (!hs.length || !cur) return fail('Error: release: not found');
        const target = revStr
          ? hs.find((x) => String(x.revision) === revStr)
          : [...hs].reverse().find((x) => x.revision < cur.revision && x.status !== 'failed');
        if (!target) return fail(`Error: release has no ${revStr || cur.revision - 1} version`);
        let withSrc: Doc[];
        try {
          withSrc = docsFromManifest(target.manifest, target.path);
        } catch (e) {
          return fail(`Error: ${(e as Error).message}`);
        }
        const err = applyDocs(cl, withSrc, name, ns, true);
        if (err) return fail(`Error: ${err}`);
        removeStale(cl, cur.manifest, withSrc, ns);
        cur.status = 'superseded';
        storeSecret(cl, cur);
        const rel: HelmRelease & { description?: string } = {
          ...target,
          revision: hs[hs.length - 1].revision + 1,
          status: 'deployed',
          updated: cl.now,
          description: `Rollback to ${target.revision}`,
        };
        cl.s.helm.push(rel);
        storeSecret(cl, rel);
        return ok('Rollback was a success! Happy Helming!\n');
      }
      case 'uninstall':
      case 'delete':
      case 'del':
      case 'un': {
        const name = p.pos[0];
        const cur = current(cl, name, ns);
        if (!cur) return fail(`Error: uninstall: Release not loaded: ${name}: release: not found`);
        let docs: Doc[] = [];
        try {
          docs = docsFromManifest(cur.manifest, cur.path);
        } catch {
          docs = [];
        }
        for (const d of [...docs].reverse()) {
          const type = resourceByKind(d.obj.kind);
          const live = type ? cl.get(d.obj.kind, type.namespaced ? d.obj.metadata?.namespace || ns : undefined, d.obj.metadata?.name) : undefined;
          if (live) cl.deleteObject(live);
        }
        for (const x of releases(cl, name, ns)) {
          const s = cl.get('Secret', ns, `sh.helm.release.v1.${name}.v${x.revision}`);
          if (s) cl.remove(s);
        }
        cl.s.helm = cl.s.helm.filter((x) => !(x.name === name && x.namespace === ns));
        return ok(`release "${name}" uninstalled\n`);
      }
      case 'create': {
        const name = p.pos[0];
        if (!name) return fail('Error: "helm create" requires 1 argument');
        if (Object.keys(ctx.files).some((f) => f.startsWith(name + '/'))) return fail(`Error: file ${name} already exists and is not a directory`);
        return ok(`Creating ${name}\n`, { writeFiles: scaffold(name), openFile: `${name}/values.yaml` });
      }
      case 'repo':
      case 'search':
      case 'pull':
      case 'fetch':
      case 'dependency':
      case 'dep':
      case 'push':
      case 'registry':
      case 'plugin':
      case 'package':
        return fail(
          `Error: "helm ${cmd}" necesita Internet y en el playground no hay repositorios.\nLos charts viven en el editor: crea uno con "helm create mi-chart" o usa el ejemplo «Helm: un chart».`,
        );
      default:
        return fail(`Error: unknown command "${cmd}" for "helm"\nRun 'helm --help' for usage.`);
    }
  } catch (e) {
    if (e instanceof ApiError) return fail(`Error: ${e.message}`);
    if (e instanceof UsageError) return fail(e.message);
    throw e;
  }
}

/** A trimmed-down `helm create` chart. */
function scaffold(name: string): Record<string, string> {
  return {
    [`${name}/Chart.yaml`]: `apiVersion: v2\nname: ${name}\ndescription: A Helm chart for Kubernetes\ntype: application\nversion: 0.1.0\nappVersion: "1.16.0"\n`,
    [`${name}/values.yaml`]: `# Default values for ${name}.\nreplicaCount: 1\n\nimage:\n  repository: nginx\n  pullPolicy: IfNotPresent\n  # Overrides the image tag whose default is the chart appVersion.\n  tag: "1.27"\n\nservice:\n  type: ClusterIP\n  port: 80\n\nresources: {}\n`,
    [`${name}/templates/_helpers.tpl`]: `{{- define "${name}.fullname" -}}\n{{- if contains .Chart.Name .Release.Name }}\n{{- .Release.Name | trunc 63 | trimSuffix "-" }}\n{{- else }}\n{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}\n{{- end }}\n{{- end }}\n\n{{- define "${name}.selectorLabels" -}}\napp.kubernetes.io/name: {{ .Chart.Name }}\napp.kubernetes.io/instance: {{ .Release.Name }}\n{{- end }}\n`,
    [`${name}/templates/deployment.yaml`]: `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ include "${name}.fullname" . }}\n  labels:\n    {{- include "${name}.selectorLabels" . | nindent 4 }}\nspec:\n  replicas: {{ .Values.replicaCount }}\n  selector:\n    matchLabels:\n      {{- include "${name}.selectorLabels" . | nindent 6 }}\n  template:\n    metadata:\n      labels:\n        {{- include "${name}.selectorLabels" . | nindent 8 }}\n    spec:\n      containers:\n        - name: {{ .Chart.Name }}\n          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"\n          imagePullPolicy: {{ .Values.image.pullPolicy }}\n          ports:\n            - name: http\n              containerPort: 80\n          resources:\n            {{- toYaml .Values.resources | nindent 12 }}\n`,
    [`${name}/templates/service.yaml`]: `apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ include "${name}.fullname" . }}\nspec:\n  type: {{ .Values.service.type }}\n  ports:\n    - port: {{ .Values.service.port }}\n      targetPort: http\n      name: http\n  selector:\n    {{- include "${name}.selectorLabels" . | nindent 4 }}\n`,
    [`${name}/templates/NOTES.txt`]: `1. Get the application URL by running these commands:\n  kubectl port-forward svc/{{ include "${name}.fullname" . }} 8080:{{ .Values.service.port }} &\n  curl localhost:8080\n`,
  };
}
