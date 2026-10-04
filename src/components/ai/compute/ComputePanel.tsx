import React, { useState } from 'react';
import { FaMicrochip, FaStop, FaTachometerAlt } from 'react-icons/fa';

import ps from '../perceptron/perceptron.module.css';
import type { Backend, BenchRow, Perf } from './host';
import type { EngineStatus } from './useTrainer';
import cs from './compute.module.css';

/* "Motor de cálculo": where the training runs (CPU or GPU), how big the model
 * is and how many examples go in each batch, how fast it is going, and a
 * benchmark that times every size on both engines with throwaway models, so
 * the crossover where the GPU starts to win is there to see. */

export interface SizeOption {
  value: number;
  label: string;
  /** Trainable weights at this size. */
  weights: number;
  /** Not available in the current configuration, and why. */
  disabled?: string;
}

interface Props {
  sizes: SizeOption[];
  size: number;
  onSize: (v: number) => void;
  status: EngineStatus;
  onBackend: (b: Backend) => void;
  batch: number;
  batches: number[];
  onBatch: (b: number) => void;
  perf: { value: Perf; running: boolean };
  bench: { rows: BenchRow[]; running: boolean };
  onBench: () => void;
  onStopBench: () => void;
  /** What one "example" is: "ejemplos", "frases"… */
  unit: string;
}

const nf = (v: number) => v.toLocaleString('es', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 });
const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es', { maximumFractionDigits: 1 })} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : n.toLocaleString('es'));

export default function ComputePanel(p: Props) {
  const [check, setCheck] = useState<{ running: boolean; text: string } | null>(null);
  const gpuOk = p.status.backend === 'gpu' && !p.status.error;

  const selfTest = async () => {
    setCheck({ running: true, text: 'Comprobando…' });
    try {
      const { runSelfTest } = await import('../gpu/selftest');
      const res = await runSelfTest();
      const bad = res.filter((r) => !r.ok);
      setCheck({
        running: false,
        text: bad.length
          ? `✗ ${bad.length} de ${res.length} comprobaciones fallan: ${bad.map((b) => `${b.name} (${b.detail})`).join('; ')}`
          : `✓ ${res.length} comprobaciones: la GPU calcula lo mismo que la CPU (${res[0].detail}).`,
      });
    } catch (e) {
      setCheck({ running: false, text: `✗ ${(e as Error).message}` });
    }
  };

  return (
    <section className={`${ps.panel} ${cs.panel}`} aria-labelledby="cp-title">
      <div className={cs.controls}>
        <h2 id="cp-title">
          <FaMicrochip /> Motor de cálculo
        </h2>

        <div className={cs.field}>
          <span className={cs.label}>Dónde se entrena</span>
          <div className={ps.seg} role="radiogroup" aria-label="Motor">
            {(
              [
                ['cpu', 'CPU · JavaScript'],
                ['gpu', 'GPU · WebGPU'],
              ] as const
            ).map(([b, label]) => (
              <button key={b} role="radio" aria-checked={p.status.backend === b} className={p.status.backend === b ? ps.segOn : ps.segBtn} onClick={() => p.onBackend(b)} disabled={p.status.pending} aria-busy={p.status.pending && p.status.target === b}>
                {p.status.pending && p.status.target === b && <span className={cs.spinner} aria-hidden="true" />}
                {label}
              </button>
            ))}
          </div>
          <span className={cs.status} role="status" aria-live="polite">
            {p.status.pending
              ? p.status.target === 'gpu'
                ? 'Preparando la GPU: abriendo el dispositivo y compilando los kernels…'
                : 'Pasando a la CPU…'
              : p.status.error
                ? `GPU no disponible: ${p.status.error} Se usa la CPU.`
                : gpuOk
                  ? `En la GPU: ${p.status.gpu}.`
                  : 'En la CPU, con bucles de JavaScript.'}{' '}
            {p.status.worker ? 'Corre en un hilo aparte (Web Worker): la página no se congela.' : 'Este navegador no tiene Web Workers: corre en la página.'}
          </span>
        </div>

        <div className={cs.field}>
          <span className={cs.label}>Tamaño del modelo</span>
          <div className={cs.sizes} role="radiogroup" aria-label="Tamaño del modelo">
            {p.sizes.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={p.size === s.value}
                className={p.size === s.value ? cs.sizeOn : cs.size}
                onClick={() => p.onSize(s.value)}
                disabled={!!s.disabled}
                title={s.disabled ?? `${s.weights.toLocaleString('es')} pesos`}
              >
                <b>{s.label}</b>
                <small>{big(s.weights)} pesos</small>
              </button>
            ))}
          </div>
          <span className={cs.status}>Cambiar el tamaño empieza un modelo nuevo.</span>
        </div>

        <div className={cs.field}>
          <span className={cs.label}>Lote (ejemplos por paso)</span>
          <div className={ps.seg} role="radiogroup" aria-label="Tamaño del lote">
            {p.batches.map((b) => (
              <button key={b} role="radio" aria-checked={p.batch === b} className={p.batch === b ? ps.segOn : ps.segBtn} onClick={() => p.onBatch(b)}>
                {b}
              </button>
            ))}
          </div>
          <span className={cs.status}>La GPU necesita mucho trabajo a la vez para compensar el coste de mandárselo: lotes grandes.</span>
        </div>

        <div className={cs.speed} aria-live="polite">
          <FaTachometerAlt />
          {p.perf.running && p.perf.value.rate ? (
            <>
              <b>{nf(p.perf.value.rate)}</b> {p.unit}/s
              <small>{p.perf.value.msPerStep.toFixed(0)} ms por tanda</small>
            </>
          ) : (
            <span className={ps.muted}>Entrena para ver la velocidad.</span>
          )}
        </div>
      </div>

      <div className={cs.benchCol}>
        <div className={cs.benchHead}>
          <h2>¿CPU o GPU?</h2>
          {p.bench.running ? (
            <button className={ps.btn} onClick={p.onStopBench}>
              <FaStop /> Parar
            </button>
          ) : (
            <button className={ps.btn} onClick={p.onBench}>
              <FaTachometerAlt /> Comparar CPU y GPU
            </button>
          )}
        </div>
        <p className={cs.status}>
          Entrena cada tamaño unos segundos en cada motor, con lotes de {p.batch} y modelos de usar y tirar (tus pesos no se
          tocan). Mide el entrenamiento completo: hacia delante, hacia atrás y actualización.
        </p>
        <BenchChart rows={p.bench.rows} sizes={p.sizes} unit={p.unit} running={p.bench.running} />
        <button className={cs.linkBtn} onClick={selfTest} disabled={check?.running}>
          Comprobar que la GPU calcula lo mismo que la CPU
        </button>
        {check && <p className={cs.status}>{check.text}</p>}
      </div>
    </section>
  );
}

