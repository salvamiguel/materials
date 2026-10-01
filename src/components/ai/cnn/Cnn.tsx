import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  FaBolt,
  FaDice,
  FaDownload,
  FaFolderOpen,
  FaPause,
  FaPlay,
  FaSearch,
  FaShareAlt,
  FaStepForward,
  FaStop,
  FaVolumeMute,
  FaVolumeUp,
} from 'react-icons/fa';

import AccuracyChart, { type Point } from '../perceptron/AccuracyChart';
import DrawTools, { SIZES } from '../perceptron/DrawTools';
import { isMuted, setMuted, sfx } from '../perceptron/chiptune';
import Knob, { KnobDefs } from '../perceptron/Knob';
import { DIGITS, GRID, LETTERS, bbox, makeClassDataset, renderGlyph, rng, shift, type Example, type Grid } from '../perceptron/model';
import Retina, { Thumb } from '../perceptron/Retina';
import ps from '../perceptron/perceptron.module.css';
import FeatureMap, { maxAbs } from './FeatureMap';
import {
  ARCHS,
  KMAX,
  PRESETS,
  applyPreset,
  evaluate,
  forward,
  fromJSON,
  fromShareCode,
  magnify,
  newNet,
  shareCode,
  toJSON,
  trainStep,
  type ArchId,
  type Net,
  type StepResult,
} from './model';
import cs from './cnn.module.css';

type Speed = 0 | 1 | 10 | 100;

/** Examples per class: CNNs need more data than a perceptron with hand-made preprocessing. */
const TRAIN_PER_CLASS = 60;
const TEST_PER_CLASS = 20;
const MAX_EPOCHS = 40;
const BASE_RATE = 3;
const POINT_EVERY = 200;
const STORE = 'cnn:net';

interface Data {
  train: Example[];
  test: Example[];
}

interface Stats {
  epoch: number;
  cursor: number;
  seen: number;
  epochLoss: number;
  epochCount: number;
  points: Point[];
  done: '' | 'converged' | 'gaveup';
}

const freshStats = (): Stats => ({ epoch: 0, cursor: 0, seen: 0, epochLoss: 0, epochCount: 0, points: [], done: '' });

function store(fn: () => void) {
  try {
    fn();
  } catch {
    /* private mode or blocked storage: the demo works without it */
  }
}

/** Data augmentation: move the drawing up to 2 cells, never off the retina. */
function jitter(g: Grid, r: () => number): Grid {
  const b = bbox(g);
  if (!b) return g;
  const pick = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const dx = pick(Math.max(-2, -b.x0), Math.min(2, GRID - 1 - b.x1));
  const dy = pick(Math.max(-2, -b.y0), Math.min(2, GRID - 1 - b.y1));
  return dx || dy ? shift(g, dx, dy) : g;
}

const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
const pct = (p: number) => `${Math.round(p * 100)} %`;

