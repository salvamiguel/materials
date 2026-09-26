// Commands that keep running while the cluster changes: get -w, logs -f,
// rollout status, wait, port-forward. The UI polls them after every tick
// and Ctrl+C stops them.

import type { Cluster } from '../cluster';
import { podAvailable } from '../controllers/common';
import { deploymentReplicaSets, maxUnavailable } from '../controllers/deployment';
import type { LogLine, Obj } from '../types';
import type { PodShell } from '../podshell';
import { evalPath, printTable, tableFor } from './printers';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Poll {
  text: string;
  done?: boolean;
  exitCode?: number;
  /** Turn into an interactive shell in a container (kubectl run -it). */
  shell?: PodShell & { rm?: boolean };
}

export interface Stream {
  poll(cl: Cluster): Poll;
  /** Ctrl+C: returns what to print (usually "^C"). */
  stop(cl: Cluster): string;
  /** Runs in the background (`&`): the prompt comes back. */
  background?: boolean;
}

/** kubectl get -w: prints a row every time one changes. */
export function watchStream(
  cl: Cluster,
  kind: string,
  list: () => Obj[],
  opts: { wide?: boolean; allNamespaces?: boolean; withKind?: boolean; watchOnly?: boolean },
): { initial: string; stream: Stream } {
  const t = tableFor(cl, kind);
  // Rows printed later keep the columns of the first table (kubectl's printer does the same).
  const widths: number[] = [];
  const align = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const cells = line.split(/ {3,}/);
        return cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(Math.max(widths[i] || 0, c.length + 3)))).join('') + '\n';
      })
      .join('');
  const row = (o: Obj) => align(printTable(cl, kind, [o], { ...opts, noHeaders: true }));
  const seen = new Map<string, { row: string; obj: Obj }>();
  const objs = list();
  for (const o of objs) seen.set(o.metadata.uid, { row: row(o), obj: o });
  let initial = '';
  if (!opts.watchOnly) initial = objs.length ? printTable(cl, kind, objs, opts) : '';
  const header = printTable(cl, kind, objs, opts).split('\n')[0];
  const starts = [...header.matchAll(/\S+(?: \S+)*/g)].map((m) => m.index!);
  starts.forEach((s, i) => (widths[i] = (starts[i + 1] ?? s) - s));
  for (const o of objs) seen.set(o.metadata.uid, { row: row(o), obj: o });
  void t;
  return {
    initial,
    stream: {
      poll(c) {
        let text = '';
        const now = list();
        const ids = new Set<string>();
        for (const o of now) {
          ids.add(o.metadata.uid);
          // AGE changes every second: compare without it.
          const r = row(o);
          const prev = seen.get(o.metadata.uid);
          const strip = (s: string) => s.replace(/\s+\S+\s*$/, '');
          if (!prev || strip(prev.row) !== strip(r)) {
            if (!prev && !initial && !opts.watchOnly && seen.size === 0 && !text) text += printTable(c, kind, [o], opts).split('\n')[0] + '\n';
            text += r;
          }
          seen.set(o.metadata.uid, { row: r, obj: o });
        }
        for (const [uid, prev] of seen) {
          if (!ids.has(uid)) {
            text += prev.row;
            seen.delete(uid);
          }
        }
        return { text };
      },
      stop: () => '^C\n',
    },
  };
}

function logText(l: LogLine, timestamps: boolean, prefix: string) {
  return `${prefix}${timestamps ? new Date(l.t).toISOString().replace(/\.\d+Z$/, '.000000000Z') + ' ' : ''}${l.text}\n`;
}

/** kubectl logs -f */
export function logStream(cl: Cluster, pod: Obj, container: string, printed: number, opts: { timestamps: boolean; prefix: string }): Stream {
  let count = printed;
  const uid = pod.metadata.uid;
  const startRestarts = cl.s.pods[uid]?.containers[container]?.restarts ?? 0;
  return {
    poll(c) {
      const rt = c.s.pods[uid]?.containers[container];
      if (!rt || !c.get('Pod', pod.metadata.namespace, pod.metadata.name)) return { text: '', done: true, exitCode: 0 };
      if (rt.restarts !== startRestarts || rt.state === 'terminated') {
        const lines = (rt.state === 'terminated' ? rt.logs : rt.prevLogs).slice(count);
        return { text: lines.map((l) => logText(l, opts.timestamps, opts.prefix)).join(''), done: true, exitCode: 0 };
      }
      const lines = rt.logs.slice(count);
      count = rt.logs.length;
      return { text: lines.map((l) => logText(l, opts.timestamps, opts.prefix)).join('') };
    },
    stop: () => '^C\n',
  };
}

