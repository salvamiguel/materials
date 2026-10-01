import React, { useEffect, useRef } from 'react';

import styles from './perceptron.module.css';

/* An analog panel meter. The needle is a damped spring chasing the reading,
 * so it swings, overshoots a little and settles, and it bangs against the end
 * stops when the sum leaves the scale. The red band is the firing zone: from
 * the threshold θ to the top of the scale. */

const HALF = 50; // degrees either side of vertical
const PIVOT = { x: 150, y: 172 };
const R = 136;

interface Props {
  value: number;
  theta: number;
  range: number;
  label?: string;
}

const pt = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [PIVOT.x + r * Math.cos(a), PIVOT.y + r * Math.sin(a)];
};
const angle = (v: number, range: number) => Math.max(-1, Math.min(1, v / range)) * HALF;

function band(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
}

export default function Voltmeter({ value, theta, range, label = 'Σ' }: Props) {
  const needle = useRef<SVGGElement>(null);
  const target = useRef(0);
  target.current = Math.max(-1.12, Math.min(1.12, value / range)) * HALF;

  useEffect(() => {
    let pos = target.current, vel = 0, last = performance.now(), raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Stiff spring, light damping: a quick swing with a small overshoot.
      const acc = 140 * (target.current - pos) - 13 * vel;
      vel += acc * dt;
      pos += vel * dt;
      const stop = HALF + 6;
      if (Math.abs(pos) > stop) {
        pos = Math.sign(pos) * stop;
        vel = -vel * 0.35;
      }
      needle.current?.setAttribute('transform', `rotate(${pos.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ticks = [];
  for (let i = -10; i <= 10; i++) {
    const a = (i / 10) * HALF;
    const major = i % 5 === 0;
    const [x0, y0] = pt(R - (major ? 14 : 8), a);
    const [x1, y1] = pt(R, a);
    ticks.push(<line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? styles.tickMajor : styles.tick} />);
    if (major) {
      const [tx, ty] = pt(R - 26, a);
      ticks.push(
        <text key={`t${i}`} x={tx} y={ty} className={styles.tickLabel}>
          {Math.round((i / 10) * range)}
        </text>,
      );
    }
  }
  const ta = angle(theta, range);
  const [mx, my] = pt(R + 3, ta);

  return (
    <div className={styles.meter}>
      <svg viewBox="0 0 300 200" role="img" aria-label={`${label} = ${value.toFixed(2)}, umbral ${theta.toFixed(2)}`}>
        <defs>
          <linearGradient id="pk-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7f2e4" />
            <stop offset="100%" stopColor="#e4dcc6" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="292" height="192" rx="12" className={styles.meterBezel} />
        <rect x="14" y="14" width="272" height="172" rx="6" fill="url(#pk-face)" />
        <path d={band(R - 6, R, ta, HALF)} className={styles.fireZone} />
        {ticks}
        <text x="150" y="122" className={styles.meterUnit}>
          {label}
        </text>
        <path d={`M${mx} ${my}l-6 -10h12z`} transform={`rotate(${ta} ${mx} ${my})`} className={styles.thetaMark} />
        <g ref={needle}>
          <line x1={PIVOT.x} y1={PIVOT.y + 10} x2={PIVOT.x} y2={PIVOT.y - R + 2} className={styles.needle} />
        </g>
        <circle cx={PIVOT.x} cy={PIVOT.y} r="9" className={styles.pivot} />
        <rect x="14" y="14" width="272" height="172" rx="6" className={styles.glass} />
      </svg>
    </div>
  );
}

/** The "detected" lamp. */
export function Lamp({ on, label }: { on: boolean; label: string }) {
  return (
    <div className={styles.lampBox}>
      <span className={`${styles.lamp} ${on ? styles.lampOn : ''}`} aria-hidden="true" />
      <span className={styles.lampLabel} aria-live="polite">
        {label}: <b>{on ? 'SÍ' : 'NO'}</b>
      </span>
    </div>
  );
}
