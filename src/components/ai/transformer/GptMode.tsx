import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  FaBackspace,
  FaDice,
  FaDownload,
  FaFolderOpen,
  FaPause,
  FaPlay,
  FaPlus,
  FaShareAlt,
  FaStepForward,
  FaTrashAlt,
  FaVolumeMute,
  FaVolumeUp,
} from 'react-icons/fa';

import AccuracyChart, { type Point } from '../perceptron/AccuracyChart';
import { isMuted, setMuted, sfx } from '../perceptron/chiptune';
import { KnobDefs } from '../perceptron/Knob';
import { rng } from '../perceptron/model';
import ps from '../perceptron/perceptron.module.css';
import AttentionLab from './AttentionLab';
import { AttentionMatrix, CausalArcs, HeadTabs } from './AttentionViews';
import { BOS, EOS, MAX_SRC, WORDS, makeSentences, nextWords, reference } from './grammar';
import {
  GPT_CONFIG,
  HEAD_OPTIONS,
  LAYER_OPTIONS,
  countParams,
  fromJSON,
  fromShareCode,
  generate,
  lmEvaluate,
  newModel,
  predictNext,
  sample,
  shareCode,
  toJSON,
  trainBatch,
  type Config,
  type Model,
} from './model';
import Perspective from './Perspective';
import PositionalView from './PositionalView';
import ts from './transformer.module.css';

/* The core idea of GPT-style models: read the words so far and predict the
 * next one, every word looking only at the words before it. The "language"
 * is the course's small Spanish grammar, so whether the model got it right
 * can be checked: an adjective must agree with its noun, the verb with the
 * subject, and «come» only takes food. */

type Speed = 0 | 1 | 10 | 100;

const BATCH = 8;
const N_TRAIN = 3000;
const N_TEST = 150;
const EVAL_SENTENCES = 50;
const EVAL_SAMPLES = 40;
const EVAL_EVERY = 25;
const MAX_STEPS = 1500;
const STORE = 'transformer:gpt';
const START = 'los gatos negros'.split(' ');

interface Stats {
  steps: number;
  seen: number;
  loss: number;
  points: Point[];
  /** A few sentences the model wrote at the last check. */
  samples: string[][];
  done: '' | 'converged' | 'gaveup';
}

const freshStats = (): Stats => ({ steps: 0, seen: 0, loss: NaN, points: [], samples: [], done: '' });
const pct = (p: number) => `${Math.round(p * 100)} %`;

function store(fn: () => void) {
  try {
    fn();
  } catch {
    /* private mode or blocked storage: the demo works without it */
  }
}

