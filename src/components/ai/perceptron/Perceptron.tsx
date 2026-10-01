import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  FaBolt,
  FaDice,
  FaDownload,
  FaFolderOpen,
  FaPause,
  FaPlay,
  FaShareAlt,
  FaStepForward,
  FaUndo,
  FaVolumeMute,
  FaVolumeUp,
} from 'react-icons/fa';

import AccuracyChart, { type Point } from './AccuracyChart';
import DrawTools, { CharOptions, SIZES } from './DrawTools';
import { isMuted, setMuted, sfx } from './chiptune';
import Knob, { KnobDefs } from './Knob';
import {
  DIGITS,
  LETTERS,
  MODES,
  THETA_MAX,
  WMAX,
  accuracy,
  decide,
  fromJSON,
  fromShareCode,
  isClassifier,
  isCorrect,
  knobDims,
  learn,
  makeClassDataset,
  makeDataset,
  newMachine,
  renderGlyph,
  rng,
  shareCode,
  toJSON,
  type Example,
  type Grid,
  type Machine,
  type Mode,
} from './model';
import Retina, { Thumb } from './Retina';
import Voltmeter, { Lamp } from './Voltmeter';
import styles from './perceptron.module.css';

type Task = 'detect' | 'classify';
type Speed = 0 | 1 | 10 | 100;

const N_TRAIN = 200;
const N_TEST = 100;
const MAX_EPOCHS = 60;
/** Examples per second at ×1; ×10 and ×100 multiply it. */
const BASE_RATE = 3;
const RANGES = [5, 10, 20, 50];
const STORE = 'perceptron:machine';

interface Data {
  train: Example[];
  test: Example[];
}

interface Stats {
  epoch: number;
  cursor: number;
  seen: number;
  epochErrors: number;
  points: Point[];
  done: '' | 'converged' | 'gaveup';
}

const freshStats = (): Stats => ({ epoch: 0, cursor: 0, seen: 0, epochErrors: 0, points: [], done: '' });

interface LastUpdate {
  ch: string;
  correct: boolean;
  text: string;
}

function store(fn: () => void) {
  try {
    fn();
  } catch {
    /* private mode or blocked storage: the demo works without it */
  }
}

