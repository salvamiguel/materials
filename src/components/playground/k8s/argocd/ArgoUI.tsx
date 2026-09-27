// The ArgoCD web UI served by the simulated argocd-server (shown in the
// Browser tab): login, application tiles, the resource tree of an app and
// the Sync, History and Rollback, App Diff, App Details and New App panels.
// Every action talks to the engine directly, like the real UI talks to the
// API server through argocd-server.

import React, { useMemo, useState } from 'react';
import {
  FaArrowAltCircleUp,
  FaBook,
  FaCheckCircle,
  FaCircleNotch,
  FaCog,
  FaFileMedical,
  FaGhost,
  FaHeart,
  FaHeartBroken,
  FaHistory,
  FaInfoCircle,
  FaLayerGroup,
  FaPauseCircle,
  FaPlus,
  FaQuestionCircle,
  FaRedo,
  FaSignOutAlt,
  FaSync,
  FaTimes,
  FaTrash,
  FaUserCircle,
} from 'react-icons/fa';
import { SiArgo } from 'react-icons/si';
import type { Cluster } from '../engine/cluster';
import type { Obj } from '../engine/types';
import { adminPassword, argo, ARGOCD_VERSION } from '../engine/argocd/install';
import { appKey, desiredDocs, RESOURCES_FINALIZER, requestRefresh, requestSync } from '../engine/argocd/controller';
import { appDiff } from '../engine/argocd/cli';
import { healthOf } from '../engine/argocd/health';
import { toYaml } from '../engine/kubectl/printers';
import { humanDuration } from '../engine/util';
import { ICON } from '../ClusterDiagram';
import s from './argo.module.css';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Props {
  cl: Cluster;
  /** Path of the URL (/applications, /applications/argocd/NAME, /login…). */
  path: string;
  onNavigate: (path: string) => void;
  /** The engine changed (re-render the playground). */
  onChange: () => void;
  iconBase: string;
  /** Repository URL suggested by + NEW APP (the playground's Git remote). */
  defaultRepo?: string;
}

const HEALTH_ICON: Record<string, [React.ComponentType<{ className?: string }>, string]> = {
  Healthy: [FaHeart, s.healthy],
  Progressing: [FaCircleNotch, s.progressing],
  Degraded: [FaHeartBroken, s.degraded],
  Suspended: [FaPauseCircle, s.suspended],
  Missing: [FaGhost, s.missing],
  Unknown: [FaQuestionCircle, s.unknown],
};

function HealthIcon({ status, label }: { status?: string; label?: boolean }) {
  const [I, c] = HEALTH_ICON[status || 'Unknown'] || HEALTH_ICON.Unknown;
  return (
    <span className={`${s.st} ${c}`} title={status}>
      <I className={status === 'Progressing' ? s.spin : undefined} />
      {label && <span>{status || 'Unknown'}</span>}
    </span>
  );
}

function SyncIcon({ status, label }: { status?: string; label?: boolean }) {
  const I = status === 'Synced' ? FaCheckCircle : status === 'OutOfSync' ? FaArrowAltCircleUp : FaQuestionCircle;
  const c = status === 'Synced' ? s.healthy : status === 'OutOfSync' ? s.missing : s.unknown;
  return (
    <span className={`${s.st} ${c}`} title={status}>
      <I />
      {label && <span>{status || 'Unknown'}</span>}
    </span>
  );
}

const src = (app: Obj): Json => app.spec?.source || app.spec?.sources?.[0] || {};
const ago = (cl: Cluster, ts?: string) => (ts ? `${humanDuration(Math.max(0, cl.now - Date.parse(ts)))} ago` : '');
const date = (ts?: string) => (ts ? new Date(ts).toUTCString().replace('GMT', 'UTC') : '');

// ── Tree of an application ────────────────────────────────────────────

interface TNode {
  id: string;
  kind: string;
  name: string;
  namespace?: string;
  obj?: Obj;
  health?: string;
  sync?: string;
  info?: string;
  children: TNode[];
  x: number;
  y: number;
}

const NODE_W = 230;
const NODE_H = 52;
const COL = 300;
const ROW = 64;

