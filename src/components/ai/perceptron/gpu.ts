/* The perceptron on the GPU: the same Rosenblatt rule as model.ts, on a whole
 * mini-batch at once. Scores are one matrix product (or the scanner's sweep),
 * the rule is the gradient of the "perceptron loss", and the update is a plain
 * gradient step with the knobs' end stops. With a batch of one it is exactly
 * the CPU's rule; with more, all corrections of the batch are added together
 * (learnBatch in model.ts does the same on the CPU). */

import { Tape, freeParams, param, sgd, size, zeroGrads, type Gpu, type Param } from '../gpu/engine';
import {
  GRID,
  SCAN_H,
  SCAN_W,
  WMAX,
  isClassifier,
  knobDims,
  retinaInput,
  thetaLimit,
  upsample,
  type Example,
  type Machine,
} from './model';

export class PerceptronGpu {
  private W: Param;
  private b: Param;
  private mistakes: GPUBuffer;
  private lastScores: { buf: GPUBuffer; n: number } | null = null;
  readonly P: number;
  readonly U: number;

  constructor(private g: Gpu, private m: Machine) {
    const { w, h } = knobDims(m.mode, m.scale);
    this.P = w * h;
    this.U = m.classes.length;
    this.W = param(g, this.P, this.U, this.packW(m));
    this.b = param(g, 1, this.U, Float32Array.from(m.thetas, (t) => -t));
    this.mistakes = g.buffer(1, false);
    g.zero(this.mistakes, 1);
  }

  private packW(m: Machine): Float32Array {
    const out = new Float32Array(this.P * this.U);
    m.weights.forEach((w, u) => {
      for (let k = 0; k < this.P; k++) out[k * this.U + u] = w[k];
    });
    return out;
  }

  /** Replace the weights (the knobs were turned by hand). */
  load(m: Machine) {
    this.m = m;
    this.g.write(this.W.buf, this.packW(m));
    this.g.write(this.b.buf, Float32Array.from(m.thetas, (t) => -t));
  }

  private inputs(batch: Example[]): { x: Float32Array; r: number; c: number } {
    const { mode, scale } = this.m;
    const side = GRID * scale;
    const cols = mode === 'scanner' ? side * side : this.P;
    const x = new Float32Array(batch.length * cols);
    batch.forEach((e, i) => x.set(mode === 'scanner' ? upsample(e.grid, scale) : retinaInput(mode, e.grid, scale), i * cols));
    return { x, r: batch.length, c: cols };
  }

  private scores(t: Tape, batch: Example[]) {
    const { x, r, c } = this.inputs(batch);
    const X = t.input(x, r, c);
    const { mode, scale } = this.m;
    const raw =
      mode === 'scanner'
        ? t.scan(X, this.W, { B: r, Hs: GRID * scale, Ws: GRID * scale, wh: SCAN_H * scale, ww: SCAN_W * scale }).best
        : t.matmul(X, this.W);
    return t.addRow(raw, this.b);
  }

  private targets(batch: Example[]): Float32Array {
    const cls = isClassifier(this.m);
    return Float32Array.from(batch, (e) => (cls ? this.m.classes.indexOf(e.ch) : e.target ? 1 : 0));
  }

  /** Encode one step of the rule on the batch. `keepFirst` keeps the first example's scores to read. */
  step(batch: Example[], eta: number, keepFirst = false) {
    const g = this.g;
    zeroGrads(g, [this.W, this.b]);
    const t = new Tape(g, true);
    const s = this.scores(t, batch);
    const wrong = t.perceptronLoss(s, g.upload(this.targets(batch)));
    t.backward();
    sgd(g, this.W, eta, 1, WMAX);
    sgd(g, this.b, eta, 1, thetaLimit(this.m.scale));
    g.run('sumInto', [wrong, this.mistakes], [batch.length, 1], 1);
    this.lastScores = keepFirst ? { buf: s.buf, n: this.U } : null;
    g.submit();
  }

  /** Mistakes since the last call, and the first example's scores if kept. */
  async collect(): Promise<{ mistakes: number; first: Float32Array | null }> {
    const items: [GPUBuffer, number][] = [[this.mistakes, 1]];
    if (this.lastScores) items.push([this.lastScores.buf, this.lastScores.n]);
    const [mk, first] = await this.g.read(...items);
    this.g.zero(this.mistakes, 1);
    this.g.submit();
    this.lastScores = null;
    return { mistakes: mk[0], first: first ?? null };
  }

  /** Copy the GPU's knobs into the machine. */
  async pull(m: Machine) {
    const [W, b] = await this.g.read([this.W.buf, size(this.W)], [this.b.buf, this.U]);
    m.weights.forEach((w, u) => {
      for (let k = 0; k < this.P; k++) w[k] = W[k * this.U + u];
    });
    m.thetas = Array.from(b, (v) => -v);
  }

  /** Accuracy on a set, computed on the GPU in chunks. */
  async accuracy(set: Example[]): Promise<number> {
    if (!set.length) return 0;
    let ok = 0;
    const cls = isClassifier(this.m);
    for (let i = 0; i < set.length; i += 64) {
      const chunk = set.slice(i, i + 64);
      const t = new Tape(this.g, false);
      const s = this.scores(t, chunk);
      const [out] = await this.g.read([s.buf, chunk.length * this.U]);
      chunk.forEach((e, k) => {
        if (cls) {
          let w = 0;
          for (let u = 1; u < this.U; u++) if (out[k * this.U + u] > out[k * this.U + w]) w = u;
          if (this.m.classes[w] === e.ch) ok++;
        } else if (out[k] >= 0 === e.target) ok++;
      });
    }
    return ok / set.length;
  }

  dispose() {
    freeParams(this.g, [this.W, this.b]);
    this.g.release(this.mistakes);
  }
}