export default function Cnn() {
  const [powered, setPowered] = useState(false);
  const [muted, setMute] = useState(isMuted());

  // The network is mutated in place (knobs, training); `rev` re-renders it.
  const net = useRef<Net>(newNet('lenet', DIGITS, 1));
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const n = net.current;

  const [retina, setRetina] = useState<Grid>(() => renderGlyph('3', { ...SIZES.L, x: 3, y: 1, bold: true, italic: 0 }));
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [focus, setFocus] = useState({ f: 0, x: 7, y: 5 });
  const [scan, setScan] = useState<number | null>(null);

  const [variants, setVariants] = useState(true);
  const [noise, setNoise] = useState(0);
  const [augment, setAugment] = useState(false);
  const [freeze, setFreeze] = useState(false);
  const [lr, setLr] = useState(0.02);
  const seed = useRef(1);
  const [data, setData] = useState<Data | null>(null);
  const [stats, setStats] = useState<Stats>(freshStats);
  const [speed, setSpeed] = useState<Speed>(0);
  const [last, setLast] = useState<{ correct: boolean; text: string } | null>(null);
  const [toast, setToast] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? '' : x)), 2600);
  }, []);

  // ── installing a network (new architecture, new classes, a loaded file…) ──

  const makeData = useCallback(
    (classes: string[]): Data => {
      const s = seed.current++;
      const o = { variants, noise: noise / 100 };
      return {
        train: makeClassDataset(classes, TRAIN_PER_CLASS * classes.length, s * 2, o),
        test: makeClassDataset(classes, TEST_PER_CLASS * classes.length, s * 2 + 1, o),
      };
    },
    [variants, noise],
  );

  const install = useCallback(
    (next: Net) => {
      const sameClasses = net.current.classes.join() === next.classes.join();
      net.current = next;
      setSpeed(0);
      setScan(null);
      setStats(freshStats());
      setLast(null);
      setFocus((f) => ({ ...f, f: Math.min(f.f, next.layers[0].cout - 1) }));
      if (!sameClasses || !data) setData(makeData(next.classes));
      bump();
    },
    [bump, makeData, data],
  );

  const reset = (arch: ArchId, classes: string[]) => install(newNet(arch, classes, Date.now() >>> 0));

  // Restore: a shared link wins over the copy kept in this browser.
  useEffect(() => {
    const hash = window.location.hash.match(/[#&]w=([A-Za-z0-9_-]+)/);
    if (hash) {
      fromShareCode(hash[1])
        .then((x) => {
          install(x);
          say('Pesos cargados desde el enlace');
        })
        .catch(() => {
          setData(makeData(n.classes));
          say('El enlace no contiene pesos válidos');
        });
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
    setData(makeData(n.classes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => store(() => window.localStorage.setItem(STORE, toJSON(net.current))), 800);
    return () => window.clearTimeout(t);
  }, [rev]);

  // ── first-layer knobs ──

  const onWeight = useCallback(
    (i: number, v: number) => {
      net.current.layers[0].w[i] = v;
      bump();
    },
    [bump],
  );
  const onBias = useCallback(
    (f: number, v: number) => {
      net.current.layers[0].b[f] = v;
      bump();
    },
    [bump],
  );

  // ── reading the retina ──

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const act = useMemo(() => forward(n, retina), [n, retina, rev]);
  const L0 = n.layers[0];
  const A0 = act.layers[0];
  const SS0 = L0.size * L0.size;
  const T0 = L0.size / L0.pool;
  const zScale0 = Math.max(0.5, maxAbs(A0.z));
  const aScale0 = Math.max(0.5, maxAbs(A0.a));
  const mag = magnify(n, retina, focus.f, focus.x, focus.y);

  const prevWinner = useRef(act.winner);
  useEffect(() => {
    if (powered && !speed && act.winner !== prevWinner.current) sfx.on();
    prevWinner.current = act.winner;
  }, [act.winner, powered, speed]);

  // ── sweeping a filter over the retina ──

  useEffect(() => {
    if (scan === null) return;
    const id = window.setInterval(() => setScan((s) => (s === null || s >= GRID * GRID ? null : s + 1)), 28);
    return () => window.clearInterval(id);
  }, [scan === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // The magnifier follows the sweep; cells up to it are revealed on the maps.
  useEffect(() => {
    if (scan) setFocus((f) => ({ ...f, x: (scan - 1) % GRID, y: Math.floor((scan - 1) / GRID) }));
  }, [scan]);

  useEffect(() => {
    if (scan !== null && mag.a > 0) sfx.pixel(true);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── training ──

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const dataRef = useRef(data);
  dataRef.current = data;
  const augRng = useRef(rng(7));

  const trainSteps = useCallback(
    (count: number, verbose: boolean): boolean => {
      const d = dataRef.current;
      if (!d) return false;
      const nn = net.current;
      const s = { ...statsRef.current };
      let lastStep: StepResult | null = null;
      let shown: Example | null = null;
      let keepGoing = true;
      for (let k = 0; k < count && keepGoing; k++) {
        const base = d.train[s.cursor];
        const ex = augment ? { ...base, grid: jitter(base.grid, augRng.current) } : base;
        lastStep = trainStep(nn, ex, lr, { freezeFirst: freeze });
        shown = ex;
        s.epochLoss += lastStep.loss;
        s.epochCount++;
        s.cursor++;
        s.seen++;
        const epochEnd = s.cursor >= d.train.length;
        if (epochEnd || s.seen % POINT_EVERY === 0) {
          const tr = evaluate(nn, d.train), te = evaluate(nn, d.test);
          s.points = [...s.points, { seen: s.seen, train: tr.accuracy, test: te.accuracy }];
          if (epochEnd) {
            s.epoch++;
            if (tr.accuracy === 1) s.done = 'converged';
            else if (s.epoch >= MAX_EPOCHS) s.done = 'gaveup';
            if (s.done === 'converged') sfx.win();
            else if (!verbose) sfx.epoch(tr.accuracy);
            s.cursor = 0;
            s.epochLoss = 0;
            s.epochCount = 0;
            if (s.done) keepGoing = false;
          }
        }
      }
      if (lastStep && shown) {
        setRetina(shown.grid);
        if (verbose) (lastStep.correct ? sfx.ok : sfx.error)();
        setLast({ correct: lastStep.correct, text: describe(nn, lastStep, shown, freeze) });
      }
      setStats(s);
      bump();
      return keepGoing;
    },
    [bump, lr, freeze, augment],
  );

  useEffect(() => {
    if (!speed) return;
    let budget = 1;
    const id = window.setInterval(() => {
      budget += (BASE_RATE * speed) / 20;
      const k = Math.floor(budget);
      if (!k) return;
      budget -= k;
      if (!trainSteps(k, speed === 1)) setSpeed(0);
    }, 50);
    return () => window.clearInterval(id);
  }, [speed, trainSteps]);

  const play = (s: Speed) => {
    sfx.click();
    setScan(null);
    if (stats.done) setStats({ ...stats, done: '' });
    setSpeed((cur) => (cur === s ? 0 : s));
  };

  const regenerate = () => {
    sfx.click();
    setSpeed(0);
    setData(makeData(n.classes));
    setStats(freshStats());
  };

  // ── sharing ──

  const share = async () => {
    sfx.click();
    const code = await shareCode(n);
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
    const blob = new Blob([toJSON(n)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cnn-${n.arch}-${n.classes.length}clases.json`;
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

  // ── derived view data ──

  const archInfo = ARCHS[n.arch];
  const family = DIGITS.includes(n.classes[0]) ? 'digits' : 'letters';
  const lastPoint = stats.points[stats.points.length - 1];
  const L1 = n.layers[1];
  const A1 = act.layers[1];
  const winP = act.probs[act.winner];
  const order = useMemo(() => n.classes.map((_, i) => i), [n.classes]);

  return (
    <div className={ps.root}>
      <KnobDefs />

      {!powered && (
        <div className={ps.splash}>
          <div className={ps.splashCard}>
            <span className={ps.badge}>Bell Labs · 1989</span>
            <h1>Red convolucional</h1>
            <p>
              En 1989, Yann LeCun y su equipo de Bell Labs entrenaron una red que <b>leía los códigos postales escritos a mano</b> en
              los sobres. Su idea: en vez de un peso por píxel, como el perceptrón, usar <b>filtros pequeños</b> que recorren toda la
              imagen buscando el mismo rasgo (un trazo, una esquina) esté donde esté.
            </p>
            <p>
              Diseña tus propios filtros con los mandos, mira qué encienden en cada mapa y después deja que la retropropagación
              los aprenda sola.
            </p>
            <button
              className={ps.power}
              onClick={() => {
                setPowered(true);
                sfx.power();
              }}
              autoFocus
            >
              <FaBolt /> Encender la red
            </button>
          </div>
        </div>
      )}

      {/* ── top bar ── */}
      <header className={ps.topbar}>
        <div className={ps.title}>
          <h1>Red convolucional</h1>
          <span className={ps.badge}>LeNet · 1989</span>
        </div>
        <div className={ps.modes} role="radiogroup" aria-label="Arquitectura">
          {(Object.keys(ARCHS) as ArchId[]).map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={n.arch === id}
              className={n.arch === id ? ps.modeOn : ps.mode}
              onClick={() => {
                if (n.arch === id) return;
                sfx.click();
                reset(id, n.classes);
              }}
              title={ARCHS[id].blurb}
            >
              {ARCHS[id].label}
              <small>{ARCHS[id].short}</small>
            </button>
          ))}
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
        <b>{archInfo.label}.</b> {archInfo.blurb} <span className={ps.muted}>Cambiar de arquitectura empieza con pesos al azar.</span>
      </p>

      <div className={cs.machine}>
        {/* ── retina + magnifier ── */}
        <section className={ps.panel} aria-labelledby="cn-retina">
          <h2 id="cn-retina">Imagen 16×16</h2>
          <Retina
            grid={retina}
            onChange={speed ? undefined : setRetina}
            tool={tool}
            window={{ x: focus.x - 1, y: focus.y - 1 }}
            windowSize={{ w: 3, h: 3 }}
            label="Imagen de entrada: dibuja con el ratón o el dedo"
          />
          <DrawTools
            retina={retina}
            setRetina={setRetina}
            tool={tool}
            setTool={setTool}
            fromSet={data ? () => setRetina(data.test[Math.floor(Math.random() * data.test.length)].grid) : undefined}
          />

          <div className={cs.lupa} aria-labelledby="cn-lupa">
            <h2 id="cn-lupa">
              <FaSearch /> Lupa · filtro {focus.f + 1} en ({focus.x}, {focus.y})
            </h2>
            <div className={cs.lupaGrid}>
              {mag.cells.map((c, i) => (
                <span
                  key={i}
                  className={`${cs.lupaCell} ${c.px ? cs.lupaOn : ''} ${!c.inside ? cs.lupaPad : ''}`}
                  title={c.inside ? `píxel ${c.px} × peso ${fmt(c.w)}` : 'fuera de la imagen (relleno con 0)'}
                >
                  <b>{c.px}</b>×<span className={c.w > 0 ? cs.wPos : c.w < 0 ? cs.wNeg : ''}>{c.w.toFixed(2)}</span>
                </span>
              ))}
            </div>
            <p className={cs.lupaSum}>
              Σ píxel·peso = <b>{(mag.z - mag.bias).toFixed(2)}</b>
              <br />+ sesgo {fmt(mag.bias)} = <b>z = {mag.z.toFixed(2)}</b>
              <br />
              ReLU: max(0, z) = <b className={mag.a > 0 ? cs.wPos : ''}>{mag.a.toFixed(2)}</b>
            </p>
            <div className={ps.toolRow}>
              {Array.from({ length: L0.cout }, (_, f) => (
                <button key={f} className={focus.f === f ? ps.toolOn : ps.tool} onClick={() => setFocus({ ...focus, f })}>
                  F{f + 1}
                </button>
              ))}
              <button
                className={scan !== null ? ps.toolOn : ps.tool}
                onClick={() => {
                  sfx.click();
                  setSpeed(0);
                  setScan((s) => (s === null ? 0 : null));
                }}
                title="Desliza el filtro por toda la imagen"
              >
                {scan !== null ? <FaStop /> : <FaPlay />} Recorrer
              </button>
            </div>
          </div>
        </section>

        {/* ── the network ── */}
        <section className={`${ps.panel} ${ps.rack} ${cs.rack}`} aria-labelledby="cn-net">
          <h2 id="cn-net">Capa 1 · {L0.cout} filtros 3×3</h2>
          <div className={cs.colHeads} aria-hidden="true">
            <span>Filtro (pesos + sesgo)</span>
            <span>Convolución z</span>
            <span>ReLU</span>
            <span>Max-pool {L0.pool}×{L0.pool}</span>
          </div>
          {Array.from({ length: L0.cout }, (_, f) => (
            <div key={f} className={`${cs.filterRow} ${focus.f === f ? cs.filterSel : ''}`}>
              <div className={cs.filterCtl}>
                <div className={cs.kernel}>
                  {Array.from({ length: 9 }, (_, j) => (
                    <Knob
                      key={j}
                      index={f * 9 + j}
                      value={L0.w[f * 9 + j]}
                      min={-KMAX}
                      max={KMAX}
                      step={0.05}
                      active={focus.f === f && !!mag.cells[j].px}
                      label={`Filtro ${f + 1}, peso fila ${Math.floor(j / 3) + 1}, columna ${(j % 3) + 1}`}
                      format={fmt}
                      onChange={onWeight}
                    />
                  ))}
                </div>
                <div className={cs.biasBox}>
                  <Knob index={f} value={L0.b[f]} min={-KMAX} max={KMAX} step={0.05} label={`Sesgo del filtro ${f + 1}`} format={fmt} onChange={onBias} />
                  <span>sesgo</span>
                  <select
                    className={cs.preset}
                    value=""
                    onChange={(e) => {
                      applyPreset(n, f, e.target.value);
                      sfx.click();
                      setFocus({ ...focus, f });
                      bump();
                    }}
                    aria-label={`Cargar un filtro hecho a mano en el filtro ${f + 1}`}
                  >
                    <option value="">Preset…</option>
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <FeatureMap
                data={A0.z.subarray(f * SS0, (f + 1) * SS0)}
                size={L0.size}
                scale={zScale0}
                signed
                reveal={scan !== null && focus.f === f ? scan : undefined}
                mark={focus.f === f ? { x: focus.x, y: focus.y } : undefined}
                onPick={(x, y) => {
                  setScan(null);
                  setFocus({ f, x, y });
                }}
                label={`Mapa de convolución del filtro ${f + 1}`}
              />
              <FeatureMap
                data={A0.a.subarray(f * SS0, (f + 1) * SS0)}
                size={L0.size}
                scale={aScale0}
                reveal={scan !== null && focus.f === f ? scan : undefined}
                onPick={(x, y) => {
                  setScan(null);
                  setFocus({ f, x, y });
                }}
                label={`Mapa tras ReLU del filtro ${f + 1}`}
              />
              <FeatureMap
                data={A0.pool.subarray(f * T0 * T0, (f + 1) * T0 * T0)}
                size={T0}
                scale={aScale0}
                mark={focus.f === f ? { x: Math.floor(focus.x / L0.pool), y: Math.floor(focus.y / L0.pool) } : undefined}
                label={`Mapa reducido del filtro ${f + 1}`}
              />
            </div>
          ))}

          {L1 && A1 && (
            <>
              <h2>
                Capa 2 · {L1.cout} filtros 3×3×{L1.cin}
              </h2>
              <p className={cs.note}>
                Cada filtro de la segunda capa mira a la vez los {L1.cin} mapas reducidos de la capa 1 (una columna de 3×3 por mapa)
                y responde a combinaciones: «trazo vertical arriba y horizontal abajo»…
              </p>
              <div className={cs.layer2}>
                {Array.from({ length: L1.cout }, (_, o) => {
                  const SS1 = L1.size * L1.size, T1 = L1.size / L1.pool;
                  const ws = L1.w.subarray(o * L1.cin * 9, (o + 1) * L1.cin * 9);
                  const wScale = maxAbs(L1.w);
                  return (
                    <div key={o} className={cs.l2Card}>
                      <span className={cs.l2Name}>G{o + 1}</span>
                      <div className={cs.l2Kernels}>
                        {Array.from({ length: L1.cin }, (_, i) => (
                          <FeatureMap key={i} data={ws.subarray(i * 9, (i + 1) * 9)} size={3} scale={wScale} signed label={`Pesos de G${o + 1} sobre el mapa F${i + 1}`} />
                        ))}
                      </div>
                      <FeatureMap
                        data={A1.a.subarray(o * SS1, (o + 1) * SS1)}
                        size={L1.size}
                        scale={Math.max(0.5, maxAbs(A1.a))}
                        label={`Mapa tras ReLU de G${o + 1}`}
                      />
                      <FeatureMap
                        data={A1.pool.subarray(o * T1 * T1, (o + 1) * T1 * T1)}
                        size={T1}
                        scale={Math.max(0.5, maxAbs(A1.a))}
                        label={`Mapa reducido de G${o + 1}`}
                        className={cs.tiny}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className={cs.flatten}>
            <span>
              Aplanar → <b>{n.features}</b> números → capa densa ({n.features}×{n.classes.length} pesos) → softmax
            </span>
            <div className={cs.featStrip} aria-label="Vector de características">
              {Array.from(act.features, (v, i) => (
                <span key={i} style={{ opacity: 0.15 + 0.85 * Math.min(1, v / Math.max(0.5, maxAbs(act.features))) }} />
              ))}
            </div>
          </div>
        </section>

        {/* ── output ── */}
        <section className={ps.panel} aria-labelledby="cn-out">
          <h2 id="cn-out">Salida · softmax</h2>
          <div className={cs.answer} aria-live="polite">
            <span className={`${ps.lamp} ${ps.lampOn}`} aria-hidden="true" />
            <span>
              La red dice <b className={cs.answerCh}>{n.classes[act.winner]}</b>
              <small>con un {pct(winP)} de probabilidad</small>
            </span>
          </div>
          <div className={cs.probs} role="list" aria-label="Probabilidad de cada clase">
            {order.map((c) => (
              <div key={c} role="listitem" className={`${cs.probRow} ${c === act.winner ? cs.probWin : ''}`}>
                <span className={cs.probName}>{n.classes[c]}</span>
                <span className={cs.probBar}>
                  <span style={{ width: `${act.probs[c] * 100}%` }} />
                </span>
                <span className={cs.probPct}>{pct(act.probs[c])}</span>
              </div>
            ))}
          </div>
          <p className={ps.muted}>
            Softmax convierte las puntuaciones (logits) en probabilidades que suman 100 %. La red elige la mayor.
          </p>
        </section>
      </div>

      {/* ── training ── */}
      <section className={`${ps.panel} ${ps.training}`} aria-labelledby="cn-train">
        <div className={ps.trainCol}>
          <h2 id="cn-train">Entrenamiento</h2>
          <label className={ps.field}>
            Clases
            <select className={ps.select} value={family} onChange={(e) => reset(n.arch, e.target.value === 'digits' ? DIGITS : LETTERS)}>
              <option value="digits">Dígitos 0–9 (10 clases)</option>
              <option value="letters">Letras A–Z (26 clases)</option>
            </select>
          </label>
          <label className={ps.check}>
            <input type="checkbox" checked={variants} onChange={(e) => setVariants(e.target.checked)} /> Negrita y cursiva en los datos
          </label>
          <label className={ps.field}>
            Ruido {noise} %
            <input type="range" min={0} max={10} value={noise} onChange={(e) => setNoise(+e.target.value)} />
          </label>
          <button className={ps.btn} onClick={regenerate}>
            <FaDice /> Generar {TRAIN_PER_CLASS * n.classes.length} + {TEST_PER_CLASS * n.classes.length} ejemplos
          </button>
          <label className={ps.check} title="Cada vez que la red ve un ejemplo, se desplaza hasta 2 celdas al azar">
            <input type="checkbox" checked={augment} onChange={(e) => setAugment(e.target.checked)} /> Aumento de datos (desplazar ±2)
          </label>
          <label className={ps.check} title="Solo aprenden las capas siguientes: tus filtros hechos a mano se quedan como están">
            <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} /> Congelar la capa 1 (mis filtros)
          </label>
          <label className={ps.field}>
            Tasa de aprendizaje η = {lr.toFixed(3)}
            <input type="range" min={0.005} max={0.1} step={0.005} value={lr} onChange={(e) => setLr(+e.target.value)} />
          </label>
        </div>

        <div className={ps.trainCol}>
          <div className={ps.transport}>
            {([1, 10, 100] as const).map((s) => (
              <button
                key={s}
                className={speed === s ? ps.playOn : ps.play}
                onClick={() => play(s)}
                disabled={!data}
                title={speed === s ? 'Pausa' : `Entrenar a ×${s}`}
              >
                {speed === s ? <FaPause /> : <FaPlay />} ×{s}
              </button>
            ))}
            <button
              className={ps.play}
              onClick={() => {
                setSpeed(0);
                setScan(null);
                if (stats.done) setStats({ ...stats, done: '' });
                trainSteps(1, true);
              }}
              disabled={!data}
              title="Un ejemplo"
            >
              <FaStepForward /> Paso
            </button>
            <button
              className={ps.play}
              onClick={() => {
                sfx.click();
                reset(n.arch, n.classes);
              }}
              title="Pesos al azar: empezar de nuevo"
            >
              <FaDice /> Reiniciar
            </button>
          </div>
          <dl className={ps.stats}>
            <div>
              <dt>Época</dt>
              <dd>{stats.epoch}</dd>
            </div>
            <div>
              <dt>Ejemplos vistos</dt>
              <dd>{stats.seen}</dd>
            </div>
            <div>
              <dt>Pérdida media (época)</dt>
              <dd>{stats.epochCount ? (stats.epochLoss / stats.epochCount).toFixed(2) : '—'}</dd>
            </div>
            <div>
              <dt>Precisión (prueba)</dt>
              <dd>{lastPoint ? pct(lastPoint.test) : '—'}</dd>
            </div>
          </dl>
          <div className={ps.rule}>
            <code>{'pérdida = −ln p(clase correcta)      w ← w − η · ∂pérdida/∂w'}</code>
            {last ? (
              <p className={last.correct ? ps.ok : ps.bad}>{last.text}</p>
            ) : (
              <p className={ps.muted}>Pulsa «Paso» para ver un paso de descenso de gradiente sobre un ejemplo.</p>
            )}
            {stats.done === 'converged' && (
              <p className={ps.ok}>¡Época perfecta en entrenamiento! Mira la curva de prueba: ¿generaliza igual de bien?</p>
            )}
            {stats.done === 'gaveup' && (
              <p className={ps.bad}>{MAX_EPOCHS} épocas. Prueba otra arquitectura, más datos o aumento de datos.</p>
            )}
          </div>
        </div>

        <div className={ps.trainCol}>
          <AccuracyChart points={stats.points} />
          {data && (
            <div className={ps.samples} aria-label="Muestra del conjunto de prueba">
              {data.test.slice(0, 24).map((e, i) => {
                const ok = forward(n, e.grid).winner === n.classes.indexOf(e.ch);
                return (
                  <button key={i} className={ps.sampleBtn} onClick={() => setRetina(e.grid)}>
                    <Thumb grid={e.grid} ok={ok} title={`${e.ch}: ${ok ? 'acierta' : 'falla'}`} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <details className={ps.howto}>
        <summary>¿Cómo funciona?</summary>
        <ol>
          <li>
            Un <b>filtro</b> son 9 pesos y un sesgo. Se coloca sobre cada píxel, multiplica los 3×3 píxeles de alrededor por sus
            pesos, suma y añade el sesgo: eso es la <b>convolución</b>. Usa la lupa o «Recorrer» para verlo paso a paso.
          </li>
          <li>
            El resultado es un <b>mapa</b> que se ilumina donde aparece el rasgo que busca el filtro. Como el mismo filtro recorre
            toda la imagen, encuentra el rasgo esté donde esté (el perceptrón tenía un peso distinto para cada píxel).
          </li>
          <li>
            <b>ReLU</b> deja pasar solo lo positivo y el <b>max-pool</b> se queda con el valor más alto de cada bloque: el mapa
            encoge y un pequeño desplazamiento del dibujo ya no cambia el resultado.
          </li>
          <li>
            La <b>segunda capa</b> aplica filtros sobre los mapas de la primera: combina trazos en formas. Al final, una capa
            densa puntúa cada clase y <b>softmax</b> convierte las puntuaciones en probabilidades.
          </li>
          <li>
            Para entrenar, la <b>retropropagación</b> calcula cuánto contribuyó cada peso al error (la pérdida) y el{' '}
            <b>descenso de gradiente</b> mueve todos los pesos un poco (η) en la dirección que lo reduce. Los filtros que
            diseñabas a mano aparecen solos.
          </li>
          <li>
            Experimenta: diseña filtros con los presets, congela la capa 1 y entrena solo el resto; compara 1 y 2 capas; activa
            el aumento de datos. ¿Cuál generaliza mejor en el conjunto de prueba?
          </li>
          <li>
            Compárala con el <a href={useBaseUrl('/perceptron')}>perceptrón</a> con los mismos dígitos: allí había que centrar
            y reescalar el dibujo a mano para que funcionara; aquí la red aprende a tolerar los desplazamientos.
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

function describe(n: Net, step: StepResult, ex: Example, frozen: boolean): string {
  const said = n.classes[step.act.winner];
  const p = step.act.probs[step.label];
  const params = n.layers.reduce((a, L, i) => a + (frozen && i === 0 ? 0 : L.w.length + L.b.length), 0) + n.dense.length + n.dbias.length;
  const head = step.correct
    ? `Era «${ex.ch}» y la red dijo «${said}»`
    : `Era «${ex.ch}» pero la red dijo «${said}»`;
  return `${head} (p(«${ex.ch}») = ${pct(p)}). Pérdida = −ln ${p.toFixed(2)} = ${step.loss.toFixed(2)}. El gradiente ajusta ${params} pesos${frozen ? ' (la capa 1 está congelada)' : ''}.`;
}