function buildTree(cl: Cluster, app: Obj): { root: TNode; nodes: TNode[]; width: number; height: number } {
  const kids = (o: Obj, depth: number): TNode[] => {
    if (depth > 4) return [];
    let list = cl.children(o).filter((c) => c.kind !== 'Endpoints' && c.kind !== 'Event');
    if (o.kind === 'Deployment') list = list.filter((rs) => (rs.spec.replicas || 0) > 0 || cl.children(rs, 'Pod').length);
    return list
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.metadata.name.localeCompare(b.metadata.name))
      .map((c) => {
        const h = healthOf(cl, c);
        return {
          id: c.metadata.uid,
          kind: c.kind,
          name: c.metadata.name,
          namespace: c.metadata.namespace,
          obj: c,
          health: h?.status,
          info:
            c.kind === 'Pod'
              ? `${c.status?.phase || ''}${c.status?.podIP ? ` · ${c.status.podIP}` : ''}`
              : c.kind === 'ReplicaSet'
                ? `rev:${c.metadata.annotations?.['deployment.kubernetes.io/revision'] || 1}`
                : undefined,
          children: kids(c, depth + 1),
          x: 0,
          y: 0,
        };
      });
  };
  const top: TNode[] = (app.status?.resources || []).map((r: Json) => {
    const live = cl.get(r.kind, r.namespace, r.name);
    return {
      id: live?.metadata.uid || `${r.kind}/${r.namespace}/${r.name}`,
      kind: r.kind,
      name: r.name,
      namespace: r.namespace,
      obj: live,
      health: r.health?.status || (live ? undefined : 'Missing'),
      sync: r.status,
      info: r.requiresPruning ? 'requires pruning' : undefined,
      children: live ? kids(live, 1) : [],
      x: 0,
      y: 0,
    };
  });
  const root: TNode = {
    id: 'app',
    kind: 'Application',
    name: app.metadata.name,
    obj: app,
    health: app.status?.health?.status,
    sync: app.status?.sync?.status,
    children: top,
    x: 0,
    y: 0,
  };
  const nodes: TNode[] = [];
  let row = 0;
  let maxDepth = 0;
  const place = (n: TNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    n.x = depth * COL;
    if (!n.children.length) n.y = row++ * ROW;
    else {
      const ys = n.children.map((c) => place(c, depth + 1));
      n.y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    nodes.push(n);
    return n.y;
  };
  place(root, 0);
  return { root, nodes, width: maxDepth * COL + NODE_W + 20, height: Math.max(1, row) * ROW };
}

function Tree({ cl, app, iconBase, onPick }: { cl: Cluster; app: Obj; iconBase: string; onPick: (n: TNode) => void }) {
  const t = buildTree(cl, app);
  const edges: string[] = [];
  const walk = (n: TNode) => {
    for (const c of n.children) {
      const x1 = n.x + NODE_W;
      const y1 = n.y + NODE_H / 2;
      const x2 = c.x;
      const y2 = c.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      edges.push(`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      walk(c);
    }
  };
  walk(t.root);
  return (
    <div className={s.treeWrap}>
      <div className={s.tree} style={{ width: t.width, height: t.height }}>
        <svg width={t.width} height={t.height} className={s.treeEdges} aria-hidden>
          {edges.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
        {t.nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`${s.tnode} ${n.kind === 'Application' ? s.tnodeApp : ''} ${!n.obj ? s.tnodeGhost : ''}`}
            style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
            onClick={() => onPick(n)}
            title={`${n.kind}/${n.name}`}
          >
            <span className={s.tnodeIcon}>{n.kind === 'Application' ? <SiArgo /> : <img src={`${iconBase}${ICON[n.kind] || 'pod'}.svg`} alt="" />}</span>
            <span className={s.tnodeText}>
              <span className={s.tnodeName}>{n.name}</span>
              <span className={s.tnodeKind}>
                {n.kind === 'Application' ? 'application' : n.kind.toLowerCase()}
                {n.info && <em> · {n.info}</em>}
              </span>
            </span>
            <span className={s.tnodeStatus}>
              {n.health && <HealthIcon status={n.health} />}
              {n.sync && <SyncIcon status={n.sync} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Side panels ───────────────────────────────────────────────────────

function Panel({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={s.panelBack} onClick={onClose}>
      <div className={s.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className={s.panelHead}>
          {actions}
          <button type="button" className={s.close} onClick={onClose} aria-label="Cerrar">
            <FaTimes />
          </button>
        </div>
        <h3 className={s.panelTitle}>{title}</h3>
        <div className={s.panelBody}>{children}</div>
      </div>
    </div>
  );
}

function DiffText({ text }: { text: string }) {
  return (
    <pre className={s.diff}>
      {text.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') ? s.add : l.startsWith('-') || l.startsWith('<') ? s.del : l.startsWith('@@') ? s.hunk : undefined}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}

function SyncPanel({ cl, app, onClose, onChange }: { cl: Cluster; app: Obj; onClose: () => void; onChange: () => void }) {
  const [prune, setPrune] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [revision, setRevision] = useState(src(app).targetRevision || 'HEAD');
  const res: Json[] = app.status?.resources || [];
  const sync = () => {
    requestSync(cl, app, { prune, dryRun, revision: revision && revision !== (src(app).targetRevision || 'HEAD') ? revision : undefined });
    onChange();
    onClose();
  };
  return (
    <Panel
      title={`Synchronizing application manifests from ${src(app).repoURL}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className={s.btnPrimary} onClick={sync} disabled={!!app.operation}>
            SYNCHRONIZE
          </button>
          <button type="button" className={s.btn} onClick={onClose}>
            CANCEL
          </button>
        </>
      }
    >
      <label className={s.field}>
        <span>Revision</span>
        <input value={revision} onChange={(e) => setRevision(e.target.value)} />
      </label>
      <div className={s.checks}>
        <label>
          <input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} /> PRUNE
        </label>
        <label>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> DRY RUN
        </label>
      </div>
      <h4 className={s.sub}>SYNCHRONIZE RESOURCES:</h4>
      <ul className={s.resList}>
        {res.map((r) => (
          <li key={`${r.kind}/${r.namespace}/${r.name}`}>
            <input type="checkbox" checked readOnly /> {r.group ? `${r.group}/` : '/'}
            {r.kind}/{r.namespace ? `${r.namespace}/` : ''}
            {r.name}
            {r.status !== 'Synced' && <SyncIcon status={r.status} />}
            {r.requiresPruning && <em className={s.warn}> (requiere PRUNE para borrarse)</em>}
          </li>
        ))}
        {!res.length && <li>Todavía no hay recursos: el repo-server está leyendo Git…</li>}
      </ul>
    </Panel>
  );
}

