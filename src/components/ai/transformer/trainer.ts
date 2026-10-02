/* The Transformer's training loop (GPT or translator), as it runs in the Web
 * Worker: Adam on mini-batches, on the CPU (model.ts) or the GPU (gpu.ts),
 * with a check of what the model has learnt every few steps. */

import { getGpu, gpuUnavailableReason } from '../gpu/engine';
import { timeIt, yieldNow, type Advance, type Backend, type Compute, type Sound, type Trainer } from '../compute/host';
import { rng } from '../perceptron/model';
import type { Pair } from './grammar';
import { TransformerGpu } from './gpu';
import { accumulate, applyAdam, evaluate, generate, lmEvaluate, newModel, withD, type Model, type Optim } from './model';

export const MAX_STEPS = 1500;
const EVAL_EVERY = 25;

export interface Stats {
  steps: number;
  seen: number;
  loss: number;
  points: { seen: number; train: number; test: number }[];
  /** GPT: sentences it wrote at the last check. */
  samples: string[][];
  done: '' | 'converged' | 'gaveup';
}

export const freshStats = (): Stats => ({ steps: 0, seen: 0, loss: NaN, points: [], samples: [], done: '' });

export interface Report {
  /** The first item of the last batch (the translator shows it). */
  last: string[];
}

export interface Snapshot {
  params: Float32Array[];
}

type Item = string[] | Pair;

export class TransformerTrainer implements Trainer<Snapshot> {
  private m: Model;
  private data: { train: Item[]; test: Item[] };
  private lr: number;
  private stats: Stats;
  private compute_: Compute = { backend: 'cpu', batch: 8 };
  private gpu: TransformerGpu | null = null;
  private cursor = 0;
  private dirty = true;
  private lastSnap = 0;

  constructor(state: Record<string, unknown>) {
    this.m = fromParams(state.cfg as Model['cfg'], state.params as Float32Array[]);
    this.data = state.data as TransformerTrainer['data'];
    this.lr = state.lr as number;
    this.stats = (state.stats as Stats) ?? freshStats();
  }

  private get gpt() {
    return this.m.cfg.kind === 'gpt';
  }

  async set(p: Record<string, unknown>) {
    if (p.params && p.cfg) {
      // A new or reset model: fresh optimiser state.
      this.m = fromParams(p.cfg as Model['cfg'], p.params as Float32Array[]);
      this.cursor = 0;
      if (this.gpu) {
        this.gpu.dispose();
        const g = await getGpu();
        this.gpu = g ? new TransformerGpu(g, this.m) : null;
      }
      this.dirty = true;
    }
    if (p.data) {
      this.data = p.data as TransformerTrainer['data'];
      this.cursor = 0;
    }
    if (typeof p.lr === 'number') this.lr = p.lr;
    if (p.stats) this.stats = p.stats as Stats;
  }

  async compute(c: Compute): Promise<string | null> {
    if (this.gpu && c.backend === 'cpu') {
      await this.gpu.pull(this.m);
      this.gpu.dispose();
      this.gpu = null;
    }
    this.compute_ = c;
    if (c.backend === 'gpu') {
      const g = await getGpu();
      if (!g) throw new Error(gpuUnavailableReason());
      if (!this.gpu) this.gpu = new TransformerGpu(g, this.m);
      return g.name;
    }
    return null;
  }

  private opt(): Optim {
    return { lr: this.lr, warmup: 40 };
  }

  /** What the model knows: GPT → (next word right, sentences right); translator → exact translations (train, test). */
  private async check(s: Stats): Promise<{ train: number; test: number }> {
    const big = this.m.cfg.d > 32 && !this.gpu;
    const N = big ? 20 : 50;
    const samples = big ? 12 : 40;
    if (this.gpt) {
      const test = this.data.test.slice(0, N) as string[][];
      if (this.gpu) {
        const e = await this.gpu.lmEvaluate(test, samples, rng(s.steps));
        s.samples = e.written.slice(0, 6);
        return { train: e.next, test: e.generated };
      }
      const e = lmEvaluate(this.m, test, samples, s.steps);
      const r = rng(s.steps + 7);
      s.samples = Array.from({ length: 6 }, () => generate(this.m, [], 1, r));
      return { train: e.next, test: e.generated };
    }
    const tr = this.data.train.slice(0, N) as Pair[], te = this.data.test.slice(0, N) as Pair[];
    if (this.gpu) return { train: await this.gpu.translateExact(tr), test: await this.gpu.translateExact(te) };
    return { train: evaluate(this.m, tr).exact, test: evaluate(this.m, te).exact };
  }

