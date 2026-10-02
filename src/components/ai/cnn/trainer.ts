/* The convolutional network's training loop, as it runs in the Web Worker:
 * backpropagation over the training set on the CPU (model.ts) or the GPU
 * (gpu.ts), mini-batch by mini-batch, with the page's statistics, sounds and
 * step reports. */

import { getGpu, gpuUnavailableReason } from '../gpu/engine';
import { timeIt, yieldNow, type Advance, type Backend, type Compute, type Sound, type Trainer } from '../compute/host';
import { GRID, bbox, rng, shift, type Example, type Grid } from '../perceptron/model';
import { CnnGpu } from './gpu';
import { accumulate, applyGrads, evaluate, forward, newGrads, newNet, type Net, type StepResult } from './model';

export const MAX_EPOCHS = 40;
const POINT_EVERY = 200;

export interface Stats {
  epoch: number;
  cursor: number;
  seen: number;
  epochLoss: number;
  epochCount: number;
  points: { seen: number; train: number; test: number }[];
  done: '' | 'converged' | 'gaveup';
}

export const freshStats = (): Stats => ({ epoch: 0, cursor: 0, seen: 0, epochLoss: 0, epochCount: 0, points: [], done: '' });

export interface Opts {
  lr: number;
  augment: boolean;
  freezeFirst: boolean;
}

export interface Report {
  /** What the network saw (after augmentation). */
  grid: Grid;
  correct: boolean;
  text: string;
}

export interface Snapshot {
  tensors: Float32Array[];
}

/** Data augmentation: move the drawing up to 2 cells, never off the retina. */
export function jitter(g: Grid, r: () => number): Grid {
  const b = bbox(g);
  if (!b) return g;
  const pick = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const dx = pick(Math.max(-2, -b.x0), Math.min(2, GRID - 1 - b.x1));
  const dy = pick(Math.max(-2, -b.y0), Math.min(2, GRID - 1 - b.y1));
  return dx || dy ? shift(g, dx, dy) : g;
}

export const tensorsOf = (n: Net) => [...n.layers.flatMap((L) => [L.w, L.b]), n.dense, n.dbias];

export class CnnTrainer implements Trainer<Snapshot> {
  private n: Net;
  private data: { train: Example[]; test: Example[] };
  private opts: Opts;
  private stats: Stats;
  private compute_: Compute = { backend: 'cpu', batch: 1 };
  private gpu: CnnGpu | null = null;
  private dirty = true;
  private r = rng(7);

  constructor(state: Record<string, unknown>) {
    this.n = state.net as Net;
    this.data = state.data as CnnTrainer['data'];
    this.opts = state.opts as Opts;
    this.stats = (state.stats as Stats) ?? freshStats();
  }

  async set(p: Record<string, unknown>) {
    if (p.net) {
      const n = p.net as Net;
      const same = n.arch === this.n.arch && n.width === this.n.width && n.classes.join() === this.n.classes.join();
      this.n = n;
      if (this.gpu) {
        if (same) this.gpu.load(n);
        else {
          this.gpu.dispose();
          const g = await getGpu();
          this.gpu = g ? new CnnGpu(g, n) : null;
        }
      }
      this.dirty = true;
    }
    if (p.data) this.data = p.data as CnnTrainer['data'];
    if (p.opts) this.opts = { ...this.opts, ...(p.opts as Partial<Opts>) };
    if (p.stats) this.stats = p.stats as Stats;
  }

  async compute(c: Compute): Promise<string | null> {
    if (this.gpu && c.backend === 'cpu') {
      await this.gpu.pull(this.n);
      this.gpu.dispose();
      this.gpu = null;
    }
    this.compute_ = c;
    if (c.backend === 'gpu') {
      const g = await getGpu();
      if (!g) throw new Error(gpuUnavailableReason());
      if (!this.gpu) this.gpu = new CnnGpu(g, this.n);
      return g.name;
    }
    return null;
  }

  private async measure() {
    const tr = this.gpu ? await this.gpu.evaluate(this.data.train) : evaluate(this.n, this.data.train);
    const te = this.gpu ? await this.gpu.evaluate(this.data.test) : evaluate(this.n, this.data.test);
    return { train: tr.accuracy, test: te.accuracy };
  }