function HistoryPanel({ cl, app, onClose, onChange }: { cl: Cluster; app: Obj; onClose: () => void; onChange: () => void }) {
  const hist: Json[] = [...(app.status?.history || [])].reverse();
  const current = app.status?.sync?.revision;
  const rollback = (h: Json) => {
    if (app.spec?.syncPolicy?.automated) {
      if (
        !window.confirm('Auto-Sync needs to be disabled in order for rollback to occur.\nAre you sure you want to disable auto-sync and rollback application?')
      )
        return;
      cl.mutate(app, (x) => delete x.spec.syncPolicy.automated);
    } else if (!window.confirm(`Are you sure you want to rollback application '${app.metadata.name}'?`)) return;
    const live = cl.get('Application', app.metadata.namespace, app.metadata.name);
    if (live) requestSync(cl, live, { revision: h.revision });
    onChange();
    onClose();
  };
  return (
    <Panel title="History and rollback" onClose={onClose}>
      {!hist.length && <p>Todavía no hay despliegues (se añade uno por cada sync con éxito).</p>}
      {hist.map((h, i) => (
        <div key={h.id} className={s.histItem}>
          <div className={s.histRow}>
            <div>
              <b>Revision:</b> {String(h.revision).slice(0, 7)}
              {h.revision === current && i === 0 && <span className={s.tag}>current</span>}
            </div>
            <div>
              <b>Deployed at:</b> {date(h.deployedAt)} ({ago(cl, h.deployedAt)})
            </div>
            <div>
              <b>Source:</b> {h.source?.repoURL} · {h.source?.path} · {h.source?.targetRevision || 'HEAD'}
            </div>
            <div>
              <b>Initiated by:</b> {h.initiatedBy?.automated ? 'automated sync policy' : h.initiatedBy?.username || 'admin'}
            </div>
          </div>
          {i > 0 && (
            <button type="button" className={s.btn} onClick={() => rollback(h)}>
              <FaHistory /> Rollback
            </button>
          )}
        </div>
      ))}
    </Panel>
  );
}

function DiffPanel({ cl, app, onClose }: { cl: Cluster; app: Obj; onClose: () => void }) {
  const a = argo(cl)!;
  const m = a.manifests[appKey(app)];
  const diffs = useMemo(() => (m && !m.error ? appDiff(cl, app, m.docs) : []), [cl, app, m]);
  return (
    <Panel title="App diff" onClose={onClose}>
      {!m && <p>El repo-server todavía no ha renderizado los manifiestos.</p>}
      {m?.error && <p className={s.err}>{m.error}</p>}
      {m && !m.error && !diffs.length && <p>Sin diferencias: lo que hay en el clúster coincide con Git.</p>}
      {diffs.map((d) => (
        <div key={`${d.kind}/${d.namespace}/${d.name}`}>
          <h4 className={s.sub}>
            {d.group ? `${d.group}/` : '/'}
            {d.kind} {d.namespace ? `${d.namespace}/` : ''}
            {d.name}
          </h4>
          <DiffText text={d.text} />
        </div>
      ))}
    </Panel>
  );
}