export function rolloutStatusOnce(cl: Cluster, o: Obj): { msg: string; done: boolean; error?: string } {
  if (o.kind === 'Deployment') {
    const d = o;
    const s = d.status || {};
    if (d.metadata.generation > (s.observedGeneration || 0)) return { msg: 'Waiting for deployment spec update to be observed...', done: false };
    const prog = (s.conditions || []).find((c: Json) => c.type === 'Progressing');
    if (prog?.reason === 'ProgressDeadlineExceeded')
      return { msg: '', done: true, error: `error: deployment "${d.metadata.name}" exceeded its progress deadline` };
    const want = d.spec.replicas ?? 1;
    const updated = s.updatedReplicas || 0;
    if (updated < want)
      return { msg: `Waiting for deployment "${d.metadata.name}" rollout to finish: ${updated} out of ${want} new replicas have been updated...`, done: false };
    if ((s.replicas || 0) > updated)
      return {
        msg: `Waiting for deployment "${d.metadata.name}" rollout to finish: ${(s.replicas || 0) - updated} old replicas are pending termination...`,
        done: false,
      };
    if ((s.availableReplicas || 0) < updated)
      return {
        msg: `Waiting for deployment "${d.metadata.name}" rollout to finish: ${s.availableReplicas || 0} of ${updated} updated replicas are available...`,
        done: false,
      };
    void maxUnavailable;
    void deploymentReplicaSets;
    return { msg: `deployment "${d.metadata.name}" successfully rolled out`, done: true };
  }
  if (o.kind === 'StatefulSet') {
    const s = o.status || {};
    const want = o.spec.replicas ?? 1;
    if ((s.observedGeneration || 0) < o.metadata.generation) return { msg: 'Waiting for statefulset spec update to be observed...', done: false };
    if ((s.readyReplicas || 0) < want) return { msg: `Waiting for ${want - (s.readyReplicas || 0)} pods to be ready...`, done: false };
    const partition = o.spec.updateStrategy?.rollingUpdate?.partition || 0;
    if (partition > 0) {
      if ((s.updatedReplicas || 0) < want - partition)
        return {
          msg: `Waiting for partitioned roll out to finish: ${s.updatedReplicas || 0} out of ${want - partition} new pods have been updated...`,
          done: false,
        };
      return { msg: `partitioned roll out complete: ${s.updatedReplicas || 0} new pods have been updated...`, done: true };
    }
    if (s.updateRevision !== s.currentRevision)
      return { msg: `waiting for statefulset rolling update to complete ${s.updatedReplicas || 0} pods at revision ${s.updateRevision}...`, done: false };
    return { msg: `statefulset rolling update complete ${s.currentReplicas || want} pods at revision ${s.currentRevision}...`, done: true };
  }
  if (o.kind === 'DaemonSet') {
    const s = o.status || {};
    if ((s.updatedNumberScheduled || 0) < (s.desiredNumberScheduled || 0))
      return {
        msg: `Waiting for daemon set "${o.metadata.name}" rollout to finish: ${s.updatedNumberScheduled || 0} out of ${s.desiredNumberScheduled} new pods have been updated...`,
        done: false,
      };
    if ((s.numberAvailable || 0) < (s.desiredNumberScheduled || 0))
      return {
        msg: `Waiting for daemon set "${o.metadata.name}" rollout to finish: ${s.numberAvailable || 0} of ${s.desiredNumberScheduled} updated pods are available...`,
        done: false,
      };
    return { msg: `daemon set "${o.metadata.name}" successfully rolled out`, done: true };
  }
  return { msg: '', done: true, error: `error: no status viewer has been implemented for ${o.kind}` };
}

