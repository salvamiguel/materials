/* Convolutional network demo: the network's logic, free of React so it can be tested.
 *
 *   retina 16×16 → [conv 3×3 → ReLU → max-pool] × L → flatten → dense → softmax
 *
 * Each filter is a 3×3 window of weights (one per input map) plus a bias,
 * slid over the whole image with "same" padding, so the same detector — a
 * vertical stroke, a corner — fires wherever the stroke is. Max-pooling keeps
 * the strongest response of each block, so small shifts stop mattering. A
 * second layer combines the first layer's maps into larger shapes, as LeNet
 * did. Training is stochastic gradient descent on the cross-entropy loss,
 * one example at a time, with gradients from backpropagation. */

import { GRID, decodeBytes, encodeBytes, rng, type Example, type Grid } from '../perceptron/model';

export const KS = 3;
/** First-layer knobs turn between -KMAX and +KMAX; training respects the same end stops. */
export const KMAX = 2;

export type ArchId = 'shallow' | 'lenet';

export const ARCHS: Record<ArchId, { label: string; short: string; blurb: string; layers: { c: number; pool: number }[] }> = {
  shallow: {
    label: '1 CAPA',
    short: '4 filtros',
    blurb: 'Una capa de 4 filtros 3×3. Cada filtro busca un rasgo (un trazo, un borde) en toda la imagen; el max-pool 4×4 resume dónde apareció.',
    layers: [{ c: 4, pool: 4 }],
  },
  lenet: {
    label: '2 CAPAS',
    short: '4 → 8 filtros',
    blurb: 'Como LeNet: 4 filtros buscan trazos y 8 filtros de la segunda capa combinan esos trazos en formas más grandes (esquinas, curvas, cruces).',
    layers: [
      { c: 4, pool: 2 },
      { c: 8, pool: 4 },
    ],
  },
};

export interface Layer {
  cin: number;
  cout: number;
  /** Side of the square maps this layer reads (and writes, before pooling). */
  size: number;
  pool: number;
  /** cout × cin × 3 × 3. */
  w: Float32Array;
  b: Float32Array;
}

/** Filter-count multipliers: ×1 is the demo's 4 (→ 8) filters; bigger nets do the same with more of them. */
export const WIDTHS = [1, 4, 8, 16];

export interface Net {
  arch: ArchId;
  /** Multiplies every layer's filter count. */
  width: number;
  classes: string[];
  layers: Layer[];
  /** classes × features. */
  dense: Float32Array;
  dbias: Float32Array;
  features: number;
}

export const wi = (L: Layer, o: number, i: number, v: number, u: number) => ((o * L.cin + i) * KS + v) * KS + u;
export const clampK = (v: number) => Math.max(-KMAX, Math.min(KMAX, v));

function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Random start (He initialisation): a network of zeros would never break symmetry. */
export function newNet(arch: ArchId, classes: string[], seed = 1, width = 1): Net {
  const r = rng(seed);
  let cin = 1, size = GRID;
  const layers: Layer[] = ARCHS[arch].layers.map(({ c: base, pool }, li) => {
    const c = base * width;
    const sd = Math.sqrt(2 / (9 * cin));
    const w = new Float32Array(c * cin * 9);
    // The first layer's weights sit on knobs: start them on the knobs' 0.05 detents.
    for (let i = 0; i < w.length; i++) w[i] = li === 0 ? clampK(Math.round(gauss(r) * sd * 20) / 20) : gauss(r) * sd;
    const L = { cin, cout: c, size, pool, w, b: new Float32Array(c) };
    cin = c;
    size = size / pool;
    return L;
  });
  const features = cin * size * size;
  const dense = new Float32Array(classes.length * features);
  const sd = Math.sqrt(2 / features);
  for (let i = 0; i < dense.length; i++) dense[i] = gauss(r) * sd;
  return { arch, width, classes, layers, dense, dbias: new Float32Array(classes.length), features };
}

