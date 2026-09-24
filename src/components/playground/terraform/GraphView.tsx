import React, { useMemo, useState } from 'react';
import type { ChangeInfo, GraphInfo } from './engine';
import styles from '../shared/playground.module.css';

interface Props {
  graph?: GraphInfo;
  changes: ChangeInfo[];
  error?: string;
}

const KIND_LABEL: Record<string, string> = {
  variable: 'variable',
  local: 'local',
  resource: 'recurso',
  data: 'data source',
  module: 'módulo',
  output: 'output',
  provider: 'proveedor',
};

const ACTION_LABEL: Record<string, string> = {
  create: 'crear',
  update: 'modificar',
  delete: 'destruir',
  'delete-create': 'reemplazar',
  'create-delete': 'reemplazar',
  read: 'leer',
};

const RESOURCE_KINDS = new Set(['resource', 'data', 'module']);

// Keeps only some kinds of nodes, connecting them through the removed ones.
function collapse(g: GraphInfo, keep: (kind: string) => boolean): GraphInfo {
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const deps = new Map<string, string[]>();
  for (const e of g.edges) deps.set(e.from, [...(deps.get(e.from) || []), e.to]);
  const edges: GraphInfo['edges'] = [];
  for (const n of g.nodes) {
    if (!keep(n.kind)) continue;
    const seen = new Set<string>();
    const stack = [...(deps.get(n.id) || [])];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      if (keep(kind.get(d) || '')) edges.push({ from: n.id, to: d });
      else stack.push(...(deps.get(d) || []));
    }
  }
  return { nodes: g.nodes.filter((n) => keep(n.kind)), edges };
}

interface Placed {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
}

const NODE_H = 30;
const ROW_GAP = 14;
const COL_GAP = 56;
const CHAR_W = 7.2;

function layout(g: GraphInfo) {
  const deps = new Map<string, string[]>();
  for (const n of g.nodes) deps.set(n.id, []);
  for (const e of g.edges) deps.get(e.from)?.push(e.to);
  const rank = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    let r = 0;
    for (const d of deps.get(id) || []) r = Math.max(r, visit(d, stack) + 1);
    stack.delete(id);
    rank.set(id, r);
    return r;
  };
  g.nodes.forEach((n) => visit(n.id, new Set()));
  const cols: string[][] = [];
  for (const n of g.nodes) {
    const r = rank.get(n.id)!;
    (cols[r] = cols[r] || []).push(n.id);
  }
  // Order each column by the average row of its dependencies (barycenter).
  const row = new Map<string, number>();
  cols.forEach((col, ci) => {
    if (ci === 0) col.sort();
    else {
      const score = (id: string) => {
        const ds = (deps.get(id) || []).map((d) => row.get(d) ?? 0);
        return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
      };
      col.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
    }
    col.forEach((id, i) => row.set(id, i));
  });
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const placed = new Map<string, Placed>();
  let x = 16;
  let height = 0;
  cols.forEach((col) => {
    const w = Math.max(...col.map((id) => id.length * CHAR_W + 24));
    col.forEach((id, i) => {
      const y = 16 + i * (NODE_H + ROW_GAP);
      placed.set(id, { id, kind: kind.get(id)!, x, y, w });
      height = Math.max(height, y + NODE_H + 16);
    });
    x += w + COL_GAP;
  });
  return { placed, width: x - COL_GAP + 16, height };
}

function actionFor(id: string, changes: ChangeInfo[]): string | undefined {
  let found: string | undefined;
  for (const c of changes) {
    const base = c.address.replace(/\[[^\]]*\]$/, '');
    if (c.address === id || base === id || c.address.startsWith(id + '.') || c.address.startsWith(id + '[')) {
      if (c.action === 'no-op') continue;
      if (!found || c.action !== 'read') found = c.action;
    }
  }
  return found;
}

export default function GraphView({ graph, changes, error }: Props) {
  const [onlyResources, setOnlyResources] = useState(false);
  const view = useMemo(() => {
    if (!graph) return undefined;
    const g = onlyResources ? collapse(graph, (k) => RESOURCE_KINDS.has(k)) : graph;
    return { g, ...layout(g) };
  }, [graph, onlyResources]);

  if (error) return <div className={styles.panelEmpty}>{error}</div>;
  if (!view || view.g.nodes.length === 0) {
    return <div className={styles.panelEmpty}>El grafo aparecerá cuando la configuración tenga recursos.</div>;
  }
  return (
    <div className={styles.graphWrap}>
      <div className={styles.graphToolbar}>
        <label>
          <input type="checkbox" checked={onlyResources} onChange={(e) => setOnlyResources(e.target.checked)} /> Solo
          recursos, data sources y módulos
        </label>
        <span className={styles.graphHint}>Las flechas indican orden: el origen se evalúa antes que el destino.</span>
      </div>
      <div className={styles.graphScroll}>
        <svg width={view.width} height={view.height} role="img" aria-label="Grafo de dependencias">
          <defs>
            <marker id="tfplay-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.graphArrow} />
            </marker>
          </defs>
          {view.g.edges.map((e, i) => {
            const a = view.placed.get(e.to);
            const b = view.placed.get(e.from);
            if (!a || !b) return null;
            const x1 = a.x + a.w;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x - 2;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                className={styles.graphEdge}
                markerEnd="url(#tfplay-arrow)"
              />
            );
          })}
          {[...view.placed.values()].map((n) => {
            const action = actionFor(n.id, changes);
            return (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <title>
                  {`${n.id} (${KIND_LABEL[n.kind] || n.kind})${action ? ` — ${ACTION_LABEL[action] || action}` : ''}`}
                </title>
                <rect
                  width={n.w}
                  height={NODE_H}
                  rx={6}
                  className={`${styles.graphNode} ${styles['gk_' + n.kind] || ''} ${action ? styles['ga_' + action.replace('-', '_')] : ''}`}
                />
                <text x={12} y={NODE_H / 2 + 4} className={styles.graphText}>
                  {n.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className={styles.graphLegend}>
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <span key={k}>
            <i className={`${styles.legendSwatch} ${styles['gk_' + k]}`} /> {label}
          </span>
        ))}
        <span>
          <i className={`${styles.legendSwatch} ${styles.ga_create}`} /> se creará
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.ga_update}`} /> se modificará
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.ga_delete_create}`} /> se reemplazará
        </span>
      </div>
    </div>
  );
}
