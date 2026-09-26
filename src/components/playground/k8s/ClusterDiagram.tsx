import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TbZoomIn, TbZoomOut, TbArrowsMaximize } from 'react-icons/tb';
import type { Diagram, DNode, Lane } from './diagramModel';
import type { Info } from './info';
import styles from './k8s.module.css';

export const ICON: Record<string, string> = {
  Pod: 'pod',
  Deployment: 'deploy',
  ReplicaSet: 'rs',
  StatefulSet: 'sts',
  DaemonSet: 'ds',
  Job: 'job',
  CronJob: 'cronjob',
  Service: 'svc',
  Endpoints: 'ep',
  Ingress: 'ing',
  ConfigMap: 'cm',
  Secret: 'secret',
  Namespace: 'ns',
  PersistentVolume: 'pv',
  PersistentVolumeClaim: 'pvc',
  StorageClass: 'sc',
  ServiceAccount: 'sa',
  HorizontalPodAutoscaler: 'hpa',
  Node: 'node',
};

const KIND_SHORT: Record<string, string> = {
  HorizontalPodAutoscaler: 'HPA',
  PersistentVolumeClaim: 'PVC',
  PersistentVolume: 'PV',
};

interface Props {
  diagram: Diagram;
  iconBase: string;
  selected?: string;
  onSelect: (uid: string | undefined) => void;
  onContextMenu: (uid: string, x: number, y: number, target: 'object' | 'node') => void;
  info: (uid: string) => Info | undefined;
  onOpenSource: (uid: string) => void;
  empty?: React.ReactNode;
}

function shortName(n: DNode) {
  return n.name;
}