// ── forward pass ─────────────────────────────────────────────────────

export interface LayerAct {
  /** What the layer read: cin maps of size×size. */
  input: Float32Array;
  /** Pre-activation z = Σ w·x + b, cout maps of size×size. */
  z: Float32Array;
  /** max(0, z). */
  a: Float32Array;
  /** Max-pooled a: cout maps of (size/pool)². */
  pool: Float32Array;
  /** Index into `a` that each pooled cell took its value from. */
  arg: Int32Array;
}

export interface Activations {
  layers: LayerAct[];
  features: Float32Array;
  logits: Float32Array;
  probs: Float32Array;
  winner: number;
}

function convLayer(L: Layer, x: Float32Array): LayerAct {
  const S = L.size, SS = S * S, T = S / L.pool;
  const z = new Float32Array(L.cout * SS);
  const a = new Float32Array(L.cout * SS);
  for (let o = 0; o < L.cout; o++)
    for (let y = 0; y < S; y++)
      for (let xx = 0; xx < S; xx++) {
        let s = L.b[o];
        for (let i = 0; i < L.cin; i++)
          for (let v = 0; v < KS; v++) {
            const yy = y + v - 1;
            if (yy < 0 || yy >= S) continue;
            for (let u = 0; u < KS; u++) {
              const x2 = xx + u - 1;
              if (x2 < 0 || x2 >= S) continue;
              const px = x[i * SS + yy * S + x2];
              if (px) s += L.w[wi(L, o, i, v, u)] * px;
            }
          }
        z[o * SS + y * S + xx] = s;
        a[o * SS + y * S + xx] = s > 0 ? s : 0;
      }
  const pool = new Float32Array(L.cout * T * T);
  const arg = new Int32Array(L.cout * T * T);
  for (let o = 0; o < L.cout; o++)
    for (let py = 0; py < T; py++)
      for (let px = 0; px < T; px++) {
        let best = -1, bi = 0;
        for (let v = 0; v < L.pool; v++)
          for (let u = 0; u < L.pool; u++) {
            const idx = o * SS + (py * L.pool + v) * S + px * L.pool + u;
            if (a[idx] > best) {
              best = a[idx];
              bi = idx;
            }
          }
        pool[o * T * T + py * T + px] = best;
        arg[o * T * T + py * T + px] = bi;
      }
  return { input: x, z, a, pool, arg };
}

export function forward(n: Net, g: Grid): Activations {
  let x = Float32Array.from(g);
  const layers: LayerAct[] = [];
  for (const L of n.layers) {
    const act = convLayer(L, x);
    layers.push(act);
    x = act.pool;
  }
  const C = n.classes.length, F = n.features;
  const logits = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    let s = n.dbias[c];
    for (let j = 0; j < F; j++) s += n.dense[c * F + j] * x[j];
    logits[c] = s;
  }
  const probs = softmax(logits);
  let winner = 0;
  for (let c = 1; c < C; c++) if (probs[c] > probs[winner]) winner = c;
  return { layers, features: x, logits, probs, winner };
}

export function softmax(z: Float32Array): Float32Array {
  let m = -Infinity;
  for (const v of z) if (v > m) m = v;
  const out = new Float32Array(z.length);
  let s = 0;
  for (let i = 0; i < z.length; i++) s += out[i] = Math.exp(z[i] - m);
  for (let i = 0; i < z.length; i++) out[i] /= s;
  return out;
}

/** The arithmetic of one first-layer filter at one retina position, for the magnifier. */
export function magnify(n: Net, g: Grid, f: number, x: number, y: number) {
  const L = n.layers[0];
  const cells = [];
  let z = L.b[f];
  for (let v = 0; v < KS; v++)
    for (let u = 0; u < KS; u++) {
      const yy = y + v - 1, xx = x + u - 1;
      const inside = yy >= 0 && yy < GRID && xx >= 0 && xx < GRID;
      const px = inside ? g[yy * GRID + xx] : 0;
      const w = L.w[wi(L, f, 0, v, u)];
      cells.push({ px, w, inside });
      z += px * w;
    }
  return { cells, bias: L.b[f], z, a: Math.max(0, z) };
}

