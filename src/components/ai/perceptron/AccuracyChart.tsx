import React, { useState } from 'react';

import styles from './perceptron.module.css';

/* Accuracy over training: one line on the training set, one on examples the
 * machine never trains on. Hover shows both values at that point. */

export interface Point {
  seen: number;
  train: number;
  test: number;
}

const W = 460, H = 190;
const PAD = { l: 34, r: 44, t: 10, b: 22 };

export default function AccuracyChart({
  points,
  labels = { train: 'Entrenamiento', test: 'Prueba (no vistos)' },
  unit = 'ejemplos',
}: {
  points: Point[];
  /** Names of the two series. */
  labels?: { train: string; test: string };
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const maxX = Math.max(points.length ? points[points.length - 1].seen : 0, 200);
  const x = (s: number) => PAD.l + (s / maxX) * (W - PAD.l - PAD.r);
  const y = (a: number) => PAD.t + (1 - a) * (H - PAD.t - PAD.b);
  const line = (k: 'train' | 'test') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.seen).toFixed(1)} ${y(p[k]).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  const h = hover !== null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.seen) - sx) < Math.abs(x(points[best].seen) - sx)) best = i;
    });
    setHover(best);
  };

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartLegend}>
        <span>
          <i className={styles.swTrain} /> {labels.train}
        </span>
        <span>
          <i className={styles.swTest} /> {labels.test}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={last ? `Precisión: entrenamiento ${Math.round(last.train * 100)} %, prueba ${Math.round(last.test * 100)} %` : 'Sin entrenar todavía'}>
        {[0, 0.5, 1].map((a) => (
          <g key={a}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(a)} y2={y(a)} className={styles.grid} />
            <text x={PAD.l - 6} y={y(a) + 3} className={styles.axisY}>
              {a * 100}%
            </text>
          </g>
        ))}
        <text x={W - PAD.r} y={H - 6} className={styles.axisX}>
          {maxX} {unit}
        </text>
        {points.length > 0 && (
          <>
            <path d={line('test')} className={styles.lineTest} />
            <path d={line('train')} className={styles.lineTrain} />
            <text x={x(last.seen) + 5} y={y(last.train) + (last.train >= last.test ? -2 : 9)} className={styles.direct}>
              {Math.round(last.train * 100)}%
            </text>
            <text x={x(last.seen) + 5} y={y(last.test) + (last.train >= last.test ? 9 : -2)} className={styles.direct}>
              {Math.round(last.test * 100)}%
            </text>
          </>
        )}
        {h && (
          <g>
            <line x1={x(h.seen)} x2={x(h.seen)} y1={PAD.t} y2={H - PAD.b} className={styles.crosshair} />
            <circle cx={x(h.seen)} cy={y(h.train)} r="4" className={styles.dotTrain} />
            <circle cx={x(h.seen)} cy={y(h.test)} r="4" className={styles.dotTest} />
          </g>
        )}
        {!points.length && (
          <text x={W / 2} y={H / 2} className={styles.empty}>
            Genera datos y pulsa ▶
          </text>
        )}
      </svg>
      {h && (
        <div className={styles.tooltip} style={{ left: `${(x(h.seen) / W) * 100}%` }}>
          <b>{h.seen} {unit}</b>
          <span>
            <i className={styles.swTrain} /> {Math.round(h.train * 100)} %
          </span>
          <span>
            <i className={styles.swTest} /> {Math.round(h.test * 100)} %
          </span>
        </div>
      )}
    </figure>
  );
}
