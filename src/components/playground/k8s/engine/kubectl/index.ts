// kubectl: parses the command line and talks to the simulated API server.

import { parse as parseYaml } from 'yaml';
import { Cluster, LAST_APPLIED, type DeleteOptions } from '../cluster';
import { ownerRef, podReady } from '../controllers/common';
import { deploymentReplicaSets, HASH, revisionOf, stripHash } from '../controllers/deployment';
import { podMemory } from '../controllers/hpa';
import { K8S_VERSION } from '../bootstrap';
import { clientValidate, ManifestError, parseManifests, resolveFiles, type Doc } from '../manifests';
import { podExec, podPrompt, type PodShell } from '../podshell';
import { qualifiedName, resolveResource, resourceByKind, RESOURCES, type ResourceType } from '../resources';
import { TYPES, typeAt } from '../schema';
import { ApiError, type Obj, type Source } from '../types';
import { clone, fromLabelSelector, humanDuration, matches, pad, parseSelector, templateHash, type Selector } from '../util';
import { flagBool, flagStr, parseArgs, UsageError, type Parsed } from './args';
import { describe } from './describe';
import { genConfigMap, genCronJob, genDeployment, genHpa, genIngress, genJob, genNamespace, genPod, genSecret, genService } from './generators';
import { jsonPatch, mergePatch, strategicPatch, unifiedDiff } from './patch';
import { asList, cpuMillis, customColumns, jsonpath, memMi, objectName, podStatus, printTable, toJson, toYaml } from './printers';
import { logStream, portForwardStream, rolloutStream, waitStream, watchStream, type Stream } from './streams';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Rendered {
  docs: Doc[];
}

export interface Ctx {
  cl: Cluster;
  files: Record<string, string>;
  /** Renders a kustomization directory (Go/WASM kustomize). */
  kustomize?: (dir: string) => Promise<Doc[]>;
}

export interface Result {
  output: string;
  exitCode: number;
  stream?: Stream;
  /** Files the command wrote into the workspace (kubectl edit). */
  writeFiles?: Record<string, string>;
  openFile?: string;
  /** Start an interactive shell in a container. */
  shell?: PodShell & { rm?: boolean };
  /** Select this object in the diagram. */
  select?: string;
}

const ok = (output: string, extra: Partial<Result> = {}): Result => ({ output, exitCode: 0, ...extra });
const fail = (output: string, code = 1): Result => ({ output: output.endsWith('\n') ? output : output + '\n', exitCode: code });

function apiErrorText(err: ApiError, verb?: string, file?: string) {
  const where = verb && file ? `error when ${verb} "${file}": ` : '';
  return `Error from server (${err.reason}): ${where}${err.message}`;
}

function notFound(type: ResourceType, name: string) {
  const q = qualifiedName(type.kind);
  const group = q.includes('.') ? '.' + q.split('.').slice(1).join('.') : '';
  return `Error from server (NotFound): ${type.plural}${group} "${name}" not found`;
}

const VALUE_FLAGS = [
  'namespace',
  'filename',
  'selector',
  'output',
  'container',
  'tail',
  'since',
  'kustomize',
  'replicas',
  'image',
  'port',
  'target-port',
  'type',
  'name',
  'grace-period',
  'cascade',
  'to-revision',
  'revision',
  'field-selector',
  'sort-by',
  'label-columns',
  'timeout',
  'for',
  'from-literal',
  'from-file',
  'from-env-file',
  'dry-run',
  'patch',
  'restart',
  'labels',
  'env',
  'min',
  'max',
  'cpu-percent',
  'cpu',
  'schedule',
  'rule',
  'class',
  'tcp',
  'protocol',
  'context',
  'cluster',
  'user',
  'current-replicas',
  'overrides',
  'external-name',
  'field-manager',
  'request-timeout',
  'max-log-requests',
  'pod-running-timeout',
  'address',
  'show-managed-fields',
  'subresource',
  'api-group',
  'template',
];
const ALIASES: Record<string, string> = {
  n: 'namespace',
  f: 'filename',
  l: 'selector',
  o: 'output',
  c: 'container',
  k: 'kustomize',
  p: 'patch',
  A: 'all-namespaces',
  w: 'watch',
  R: 'recursive',
  L: 'label-columns',
  i: 'stdin',
  t: 'tty',
};

const ALL = ['Pod', 'Service', 'DaemonSet', 'Deployment', 'ReplicaSet', 'StatefulSet', 'HorizontalPodAutoscaler', 'Job', 'CronJob'];

export const KUBECTL_HELP = `kubectl controls the Kubernetes cluster manager.

 Find more information at: https://kubernetes.io/docs/reference/kubectl/

Basic Commands (Beginner):
  create          Create a resource from a file or from stdin
  expose          Take a replication controller, service, deployment or pod and expose it as a new Kubernetes service
  run             Run a particular image on the cluster
  set             Set specific features on objects

Basic Commands (Intermediate):
  explain         Get documentation for a resource
  get             Display one or many resources
  edit            Edit a resource on the server
  delete          Delete resources by file names, stdin, resources and names, or by resources and label selector

Deploy Commands:
  rollout         Manage the rollout of a resource
  scale           Set a new size for a deployment, replica set, or replication controller
  autoscale       Auto-scale a deployment, replica set, stateful set, or replication controller

Cluster Management Commands:
  cluster-info    Display cluster information
  top             Display resource (CPU/memory) usage
  cordon          Mark node as unschedulable
  uncordon        Mark node as schedulable
  drain           Drain node in preparation for maintenance

Troubleshooting and Debugging Commands:
  describe        Show details of a specific resource or group of resources
  logs            Print the logs for a container in a pod
  exec            Execute a command in a container
  port-forward    Forward one or more local ports to a pod
  events          List events

Advanced Commands:
  diff            Diff the live version against a would-be applied version
  apply           Apply a configuration to a resource by file name or stdin
  patch           Update fields of a resource
  replace         Replace a resource by file name or stdin
  wait            Experimental: Wait for a specific condition on one or many resources
  kustomize       Build a kustomization target from a directory or URL

Settings Commands:
  label           Update the labels on a resource
  annotate        Update the annotations on a resource

Other Commands:
  api-resources   Print the supported API resources on the server
  config          Modify kubeconfig files
  version         Print the client and server version information

Usage:
  kubectl [flags] [options]
`;

export async function kubectl(args: string[], ctx: Ctx): Promise<Result> {
  if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') return ok(KUBECTL_HELP);
  const [cmd, ...raw] = args;
  // In `kubectl logs`, -f is --follow and -p is --previous (not --filename/--patch).
  const rest = cmd === 'logs' ? raw.map((a) => (a === '-f' ? '--follow' : a === '-p' ? '--previous' : a === '-fp' || a === '-pf' ? '--follow' : a)) : raw;
  let p: Parsed;
  try {
    p = parseArgs(rest, VALUE_FLAGS, ALIASES, ['watch', 'all-namespaces', 'recursive', 'stdin', 'tty']);
  } catch (e) {
    return fail((e as Error).message);
  }
  const ns = flagStr(p, 'namespace') || ctx.cl.s.namespace;
  try {
    switch (cmd) {
      case 'version':
        return ok(`Client Version: ${K8S_VERSION}\nKustomize Version: v5.6.0${flagBool(p, 'client') ? '' : `\nServer Version: ${K8S_VERSION}`}\n`);
      case 'cluster-info':
        return ok(
          `Kubernetes control plane is running at https://127.0.0.1:6443\nCoreDNS is running at https://127.0.0.1:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\n\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.\n`,
        );
      case 'api-resources':
        return apiResources(p);
      case 'explain':
        return explain(p);
      case 'config':
        return config(p, ctx);
      case 'get':
        return get(p, ctx, ns);
      case 'describe':
        return describeCmd(p, ctx, ns);
      case 'apply':
        return await apply(p, ctx, ns);
      case 'create':
        return create(p, ctx, ns);
      case 'replace':
        return replace(p, ctx, ns);
      case 'delete':
        return await deleteCmd(p, ctx, ns);
      case 'diff':
        return diff(p, ctx, ns);
      case 'edit':
        return edit(p, ctx, ns);
      case 'logs':
        return logs(p, ctx, ns);
      case 'exec':
        return exec(p, ctx, ns);
      case 'run':
        return run(p, ctx, ns);
      case 'expose':
        return expose(p, ctx, ns);
      case 'scale':
        return scale(p, ctx, ns);
      case 'autoscale':
        return autoscale(p, ctx, ns);
      case 'set':
        return setCmd(p, ctx, ns);
      case 'rollout':
        return rollout(p, ctx, ns);
      case 'label':
      case 'annotate':
        return labelCmd(cmd, p, ctx, ns);
      case 'patch':
        return patch(p, ctx, ns);
      case 'top':
        return top(p, ctx, ns);
      case 'cordon':
      case 'uncordon':
      case 'drain':
        return nodeCmd(cmd, p, ctx);
      case 'port-forward':
        return portForward(p, ctx, ns);
      case 'wait':
        return wait(p, ctx, ns);
      case 'events':
        return events(p, ctx, ns);
      case 'kustomize':
        return await kustomizeCmd(p, ctx);
      case 'auth':
        return ok('yes\n');
      case 'proxy':
        return ok('Starting to serve on 127.0.0.1:8001\n(el playground no expone la API por HTTP; usa kubectl get/describe)\n');
      case 'attach':
      case 'cp':
      case 'debug':
      case 'certificate':
      case 'taint':
      case 'plugin':
      case 'completion':
        return fail(`error: "kubectl ${cmd}" no está disponible en el playground`);
      default:
        return fail(`error: unknown command "${cmd}" for "kubectl"\n\nDid you mean this?\n\t${suggestCommand(cmd)}\n\nRun 'kubectl --help' for usage.`);
    }
  } catch (e) {
    if (e instanceof ApiError) return fail(apiErrorText(e));
    if (e instanceof UsageError || e instanceof ManifestError) return fail(e.message);
    throw e;
  }
}