export function rolloutStream(cl: Cluster, o: Obj, timeoutMs?: number): { first: string; stream?: Stream; exitCode: number } {
  const start = cl.now;
  const r = rolloutStatusOnce(cl, o);
  if (r.done) return { first: (r.error || r.msg) + '\n', exitCode: r.error ? 1 : 0 };
  let last = r.msg;
  return {
    first: r.msg + '\n',
    exitCode: 0,
    stream: {
      poll(c) {
        const cur = c.get(o.kind, o.metadata.namespace, o.metadata.name);
        if (!cur) return { text: `error: ${o.kind.toLowerCase()}s.apps "${o.metadata.name}" not found\n`, done: true, exitCode: 1 };
        const x = rolloutStatusOnce(c, cur);
        let text = '';
        if (x.error) return { text: x.error + '\n', done: true, exitCode: 1 };
        if (x.msg !== last) {
          text = x.msg + '\n';
          last = x.msg;
        }
        if (x.done) return { text, done: true, exitCode: 0 };
        if (timeoutMs !== undefined && c.now - start >= timeoutMs)
          return { text: text + 'error: timed out waiting for the condition\n', done: true, exitCode: 1 };
        return { text };
      },
      stop: () => '^C\n',
    },
  };
}

/** kubectl wait --for=condition=X / --for=delete / --for=jsonpath=… */
export function waitStream(
  cl: Cluster,
  targets: Obj[],
  forExpr: string,
  timeoutMs: number,
  name: (o: Obj) => string,
): { first: string; stream?: Stream; exitCode: number } {
  const start = cl.now;
  const done = new Set<string>();
  const check = (c: Cluster): string => {
    let text = '';
    for (const t of targets) {
      if (done.has(t.metadata.uid)) continue;
      const cur = c.get(t.kind, t.metadata.namespace, t.metadata.name);
      let ok = false;
      if (forExpr === 'delete') ok = !cur || cur.metadata.uid !== t.metadata.uid;
      else if (cur && forExpr.startsWith('condition=')) {
        const [cond, want = 'true'] = forExpr.slice(10).split('=');
        const cc = (cur.status?.conditions || []).find((x: Json) => x.type.toLowerCase() === cond.toLowerCase());
        ok = !!cc && cc.status.toLowerCase() === want.toLowerCase();
        if (cur.kind === 'Pod' && cond.toLowerCase() === 'ready') ok = ok && podAvailable(c, cur);
      } else if (cur && forExpr.startsWith('jsonpath=')) {
        const m = /^jsonpath=\{?([^}=]+)\}?(?:=(.*))?$/.exec(forExpr);
        if (m) {
          const vals = evalPath(cur, m[1].startsWith('.') ? m[1] : `.${m[1]}`);
          ok = m[2] === undefined ? vals.length > 0 : vals.some((v) => String(v) === m[2].replace(/^['"]|['"]$/g, ''));
        }
      }
      if (ok) {
        done.add(t.metadata.uid);
        text += `${name(t)} ${forExpr === 'delete' ? 'deleted' : 'condition met'}\n`;
      }
    }
    return text;
  };
  const first = check(cl);
  if (done.size === targets.length) return { first, exitCode: 0 };
  return {
    first,
    exitCode: 0,
    stream: {
      poll(c) {
        const text = check(c);
        if (done.size === targets.length) return { text, done: true, exitCode: 0 };
        if (c.now - start >= timeoutMs) {
          const left = targets.filter((t) => !done.has(t.metadata.uid));
          return { text: text + left.map((t) => `error: timed out waiting for the condition on ${name(t).split(' ')[0]}\n`).join(''), done: true, exitCode: 1 };
        }
        return { text };
      },
      stop: () => '^C\n',
    },
  };
}

export function portForwardStream(cl: Cluster, entries: { local: number; port: number }[], target: { kind: string; namespace: string; name: string }): Stream {
  return {
    poll(c) {
      if (!c.get(target.kind, target.namespace, target.name)) {
        c.s.portForwards = c.s.portForwards.filter((f) => !(f.kind === target.kind && f.name === target.name));
        return { text: `E0926 lost connection to pod\n`, done: true, exitCode: 1 };
      }
      return { text: '' };
    },
    stop(c) {
      c.s.portForwards = c.s.portForwards.filter((f) => !entries.some((e) => e.local === f.local));
      return '^C\n';
    },
  };
}