export default function ClusterDiagram({ diagram, iconBase, selected, onSelect, onContextMenu, info, onOpenSource, empty }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | undefined>();
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [avail, setAvail] = useState(800);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const s = fit ? Math.max(0.8, Math.min(1, (avail - 24) / Math.max(1, diagram.width))) : scale;
  const byId = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);

  // Neighbours of the focused node (hover wins over selection).
  const focus = hover || selected;
  const related = useMemo(() => {
    if (!focus) return undefined;
    // The focused object, its whole ownership chain (Deployment → ReplicaSet →
    // Pods) and what those use or route to them, one hop away.
    const chain = new Set<string>([focus]);
    const ancestors = new Set<string>();
    const isAncestor = (id: string) => ancestors.has(id);
    const stack = [focus];
    while (stack.length) {
      const id = stack.pop()!;
      for (const e of diagram.edges) {
        if (e.kind !== 'owner') continue;
        const other = e.from === id ? e.to : e.to === id ? e.from : undefined;
        if (other && !chain.has(other)) {
          // Down from the focus, and up from it: not sideways into siblings.
          if (e.from === id && (id === focus || !isAncestor(id))) {
            chain.add(other);
            stack.push(other);
          } else if (e.to === id && (id === focus || isAncestor(id))) {
            chain.add(other);
            stack.push(other);
            ancestors.add(other);
          }
        }
      }
    }
    const set = new Set(chain);
    for (const e of diagram.edges) {
      if (e.kind === 'owner') continue;
      if (chain.has(e.from)) set.add(e.to);
      if (chain.has(e.to)) set.add(e.from);
    }
    return set;
  }, [focus, diagram.edges]);

  useEffect(() => {
    if (selected && !byId.has(selected)) onSelect(undefined);
  }, [selected, byId, onSelect]);

  const tipFor = hover && hover !== selected ? hover : undefined;
  const tipNode = tipFor ? byId.get(tipFor) : undefined;
  const pinNode = selected ? byId.get(selected) : undefined;

  const zoomBy = (d: number) => {
    setFit(false);
    setScale(Math.max(0.4, Math.min(1.6, +(s + d).toFixed(2))));
  };

  const laneFor = (l: Lane) => (
    <g key={l.id} className={styles.lane} data-kind={l.kind} data-health={l.health}>
      <rect x={l.x + 1} y={l.y + 1} width={l.w - 2} height={l.h - 2} rx={12} />
      <image href={`${iconBase}${l.kind === 'Node' ? 'node' : 'ns'}.svg`} x={l.x + 10} y={l.y + 6} width={18} height={18} />
      <text x={l.x + 34} y={l.y + 20} className={styles.laneLabel}>
        {l.kind === 'Namespace' ? `namespace: ${l.label}` : l.label}
        {l.status && <tspan className={styles.laneStatus}>{`  ${l.status}`}</tspan>}
      </text>
      {l.empty && (
        <text x={l.x + 34} y={l.y + (l.kind === 'Node' ? 50 : 50)} className={styles.laneEmpty}>
          {l.kind === 'Node' ? 'sin pods (marca «sistema» para ver los del clúster)' : 'vacío: aplica un manifiesto (kubectl apply -f …)'}
        </text>
      )}
    </g>
  );

  return (
    <div className={styles.diagramRoot}>
      <div className={styles.diagramWrap} ref={wrapRef} onClick={() => onSelect(undefined)}>
        <div className={styles.diagramZoom} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoomBy(-0.1)} title="Alejar" aria-label="Alejar">
            <TbZoomOut aria-hidden />
          </button>
          <button type="button" className={fit ? styles.on : undefined} onClick={() => setFit(true)} title="Ajustar al ancho" aria-label="Ajustar al ancho">
            <TbArrowsMaximize aria-hidden />
          </button>
          <button type="button" onClick={() => zoomBy(0.1)} title="Acercar" aria-label="Acercar">
            <TbZoomIn aria-hidden />
          </button>
        </div>
        {!diagram.nodes.length && empty}
        <div className={styles.canvas} style={{ width: diagram.width * s, height: diagram.height * s }}>
          <div className={styles.canvasInner} style={{ width: diagram.width, height: diagram.height, transform: `scale(${s})` }}>
            <svg className={styles.edges} width={diagram.width} height={diagram.height} aria-hidden>
              {diagram.lanes.map(laneFor)}
              {diagram.lanes
                .filter((l) => l.kind === 'Node')
                .map((l) => (
                  <rect
                    key={`hit-${l.id}`}
                    x={l.x}
                    y={l.y}
                    width={l.w}
                    height={30}
                    className={styles.laneHit}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContextMenu(l.id, e.clientX, e.clientY, 'node');
                    }}
                  />
                ))}
              {diagram.edges.map((e) => (
                <path
                  key={e.id}
                  d={e.d}
                  className={`${styles.edge} ${styles['edge_' + e.kind]} ${e.live ? styles.edgeLive : styles.edgeDead} ${related ? (related.has(e.from) && related.has(e.to) ? styles.edgeOn : styles.edgeDim) : ''}`}
                />
              ))}
            </svg>
            {diagram.nodes.map((n) => (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                aria-label={`${n.kind} ${n.name}: ${n.status}`}
                aria-pressed={selected === n.id}
                className={[
                  styles.card,
                  n.compact ? styles.cardPod : '',
                  styles['h_' + n.health],
                  n.faded ? styles.faded : '',
                  n.terminating ? styles.terminating : '',
                  selected === n.id ? styles.selected : '',
                  related && !related.has(n.id) ? styles.dim : '',
                ].join(' ')}
                style={{ translate: `${n.x}px ${n.y}px`, width: n.w, height: n.h }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? undefined : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(selected === n.id ? undefined : n.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onOpenSource(n.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(selected === n.id ? undefined : n.id);
                  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    e.preventDefault();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    onContextMenu(n.id, r.left + 20, r.bottom, 'object');
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(n.id, e.clientX, e.clientY, 'object');
                }}
              >
                <img src={`${iconBase}${ICON[n.kind] || 'pod'}.svg`} alt="" className={styles.icon} draggable={false} />
                <div className={styles.meta}>
                  {!n.compact && <span className={styles.kind}>{KIND_SHORT[n.kind] || n.kind}</span>}
                  <span className={styles.name} title={n.name}>
                    {shortName(n)}
                  </span>
                  <span className={styles.status}>
                    <i className={styles.dot} />
                    {n.status}
                  </span>
                </div>
                {n.badge && <span className={styles.badge}>{n.badge}</span>}
                {n.fault && (
                  <span className={styles.faultBadge} title="Fallo simulado">
                    ⚡
                  </span>
                )}
                {n.progress && (
                  <span className={styles.progress} title={`${n.progress.updated} de ${n.progress.desired} actualizados · ${n.progress.old} antiguos`}>
                    <i style={{ width: `${Math.min(100, (n.progress.updated / Math.max(1, n.progress.desired)) * 100)}%` }} />
                  </span>
                )}
              </div>
            ))}
            {tipNode && <Popup node={tipNode} info={info(tipNode.id)} width={diagram.width} />}
          </div>
        </div>
      </div>
      {pinNode && (
        <Popup
          node={pinNode}
          info={info(pinNode.id)}
          pinned
          onClose={() => onSelect(undefined)}
          onOpen={() => onOpenSource(pinNode.id)}
          width={diagram.width}
        />
      )}
    </div>
  );
}

function Popup({
  node,
  info,
  pinned,
  onClose,
  onOpen,
  width,
}: {
  node: DNode;
  info?: Info;
  pinned?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
  width: number;
}) {
  if (!info) return null;
  const right = node.x + node.w + 12 + 300 <= width;
  const style: React.CSSProperties | undefined = pinned
    ? undefined
    : right
      ? { left: node.x + node.w + 10, top: node.y }
      : { left: Math.max(4, node.x - 310), top: node.y };
  return (
    <div
      className={`${styles.popup} ${pinned ? styles.popupPinned : ''}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
      role={pinned ? 'dialog' : 'tooltip'}
    >
      <div className={styles.popupHead}>
        <span className={styles.popupKind}>{info.kind}</span>
        <strong>{info.name}</strong>
        {info.namespace && <span className={styles.popupNs}>{info.namespace}</span>}
        {pinned && (
          <button type="button" className={styles.popupClose} onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        )}
      </div>
      {info.fault && <div className={styles.popupFault}>⚡ Fallo simulado: {info.fault}</div>}
      <dl className={styles.popupRows}>
        {info.rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className={styles.popupFoot}>
        {info.source ? (
          pinned ? (
            <button type="button" className={styles.linkBtn} onClick={onOpen}>
              {info.source}
            </button>
          ) : (
            <span>Declarado en {info.source}</span>
          )
        ) : (
          <span>Creado por un controlador o desde la terminal</span>
        )}
        {!pinned && <span className={styles.popupHint}>clic: fijar · botón derecho: acciones</span>}
      </div>
    </div>
  );
}
