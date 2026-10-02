/* The convolutional network on the GPU, the same maths as model.ts on a
 * mini-batch: each convolution is im2col (every 3×3 patch as a row) times the
 * filters, maps are NHWC (one row per pixel, one column per filter), and
 * training is mean-gradient descent with the first layer's end stops.
 *
 * Layouts differ from the CPU model, which keeps filters as cout×cin×3×3 and
 * flattens features filter by filter; `toGpu`/`fromGpu` translate. */

import { Tape, freeParams, param, sgd, size, zeroGrads, type GT, type Gpu, type Param } from '../gpu/engine';
import { GRID, type Example } from '../perceptron/model';
import { KMAX, KS, type Net } from './model';

interface GLayer {
  W: Param; // (cin·9) × cout
  b: Param; // 1 × cout
}

export class CnnGpu {
  private layers: GLayer[];
  private D: Param; // features × classes, features in NHWC order
  private db: Param;
  private lossAcc: GPUBuffer;
  private lastLogits: GPUBuffer | null = null;

  constructor(private g: Gpu, private n: Net) {
    const { layers, D, db } = toGpu(n);
    this.layers = n.layers.map((L, li) => ({ W: param(g, L.cin * 9, L.cout, layers[li].W), b: param(g, 1, L.cout, L.b) }));
    this.D = param(g, n.features, n.classes.length, D);
    this.db = param(g, 1, n.classes.length, db);
    this.lossAcc = g.buffer(1, false);
    g.zero(this.lossAcc, 1);
  }

  private get params(): Param[] {
    return [...this.layers.flatMap((l) => [l.W, l.b]), this.D, this.db];
  }

  load(n: Net) {
    this.n = n;
    const { layers, D, db } = toGpu(n);
    n.layers.forEach((L, li) => {
      this.g.write(this.layers[li].W.buf, layers[li].W);
      this.g.write(this.layers[li].b.buf, L.b);
    });
    this.g.write(this.D.buf, D);
    this.g.write(this.db.buf, db);
  }

  private logits(t: Tape, batch: Example[]): GT {
    const B = batch.length;
    const x = new Float32Array(B * GRID * GRID);
    batch.forEach((e, i) => x.set(e.grid, i * GRID * GRID));
    let a: GT = t.input(x, B * GRID * GRID, 1);
    this.n.layers.forEach((L, li) => {
      const S = L.size;
      const cols = t.im2col(a, { B, H: S, W: S, C: L.cin, kh: KS, kw: KS, pad: 1 });
      const z = t.addRow(t.matmul(cols, this.layers[li].W), this.layers[li].b);
      a = t.maxPool(t.relu(z), { B, H: S, W: S, C: L.cout, ph: L.pool, pw: L.pool }).out;
    });
    // The pooled maps are already laid out example by example: view them as B × features.
    const flat: GT = { buf: a.buf, grad: a.grad, r: B, c: this.n.features };
    return t.addRow(t.matmul(flat, this.D), this.db);
  }

  /** Encode one gradient step on the batch (mean gradient). */
  step(batch: Example[], lr: number, opts: { freezeFirst?: boolean; keepFirst?: boolean } = {}) {
    const g = this.g;
    zeroGrads(g, this.params);
    const t = new Tape(g, true);
    const logits = this.logits(t, batch);
    const targets = Float32Array.from(batch, (e) => this.n.classes.indexOf(e.ch));
    const loss = t.softmaxCE(logits, g.upload(targets), g.upload(new Float32Array(batch.length).fill(1 / batch.length)));
    t.backward();
    sgd(g, this.D, lr, 1);
    sgd(g, this.db, lr, 1);
    this.layers.forEach((l, li) => {
      if (li === 0 && opts.freezeFirst) return;
      sgd(g, l.W, lr, 1, li === 0 ? KMAX : 0);
      sgd(g, l.b, lr, 1, li === 0 ? KMAX : 0);
    });
    g.run('sumInto', [loss, this.lossAcc], [batch.length, batch.length], 1);
    this.lastLogits = opts.keepFirst ? logits.buf : null;
    g.submit();
  }

