import React, { useEffect, useRef } from 'react';

import styles from './perceptron.module.css';

/* Weights as a picture, for retinas with too many photocells for knobs:
 * green adds, red subtracts, brightness is |w| / limit. */

export default function WeightMap({ weights, w, h, limit, label }: { weights: Float32Array; w: number; h: number; limit: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = weights[i] / limit;
      const t = Math.min(1, Math.abs(v));
      const col = v >= 0 ? [46, 230, 140] : [255, 77, 77];
      img.data[i * 4] = 21 + (col[0] - 21) * t;
      img.data[i * 4 + 1] = 23 + (col[1] - 23) * t;
      img.data[i * 4 + 2] = 26 + (col[2] - 26) * t;
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    // Weights change in place ("al azar", training): redraw on every render, it is cheap.
  });
  return <canvas ref={ref} width={w} height={h} className={styles.weightMap} style={{ aspectRatio: `${w} / ${h}` }} role="img" aria-label={label} />;
}