// ── learning ─────────────────────────────────────────────────────────

export interface StepResult {
  act: Activations;
  loss: number;
  correct: boolean;
  label: number;
}

/** Gradients of every weight, summed over the examples of a mini-batch. */
export interface Grads {
  layers: { w: Float32Array; b: Float32Array }[];
  dense: Float32Array;
  dbias: Float32Array;
}

export const newGrads = (n: Net): Grads => ({
  layers: n.layers.map((L) => ({ w: new Float32Array(L.w.length), b: new Float32Array(L.cout) })),
  dense: new Float32Array(n.dense.length),
  dbias: new Float32Array(n.dbias.length),
});

/** Backpropagation on one example: adds its gradients to `g` without touching the weights. */
export function accumulate(n: Net, ex: Example, g: Grads, opts: { freezeFirst?: boolean } = {}): StepResult {
  const act = forward(n, ex.grid);
  const label = n.classes.indexOf(ex.ch);
  const loss = -Math.log(Math.max(act.probs[label], 1e-12));
  const C = n.classes.length, F = n.features;

  // Output layer: ∂L/∂logit = p − onehot.
  const dlogit = act.probs.slice();
  dlogit[label] -= 1;
  let grad = new Float32Array(F);
  for (let c = 0; c < C; c++) {
    const d = dlogit[c];
    for (let j = 0; j < F; j++) grad[j] += n.dense[c * F + j] * d;
  }
  for (let c = 0; c < C; c++) {
    const d = dlogit[c];
    for (let j = 0; j < F; j++) g.dense[c * F + j] += d * act.features[j];
    g.dbias[c] += d;
  }

  for (let li = n.layers.length - 1; li >= 0; li--) {
    if (li === 0 && opts.freezeFirst) break;
    const L = n.layers[li];
    const A = act.layers[li];
    const S = L.size, SS = S * S;
    // Max-pool sends the gradient to the cell that won; ReLU lets it through only where z > 0.
    const dz = new Float32Array(A.z.length);
    for (let j = 0; j < grad.length; j++) if (A.z[A.arg[j]] > 0) dz[A.arg[j]] += grad[j];
    const dx = li > 0 ? new Float32Array(A.input.length) : null;
    const dw = g.layers[li].w;
    const db = g.layers[li].b;
    for (let o = 0; o < L.cout; o++)
      for (let y = 0; y < S; y++)
        for (let xx = 0; xx < S; xx++) {
          const d = dz[o * SS + y * S + xx];
          if (!d) continue;
          db[o] += d;
          for (let i = 0; i < L.cin; i++)
            for (let v = 0; v < KS; v++) {
              const yy = y + v - 1;
              if (yy < 0 || yy >= S) continue;
              for (let u = 0; u < KS; u++) {
                const x2 = xx + u - 1;
                if (x2 < 0 || x2 >= S) continue;
                const k = wi(L, o, i, v, u);
                const xi = i * SS + yy * S + x2;
                dw[k] += d * A.input[xi];
                if (dx) dx[xi] += d * L.w[k];
              }
            }
        }
    if (!dx) break;
    grad = dx;
  }
  return { act, loss, correct: act.winner === label, label };
}

/** Gradient descent with the mean gradient of `count` examples; the first layer keeps its knobs' end stops. */
export function applyGrads(n: Net, g: Grads, lr: number, count: number, opts: { freezeFirst?: boolean } = {}) {
  const k = lr / count;
  for (let i = 0; i < n.dense.length; i++) n.dense[i] -= k * g.dense[i];
  for (let i = 0; i < n.dbias.length; i++) n.dbias[i] -= k * g.dbias[i];
  n.layers.forEach((L, li) => {
    if (li === 0 && opts.freezeFirst) return;
    const clamp = li === 0 ? clampK : (v: number) => v;
    const G = g.layers[li];
    for (let i = 0; i < L.w.length; i++) L.w[i] = clamp(L.w[i] - k * G.w[i]);
    for (let o = 0; o < L.cout; o++) L.b[o] = clamp(L.b[o] - k * G.b[o]);
  });
}

