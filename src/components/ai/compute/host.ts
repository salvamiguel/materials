/* The training loop that runs inside the Web Worker (or, without workers, on
 * the page). The page sends commands; the host trains the demo's model on the
 * CPU or the GPU at the chosen speed and posts back "ticks": progress,
 * statistics, sounds to play and, now and then, the weights to draw.
 *
 * Every demo plugs in a Trainer; the host only deals with timing, ordering of
 * messages and the CPU-vs-GPU benchmark. */

import { getGpu, gpuUnavailableReason } from '../gpu/engine';

export type Backend = 'cpu' | 'gpu';
export type Speed = 0 | 1 | 10 | 100;
export type Sound = 'win' | 'ok' | 'error' | 'click' | { epoch: number };

export interface Compute {
  backend: Backend;
  batch: number;
}

/** What a demo trainer reports after some steps. */
export interface Advance<St = unknown, Rep = unknown> {
  stats: St;
  /** Details of the last step, for the slow speeds and the "step" button. */
  report?: Rep;
  sounds: Sound[];
  /** Training should stop (converged or gave up). */
  stop: boolean;
  examples: number;
}

export interface BenchRow {
  size: number;
  backend: Backend;
  /** Examples per second, or null if it could not run (no GPU, out of memory…). */
  rate: number | null;
  note?: string;
}

export interface Trainer<Snap = unknown> {
  /** Replace any of: model, data, options, statistics. */
  set(patch: Record<string, unknown>): void | Promise<void>;
  /** Switch engine; returns the GPU's name, or throws why it cannot. */
  compute(c: Compute): Promise<string | null>;
  advance(o: { steps?: number; budgetMs?: number; verbose: boolean; abort: () => boolean }): Promise<Advance>;
  /** The current weights for the page, or null if nothing changed (or, unless forced, too soon to send again). */
  snapshot(force: boolean): Promise<Snap | null>;
  /** Examples per second for one model size on one engine, with throwaway models. */
  bench(size: number, backend: Backend, batch: number, abort: () => boolean): Promise<number>;
}

export type ToHost =
  | { t: 'init'; demo: string; state: Record<string, unknown> }
  | { t: 'set'; patch: Record<string, unknown> }
  | { t: 'compute'; compute: Compute }
  | { t: 'speed'; speed: Speed }
  | { t: 'step' }
  | { t: 'bench'; sizes: number[]; batch: number; backends: Backend[] }
  | { t: 'benchStop' };

export type FromHost =
  | { t: 'tick'; stats: unknown; report?: unknown; sounds: Sound[]; snapshot?: unknown; perf: Perf; running: boolean }
  | { t: 'compute'; backend: Backend; gpu: string | null; error?: string }
  | { t: 'bench'; row?: BenchRow; done: boolean }
  | { t: 'error'; message: string };

export interface Perf {
  /** Examples per second over the last few ticks. */
  rate: number;
  /** Milliseconds per training step. */
  msPerStep: number;
}

/** Examples per second at ×1; ×10 multiplies it; ×100 means "as fast as it goes". */
const RATE: Record<string, number> = { perceptron: 3, cnn: 3, gpt: 2, translator: 2 };

export class Host {
  private trainer: Trainer | null = null;
  private demo = '';
  private speed: Speed = 0;
  private budget = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private benchAbort = false;
  private perf: Perf = { rate: 0, msPerStep: 0 };
  private window: { t: number; examples: number; steps: number }[] = [];

  constructor(
    private post: (m: FromHost, transfer?: Transferable[]) => void,
    private make: (demo: string, state: Record<string, unknown>) => Trainer,
  ) {}

