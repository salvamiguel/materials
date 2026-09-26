// Tab completion for the terminal: commands, kubectl verbs, resource types,
// object names and workspace files.

import type { Cluster } from './engine/cluster';
import { resolveResource, RESOURCES } from './engine/resources';
import { shellSplit } from '../shared/shell';

const TOP = ['kubectl', 'helm', 'kustomize build', 'curl', 'watch', 'clear', 'help', 'ls', 'cat', 'k'];
const VERBS = [
  'get',
  'describe',
  'apply',
  'create',
  'delete',
  'logs',
  'exec',
  'run',
  'expose',
  'scale',
  'autoscale',
  'rollout',
  'set',
  'edit',
  'label',
  'annotate',
  'patch',
  'diff',
  'top',
  'port-forward',
  'wait',
  'events',
  'explain',
  'cordon',
  'uncordon',
  'drain',
  'config',
  'api-resources',
  'kustomize',
  'version',
  'cluster-info',
  'replace',
];
const HELM = ['install', 'upgrade', 'rollback', 'uninstall', 'list', 'history', 'status', 'template', 'lint', 'show', 'get', 'version'];
const TYPE_VERBS = new Set(['get', 'describe', 'delete', 'edit', 'label', 'annotate', 'patch', 'scale', 'expose', 'autoscale', 'wait']);
const TYPES = [
  'pods',
  'deployments',
  'services',
  'replicasets',
  'statefulsets',
  'daemonsets',
  'jobs',
  'cronjobs',
  'ingresses',
  'configmaps',
  'secrets',
  'namespaces',
  'nodes',
  'persistentvolumeclaims',
  'persistentvolumes',
  'hpa',
  'events',
  'endpoints',
  'all',
  'deploy',
  'svc',
  'po',
  'rs',
  'sts',
  'ds',
  'cm',
  'ns',
  'pvc',
  'pv',
  'ing',
];

function common(cands: string[]): string | undefined {
  if (!cands.length) return undefined;
  let p = cands[0];
  for (const c of cands) while (!c.startsWith(p)) p = p.slice(0, -1);
  return p;
}

export function completeLine(cl: Cluster, files: Record<string, string>, input: string): string | undefined {
  const endsSpace = /\s$/.test(input);
  const words = shellSplit(input);
  if (endsSpace || !words.length) words.push('');
  const cur = words[words.length - 1];
  const prev = words.slice(0, -1);
  const head = input.slice(0, input.length - cur.length);
  const pick = (cands: string[], space = true) => {
    const m = [...new Set(cands)].filter((c) => c.startsWith(cur));
    if (!m.length) return undefined;
    if (m.length === 1) return head + m[0] + (space && !m[0].endsWith('/') ? ' ' : '');
    const c = common(m)!;
    return c.length > cur.length ? head + c : undefined;
  };
  const ns = (() => {
    const i = prev.findIndex((w) => w === '-n' || w === '--namespace');
    return i >= 0 ? prev[i + 1] : cl.s.namespace;
  })();
  const fileCands = () => {
    const dirs = new Set<string>();
    for (const f of Object.keys(files)) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/');
    }
    return [...Object.keys(files), ...dirs];
  };
  if (prev.length === 0) return pick(TOP);
  const cmd = prev[0] === 'k' ? 'kubectl' : prev[0];
  const last = prev[prev.length - 1];
  if (['-f', '--filename', '-k', '--kustomize', 'cat', '--values', '--from-file'].includes(last) || (cmd === 'cat' && prev.length >= 1))
    return pick(fileCands(), false);
  if (last === '-n' || last === '--namespace') return pick(cl.list('Namespace').map((n) => n.metadata.name));
  if (cmd === 'helm') {
    if (prev.length === 1) return pick(HELM);
    if (['upgrade', 'install', 'template', 'lint'].includes(prev[1]) && prev.length >= 3)
      return pick(
        fileCands().map((f) => (f.startsWith('./') ? f : './' + f)),
        false,
      );
    if (['uninstall', 'rollback', 'history', 'status', 'upgrade', 'get'].includes(prev[1])) return pick(cl.s.helm.map((r) => r.name));
    return undefined;
  }
  if (cmd === 'kustomize')
    return pick(
      fileCands().filter((f) => f.endsWith('/')),
      false,
    );
  if (cmd !== 'kubectl') return undefined;
  if (prev.length === 1) return pick(VERBS);
  const verb = prev[1];
  const args = prev.slice(2).filter((w) => !w.startsWith('-'));
  if (verb === 'rollout') {
    if (args.length === 0) return pick(['status', 'history', 'undo', 'restart', 'pause', 'resume']);
    return pick([
      ...cl.list('Deployment', ns).map((o) => `deployment/${o.metadata.name}`),
      ...cl.list('StatefulSet', ns).map((o) => `statefulset/${o.metadata.name}`),
      ...cl.list('DaemonSet', ns).map((o) => `daemonset/${o.metadata.name}`),
    ]);
  }
  if (verb === 'set' && args.length === 0) return pick(['image', 'env', 'resources']);
  if (verb === 'top' && args.length === 0) return pick(['pods', 'nodes']);
  if (['logs', 'exec', 'port-forward', 'attach'].includes(verb) && args.length === 0) {
    return pick([
      ...cl.list('Pod', ns).map((p) => p.metadata.name),
      ...cl.list('Deployment', ns).map((d) => `deploy/${d.metadata.name}`),
      ...(verb === 'port-forward' ? cl.list('Service', ns).map((s) => `svc/${s.metadata.name}`) : []),
    ]);
  }
  if (['cordon', 'uncordon', 'drain'].includes(verb)) return pick(cl.list('Node').map((n) => n.metadata.name));
  if (verb === 'explain') return pick(RESOURCES.map((r) => r.singular));
  if (TYPE_VERBS.has(verb)) {
    if (args.length === 0) {
      if (cur.includes('/')) {
        const [t] = cur.split('/');
        const type = resolveResource(t);
        if (!type) return undefined;
        const names = cl.list(type.kind, type.namespaced ? ns : undefined).map((o) => `${t}/${o.metadata.name}`);
        return pick(names);
      }
      return pick(TYPES);
    }
    const type = resolveResource(args[0].split(',')[0]);
    if (type) return pick(cl.list(type.kind, type.namespaced ? ns : undefined).map((o) => o.metadata.name));
  }
  if (verb === 'apply' || verb === 'delete' || verb === 'create' || verb === 'diff') return pick(['-f ', '-k '], false);
  return undefined;
}