function DetailsPanel({ cl, app, onClose, onChange }: { cl: Cluster; app: Obj; onClose: () => void; onChange: () => void }) {
  const auto = app.spec?.syncPolicy?.automated;
  const set = (fn: (x: Obj) => void) => {
    cl.mutate(app, (x) => {
      x.spec.syncPolicy ??= {};
      fn(x);
    });
    onChange();
  };
  const rows: [string, React.ReactNode][] = [
    ['APP NAME', app.metadata.name],
    ['PROJECT', app.spec?.project || 'default'],
    ['CREATED AT', `${date(app.metadata.creationTimestamp)} (${ago(cl, app.metadata.creationTimestamp)})`],
    ['REPO URL', src(app).repoURL],
    ['TARGET REVISION', src(app).targetRevision || 'HEAD'],
    ['PATH', src(app).path],
    ['CLUSTER', app.spec?.destination?.server || app.spec?.destination?.name],
    ['NAMESPACE', app.spec?.destination?.namespace],
    ['IMAGES', (app.status?.summary?.images || []).join(', ')],
    ['SYNC OPTIONS', (app.spec?.syncPolicy?.syncOptions || []).join(', ') || '-'],
  ];
  return (
    <Panel title="App details" onClose={onClose}>
      <dl className={s.kv}>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h4 className={s.sub}>SYNC POLICY</h4>
      <div className={s.checks}>
        {auto ? (
          <button type="button" className={s.btn} onClick={() => set((x) => delete x.spec.syncPolicy.automated)}>
            DISABLE AUTO-SYNC
          </button>
        ) : (
          <button type="button" className={s.btn} onClick={() => set((x) => (x.spec.syncPolicy.automated = {}))}>
            ENABLE AUTO-SYNC
          </button>
        )}
        {auto && (
          <>
            <label>
              <input type="checkbox" checked={!!auto.prune} onChange={(e) => set((x) => (x.spec.syncPolicy.automated.prune = e.target.checked))} /> PRUNE
              RESOURCES
            </label>
            <label>
              <input type="checkbox" checked={!!auto.selfHeal} onChange={(e) => set((x) => (x.spec.syncPolicy.automated.selfHeal = e.target.checked))} /> SELF
              HEAL
            </label>
          </>
        )}
      </div>
      <p className={s.note}>
        Ojo: cambiar la Application desde la UI no cambia el YAML de Git (argocd/…): la próxima vez que la apliques con kubectl volverá a ser como en el
        fichero.
      </p>
    </Panel>
  );
}

