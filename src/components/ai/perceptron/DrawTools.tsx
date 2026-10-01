import React, { useState } from 'react';
import { FaDice, FaEraser, FaPen, FaTrashAlt } from 'react-icons/fa';

import { sfx } from './chiptune';
import { DIGITS, GRID, LETTERS, addNoise, emptyGrid, randomStyle, renderGlyph, rng, shift, type Grid } from './model';
import styles from './perceptron.module.css';

/* The controls under a 16×16 retina: pen and eraser, clear, noise, shifting,
 * and typing a character in a chosen size and style. Shared by the
 * perceptron and the convolutional network demos. */

export const SIZES = { S: { w: 5, h: 7 }, M: { w: 7, h: 10 }, L: { w: 10, h: 14 } } as const;

interface Props {
  retina: Grid;
  setRetina: (g: Grid) => void;
  tool: 'pen' | 'eraser';
  setTool: (t: 'pen' | 'eraser') => void;
  /** Puts an example from the test set on the retina; the button is disabled without it. */
  fromSet?: () => void;
  initialChar?: string;
}

export function CharOptions() {
  return (
    <>
      <optgroup label="Dígitos">
        {DIGITS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </optgroup>
      <optgroup label="Letras">
        {LETTERS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </optgroup>
    </>
  );
}

export default function DrawTools({ retina, setRetina, tool, setTool, fromSet, initialChar = '3' }: Props) {
  const [glyph, setGlyph] = useState({ ch: initialChar, size: 'L' as keyof typeof SIZES, bold: true, italic: false });

  const writeGlyph = (random: boolean) => {
    sfx.click();
    if (random) {
      setRetina(renderGlyph(glyph.ch, randomStyle(rng(Date.now()))));
      return;
    }
    const { w, h } = SIZES[glyph.size];
    const bold = glyph.bold;
    setRetina(
      renderGlyph(glyph.ch, {
        w,
        h,
        bold,
        italic: glyph.italic ? 0.3 : 0,
        x: Math.floor((GRID - w - (bold ? 1 : 0)) / 2),
        y: Math.floor((GRID - h) / 2),
      }),
    );
  };

  return (
    <>
      <div className={styles.toolRow}>
        <button className={tool === 'pen' ? styles.toolOn : styles.tool} onClick={() => setTool('pen')} title="Lápiz">
          <FaPen />
        </button>
        <button className={tool === 'eraser' ? styles.toolOn : styles.tool} onClick={() => setTool('eraser')} title="Goma">
          <FaEraser />
        </button>
        <button className={styles.tool} onClick={() => setRetina(emptyGrid())} title="Borrar la retina">
          <FaTrashAlt />
        </button>
      </div>
      <div className={styles.toolRow}>
        <button className={styles.tool} onClick={() => setRetina(addNoise(retina, 0.04))} title="Añadir ruido (4 % de celdas)">
          Ruido
        </button>
        <span className={styles.sep} />
        {(
          [
            ['←', -1, 0],
            ['↑', 0, -1],
            ['↓', 0, 1],
            ['→', 1, 0],
          ] as const
        ).map(([l, dx, dy]) => (
          <button key={l} className={styles.tool} onClick={() => setRetina(shift(retina, dx, dy))} title="Desplazar el dibujo">
            {l}
          </button>
        ))}
      </div>
      <div className={styles.toolRow}>
        <select className={styles.select} value={glyph.ch} onChange={(e) => setGlyph({ ...glyph, ch: e.target.value })} aria-label="Carácter">
          <CharOptions />
        </select>
        {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((s) => (
          <button key={s} className={glyph.size === s ? styles.toolOn : styles.tool} onClick={() => setGlyph({ ...glyph, size: s })} title="Tamaño">
            {s}
          </button>
        ))}
        <button className={glyph.bold ? styles.toolOn : styles.tool} onClick={() => setGlyph({ ...glyph, bold: !glyph.bold })} title="Negrita">
          <b>B</b>
        </button>
        <button className={glyph.italic ? styles.toolOn : styles.tool} onClick={() => setGlyph({ ...glyph, italic: !glyph.italic })} title="Cursiva">
          <i>I</i>
        </button>
      </div>
      <div className={styles.toolRow}>
        <button className={styles.btn} onClick={() => writeGlyph(false)}>
          Escribir
        </button>
        <button className={styles.btn} onClick={() => writeGlyph(true)} title="Tamaño, posición y estilo al azar">
          <FaDice /> Al azar
        </button>
        <button
          className={styles.btn}
          onClick={() => {
            sfx.click();
            fromSet?.();
          }}
          disabled={!fromSet}
          title="Un ejemplo del conjunto de prueba"
        >
          Del conjunto
        </button>
      </div>
    </>
  );
}
