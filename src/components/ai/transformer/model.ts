/* A small Transformer translator, as in "Attention Is All You Need"
 * (Vaswani et al., 2017), free of React so it can be tested.
 *
 *   Spanish words → embedding·√d + positional encoding
 *     → encoder: [multi-head self-attention → Add & Norm → feed-forward → Add & Norm] × N
 *   English so far → embedding·√d + positional encoding
 *     → decoder: [masked self-attention → Add & Norm → cross-attention to the encoder
 *                 → Add & Norm → feed-forward → Add & Norm] × N
 *     → linear → softmax over the English words
 *
 * Same architecture as the paper (post-norm, sinusoidal positions, scaled
 * dot-product attention, Adam with β₂ = 0.98), only much smaller: d = 32
 * instead of 512, one or two layers instead of six. */

import { decodeBytes, encodeBytes, rng } from '../perceptron/model';
import { Graph, Mat } from './autograd';
import { BOS, EOS, MAX_TGT, SRC_VOCAB, TGT_VOCAB, type Pair } from './grammar';

export interface Config {
  d: number;
  heads: number;
  ff: number;
  layers: number;
  /** Sinusoidal positional encoding; without it the model cannot tell word order. */
  posEnc: boolean;
}

export const DEFAULT_CONFIG: Config = { d: 32, heads: 2, ff: 64, layers: 1, posEnc: true };
export const HEAD_OPTIONS = [1, 2, 4];
export const LAYER_OPTIONS = [1, 2];

interface Attn {
  wq: Mat;
  wk: Mat;
  wv: Mat;
  wo: Mat;
}
interface Norm {
  g: Mat;
  b: Mat;
}
interface FFN {
  w1: Mat;
  b1: Mat;
  w2: Mat;
  b2: Mat;
}
interface EncLayer {
  self: Attn;
  n1: Norm;
  ffn: FFN;
  n2: Norm;
}
interface DecLayer {
  self: Attn;
  n1: Norm;
  cross: Attn;
  n2: Norm;
  ffn: FFN;
  n3: Norm;
}

export interface Model {
  cfg: Config;
  srcEmb: Mat;
  tgtEmb: Mat;
  enc: EncLayer[];
  dec: DecLayer[];
  wout: Mat;
  bout: Mat;
  /** Every trainable matrix, in a fixed order (saving, the optimiser). */
  params: Mat[];
  adam: { m: Float32Array[]; v: Float32Array[]; t: number };
}

export const srcId = (w: string) => SRC_VOCAB.indexOf(w);
export const tgtId = (w: string) => TGT_VOCAB.indexOf(w);

// ── construction ─────────────────────────────────────────────────────