/** One step of stochastic gradient descent (backpropagation) on one example; mutates the net. */
export function trainStep(n: Net, ex: Example, lr: number, opts: { freezeFirst?: boolean } = {}): StepResult {
  const g = newGrads(n);
  const r = accumulate(n, ex, g, opts);
  applyGrads(n, g, lr, 1, opts);
  return r;
}

/** One step on a mini-batch: the mean gradient of its examples. */
export function trainBatch(n: Net, batch: Example[], lr: number, opts: { freezeFirst?: boolean } = {}): { first: StepResult; loss: number; correct: number } {
  const g = newGrads(n);
  let loss = 0, correct = 0;
  let first: StepResult | null = null;
  for (const ex of batch) {
    const r = accumulate(n, ex, g, opts);
    first ??= r;
    loss += r.loss;
    if (r.correct) correct++;
  }
  applyGrads(n, g, lr, batch.length, opts);
  return { first: first!, loss, correct };
}

export function evaluate(n: Net, set: Example[]): { accuracy: number; loss: number } {
  if (!set.length) return { accuracy: 0, loss: 0 };
  let ok = 0, loss = 0;
  for (const e of set) {
    const a = forward(n, e.grid);
    const l = n.classes.indexOf(e.ch);
    if (a.winner === l) ok++;
    loss -= Math.log(Math.max(a.probs[l], 1e-12));
  }
  return { accuracy: ok / set.length, loss: loss / set.length };
}

// ── hand-made first-layer filters ────────────────────────────────────

export const PRESETS: { id: string; label: string; w: number[]; b: number }[] = [
  { id: 'v', label: 'Trazo vertical', w: [-0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 1, -0.5], b: -1 },
  { id: 'h', label: 'Trazo horizontal', w: [-0.5, -0.5, -0.5, 1, 1, 1, -0.5, -0.5, -0.5], b: -1 },
  { id: 'd1', label: 'Diagonal ↘', w: [1, -0.5, -0.5, -0.5, 1, -0.5, -0.5, -0.5, 1], b: -1 },
  { id: 'd2', label: 'Diagonal ↗', w: [-0.5, -0.5, 1, -0.5, 1, -0.5, 1, -0.5, -0.5], b: -1 },
  { id: 'el', label: 'Borde izquierdo', w: [-1, 1, 0, -1, 1, 0, -1, 1, 0], b: -1 },
  { id: 'et', label: 'Borde superior', w: [-1, -1, -1, 1, 1, 1, 0, 0, 0], b: -1 },
  { id: 'c', label: 'Esquina ┌', w: [-1, -1, -1, -1, 1, 1, -1, 1, 0], b: -1.5 },
  { id: 'end', label: 'Punta (fin de trazo)', w: [-1, -1, -1, -1, 1, -1, -1, 1, -1], b: -0.5 },
  { id: 'blur', label: 'Desenfoque', w: [0.1, 0.1, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1], b: 0 },
  { id: 'zero', label: 'Todo a cero', w: [0, 0, 0, 0, 0, 0, 0, 0, 0], b: 0 },
];

export function applyPreset(n: Net, f: number, id: string) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  n.layers[0].w.set(p.w, f * 9);
  n.layers[0].b[f] = p.b;
}

// ── saving and sharing ───────────────────────────────────────────────
/* A JSON header (architecture, classes, one scale per tensor) followed by
 * every weight as a signed byte of its tensor's scale. */

const MAGIC = 0x43; // 'C'

function tensors(n: Net): Float32Array[] {
  return [...n.layers.flatMap((L) => [L.w, L.b]), n.dense, n.dbias];
}

