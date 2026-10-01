import React, { useRef } from 'react';

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
  small?: boolean;
  label: string;
}

export default function Retina({ grid, onChange, tool = 'pen', window: win, small, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const paint = useRef<number | null>(null);
  const cur = useRef(grid);
  cur.current = grid;

  const cellAt = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * GRID);
    const y = Math.floor(((e.clientY - r.top) / r.height) * GRID);
    return x >= 0 && x < GRID && y >= 0 && y < GRID ? y * GRID + x : -1;
  };

  const put = (i: number) => {
    if (i < 0 || paint.current === null || cur.current[i] === paint.current) return;
    const g = cur.current.slice();
    g[i] = paint.current;
    cur.current = g;
    sfx.pixel(!!paint.current);
    onChange!(g);
  };

  const handlers = onChange
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const i = cellAt(e);
          if (i < 0) return;
          paint.current = tool === 'eraser' ? 0 : cur.current[i] ? 0 : 1;
          put(i);
        },
        onPointerMove: (e: React.PointerEvent) => paint.current !== null && put(cellAt(e)),
        onPointerUp: () => (paint.current = null),
        onPointerCancel: () => (paint.current = null),
      }
    : {};

  return (
    <div
      ref={box}
      className={`${styles.retina} ${small ? styles.retinaSmall : ''} ${onChange ? styles.retinaDraw : ''}`}
      role="img"
      aria-label={label}
      {...handlers}
    >
      {Array.from(grid, (v, i) => (
        <span key={i} className={v ? styles.cellOn : styles.cell} />
      ))}
      {win && (
        <span
          className={styles.scanWindow}
          style={{
            left: `${(win.x / GRID) * 100}%`,
            top: `${(win.y / GRID) * 100}%`,
            width: `${(SCAN_W / GRID) * 100}%`,
            height: `${(SCAN_H / GRID) * 100}%`,
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
