import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  FaBackspace,
  FaBolt,
  FaDice,
  FaDownload,
  FaFolderOpen,
  FaPause,
  FaPlay,
  FaShareAlt,
  FaStepForward,
  FaTrashAlt,
  FaVolumeMute,
  FaVolumeUp,
} from 'react-icons/fa';

import AccuracyChart, { type Point } from '../perceptron/AccuracyChart';
import { isMuted, setMuted, sfx } from '../perceptron/chiptune';
import { KnobDefs } from '../perceptron/Knob';
import ps from '../perceptron/perceptron.module.css';
import AttentionLab from './AttentionLab';
import { AttentionArcs, AttentionMatrix, HeadTabs } from './AttentionViews';
import { BOS, EOS, MAX_SRC, WORDS, makePairs, reference, type Pair } from './grammar';
import {
  DEFAULT_CONFIG,
  HEAD_OPTIONS,
  LAYER_OPTIONS,
  countParams,
  evaluate,
  fromJSON,
  fromShareCode,
  newModel,
  shareCode,
  toJSON,
  trainBatch,
  translate,
  type Config,
  type Model,
} from './model';
import Perspective from './Perspective';
import PositionalView from './PositionalView';
import ts from './transformer.module.css';

type Speed = 0 | 1 | 10 | 100;
type Tab = 'cross' | 'enc' | 'dec';

const BATCH = 8;
const N_TRAIN = 3000;
const N_TEST = 150;
/** Accuracy is measured on these many sentences of each set for the chart. */
const EVAL_N = 50;
const EVAL_EVERY = 25;
const MAX_STEPS = 1500;
const STORE = 'transformer:model';
const START = 'el gato negro come una manzana roja'.split(' ');

interface Stats {
  steps: number;
  seen: number;
  loss: number;
  points: Point[];
  done: '' | 'converged' | 'gaveup';
}

const freshStats = (): Stats => ({ steps: 0, seen: 0, loss: NaN, points: [], done: '' });
const pct = (p: number) => `${Math.round(p * 100)} %`;

function store(fn: () => void) {
  try {
    fn();
  } catch {
    /* private mode or blocked storage: the demo works without it */
  }
}