export function newModel(cfg: Config = DEFAULT_CONFIG, seed = 1): Model {
  const r = rng(seed);
  const gauss = () => {
    const u = Math.max(r(), 1e-9), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const params: Mat[] = [];
  const mat = (rows: number, cols: number, sd: number) => {
    const m = new Mat(rows, cols, undefined, true);
    for (let i = 0; i < m.data.length; i++) m.data[i] = gauss() * sd;
    params.push(m);
    return m;
  };
  const glorot = (a: number, b: number) => mat(a, b, Math.sqrt(2 / (a + b)));
  const zeros = (cols: number) => mat(1, cols, 0);
  const ones = (cols: number) => {
    const m = mat(1, cols, 0);
    m.data.fill(1);
    return m;
  };
  const { d, ff } = cfg;
  const attn = (): Attn => ({ wq: glorot(d, d), wk: glorot(d, d), wv: glorot(d, d), wo: glorot(d, d) });
  const norm = (): Norm => ({ g: ones(d), b: zeros(d) });
  const ffn = (): FFN => ({ w1: glorot(d, ff), b1: zeros(ff), w2: glorot(ff, d), b2: zeros(d) });

  const srcEmb = mat(SRC_VOCAB.length, d, 1 / Math.sqrt(d));
  const tgtEmb = mat(TGT_VOCAB.length, d, 1 / Math.sqrt(d));
  const enc = Array.from({ length: cfg.layers }, () => ({ self: attn(), n1: norm(), ffn: ffn(), n2: norm() }));
  const dec = Array.from({ length: cfg.layers }, () => ({ self: attn(), n1: norm(), cross: attn(), n2: norm(), ffn: ffn(), n3: norm() }));
  const wout = glorot(d, TGT_VOCAB.length);
  const bout = zeros(TGT_VOCAB.length);
  return {
    cfg,
    srcEmb,
    tgtEmb,
    enc,
    dec,
    wout,
    bout,
    params,
    adam: { m: params.map((p) => new Float32Array(p.data.length)), v: params.map((p) => new Float32Array(p.data.length)), t: 0 },
  };
}

/** PE(pos, 2i) = sin(pos / 10000^(2i/d)), PE(pos, 2i+1) = cos(…). */
export function positionalEncoding(n: number, d: number): Mat {
  const m = new Mat(n, d);
  for (let pos = 0; pos < n; pos++)
    for (let i = 0; i < d; i += 2) {
      const a = pos / Math.pow(10000, i / d);
      m.data[pos * d + i] = Math.sin(a);
      if (i + 1 < d) m.data[pos * d + i + 1] = Math.cos(a);
    }
  return m;
}

// ── forward pass ─────────────────────────────────────────────────────

/** Attention weights of one sublayer: per head, rows (queries) × cols (keys). */
export interface AttnMap {
  rows: number;
  cols: number;
  heads: Float32Array[];
}

export interface Trace {
  enc: AttnMap[];
  decSelf: AttnMap[];
  cross: AttnMap[];
  /** Vectors of every word entering the encoder and leaving each of its layers (rows × d). */
  encStates: Float32Array[];
  decStates: Float32Array[];
}

export const emptyTrace = (): Trace => ({ enc: [], decSelf: [], cross: [], encStates: [], decStates: [] });

function multiHead(g: Graph, P: Attn, xq: Mat, xkv: Mat, heads: number, causal: boolean): { out: Mat; map: AttnMap } {
  const d = xq.c, dk = d / heads;
  const Q = g.matmul(xq, P.wq), K = g.matmul(xkv, P.wk), V = g.matmul(xkv, P.wv);
  const outs: Mat[] = [];
  const map: AttnMap = { rows: xq.r, cols: xkv.r, heads: [] };
  for (let h = 0; h < heads; h++) {
    const q = g.cols(Q, h * dk, dk), k = g.cols(K, h * dk, dk), v = g.cols(V, h * dk, dk);
    const scores = g.scale(g.matmulT(q, k), 1 / Math.sqrt(dk));
    const p = g.softmaxRows(scores, causal ? (i, j) => j > i : undefined);
    map.heads.push(p.data);
    outs.push(g.matmul(p, v));
  }
  return { out: g.matmul(heads > 1 ? g.concatCols(outs) : outs[0], P.wo), map };
}

function feedForward(g: Graph, P: FFN, x: Mat): Mat {
  return g.addRow(g.matmul(g.relu(g.addRow(g.matmul(x, P.w1), P.b1)), P.w2), P.b2);
}

function embed(g: Graph, m: Model, table: Mat, ids: number[]): Mat {
  const x = g.scale(g.embed(table, ids), Math.sqrt(m.cfg.d));
  return m.cfg.posEnc ? g.add(x, positionalEncoding(ids.length, m.cfg.d)) : x;
}

export function encode(g: Graph, m: Model, src: number[], trace?: Trace): Mat {
  let x = embed(g, m, m.srcEmb, src);
  trace?.encStates.push(x.data);
  for (const L of m.enc) {
    const a = multiHead(g, L.self, x, x, m.cfg.heads, false);
    trace?.enc.push(a.map);
    x = g.layerNorm(g.add(x, a.out), L.n1.g, L.n1.b);
    x = g.layerNorm(g.add(x, feedForward(g, L.ffn, x)), L.n2.g, L.n2.b);
    trace?.encStates.push(x.data);
  }
  return x;
}

export function decode(g: Graph, m: Model, memory: Mat, tgtIn: number[], trace?: Trace): Mat {
  let x = embed(g, m, m.tgtEmb, tgtIn);
  trace?.decStates.push(x.data);
  for (const L of m.dec) {
    const s = multiHead(g, L.self, x, x, m.cfg.heads, true);
    trace?.decSelf.push(s.map);
    x = g.layerNorm(g.add(x, s.out), L.n1.g, L.n1.b);
    const c = multiHead(g, L.cross, x, memory, m.cfg.heads, false);
    trace?.cross.push(c.map);
    x = g.layerNorm(g.add(x, c.out), L.n2.g, L.n2.b);
    x = g.layerNorm(g.add(x, feedForward(g, L.ffn, x)), L.n3.g, L.n3.b);
    trace?.decStates.push(x.data);
  }
  return g.addRow(g.matmul(x, m.wout), m.bout);
}

const ids = (words: string[], vocab: string[]) =>
  words.map((w) => {
    const i = vocab.indexOf(w);
    if (i < 0) throw new Error(`Palabra desconocida: ${w}`);
    return i;
  });

// ── training ─────────────────────────────────────────────────────────

/** Loss on one sentence pair with teacher forcing; accumulates gradients when the graph trains. */
export function pairLoss(g: Graph, m: Model, p: Pair): Mat {
  const src = ids(p.es, SRC_VOCAB);
  const tgt = ids(p.en, TGT_VOCAB);
  const memory = encode(g, m, src);
  const logits = decode(g, m, memory, [tgtId(BOS), ...tgt]);
  return g.crossEntropy(logits, [...tgt, tgtId(EOS)]);
}

export interface Optim {
  lr: number;
  /** Linear warm-up steps, as in the paper's schedule. */
  warmup: number;
}

export const DEFAULT_OPTIM: Optim = { lr: 0.003, warmup: 40 };

/** One optimiser step on a mini-batch. Returns the mean loss. */
export function trainBatch(m: Model, batch: Pair[], opt: Optim = DEFAULT_OPTIM): number {
  let loss = 0;
  for (const p of batch) {
    const g = new Graph(true);
    const l = pairLoss(g, m, p);
    loss += l.data[0];
    g.backward(l);
  }
  const A = m.adam;
  A.t++;
  const lr = opt.lr * Math.min(1, A.t / opt.warmup);
  const b1 = 0.9, b2 = 0.98, eps = 1e-9;
  const c1 = 1 - Math.pow(b1, A.t), c2 = 1 - Math.pow(b2, A.t);
  m.params.forEach((p, k) => {
    const G = p.grad!, M = A.m[k], V = A.v[k];
    for (let i = 0; i < G.length; i++) {
      // Clip each gradient component: a single odd sentence should not throw the model off.
      const gr = Math.max(-5, Math.min(5, G[i] / batch.length));
      M[i] = b1 * M[i] + (1 - b1) * gr;
      V[i] = b2 * V[i] + (1 - b2) * gr * gr;
      p.data[i] -= (lr * (M[i] / c1)) / (Math.sqrt(V[i] / c2) + eps);
    }
    G.fill(0);
  });
  return loss / batch.length;
}

// ── translating ──────────────────────────────────────────────────────

export interface Translation {
  words: string[];
  /** Probability the model gave each chosen word. */
  confidence: number[];
  /** Top alternatives at every step, for the "what else could it say" view. */
  options: { word: string; p: number }[][];
  trace: Trace;
}

function softmax(row: Float32Array): Float32Array {
  let mx = -Infinity;
  for (const v of row) mx = Math.max(mx, v);
  const e = row.map((v) => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Greedy decoding: one English word at a time, each step reading everything said so far. */
export function translate(m: Model, es: string[], forced?: string[]): Translation {
  const src = ids(es, SRC_VOCAB);
  const g = new Graph(false);
  const memory = encode(g, m, src);
  const out: number[] = [];
  const confidence: number[] = [];
  const options: Translation['options'] = [];
  for (let t = 0; t < MAX_TGT; t++) {
    const logits = decode(g, m, memory, [tgtId(BOS), ...out]);
    const V = logits.c;
    const probs = softmax(logits.data.subarray((logits.r - 1) * V, logits.r * V));
    const ranked = Array.from(probs, (p, i) => ({ i, p })).sort((a, b) => b.p - a.p);
    const pick = forced ? tgtId(forced[t] ?? EOS) : ranked[0].i;
    options.push(ranked.slice(0, 4).map((x) => ({ word: TGT_VOCAB[x.i], p: x.p })));
    confidence.push(probs[pick]);
    if (pick === tgtId(EOS) || pick < 0) break;
    out.push(pick);
  }
  // One last pass over the whole output records the attention for every word, EOS included.
  const trace = emptyTrace();
  const g2 = new Graph(false);
  const mem2 = encode(g2, m, src, trace);
  decode(g2, m, mem2, [tgtId(BOS), ...out], trace);
  return { words: out.map((i) => TGT_VOCAB[i]), confidence, options, trace };
}

export function evaluate(m: Model, set: Pair[]): { exact: number; words: number } {
  let exact = 0, right = 0, total = 0;
  for (const p of set) {
    const t = translate(m, p.es).words;
    if (t.join(' ') === p.en.join(' ')) exact++;
    p.en.forEach((w, i) => {
      total++;
      if (t[i] === w) right++;
    });
  }
  return { exact: exact / set.length, words: right / total };
}

export const countParams = (m: Model) => m.params.reduce((a, p) => a + p.data.length, 0);

// ── saving and sharing ───────────────────────────────────────────────

const MAGIC = 0x54; // 'T'

export function pack(m: Model): Uint8Array {
  const scales = m.params.map((p) => {
    let mx = 1e-6;
    for (const v of p.data) mx = Math.max(mx, Math.abs(v));
    return mx / 127;
  });
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, cfg: m.cfg, vocab: [SRC_VOCAB.length, TGT_VOCAB.length], scales }));
  const total = countParams(m);
  const out = new Uint8Array(3 + header.length + total);
  out[0] = MAGIC;
  out[1] = header.length >> 8;
  out[2] = header.length & 0xff;
  out.set(header, 3);
  let o = 3 + header.length;
  m.params.forEach((p, k) => {
    for (const v of p.data) out[o++] = Math.round(v / scales[k]) & 0xff;
  });
  return out;
}