  async advance(o: { steps?: number; budgetMs?: number; verbose: boolean; abort: () => boolean }): Promise<Advance<Stats, Report>> {
    const s: Stats = { ...this.stats };
    const sounds: Sound[] = [];
    let report: Report | undefined;
    let examples = 0;
    const t0 = performance.now();
    for (let k = 0; ; k++) {
      if (o.steps !== undefined ? k >= o.steps : performance.now() - t0 > (o.budgetMs ?? 50)) break;
      if (k > 0 && o.abort()) break;
      const train = this.data.train;
      const n = Math.min(this.compute_.batch, train.length - s.cursor);
      const batch = train.slice(s.cursor, s.cursor + n).map((e) => (this.opts.augment ? { ...e, grid: jitter(e.grid, this.r) } : e));
      const reportNow = o.verbose || (o.steps !== undefined && k === o.steps - 1 && o.steps <= 3);
      let first: StepResult | null = null;
      if (this.gpu) {
        if (reportNow) {
          await this.gpu.pull(this.n);
          first = judge(this.n, batch[0]);
        }
        this.gpu.step(batch, this.opts.lr, { freezeFirst: this.opts.freezeFirst });
        s.epochCount += n;
        // The loss lives on the GPU; read it when it is about to be shown or reset.
        if (reportNow || s.cursor + n >= train.length) s.epochLoss += (await this.gpu.collect()).loss;
      } else {
        const g = newGrads(this.n);
        let lastYield = performance.now();
        let aborted = false;
        for (const ex of batch) {
          const r = accumulate(this.n, ex, g, { freezeFirst: this.opts.freezeFirst });
          first ??= r;
          s.epochLoss += r.loss;
          // Big networks take a while per example: keep the worker listening (pause, options…).
          if (performance.now() - lastYield > 40) {
            await yieldNow();
            lastYield = performance.now();
            if (o.abort()) {
              aborted = true;
              break;
            }
          }
        }
        if (aborted) break;
        applyGrads(this.n, g, this.opts.lr, batch.length, { freezeFirst: this.opts.freezeFirst });
        s.epochCount += n;
      }
      this.dirty = true;
      examples += n;
      const before = s.seen;
      s.cursor += n;
      s.seen += n;
      if (first && reportNow) {
        report = { grid: batch[0].grid, correct: first.correct, text: describe(this.n, first, batch[0], this.opts.freezeFirst, n) };
        if (o.verbose) sounds.push(first.correct ? 'ok' : 'error');
      }
      const epochEnd = s.cursor >= train.length;
      if (epochEnd || Math.floor(before / POINT_EVERY) !== Math.floor(s.seen / POINT_EVERY)) {
        const m = await this.measure();
        s.points = [...s.points, { seen: s.seen, ...m }];
        if (epochEnd) {
          s.epoch++;
          if (m.train === 1) s.done = 'converged';
          else if (s.epoch >= MAX_EPOCHS) s.done = 'gaveup';
          sounds.push(s.done === 'converged' ? 'win' : { epoch: m.train });
          s.cursor = 0;
          s.epochLoss = 0;
          s.epochCount = 0;
          if (s.done) break;
        }
      }
    }
    if (this.gpu) s.epochLoss += (await this.gpu.collect()).loss;
    this.stats = s;
    return { stats: s, report, sounds, stop: !!s.done, examples };
  }

  async snapshot(): Promise<Snapshot | null> {
    if (!this.dirty) return null;
    if (this.gpu) await this.gpu.pull(this.n);
    this.dirty = false;
    return { tensors: tensorsOf(this.n).map((t) => t.slice()) };
  }

  async bench(width: number, backend: Backend, batch: number, abort: () => boolean): Promise<number> {
    const n = newNet(this.n.arch, this.n.classes, 3, width);
    const train = this.data.train;
    let at = 0;
    const next = () => Array.from({ length: batch }, () => train[at++ % train.length]);
    if (backend === 'cpu') {
      // One example at a time (the CPU's cost does not depend on the batch), applying every `batch`.
      const g = newGrads(n);
      let k = 0;
      return timeIt(
        () => {
          accumulate(n, train[at++ % train.length], g);
          if (++k % batch === 0) applyGrads(n, g, this.opts.lr, batch);
        },
        1,
        { abort },
      );
    }
    const g = (await getGpu())!;
    const cg = new CnnGpu(g, n);
    try {
      cg.step(next(), this.opts.lr);
      await g.idle();
      return await timeIt(() => cg.step(next(), this.opts.lr), batch, { abort, min: 3, finish: () => g.idle() });
    } finally {
      cg.dispose();
    }
  }
}

/** The CPU's view of one example (for the explanation), without learning from it. */
function judge(n: Net, ex: Example): StepResult {
  const act = forward(n, ex.grid);
  const label = n.classes.indexOf(ex.ch);
  return { act, loss: -Math.log(Math.max(act.probs[label], 1e-12)), correct: act.winner === label, label };
}

const pct = (p: number) => `${Math.round(p * 100)} %`;

export function describe(n: Net, step: StepResult, ex: Example, frozen: boolean, batch = 1): string {
  const said = n.classes[step.act.winner];
  const p = step.act.probs[step.label];
  const params = n.layers.reduce((a, L, i) => a + (frozen && i === 0 ? 0 : L.w.length + L.b.length), 0) + n.dense.length + n.dbias.length;
  const head = step.correct ? `Era «${ex.ch}» y la red dijo «${said}»` : `Era «${ex.ch}» pero la red dijo «${said}»`;
  const lot = batch > 1 ? ` Con un lote de ${batch}, el gradiente es la media de los ${batch} ejemplos.` : '';
  return `${head} (p(«${ex.ch}») = ${pct(p)}). Pérdida = −ln ${p.toFixed(2)} = ${step.loss.toFixed(2)}. El gradiente ajusta ${params.toLocaleString('es')} pesos${frozen ? ' (la capa 1 está congelada)' : ''}.${lot}`;
}
