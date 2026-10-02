import React, { useCallback, useState } from 'react';

import Knob from '../perceptron/Knob';
import { sfx } from '../perceptron/chiptune';
import ps from '../perceptron/perceptron.module.css';
import ts from './transformer.module.css';

/* Scaled dot-product attention by hand, in two dimensions so every vector is
 * an arrow on the plane. Each word has a fixed embedding x; the knobs are
 * the 2×2 matrices W_Q and W_K. The chosen word asks q = W_Q·x, every word
 * answers k = W_K·x, and the scores q·k / √2 go through softmax. The result
 * is the weighted mix of the words' values (here v = x). */

const WORDS: { w: string; x: [number, number]; role: string }[] = [
  { w: 'el', x: [0.1, -0.9], role: 'determinante' },
  { w: 'gato', x: [1, 0.15], role: 'sustantivo' },
  { w: 'negro', x: [0.2, 1], role: 'adjetivo' },
  { w: 'come', x: [-0.95, 0.2], role: 'verbo' },
];

type M2 = [number, number, number, number]; // row-major a b / c d

const PRESETS: { id: string; label: string; q: M2; k: M2; query: number }[] = [
  { id: 'adj', label: '«negro» busca su sustantivo', q: [0, 3, 0, 0], k: [1, 0, 0, 1], query: 2 },
  { id: 'self', label: 'Cada palabra se mira a sí misma', q: [2.5, 0, 0, 2.5], k: [1, 0, 0, 1], query: 1 },
  { id: 'verb', label: '«come» busca al sujeto', q: [-3, 0, 0, 0], k: [1, 0, 0, 1], query: 3 },
  { id: 'flat', label: 'Todo a cero: atención uniforme', q: [0, 0, 0, 0], k: [1, 0, 0, 1], query: 2 },
];

const mul = (m: M2, v: [number, number]): [number, number] => [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

export default function AttentionLab() {
  const [wq, setWq] = useState<M2>(PRESETS[0].q);
  const [wk, setWk] = useState<M2>(PRESETS[0].k);
  const [query, setQuery] = useState(PRESETS[0].query);

  const onQ = useCallback((i: number, v: number) => setWq((m) => m.map((x, j) => (j === i ? v : x)) as M2), []);
  const onK = useCallback((i: number, v: number) => setWk((m) => m.map((x, j) => (j === i ? v : x)) as M2), []);

  const q = mul(wq, WORDS[query].x);
  const keys = WORDS.map((w) => mul(wk, w.x));
  const scores = keys.map((k) => (q[0] * k[0] + q[1] * k[1]) / Math.SQRT2);
  const mx = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - mx));
  const sum = e.reduce((a, b) => a + b, 0);
  const p = e.map((v) => v / sum);
  const out: [number, number] = [0, 1].map((d) => WORDS.reduce((s, w, j) => s + p[j] * w.x[d], 0)) as [number, number];

  // Plane: -2..2 on both axes.
  const S = 220, sc = S / 4.4;
  const px = (v: [number, number]) => [S / 2 + v[0] * sc, S / 2 - v[1] * sc];
  const arrow = (v: [number, number], cls: string, key: string, label: string, marker: string) => {
    const len = Math.hypot(v[0], v[1]);
    const clip = len > 2.1 ? 2.1 / len : 1;
    const [x, y] = px([v[0] * clip, v[1] * clip]);
    return (
      <g key={key}>
        <line x1={S / 2} y1={S / 2} x2={x} y2={y} className={cls} markerEnd={`url(#${marker})`} />
        <text x={x + (v[0] >= 0 ? 4 : -4)} y={marker === 'tl-o' ? y + 12 : y - 4} className={ts.labLabel} textAnchor={v[0] >= 0 ? 'start' : 'end'}>
          {label}
        </text>
      </g>
    );
  };

  const knobGrid = (m: M2, on: (i: number, v: number) => void, name: string) => (
    <div className={ts.labMatrix}>
      <span className={ts.labMatrixName}>{name}</span>
      <div className={ts.labKnobs}>
        {m.map((v, i) => (
          <Knob key={i} index={i} value={v} min={-3} max={3} step={0.1} label={`${name} fila ${Math.floor(i / 2) + 1}, columna ${(i % 2) + 1}`} format={fmt} onChange={on} />
        ))}
      </div>
    </div>
  );

  return (
    <div className={ts.lab}>
      <div className={ts.labCol}>
        <div className={ps.toolRow}>
          {WORDS.map((w, i) => (
            <button key={w.w} className={query === i ? ps.toolOn : ps.tool} onClick={() => setQuery(i)} title={`Consulta desde «${w.w}» (${w.role})`}>
              {w.w}
            </button>
          ))}
        </div>
        <div className={ts.labKnobRow}>
          {knobGrid(wq, onQ, 'W_Q')}
          {knobGrid(wk, onK, 'W_K')}
        </div>
        <select
          className={ps.select}
          value=""
          onChange={(ev) => {
            const pr = PRESETS.find((x) => x.id === ev.target.value);
            if (!pr) return;
            sfx.click();
            setWq(pr.q);
            setWk(pr.k);
            setQuery(pr.query);
          }}
          aria-label="Ejemplos de matrices"
        >
          <option value="">Ejemplos…</option>
          {PRESETS.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.label}
            </option>
          ))}
        </select>
      </div>

      <svg className={ts.plane} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Vectores en el plano: consulta de «${WORDS[query].w}» y claves de cada palabra`}>
        <defs>
          {[
            ['tl-k', '#9aa3ad'],
            ['tl-q', '#ffb020'],
            ['tl-o', '#2ee68c'],
          ].map(([id, fill]) => (
            <marker key={id} id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0L10 5L0 10z" fill={fill} />
            </marker>
          ))}
        </defs>
        <line x1={0} y1={S / 2} x2={S} y2={S / 2} className={ts.axis} />
        <line x1={S / 2} y1={0} x2={S / 2} y2={S} className={ts.axis} />
        {keys.map((k, j) => arrow(k, ts.vecKey, `k${j}`, `k ${WORDS[j].w}`, 'tl-k'))}
        {arrow(out, ts.vecOut, 'out', 'salida', 'tl-o')}
        {arrow(q, ts.vecQuery, 'q', `q ${WORDS[query].w}`, 'tl-q')}
      </svg>

      <div className={ts.labCol}>
        <table className={ts.labTable}>
          <thead>
            <tr>
              <th>clave</th>
              <th>q·k / √2</th>
              <th>softmax</th>
            </tr>
          </thead>
          <tbody>
            {WORDS.map((w, j) => (
              <tr key={w.w} className={j === p.indexOf(Math.max(...p)) ? ts.labWin : undefined}>
                <td>{w.w}</td>
                <td>{scores[j].toFixed(2)}</td>
                <td>
                  <span className={ts.labBar}>
                    <span style={{ width: `${p[j] * 100}%` }} />
                  </span>
                  {Math.round(p[j] * 100)} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={ps.muted}>
          «{WORDS[query].w}» pregunta con <b>q</b>; cada palabra responde con su <b>k</b>. Cuanto más se alinean, más atención
          recibe. La <b>salida</b> mezcla los valores de las palabras con esos porcentajes.
        </p>
      </div>
    </div>
  );
}