  /** Sum of the examples' losses since the last call, and the first example's logits if kept. */
  async collect(): Promise<{ loss: number; first: Float32Array | null }> {
    const items: [GPUBuffer, number][] = [[this.lossAcc, 1]];
    if (this.lastLogits) items.push([this.lastLogits, this.n.classes.length]);
    const [l, first] = await this.g.read(...items);
    this.g.zero(this.lossAcc, 1);
    this.g.submit();
    this.lastLogits = null;
    return { loss: l[0], first: first ?? null };
  }

  async pull(n: Net) {
    const bufs = await this.g.read(...this.params.map((p) => [p.buf, size(p)] as [GPUBuffer, number]));
    fromGpu(n, bufs);
  }

  /** Accuracy and mean loss on a set, on the GPU in chunks. */
  async evaluate(set: Example[]): Promise<{ accuracy: number; loss: number }> {
    if (!set.length) return { accuracy: 0, loss: 0 };
    const C = this.n.classes.length;
    let ok = 0, loss = 0;
    for (let i = 0; i < set.length; i += 128) {
      const chunk = set.slice(i, i + 128);
      const t = new Tape(this.g, false);
      const out = this.logits(t, chunk);
      const [L] = await this.g.read([out.buf, chunk.length * C]);
      chunk.forEach((e, k) => {
        const row = L.subarray(k * C, (k + 1) * C);
        let w = 0, mx = -Infinity, sum = 0;
        for (let c = 0; c < C; c++) if (row[c] > row[w]) w = c;
        for (const v of row) mx = Math.max(mx, v);
        for (const v of row) sum += Math.exp(v - mx);
        const label = this.n.classes.indexOf(e.ch);
        if (w === label) ok++;
        loss -= row[label] - mx - Math.log(sum);
      });
    }
    return { accuracy: ok / set.length, loss: loss / set.length };
  }

  dispose() {
    freeParams(this.g, this.params);
    this.g.release(this.lossAcc);
  }
}

/** CPU layout → GPU layout. */
export function toGpu(n: Net): { layers: { W: Float32Array }[]; D: Float32Array; db: Float32Array } {
  const layers = n.layers.map((L) => {
    const W = new Float32Array(L.cin * 9 * L.cout);
    for (let o = 0; o < L.cout; o++)
      for (let i = 0; i < L.cin; i++) for (let k = 0; k < 9; k++) W[(i * 9 + k) * L.cout + o] = L.w[(o * L.cin + i) * 9 + k];
    return { W };
  });
  const last = n.layers[n.layers.length - 1];
  const T = last.size / last.pool, C = n.classes.length, F = n.features;
  const D = new Float32Array(F * C);
  for (let c = 0; c < C; c++)
    for (let o = 0; o < last.cout; o++)
      for (let p = 0; p < T * T; p++) D[(p * last.cout + o) * C + c] = n.dense[c * F + o * T * T + p];
  return { layers, D, db: n.dbias };
}

/** GPU buffers (in `params` order: W, b per layer, then D, db) → the CPU model, in place. */
export function fromGpu(n: Net, bufs: Float32Array[]) {
  n.layers.forEach((L, li) => {
    const W = bufs[li * 2];
    for (let o = 0; o < L.cout; o++)
      for (let i = 0; i < L.cin; i++) for (let k = 0; k < 9; k++) L.w[(o * L.cin + i) * 9 + k] = W[(i * 9 + k) * L.cout + o];
    L.b.set(bufs[li * 2 + 1]);
  });
  const last = n.layers[n.layers.length - 1];
  const T = last.size / last.pool, C = n.classes.length, F = n.features;
  const D = bufs[n.layers.length * 2];
  for (let c = 0; c < C; c++)
    for (let o = 0; o < last.cout; o++)
      for (let p = 0; p < T * T; p++) n.dense[c * F + o * T * T + p] = D[(p * last.cout + o) * C + c];
  n.dbias.set(bufs[n.layers.length * 2 + 1]);
}