  /** Run `fn` after everything queued before it. */
  private serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch((e) => this.post({ t: 'error', message: (e as Error).message ?? String(e) }));
    return p;
  }

  handle(m: ToHost) {
    switch (m.t) {
      case 'init':
        this.serial(() => {
          this.demo = m.demo;
          this.trainer = this.make(m.demo, m.state);
        });
        break;
      case 'set':
        this.serial(() => this.trainer?.set(m.patch));
        break;
      case 'compute':
        this.serial(async () => {
          try {
            // Compile the kernels before saying "ready": the page shows "preparing" meanwhile.
            if (m.compute.backend === 'gpu') await (await getGpu())?.warm();
            const gpu = await this.trainer!.compute(m.compute);
            this.post({ t: 'compute', backend: m.compute.backend, gpu });
          } catch (e) {
            await this.trainer!.compute({ ...m.compute, backend: 'cpu' });
            this.post({ t: 'compute', backend: 'cpu', gpu: null, error: (e as Error).message });
          }
        });
        break;
      case 'speed':
        this.speed = m.speed;
        this.budget = 1;
        this.window = [];
        if (this.speed && !this.timer) this.schedule(0);
        if (!this.speed) this.serial(() => this.sendTick({ stats: undefined, sounds: [], stop: false, examples: 0 }, true));
        break;
      case 'step':
        this.serial(async () => {
          const a = await this.trainer!.advance({ steps: 1, verbose: true, abort: () => false });
          await this.sendTick(a, true);
        });
        break;
      case 'bench':
        this.benchAbort = false;
        this.serial(() => this.bench(m.sizes, m.batch, m.backends));
        break;
      case 'benchStop':
        this.benchAbort = true;
        break;
    }
  }

  private schedule(ms: number) {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.serial(() => this.loop());
    }, ms);
  }

  private async loop() {
    if (!this.speed || !this.trainer) return;
    const t0 = performance.now();
    let a: Advance;
    const abort = () => !this.speed;
    if (this.speed === 100) {
      a = await this.trainer.advance({ budgetMs: 60, verbose: false, abort });
    } else {
      this.budget += ((RATE[this.demo] ?? 3) * this.speed) / 20;
      const steps = Math.floor(this.budget);
      this.budget -= steps;
      a = steps ? await this.trainer.advance({ steps, verbose: this.speed === 1, abort }) : { stats: undefined, sounds: [], stop: false, examples: 0 };
    }
    this.measure(a.examples, performance.now() - t0);
    if (a.stop) this.speed = 0;
    if (a.examples || a.stop) await this.sendTick(a, a.stop || this.speed !== 100);
    if (this.speed) this.schedule(this.speed === 100 ? 0 : 50);
    else await this.sendTick({ stats: undefined, sounds: [], stop: false, examples: 0 }, true);
  }

  private measure(examples: number, ms: number) {
    if (!examples) return;
    const now = performance.now();
    this.window.push({ t: now, examples, steps: 1 });
    this.window = this.window.filter((w) => now - w.t < 3000);
    const span = Math.max(ms, now - (this.window[0]?.t ?? now) + ms);
    const ex = this.window.reduce((s, w) => s + w.examples, 0);
    this.perf = { rate: (ex / span) * 1000, msPerStep: ms };
  }

  private lastSnap = 0;

  private async sendTick(a: Advance, forceSnapshot: boolean) {
    if (!this.trainer) return;
    // Weights are sent at most a few times a second while running: drawing them is the page's slow part.
    const now = performance.now();
    let snapshot: unknown;
    if (forceSnapshot || now - this.lastSnap > 250) {
      snapshot = (await this.trainer.snapshot(forceSnapshot)) ?? undefined;
      if (snapshot) this.lastSnap = now;
    }
    const transfer = collectTransfer(snapshot);
    this.post({ t: 'tick', stats: a.stats, report: a.report, sounds: a.sounds, snapshot, perf: this.perf, running: !!this.speed }, transfer);
  }

  private async bench(sizes: number[], batch: number, backends: Backend[]) {
    const gpu = backends.includes('gpu') ? await getGpu() : null;
    for (const size of sizes)
      for (const backend of backends) {
        if (this.benchAbort) break;
        if (backend === 'gpu' && !gpu) {
          this.post({ t: 'bench', row: { size, backend, rate: null, note: gpuUnavailableReason() }, done: false });
          continue;
        }
        try {
          const rate = await this.trainer!.bench(size, backend, batch, () => this.benchAbort);
          this.post({ t: 'bench', row: { size, backend, rate }, done: false });
        } catch (e) {
          this.post({ t: 'bench', row: { size, backend, rate: null, note: (e as Error).message }, done: false });
        }
      }
    this.post({ t: 'bench', done: true });
  }
}

/** Float32Array buffers inside a snapshot, to move instead of copy. */
function collectTransfer(x: unknown, out: Transferable[] = []): Transferable[] {
  if (x instanceof Float32Array) {
    if (x.byteOffset === 0 && x.byteLength === x.buffer.byteLength && !out.includes(x.buffer as ArrayBuffer)) out.push(x.buffer as ArrayBuffer);
  } else if (Array.isArray(x)) x.forEach((v) => collectTransfer(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => collectTransfer(v, out));
  return out;
}

/** Give the event loop a chance to deliver messages (pause, new options) during long CPU steps. */
export const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

/** Time a benchmark: run `once` (which does `per` examples) until `ms` have passed; examples per second. */
export async function timeIt(once: () => Promise<void> | void, per: number, o: { ms?: number; min?: number; abort: () => boolean; finish?: () => Promise<void> }): Promise<number> {
  const ms = o.ms ?? 1200;
  let n = 0;
  const t0 = performance.now();
  while ((performance.now() - t0 < ms || n < (o.min ?? 1)) && !o.abort()) {
    await once();
    n++;
    if (n % 4 === 0) await yieldNow();
  }
  await o.finish?.();
  return (n * per * 1000) / (performance.now() - t0);
}
