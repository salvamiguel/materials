/* A small Transformer, as in "Attention Is All You Need" (Vaswani et al.,
 * 2017), free of React so it can be tested. Two kinds share every piece:
 *
 *   gpt (decoder only, like GPT): the words so far → masked self-attention,
 *     each word looking only at the ones before it → the next word.
 *
 *   translator (the paper's encoder–decoder):
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
import { BOS, EOS, LM_VOCAB, MAX_SRC, MAX_TGT, SRC_VOCAB, TGT_VOCAB, nextWords, reference, type Pair } from './grammar';

export type Kind = 'gpt' | 'translator';

export interface Config {
  kind: Kind;
  d: number;
  heads: number;
  ff: number;
  layers: number;
  /** Sinusoidal positional encoding; without it the model cannot tell word order. */
  posEnc: boolean;
}

export const DEFAULT_CONFIG: Config = { kind: 'translator', d: 32, heads: 2, ff: 64, layers: 1, posEnc: true };
export const GPT_CONFIG: Config = { ...DEFAULT_CONFIG, kind: 'gpt', layers: 2 };
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
  /** Translator only: attention to the encoder. */
  cross?: Attn;
  n2?: Norm;
  ffn: FFN;
  n3: Norm;
}

export interface Model {
  cfg: Config;
  /** Translator only. */
  srcEmb: Mat | null;
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
/** Words the decoder reads and writes. */
export const outVocab = (m: Model | Config) => (('cfg' in m ? m.cfg : m).kind === 'gpt' ? LM_VOCAB : TGT_VOCAB);

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