export default function Transformer() {
  const [powered, setPowered] = useState(false);
  const [muted, setMute] = useState(isMuted());

  // The model is mutated in place by training; `rev` re-renders it.
  const model = useRef<Model>(newModel(DEFAULT_CONFIG, 1));
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const m = model.current;

  const [sentence, setSentence] = useState<string[]>(START);
  const [selected, setSelected] = useState(1);
  const [head, setHead] = useState(-1);
  const [tab, setTab] = useState<Tab>('cross');
  const [layer, setLayer] = useState(0);
  const [reveal, setReveal] = useState<number | null>(null);

  const seed = useRef(1);
  const [data, setData] = useState<{ train: Pair[]; test: Pair[] }>(() => ({ train: makePairs(N_TRAIN, 1, 'train'), test: makePairs(N_TEST, 2, 'test') }));
  const [stats, setStats] = useState<Stats>(freshStats);
  const [speed, setSpeed] = useState<Speed>(0);
  const [lr, setLr] = useState(0.003);
  const [toast, setToast] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const cursor = useRef(0);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? '' : x)), 2600);
  }, []);

  const install = useCallback(
    (next: Model) => {
      model.current = next;
      setSpeed(0);
      setStats(freshStats());
      setLayer(0);
      setHead(-1);
      cursor.current = 0;
      bump();
    },
    [bump],
  );

  const reset = (cfg: Config) => {
    sfx.click();
    install(newModel(cfg, Date.now() >>> 0));
  };

  // Restore: a shared link wins over the copy kept in this browser.
  useEffect(() => {
    const hash = window.location.hash.match(/[#&]w=([A-Za-z0-9_-]+)/);
    if (hash) {
      fromShareCode(hash[1])
        .then((x) => {
          install(x);
          say('Pesos cargados desde el enlace');
        })
        .catch(() => say('El enlace no contiene pesos válidos'));
      return;
    }
    let saved: string | null = null;
    store(() => (saved = window.localStorage.getItem(STORE)));
    if (saved) {
      try {
        install(fromJSON(saved));
      } catch {
        /* stale format: start fresh */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save once training rests; the model is a couple of hundred kilobytes of JSON.
  useEffect(() => {
    if (speed) return;
    const t = window.setTimeout(() => store(() => window.localStorage.setItem(STORE, toJSON(model.current))), 1500);
    return () => window.clearTimeout(t);
  }, [rev, speed]);

  // ── translating the sentence ──

  const ref = useMemo(() => reference(sentence), [sentence]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tr = useMemo(() => (sentence.length ? translate(m, sentence) : null), [m, sentence, rev]);
  const outRows = tr ? [...tr.words, EOS] : [];
  const decIn = tr ? [BOS, ...tr.words] : [];
  const sel = Math.min(selected, Math.max(0, outRows.length - 1));
  const shownRows = reveal ?? outRows.length;

  // Step-by-step generation: one more word every 700 ms.
  useEffect(() => {
    if (reveal === null) return;
    if (reveal > outRows.length) {
      setReveal(null);
      return;
    }
    setSelected(Math.max(0, reveal - 1));
    if (reveal > 0) sfx.ok();
    const t = window.setTimeout(() => setReveal((r) => (r === null ? null : r + 1)), 700);
    return () => window.clearTimeout(t);
  }, [reveal]); // eslint-disable-line react-hooks/exhaustive-deps

  const addWord = (w: string) => {
    if (sentence.length >= MAX_SRC) return;
    sfx.pixel(true);
    setReveal(null);
    setSentence([...sentence, w]);
  };

  const randomSentence = (set: 'train' | 'test') => {
    sfx.click();
    setReveal(null);
    const pool = set === 'train' ? data.train : data.test;
    setSentence(pool[Math.floor(Math.random() * pool.length)].es);
    setSelected(1);
  };

  // ── training ──

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const dataRef = useRef(data);
  dataRef.current = data;

  /** One optimiser step on the next mini-batch. Returns false when training should stop. */
  const step = useCallback(
    (s: Stats): boolean => {
      const d = dataRef.current;
      const batch = Array.from({ length: BATCH }, () => d.train[cursor.current++ % d.train.length]);
      const loss = trainBatch(model.current, batch, { lr, warmup: 40 });
      s.steps++;
      s.seen += BATCH;
      s.loss = Number.isNaN(s.loss) ? loss : s.loss * 0.9 + loss * 0.1;
      if (s.steps % EVAL_EVERY === 0) {
        const a = evaluate(model.current, d.train.slice(0, EVAL_N)).exact;
        const b = evaluate(model.current, d.test.slice(0, EVAL_N)).exact;
        const prev = s.points[s.points.length - 1];
        s.points = [...s.points, { seen: s.seen, train: a, test: b }];
        if (b === 1 && prev?.test === 1) s.done = 'converged';
        else if (s.steps >= MAX_STEPS) s.done = 'gaveup';
        if (s.done === 'converged') sfx.win();
        else sfx.epoch(b);
      }
      return !s.done;
    },
    [lr],
  );

  useEffect(() => {
    if (!speed) return;
    let budget = 1;
    const id = window.setInterval(() => {
      const s = { ...statsRef.current };
      let go = true;
      if (speed === 100) {
        const t0 = performance.now();
        while (go && performance.now() - t0 < 32) go = step(s);
      } else {
        budget += (2 * speed) / 20;
        while (go && budget >= 1) {
          budget--;
          go = step(s);
        }
      }
      if (speed === 1) {
        // Show the sentence the model just learnt from.
        const last = dataRef.current.train[(cursor.current - 1 + dataRef.current.train.length) % dataRef.current.train.length];
        setSentence(last.es);
      }
      setStats(s);
      bump();
      if (!go) setSpeed(0);
    }, 50);
    return () => window.clearInterval(id);
  }, [speed, step, bump]);

  const play = (s: Speed) => {
    sfx.click();
    setReveal(null);
    if (stats.done) setStats({ ...stats, done: '' });
    setSpeed((cur) => (cur === s ? 0 : s));
  };

  // ── sharing ──

  const share = async () => {
    sfx.click();
    const code = await shareCode(m);
    const url = `${window.location.origin}${window.location.pathname}#w=${code}`;
    window.history.replaceState(null, '', `#w=${code}`);
    try {
      await navigator.clipboard.writeText(url);
      say('Enlace con los pesos copiado al portapapeles');
    } catch {
      say('Enlace listo en la barra de direcciones');
    }
  };

  const download = () => {
    sfx.click();
    const blob = new Blob([toJSON(m)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transformer-${m.cfg.heads}cabezas-${m.cfg.layers}capas.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      install(fromJSON(await file.text()));
      say(`Pesos cargados de ${file.name}`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  // ── the attention to show ──

  const maps = tr ? { cross: tr.trace.cross, enc: tr.trace.enc, dec: tr.trace.decSelf }[tab] : [];
  const map = maps[Math.min(layer, maps.length - 1)];
  const rowLabels = tab === 'enc' ? sentence : tab === 'dec' ? decIn : outRows;
  const colLabels = tab === 'cross' || tab === 'enc' ? sentence : decIn;
  const lastPoint = stats.points[stats.points.length - 1];
  const correct = tr && ref ? tr.words.join(' ') === ref.join(' ') : null;
  const perceptronUrl = useBaseUrl('/perceptron');
  const cnnUrl = useBaseUrl('/cnn');

  return (
    <div className={ps.root}>
      <KnobDefs />

      {!powered && (
        <div className={ps.splash}>
          <div className={ps.splashCard}>
            <span className={ps.badge}>Google · 2017</span>
            <h1>Attention Is All You Need</h1>
            <p>
              En 2017, ocho investigadores de Google propusieron traducir sin redes recurrentes ni convoluciones: solo con{' '}
              <b>atención</b>. Cada palabra pregunta a las demás cuáles le importan y mezcla lo que responden. Lo llamaron{' '}
              <b>Transformer</b>, y es la «T» de GPT.
            </p>
            <p>
              Aquí tienes uno de bolsillo que traduce frases sencillas del español al inglés. Entrénalo y mira cómo aprende a
              mirar a «negro» para escribir «black» antes de «cat».
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
      )}

      {/* ── top bar ── */}
      <header className={ps.topbar}>
        <div className={ps.title}>
          <h1>Transformer</h1>
          <span className={ps.badge}>Google · 2017</span>
        </div>
        <div className={ts.config}>
          <span className={ts.configGroup} role="radiogroup" aria-label="Cabezas de atención">
            <small>cabezas</small>
            {HEAD_OPTIONS.map((h) => (
              <button key={h} role="radio" aria-checked={m.cfg.heads === h} className={m.cfg.heads === h ? ps.modeOn : ps.mode} onClick={() => m.cfg.heads !== h && reset({ ...m.cfg, heads: h })}>
                {h}
              </button>
            ))}
          </span>
          <span className={ts.configGroup} role="radiogroup" aria-label="Capas">
            <small>capas</small>
            {LAYER_OPTIONS.map((l) => (
              <button key={l} role="radio" aria-checked={m.cfg.layers === l} className={m.cfg.layers === l ? ps.modeOn : ps.mode} onClick={() => m.cfg.layers !== l && reset({ ...m.cfg, layers: l })}>
                {l}
              </button>
            ))}
          </span>
          <label className={ts.configCheck} title="Sin ella, el modelo ve las palabras como una bolsa: no sabe en qué orden van">
            <input type="checkbox" checked={m.cfg.posEnc} onChange={(e) => reset({ ...m.cfg, posEnc: e.target.checked })} /> codificación posicional
          </label>
        </div>
        <div className={ps.topActions}>
          <button className={ps.iconBtn} onClick={share} title="Copiar un enlace con estos pesos">
            <FaShareAlt /> Compartir
          </button>
          <button className={ps.iconBtn} onClick={download} title="Descargar los pesos (JSON)">
            <FaDownload />
          </button>
          <button className={ps.iconBtn} onClick={() => fileInput.current?.click()} title="Cargar pesos (JSON)">
            <FaFolderOpen />
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button
            className={ps.iconBtn}
            onClick={() => {
              setMuted(!muted);
              setMute(!muted);
            }}
            title={muted ? 'Activar sonido' : 'Silenciar'}
            aria-pressed={muted}
          >
            {muted ? <FaVolumeMute /> : <FaVolumeUp />}
          </button>
        </div>
      </header>
      <p className={ps.blurb}>
        Codificador y decodificador de {m.cfg.layers} capa{m.cfg.layers > 1 ? 's' : ''}, {m.cfg.heads} cabeza{m.cfg.heads > 1 ? 's' : ''} de
        atención, vectores de {m.cfg.d} números: {countParams(m).toLocaleString('es')} pesos (el original tenía 6 capas, 8 cabezas,
        vectores de 512 y 65 millones de pesos). <span className={ps.muted}>Cambiar la arquitectura empieza con pesos al azar.</span>
      </p>

      <div className={ts.machine}>
        {/* ── the Spanish sentence ── */}
        <section className={ps.panel} aria-labelledby="tf-in">
          <h2 id="tf-in">Frase en español</h2>
          <div className={ts.chips} aria-live="polite">
            {sentence.map((w, i) => (
              <span key={i} className={ts.chip}>
                {w}
              </span>
            ))}
            {!sentence.length && <span className={ps.muted}>Elige palabras abajo…</span>}
          </div>
          <div className={ps.toolRow}>
            <button className={ps.tool} onClick={() => setSentence(sentence.slice(0, -1))} disabled={!sentence.length || !!speed} title="Borrar la última palabra">
              <FaBackspace />
            </button>
            <button className={ps.tool} onClick={() => setSentence([])} disabled={!!speed} title="Borrar la frase">
              <FaTrashAlt />
            </button>
            <button className={ps.btn} onClick={() => randomSentence('train')} disabled={!!speed}>
              <FaDice /> De entrenamiento
            </button>
            <button className={ps.btn} onClick={() => randomSentence('test')} disabled={!!speed} title="Usa un par sustantivo–adjetivo que el modelo nunca vio junto">
              <FaDice /> Nueva
            </button>
          </div>
          {(Object.keys(WORDS) as (keyof typeof WORDS)[]).map((g) => (
            <div key={g} className={ts.palette}>
              <small>{{ det: 'determinantes', noun: 'sustantivos', adj: 'adjetivos', verb: 'verbos' }[g]}</small>
              <div>
                {WORDS[g].map((w) => (
                  <button key={w} className={ts.word} onClick={() => addWord(w)} disabled={sentence.length >= MAX_SRC || !!speed}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className={ps.muted}>
            {ref ? (
              <>
                Traducción correcta: <b>{ref.join(' ')}</b>
              </>
            ) : sentence.length ? (
              'Esta frase se sale de la gramática del curso: el modelo la traducirá igualmente. ¿Qué hace?'
            ) : null}
          </p>
        </section>

        {/* ── the translation ── */}
        <section className={`${ps.panel} ${ps.rack}`} aria-labelledby="tf-out">
          <div className={ts.panelHead}>
            <h2 id="tf-out">Traducción y atención cruzada</h2>
            <button
              className={reveal !== null ? ts.genOn : ts.gen}
              onClick={() => {
                sfx.click();
                setSpeed(0);
                setReveal(reveal === null ? 0 : null);
              }}
              disabled={!tr}
            >
              {reveal !== null ? <FaPause /> : <FaPlay />} Generar paso a paso
            </button>
          </div>
          {tr && (
            <>
              <div className={ts.output} aria-live="polite">
                {outRows.map((w, i) => (
                  <button
                    key={i}
                    className={`${ts.outWord} ${i === sel ? ts.outSel : ''} ${i >= shownRows ? ts.outHidden : ''}`}
                    onClick={() => setSelected(i)}
                    title={`Confianza ${pct(tr.confidence[i] ?? 0)}`}
                  >
                    {w}
                    <span className={ts.conf} style={{ width: `${(tr.confidence[i] ?? 0) * 100}%` }} />
                  </button>
                ))}
                {correct !== null && (
                  <span className={correct ? ts.verdictOk : ts.verdictBad}>{correct ? '✓ correcta' : `✗ debería ser «${ref!.join(' ')}»`}</span>
                )}
              </div>
              <HeadTabs heads={m.cfg.heads} value={head} onChange={setHead} />
              <AttentionArcs map={tr.trace.cross[tr.trace.cross.length - 1]} head={head} top={sentence} bottom={outRows.slice(0, shownRows)} selected={sel} onSelect={setSelected} />
              <div className={ts.options}>
                <span>
                  Para escribir <b>{outRows[sel]}</b> la red dudaba entre:
                </span>
                {tr.options[sel]?.map((o) => (
                  <span key={o.word} className={ts.option}>
                    <span className={ts.optionBar}>
                      <span style={{ width: `${o.p * 100}%` }} />
                    </span>
                    {o.word} {pct(o.p)}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── all the attention maps ── */}
        <section className={ps.panel} aria-labelledby="tf-maps">
          <h2 id="tf-maps">Mapas de atención</h2>
          <div className={ts.tabs} role="tablist">
            {(
              [
                ['cross', 'Cruzada'],
                ['enc', 'Codificador'],
                ['dec', 'Decodificador'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? ts.tabOn : ts.tab} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {m.cfg.layers > 1 && (
            <div className={ts.tabs} role="tablist" aria-label="Capa">
              {Array.from({ length: m.cfg.layers }, (_, l) => (
                <button key={l} role="tab" aria-selected={layer === l} className={layer === l ? ts.tabOn : ts.tab} onClick={() => setLayer(l)}>
                  Capa {l + 1}
                </button>
              ))}
            </div>
          )}
          {map && (
            <AttentionMatrix
              map={map}
              head={head}
              rowLabels={rowLabels}
              colLabels={colLabels}
              selected={tab === 'cross' ? sel : tab === 'dec' ? sel : undefined}
              onSelect={tab === 'enc' ? undefined : setSelected}
              masked={tab === 'dec' ? (i, j) => j > i : undefined}
              caption={
                tab === 'cross'
                  ? 'Cada palabra inglesa (fila) mira a las españolas (columnas)'
                  : tab === 'enc'
                    ? 'Cada palabra española mira a las demás de su frase'
                    : 'Cada posición del decodificador solo ve lo ya escrito (×: futuro oculto)'
              }
            />
          )}
          <p className={ps.muted}>
            {head < 0 ? 'Media de las cabezas.' : `Cabeza ${head + 1}.`} Cada fila suma 100 %: es un reparto de la atención.
          </p>
        </section>
      </div>

      {/* ── the whole model in perspective ── */}
      <section className={`${ps.panel} ${ps.rack}`} aria-labelledby="tf-persp">
        <h2 id="tf-persp">El Transformer en perspectiva</h2>
        {tr && (
          <Perspective trace={tr.trace} d={m.cfg.d} src={sentence} dec={decIn} out={outRows} head={head} selected={sel} onSelect={setSelected} />
        )}
      </section>

      {/* ── attention by hand and positions ── */}
      <div className={ts.labs}>
        <section className={ps.panel} aria-labelledby="tf-lab">
          <h2 id="tf-lab">Laboratorio: la atención a mano</h2>
          <AttentionLab />
        </section>
        <section className={ps.panel} aria-labelledby="tf-pe">
          <h2 id="tf-pe">Codificación posicional</h2>
          <PositionalView d={m.cfg.d} n={Math.max(MAX_SRC, sentence.length)} words={sentence} />
          <p className={ps.muted}>
            La atención no sabe de orden: para ella una frase es una bolsa de palabras. Por eso a cada palabra se le suma la fila de
            su posición. {m.cfg.posEnc ? 'Desactívala arriba y entrena: «el perro ve la vaca» y «la vaca ve el perro» acabarán igual.' : 'Ahora está desactivada: prueba «el perro ve la vaca» y «la vaca ve el perro».'}
          </p>
        </section>
      </div>

      {/* ── training ── */}
      <section className={`${ps.panel} ${ps.training}`} aria-labelledby="tf-train">
        <div className={ps.trainCol}>
          <h2 id="tf-train">Entrenamiento</h2>
          <p className={ps.muted}>
            {N_TRAIN} frases de entrenamiento y {N_TEST} de prueba. Las de prueba usan cinco combinaciones que nunca aparecen al
            entrenar, como «gato blanco» o «vaca negra».
          </p>
          <button
            className={ps.btn}
            onClick={() => {
              sfx.click();
              setSpeed(0);
              const s = ++seed.current;
              setData({ train: makePairs(N_TRAIN, s * 2 + 1, 'train'), test: makePairs(N_TEST, s * 2 + 2, 'test') });
              setStats(freshStats());
            }}
          >
            <FaDice /> Otras frases
          </button>
          <label className={ps.field}>
            Tasa de aprendizaje (Adam) = {lr.toFixed(4)}
            <input type="range" min={0.0005} max={0.01} step={0.0005} value={lr} onChange={(e) => setLr(+e.target.value)} />
          </label>
          <p className={ps.muted}>Lotes de {BATCH} frases; cada paso ajusta todos los pesos con el gradiente medio del lote.</p>
        </div>

        <div className={ps.trainCol}>
          <div className={ps.transport}>
            {([1, 10, 100] as const).map((s) => (
              <button key={s} className={speed === s ? ps.playOn : ps.play} onClick={() => play(s)} title={speed === s ? 'Pausa' : s === 100 ? 'Entrenar a toda velocidad' : `Entrenar a ×${s}`}>
                {speed === s ? <FaPause /> : <FaPlay />} {s === 100 ? 'Máx' : `×${s}`}
              </button>
            ))}
            <button
              className={ps.play}
              onClick={() => {
                setSpeed(0);
                setReveal(null);
                const s = { ...stats, done: '' as const };
                step(s);
                setStats(s);
                const last = data.train[(cursor.current - 1 + data.train.length) % data.train.length];
                setSentence(last.es);
                sfx.ok();
                bump();
              }}
              title="Un lote"
            >
              <FaStepForward /> Paso
            </button>
            <button className={ps.play} onClick={() => reset(m.cfg)} title="Pesos al azar: empezar de nuevo">
              <FaDice /> Reiniciar
            </button>
          </div>
          <dl className={ps.stats}>
            <div>
              <dt>Pasos</dt>
              <dd>{stats.steps}</dd>
            </div>
            <div>
              <dt>Frases vistas</dt>
              <dd>{stats.seen}</dd>
            </div>
            <div>
              <dt>Pérdida</dt>
              <dd>{Number.isNaN(stats.loss) ? '—' : stats.loss.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Exactas (prueba)</dt>
              <dd>{lastPoint ? pct(lastPoint.test) : '—'}</dd>
            </div>
          </dl>
          <div className={ps.rule}>
            <code>{'pérdida = −Σ ln p(palabra correcta | lo anterior)'}</code>
            {stats.done === 'converged' && <p className={ps.ok}>¡Traduce perfectamente incluso las combinaciones que nunca vio! Mira cómo ha aprendido a mirar.</p>}
            {stats.done === 'gaveup' && (
              <p className={ps.bad}>
                {MAX_STEPS} pasos sin llegar al 100 %. {m.cfg.posEnc ? 'Prueba otra tasa de aprendizaje.' : 'Sin codificación posicional no puede: no sabe quién hace qué.'}
              </p>
            )}
            {!stats.done && <p className={ps.muted}>Con ×1 verás cada frase de entrenamiento y cómo cambia su atención.</p>}
          </div>
        </div>

        <div className={ps.trainCol}>
          <AccuracyChart points={stats.points} />
          <p className={ps.muted}>Porcentaje de frases traducidas exactamente, sin un solo error.</p>
        </div>
      </section>

      <details className={ps.howto}>
        <summary>¿Cómo funciona?</summary>
        <ol>
          <li>
            Cada palabra se convierte en un <b>vector</b> de {m.cfg.d} números (embedding) y se le suma la{' '}
            <b>codificación posicional</b>, para que el modelo sepa en qué lugar va.
          </li>
          <li>
            En la <b>autoatención</b>, cada palabra calcula una consulta (q), una clave (k) y un valor (v). Compara su q con la k de
            todas las demás (producto escalar dividido entre √d), aplica softmax y mezcla sus v con esos pesos. Así «negro» puede
            recoger información de «gato». Pruébalo con los mandos del laboratorio.
          </li>
          <li>
            Varias <b>cabezas</b> hacen esto en paralelo, cada una con sus propias matrices: una puede seguir la concordancia y
            otra el orden.
          </li>
          <li>
            El <b>decodificador</b> escribe el inglés palabra a palabra. Su autoatención lleva <b>máscara</b>: no puede mirar
            palabras que aún no ha escrito. Con la <b>atención cruzada</b> consulta la frase española: ahí se ve la alineación
            de la traducción.
          </li>
          <li>
            Tras cada atención hay una pequeña red <b>feed-forward</b> y un «Add &amp; Norm» (sumar la entrada y normalizar).
            Todo se entrena con retropropagación y el optimizador <b>Adam</b>, como en el artículo.
          </li>
          <li>
            GPT, Claude o Gemini usan esta misma pieza, solo el decodificador, con miles de millones de pesos y entrenados con
            buena parte de internet. Antes vinieron el <a href={perceptronUrl}>perceptrón</a> y las{' '}
            <a href={cnnUrl}>redes convolucionales</a>.
          </li>
        </ol>
      </details>

      {toast && (
        <div className={ps.toast} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