function suggestCommand(cmd: string) {
  const all = [
    'get',
    'describe',
    'apply',
    'create',
    'delete',
    'logs',
    'exec',
    'rollout',
    'scale',
    'expose',
    'run',
    'edit',
    'label',
    'annotate',
    'patch',
    'top',
    'explain',
    'diff',
    'wait',
    'events',
  ];
  let best = all[0];
  let bestD = Infinity;
  for (const c of all) {
    const d = lev(cmd, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function lev(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// ── targets ──────────────────────────────────────────────────────────

interface Group {
  type: ResourceType;
  objs: Obj[];
}

function unknownType(name: string): never {
  throw new UsageError(`error: the server doesn't have a resource type "${name}"`);
}

function typeOf(name: string): ResourceType {
  return resolveResource(name) || unknownType(name);
}

function fieldSelector(expr: string | undefined): (o: Obj) => boolean {
  if (!expr) return () => true;
  const reqs = expr.split(',').map((r) => {
    const m = /^([\w.]+)\s*(!=|==|=)\s*(.*)$/.exec(r.trim());
    if (!m) throw new UsageError(`error: invalid selector: '${r}'; can't understand '${r}'`);
    return { path: m[1], neg: m[2] === '!=', value: m[3] };
  });
  return (o) =>
    reqs.every((r) => {
      const v = r.path.split('.').reduce((c: Json, k) => c?.[k], o);
      const eq = String(v ?? '') === r.value;
      return r.neg ? !eq : eq;
    });
}

/** Parses "pods", "pod web", "deploy/web svc/web", "deploy,svc", "all". */
function targets(p: Parsed, cl: Cluster, ns: string | undefined, requireName = false): { groups: Group[]; named: boolean; errors: string[] } {
  const pos = p.pos;
  if (!pos.length) {
    throw new UsageError(
      `You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.\n\nerror: Required resource not specified.\nUse "kubectl explain <resource>" for a detailed description of that resource (e.g. kubectl explain pods).\nSee 'kubectl get -h' for help and examples`,
    );
  }
  const selStr = flagStr(p, 'selector');
  let sel: Selector | undefined;
  if (selStr !== undefined) {
    try {
      sel = parseSelector(selStr);
    } catch (e) {
      throw new UsageError(`error: ${(e as Error).message}`);
    }
  }
  const fsel = fieldSelector(flagStr(p, 'field-selector'));
  const errors: string[] = [];
  const groups: Group[] = [];
  const add = (type: ResourceType, objs: Obj[]) => {
    const g = groups.find((x) => x.type === type);
    if (g) g.objs.push(...objs.filter((o) => !g.objs.includes(o)));
    else groups.push({ type, objs });
  };
  const listOf = (type: ResourceType) =>
    cl.list(type.kind, type.namespaced ? ns : undefined).filter((o) => (!sel || matches(sel, o.metadata.labels)) && fsel(o));
  if (pos.some((x) => x.includes('/'))) {
    for (const x of pos) {
      const [t, name] = x.split('/');
      if (!name) throw new UsageError(`error: arguments in resource/name form must have a single resource and name`);
      const type = typeOf(t);
      const o = cl.get(type.kind, type.namespaced ? ns || 'default' : undefined, name);
      if (o) add(type, [o]);
      else errors.push(notFound(type, name));
    }
    return { groups, named: true, errors };
  }
  const types = pos[0].split(',').flatMap((t) => (t === 'all' ? ALL.map((k) => resourceByKind(k)!) : [typeOf(t)]));
  const names = pos.slice(1);
  if (!names.length) {
    if (requireName && !flagBool(p, 'all') && !selStr) throw new UsageError(`error: resource(s) were provided, but no name was specified`);
    for (const t of types) add(t, listOf(t));
    return { groups, named: false, errors };
  }
  for (const t of types) {
    for (const n of names) {
      const o = cl.get(t.kind, t.namespaced ? ns || 'default' : undefined, n);
      if (o) add(t, [o]);
      else errors.push(notFound(t, n));
    }
  }
  return { groups, named: true, errors };
}

function nsLabel(ns: string | undefined) {
  return ns === undefined ? '' : ` in ${ns} namespace`;
}

// ── get ──────────────────────────────────────────────────────────────

function get(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const all = flagBool(p, 'all-namespaces');
  const scopeNs = all ? undefined : ns;
  if (p.pos[0] === 'events' || p.pos[0] === 'event' || p.pos[0] === 'ev') return events(p, ctx, ns);
  const { groups, named, errors } = targets(p, cl, scopeNs);
  const out = flagStr(p, 'output') || '';
  const watch = flagBool(p, 'watch') || flagBool(p, 'watch-only');
  const multi = groups.length > 1 || p.pos[0] === 'all';
  const sortBy = flagStr(p, 'sort-by');
  if (sortBy) {
    for (const g of groups) {
      g.objs.sort((a, b) => {
        const va = jsonpath(a, sortBy.startsWith('{') ? sortBy : `{${sortBy}}`);
        const vb = jsonpath(b, sortBy.startsWith('{') ? sortBy : `{${sortBy}}`);
        const na = Number(va);
        const nb = Number(vb);
        return !Number.isNaN(na) && !Number.isNaN(nb) && va !== '' ? na - nb : va.localeCompare(vb);
      });
    }
  }
  const objs = groups.flatMap((g) => g.objs);
  const errText = errors.length ? errors.join('\n') + '\n' : '';
  if (out === 'yaml' || out === 'json') {
    const data = named && objs.length === 1 && errors.length === 0 && !p.pos[0].includes(',') ? objs[0] : asList(objs);
    const text = out === 'yaml' ? toYaml(data) : toJson(data);
    return { output: (objs.length || !named ? text : '') + errText, exitCode: errors.length ? 1 : 0 };
  }
  if (out === 'name') return { output: objs.map(objectName).join('\n') + (objs.length ? '\n' : '') + errText, exitCode: errors.length ? 1 : 0 };
  if (out.startsWith('jsonpath=') || out.startsWith('jsonpath-as-json=')) {
    const tpl = out.slice(out.indexOf('=') + 1);
    const data = named && objs.length === 1 ? objs[0] : asList(objs);
    try {
      return { output: jsonpath(data, tpl) + errText, exitCode: errors.length ? 1 : 0 };
    } catch (e) {
      return fail(`error: error parsing jsonpath ${tpl}, ${(e as Error).message}`);
    }
  }
  if (out.startsWith('custom-columns='))
    return { output: customColumns(objs, out.slice(15), flagBool(p, 'no-headers')) + errText, exitCode: errors.length ? 1 : 0 };
  if (out && out !== 'wide')
    return fail(
      `error: unable to match a printer suitable for the output format "${out}", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml`,
    );
  const opts = {
    wide: out === 'wide',
    allNamespaces: all,
    showLabels: flagBool(p, 'show-labels'),
    labelColumns: (flagStr(p, 'label-columns') || '').split(',').filter(Boolean),
    withKind: multi,
    noHeaders: flagBool(p, 'no-headers'),
  };
  if (watch) {
    if (groups.length !== 1) return fail('error: you may only specify a single resource type');
    const g = groups[0];
    const w = watchStream(
      cl,
      g.type.kind,
      () => (named ? g.objs.map((o) => cl.get(o.kind, o.metadata.namespace, o.metadata.name)).filter(Boolean) : targets(p, cl, scopeNs).groups[0]?.objs || []),
      { ...opts, watchOnly: flagBool(p, 'watch-only') },
    );
    return { output: errText + w.initial, exitCode: 0, stream: w.stream };
  }
  let text = '';
  for (const g of groups) {
    if (!g.objs.length) continue;
    if (text) text += '\n';
    text += printTable(cl, g.type.kind, g.objs, opts);
  }
  if (!text && !errors.length) return ok(`No resources found${all || (groups.length && !groups[0].type.namespaced) ? '' : nsLabel(ns)}.\n`);
  return { output: errText + text, exitCode: errors.length ? 1 : 0 };
}

function events(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const all = flagBool(p, 'all-namespaces');
  const forObj = flagStr(p, 'for');
  let evs = cl.s.events.filter((e) => all || e.namespace === ns);
  if (forObj) {
    const [t, n] = forObj.split('/');
    const type = typeOf(t);
    evs = evs.filter((e) => e.involved.kind === type.kind && e.involved.name === n);
  }
  const typesFilter = flagStr(p, 'types');
  if (typesFilter) evs = evs.filter((e) => typesFilter.split(',').includes(e.type));
  evs = [...evs].sort((a, b) => a.last - b.last);
  const row = (e: (typeof evs)[number]) => {
    const r = [humanDuration(cl.now - e.last), e.type, e.reason, `${e.involved.kind.toLowerCase()}/${e.involved.name}`, e.message];
    return all ? [e.namespace, ...r] : r;
  };
  const header = [...(all ? ['NAMESPACE'] : []), 'LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'];
  if (flagBool(p, 'watch')) {
    let lastId = evs.length ? evs[evs.length - 1].id : 0;
    const initial = evs.length ? pad([header, ...evs.map(row)]) : '';
    return {
      output: initial,
      exitCode: 0,
      stream: {
        poll(c) {
          const fresh = c.s.events.filter((e) => e.id > lastId && (all || e.namespace === ns));
          if (!fresh.length) return { text: '' };
          lastId = Math.max(...fresh.map((e) => e.id));
          return { text: fresh.map((e) => row(e).join('   ')).join('\n') + '\n' };
        },
        stop: () => '^C\n',
      },
    };
  }
  if (!evs.length) return ok(`No events found${all ? '' : nsLabel(ns)}.\n`);
  return ok(pad([header, ...evs.map(row)]));
}

function describeCmd(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const all = flagBool(p, 'all-namespaces');
  if (p.pos.length === 1 && !p.pos[0].includes('/')) {
    // describe pods web → prefix match like kubectl
    const type = typeOf(p.pos[0]);
    const objs = cl.list(type.kind, type.namespaced && !all ? ns : undefined).filter((o) => {
      const s = flagStr(p, 'selector');
      return !s || matches(parseSelector(s), o.metadata.labels);
    });
    if (!objs.length) return ok(`No resources found${all ? '' : nsLabel(ns)}.\n`);
    return ok(objs.map((o) => describe(cl, o)).join('\n\n'));
  }
  if (p.pos.length === 2 && !p.pos[1].includes('/')) {
    const type = typeOf(p.pos[0]);
    const exact = cl.get(type.kind, type.namespaced ? ns : undefined, p.pos[1]);
    const objs = exact ? [exact] : cl.list(type.kind, type.namespaced ? ns : undefined).filter((o) => o.metadata.name.startsWith(p.pos[1]));
    if (!objs.length) return fail(notFound(type, p.pos[1]));
    return ok(objs.map((o) => describe(cl, o)).join('\n\n'), { select: objs[0].metadata.uid });
  }
  const { groups, errors } = targets(p, cl, ns);
  const objs = groups.flatMap((g) => g.objs);
  return {
    output: objs.map((o) => describe(cl, o)).join('\n\n') + (errors.length ? errors.join('\n') + '\n' : ''),
    exitCode: errors.length ? 1 : 0,
    select: objs[0]?.metadata.uid,
  };
}

// ── apply / create / replace / delete ────────────────────────────────

async function readDocs(p: Parsed, ctx: Ctx): Promise<Doc[]> {
  const files = p.multi.filename || [];
  const kdir = flagStr(p, 'kustomize');
  if (!files.length && !kdir) throw new UsageError('error: must specify one of -f and -k');
  if (kdir) {
    if (!ctx.kustomize) throw new UsageError('error: kustomize no está disponible');
    return ctx.kustomize(kdir);
  }
  const docs: Doc[] = [];
  for (const f of files) {
    if (/^https?:\/\//.test(f))
      throw new UsageError(`error: el playground no descarga manifiestos de Internet: copia el contenido en un fichero del editor y usa -f fichero.yaml`);
    for (const path of resolveFiles(ctx.files, f, flagBool(p, 'recursive'))) {
      const text = ctx.files[path];
      if (/\{\{/.test(text) && /(^|\/)templates\//.test(path))
        throw new ManifestError(`error: error parsing ${path}: es una plantilla de Helm: usa "helm install" o "helm template"`);
      docs.push(...parseManifests(text, path));
    }
  }
  return docs;
}

function checkNs(doc: Doc, p: Parsed) {
  const flagNs = flagStr(p, 'namespace');
  const objNs = doc.obj.metadata?.namespace;
  if (flagNs && objNs && flagNs !== objNs && resourceByKind(doc.obj.kind)?.namespaced) {
    throw new UsageError(
      `error: the namespace from the provided object "${objNs}" does not match the namespace "${flagNs}". You must pass '--namespace=${objNs}' to perform this operation.`,
    );
  }
}

function dryRunMode(p: Parsed): 'none' | 'client' | 'server' {
  const d = p.flags['dry-run'];
  if (d === undefined || d === 'none' || d === 'false') return 'none';
  if (d === true || d === 'client') return 'client';
  if (d === 'server') return 'server';
  throw new UsageError(`error: Invalid dry-run value (${d}). Must be "none", "server", or "client".`);
}

function source(doc: Doc): Source {
  return { file: doc.file, line: doc.line };
}

/** Shared by apply/create/replace: runs `fn` for every document and collects the output. */
function forDocs(docs: Doc[], p: Parsed, verb: string, fn: (d: Doc) => string): Result {
  let out = '';
  let code = 0;
  let select: string | undefined;
  for (const d of docs) {
    const v = clientValidate(d);
    if (v) {
      out += v + '\n';
      code = 1;
      continue;
    }
    try {
      checkNs(d, p);
      out += fn(d) + '\n';
    } catch (e) {
      code = 1;
      if (e instanceof ApiError) out += apiErrorText(e, verb, d.file) + '\n';
      else if (e instanceof UsageError) out += e.message + '\n';
      else throw e;
    }
  }
  if (!docs.length) return fail('error: no objects passed to ' + verb.replace('ing', '').replace('creat', 'create').replace('apply', 'apply'));
  void select;
  return { output: out, exitCode: code };
}

async function apply(p: Parsed, ctx: Ctx, ns: string): Promise<Result> {
  if (p.pos[0] === 'view-last-applied') {
    const { groups } = targets({ ...p, pos: p.pos.slice(1) }, ctx.cl, ns);
    const o = groups[0]?.objs[0];
    const la = o?.metadata.annotations?.[LAST_APPLIED];
    if (!la) return fail('error: no last-applied-configuration annotation found on resource');
    return ok(toYaml(JSON.parse(la)));
  }
  const docs = await readDocs(p, ctx);
  const dry = dryRunMode(p);
  const out = flagStr(p, 'output');
  if (out === 'yaml' || out === 'json') {
    const objs = docs.map((d) => d.obj);
    const data = objs.length === 1 ? objs[0] : asList(objs);
    return ok(out === 'yaml' ? toYaml(data) : toJson(data));
  }
  const suffix = dry === 'client' ? ' (dry run)' : dry === 'server' ? ' (server dry run)' : '';
  const cl = dry === 'server' ? Cluster.fromJSON(ctx.cl.toJSON()) : ctx.cl;
  let firstUid: string | undefined;
  const r = forDocs(docs, p, 'applying', (d) => {
    if (dry === 'client')
      return `${objectName(d.obj)} ${ctx.cl.get(d.obj.kind, d.obj.metadata?.namespace || ns, d.obj.metadata?.name) ? 'configured' : 'created'}${suffix}`;
    const res = cl.apply(d.obj, ns, source(d));
    firstUid ??= res.obj.metadata.uid;
    return `${objectName(res.obj)} ${res.action}${suffix}`;
  });
  // Namespaces first: a namespace and its objects in the same file.
  if (r.exitCode && docs.some((d) => d.obj.kind === 'Namespace')) void 0;
  return { ...r, select: dry === 'none' ? firstUid : undefined };
}

function create(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const dry = dryRunMode(p);
  const out = flagStr(p, 'output');
  const finish = (obj: Obj): Result => {
    if (out === 'yaml' || out === 'json') {
      if (dry === 'none') {
        const created = cl.create(obj, ns);
        return ok(out === 'yaml' ? toYaml(created) : toJson(created));
      }
      return ok(out === 'yaml' ? toYaml(obj) : toJson(obj));
    }
    if (dry !== 'none') return ok(`${objectName(obj)} created (${dry === 'server' ? 'server ' : ''}dry run)\n`);
    const created = cl.create(obj, ns);
    return ok(`${objectName(created)} created\n`, { select: created.metadata.uid });
  };
  if (p.multi.filename?.length) {
    const docs = parseAllFiles(p, ctx);
    return forDocs(docs, p, 'creating', (d) => {
      if (dry !== 'none') return `${objectName(d.obj)} created (dry run)`;
      const o = cl.create(d.obj, ns, source(d));
      return `${objectName(o)} created`;
    });
  }
  const [what, name, ...more] = p.pos;
  if (!what) throw new UsageError('error: must specify one of -f and -k\n\nerror: required resource not specified');
  const need = () => {
    if (!name) throw new UsageError(`error: exactly one NAME is required, got 0`);
  };
  switch (what) {
    case 'deployment':
    case 'deploy': {
      need();
      const image = flagStr(p, 'image');
      if (!image) throw new UsageError('error: required flag(s) "image" not set');
      return finish(
        genDeployment(name, image, parseInt(flagStr(p, 'replicas') || '1', 10), flagStr(p, 'port') ? parseInt(flagStr(p, 'port')!, 10) : undefined, p.rest),
      );
    }
    case 'namespace':
    case 'ns':
      need();
      return finish(genNamespace(name));
    case 'configmap':
    case 'cm':
      need();
      return finish(genConfigMap(name, fromSources(p, ctx)));
    case 'secret': {
      const [kind, sname] = [name, more[0]];
      if (kind !== 'generic') throw new UsageError(`error: el playground solo implementa "kubectl create secret generic"`);
      if (!sname) throw new UsageError('error: exactly one NAME is required, got 0');
      return finish(genSecret(sname, fromSources(p, ctx), flagStr(p, 'type') || 'Opaque'));
    }
    case 'service':
    case 'svc': {
      const type = { clusterip: 'ClusterIP', nodeport: 'NodePort', loadbalancer: 'LoadBalancer', externalname: 'ExternalName' }[name as 'clusterip'];
      const sname = more[0];
      if (!type || !sname) throw new UsageError('Usage: kubectl create service clusterip|nodeport|loadbalancer NAME --tcp=port:targetPort');
      const ports = (p.multi.tcp || [])
        .flatMap((t) => t.split(','))
        .map((t) => {
          const [port, target] = t.split(':');
          return {
            port: parseInt(port, 10),
            targetPort: /^\d+$/.test(target || port) ? parseInt(target || port, 10) : target,
            name: `${port}-${target || port}`,
          };
        });
      const svc = genService(sname, type, ports, { app: sname });
      svc.spec.ports.forEach((pp: Json, i: number) => (pp.name = ports[i].name));
      return finish(svc);
    }
    case 'job': {
      need();
      const from = flagStr(p, 'from');
      if (from) {
        const [, cjName] = from.split('/');
        const cj = cl.get('CronJob', ns, cjName);
        if (!cj) throw new ApiError('NotFound', `cronjobs.batch "${cjName}" not found`);
        const job: Obj = {
          apiVersion: 'batch/v1',
          kind: 'Job',
          metadata: { name, annotations: { 'cronjob.kubernetes.io/instantiate': 'manual' }, ownerReferences: [ownerRef(cj)] },
          spec: clone(cj.spec.jobTemplate.spec),
        };
        return finish(job);
      }
      const image = flagStr(p, 'image');
      if (!image) throw new UsageError('error: required flag(s) "image" not set');
      return finish(genJob(name, image, p.rest));
    }
    case 'cronjob':
    case 'cj': {
      need();
      const image = flagStr(p, 'image');
      const schedule = flagStr(p, 'schedule');
      if (!image || !schedule) throw new UsageError('error: required flag(s) "image", "schedule" not set');
      return finish(genCronJob(name, image, schedule, p.rest));
    }
    case 'ingress':
    case 'ing':
      need();
      return finish(genIngress(name, p.multi.rule || [], flagStr(p, 'class')));
    default:
      throw new UsageError(`error: unknown command "${what}" for "kubectl create"`);
  }
}

function fromSources(p: Parsed, ctx: Ctx): Record<string, string> {
  const data: Record<string, string> = {};
  for (const l of p.multi['from-literal'] || []) {
    const i = l.indexOf('=');
    if (i < 1) throw new UsageError(`error: invalid literal source ${l}, expected key=value`);
    data[l.slice(0, i)] = l.slice(i + 1);
  }
  for (const f of p.multi['from-file'] || []) {
    const [key, path] = f.includes('=') ? f.split('=') : [f.split('/').pop()!, f];
    const clean = path.replace(/^\.\//, '');
    const dirFiles = Object.keys(ctx.files).filter((x) => x.startsWith(clean.replace(/\/$/, '') + '/') && !x.slice(clean.length + 1).includes('/'));
    if (ctx.files[clean] !== undefined) data[key] = ctx.files[clean];
    else if (dirFiles.length) for (const x of dirFiles) data[x.split('/').pop()!] = ctx.files[x];
    else throw new UsageError(`error: error reading ${path}: no such file or directory`);
  }
  for (const f of p.multi['from-env-file'] || []) {
    const text = ctx.files[f.replace(/^\.\//, '')];
    if (text === undefined) throw new UsageError(`error: error reading ${f}: no such file or directory`);
    for (const line of text.split('\n')) {
      const m = /^\s*([^#=\s][^=]*)=(.*)$/.exec(line);
      if (m) data[m[1].trim()] = m[2];
    }
  }
  return data;
}

function parseAllFiles(p: Parsed, ctx: Ctx): Doc[] {
  const docs: Doc[] = [];
  for (const f of p.multi.filename || [])
    for (const path of resolveFiles(ctx.files, f, flagBool(p, 'recursive'))) docs.push(...parseManifests(ctx.files[path], path));
  return docs;
}

function replace(p: Parsed, ctx: Ctx, ns: string): Result {
  const docs = parseAllFiles(p, ctx);
  const force = flagBool(p, 'force');
  return forDocs(docs, p, 'replacing', (d) => {
    if (force) {
      const live = ctx.cl.get(d.obj.kind, d.obj.metadata?.namespace || ns, d.obj.metadata?.name);
      if (live) ctx.cl.remove(live);
      const o = ctx.cl.create(d.obj, ns, source(d));
      return `${objectName(o)} deleted\n${objectName(o)} replaced`;
    }
    const r = ctx.cl.replace(d.obj, ns, source(d));
    return `${objectName(r.obj)} replaced`;
  });
}

async function deleteCmd(p: Parsed, ctx: Ctx, ns: string): Promise<Result> {
  const cl = ctx.cl;
  const cascade = (flagStr(p, 'cascade') || 'background') as DeleteOptions['cascade'];
  if (!['background', 'orphan', 'foreground', 'true', 'false'].includes(cascade as string))
    throw new UsageError(`error: invalid cascade value (${cascade}). Must be "background", "foreground", or "orphan".`);
  const opts: DeleteOptions = {
    cascade: (cascade as string) === 'false' ? 'orphan' : (cascade as string) === 'true' ? 'background' : cascade,
    gracePeriod: flagStr(p, 'grace-period') !== undefined ? parseInt(flagStr(p, 'grace-period')!, 10) : flagBool(p, 'now') ? 1 : undefined,
    force: flagBool(p, 'force'),
  };
  const warn =
    opts.force && opts.gracePeriod === 0
      ? 'Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.\n'
      : '';
  const del = (o: Obj) => {
    cl.deleteObject(o, opts);
    const q = qualifiedName(o.kind);
    return `${q} "${o.metadata.name}" ${opts.force && opts.gracePeriod === 0 ? 'force deleted' : 'deleted'}`;
  };
  if (p.multi.filename?.length || flagStr(p, 'kustomize')) {
    const docs = await readDocs(p, ctx);
    let out = warn;
    let code = 0;
    for (const d of docs) {
      const o = cl.get(d.obj.kind, resourceByKind(d.obj.kind)?.namespaced ? d.obj.metadata?.namespace || ns : undefined, d.obj.metadata?.name);
      if (!o) {
        const t = resourceByKind(d.obj.kind);
        out += (t ? notFound(t, d.obj.metadata?.name) : `error: unknown kind ${d.obj.kind}`) + '\n';
        code = 1;
        continue;
      }
      out += del(o) + '\n';
    }
    return { output: out, exitCode: code };
  }
  if (!p.pos.length)
    throw new UsageError(
      `error: You must provide one or more resources by argument or filename.\nExample resource specifications include:\n   '-f rsrc.yaml'\n   '--filename=rsrc.json'\n   '<resource> <name>'\n   '<resource>'`,
    );
  const all = flagBool(p, 'all');
  if (!p.pos[0].includes('/') && p.pos.length === 1 && !all && flagStr(p, 'selector') === undefined) {
    throw new UsageError(`error: resource(s) were provided, but no name was specified`);
  }
  const { groups, errors } = targets(p, cl, flagBool(p, 'all-namespaces') ? undefined : ns);
  const objs = groups.flatMap((g) => g.objs);
  let out = warn;
  for (const o of objs) out += del(o) + '\n';
  if (!objs.length && !errors.length) return ok('No resources found\n');
  return { output: out + (errors.length ? errors.join('\n') + '\n' : ''), exitCode: errors.length ? 1 : 0 };
}

function cleanForDiff(o: Obj): Obj {
  const c = clone(o);
  delete c.status;
  delete c.metadata.managedFields;
  delete c.metadata.resourceVersion;
  delete c.metadata.generation;
  if (c.metadata.annotations) delete c.metadata.annotations[LAST_APPLIED];
  if (c.metadata.annotations && !Object.keys(c.metadata.annotations).length) delete c.metadata.annotations;
  return c;
}

function diff(p: Parsed, ctx: Ctx, ns: string): Result {
  const docs = parseAllFiles(p, ctx);
  const sim = Cluster.fromJSON(ctx.cl.toJSON());
  let out = '';
  for (const d of docs) {
    const v = clientValidate(d);
    if (v) return fail(v);
    const live = ctx.cl.get(d.obj.kind, resourceByKind(d.obj.kind)?.namespaced ? d.obj.metadata?.namespace || ns : undefined, d.obj.metadata?.name);
    let merged: Obj;
    try {
      merged = sim.apply(d.obj, ns).obj;
    } catch (e) {
      if (e instanceof ApiError) return fail(apiErrorText(e));
      throw e;
    }
    const gv = (resourceByKind(d.obj.kind)?.versions[0] || 'v1').replace('/', '.');
    const name = `${gv}.${d.obj.kind}.${merged.metadata.namespace ? merged.metadata.namespace + '.' : ''}${merged.metadata.name}`;
    const a = live ? toYaml(cleanForDiff(live)) : '';
    const b = toYaml(cleanForDiff(merged));
    const text = unifiedDiff(a, b, `/tmp/LIVE-2854183016/${name}`, `/tmp/MERGED-3372919052/${name}`);
    if (text) out += `diff -u -N /tmp/LIVE-2854183016/${name} /tmp/MERGED-3372919052/${name}\n${text}`;
  }
  return { output: out, exitCode: out ? 1 : 0 };
}

function edit(p: Parsed, ctx: Ctx, ns: string): Result {
  const { groups, errors } = targets(p, ctx.cl, ns, true);
  const o = groups[0]?.objs[0];
  if (!o) return fail(errors.join('\n') || 'error: nothing to edit');
  const c = clone(o);
  delete c.metadata.managedFields;
  const path = `.kubectl-edit/${o.kind.toLowerCase()}-${o.metadata.name}.yaml`;
  const header = `# Please edit the object below. Lines beginning with a '#' will be ignored,\n# and an empty file will abort the edit. If an error occurs while saving this file will be\n# reopened with the relevant failures.\n#\n# Playground: guarda los cambios y aplícalos con:\n#   kubectl apply -f ${path}\n#\n`;
  return ok(`Abierto ${path} en el editor. Cuando termines: kubectl apply -f ${path}\n`, { writeFiles: { [path]: header + toYaml(c) }, openFile: path });
}

// ── pods: logs, exec, run ────────────────────────────────────────────

function podFor(cl: Cluster, ref: string, ns: string): Obj {
  if (ref.includes('/')) {
    const [t, name] = ref.split('/');
    const type = typeOf(t);
    const o = cl.get(type.kind, ns, name);
    if (!o) throw new UsageError(notFound(type, name));
    if (type.kind === 'Pod') return o;
    const pods = podsOf(cl, o);
    const pick = pods.find(podReady) || pods[0];
    if (!pick) throw new UsageError(`error: timed out waiting for the condition`);
    return pick;
  }
  const o = cl.get('Pod', ns, ref);
  if (!o) throw new UsageError(`Error from server (NotFound): pods "${ref}" not found`);
  return o;
}

export function podsOf(cl: Cluster, o: Obj): Obj[] {
  if (o.kind === 'Pod') return [o];
  if (o.kind === 'Service')
    return cl
      .list('Pod', o.metadata.namespace)
      .filter((p) => o.spec.selector && matches(fromLabelSelector({ matchLabels: o.spec.selector }), p.metadata.labels));
  if (o.kind === 'Deployment') {
    const { newRS, old } = deploymentReplicaSets(cl, o);
    return [newRS, ...old].filter(Boolean).flatMap((rs) => cl.children(rs!, 'Pod'));
  }
  if (o.kind === 'CronJob') return cl.children(o, 'Job').flatMap((j) => cl.children(j, 'Pod'));
  return cl.children(o, 'Pod');
}

function pickContainer(pod: Obj, name: string | undefined): { c: Json; note: string } {
  const cs: Json[] = pod.spec.containers;
  const inits: Json[] = pod.spec.initContainers || [];
  if (name) {
    const c = [...cs, ...inits].find((x) => x.name === name);
    if (!c) throw new UsageError(`error: container ${name} is not valid for pod ${pod.metadata.name}`);
    return { c, note: '' };
  }
  const def = pod.metadata.annotations?.['kubectl.kubernetes.io/default-container'];
  const c = cs.find((x) => x.name === def) || cs[0];
  return {
    c,
    note: cs.length > 1 ? `Defaulted container "${c.name}" out of: ${[...cs, ...inits].map((x) => x.name).join(', ')}${inits.length ? ` (init)` : ''}\n` : '',
  };
}

function logs(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;

  const f = flagBool(p, 'follow');
  const previous = flagBool(p, 'previous') || flagBool(p, 'p');
  const tail = flagStr(p, 'tail') !== undefined ? parseInt(flagStr(p, 'tail')!, 10) : -1;
  const timestamps = flagBool(p, 'timestamps');
  const sel = flagStr(p, 'selector');
  let pods: Obj[];
  if (sel) pods = cl.list('Pod', ns).filter((x) => matches(parseSelector(sel), x.metadata.labels));
  else {
    if (!p.pos[0])
      throw new UsageError(
        "error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee 'kubectl logs -h' for help and examples",
      );
    pods = [podFor(cl, p.pos[0], ns)];
    if (p.pos[1] && !flagStr(p, 'container')) p.flags.container = p.pos[1];
  }
  if (!pods.length) return ok('No resources found in ' + ns + ' namespace.\n');
  const prefixed = flagBool(p, 'prefix') || pods.length > 1;
  let out = '';
  let stream: Stream | undefined;
  for (const pod of pods.slice(0, 5)) {
    const { c, note } = pickContainer(pod, flagStr(p, 'container'));
    if (pods.length === 1) out += note;
    const rt = cl.s.pods[pod.metadata.uid]?.containers[c.name];
    const status = [...(pod.status?.containerStatuses || []), ...(pod.status?.initContainerStatuses || [])].find((s: Json) => s.name === c.name);
    if (previous) {
      if (!rt?.prevLogs.length && !(rt && rt.restarts > 0))
        return fail(`Error from server (BadRequest): previous terminated container "${c.name}" in pod "${pod.metadata.name}" not found`);
    } else if (!rt || (rt.state === 'waiting' && !rt.restarts && !rt.logs.length)) {
      const reason = status?.state?.waiting?.reason || 'ContainerCreating';
      const why = /ImagePull|ErrImage|InvalidImage/.test(reason) ? 'trying and failing to pull image' : reason;
      return fail(`Error from server (BadRequest): container "${c.name}" in pod "${pod.metadata.name}" is waiting to start: ${why}`);
    }
    const lines = previous ? rt!.prevLogs : rt!.state === 'waiting' ? rt!.prevLogs : rt!.logs;
    const shown = tail >= 0 ? lines.slice(Math.max(0, lines.length - tail)) : lines;
    const prefix = prefixed ? `[pod/${pod.metadata.name}/${c.name}] ` : '';
    out += shown.map((l) => `${prefix}${timestamps ? new Date(l.t).toISOString().replace(/\.\d+Z$/, '.000000000Z') + ' ' : ''}${l.text}\n`).join('');
    if (f && !previous && pods.length === 1) stream = logStream(cl, pod, c.name, lines.length, { timestamps, prefix });
  }
  return { output: out, exitCode: 0, stream };
}

function exec(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  if (!p.pos[0]) throw new UsageError('error: pod, type/name or --filename must be specified');
  const pod = podFor(cl, p.pos[0], ns);
  const { c, note } = pickContainer(pod, flagStr(p, 'container'));
  const cmd = p.rest.length ? p.rest : p.pos.slice(1);
  if (!cmd.length) throw new UsageError('error: you must specify at least one command for the container');
  if (pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed')
    return fail(`error: cannot exec into a container in a completed pod; current phase is ${pod.status.phase}`);
  const rt = cl.s.pods[pod.metadata.uid]?.containers[c.name];
  if (!rt || rt.state !== 'running') return fail(`error: unable to upgrade connection: container not found ("${c.name}")`);
  const sh: PodShell = { pod, container: c, cwd: /nginx/.test(c.image) ? '/' : '/' };
  const interactive = (flagBool(p, 'stdin') || flagBool(p, 'i')) && (flagBool(p, 'tty') || flagBool(p, 't'));
  if (interactive && cmd.length === 1 && /^(\/bin\/)?(sh|bash|ash)$/.test(cmd[0])) {
    if (cmd[0].includes('bash') && /busybox|alpine/.test(c.image)) {
      return fail(
        `${note}error: Internal error occurred: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec "4b1c": OCI runtime exec failed: exec failed: unable to start container process: exec: "bash": executable file not found in $PATH: unknown`,
      );
    }
    return ok(note, { shell: sh });
  }
  const r = podExec(cl, sh, cmd.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' '));
  if (r.exitCode === 127) return { output: note + r.output + `command terminated with exit code 127\n`, exitCode: 127 };
  return { output: note + r.output + (r.exitCode ? `command terminated with exit code ${r.exitCode}\n` : ''), exitCode: r.exitCode };
}

function run(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const name = p.pos[0];
  if (!name) throw new UsageError('error: NAME is required for run');
  const image = flagStr(p, 'image');
  if (!image) throw new UsageError('error: required flag(s) "image" not set');
  const labels = flagStr(p, 'labels')
    ? Object.fromEntries(
        flagStr(p, 'labels')!
          .split(',')
          .map((kv) => kv.split('=')),
      )
    : undefined;
  const attach = ((flagBool(p, 'stdin') || flagBool(p, 'i')) && (flagBool(p, 'tty') || flagBool(p, 't'))) || flagBool(p, 'attach');
  const rm = flagBool(p, 'rm');
  if (rm && !attach) throw new UsageError('error: --rm should only be used for attached containers');
  const restart = flagStr(p, 'restart') || 'Always';
  const cmd = p.rest.length ? p.rest : p.pos.slice(1);
  const pod = genPod(name, image, {
    restart,
    port: flagStr(p, 'port') ? parseInt(flagStr(p, 'port')!, 10) : undefined,
    labels,
    env: p.multi.env,
    command: flagBool(p, 'command'),
    rest: cmd,
  });
  const dry = dryRunMode(p);
  const out = flagStr(p, 'output');
  if (dry !== 'none' || out === 'yaml' || out === 'json') {
    if (out === 'yaml') return ok(toYaml(pod));
    if (out === 'json') return ok(toJson(pod));
    return ok(`pod/${name} created (dry run)\n`);
  }
  const created = cl.create(pod, ns);
  if (!attach) return ok(`pod/${name} created\n`, { select: created.metadata.uid });
  // Attached: wait for the pod, then run the command (or open a shell).
  const isShell = !cmd.length ? /busybox|alpine|ubuntu|debian|curl|netshoot/.test(image) : cmd.length === 1 && /^(\/bin\/)?(sh|bash|ash)$/.test(cmd[0]);
  const started = cl.now;
  let said = false;
  const stream: Stream = {
    poll(c) {
      const cur = c.get('Pod', ns, name);
      if (!cur) return { text: '', done: true, exitCode: 1 };
      const st = cur.status?.containerStatuses?.[0]?.state;
      if (st?.waiting && /ImagePull|ErrImage|InvalidImage/.test(st.waiting.reason || '')) {
        return {
          text: `error: timed out waiting for the condition\n(la imagen "${image}" no se puede descargar: ${st.waiting.reason})\n`,
          done: true,
          exitCode: 1,
        };
      }
      if (c.now - started > 60_000) return { text: 'error: timed out waiting for the condition\n', done: true, exitCode: 1 };
      const running = st?.running;
      if (!running) return { text: '' };
      const sh: PodShell = { pod: cur, container: cur.spec.containers[0], cwd: '/' };
      if (isShell) {
        const text = said ? '' : "If you don't see a command prompt, try pressing enter.\n";
        said = true;
        return { text, done: true, exitCode: 0, shell: { ...sh, rm } };
      }
      const r = podExec(c, sh, cmd.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' '));
      const rt = c.s.pods[cur.metadata.uid]?.containers[cur.spec.containers[0].name];
      if (rt) for (const line of r.output.replace(/\n$/, '').split('\n')) rt.logs.push({ t: c.now, text: line });
      let text = r.output;
      if (rm) {
        c.deleteObject(cur, { gracePeriod: 0, force: true });
        text += `pod "${name}" deleted\n`;
      }
      return { text, done: true, exitCode: r.exitCode };
    },
    stop: (c) => {
      if (rm) {
        const cur = c.get('Pod', ns, name);
        if (cur) c.deleteObject(cur, { gracePeriod: 0, force: true });
      }
      return '^C\n';
    },
  };
  return { output: '', exitCode: 0, stream };
}

// ── expose / scale / autoscale / set ─────────────────────────────────

function one(p: Parsed, cl: Cluster, ns: string): Obj {
  const { groups, errors } = targets(p, cl, ns, true);
  const o = groups[0]?.objs[0];
  if (!o) throw new UsageError(errors[0] || 'error: resource not found');
  return o;
}

function expose(p: Parsed, ctx: Ctx, ns: string): Result {
  const o = one(p, ctx.cl, ns);
  let selector: Record<string, string> | undefined;
  if (o.kind === 'Pod') selector = o.metadata.labels;
  else if (o.kind === 'Service') selector = o.spec.selector;
  else selector = o.spec?.selector?.matchLabels;
  if (!selector || !Object.keys(selector).length)
    return fail(`error: couldn't retrieve selectors via --selector flag or introspection: the ${o.kind} has no selector`);
  let port = flagStr(p, 'port');
  if (!port) {
    const cp = o.kind === 'Service' ? o.spec.ports?.[0]?.port : (o.kind === 'Pod' ? o.spec : o.spec.template?.spec)?.containers?.[0]?.ports?.[0]?.containerPort;
    if (!cp) return fail(`error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples`);
    port = String(cp);
  }
  const target = flagStr(p, 'target-port') || port;
  const svc = genService(
    flagStr(p, 'name') || o.metadata.name,
    flagStr(p, 'type') || 'ClusterIP',
    [{ port: parseInt(port, 10), targetPort: /^\d+$/.test(target) ? parseInt(target, 10) : target }],
    selector,
    o.metadata.labels,
  );
  const dry = dryRunMode(p);
  const out = flagStr(p, 'output');
  if (out === 'yaml') return ok(toYaml(svc));
  if (dry !== 'none') return ok(`service/${svc.metadata.name} exposed (dry run)\n`);
  const created = ctx.cl.create(svc, ns);
  return ok(`service/${created.metadata.name} exposed\n`, { select: created.metadata.uid });
}

function scale(p: Parsed, ctx: Ctx, ns: string): Result {
  const r = flagStr(p, 'replicas');
  if (r === undefined) throw new UsageError('error: required flag(s) "replicas" not set');
  const n = parseInt(r, 10);
  if (Number.isNaN(n) || n < 0) throw new UsageError('error: The --replicas=COUNT flag is required, and COUNT must be greater than or equal to 0');
  const objs = p.multi.filename?.length
    ? parseAllFiles(p, ctx)
        .map((d) => ctx.cl.get(d.obj.kind, d.obj.metadata?.namespace || ns, d.obj.metadata?.name))
        .filter(Boolean)
    : targets(p, ctx.cl, ns, true).groups.flatMap((g) => g.objs);
  if (!objs.length) return fail('error: no objects passed to scale');
  let out = '';
  for (const o of objs) {
    if (!['Deployment', 'ReplicaSet', 'StatefulSet'].includes(o.kind)) {
      out += `error: cannot scale ${qualifiedName(o.kind)}/${o.metadata.name}: no scale subresource\n`;
      continue;
    }
    const hpa = ctx.cl
      .list('HorizontalPodAutoscaler', o.metadata.namespace)
      .find((h) => h.spec.scaleTargetRef?.name === o.metadata.name && h.spec.scaleTargetRef?.kind === o.kind);
    ctx.cl.mutate(o, (x) => {
      if (x.spec.replicas !== n) x.metadata.generation = (x.metadata.generation || 1) + 1;
      x.spec.replicas = n;
    });
    out += `${objectName(o)} scaled\n`;
    if (hpa) out += `(ojo: el HPA "${hpa.metadata.name}" controla este ${o.kind} y puede volver a cambiar las réplicas)\n`;
  }
  return ok(out, { select: objs[0].metadata.uid });
}

function autoscale(p: Parsed, ctx: Ctx, ns: string): Result {
  const o = one(p, ctx.cl, ns);
  const max = flagStr(p, 'max');
  if (!max) throw new UsageError('error: --max=MAXPODS is required and must be at least 1, max: -1');
  const min = flagStr(p, 'min');
  const cpu = flagStr(p, 'cpu-percent') || flagStr(p, 'cpu')?.replace('%', '');
  const hpa = genHpa(o, min ? parseInt(min, 10) : undefined, parseInt(max, 10), cpu ? parseInt(cpu, 10) : undefined, flagStr(p, 'name'));
  if (flagStr(p, 'output') === 'yaml') return ok(toYaml(hpa));
  const created = ctx.cl.create(hpa, ns);
  return ok(`horizontalpodautoscaler.autoscaling/${created.metadata.name} autoscaled\n`, { select: created.metadata.uid });
}

function podSpecOf(o: Obj): Json {
  if (o.kind === 'Pod') return o.spec;
  if (o.kind === 'CronJob') return o.spec.jobTemplate.spec.template.spec;
  return o.spec.template.spec;
}

function setCmd(p: Parsed, ctx: Ctx, ns: string): Result {
  const [what, ...rest] = p.pos;
  const cl = ctx.cl;
  // KEY=VALUE (the key never has a slash; the value can: ghcr.io/org/img:tag) and KEY- (unset).
  const isAssign = (x: string) => /^[^=/]+=/.test(x) || /^[\w.-]+-$/.test(x);
  const q: Parsed = { ...p, pos: rest.filter((x) => !isAssign(x)) };
  const assignments = rest.filter(isAssign);
  if (what === 'image') {
    const objs = targets(q, cl, ns, true).groups.flatMap((g) => g.objs);
    let out = '';
    for (const o of objs) {
      const spec = podSpecOf(o);
      for (const a of assignments) {
        const [cname, image] = a.split('=');
        const cs = [...(spec.containers || []), ...(spec.initContainers || [])].filter((c: Json) => cname === '*' || c.name === cname);
        if (!cs.length) return fail(`error: unable to find container named "${cname}"`);
      }
      const before = JSON.stringify(spec);
      const next = clone(o);
      const nspec = podSpecOf(next);
      for (const a of assignments) {
        const [cname, image] = a.split('=');
        for (const c of [...(nspec.containers || []), ...(nspec.initContainers || [])]) if (cname === '*' || c.name === cname) c.image = image;
      }
      if (JSON.stringify(nspec) === before) {
        out += `${objectName(o)} image updated\n`;
        continue;
      }
      cl.checkImmutable(o, next);
      cl.commitUpdate(o, next);
      out += `${objectName(o)} image updated\n`;
    }
    return ok(out, { select: objs[0]?.metadata.uid });
  }
  if (what === 'env') {
    const objs = targets(q, cl, ns, true).groups.flatMap((g) => g.objs);
    let out = '';
    for (const o of objs) {
      const next = clone(o);
      for (const c of podSpecOf(next).containers) {
        if (flagStr(p, 'container') && c.name !== flagStr(p, 'container')) continue;
        c.env = [...(c.env || [])];
        for (const a of assignments) {
          if (a.endsWith('-') && !a.includes('=')) c.env = c.env.filter((e: Json) => e.name !== a.slice(0, -1));
          else {
            const [k, ...v] = a.split('=');
            const e = c.env.find((x: Json) => x.name === k);
            if (e) {
              e.value = v.join('=');
              delete e.valueFrom;
            } else c.env.push({ name: k, value: v.join('=') });
          }
        }
        if (!c.env.length) delete c.env;
      }
      cl.commitUpdate(o, next);
      out += `${objectName(o)} env updated\n`;
    }
    return ok(out);
  }
  if (what === 'resources') {
    const objs = targets(q, cl, ns, true).groups.flatMap((g) => g.objs);
    let out = '';
    for (const o of objs) {
      const next = clone(o);
      for (const c of podSpecOf(next).containers) {
        c.resources = { ...(c.resources || {}) };
        for (const [flag, key] of [
          ['requests', 'requests'],
          ['limits', 'limits'],
        ] as const) {
          const v = flagStr(p, flag);
          if (v) c.resources[key] = { ...(c.resources[key] || {}), ...Object.fromEntries(v.split(',').map((kv) => kv.split('='))) };
        }
      }
      cl.commitUpdate(o, next);
      out += `${objectName(o)} resource requirements updated\n`;
    }
    return ok(out);
  }
  return fail(`error: unknown command "${what || ''}" for "kubectl set"\n\nAvailable Commands:\n  env\n  image\n  resources`);
}

// ── rollout ──────────────────────────────────────────────────────────

function rollout(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const [sub, ...rest] = p.pos;
  const q: Parsed = { ...p, pos: rest };
  const subs = ['history', 'pause', 'restart', 'resume', 'status', 'undo'];
  if (!sub || !subs.includes(sub))
    return fail(
      `Manage the rollout of one or many resources.\n\nAvailable Commands:\n  history       View rollout history\n  pause         Mark the provided resource as paused\n  restart       Restart a resource\n  resume        Resume a paused resource\n  status        Show the status of the rollout\n  undo          Undo a previous rollout\n\nUsage:\n  kubectl rollout SUBCOMMAND [options]`,
    );
  const objs = targets(q, cl, ns, true).groups.flatMap((g) => g.objs);
  const o = objs[0];
  if (!o) return fail(targets(q, cl, ns).errors[0] || 'error: resource not found');
  if (!['Deployment', 'StatefulSet', 'DaemonSet'].includes(o.kind))
    return fail(`error: ${sub === 'status' ? 'no status viewer' : 'no rollbacker'} has been implemented for ${qualifiedName(o.kind)}`);
  const name = objectName(o);
  switch (sub) {
    case 'status': {
      if (flagStr(p, 'watch') === 'false') {
        const r = rolloutStream(cl, o);
        return { output: r.first, exitCode: r.exitCode };
      }
      const timeout = flagStr(p, 'timeout');
      const r = rolloutStream(cl, o, timeout ? parseDurationFlag(timeout) : undefined);
      return { output: r.first, exitCode: r.exitCode, stream: r.stream, select: o.metadata.uid };
    }
    case 'history': {
      const rev = flagStr(p, 'revision');
      if (o.kind === 'Deployment') {
        const rss = cl.children(o, 'ReplicaSet').sort((a, b) => revisionOf(a) - revisionOf(b));
        if (rev) {
          const rs = rss.find((r) => String(revisionOf(r)) === rev);
          if (!rs) return fail(`error: unable to find the specified revision`);
          return ok(`${name} with revision #${rev}\n${templateText(rs.spec.template)}`);
        }
        const rows = [
          ['REVISION', 'CHANGE-CAUSE'],
          ...rss.map((r) => [String(revisionOf(r)), r.metadata.annotations?.['kubernetes.io/change-cause'] || '<none>']),
        ];
        return ok(`${name} \n${pad(rows)}\n`);
      }
      const revs = Object.keys(cl.s.revisions?.[o.metadata.uid] || {});
      if (rev) {
        const t = cl.s.revisions?.[o.metadata.uid]?.[revs[parseInt(rev, 10) - 1]];
        if (!t) return fail(`error: unable to find the specified revision`);
        return ok(`${name} with revision #${rev}\n${templateText(t)}`);
      }
      return ok(`${name} \n${pad([['REVISION', 'CHANGE-CAUSE'], ...revs.map((_, i) => [String(i + 1), '<none>'])])}\n`);
    }
    case 'pause':
    case 'resume': {
      if (o.kind !== 'Deployment') return fail(`error: ${qualifiedName(o.kind).split('.')[0]}s "${o.metadata.name}" ${sub} is not supported`);
      const want = sub === 'pause';
      if (!!o.spec.paused === want) return fail(`error: deployments.apps "${o.metadata.name}" is ${want ? 'already paused' : 'not paused'}`);
      cl.mutate(o, (d) => {
        if (want) d.spec.paused = true;
        else delete d.spec.paused;
      });
      return ok(`${name} ${want ? 'paused' : 'resumed'}\n`);
    }
    case 'restart': {
      if (o.spec.paused) return fail(`error: deployments.apps "${o.metadata.name}" can't restart paused deployment (run rollout resume first)`);
      const next = clone(o);
      next.spec.template.metadata ??= {};
      next.spec.template.metadata.annotations = {
        ...(next.spec.template.metadata.annotations || {}),
        'kubectl.kubernetes.io/restartedAt': new Date(cl.now).toISOString().replace(/\.\d+Z$/, 'Z'),
      };
      cl.commitUpdate(o, next);
      return ok(`${name} restarted\n`, { select: o.metadata.uid });
    }
    case 'undo': {
      const to = flagStr(p, 'to-revision');
      if (o.kind === 'Deployment') {
        if (o.spec.paused) return fail(`error: you cannot rollback a paused deployment; resume it first with 'kubectl rollout resume' and try again`);
        const rss = cl.children(o, 'ReplicaSet').sort((a, b) => revisionOf(b) - revisionOf(a));
        let target: Obj | undefined;
        if (to && to !== '0') {
          target = rss.find((r) => String(revisionOf(r)) === to);
          if (!target) return fail(`error: unable to find specified revision ${to} in history`);
        } else {
          target = rss[1];
          if (!target) return fail(`error: no rollout history found for deployment "${o.metadata.name}"`);
        }
        if (target.metadata.labels?.[HASH] === templateHash(o.spec.template))
          return ok(`${name} skipped rollback (current template already matches revision ${revisionOf(target)})\n`);
        const next = clone(o);
        next.spec.template = stripHash(target.spec.template);
        const cc = target.metadata.annotations?.['kubernetes.io/change-cause'];
        if (cc) next.metadata.annotations = { ...(next.metadata.annotations || {}), 'kubernetes.io/change-cause': cc };
        cl.commitUpdate(o, next);
        return ok(`${name} rolled back\n`, { select: o.metadata.uid });
      }
      const revs = cl.s.revisions?.[o.metadata.uid] || {};
      const keys = Object.keys(revs);
      const idx = to && to !== '0' ? parseInt(to, 10) - 1 : keys.length - 2;
      const t = revs[keys[idx]];
      if (!t) return fail(`error: no rollout history found for ${qualifiedName(o.kind).split('.')[0]} "${o.metadata.name}"`);
      const next = clone(o);
      next.spec.template = clone(t);
      cl.commitUpdate(o, next);
      return ok(`${name} rolled back\n`, { select: o.metadata.uid });
    }
  }
  return fail('error: unknown rollout command');
}

function templateText(t: Obj): string {
  const lines = ['Pod Template:'];
  const labels = Object.entries(t.metadata?.labels || {});
  lines.push(`  Labels:\t${labels.map(([k, v]) => `${k}=${v}`).join('\n\t')}`);
  const ann = Object.entries(t.metadata?.annotations || {});
  if (ann.length) lines.push(`  Annotations:\t${ann.map(([k, v]) => `${k}: ${v}`).join('\n\t')}`);
  lines.push('  Containers:');
  for (const c of t.spec?.containers || []) {
    lines.push(`   ${c.name}:`);
    lines.push(`    Image:\t${c.image}`);
    lines.push(`    Port:\t${(c.ports || []).map((x: Json) => `${x.containerPort}/${x.protocol || 'TCP'}`).join(', ') || '<none>'}`);
    lines.push(`    Host Port:\t${(c.ports || []).length ? '0/TCP' : '<none>'}`);
    lines.push(`    Environment:\t${(c.env || []).length ? '' : '<none>'}`);
    for (const e of c.env || []) lines.push(`      ${e.name}:\t${e.value ?? '(from ref)'}`);
    lines.push(`    Mounts:\t${(c.volumeMounts || []).length ? (c.volumeMounts || []).map((m: Json) => m.mountPath).join(', ') : '<none>'}`);
  }
  lines.push(`  Volumes:\t${(t.spec?.volumes || []).map((v: Json) => v.name).join(', ') || '<none>'}`);
  lines.push(`  Node-Selectors:\t<none>`);
  lines.push(`  Tolerations:\t<none>`);
  return lines.join('\n') + '\n\n';
}

function parseDurationFlag(s: string): number {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(s);
  if (!m) return 30_000;
  return parseInt(m[1], 10) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(m[2] || 's') as 's'];
}

// ── labels, annotations, patch ───────────────────────────────────────

function labelCmd(cmd: 'label' | 'annotate', p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const changes = p.pos.filter((x) => ((x.includes('=') || /[^/]-$/.test(x)) && !x.includes('/')) || (/^[\w./-]+=/.test(x) && x.split('=')[0].includes('/')));
  const res = p.pos.filter((x) => !changes.includes(x));
  const objs = targets({ ...p, pos: res }, cl, ns, flagStr(p, 'selector') === undefined && !flagBool(p, 'all')).groups.flatMap((g) => g.objs);
  if (!changes.length) return fail(`error: at least one ${cmd === 'label' ? 'label' : 'annotation'} update is required`);
  const field = cmd === 'label' ? 'labels' : 'annotations';
  const overwrite = flagBool(p, 'overwrite');
  let out = '';
  for (const o of objs) {
    const cur = { ...(o.metadata[field] || {}) };
    for (const ch of changes) {
      if (ch.endsWith('-') && !ch.includes('=')) {
        delete cur[ch.slice(0, -1)];
        continue;
      }
      const [k, ...v] = ch.split('=');
      const val = v.join('=');
      if (k in cur && cur[k] !== val && !overwrite) return fail(`error: '${k}' already has a value (${cur[k]}), and --overwrite is false`);
      cur[k] = val;
    }
    const same = JSON.stringify(cur) === JSON.stringify(o.metadata[field] || {});
    cl.mutate(o, (x) => {
      if (Object.keys(cur).length) x.metadata[field] = cur;
      else delete x.metadata[field];
    });
    out += `${objectName(o)} ${same ? 'not ' : ''}${cmd === 'label' ? 'labeled' : 'annotated'}\n`;
  }
  return ok(out, { select: objs[0]?.metadata.uid });
}

function patch(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const body = flagStr(p, 'patch');
  if (!body) throw new UsageError('error: must specify -p to patch');
  const o = one(p, cl, ns);
  let parsed: Json;
  try {
    parsed = JSON.parse(body);
  } catch {
    try {
      parsed = parseYaml(body);
    } catch {
      return fail(`error: unable to parse "${body}": yaml: did not find expected node content`);
    }
  }
  const type = flagStr(p, 'type') || 'strategic';
  let next: Obj;
  try {
    next = type === 'json' ? jsonPatch(o, parsed) : type === 'merge' ? mergePatch(o, parsed) : strategicPatch(o, parsed);
  } catch (e) {
    return fail(`The request is invalid: ${(e as Error).message}`);
  }
  const before = JSON.stringify(o);
  const manifest = clone(next);
  delete manifest.status;
  const prepared = cl.prepare(manifest, o.metadata.namespace);
  const merged = cl.merge(o, prepared, undefined, true);
  merged.metadata.annotations = next.metadata.annotations;
  merged.metadata.labels = next.metadata.labels;
  cl.checkImmutable(o, merged);
  if (
    JSON.stringify({ ...merged, status: undefined, metadata: { ...merged.metadata, resourceVersion: '' } }) ===
    JSON.stringify({ ...JSON.parse(before), status: undefined, metadata: { ...JSON.parse(before).metadata, resourceVersion: '' } })
  ) {
    return ok(`${objectName(o)} patched (no change)\n`);
  }
  cl.commitUpdate(o, merged);
  return ok(`${objectName(o)} patched\n`, { select: o.metadata.uid });
}

// ── top, nodes, port-forward, wait ───────────────────────────────────

function top(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const what = p.pos[0];
  if (what === 'node' || what === 'nodes' || what === 'no') {
    const rows = [['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)']];
    for (const n of cl.list('Node')) {
      if (cl.s.downNodes[n.metadata.uid] !== undefined) {
        rows.push([n.metadata.name, '<unknown>', '<unknown>', '<unknown>', '<unknown>']);
        continue;
      }
      const pods = cl.list('Pod').filter((x) => x.spec.nodeName === n.metadata.name && x.status?.phase === 'Running');
      const cpu = pods.reduce((s, x) => s + cpuMillis(cl, x), 60);
      const mem = pods.reduce((s, x) => s + podMemory(x), 420 * 1024 * 1024);
      rows.push([n.metadata.name, `${cpu}m`, `${Math.round(cpu / 40)}%`, memMi(mem), `${Math.round((mem / (7.76 * 1024 ** 3)) * 100)}%`]);
    }
    return ok(pad(rows));
  }
  if (what === 'pod' || what === 'pods' || what === 'po') {
    const all = flagBool(p, 'all-namespaces');
    const sel = flagStr(p, 'selector');
    let pods = cl.list('Pod', all ? undefined : ns).filter((x) => x.status?.phase === 'Running' && !x.metadata.deletionTimestamp);
    if (sel) pods = pods.filter((x) => matches(parseSelector(sel), x.metadata.labels));
    if (p.pos[1]) pods = pods.filter((x) => x.metadata.name === p.pos[1]);
    if (!pods.length) return ok(`No resources found${all ? '' : nsLabel(ns)}.\n`);
    const rows = [[...(all ? ['NAMESPACE'] : []), 'NAME', 'CPU(cores)', 'MEMORY(bytes)']];
    for (const x of pods) rows.push([...(all ? [x.metadata.namespace] : []), x.metadata.name, `${cpuMillis(cl, x)}m`, memMi(podMemory(x))]);
    return ok(pad(rows));
  }
  return fail(
    'Display resource (CPU/memory) usage.\n\nAvailable Commands:\n  node          Display resource (CPU/memory) usage of nodes\n  pod           Display resource (CPU/memory) usage of pods',
  );
}

function nodeCmd(cmd: 'cordon' | 'uncordon' | 'drain', p: Parsed, ctx: Ctx): Result {
  const cl = ctx.cl;
  const name = p.pos[0];
  if (!name) throw new UsageError(`error: USAGE: ${cmd} NODE [flags]`);
  const node = cl.get('Node', undefined, name);
  if (!node) return fail(`Error from server (NotFound): nodes "${name}" not found`);
  const setUnsched = (v: boolean) => {
    const was = !!node.spec.unschedulable;
    cl.mutate(node, (n) => {
      if (v) {
        n.spec.unschedulable = true;
        n.spec.taints = [
          ...(n.spec.taints || []).filter((t: Json) => t.key !== 'node.kubernetes.io/unschedulable'),
          { key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule', timeAdded: cl.ts() },
        ];
      } else {
        delete n.spec.unschedulable;
        n.spec.taints = (n.spec.taints || []).filter((t: Json) => t.key !== 'node.kubernetes.io/unschedulable');
        if (!n.spec.taints.length) delete n.spec.taints;
      }
    });
    return was === v ? `node/${name} already ${v ? 'cordoned' : 'uncordoned'}\n` : `node/${name} ${v ? 'cordoned' : 'uncordoned'}\n`;
  };
  if (cmd === 'cordon') return ok(setUnsched(true), { select: node.metadata.uid });
  if (cmd === 'uncordon') return ok(setUnsched(false), { select: node.metadata.uid });
  const pods = cl.list('Pod').filter((x) => x.spec.nodeName === name && !x.metadata.deletionTimestamp && !['Succeeded', 'Failed'].includes(x.status?.phase));
  const ds = pods.filter((x) => x.metadata.ownerReferences?.some((r: Json) => r.kind === 'DaemonSet'));
  const mirror = pods.filter((x) => x.metadata.annotations?.['kubernetes.io/config.mirror']);
  const unmanaged = pods.filter((x) => !x.metadata.ownerReferences?.length);
  const emptyDir = pods.filter((x) => (x.spec.volumes || []).some((v: Json) => v.emptyDir));
  const errs: string[] = [];
  if (ds.length && !flagBool(p, 'ignore-daemonsets'))
    errs.push(
      `cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ${ds.map((x) => `${x.metadata.namespace}/${x.metadata.name}`).join(', ')}`,
    );
  if (unmanaged.length && !flagBool(p, 'force'))
    errs.push(
      `cannot delete Pods that declare no controller (use --force to override): ${unmanaged.map((x) => `${x.metadata.namespace}/${x.metadata.name}`).join(', ')}`,
    );
  if (emptyDir.length && !flagBool(p, 'delete-emptydir-data') && !flagBool(p, 'delete-local-data'))
    errs.push(
      `cannot delete Pods with local storage (use --delete-emptydir-data to override): ${emptyDir.map((x) => `${x.metadata.namespace}/${x.metadata.name}`).join(', ')}`,
    );
  let out = setUnsched(true);
  if (errs.length)
    return fail(
      `${out}error: unable to drain node "${name}" due to error: [${errs.join(', ')}], continuing command...\nThere are pending nodes to be drained:\n ${name}\n${errs.map((e) => `error: ${e}`).join('\n')}`,
    );
  const evict = pods.filter((x) => !ds.includes(x) && !mirror.includes(x));
  if (ds.length) out += `Warning: ignoring DaemonSet-managed Pods: ${ds.map((x) => `${x.metadata.namespace}/${x.metadata.name}`).join(', ')}\n`;
  for (const x of evict) out += `evicting pod ${x.metadata.namespace}/${x.metadata.name}\n`;
  for (const x of evict) {
    cl.deleteObject(x);
    out += `pod/${x.metadata.name} evicted\n`;
  }
  out += `node/${name} drained\n`;
  return ok(out, { select: node.metadata.uid });
}

function portForward(p: Parsed, ctx: Ctx, ns: string): Result {
  const cl = ctx.cl;
  const [ref, ...ports] = p.pos;
  if (!ref || !ports.length) throw new UsageError('error: TYPE/NAME and list of ports are required for port-forward');
  let kind = 'Pod';
  let name = ref;
  if (ref.includes('/')) {
    const [t, n] = ref.split('/');
    kind = typeOf(t).kind;
    name = n;
  }
  const o = cl.get(kind, ns, name);
  if (!o) return fail(notFound(resourceByKind(kind)!, name));
  let target = o;
  if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'ReplicaSet') {
    const pod = podsOf(cl, o).find(podReady);
    if (!pod) return fail('error: unable to forward port because pod is not running. Current status=Pending');
    target = pod;
    kind = 'Pod';
    name = pod.metadata.name;
  }
  if (kind === 'Pod' && target.status?.phase !== 'Running')
    return fail(`error: unable to forward port because pod is not running. Current status=${target.status?.phase}`);
  const entries = ports.map((x) => {
    const [l, r] = x.split(':');
    return { local: parseInt(l || r, 10), port: parseInt(r || l, 10) };
  });
  for (const e of entries) {
    if (cl.s.portForwards.some((f) => f.local === e.local))
      return fail(
        `Unable to listen on port ${e.local}: Listeners failed to create with the following errors: [unable to create listener: Error listen tcp4 127.0.0.1:${e.local}: bind: address already in use]\nerror: unable to listen on any of the requested ports: [{${e.local} ${e.port}}]`,
      );
    if (kind === 'Service' && !(target.spec.ports || []).some((sp: Json) => sp.port === e.port))
      return fail(`error: Service ${name} does not have a service port ${e.port}`);
  }
  for (const e of entries) cl.s.portForwards.push({ local: e.local, kind, namespace: ns, name, port: e.port });
  const text = entries
    .map(
      (e) =>
        `Forwarding from 127.0.0.1:${e.local} -> ${kind === 'Service' ? targetPortOf(cl, target, e.port) : e.port}\nForwarding from [::1]:${e.local} -> ${kind === 'Service' ? targetPortOf(cl, target, e.port) : e.port}\n`,
    )
    .join('');
  return { output: text, exitCode: 0, stream: portForwardStream(cl, entries, { kind, namespace: ns, name }) };
}

function targetPortOf(cl: Cluster, svc: Obj, port: number) {
  const sp = (svc.spec.ports || []).find((x: Json) => x.port === port);
  return sp?.targetPort ?? port;
}

function wait(p: Parsed, ctx: Ctx, ns: string): Result {
  const forExpr = flagStr(p, 'for');
  if (!forExpr) throw new UsageError('error: --for must be specified');
  const { groups, errors } = targets(p, ctx.cl, ns);
  if (errors.length && forExpr !== 'delete') return fail(errors.join('\n'));
  const objs = groups.flatMap((g) => g.objs);
  if (!objs.length) return fail(`error: no matching resources found`);
  const r = waitStream(ctx.cl, objs, forExpr, parseDurationFlag(flagStr(p, 'timeout') || '30s'), (o) => objectName(o));
  return { output: r.first, exitCode: r.exitCode, stream: r.stream };
}

// ── config, api-resources, explain, kustomize ────────────────────────

function config(p: Parsed, ctx: Ctx): Result {
  const [sub, ...rest] = p.pos;
  switch (sub) {
    case 'current-context':
      return ok('kind-playground\n');
    case 'get-contexts':
      return ok(
        pad([
          ['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'],
          ['*', 'kind-playground', 'kind-playground', 'kind-playground', ctx.cl.s.namespace === 'default' ? '' : ctx.cl.s.namespace],
        ]),
      );
    case 'use-context':
      if (rest[0] !== 'kind-playground') return fail(`error: no context exists with the name: "${rest[0]}"`);
      return ok('Switched to context "kind-playground".\n');
    case 'set-context': {
      const n = flagStr(p, 'namespace');
      if (n === undefined) return ok('Context "kind-playground" modified.\n');
      ctx.cl.s.namespace = n || 'default';
      return ok(`Context "kind-playground" modified.\n${ctx.cl.get('Namespace', undefined, n) ? '' : `(ojo: el namespace "${n}" todavía no existe)\n`}`);
    }
    case 'view':
      return ok(
        `apiVersion: v1\nclusters:\n- cluster:\n    certificate-authority-data: DATA+OMITTED\n    server: https://127.0.0.1:6443\n  name: kind-playground\ncontexts:\n- context:\n    cluster: kind-playground\n${ctx.cl.s.namespace !== 'default' ? `    namespace: ${ctx.cl.s.namespace}\n` : ''}    user: kind-playground\n  name: kind-playground\ncurrent-context: kind-playground\nkind: Config\npreferences: {}\nusers:\n- name: kind-playground\n  user:\n    client-certificate-data: DATA+OMITTED\n    client-key-data: DATA+OMITTED\n`,
      );
    default:
      return fail(
        'Modify kubeconfig files using subcommands like "kubectl config set current-context my-context".\n\nAvailable Commands:\n  current-context   Display the current-context\n  get-contexts      Describe one or many contexts\n  set-context       Set a context entry in kubeconfig\n  use-context       Set the current-context in a kubeconfig file\n  view              Display merged kubeconfig settings',
      );
  }
}

function apiResources(p: Parsed): Result {
  const nsFilter = flagStr(p, 'namespaced');
  const rows = [['NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND']];
  for (const r of [...RESOURCES].sort(
    (a, b) =>
      (a.versions[0].includes('/') ? 1 : 0) - (b.versions[0].includes('/') ? 1 : 0) ||
      a.versions[0].localeCompare(b.versions[0]) ||
      a.plural.localeCompare(b.plural),
  )) {
    if (nsFilter !== undefined && String(r.namespaced) !== nsFilter) continue;
    rows.push([r.plural, r.short.join(','), r.versions[0], String(r.namespaced), r.kind]);
  }
  return ok(pad(rows));
}

function explain(p: Parsed): Result {
  const q = p.pos[0];
  if (!q) throw new UsageError('You must specify the type of resource to explain. Use "kubectl api-resources" for a complete list of supported resources.');
  const [t, ...path] = q.split('.');
  const type = typeOf(t);
  const gv = type.versions[0];
  const group = gv.includes('/') ? gv.split('/')[0] : '';
  const at = typeAt(type.kind, path);
  if (!at) return fail(`error: field "${path[path.length - 1]}" does not exist`);
  const def = at.def;
  const kindType = (ft: string) =>
    ft === 'int'
      ? 'integer'
      : ft === 'bool'
        ? 'boolean'
        : ft === 'map'
          ? 'map[string]string'
          : ft === 'intstr'
            ? 'IntOrString'
            : ft.endsWith('[]')
              ? `[]${ft.slice(0, -2)}`
              : ft;
  let out = `${group ? `GROUP:      ${group}\n` : ''}KIND:       ${type.kind}\nVERSION:    ${gv.split('/').pop()}\n\n`;
  if (path.length) out += `FIELD: ${path[path.length - 1]} <${kindType(at.type)}>\n\n`;
  out +=
    `DESCRIPTION:\n    ${(path.length ? at.field?.[1] : TYPES[type.kind]?.doc || type.description) || '<empty>'}\n    ${def?.doc && path.length ? def.doc : ''}\n`.replace(
      /\n {4}\n$/,
      '\n',
    );
  if (def) {
    out += '\nFIELDS:\n';
    for (const [name, f] of Object.entries(def.fields)) {
      if (
        ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'deletionTimestamp', 'deletionGracePeriodSeconds', 'managedFields', 'selfLink'].includes(
          name,
        ) &&
        !flagBool(p, 'recursive')
      )
        continue;
      out += `  ${name}\t<${kindType(f[0])}>${def.required?.includes(name) ? ' -required-' : ''}\n    ${f[1] || ''}\n\n`;
    }
  }
  return ok(out);
}

async function kustomizeCmd(p: Parsed, ctx: Ctx): Promise<Result> {
  if (!ctx.kustomize) return fail('error: kustomize no está disponible');
  const docs = await ctx.kustomize(p.pos[0] || '.');
  return ok(docs.map((d) => toYaml(d.obj)).join('---\n'));
}

export { podStatus, podPrompt };
