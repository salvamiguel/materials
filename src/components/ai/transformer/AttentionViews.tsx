import React from 'react';

import ts from './transformer.module.css';
import type { AttnMap } from './model';

/* Two ways to read the same attention weights: a matrix (rows look at
 * columns) and arcs between the two sentences, the classic alignment picture
 * of machine translation. "head" picks one head, or -1 for their mean. */

export function weights(map: AttnMap, head: number, row: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < map.cols; j++) {
    if (head >= 0) out.push(map.heads[head][row * map.cols + j]);
    else out.push(map.heads.reduce((s, h) => s + h[row * map.cols + j], 0) / map.heads.length);
  }
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

interface MatrixProps {
  map: AttnMap;
  head: number;
  rowLabels: string[];
  colLabels: string[];
  selected?: number;
  onSelect?: (row: number) => void;
  /** Cells the model is not allowed to see (the decoder's future). */
  masked?: (i: number, j: number) => boolean;
  caption: string;
}

export function AttentionMatrix({ map, head, rowLabels, colLabels, selected, onSelect, masked, caption }: MatrixProps) {
  return (
    <figure className={ts.matrix} style={{ gridTemplateColumns: `auto repeat(${map.cols}, minmax(28px, 1fr))` }}>
      <figcaption className={ts.matrixCaption}>{caption}</figcaption>
      <span />
      {colLabels.map((c, j) => (
        <span key={j} className={ts.colLabel}>
          {c}
        </span>
      ))}
      {Array.from({ length: map.rows }, (_, i) => {
        const w = weights(map, head, i);
        return (
          <React.Fragment key={i}>
            <button
              className={`${ts.rowLabel} ${selected === i ? ts.rowSel : ''}`}
              onClick={() => onSelect?.(i)}
              disabled={!onSelect}
              title={onSelect ? 'Ver a quién mira esta palabra' : undefined}
            >
              {rowLabels[i]}
            </button>
            {w.map((v, j) => {
              const hidden = masked?.(i, j);
              return (
                <span
                  key={j}
                  className={`${ts.cell} ${hidden ? ts.cellMasked : ''} ${selected === i ? ts.cellRowSel : ''}`}
                  style={hidden ? undefined : { background: `rgba(46, 230, 140, ${0.06 + 0.94 * v})`, color: v > 0.55 ? '#0d0d0d' : undefined }}
                  title={hidden ? `${rowLabels[i]} no puede ver «${colLabels[j]}»: todavía no se ha escrito` : `${rowLabels[i]} → ${colLabels[j]}: ${pct(v)}`}
                  onClick={() => onSelect?.(i)}
                >
                  {hidden ? '×' : v >= 0.1 ? Math.round(v * 100) : ''}
                </span>
              );
            })}
          </React.Fragment>
        );
      })}
    </figure>
  );
}

interface ArcsProps {
  map: AttnMap;
  head: number;
  top: string[];
  bottom: string[];
  selected: number;
  onSelect: (row: number) => void;
}

/** Spanish on top, English below; each English word draws lines to the words it attends to. */
export function AttentionArcs({ map, head, top, bottom, selected, onSelect }: ArcsProps) {
  const W = 720, H = 190, pad = 40;
  const xs = (n: number, i: number) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const yTop = 40, yBot = H - 40;
  return (
    <svg className={ts.arcs} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Atención cruzada como líneas entre las dos frases">
      {Array.from({ length: map.rows }, (_, i) => {
        const w = weights(map, head, i);
        const sel = i === selected;
        return w.map((v, j) => {
          if (v < 0.04) return null;
          const x1 = xs(bottom.length, i), x0 = xs(top.length, j);
          return (
            <path
              key={`${i}-${j}`}
              d={`M${x1} ${yBot - 14} C ${x1} ${(yTop + yBot) / 2}, ${x0} ${(yTop + yBot) / 2}, ${x0} ${yTop + 12}`}
              className={sel ? ts.arcSel : ts.arc}
              style={{ strokeWidth: 1 + v * (sel ? 9 : 4), opacity: sel ? 0.25 + 0.75 * v : 0.05 + 0.25 * v }}
            />
          );
        });
      })}
      {top.map((t, j) => {
        const v = weights(map, head, selected)[j] ?? 0;
        return (
          <g key={`t${j}`}>
            <text x={xs(top.length, j)} y={yTop} className={ts.wordTop} style={{ opacity: 0.45 + 0.55 * Math.min(1, v * 2.5) }}>
              {t}
            </text>
            <text x={xs(top.length, j)} y={yTop - 18} className={ts.wordPct}>
              {v >= 0.05 ? pct(v) : ''}
            </text>
          </g>
        );
      })}
      {bottom.map((b, i) => (
        <text
          key={`b${i}`}
          x={xs(bottom.length, i)}
          y={yBot + 4}
          className={i === selected ? ts.wordSel : ts.wordBottom}
          onClick={() => onSelect(i)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(i)}
        >
          {b}
        </text>
      ))}
    </svg>
  );
}

/** Head picker: the mean of all heads, or one of them. */
export function HeadTabs({ heads, value, onChange }: { heads: number; value: number; onChange: (h: number) => void }) {
  if (heads === 1) return null;
  return (
    <div className={ts.tabs} role="tablist" aria-label="Cabeza de atención">
      {[-1, ...Array.from({ length: heads }, (_, h) => h)].map((h) => (
        <button key={h} role="tab" aria-selected={value === h} className={value === h ? ts.tabOn : ts.tab} onClick={() => onChange(h)}>
          {h < 0 ? 'Media' : `Cabeza ${h + 1}`}
        </button>
      ))}
    </div>
  );
}