  const seq2seq = cfg.kind === 'translator';
  const V = outVocab(cfg).length;
  const srcEmb = seq2seq ? mat(SRC_VOCAB.length, d, 1 / Math.sqrt(d)) : null;
  const tgtEmb = mat(V, d, 1 / Math.sqrt(d));
  const enc = seq2seq ? Array.from({ length: cfg.layers }, () => ({ self: attn(), n1: norm(), ffn: ffn(), n2: norm() })) : [];
  const dec: DecLayer[] = Array.from({ length: cfg.layers }, () =>
    seq2seq ? { self: attn(), n1: norm(), cross: attn(), n2: norm(), ffn: ffn(), n3: norm() } : { self: attn(), n1: norm(), ffn: ffn(), n3: norm() },
  );
  const wout = glorot(d, V);
  const bout = zeros(V);
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
  let x = embed(g, m, m.srcEmb!, src);
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

/** The decoder; `memory` is the encoder's output, or null for a decoder-only (GPT) model. */
export function decode(g: Graph, m: Model, memory: Mat | null, tgtIn: number[], trace?: Trace): Mat {
  let x = embed(g, m, m.tgtEmb, tgtIn);
  trace?.decStates.push(x.data);
  for (const L of m.dec) {
    const s = multiHead(g, L.self, x, x, m.cfg.heads, true);
    trace?.decSelf.push(s.map);
    x = g.layerNorm(g.add(x, s.out), L.n1.g, L.n1.b);
    if (L.cross && L.n2 && memory) {
      const c = multiHead(g, L.cross, x, memory, m.cfg.heads, false);
      trace?.cross.push(c.map);
      x = g.layerNorm(g.add(x, c.out), L.n2.g, L.n2.b);
    }
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
export function trainBatch(m: Model, batch: (Pair | string[])[], opt: Optim = DEFAULT_OPTIM): number {
  let loss = 0;
  for (const p of batch) {
    const g = new Graph(true);
    const l = Array.isArray(p) ? lmLoss(g, m, p) : pairLoss(g, m, p);
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

// ── the language model (GPT mode) ────────────────────────────────────

const lmIds = (words: string[]) => ids(words, LM_VOCAB);
export const lmId = (w: string) => LM_VOCAB.indexOf(w);

/** Loss of predicting every next word of a sentence; one pass covers all positions thanks to the mask. */
export function lmLoss(g: Graph, m: Model, sentence: string[]): Mat {
  const seq = lmIds([BOS, ...sentence, EOS]);
  const logits = decode(g, m, null, seq.slice(0, -1));
  return g.crossEntropy(logits, seq.slice(1));
}

export interface Prediction {
  /** Every word, most likely first. */
  ranked: { word: string; p: number }[];
  /** Attention and vectors of the whole prefix (<s> + words). */
  trace: Trace;
  /** What the model would say next at every position of the prefix. */
  guesses: string[];
}

/** Probabilities of the next word after `prefix`. */
export function predictNext(m: Model, prefix: string[]): Prediction {
  const trace = emptyTrace();
  const logits = decode(new Graph(false), m, null, lmIds([BOS, ...prefix]), trace);
  const V = logits.c;
  const row = (r: number) => softmax(logits.data.subarray(r * V, (r + 1) * V));
  const guesses = Array.from({ length: logits.r }, (_, r) => {
    const p = row(r);
    let best = 0;
    for (let i = 1; i < V; i++) if (p[i] > p[best]) best = i;
    return LM_VOCAB[best];
  });
  const last = row(logits.r - 1);
  const ranked = Array.from(last, (p, i) => ({ word: LM_VOCAB[i], p })).sort((a, b) => b.p - a.p);
  return { ranked, trace, guesses };
}

/** Pick a word from a prediction: the most likely at temperature 0, more adventurous as it rises. */
export function sample(ranked: Prediction['ranked'], temperature: number, r: () => number): string {
  const usable = ranked.filter((x) => x.word !== BOS && x.word !== LM_VOCAB[0]);
  if (temperature <= 0.01) return usable[0].word;
  const w = usable.map((x) => Math.pow(Math.max(x.p, 1e-12), 1 / temperature));
  const total = w.reduce((a, b) => a + b, 0);
  let t = r() * total;
  for (let i = 0; i < usable.length; i++) if ((t -= w[i]) <= 0) return usable[i].word;
  return usable[0].word;
}

/** Continue `prefix` word by word until the model ends the sentence. */
export function generate(m: Model, prefix: string[], temperature: number, r: () => number): string[] {
  const out = [...prefix];
  while (out.length <= MAX_SRC) {
    const w = sample(predictNext(m, out).ranked, temperature, r);
    if (w === EOS) return out;
    out.push(w);
  }
  return out;
}

/** How well the model knows the grammar: is its top guess for the next word allowed, and are the sentences it writes correct? */
export function lmEvaluate(m: Model, sentences: string[][], samples: number, seed = 1): { next: number; generated: number } {
  let ok = 0, total = 0;
  for (const s of sentences) {
    const { guesses } = predictNext(m, s);
    guesses.forEach((gss, i) => {
      total++;
      if (nextWords(s.slice(0, i))?.includes(gss)) ok++;
    });
  }
  const r = rng(seed);
  let good = 0;
  for (let k = 0; k < samples; k++) {
    const s = generate(m, [], 1, r);
    if (s.length <= MAX_SRC && reference(s)) good++;
  }
  return { next: ok / total, generated: samples ? good / samples : 0 };
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
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, cfg: m.cfg, vocab: [m.srcEmb ? SRC_VOCAB.length : 0, outVocab(m).length], scales }));
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
  // Files saved before the GPT mode existed are translators.
  if (x && x.kind === undefined) x.kind = 'translator';
  return !!x && (x.kind === 'gpt' || x.kind === 'translator') && HEAD_OPTIONS.includes(x.heads) && LAYER_OPTIONS.includes(x.layers) && x.d === DEFAULT_CONFIG.d && x.ff === DEFAULT_CONFIG.ff && typeof x.posEnc === 'boolean';
}

export function unpack(bytes: Uint8Array): Model {
  if (bytes[0] !== MAGIC) throw new Error('No es un fichero de pesos del Transformer');
  const hl = (bytes[1] << 8) | bytes[2];
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(3, 3 + hl)));
  if (h.v !== 1 || !validCfg(h.cfg) || h.vocab?.[0] !== (h.cfg.kind === 'translator' ? SRC_VOCAB.length : 0) || h.vocab?.[1] !== outVocab(h.cfg).length)
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
  return JSON.stringify({ format: 'transformer', v: 1, cfg: m.cfg, vocab: { in: m.srcEmb ? SRC_VOCAB : null, out: outVocab(m) }, params: m.params.map((p) => Array.from(p.data, r4)) });
}

export function fromJSON(text: string): Model {
  const j = JSON.parse(text);
  if (j?.format !== 'transformer' || j.v !== 1 || !validCfg(j.cfg)) throw new Error('No es un fichero de pesos del Transformer');
  const inOk = j.cfg.kind === 'translator' ? (j.vocab?.in ?? j.vocab?.es)?.join() === SRC_VOCAB.join() : true;
  if (!inOk || (j.vocab?.out ?? j.vocab?.en)?.join() !== outVocab(j.cfg).join()) throw new Error('El vocabulario no coincide');
  const m = newModel(j.cfg);
  if (!Array.isArray(j.params) || j.params.length !== m.params.length) throw new Error('El fichero de pesos está incompleto');
  m.params.forEach((p, k) => {
    const s = j.params[k];
    if (!Array.isArray(s) || s.length !== p.data.length) throw new Error('El fichero de pesos está incompleto');
    for (let i = 0; i < s.length; i++) p.data[i] = Number(s[i]) || 0;
  });
  return m;
}