function NewAppPanel({ cl, onClose, onChange, defaults }: { cl: Cluster; onClose: () => void; onChange: () => void; defaults: { repo: string } }) {
  const a = argo(cl)!;
  const [f, setF] = useState({
    name: '',
    project: 'default',
    auto: false,
    prune: false,
    selfHeal: false,
    createNs: true,
    repo: defaults.repo,
    revision: 'HEAD',
    path: '',
    server: 'https://kubernetes.default.svc',
    ns: '',
  });
  const [err, setErr] = useState('');
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const create = () => {
    try {
      cl.create(
        {
          apiVersion: 'argoproj.io/v1alpha1',
          kind: 'Application',
          metadata: { name: f.name, namespace: a.namespace },
          spec: {
            project: f.project,
            source: { repoURL: f.repo, targetRevision: f.revision, path: f.path },
            destination: { server: f.server, namespace: f.ns },
            syncPolicy: {
              ...(f.auto ? { automated: { prune: f.prune, selfHeal: f.selfHeal } } : {}),
              ...(f.createNs ? { syncOptions: ['CreateNamespace=true'] } : {}),
            },
          },
        },
        a.namespace,
      );
      onChange();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const field = (label: string, k: keyof typeof f, placeholder = '') => (
    <label className={s.field}>
      <span>{label}</span>
      <input value={String(f[k])} onChange={upd(k)} placeholder={placeholder} />
    </label>
  );
  return (
    <Panel
      title="New application"
      onClose={onClose}
      actions={
        <>
          <button type="button" className={s.btnPrimary} onClick={create} disabled={!f.name || !f.repo || !f.ns}>
            CREATE
          </button>
          <button type="button" className={s.btn} onClick={onClose}>
            CANCEL
          </button>
        </>
      }
    >
      {err && <p className={s.err}>Unable to create application: {err}</p>}
      <h4 className={s.sub}>GENERAL</h4>
      {field('Application Name', 'name', 'status-dev')}
      {field('Project Name', 'project')}
      <label className={s.field}>
        <span>Sync Policy</span>
        <select value={f.auto ? 'auto' : 'manual'} onChange={(e) => setF({ ...f, auto: e.target.value === 'auto' })}>
          <option value="manual">Manual</option>
          <option value="auto">Automatic</option>
        </select>
      </label>
      <div className={s.checks}>
        {f.auto && (
          <>
            <label>
              <input type="checkbox" checked={f.prune} onChange={upd('prune')} /> PRUNE RESOURCES
            </label>
            <label>
              <input type="checkbox" checked={f.selfHeal} onChange={upd('selfHeal')} /> SELF HEAL
            </label>
          </>
        )}
        <label>
          <input type="checkbox" checked={f.createNs} onChange={upd('createNs')} /> AUTO-CREATE NAMESPACE
        </label>
      </div>
      <h4 className={s.sub}>SOURCE</h4>
      {field('Repository URL', 'repo')}
      {field('Revision', 'revision')}
      {field('Path', 'path', 'k8s/overlays/dev')}
      <h4 className={s.sub}>DESTINATION</h4>
      {field('Cluster URL', 'server')}
      {field('Namespace', 'ns', 'status-dev')}
    </Panel>
  );
}

function ResourcePanel({ cl, app, node, onClose }: { cl: Cluster; app: Obj; node: TNode; onClose: () => void }) {
  const [tab, setTab] = useState<'summary' | 'live' | 'desired' | 'diff' | 'events' | 'logs'>('summary');
  const a = argo(cl)!;
  const m = a.manifests[appKey(app)];
  const o = node.obj;
  const desired = m && !m.error ? desiredDocs(app, m.docs).find((d) => d.obj.kind === node.kind && d.obj.metadata.name === node.name) : undefined;
  const diff = node.kind !== 'Application' && m && !m.error ? appDiff(cl, app, m.docs).find((d) => d.kind === node.kind && d.name === node.name) : undefined;
  const events = o ? cl.eventsFor(o) : [];
  const logs = o?.kind === 'Pod' ? Object.values(cl.s.pods[o.metadata.uid]?.containers || {}).flatMap((c) => c.logs.slice(-60).map((l) => l.text)) : [];
  const tabs: [typeof tab, string][] = [
    ['summary', 'SUMMARY'],
    ['live', 'LIVE MANIFEST'],
    ...(node.kind !== 'Application'
      ? ([
          ['desired', 'DESIRED MANIFEST'],
          ['diff', 'DIFF'],
        ] as [typeof tab, string][])
      : []),
    ['events', 'EVENTS'],
    ...(o?.kind === 'Pod' ? ([['logs', 'LOGS']] as [typeof tab, string][]) : []),
  ];
  const clean = (x: Obj) => {
    const c = JSON.parse(JSON.stringify(x));
    delete c.metadata.managedFields;
    return c;
  };
  return (
    <Panel title={`${node.kind.toLowerCase()} · ${node.name}`} onClose={onClose}>
      <div className={s.tabs}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? s.tabOn : undefined} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'summary' && (
        <dl className={s.kv}>
          <dt>KIND</dt>
          <dd>{node.kind}</dd>
          <dt>NAME</dt>
          <dd>{node.name}</dd>
          {node.namespace && (
            <>
              <dt>NAMESPACE</dt>
              <dd>{node.namespace}</dd>
            </>
          )}
          {o && (
            <>
              <dt>CREATED AT</dt>
              <dd>
                {date(o.metadata.creationTimestamp)} ({ago(cl, o.metadata.creationTimestamp)})
              </dd>
            </>
          )}
          {node.health && (
            <>
              <dt>HEALTH</dt>
              <dd>
                <HealthIcon status={node.health} label />
              </dd>
            </>
          )}
          {node.sync && (
            <>
              <dt>STATUS</dt>
              <dd>
                <SyncIcon status={node.sync} label />
              </dd>
            </>
          )}
          {o?.spec?.template?.spec?.containers && (
            <>
              <dt>IMAGES</dt>
              <dd>{o.spec.template.spec.containers.map((c: Json) => c.image).join(', ')}</dd>
            </>
          )}
          {o?.kind === 'Pod' && (
            <>
              <dt>NODE</dt>
              <dd>{o.spec.nodeName}</dd>
            </>
          )}
        </dl>
      )}
      {tab === 'live' && <pre className={s.code}>{o ? toYaml(clean(o)) : 'Resource not found in cluster'}</pre>}
      {tab === 'desired' && <pre className={s.code}>{desired ? toYaml(desired.obj) : 'Este recurso no está en Git (sobra)'}</pre>}
      {tab === 'diff' && (diff ? <DiffText text={diff.text} /> : <p>Sin diferencias.</p>)}
      {tab === 'events' &&
        (events.length ? (
          <table className={s.table}>
            <thead>
              <tr>
                <th>REASON</th>
                <th>MESSAGE</th>
                <th>COUNT</th>
                <th>LAST SEEN</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(-30).map((e, i) => (
                <tr key={i}>
                  <td>{e.reason}</td>
                  <td>{e.message}</td>
                  <td>{e.count}</td>
                  <td>{humanDuration(Math.max(0, cl.now - e.last))} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No events</p>
        ))}
      {tab === 'logs' && <pre className={s.code}>{logs.join('\n') || '(sin logs)'}</pre>}
    </Panel>
  );
}

// ── Pages ─────────────────────────────────────────────────────────────

function Login({ cl, onChange }: { cl: Cluster; onChange: () => void }) {
  const [user, setUser] = useState('admin');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (user === 'admin' && pw && pw === adminPassword(cl)) {
      argo(cl)!.ui = { user };
      cl.s.rv++;
      onChange();
    } else setErr('Invalid username or password');
  };
  return (
    <div className={s.login}>
      <div className={s.loginBox}>
        <div className={s.loginLogo}>
          <SiArgo />
          <div>
            <b>Let&apos;s get stuff deployed!</b>
          </div>
        </div>
        <form onSubmit={submit}>
          <label className={s.field}>
            <span>Username</span>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
          </label>
          <label className={s.field}>
            <span>Password</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
          </label>
          {err && <p className={s.err}>{err}</p>}
          <button type="submit" className={s.btnPrimary}>
            SIGN IN
          </button>
        </form>
        <p className={s.note}>
          Usuario <code>admin</code>. La contraseña: <code>argocd admin initial-password -n argocd</code> o{' '}
          <code>kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath=&quot;{'{.data.password}'}&quot; | base64 -d</code>
        </p>
      </div>
    </div>
  );
}

function AppTile({ cl, app, onOpen, onChange }: { cl: Cluster; app: Obj; onOpen: () => void; onChange: () => void }) {
  const h = app.status?.health?.status;
  const sy = app.status?.sync?.status;
  return (
    <div className={`${s.tile} ${s['tile_' + (h || 'Unknown')]}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className={s.tileHead}>
        <SiArgo className={s.tileIcon} />
        <b>{app.metadata.name}</b>
      </div>
      <dl className={s.tileRows}>
        <dt>Project:</dt>
        <dd>{app.spec?.project || 'default'}</dd>
        <dt>Labels:</dt>
        <dd>
          {Object.entries(app.metadata.labels || {})
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}
        </dd>
        <dt>Status:</dt>
        <dd>
          <HealthIcon status={h} label /> <SyncIcon status={sy} label />
        </dd>
        <dt>Repository:</dt>
        <dd className={s.ellipsis}>{src(app).repoURL}</dd>
        <dt>Target Revision:</dt>
        <dd>{src(app).targetRevision || 'HEAD'}</dd>
        <dt>Path:</dt>
        <dd>{src(app).path}</dd>
        <dt>Destination:</dt>
        <dd>
          {app.spec?.destination?.name || (app.spec?.destination?.server === 'https://kubernetes.default.svc' ? 'in-cluster' : app.spec?.destination?.server)}
        </dd>
        <dt>Namespace:</dt>
        <dd>{app.spec?.destination?.namespace}</dd>
        <dt>Created At:</dt>
        <dd>{date(app.metadata.creationTimestamp)}</dd>
        <dt>Last Sync:</dt>
        <dd>{app.status?.operationState?.finishedAt ? date(app.status.operationState.finishedAt) : ''}</dd>
      </dl>
      <div className={s.tileActions} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={s.btn}
          onClick={() => {
            requestSync(cl, app);
            onChange();
          }}
        >
          <FaSync /> SYNC
        </button>
        <button
          type="button"
          className={s.btn}
          onClick={() => {
            requestRefresh(cl, app);
            onChange();
          }}
        >
          <FaRedo /> REFRESH
        </button>
        <button type="button" className={s.btn} onClick={() => deleteApp(cl, app, onChange)}>
          <FaTrash /> DELETE
        </button>
      </div>
    </div>
  );
}

function deleteApp(cl: Cluster, app: Obj, onChange: () => void) {
  const answer = window.prompt(
    `Are you sure you want to delete the application '${app.metadata.name}'?\nEscribe su nombre para confirmar. Se borrarán también sus recursos (Foreground).`,
  );
  if (answer !== app.metadata.name) return;
  cl.mutate(app, (x) => (x.metadata.finalizers = [...new Set([...(x.metadata.finalizers || []), RESOURCES_FINALIZER])]));
  cl.deleteObject(app);
  onChange();
}

function AppDetails({
  cl,
  app,
  iconBase,
  onNavigate,
  onChange,
}: {
  cl: Cluster;
  app: Obj;
  iconBase: string;
  onNavigate: (p: string) => void;
  onChange: () => void;
}) {
  const [panel, setPanel] = useState<'sync' | 'history' | 'diff' | 'details' | null>(null);
  const [node, setNode] = useState<TNode | null>(null);
  const a = argo(cl)!;
  const m = a.manifests[appKey(app)];
  const op = app.status?.operationState;
  const running = !!app.operation;
  const live = (n: TNode) => (n.obj ? cl.byUid(n.obj.metadata.uid) || n.obj : n.obj);
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <div className={s.crumbs}>
          <button type="button" className={s.link} onClick={() => onNavigate('/applications')}>
            Applications
          </button>{' '}
          / <b>{app.metadata.name}</b>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={() => setPanel('details')}>
            <FaInfoCircle /> DETAILS
          </button>
          <button type="button" className={s.btn} onClick={() => setPanel('diff')}>
            <FaFileMedical /> DIFF
          </button>
          <button type="button" className={s.btn} onClick={() => setPanel('sync')}>
            <FaSync /> SYNC
          </button>
          <button type="button" className={s.btn} onClick={() => setPanel('history')}>
            <FaHistory /> HISTORY AND ROLLBACK
          </button>
          <button type="button" className={s.btn} onClick={() => deleteApp(cl, app, () => (onChange(), onNavigate('/applications')))}>
            <FaTrash /> DELETE
          </button>
          <button
            type="button"
            className={s.btn}
            onClick={() => {
              requestRefresh(cl, app);
              onChange();
            }}
            title="Vuelve a leer Git"
          >
            <FaRedo /> REFRESH
          </button>
        </div>
      </div>
      <div className={s.statusBar}>
        <div className={s.statusBox}>
          <span className={s.statusLabel}>APP HEALTH</span>
          <HealthIcon status={app.status?.health?.status} label />
          {app.status?.health?.message && <small>{app.status.health.message}</small>}
        </div>
        <div className={s.statusBox}>
          <span className={s.statusLabel}>SYNC STATUS</span>
          <span>
            <SyncIcon status={app.status?.sync?.status} label />{' '}
            {app.status?.sync?.revision ? `to ${src(app).targetRevision || 'HEAD'} (${String(app.status.sync.revision).slice(0, 7)})` : ''}
          </span>
          <small>
            {app.spec?.syncPolicy?.automated
              ? `Auto sync is enabled.${app.spec.syncPolicy.automated.selfHeal ? ' Self heal.' : ''}${app.spec.syncPolicy.automated.prune ? ' Prune.' : ''}`
              : 'Auto sync is not enabled.'}
          </small>
          {m?.message && (
            <small>
              Commit: {String(m.revision).slice(0, 7)} · {m.message}
            </small>
          )}
        </div>
        <div className={s.statusBox}>
          <span className={s.statusLabel}>LAST SYNC</span>
          {running ? (
            <span className={s.progressing}>
              <FaCircleNotch className={s.spin} /> Syncing
            </span>
          ) : op ? (
            <span className={op.phase === 'Succeeded' ? s.healthy : s.degraded}>
              {op.phase === 'Succeeded' ? <FaCheckCircle /> : <FaHeartBroken />} Sync {op.phase === 'Succeeded' ? 'OK' : 'failed'} to{' '}
              {String(op.syncResult?.revision || '').slice(0, 7)}
            </span>
          ) : (
            <span>—</span>
          )}
          {op && (
            <small>
              {ago(cl, op.finishedAt)} · {op.message}
            </small>
          )}
        </div>
      </div>
      {(app.status?.conditions || []).map((c: Json, i: number) => (
        <div key={i} className={s.condition}>
          <b>{c.type}</b>: {c.message}
        </div>
      ))}
      {m === undefined && <div className={s.condition}>El repo-server está leyendo Git…</div>}
      <Tree cl={cl} app={app} iconBase={iconBase} onPick={(n) => setNode({ ...n, obj: live(n) })} />
      {panel === 'sync' && <SyncPanel cl={cl} app={app} onClose={() => setPanel(null)} onChange={onChange} />}
      {panel === 'history' && <HistoryPanel cl={cl} app={app} onClose={() => setPanel(null)} onChange={onChange} />}
      {panel === 'diff' && <DiffPanel cl={cl} app={app} onClose={() => setPanel(null)} />}
      {panel === 'details' && <DetailsPanel cl={cl} app={app} onClose={() => setPanel(null)} onChange={onChange} />}
      {node && <ResourcePanel cl={cl} app={app} node={node} onClose={() => setNode(null)} />}
    </div>
  );
}

export default function ArgoUI({ cl, path, onNavigate, onChange, iconBase, defaultRepo }: Props) {
  const a = argo(cl);
  const [newApp, setNewApp] = useState(false);
  if (!a) return <div className={s.root}>argocd-server no está instalado</div>;
  const loggedIn = !!a.ui;
  const apps = cl.list('Application', a.namespace);
  const m = /^\/applications\/(?:([^/]+)\/)?([^/?#]+)/.exec(path);
  const app = m ? cl.get('Application', m[1] || a.namespace, m[2]) : undefined;
  const logout = () => {
    delete a.ui;
    cl.s.rv++;
    onChange();
  };
  return (
    <div className={s.root}>
      <nav className={s.nav}>
        <div className={s.navLogo}>
          <SiArgo />
          <small>{ARGOCD_VERSION}</small>
        </div>
        {loggedIn && (
          <>
            <button type="button" className={s.navItem} onClick={() => onNavigate('/applications')} title="Applications">
              <FaLayerGroup />
              <span>Applications</span>
            </button>
            <button type="button" className={s.navItem} title="Settings (no disponible en el playground)" disabled>
              <FaCog />
              <span>Settings</span>
            </button>
            <button type="button" className={s.navItem} title="User Info" disabled>
              <FaUserCircle />
              <span>User Info</span>
            </button>
            <a className={s.navItem} href="https://argo-cd.readthedocs.io/en/stable/" target="_blank" rel="noreferrer">
              <FaBook />
              <span>Documentation</span>
            </a>
            <button type="button" className={s.navItem} onClick={logout} title="Log out">
              <FaSignOutAlt />
              <span>Log out</span>
            </button>
          </>
        )}
      </nav>
      <main className={s.main}>
        {!loggedIn ? (
          <Login cl={cl} onChange={onChange} />
        ) : app ? (
          <AppDetails key={app.metadata.uid} cl={cl} app={app} iconBase={iconBase} onNavigate={onNavigate} onChange={onChange} />
        ) : (
          <div className={s.page}>
            <div className={s.toolbar}>
              <div className={s.crumbs}>
                <b>Applications</b>
                {m && <span className={s.err}> · application &quot;{m[2]}&quot; not found</span>}
              </div>
              <div className={s.actions}>
                <button type="button" className={s.btnPrimary} onClick={() => setNewApp(true)}>
                  <FaPlus /> NEW APP
                </button>
                <button
                  type="button"
                  className={s.btn}
                  onClick={() => {
                    for (const x of apps) requestRefresh(cl, x);
                    onChange();
                  }}
                >
                  <FaRedo /> REFRESH APPS
                </button>
              </div>
            </div>
            {!apps.length && (
              <div className={s.empty}>
                <SiArgo className={s.emptyIcon} />
                <h3>No applications available to you just yet</h3>
                <p>
                  Crea una con <b>+ NEW APP</b>, con <code>kubectl apply -f argocd/</code> o con <code>argocd app create</code>.
                </p>
              </div>
            )}
            <div className={s.tiles}>
              {apps.map((x) => (
                <AppTile
                  key={x.metadata.uid}
                  cl={cl}
                  app={x}
                  onOpen={() => onNavigate(`/applications/${x.metadata.namespace}/${x.metadata.name}`)}
                  onChange={onChange}
                />
              ))}
            </div>
            {newApp && (
              <NewAppPanel
                cl={cl}
                onClose={() => setNewApp(false)}
                onChange={onChange}
                defaults={{ repo: defaultRepo || (apps[0] ? src(apps[0]).repoURL : '') }}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