export default function Perceptron() {
  const [powered, setPowered] = useState(false);
  const [muted, setMute] = useState(isMuted());

  // The machine is mutated in place (knobs, learning); `rev` re-renders it.
  const machine = useRef<Machine>(newMachine('mark1', ['3']));
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const m = machine.current;
  const [unit, setUnit] = useState(0);
  const unitRef = useRef(unit);
  unitRef.current = unit;

  const [retina, setRetina] = useState<Grid>(() => renderGlyph('3', { ...SIZES.L, x: 3, y: 1, bold: true, italic: 0 }));
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [view, setView] = useState<'knobs' | 'map'>('knobs');
  const [range, setRange] = useState(20);

  const [variants, setVariants] = useState(true);
  const [noise, setNoise] = useState(0);
  const [eta, setEta] = useState(0.1);
  const seed = useRef(1);
  const [data, setData] = useState<Data | null>(null);
  const [stats, setStats] = useState<Stats>(freshStats);
  const [speed, setSpeed] = useState<Speed>(0);
  const [last, setLast] = useState<LastUpdate | null>(null);
  const [flash, setFlash] = useState<{ unit: number; dir: 1 | -1; input: Uint8Array } | null>(null);
  const [toast, setToast] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const task: Task = isClassifier(m) ? 'classify' : 'detect';
  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? '' : x)), 2600);
  }, []);

  // ── installing a machine (new wiring, new task, a loaded file…) ──

  const makeData = useCallback(
    (classes: string[], opts = { variants, noise }) => {
      const s = seed.current++;
      const o = { variants: opts.variants, noise: opts.noise / 100 };
      return classes.length > 1
        ? { train: makeClassDataset(classes, N_TRAIN, s * 2, o), test: makeClassDataset(classes, N_TEST, s * 2 + 1, o) }
        : { train: makeDataset(classes[0], N_TRAIN, s * 2, o), test: makeDataset(classes[0], N_TEST, s * 2 + 1, o) };
    },
    [variants, noise],
  );

  const install = useCallback(
    (next: Machine, opts: { keepData?: boolean } = {}) => {
      const sameTask = machine.current.classes.join() === next.classes.join();
      machine.current = next;
      setSpeed(0);
      setUnit(0);
      setStats(freshStats());
      setLast(null);
      setFlash(null);
      if (!(opts.keepData && sameTask)) setData(makeData(next.classes));
      bump();
    },
    [bump, makeData],
  );

  const reset = (mode: Mode, classes: string[]) => install(newMachine(mode, classes), { keepData: true });

  // Restore: a shared link wins over the copy kept in this browser.
  useEffect(() => {
    const hash = window.location.hash.match(/[#&]w=([A-Za-z0-9_-]+)/);
    if (hash) {
      fromShareCode(hash[1])
        .then((mm) => {
          install(mm);
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
        return;
      } catch {
        /* stale format: start fresh */
      }
    }
    setData(makeData(m.classes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the knobs in this browser between visits.
  useEffect(() => {
    const t = window.setTimeout(() => store(() => window.localStorage.setItem(STORE, toJSON(machine.current))), 600);
    return () => window.clearTimeout(t);
  }, [rev]);

  // ── knobs ──

  const onKnob = useCallback(
    (i: number, v: number) => {
      machine.current.weights[unitRef.current][i] = v;
      bump();
    },
    [bump],
  );
  const onTheta = useCallback(
    (_: number, v: number) => {
      machine.current.thetas[unitRef.current] = v;
      bump();
    },
    [bump],
  );

  // ── reading the retina ──

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decision = useMemo(() => decide(m, retina), [m, retina, rev]);
  const reading = decision.readings[unit] ?? decision.readings[0];
  const fired = task === 'detect' ? decision.fired : true;
  const lampOn = task === 'detect' ? decision.fired : decision.winner === unit;

  const prevLamp = useRef(lampOn);
  useEffect(() => {
    if (powered && speed === 0 && lampOn !== prevLamp.current) (lampOn ? sfx.on : sfx.off)();
    prevLamp.current = lampOn;
  }, [lampOn, powered, speed]);

  // ── training ──

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const dataRef = useRef(data);
  dataRef.current = data;

  /** Feeds n examples through Rosenblatt's rule. Returns false when training should stop. */
  const trainSteps = useCallback(
    (n: number, verbose: boolean): boolean => {
      const d = dataRef.current;
      if (!d) return false;
      const mm = machine.current;
      const s = { ...statsRef.current, points: statsRef.current.points };
      let shown: Example | null = null;
      let lastStep: ReturnType<typeof learn> | null = null;
      let keepGoing = true;
      for (let k = 0; k < n && keepGoing; k++) {
        const ex = d.train[s.cursor];
        lastStep = learn(mm, ex, eta);
        shown = ex;
        if (!lastStep.correct) s.epochErrors++;
        s.cursor++;
        s.seen++;
        const epochEnd = s.cursor >= d.train.length;
        if (epochEnd || s.seen % 100 === 0) {
          s.points = [...s.points, { seen: s.seen, train: accuracy(mm, d.train), test: accuracy(mm, d.test) }];
        }
        if (epochEnd) {
          s.epoch++;
          const clean = s.epochErrors === 0;
          if (clean) s.done = 'converged';
          else if (s.epoch >= MAX_EPOCHS) s.done = 'gaveup';
          if (clean) sfx.win();
          else if (!verbose) sfx.epoch(s.points[s.points.length - 1].train);
          s.cursor = 0;
          s.epochErrors = 0;
          if (s.done) keepGoing = false;
        }
      }
      if (shown && lastStep) {
        setRetina(shown.grid);
        const ch = shown.ch;
        if (verbose) (lastStep.correct ? sfx.ok : sfx.error)();
        const c = lastStep.changed;
        if (c.length) {
          const u = c[0].unit;
          setFlash({ unit: u, dir: c[0].dir, input: lastStep.decision.readings[u].input });
          if (isClassifier(mm)) setUnit(c[0].unit);
        }
        setLast({ ch, correct: lastStep.correct, text: describe(mm, lastStep, shown, eta) });
      }
      setStats(s);
      bump();
      return keepGoing;
    },
    [bump, eta],
  );

  useEffect(() => {
    if (!speed) return;
    let budget = 1;
    const id = window.setInterval(() => {
      budget += (BASE_RATE * speed) / 20;
      const n = Math.floor(budget);
      if (!n) return;
      budget -= n;
      if (!trainSteps(n, speed === 1)) setSpeed(0);
    }, 50);
    return () => window.clearInterval(id);
  }, [speed, trainSteps]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), speed === 1 || speed === 0 ? 450 : 120);
    return () => window.clearTimeout(t);
  }, [flash, speed]);

  const play = (s: Speed) => {
    sfx.click();
    if (stats.done) setStats({ ...stats, done: '' });
    setSpeed((cur) => (cur === s ? 0 : s));
  };

  const regenerate = () => {
    sfx.click();
    setSpeed(0);
    setData(makeData(m.classes));
    setStats(freshStats());
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
    a.download = `perceptron-${m.mode}-${task === 'detect' ? m.classes[0] : m.classes.length + 'clases'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      install(fromJSON(await f.text()));
      say(`Pesos cargados de ${f.name}`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  // ── derived view data ──

  const dims = knobDims(m.mode);
  const weights = m.weights[unit];
  const flashFor = flash && flash.unit === unit ? flash : null;
  const modeInfo = MODES.find((x) => x.id === m.mode)!;
  const family = DIGITS.includes(m.classes[0]) ? 'digits' : 'letters';
  const sampleRow = data ? data.test.slice(0, 24) : [];
  const fmtW = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const unitName = (k: number) => (task === 'detect' ? `“${m.classes[0]}”` : m.classes[k]);
  const answer = task === 'detect' ? (decision.fired ? m.classes[0] : `no ${m.classes[0]}`) : m.classes[decision.winner];
  const lastPoint = stats.points[stats.points.length - 1];

  return (
    <div className={styles.root}>
      <KnobDefs />

      {!powered && (
        <div className={styles.splash}>
          <div className={styles.splashCard}>
            <span className={styles.badge}>Cornell Aeronautical Laboratory · 1958</span>
            <h1>Perceptrón Mark I</h1>
            <p>
              Frank Rosenblatt construyó una máquina que <b>aprendía a reconocer letras</b>: una retina de fotocélulas, un
              armario de potenciómetros (los <b>pesos</b>) movidos por motores, y una bombilla que se encendía cuando la suma
              superaba un <b>umbral</b>.
            </p>
            <p>
              Aquí tienes una réplica. Gira los mandos a mano para entender qué hace cada peso, y luego deja que la regla de
              aprendizaje los gire por ti.
            </p>
            <button
              className={styles.power}
              onClick={() => {
                setPowered(true);
                sfx.power();
              }}
              autoFocus
            >
              <FaBolt /> Encender la máquina
            </button>
          </div>
        </div>
      )}

      {/* ── top bar ── */}
      <header className={styles.topbar}>
        <div className={styles.title}>
          <h1>Perceptrón</h1>
          <span className={styles.badge}>Rosenblatt · 1958</span>
        </div>
        <div className={styles.modes} role="radiogroup" aria-label="Cableado de la retina a los mandos">
          {MODES.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={m.mode === x.id}
              className={m.mode === x.id ? styles.modeOn : styles.mode}
              onClick={() => {
                if (m.mode === x.id) return;
                sfx.click();
                reset(x.id, m.classes);
              }}
              title={x.blurb}
            >
              {x.label}
              <small>{x.knobs}</small>
            </button>
          ))}
        </div>
        <div className={styles.topActions}>
          <button className={styles.iconBtn} onClick={share} title="Copiar un enlace con estos pesos">
            <FaShareAlt /> Compartir
          </button>
          <button className={styles.iconBtn} onClick={download} title="Descargar los pesos (JSON)">
            <FaDownload />
          </button>
          <button className={styles.iconBtn} onClick={() => fileInput.current?.click()} title="Cargar pesos (JSON)">
            <FaFolderOpen />
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button
            className={styles.iconBtn}
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
      <p className={styles.blurb}>
        <b>{modeInfo.label}.</b> {modeInfo.blurb} <span className={styles.muted}>Cambiar el cableado pone los mandos a cero.</span>
      </p>

      {/* ── the machine ── */}
      <div className={styles.machine}>
        {/* retina */}
        <section className={styles.panel} aria-labelledby="pk-retina">
          <h2 id="pk-retina">Retina 16×16</h2>
          <Retina
            grid={retina}
            onChange={speed ? undefined : setRetina}
            tool={tool}
            window={m.mode === 'scanner' ? reading.at : undefined}
            label="Retina: dibuja con el ratón o el dedo"
          />
          <DrawTools
            retina={retina}
            setRetina={setRetina}
            tool={tool}
            setTool={setTool}
            fromSet={data ? () => setRetina(data.test[Math.floor(Math.random() * data.test.length)].grid) : undefined}
          />
          {(m.mode === 'centered' || m.mode === 'normalized') && (
            <div className={styles.seen}>
              <Retina grid={reading.input} small label="Lo que llega a los mandos" />
              <p>
                Lo que llega a los mandos: el dibujo {m.mode === 'centered' ? 'centrado' : 'centrado y reescalado a 10×14'}.
              </p>
            </div>
          )}
          {m.mode === 'scanner' && reading.at && (
            <p className={styles.muted}>
              El recuadro marca dónde encaja mejor la plantilla: columna {reading.at.x}, fila {reading.at.y}.
            </p>
          )}
        </section>

        {/* knobs */}
        <section className={`${styles.panel} ${styles.rack}`} aria-labelledby="pk-knobs">
          <div className={styles.rackHead}>
            <h2 id="pk-knobs">
              Pesos {dims.w}×{dims.h}
              {task === 'classify' && <span className={styles.unitTag}>unidad “{m.classes[unit]}”</span>}
            </h2>
            <div className={styles.seg}>
              <button className={view === 'knobs' ? styles.segOn : styles.segBtn} onClick={() => setView('knobs')}>
                Mandos
              </button>
              <button className={view === 'map' ? styles.segOn : styles.segBtn} onClick={() => setView('map')}>
                Mapa
              </button>
            </div>
          </div>
          <div
            className={`${styles.board} ${m.mode === 'scanner' ? styles.boardScan : ''}`}
            style={{ gridTemplateColumns: `repeat(${dims.w}, minmax(0, 1fr))` }}
          >
            {view === 'knobs'
              ? Array.from(weights, (w, i) => (
                  <Knob
                    key={i}
                    index={i}
                    value={w}
                    min={-WMAX}
                    max={WMAX}
                    step={0.05}
                    active={!!reading.input[i]}
                    flash={flashFor && flashFor.input[i] ? flashFor.dir : 0}
                    label={`Peso fila ${Math.floor(i / dims.w) + 1}, columna ${(i % dims.w) + 1}`}
                    format={fmtW}
                    onChange={onKnob}
                  />
                ))
              : Array.from(weights, (w, i) => (
                  <span
                    key={i}
                    className={`${styles.mapCell} ${reading.input[i] ? styles.mapLit : ''}`}
                    style={{ background: w > 0 ? `rgba(46, 230, 140, ${w})` : w < 0 ? `rgba(255, 77, 77, ${-w})` : undefined }}
                    title={`${fmtW(w)}`}
                  />
                ))}
          </div>
          <p className={styles.legend}>
            <span className={styles.legPos} /> suma <span className={styles.legNeg} /> resta <span className={styles.legLit} /> entrada
            encendida · arrastra, rueda o flechas · doble clic = 0 · Mayús = ajuste fino
          </p>
        </section>

        {/* meter */}
        <section className={styles.panel} aria-labelledby="pk-meter">
          <h2 id="pk-meter">Salida {task === 'classify' && <span className={styles.unitTag}>unidad “{m.classes[unit]}”</span>}</h2>
          <Voltmeter value={reading.sum} theta={m.thetas[unit]} range={range} />
          <div className={styles.readout}>
            <span>
              Σ = <b>{reading.sum.toFixed(2)}</b>
            </span>
            <span>
              θ = <b>{m.thetas[unit].toFixed(2)}</b>
            </span>
            <span className={styles.rangeSwitch} title="Escala del voltímetro">
              {RANGES.map((r) => (
                <button key={r} className={range === r ? styles.segOn : styles.segBtn} onClick={() => setRange(r)}>
                  ±{r}
                </button>
              ))}
            </span>
          </div>
          <div className={styles.thetaRow}>
            <Knob
              index={0}
              value={m.thetas[unit]}
              min={-THETA_MAX}
              max={THETA_MAX}
              step={0.1}
              label="Umbral θ"
              format={(v) => v.toFixed(1)}
              onChange={onTheta}
              className={styles.thetaKnob}
            />
            <div>
              <div className={styles.thetaLabel}>UMBRAL θ</div>
              <Lamp on={lampOn} label={task === 'detect' ? `¿Es ${unitName(0)}?` : `¿Gana “${m.classes[unit]}”?`} />
            </div>
          </div>
          <p className={styles.verdict} aria-live="polite">
            {task === 'detect' ? (
              <>
                Σ {fired ? '≥' : '<'} θ → la máquina dice <b>{answer}</b>
              </>
            ) : (
              <>
                Gana la unidad con más Σ − θ → la máquina dice <b>{answer}</b>
              </>
            )}
          </p>
          {task === 'classify' && (
            <div className={styles.bank} role="list" aria-label="Unidades del clasificador">
              {m.classes.map((c, k) => {
                const margin = decision.readings[k].sum - m.thetas[k];
                const pct = Math.max(-1, Math.min(1, margin / range)) * 50;
                return (
                  <button
                    key={c}
                    role="listitem"
                    className={`${styles.bankRow} ${k === unit ? styles.bankSel : ''} ${k === decision.winner ? styles.bankWin : ''}`}
                    onClick={() => setUnit(k)}
                    title={`Unidad ${c}: Σ − θ = ${margin.toFixed(2)}`}
                  >
                    <span className={styles.bankName}>{c}</span>
                    <span className={styles.bankBar}>
                      <span
                        className={margin >= 0 ? styles.bankPos : styles.bankNeg}
                        style={pct >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${-pct}%` }}
                      />
                    </span>
                    <span className={`${styles.miniLamp} ${k === decision.winner ? styles.lampOn : ''}`} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── training ── */}
      <section className={`${styles.panel} ${styles.training}`} aria-labelledby="pk-train">
        <div className={styles.trainCol}>
          <h2 id="pk-train">Entrenamiento</h2>
          <div className={styles.seg} role="radiogroup" aria-label="Tarea">
            <button
              role="radio"
              aria-checked={task === 'detect'}
              className={task === 'detect' ? styles.segOn : styles.segBtn}
              onClick={() => task !== 'detect' && reset(m.mode, [m.classes[unit]])}
            >
              Detector
            </button>
            <button
              role="radio"
              aria-checked={task === 'classify'}
              className={task === 'classify' ? styles.segOn : styles.segBtn}
              onClick={() => task !== 'classify' && reset(m.mode, family === 'digits' ? DIGITS : LETTERS)}
            >
              Clasificador
            </button>
          </div>
          {task === 'detect' ? (
            <label className={styles.field}>
              Detectar
              <select className={styles.select} value={m.classes[0]} onChange={(e) => reset(m.mode, [e.target.value])}>
                <CharOptions />
              </select>
              <span className={styles.muted}>frente al resto de {family === 'digits' ? 'dígitos' : 'letras'}</span>
            </label>
          ) : (
            <label className={styles.field}>
              Clases
              <select
                className={styles.select}
                value={family}
                onChange={(e) => reset(m.mode, e.target.value === 'digits' ? DIGITS : LETTERS)}
              >
                <option value="digits">Dígitos 0–9 (10 unidades)</option>
                <option value="letters">Letras A–Z (26 unidades)</option>
              </select>
            </label>
          )}
          <label className={styles.check}>
            <input type="checkbox" checked={variants} onChange={(e) => setVariants(e.target.checked)} /> Negrita y cursiva en los
            datos
          </label>
          <label className={styles.field}>
            Ruido {noise} %
            <input type="range" min={0} max={10} value={noise} onChange={(e) => setNoise(+e.target.value)} />
          </label>
          <button className={styles.btn} onClick={regenerate}>
            <FaDice /> Generar {N_TRAIN} + {N_TEST} ejemplos
          </button>
          <label className={styles.field}>
            Tasa de aprendizaje η = {eta.toFixed(2)}
            <input type="range" min={0.05} max={0.5} step={0.05} value={eta} onChange={(e) => setEta(+e.target.value)} />
          </label>
        </div>

        <div className={styles.trainCol}>
          <div className={styles.transport}>
            {([1, 10, 100] as const).map((s) => (
              <button
                key={s}
                className={speed === s ? styles.playOn : styles.play}
                onClick={() => play(s)}
                disabled={!data}
                title={speed === s ? 'Pausa' : `Entrenar a ×${s}`}
              >
                {speed === s ? <FaPause /> : <FaPlay />} ×{s}
              </button>
            ))}
            <button
              className={styles.play}
              onClick={() => {
                setSpeed(0);
                if (stats.done) setStats({ ...stats, done: '' });
                trainSteps(1, true);
              }}
              disabled={!data}
              title="Un ejemplo"
            >
              <FaStepForward /> Paso
            </button>
            <button
              className={styles.play}
              onClick={() => {
                sfx.click();
                reset(m.mode, m.classes);
              }}
              title="Todos los mandos a cero"
            >
              <FaUndo /> A cero
            </button>
            <button
              className={styles.play}
              onClick={() => {
                sfx.click();
                const r = rng(Date.now());
                m.weights.forEach((w) => w.forEach((_, i) => (w[i] = Math.round((r() * 2 - 1) * 0.5 * 20) / 20)));
                m.thetas = m.thetas.map(() => 0);
                setStats(freshStats());
                bump();
              }}
              title="Mandos al azar"
            >
              <FaDice /> Al azar
            </button>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Época</dt>
              <dd>{stats.epoch}</dd>
            </div>
            <div>
              <dt>Ejemplos vistos</dt>
              <dd>{stats.seen}</dd>
            </div>
            <div>
              <dt>Errores en la época</dt>
              <dd>{stats.epochErrors}</dd>
            </div>
            <div>
              <dt>Precisión (prueba)</dt>
              <dd>{lastPoint ? `${Math.round(lastPoint.test * 100)} %` : '—'}</dd>
            </div>
          </dl>
          <div className={styles.rule}>
            <code>
              {task === 'detect' ? 'si se equivoca:  w ← w + η·(t − y)·x   θ ← θ − η·(t − y)' : 'si se equivoca:  w_correcta += η·x   w_ganadora −= η·x'}
            </code>
            {last ? (
              <p className={last.correct ? styles.ok : styles.bad}>{last.text}</p>
            ) : (
              <p className={styles.muted}>Pulsa «Paso» para ver la regla aplicada a un ejemplo.</p>
            )}
            {stats.done === 'converged' && (
              <p className={styles.ok}>
                ¡Época sin errores! Ha separado los datos de entrenamiento. Mira la curva de prueba: ¿generaliza igual de bien?
              </p>
            )}
            {stats.done === 'gaveup' && (
              <p className={styles.bad}>
                {MAX_EPOCHS} épocas y sigue fallando: con este cableado los datos no son linealmente separables. Prueba otro modo.
              </p>
            )}
          </div>
        </div>

        <div className={styles.trainCol}>
          <AccuracyChart points={stats.points} />
          {data && (
            <div className={styles.samples} aria-label="Muestra del conjunto de prueba">
              {sampleRow.map((e, i) => {
                const ok = isCorrect(m, decide(m, e.grid), e);
                return (
                  <button key={i} className={styles.sampleBtn} onClick={() => setRetina(e.grid)}>
                    <Thumb grid={e.grid} ok={ok} title={`${e.ch}${task === 'detect' ? (e.target ? ' (sí)' : ' (no)') : ''}: ${ok ? 'acierta' : 'falla'}`} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <details className={styles.howto}>
        <summary>¿Cómo funciona?</summary>
        <ol>
          <li>
            Cada celda encendida de la retina vale <b>x = 1</b>; apagada, <b>x = 0</b>. Cada mando es un peso <b>w</b> entre −1 y +1.
          </li>
          <li>
            El voltímetro marca la suma <b>Σ = Σ wᵢ·xᵢ</b>: solo cuentan los mandos de las celdas encendidas (los que brillan).
          </li>
          <li>
            Si Σ supera el umbral <b>θ</b>, la lámpara se enciende. Eso es todo lo que sabe hacer una neurona artificial.
          </li>
          <li>
            Al entrenar, cada vez que la máquina falla, la regla de Rosenblatt gira un poco (η) los mandos de las celdas encendidas:
            hacia arriba si debía encenderse, hacia abajo si no. Si los datos se pueden separar con una recta (un hiperplano), está
            garantizado que acaba sin errores.
          </li>
          <li>
            El <b>clasificador</b> tiene una unidad por clase; gana la que más supera su umbral. Al fallar, refuerza la correcta y
            castiga a la que ganó.
          </li>
          <li>
            Los modos muestran por qué importa el preprocesado: el MARK I confunde un carácter desplazado con otro; centrar,
            normalizar el tamaño o escanear con una plantilla hacen el problema mucho más fácil.
          </li>
          <li>
            ¿Y si la máquina aprendiera ella misma ese preprocesado? Es lo que hace una{' '}
            <a href={useBaseUrl('/cnn')}>red convolucional</a>: muchos filtros pequeños que recorren la imagen, apilados en capas.
          </li>
        </ol>
      </details>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function describe(m: Machine, step: ReturnType<typeof learn>, ex: Example, eta: number): string {
  if (step.correct) {
    return isClassifier(m)
      ? `Era «${ex.ch}» y ganó «${ex.ch}»: acierto, los mandos no se tocan.`
      : `«${ex.ch}» ${ex.target ? 'debía encender' : 'no debía encender'} la lámpara y así fue: acierto, nada cambia.`;
  }
  const lit = (u: number) => step.decision.readings[u].input.reduce((a, b) => a + b, 0);
  if (isClassifier(m)) {
    const w = m.classes[step.decision.winner];
    return `Era «${ex.ch}» pero ganó «${w}»: +${eta.toFixed(2)} a ${lit(m.classes.indexOf(ex.ch))} mandos de «${ex.ch}» y −${eta.toFixed(2)} a ${lit(step.decision.winner)} de «${w}».`;
  }
  const t = ex.target ? 1 : 0;
  return `«${ex.ch}»: t = ${t}, y = ${1 - t} → ${t ? '+' : '−'}${eta.toFixed(2)} a ${lit(0)} mandos encendidos, θ ${t ? '−' : '+'}${eta.toFixed(2)}.`;
}
