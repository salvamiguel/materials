import React, { memo, useEffect, useRef } from 'react';

import { sfx } from './chiptune';
import styles from './perceptron.module.css';

/* A molded metal knob with an LED ring: green segments light clockwise for a
 * positive weight (it adds to the sum), red ones anticlockwise for a negative
 * weight (it subtracts). Drag up/down, use the mouse wheel or the arrow keys;
 * double-click returns it to zero. The gradients live in <KnobDefs/>, once per page. */

const SWEEP = 135; // degrees either side of noon

interface Props {
  index: number;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The input this knob multiplies is lit. */
  active?: boolean;
  /** Just turned by the learning rule. */
  flash?: 1 | -1 | 0;
  label: string;
  /** Format for the tooltip and the screen reader. */
  format?: (v: number) => string;
  onChange: (index: number, value: number) => void;
  className?: string;
}

const polar = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
};

function arc(r: number, from: number, to: number) {
  if (Math.abs(to - from) < 0.5) return '';
  const [a0, a1] = from < to ? [from, to] : [to, from];
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const TRACK = arc(44, -SWEEP, SWEEP);

function Knob({ index, value, min, max, step, active, flash, label, format, onChange, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ value, min, max, step, index, onChange });
  live.current = { value, min, max, step, index, onChange };

  const set = (v: number) => {
    const c = live.current;
    const q = Math.round(Math.max(c.min, Math.min(c.max, v)) / c.step) * c.step;
    const r = Math.round(q * 1000) / 1000;
    if (r !== c.value) {
      sfx.tick(r / Math.max(Math.abs(c.min), c.max));
      c.onChange(c.index, r);
    }
  };

  // React's onWheel is passive, so the page would scroll too: listen natively.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      set(live.current.value + (e.deltaY < 0 ? 1 : -1) * live.current.step);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ref.current?.focus();
    const startY = e.clientY;
    const startX = e.clientX;
    const start = live.current.value;
    const range = live.current.max - live.current.min;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const px = startY - ev.clientY + (ev.clientX - startX);
      set(start + (px / (ev.shiftKey ? 600 : 150)) * range);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const { value: v, step: s, min: lo, max: hi } = live.current;
    const map: Record<string, number> = {
      ArrowUp: v + s,
      ArrowRight: v + s,
      ArrowDown: v - s,
      ArrowLeft: v - s,
      PageUp: v + s * 5,
      PageDown: v - s * 5,
      Home: lo,
      End: hi,
      '0': 0,
      Delete: 0,
      Backspace: 0,
    };
    if (e.key in map) {
      e.preventDefault();
      set(map[e.key]);
    }
  };

  const span = Math.max(Math.abs(min), Math.abs(max));
  const deg = (value / span) * SWEEP;
  const shown = format ? format(value) : value.toFixed(2);
  const cls = [styles.knob, active && styles.knobActive, flash === 1 && styles.flashUp, flash === -1 && styles.flashDown, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-valuetext={shown}
      title={`${label}: ${shown}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(0)}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="49" className={styles.knobHalo} />
        <path d={TRACK} className={styles.ledTrack} />
        {deg !== 0 && <path d={arc(44, 0, deg)} className={value > 0 ? styles.ledPos : styles.ledNeg} />}
        <circle cx="50" cy="50" r="35" fill="url(#pk-skirt)" />
        <circle cx="50" cy="50" r="33.5" className={styles.knurl} />
        <circle cx="50" cy="50" r="27" fill="url(#pk-cap)" className={styles.cap} />
        <circle cx="50" cy="50" r="27" fill="url(#pk-sheen)" />
        <g transform={`rotate(${deg} 50 50)`}>
          <line x1="50" y1="46" x2="50" y2="26" className={styles.pointer} />
        </g>
      </svg>
    </div>
  );
}

export default memo(Knob);

/** Shared gradients for every knob on the page. */
export function KnobDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <radialGradient id="pk-skirt" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#5b5f66" />
          <stop offset="70%" stopColor="#2a2d32" />
          <stop offset="100%" stopColor="#15171a" />
        </radialGradient>
        <linearGradient id="pk-cap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e9ecef" />
          <stop offset="45%" stopColor="#a9afb6" />
          <stop offset="55%" stopColor="#8d939b" />
          <stop offset="100%" stopColor="#5c6168" />
        </linearGradient>
        <radialGradient id="pk-sheen" cx="35%" cy="30%" r="45%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