  async advance(o: { steps?: number; budgetMs?: number; verbose: boolean; abort: () => boolean }): Promise<Advance<Stats, Report>> {
    const s: Stats = { ...this.stats };
    const sounds: Sound[] = [];
    let examples = 0;
    let gpuSteps = 0;
    let last: Item | null = null;
    const t0 = performance.now();
    const ema = (loss: number) => (s.loss = Number.isNaN(s.loss) ? loss : s.loss * 0.9 + loss * 0.1);
    const flush = async () => {
      if (this.gpu && gpuSteps) {
        ema((await this.gpu.collect()) / gpuSteps);
        gpuSteps = 0;
      }
    };
    for (let k = 0; ; k++) {
      if (o.steps !== undefined ? k >= o.steps : performance.now() - t0 > (o.budgetMs ?? 50)) break;
      if (k > 0 && o.abort()) break;
      const train = this.data.train;
      const B = this.compute_.batch;
      const batch = Array.from({ length: B }, () => train[this.cursor++ % train.length]);
      last = batch[0];
      if (this.gpu) {
        this.gpu.step(batch, this.opt());
        gpuSteps++;
      } else {
        let loss = 0, lastYield = performance.now(), aborted = false;
        for (const it of batch) {
          loss += accumulate(this.m, it);
          if (performance.now() - lastYield > 40) {
            await yieldNow();
            lastYield = performance.now();
            if (o.abort()) {
              aborted = true;
              break;
            }
          }
        }
        if (aborted) {
          for (const p of this.m.params) p.grad!.fill(0);
          break;
        }
        applyAdam(this.m, B, this.opt());
        ema(loss / B);
      }
      this.dirty = true;
      s.steps++;
      s.seen += B;
      examples += B;
      if (s.steps % EVAL_EVERY === 0) {
        await flush();
        const e = await this.check(s);
        const prev = s.points[s.points.length - 1];
        s.points = [...s.points, { seen: s.seen, ...e }];
        if (this.gpt ? e.test >= 0.9 && (prev?.test ?? 0) >= 0.9 : e.test === 1 && prev?.test === 1) s.done = 'converged';
        else if (s.steps >= MAX_STEPS) s.done = 'gaveup';
        sounds.push(s.done === 'converged' ? 'win' : { epoch: e.test });
        if (s.done) break;
      }
    }
    await flush();
    this.stats = s;
    const report = last ? { last: Array.isArray(last) ? last : last.es } : undefined;
    return { stats: s, report, sounds, stop: !!s.done, examples };
  }

  async snapshot(force: boolean): Promise<Snapshot | null> {
    if (!this.dirty) return null;
    // Big models are megabytes of weights: send them less often.
    const total = this.m.params.reduce((a, p) => a + p.data.length, 0);
    const now = performance.now();
    if (!force && total > 1e6 && now - this.lastSnap < 1500) return null;
    this.lastSnap = now;
    if (this.gpu) await this.gpu.pull(this.m);
    this.dirty = false;
    return { params: this.m.params.map((p) => p.data.slice()) };
  }

  async bench(d: number, backend: Backend, batch: number, abort: () => boolean): Promise<number> {
    const m = newModel(withD(this.m.cfg, d), 2);
    const train = this.data.train;
    let at = 0;
    if (backend === 'cpu') {
      let k = 0;
      return timeIt(
        () => {
          accumulate(m, train[at++ % train.length]);
          if (++k % batch === 0) applyAdam(m, batch, this.opt());
        },
        1,
        { abort },
      );
    }
    const g = (await getGpu())!;
    const tg = new TransformerGpu(g, m);
    const next = () => Array.from({ length: batch }, () => train[at++ % train.length]);
    try {
      tg.step(next(), this.opt());
      await g.idle();
      return await timeIt(() => tg.step(next(), this.opt()), batch, { abort, min: 3, finish: () => g.idle() });
    } finally {
      tg.dispose();
    }
  }
}

/** A model with these weights (and a fresh optimiser). */
export function fromParams(cfg: Model['cfg'], params: Float32Array[]): Model {
  const m = newModel(cfg, 1);
  m.params.forEach((p, k) => p.data.set(params[k]));
  return m;
}
