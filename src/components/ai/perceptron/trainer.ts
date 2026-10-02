/* The perceptron's training loop, as it runs in the Web Worker: Rosenblatt's
 * rule over the training set, epoch after epoch, on the CPU (model.ts) or the
 * GPU (gpu.ts), with the statistics, sounds and step reports the page shows. */

import { getGpu, gpuUnavailableReason } from '../gpu/engine';
import { timeIt, type Advance, type Backend, type Compute, type Sound, type Trainer } from '../compute/host';
import { PerceptronGpu } from './gpu';
import { accuracy, decide, isClassifier, isCorrect, learnBatch, newMachine, type Example, type Machine, type StepResult } from './model';

export const MAX_EPOCHS = 60;
const POINT_EVERY = 100;

export interface Point {
  seen: number;
  train: number;
  test: number;
}

export interface Stats {
  epoch: number;
  cursor: number;
  seen: number;
  epochErrors: number;
  points: Point[];
  done: '' | 'converged' | 'gaveup';
}

export const freshStats = (): Stats => ({ epoch: 0, cursor: 0, seen: 0, epochErrors: 0, points: [], done: '' });

export interface Report {
  /** Index in the training set of the first example of the step. */
  index: number;
  batch: number;
  correct: boolean;
  changed: StepResult['changed'];
  /** What the changed unit's knobs saw (only on the 16×16 board). */
  input?: Uint8Array;
  text: string;
}

export interface Snapshot {
  weights: Float32Array[];
  thetas: number[];
}

export class PerceptronTrainer implements Trainer<Snapshot> {
  private m: Machine;
  private data: { train: Example[]; test: Example[] };
  private eta: number;
  private stats: Stats;
  private compute_: Compute = { backend: 'cpu', batch: 1 };
  private gpu: PerceptronGpu | null = null;
  private dirty = true;

  constructor(state: Record<string, unknown>) {
    this.m = state.machine as Machine;
    this.data = state.data as PerceptronTrainer['data'];
    this.eta = state.eta as number;
    this.stats = (state.stats as Stats) ?? freshStats();
  }

  async set(p: Record<string, unknown>) {
    if (p.machine) {
      const m = p.machine as Machine;
      const sameShape = m.weights[0].length === this.m.weights[0].length && m.classes.length === this.m.classes.length && m.mode === this.m.mode;
      this.m = m;
      if (this.gpu) {
        if (sameShape) this.gpu.load(m);
        else await this.restartGpu();
      }
      this.dirty = true;
    }
    if (p.data) this.data = p.data as PerceptronTrainer['data'];
    if (typeof p.eta === 'number') this.eta = p.eta;
    if (p.stats) this.stats = p.stats as Stats;
  }

