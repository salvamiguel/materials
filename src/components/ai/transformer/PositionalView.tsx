import React, { useEffect, useRef } from 'react';

import ts from './transformer.module.css';
import { positionalEncoding } from './model';

/* The sinusoidal positional encoding: one row per position, one column per
 * dimension. Fast waves on the left, slow ones on the right: every position
 * gets a unique pattern that is added to its word's embedding. */

export default function PositionalView({ d, n, words }: { d: number; n: number; words: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    const pe = positionalEncoding(n, d);
    const img = c.createImageData(d, n);
    for (let i = 0; i < n * d; i++) {
      const v = pe.data[i];
      // Diverging: green positive, red negative, dark zero.
      const t = Math.abs(v);
      const col = v >= 0 ? [46, 230, 140] : [255, 77, 77];
      img.data[i * 4] = 21 + (col[0] - 21) * t;
      img.data[i * 4 + 1] = 23 + (col[1] - 23) * t;
      img.data[i * 4 + 2] = 26 + (col[2] - 26) * t;
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, [d, n]);

  return (
    <div className={ts.pe}>
      <div className={ts.peRows}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i}>
            {i}
            {words[i] ? ` · ${words[i]}` : ''}
          </span>
        ))}
      </div>
      <canvas ref={ref} width={d} height={n} className={ts.peCanvas} role="img" aria-label="Codificación posicional: filas posiciones, columnas dimensiones" />
      <p className={ts.peAxis}>dimensión 0 → {d - 1} (ondas rápidas → lentas)</p>
    </div>
  );
}
