import React, { memo, useEffect, useRef } from 'react';

import styles from './cnn.module.css';

/* A square map of numbers drawn as lit cells on a canvas. "signed" maps
 * (filter weights, pre-activations) light green for positive and red for
 * negative, like the knobs' LEDs; "positive" maps (after ReLU or pooling)
 * only light green. Brightness is |v| / scale. */

interface Props {
  data: Float32Array;
  size: number;
  scale: number;
  signed?: boolean;
  /** Only the first `reveal` cells are drawn (the convolution being swept). */
  reveal?: number;
  /** Cell outlined in amber. */
  mark?: { x: number; y: number; w?: number; h?: number };
  onPick?: (x: number, y: number) => void;
  label: string;
  className?: string;
}

const POS = [46, 230, 140];
const NEG = [255, 77, 77];
const OFF = [21, 23, 26];

function FeatureMap({ data, size, scale, signed, reveal, mark, onPick, label, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const img = c.createImageData(size, size);
    const n = size * size;
    const shown = reveal ?? n;
    for (let i = 0; i < n; i++) {
      const v = i < shown ? data[i] : 0;
      const t = Math.min(1, Math.abs(v) / (scale || 1));
      const col = v < 0 && signed ? NEG : POS;
      const o = i * 4;
      const hidden = i >= shown;
      img.data[o] = hidden ? 40 : OFF[0] + (col[0] - OFF[0]) * t;
      img.data[o + 1] = hidden ? 44 : OFF[1] + (col[1] - OFF[1]) * t;
      img.data[o + 2] = hidden ? 50 : OFF[2] + (col[2] - OFF[2]) * t;
      img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, [data, size, scale, signed, reveal]);

  const pick = onPick
    ? (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.type === 'pointermove' && !e.buttons) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = Math.floor(((e.clientX - r.left) / r.width) * size);
        const y = Math.floor(((e.clientY - r.top) / r.height) * size);
        if (x >= 0 && x < size && y >= 0 && y < size) onPick(x, y);
      }
    : undefined;

  return (
    <div
      className={`${styles.map} ${onPick ? styles.mapPick : ''} ${className ?? ''}`}
      onPointerDown={pick}
      onPointerMove={pick}
      role="img"
      aria-label={label}
      title={onPick ? `${label} · haz clic para ver la cuenta` : label}
    >
      <canvas ref={ref} width={size} height={size} />
      {mark && (
        <span
          className={styles.mapMark}
          style={{
            left: `${(mark.x / size) * 100}%`,
            top: `${(mark.y / size) * 100}%`,
            width: `${((mark.w ?? 1) / size) * 100}%`,
            height: `${((mark.h ?? 1) / size) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

export default memo(FeatureMap);

/** Largest |v| in a slice, so maps of one layer share a brightness scale. */
export function maxAbs(a: Float32Array, from = 0, to = a.length): number {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}