function BenchChart({ rows, sizes, unit, running }: { rows: BenchRow[]; sizes: SizeOption[]; unit: string; running: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const rates = rows.map((r) => r.rate).filter((v): v is number => !!v);
  if (!rows.length)
    return <div className={cs.empty}>{running ? 'Midiendo…' : 'Pulsa «Comparar CPU y GPU» para medir los cuatro tamaños.'}</div>;
  const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...rates, 10))));
  const hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...rates, 100))));
  const W = 520, rowH = 44, padL = 92, padR = 70, top = 8;
  const shown = sizes.filter((s) => rows.some((r) => r.size === s.value));
  const H = top + shown.length * rowH + 26;
  const x = (v: number) => padL + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - padL - padR);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v *= 10) ticks.push(v);
  const get = (size: number, b: Backend) => rows.find((r) => r.size === size && r.backend === b);

  return (
    <figure className={cs.chart}>
      <figcaption className={cs.legend}>
        <span>
          <i className={cs.swCpu} /> CPU
        </span>
        <span>
          <i className={cs.swGpu} /> GPU
        </span>
        <span className={cs.axisNote}>{unit} por segundo (escala logarítmica)</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Velocidad de entrenamiento por tamaño en CPU y GPU`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={H - 22} className={cs.grid} />
            <text x={x(t)} y={H - 8} className={cs.tick}>
              {t >= 1000 ? `${t / 1000}k` : t}
            </text>
          </g>
        ))}
        {shown.map((s, i) => {
          const y0 = top + i * rowH;
          const cpu = get(s.value, 'cpu'), gpu = get(s.value, 'gpu');
          const ratio = cpu?.rate && gpu?.rate ? gpu.rate / cpu.rate : null;
          return (
            <g key={s.value}>
              <text x={padL - 8} y={y0 + rowH / 2 - 4} className={cs.rowLabel}>
                {s.label}
              </text>
              <text x={padL - 8} y={y0 + rowH / 2 + 9} className={cs.rowSub}>
                {big(s.weights)} pesos
              </text>
              {(['cpu', 'gpu'] as const).map((b, k) => {
                const r = b === 'cpu' ? cpu : gpu;
                const y = y0 + 6 + k * 16;
                const key = `${s.value}-${b}`;
                if (!r) return null;
                if (!r.rate)
                  return (
                    <text key={key} x={padL + 4} y={y + 10} className={cs.na}>
                      {b.toUpperCase()}: {r.note ?? 'no disponible'}
                    </text>
                  );
                return (
                  <g key={key} onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover(null)}>
                    <path d={bar(padL, y, x(r.rate) - padL, 12)} className={b === 'cpu' ? cs.barCpu : cs.barGpu} />
                    <rect x={padL} y={y - 2} width={W - padL - padR} height={16} fill="transparent" />
                    <text x={x(r.rate) + 5} y={y + 10} className={hover === key ? cs.valHover : cs.val}>
                      {nf(r.rate)}
                    </text>
                  </g>
                );
              })}
              {ratio && (
                <text x={W - 4} y={y0 + rowH / 2 + 3} className={cs.ratio}>
                  {ratio >= 1 ? `GPU ×${nf(ratio)}` : `CPU ×${nf(1 / ratio)}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className={cs.summary}>{summary(rows, sizes)}</p>
    </figure>
  );
}

/** A horizontal bar, square at the baseline, 4px-rounded at the tip. */
function bar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h / 2);
  w = Math.max(w, 1);
  return `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}z`;
}

function summary(rows: BenchRow[], sizes: SizeOption[]): string {
  const parts = sizes
    .map((s) => {
      const c = rows.find((r) => r.size === s.value && r.backend === 'cpu')?.rate;
      const g = rows.find((r) => r.size === s.value && r.backend === 'gpu')?.rate;
      if (!c || !g) return null;
      return g >= c ? `con ${s.label} gana la GPU (${nf(g / c)} veces más rápida)` : `con ${s.label} gana la CPU (${nf(c / g)} veces)`;
    })
    .filter(Boolean);
  if (!parts.length) return '';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
