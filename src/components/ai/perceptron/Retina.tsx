import React, { startTransition, useRef, useState } from 'react';

import { sfx } from './chiptune';
import { GRID, SCAN_H, SCAN_W, type Grid } from './model';
import styles from './perceptron.module.css';

/* The 16×16 photocell retina. Drawing paints with the pen or the eraser; with
 * the pen, starting on a lit cell erases instead, so a click toggles a cell. */

interface Props {
  grid: Grid;
  onChange?: (g: Grid) => void;
  tool?: 'pen' | 'eraser';
  /** Scanner: where the template matched best. */
  window?: { x: number; y: number };
  /** Size of that window; the perceptron's scanner template by default. */
  windowSize?: { w: number; h: number };
  small?: boolean;
  label: string;
}

export default function Retina({ grid, onChange, tool = 'pen', window: win, windowSize = { w: SCAN_W, h: SCAN_H }, small, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const paint = useRef<number | null>(null);
  /** Cell under the pointer at the last event, to fill the gaps of a fast stroke. */
  const last = useRef<{ x: number; y: number } | null>(null);
  // While drawing, the stroke lives here and is drawn at once; the page (which
  // recomputes the whole machine) hears about it at most once a frame, at low
  // priority, so a busy page can never swallow the stroke.
  const [stroke, setStroke] = useState<Grid | null>(null);
  const cur = useRef(grid);
  if (paint.current === null) cur.current = grid;
  const notify = useRef(0);

  const cellAt = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * GRID), y: Math.floor(((e.clientY - r.top) / r.height) * GRID) };
  };

  const tell = () => {
    if (notify.current) return;
    notify.current = requestAnimationFrame(() => {
      notify.current = 0;
      const g = cur.current;
      startTransition(() => onChange!(g));
    });
  };

  /** Paint every cell on the segment from the last cell to (x, y). */
  const lineTo = (x: number, y: number) => {
    const from = last.current ?? { x, y };
    last.current = { x, y };
    const n = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    let g: Grid | null = null;
    for (let k = 0; k <= n; k++) {
      const cx = Math.round(from.x + ((x - from.x) * k) / n);
      const cy = Math.round(from.y + ((y - from.y) * k) / n);
      if (cx < 0 || cx >= GRID || cy < 0 || cy >= GRID) continue;
      const i = cy * GRID + cx;
      const src = g ?? cur.current;
      if (src[i] === paint.current) continue;
      g ??= cur.current.slice();
      g[i] = paint.current!;
    }
    if (!g) return;
    cur.current = g;
    sfx.pixel(!!paint.current);
    setStroke(g);
    tell();
  };

  const end = () => {
    if (paint.current === null) return;
    paint.current = null;
    last.current = null;
    if (notify.current) cancelAnimationFrame(notify.current);
    notify.current = 0;
    onChange!(cur.current);
    setStroke(null);
  };

  const handlers = onChange
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const { x, y } = cellAt(e);
          if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;
          paint.current = tool === 'eraser' ? 0 : cur.current[y * GRID + x] ? 0 : 1;
          last.current = null;
          lineTo(x, y);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (paint.current === null) return;
          // Every position the pointer passed through since the last frame, not only the latest.
          const all = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const p of all.length ? all : [e]) {
            const { x, y } = cellAt(p);
            lineTo(x, y);
          }
        },
        onPointerUp: end,
        onPointerCancel: end,
        onLostPointerCapture: end,
        onDragStart: (e: React.DragEvent) => e.preventDefault(),
      }
    : {};

  const shown = stroke ?? grid;
  return (
    <div
      ref={box}
      className={`${styles.retina} ${small ? styles.retinaSmall : ''} ${onChange ? styles.retinaDraw : ''}`}
      role="img"
      aria-label={label}
      {...handlers}
    >
      {Array.from(shown, (v, i) => (
        <span key={i} className={v ? styles.cellOn : styles.cell} />
      ))}
      {win && (
        <span
          className={styles.scanWindow}
          style={{
            left: `${(win.x / GRID) * 100}%`,
            top: `${(win.y / GRID) * 100}%`,
            width: `${(windowSize.w / GRID) * 100}%`,
            height: `${(windowSize.h / GRID) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

/** Tiny canvas thumbnail of an example, framed by whether the machine gets it right. */
export function Thumb({ grid, ok, title }: { grid: Grid; ok: boolean; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, GRID, GRID);
    c.fillStyle = '#4AFFA0';
    for (let i = 0; i < grid.length; i++) if (grid[i]) c.fillRect(i % GRID, Math.floor(i / GRID), 1, 1);
  }, [grid]);
  return <canvas ref={ref} width={GRID} height={GRID} className={`${styles.thumb} ${ok ? styles.thumbOk : styles.thumbBad}`} title={title} />;
}