  private async restartGpu() {
    const g = await getGpu();
    this.gpu?.dispose();
    this.gpu = g ? new PerceptronGpu(g, this.m) : null;
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
      if (!this.gpu) this.gpu = new PerceptronGpu(g, this.m);
      return g.name;
    }
    return null;
  }

  private nextBatch(index: number): { batch: Example[]; index: number } {
    const train = this.data.train;
    // Batches never cross the end of an epoch, so epochs stay whole.
    const n = Math.min(this.compute_.batch, train.length - index);
    return { batch: train.slice(index, index + n), index };
  }

  private async measure(): Promise<{ train: number; test: number }> {
    if (this.gpu) return { train: await this.gpu.accuracy(this.data.train), test: await this.gpu.accuracy(this.data.test) };
    return { train: accuracy(this.m, this.data.train), test: accuracy(this.m, this.data.test) };
  }

  async advance(o: { steps?: number; budgetMs?: number; verbose: boolean; abort: () => boolean }): Promise<Advance<Stats, Report>> {
    const s: Stats = { ...this.stats };
    const sounds: Sound[] = [];
    let report: Report | undefined;
    let examples = 0;
    const t0 = performance.now();
    let pendingGpuMistakes = 0;
    const flushGpu = async () => {
      if (this.gpu && pendingGpuMistakes) {
        s.epochErrors += (await this.gpu.collect()).mistakes;
        pendingGpuMistakes = 0;
      }
    };
    for (let k = 0; ; k++) {
      if (o.steps !== undefined ? k >= o.steps : performance.now() - t0 > (o.budgetMs ?? 50)) break;
      if (k > 0 && o.abort()) break;
      const { batch, index } = this.nextBatch(s.cursor);
      const reportNow = o.verbose || (o.steps !== undefined && k === o.steps - 1 && o.steps <= 3);
      let first: StepResult | null = null;
      if (this.gpu) {
        if (reportNow) {
          // Judge the first example on the CPU with the GPU's current knobs, for the explanation.
          await this.gpu.pull(this.m);
          const decision = decide(this.m, batch[0].grid);
          first = { decision, correct: isCorrect(this.m, decision, batch[0]), changed: changedFor(this.m, decision, batch[0]) };
        }
        this.gpu.step(batch, this.eta);
        pendingGpuMistakes++;
        if (reportNow) await flushGpu();
      } else {
        const r = learnBatch(this.m, batch, this.eta);
        s.epochErrors += r.mistakes;
        first = r.first;
      }
      this.dirty = true;
      examples += batch.length;
      const before = s.seen;
      s.cursor += batch.length;
      s.seen += batch.length;
      const epochEnd = s.cursor >= this.data.train.length;
      if (first && reportNow) {
        report = {
          index,
          batch: batch.length,
          correct: first.correct,
          changed: first.changed,
          input: this.m.scale === 1 && first.changed.length ? first.decision.readings[first.changed[0].unit].input : undefined,
          text: describe(this.m, first, batch[0], this.eta, batch.length),
        };
        if (o.verbose) sounds.push(first.correct ? 'ok' : 'error');
      }
      if (epochEnd || Math.floor(before / POINT_EVERY) !== Math.floor(s.seen / POINT_EVERY)) {
        await flushGpu();
        s.points = [...s.points, { seen: s.seen, ...(await this.measure()) }];
      }
      if (epochEnd) {
        await flushGpu();
        s.epoch++;
        const clean = s.epochErrors === 0;
        if (clean) s.done = 'converged';
        else if (s.epoch >= MAX_EPOCHS) s.done = 'gaveup';
        sounds.push(clean ? 'win' : { epoch: s.points[s.points.length - 1].train });
        s.cursor = 0;
        s.epochErrors = 0;
        if (s.done) break;
      }
    }
    await flushGpu();
    this.stats = s;
    return { stats: s, report, sounds, stop: !!s.done, examples };
  }

  async snapshot(): Promise<Snapshot | null> {
    if (!this.dirty) return null;
    if (this.gpu) await this.gpu.pull(this.m);
    this.dirty = false;
    return { weights: this.m.weights.map((w) => w.slice()), thetas: [...this.m.thetas] };
  }

  async bench(scale: number, backend: Backend, batch: number, abort: () => boolean): Promise<number> {
    const m = newMachine(this.m.mode, this.m.classes, scale);
    const train = this.data.train;
    let at = 0;
    const next = () => {
      const b: Example[] = [];
      for (let i = 0; i < batch; i++) b.push(train[at++ % train.length]);
      return b;
    };
    if (backend === 'cpu') return timeIt(() => void learnBatch(m, next(), this.eta), batch, { abort });
    const g = (await getGpu())!;
    const pg = new PerceptronGpu(g, m);
    try {
      pg.step(next(), this.eta); // compile the kernels outside the timing
      await g.idle();
      return await timeIt(() => pg.step(next(), this.eta), batch, { abort, min: 3, finish: () => g.idle() });
    } finally {
      pg.dispose();
    }
  }
}

/** Which units the rule would turn for this decision (the same choice as `learn`). */
function changedFor(m: Machine, d: ReturnType<typeof decide>, e: Example): StepResult['changed'] {
  if (isCorrect(m, d, e)) return [];
  if (!isClassifier(m)) return [{ unit: 0, dir: e.target ? 1 : -1 }];
  const right = m.classes.indexOf(e.ch);
  return [...(right >= 0 ? [{ unit: right, dir: 1 as const }] : []), { unit: d.winner, dir: -1 as const }];
}

/** The sentence under the training controls. */
export function describe(m: Machine, step: StepResult, ex: Example, eta: number, batch = 1): string {
  const lot = batch > 1 ? `Lote de ${batch}: todos se juzgan con los mismos mandos y las correcciones se suman. Por ejemplo, ` : '';
  if (step.correct) {
    return (
      lot +
      (isClassifier(m)
        ? `era «${ex.ch}» y ganó «${ex.ch}»: acierto, los mandos no se tocan.`
        : `«${ex.ch}» ${ex.target ? 'debía encender' : 'no debía encender'} la lámpara y así fue: acierto, nada cambia.`)
    );
  }
  const lit = (u: number) => step.decision.readings[u].input.reduce((a, b) => a + b, 0);
  if (isClassifier(m)) {
    const w = m.classes[step.decision.winner];
    return `${lot}era «${ex.ch}» pero ganó «${w}»: +${eta.toFixed(2)} a ${lit(m.classes.indexOf(ex.ch))} mandos de «${ex.ch}» y −${eta.toFixed(2)} a ${lit(step.decision.winner)} de «${w}».`;
  }
  const t = ex.target ? 1 : 0;
  return `${lot}«${ex.ch}»: t = ${t}, y = ${1 - t} → ${t ? '+' : '−'}${eta.toFixed(2)} a ${lit(0)} mandos encendidos, θ ${t ? '−' : '+'}${eta.toFixed(2)}.`;
}
