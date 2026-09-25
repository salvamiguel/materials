import React, { useMemo, useState } from 'react';
import type { ChangeInfo, GraphInfo } from './engine';
import { layoutGraph, NODE_H } from './graphLayout';
import styles from '../shared/playground.module.css';

interface Props {
  graph?: GraphInfo;
  changes: ChangeInfo[];
  error?: string;
  zoom?: number;
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

export default function GraphView({ graph, changes, error, zoom = 1 }: Props) {
  const [onlyResources, setOnlyResources] = useState(false);
  const [hover, setHover] = useState<string>();
  const view = useMemo(() => {
    if (!graph) return undefined;
    const g = onlyResources ? collapse(graph, (k) => RESOURCE_KINDS.has(k)) : graph;
    return { g, ...layoutGraph(g) };
  }, [graph, onlyResources]);
  // Hovering a node highlights its edges and direct neighbours.
  const related = useMemo(() => {
    if (!hover || !view) return undefined;
    const ids = new Set([hover]);
    for (const e of view.edges) if (e.from === hover || e.to === hover) ids.add(e.from).add(e.to);
    return ids;
  }, [hover, view]);

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
        <span className={styles.graphHint}>Las flechas indican orden: el origen se evalúa antes que el destino. Pasa el ratón por un nodo para resaltar sus dependencias.</span>
      </div>
      <div className={styles.graphScroll}>
        <svg
          width={view.width * zoom}
          height={view.height * zoom}
          viewBox={`0 0 ${view.width} ${view.height}`}
          role="img"
          aria-label="Grafo de dependencias"
        >
          <defs>
            <marker id="tfplay-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.graphArrow} />
            </marker>
            <marker id="tfplay-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.graphArrowOn} />
            </marker>
          </defs>
          {view.edges.map((e, i) => {
            const on = hover !== undefined && (e.from === hover || e.to === hover);
            return (
              <path
                key={i}
                d={e.d}
                className={`${styles.graphEdge} ${on ? styles.graphEdgeOn : related ? styles.graphDim : ''}`}
                markerEnd={on ? 'url(#tfplay-arrow-on)' : 'url(#tfplay-arrow)'}
              />
            );
          })}
          {[...view.placed.values()].map((n) => {
            const action = actionFor(n.id, changes);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                className={related && !related.has(n.id) ? styles.graphDim : undefined}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(undefined)}
              >
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
