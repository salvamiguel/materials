import React, { useState } from 'react';
import { FaBolt } from 'react-icons/fa';

import { sfx } from '../perceptron/chiptune';
import ps from '../perceptron/perceptron.module.css';
import GptMode from './GptMode';
import TranslatorMode from './TranslatorMode';
import ts from './transformer.module.css';

/* The Transformer page: the GPT-style model (each word looks back to predict
 * the next one) is the main act; the paper's original translator is a
 * second mode. Each mode keeps its own model while you switch. */

type Mode = 'gpt' | 'translator';

export default function Transformer() {
  const [powered, setPowered] = useState(false);
  const [mode, setMode] = useState<Mode>(() => (/[#&]m=translator/.test(window.location.hash) ? 'translator' : 'gpt'));
  const [visited, setVisited] = useState<Record<Mode, boolean>>({ gpt: mode === 'gpt', translator: mode === 'translator' });

  const modeSwitch = (
    <div className={ts.modeBar} role="radiogroup" aria-label="Modo">
      <span>Modo</span>
      {(
        [
          ['gpt', 'Predecir la siguiente palabra', 'como GPT'],
          ['translator', 'Traducir', 'el paper original'],
        ] as const
      ).map(([id, label, sub]) => (
        <button
          key={id}
          role="radio"
          aria-checked={mode === id}
          className={mode === id ? ps.modeOn : ps.mode}
          onClick={() => {
            if (mode === id) return;
            sfx.click();
            setMode(id);
            setVisited((v) => ({ ...v, [id]: true }));
          }}
        >
          {label}
          <small>{sub}</small>
        </button>
      ))}
    </div>
  );

  return (
    <>
      {!powered && (
        // .root carries the colour variables the splash uses; it takes no room.
        <div className={ps.root} style={{ padding: 0, gap: 0 }}>
          <div className={ps.splash}>
            <div className={ps.splashCard}>
              <span className={ps.badge}>Google · 2017</span>
              <h1>Attention Is All You Need</h1>
              <p>
                En 2017, ocho investigadores de Google presentaron el <b>Transformer</b>: una red que, para entender una palabra,
                se pregunta a qué otras palabras del texto debe prestar <b>atención</b>. Es la «T» de GPT.
              </p>
              <p>
                Aquí tienes uno de bolsillo que hace lo mismo que un modelo como GPT: <b>leer las palabras anteriores y predecir la
                siguiente</b>. Entrénalo y mira cómo aprende, sin que nadie se lo explique, que tras «los gatos negros» va «comen» y
                no «come».
              </p>
              <button
                className={ps.power}
                onClick={() => {
                  setPowered(true);
                  sfx.power();
                }}
                autoFocus
              >
                <FaBolt /> Encender el Transformer
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Both modes stay mounted once opened, so switching keeps their training. */}
      {visited.gpt && (
        <div hidden={mode !== 'gpt'}>
          <GptMode modeSwitch={modeSwitch} />
        </div>
      )}
      {visited.translator && (
        <div hidden={mode !== 'translator'}>
          <TranslatorMode modeSwitch={modeSwitch} />
        </div>
      )}
    </>
  );
}