export default function GptMode({ modeSwitch }: { modeSwitch: React.ReactNode }) {
  const [muted, setMute] = useState(isMuted());

  // The model is mutated in place by training; `rev` re-renders it.
  const model = useRef<Model>(newModel(GPT_CONFIG, 1));
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const m = model.current;

  const [text, setText] = useState<string[]>(START);
  const [selected, setSelected] = useState<number | null>(null);
  const [head, setHead] = useState(-1);
  const [layer, setLayer] = useState(0);
  const [allArcs, setAllArcs] = useState(false);
  const [temperature, setTemperature] = useState(0.8);
  const [writing, setWriting] = useState(false);
  const genRng = useRef(rng(Date.now() >>> 0));

  const seed = useRef(1);
  const [data, setData] = useState(() => ({ train: makeSentences(N_TRAIN, 1, 'train'), test: makeSentences(N_TEST, 2, 'test') }));
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
      setWriting(false);
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
    if (hash && !/[#&]m=translator/.test(window.location.hash)) {
      fromShareCode(hash[1])
        .then((x) => {
          if (x.cfg.kind !== 'gpt') throw new Error('otro modo');
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
        const x = fromJSON(saved);
        if (x.cfg.kind === 'gpt') install(x);
      } catch {
        /* stale format: start fresh */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (speed) return;
    const t = window.setTimeout(() => store(() => window.localStorage.setItem(STORE, toJSON(model.current))), 1500);
    return () => window.clearTimeout(t);
  }, [rev, speed]);

  // ── reading the text ──

  const tokens = [BOS, ...text];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pred = useMemo(() => predictNext(m, text), [m, text, rev]);
  const allowed = useMemo(() => nextWords(text), [text]);
  const q = selected === null ? tokens.length - 1 : Math.min(selected, tokens.length - 1);
  const maps = pred.trace.decSelf;
  const map = maps[Math.min(layer, maps.length - 1)];
  const complete = text.length > 0 && !!reference(text);
  const canWrite = !complete && text.length < MAX_SRC && !speed;

  const append = (w: string) => {
    setSelected(null);
    if (w === EOS) {
      sfx.on();
      return false;
    }
    sfx.pixel(true);
    setText((t) => [...t, w]);
    return true;
  };

  // Word-by-word writing: one more word every 650 ms until the model ends the sentence.
  useEffect(() => {
    if (!writing) return;
    const t = window.setTimeout(() => {
      if (complete || text.length >= MAX_SRC) {
        setWriting(false);
        return;
      }
      const w = sample(pred.ranked, temperature, genRng.current);
      if (!append(w)) setWriting(false);
    }, 650);
    return () => window.clearTimeout(t);
  }, [writing, text, pred]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── training ──

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const dataRef = useRef(data);
  dataRef.current = data;

  const step = useCallback(
    (s: Stats): boolean => {
      const d = dataRef.current;
      const batch = Array.from({ length: BATCH }, () => d.train[cursor.current++ % d.train.length]);
      const loss = trainBatch(model.current, batch, { lr, warmup: 40 });
      s.steps++;
      s.seen += BATCH;
      s.loss = Number.isNaN(s.loss) ? loss : s.loss * 0.9 + loss * 0.1;
      if (s.steps % EVAL_EVERY === 0) {
        const e = lmEvaluate(model.current, d.test.slice(0, EVAL_SENTENCES), EVAL_SAMPLES, s.steps);
        const prev = s.points[s.points.length - 1];
        s.points = [...s.points, { seen: s.seen, train: e.next, test: e.generated }];
        const r = rng(s.steps + 7);
        s.samples = Array.from({ length: 6 }, () => generate(model.current, [], 1, r));
        if (e.generated >= 0.9 && (prev?.test ?? 0) >= 0.9) s.done = 'converged';
        else if (s.steps >= MAX_STEPS) s.done = 'gaveup';
        if (s.done === 'converged') sfx.win();
        else sfx.epoch(e.generated);
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
      setStats(s);
      bump();
      if (!go) setSpeed(0);
    }, 50);
    return () => window.clearInterval(id);
  }, [speed, step, bump]);

  const play = (s: Speed) => {
    sfx.click();
    setWriting(false);
    if (stats.done) setStats({ ...stats, done: '' });
    setSpeed((cur) => (cur === s ? 0 : s));
  };

  // ── sharing ──

  const share = async () => {
    sfx.click();
    const code = await shareCode(m);
    const url = `${window.location.origin}${window.location.pathname}#m=gpt&w=${code}`;
    window.history.replaceState(null, '', `#m=gpt&w=${code}`);
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
    a.download = `gpt-${m.cfg.heads}cabezas-${m.cfg.layers}capas.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const x = fromJSON(await file.text());
      if (x.cfg.kind !== 'gpt') throw new Error('Son pesos del traductor: cárgalos en ese modo');
      install(x);
      say(`Pesos cargados de ${file.name}`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  // ── derived ──

  const lastPoint = stats.points[stats.points.length - 1];
  const status = complete
    ? { cls: ts.verdictOk, text: '✓ frase completa y correcta' }
    : allowed === null
      ? { cls: ts.verdictBad, text: '✗ esto ya se sale de la gramática' }
      : { cls: ps.muted, text: 'frase a medias: ¿qué viene ahora?' };
  const perceptronUrl = useBaseUrl('/perceptron');
  const cnnUrl = useBaseUrl('/cnn');

  return (
    <div className={ps.root}>
      <KnobDefs />
      {modeSwitch}

      {/* ── top bar ── */}
      <header className={ps.topbar}>
        <div className={ps.title}>
          <h1>Transformer</h1>
          <span className={ps.badge}>tipo GPT</span>
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
          <label className={ts.configCheck} title="Suma a cada palabra un patrón que indica su posición">
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
        Lee el texto de izquierda a derecha y predice la palabra siguiente; <b>cada palabra solo puede mirar a las anteriores</b>.
        {` ${m.cfg.layers} capa${m.cfg.layers > 1 ? 's' : ''}, ${m.cfg.heads} cabeza${m.cfg.heads > 1 ? 's' : ''}, vectores de ${m.cfg.d} números: ${countParams(m).toLocaleString('es')} pesos `}
        (GPT-3 tenía 96 capas, 96 cabezas y 175 000 millones). <span className={ps.muted}>Cambiar la arquitectura empieza con pesos al azar.</span>
      </p>

      <div className={ts.machine}>
        {/* ── the text ── */}
        <section className={ps.panel} aria-labelledby="gp-in">
          <h2 id="gp-in">Texto</h2>
          <div className={ts.chips} aria-live="polite">
            {text.map((w, i) => (
              <span key={i} className={ts.chip}>
                {w}
              </span>
            ))}
            {!text.length && <span className={ps.muted}>Vacío: la red empezará la frase</span>}
          </div>
          <span className={`${ts.status} ${status.cls}`}>{status.text}</span>
          <div className={ps.toolRow}>
            <button
              className={writing ? ps.toolOn : ps.tool}
              onClick={() => {
                sfx.click();
                setSpeed(0);
                setWriting(!writing);
              }}
              disabled={(!canWrite && !writing) || !!speed}
              title="La red escribe palabra a palabra hasta acabar la frase"
            >
              {writing ? <FaPause /> : <FaPlay />} Escribir
            </button>
            <button className={ps.tool} onClick={() => append(sample(pred.ranked, temperature, genRng.current))} disabled={!canWrite || writing} title="Una palabra más">
              <FaPlus /> 1
            </button>
            <button className={ps.tool} onClick={() => setText(text.slice(0, -1))} disabled={!text.length || writing || !!speed} title="Borrar la última palabra">
              <FaBackspace />
            </button>
            <button className={ps.tool} onClick={() => setText([])} disabled={writing || !!speed} title="Borrar todo">
              <FaTrashAlt />
            </button>
            <button
              className={ps.btn}
              onClick={() => {
                sfx.click();
                const s = data.test[Math.floor(Math.random() * data.test.length)];
                setText(s.slice(0, 2 + Math.floor(Math.random() * (s.length - 2))));
                setSelected(null);
              }}
              disabled={writing || !!speed}
              title="Un principio de frase que la red nunca leyó entero"
            >
              <FaDice /> Principio al azar
            </button>
          </div>
          <label className={ps.field}>
            Temperatura {temperature.toFixed(1)} {temperature < 0.05 ? '(siempre la más probable)' : temperature > 1.2 ? '(muy creativa)' : ''}
            <input type="range" min={0} max={1.5} step={0.1} value={temperature} onChange={(e) => setTemperature(+e.target.value)} />
          </label>
          {(Object.keys(WORDS) as (keyof typeof WORDS)[]).map((g) => (
            <div key={g} className={ts.palette}>
              <small>{{ det: 'determinantes', noun: 'sustantivos', adj: 'adjetivos', verb: 'verbos' }[g]}</small>
              <div>
                {WORDS[g].map((w) => (
                  <button key={w} className={ts.word} onClick={() => append(w)} disabled={text.length >= MAX_SRC || writing || !!speed}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* ── attention looking back ── */}
        <section className={`${ps.panel} ${ps.rack}`} aria-labelledby="gp-attn">
          <div className={ts.panelHead}>
            <h2 id="gp-attn">Atención: cada palabra mira hacia atrás</h2>
            <label className={ts.configCheck} style={{ color: '#d7dbe0' }}>
              <input type="checkbox" checked={allArcs} onChange={(e) => setAllArcs(e.target.checked)} /> todas las palabras
            </label>
          </div>
          <HeadTabs heads={m.cfg.heads} value={head} onChange={setHead} />
          {maps.map((mp, l) => (
            <div key={l} className={ts.layerArcs}>
              {maps.length > 1 && <span className={ts.layerName}>Capa {l + 1}</span>}
              <CausalArcs map={mp} head={head} words={tokens} guesses={pred.guesses} selected={q} onSelect={setSelected} all={allArcs} />
              <p className={ts.options}>
                {l === 0 ? (
                  <>
                    Para predecir lo que va después de <b>«{tokens[q]}»</b>, mira a: {weights1(mp, head, q, tokens)}
                  </>
                ) : (
                  <>Y en la capa {l + 1}, sobre lo que ya mezcló la anterior: {weights1(mp, head, q, tokens)}</>
                )}
              </p>
            </div>
          ))}
          <p className={ps.muted} style={{ color: '#9aa3ad' }}>
            Debajo de cada palabra (→) está lo que la red predice que viene después. Pincha cualquier palabra para ver a quién
            miraba en ese momento. «&lt;s&gt;» marca el inicio del texto.
          </p>
        </section>

        {/* ── the next word ── */}
        <section className={ps.panel} aria-labelledby="gp-next">
          <h2 id="gp-next">Siguiente palabra</h2>
          <div className={ts.nextList}>
            {pred.ranked
              .filter((x) => x.word !== BOS && x.word !== '·')
              .slice(0, 8)
              .map((x) => {
                const ok = allowed?.includes(x.word);
                return (
                  <button key={x.word} className={ts.nextRow} onClick={() => canWrite && append(x.word)} disabled={!canWrite || writing} title={ok ? 'Correcta según la gramática' : 'Incorrecta según la gramática'}>
                    <span className={ok ? ts.nextOk : ts.nextBad}>{ok ? '✓' : '✗'}</span>
                    <span>{x.word === EOS ? 'fin (·)' : x.word}</span>
                    <span className={ts.nextBar}>
                      <span style={{ width: `${x.p * 100}%` }} />
                    </span>
                    <span>{pct(x.p)}</span>
                  </button>
                );
              })}
          </div>
          <p className={ps.muted}>
            ✓ = la gramática la permite aquí. La red no conoce las reglas: solo ha visto ejemplos. Pulsa una para añadirla.
          </p>
          {m.cfg.layers > 1 && (
            <div className={ts.tabs} role="tablist" aria-label="Capa de la tabla">
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
              rowLabels={tokens}
              colLabels={tokens}
              selected={q}
              onSelect={setSelected}
              masked={(i, j) => j > i}
              caption="La misma atención en tabla: cada fila mira a las columnas anteriores (×: futuro oculto)"
            />
          )}
        </section>
      </div>

      {/* ── the whole model in perspective ── */}
      <section className={`${ps.panel} ${ps.rack}`} aria-labelledby="gp-persp">
        <h2 id="gp-persp">El Transformer en perspectiva</h2>
        <Perspective trace={pred.trace} d={m.cfg.d} src={[]} dec={tokens} out={pred.guesses} head={head} selected={q} onSelect={setSelected} />
      </section>

      {/* ── attention by hand and positions ── */}
      <div className={ts.labs}>
        <section className={ps.panel} aria-labelledby="gp-lab">
          <h2 id="gp-lab">Laboratorio: la atención a mano</h2>
          <AttentionLab causal />
        </section>
        <section className={ps.panel} aria-labelledby="gp-pe">
          <h2 id="gp-pe">Codificación posicional</h2>
          <PositionalView d={m.cfg.d} n={Math.max(MAX_SRC + 1, tokens.length)} words={tokens} />
          <p className={ps.muted}>
            La atención compara palabras, no posiciones: por eso a cada una se le suma la fila de su lugar. Curiosidad: con la
            máscara, cada palabra ve cuántas tiene detrás, así que un modelo tipo GPT recupera algo de orden incluso sin ella.
            Desactívala y entrena para comprobarlo.
          </p>
        </section>
      </div>

      {/* ── training ── */}
      <section className={`${ps.panel} ${ps.training}`} aria-labelledby="gp-train">
        <div className={ps.trainCol}>
          <h2 id="gp-train">Entrenamiento</h2>
          <p className={ps.muted}>
            Lee {N_TRAIN} frases y, en cada posición, aprende a predecir la palabra siguiente. Nadie le explica la gramática.
          </p>
          <button
            className={ps.btn}
            onClick={() => {
              sfx.click();
              setSpeed(0);
              const s = ++seed.current;
              setData({ train: makeSentences(N_TRAIN, s * 2 + 1, 'train'), test: makeSentences(N_TEST, s * 2 + 2, 'test') });
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
                setWriting(false);
                const s = { ...stats, done: '' as const };
                step(s);
                setStats(s);
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
              <dt>Frases leídas</dt>
              <dd>{stats.seen}</dd>
            </div>
            <div>
              <dt>Pérdida</dt>
              <dd>{Number.isNaN(stats.loss) ? '—' : stats.loss.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Frases que escribe bien</dt>
              <dd>{lastPoint ? pct(lastPoint.test) : '—'}</dd>
            </div>
          </dl>
          <div className={ps.rule}>
            <code>{'pérdida = −Σ ln p(palabra siguiente | todas las anteriores)'}</code>
            {stats.samples.length > 0 && (
              <>
                <span className={ps.muted}>Lo que escribe ahora, sin ayuda:</span>
                <ul className={ts.samplesList}>
                  {stats.samples.map((s, i) => {
                    const ok = s.length <= MAX_SRC && !!reference(s);
                    return (
                      <li key={i} className={ok ? ts.nextOk : ts.nextBad}>
                        {ok ? '✓' : '✗'} {s.join(' ')}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {stats.done === 'converged' && <p className={ps.ok}>¡Ya escribe bien 9 de cada 10 frases, y no se las sabe de memoria! Mira a quién atiende el verbo.</p>}
            {stats.done === 'gaveup' && <p className={ps.bad}>{MAX_STEPS} pasos. Prueba otra tasa de aprendizaje o más capas.</p>}
            {!stats.samples.length && <p className={ps.muted}>Sin entrenar, balbucea palabras al azar. Pulsa ▶ y mira cómo aprende la gramática.</p>}
          </div>
        </div>

        <div className={ps.trainCol}>
          <AccuracyChart points={stats.points} labels={{ train: 'Siguiente palabra correcta', test: 'Frases escritas correctas' }} unit="frases" />
          <p className={ps.muted}>
            Primera línea: veces que su palabra favorita está permitida. Segunda: frases completas que escribe sola (temperatura 1)
            y respetan toda la gramática.
          </p>
        </div>
      </section>

      <details className={ps.howto}>
        <summary>¿Cómo funciona?</summary>
        <ol>
          <li>
            Cada palabra se convierte en un <b>vector</b> de {m.cfg.d} números y se le suma la <b>codificación posicional</b>.
          </li>
          <li>
            En la <b>autoatención</b>, cada palabra calcula una consulta (q), una clave (k) y un valor (v), compara su q con la k de
            las palabras <b>anteriores</b> (producto escalar dividido entre √d), aplica softmax y mezcla sus v. Así el verbo puede
            averiguar si el sujeto era plural aunque haya un adjetivo en medio. Pruébalo con los mandos del laboratorio.
          </li>
          <li>
            La <b>máscara</b> tapa el futuro: al entrenar, cada posición aprende a predecir la siguiente sin hacer trampa. Una
            sola pasada entrena todas las posiciones de la frase a la vez.
          </li>
          <li>
            Varias <b>cabezas</b> atienden en paralelo, cada una a lo suyo, y varias <b>capas</b> se apilan: la segunda trabaja
            sobre lo que ya mezcló la primera. Tras cada atención hay una red <b>feed-forward</b> y un «Add &amp; Norm».
          </li>
          <li>
            Para <b>escribir</b>, se predice una palabra, se añade al texto y se vuelve a predecir. La <b>temperatura</b> decide
            si elige siempre la más probable o se arriesga con otras.
          </li>
          <li>
            Esto es lo que hacen GPT, Claude o Gemini, con miles de millones de pesos y buena parte de internet como texto. En el
            artículo original (2017) el Transformer traducía: tienes ese modo arriba. Antes vinieron el{' '}
            <a href={perceptronUrl}>perceptrón</a> y las <a href={cnnUrl}>redes convolucionales</a>.
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

/** "los 54 %, gatos 27 %…": the strongest earlier words for one position. */
function weights1(map: ReturnType<typeof predictNext>['trace']['decSelf'][number] | undefined, head: number, q: number, tokens: string[]): string {
  if (!map) return '';
  const row = Array.from({ length: q + 1 }, (_, j) =>
    head >= 0 ? map.heads[head][q * map.cols + j] : map.heads.reduce((s, h) => s + h[q * map.cols + j], 0) / map.heads.length,
  );
  return row
    .map((v, j) => ({ w: tokens[j], v }))
    .sort((a, b) => b.v - a.v)
    .filter((x, i) => i < 3 && x.v >= 0.05)
    .map((x) => `${x.w} ${pct(x.v)}`)
    .join(', ');
}