function validCfg(c: unknown): c is Config {
  const x = c as Config;
  return !!x && HEAD_OPTIONS.includes(x.heads) && LAYER_OPTIONS.includes(x.layers) && x.d === DEFAULT_CONFIG.d && x.ff === DEFAULT_CONFIG.ff && typeof x.posEnc === 'boolean';
}

export function unpack(bytes: Uint8Array): Model {
  if (bytes[0] !== MAGIC) throw new Error('No es un fichero de pesos del Transformer');
  const hl = (bytes[1] << 8) | bytes[2];
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(3, 3 + hl)));
  if (h.v !== 1 || !validCfg(h.cfg) || h.vocab?.[0] !== SRC_VOCAB.length || h.vocab?.[1] !== TGT_VOCAB.length)
    throw new Error('Formato de pesos desconocido');
  const m = newModel(h.cfg);
  if (bytes.length !== 3 + hl + countParams(m) || h.scales.length !== m.params.length) throw new Error('El fichero de pesos está incompleto');
  let o = 3 + hl;
  m.params.forEach((p, k) => {
    for (let i = 0; i < p.data.length; i++) p.data[i] = ((bytes[o++] << 24) >> 24) * Number(h.scales[k]);
  });
  return m;
}

export const shareCode = (m: Model) => encodeBytes(pack(m));
export const fromShareCode = async (code: string) => unpack(await decodeBytes(code));

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function toJSON(m: Model): string {
  return JSON.stringify({ format: 'transformer', v: 1, cfg: m.cfg, vocab: { es: SRC_VOCAB, en: TGT_VOCAB }, params: m.params.map((p) => Array.from(p.data, r4)) });
}

export function fromJSON(text: string): Model {
  const j = JSON.parse(text);
  if (j?.format !== 'transformer' || j.v !== 1 || !validCfg(j.cfg)) throw new Error('No es un fichero de pesos del Transformer');
  if (j.vocab?.es?.join() !== SRC_VOCAB.join() || j.vocab?.en?.join() !== TGT_VOCAB.join()) throw new Error('El vocabulario no coincide');
  const m = newModel(j.cfg);
  if (!Array.isArray(j.params) || j.params.length !== m.params.length) throw new Error('El fichero de pesos está incompleto');
  m.params.forEach((p, k) => {
    const s = j.params[k];
    if (!Array.isArray(s) || s.length !== p.data.length) throw new Error('El fichero de pesos está incompleto');
    for (let i = 0; i < s.length; i++) p.data[i] = Number(s[i]) || 0;
  });
  return m;
}