function validHeader(arch: unknown, classes: unknown): arch is ArchId {
  return typeof arch === 'string' && arch in ARCHS && Array.isArray(classes) && classes.length >= 2;
}

/** Files from before the size option have no width: they are ×1. */
function validWidth(w: unknown): number {
  const v = w === undefined ? 1 : Number(w);
  if (!WIDTHS.includes(v)) throw new Error('Tamaño de red no válido');
  return v;
}

export function pack(n: Net): Uint8Array {
  const ts = tensors(n);
  const scales = ts.map((t) => {
    let m = 1e-6;
    for (const v of t) m = Math.max(m, Math.abs(v));
    return m / 127;
  });
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, arch: n.arch, width: n.width, classes: n.classes, scales }));
  const total = ts.reduce((a, t) => a + t.length, 0);
  const out = new Uint8Array(3 + header.length + total);
  out[0] = MAGIC;
  out[1] = header.length >> 8;
  out[2] = header.length & 0xff;
  out.set(header, 3);
  let o = 3 + header.length;
  ts.forEach((t, ti) => {
    for (const v of t) out[o++] = Math.round(v / scales[ti]) & 0xff;
  });
  return out;
}

export function unpack(bytes: Uint8Array): Net {
  if (bytes[0] !== MAGIC) throw new Error('No es un fichero de pesos de la red convolucional');
  const hl = (bytes[1] << 8) | bytes[2];
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(3, 3 + hl)));
  if (h.v !== 1 || !validHeader(h.arch, h.classes) || !Array.isArray(h.scales)) throw new Error('Formato de pesos desconocido');
  const n = newNet(h.arch, h.classes.map(String), 1, validWidth(h.width));
  const ts = tensors(n);
  if (bytes.length !== 3 + hl + ts.reduce((a, t) => a + t.length, 0) || h.scales.length !== ts.length)
    throw new Error('El fichero de pesos está incompleto');
  let o = 3 + hl;
  ts.forEach((t, ti) => {
    for (let i = 0; i < t.length; i++) t[i] = ((bytes[o++] << 24) >> 24) * Number(h.scales[ti]);
  });
  return n;
}

export const shareCode = (n: Net) => encodeBytes(pack(n));
export const fromShareCode = async (code: string) => unpack(await decodeBytes(code));

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function toJSON(n: Net): string {
  return JSON.stringify({
    format: 'cnn',
    v: 1,
    arch: n.arch,
    width: n.width,
    classes: n.classes,
    layers: n.layers.map((L) => ({ w: Array.from(L.w, r4), b: Array.from(L.b, r4) })),
    dense: Array.from(n.dense, r4),
    dbias: Array.from(n.dbias, r4),
  });
}

export function fromJSON(text: string): Net {
  const j = JSON.parse(text);
  if (j?.format !== 'cnn' || j.v !== 1 || !validHeader(j.arch, j.classes)) throw new Error('No es un fichero de pesos de la red convolucional');
  const n = newNet(j.arch, j.classes.map(String), 1, validWidth(j.width));
  const src: unknown[] = [...(j.layers ?? []).flatMap((L: { w: unknown; b: unknown }) => [L?.w, L?.b]), j.dense, j.dbias];
  const ts = tensors(n);
  if (src.length !== ts.length) throw new Error('El fichero de pesos está incompleto');
  ts.forEach((t, ti) => {
    const s = src[ti];
    if (!Array.isArray(s) || s.length !== t.length) throw new Error('El fichero de pesos está incompleto');
    for (let i = 0; i < t.length; i++) t[i] = Number(s[i]) || 0;
  });
  const L0 = n.layers[0];
  for (let i = 0; i < L0.w.length; i++) L0.w[i] = clampK(L0.w[i]);
  for (let i = 0; i < L0.b.length; i++) L0.b[i] = clampK(L0.b[i]);
  return n;
}
