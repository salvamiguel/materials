/* The Transformer on the GPU: the same model and Adam as model.ts, with a
 * whole mini-batch in one pass. Sentences are padded to a fixed length; the
 * padding is masked out of every attention and ignored by the loss, so the
 * result is the CPU's mean gradient over the batch. Parameters keep the CPU
 * layout, so moving them back and forth is a copy. */

import { Tape, adam, param, freeParams, size, zeroGrads, type GT, type Gpu, type Param } from '../gpu/engine';
import type { Mat } from './autograd';
import { BOS, EOS, LM_VOCAB, MAX_SRC, MAX_TGT, SRC_VOCAB, TGT_VOCAB, nextWords, reference, type Pair } from './grammar';
import { positionalEncoding, sample, scheduledLr, type Model, type Optim } from './model';

type Attn = Model['dec'][number]['self'];
type Ffn = Model['dec'][number]['ffn'];

/** GPT inputs: <s> + up to MAX_SRC words. Translator: MAX_SRC Spanish words, <s> + up to MAX_TGT − 1 English words. */
const T_LM = MAX_SRC + 1;
const T_SRC = MAX_SRC;
const T_TGT = MAX_TGT;

interface Batch {
  B: number;
  tgt: Float32Array; // decoder input ids, B·Tt
  tgtLen: Float32Array; // B
  targets: Float32Array; // B·Tt, −1 = ignore
  rowScale: Float32Array; // B·Tt
  src?: Float32Array; // B·Ts
  srcLen?: Float32Array; // B
}

export class TransformerGpu {
  private P = new Map<Mat, Param>();
  private params: Param[];
  private t: number;
  private lossAcc: GPUBuffer;
  private pe = new Map<number, GPUBuffer>();

  constructor(private g: Gpu, private m: Model) {
    this.params = m.params.map((mat, k) => {
      const p = param(g, mat.r, mat.c, mat.data);
      p.m = g.upload(m.adam.m[k], false);
      p.v = g.upload(m.adam.v[k], false);
      this.P.set(mat, p);
      return p;
    });
    this.t = m.adam.t;
    this.lossAcc = g.buffer(1, false);
    g.zero(this.lossAcc, 1);
  }

  /** Replace weights and optimiser state (a model loaded or reset on the page). */
  load(m: Model) {
    if (m.params.length !== this.params.length) throw new Error('Otra arquitectura: crea un TransformerGpu nuevo');
    this.m = m;
    this.P.clear();
    m.params.forEach((mat, k) => {
      const p = this.params[k];
      this.g.write(p.buf, mat.data);
      this.g.write(p.m!, m.adam.m[k]);
      this.g.write(p.v!, m.adam.v[k]);
      this.P.set(mat, p);
    });
    this.t = m.adam.t;
  }

  private p = (mat: Mat) => this.P.get(mat)!;

  private peBuf(T: number): GPUBuffer {
    let b = this.pe.get(T);
    if (!b) {
      b = this.g.upload(positionalEncoding(T, this.m.cfg.d).data, false);
      this.pe.set(T, b);
    }
    return b;
  }

  private embedIn(t: Tape, table: Mat, ids: Float32Array, B: number, T: number): GT {
    let x = t.embed(this.p(table), this.g.upload(ids), B * T);
    x = t.scale(x, Math.sqrt(this.m.cfg.d));
    return this.m.cfg.posEnc ? t.addPe(x, this.peBuf(T), T) : x;
  }

  private mha(t: Tape, A: Attn, xq: GT, xkv: GT, o: { B: number; Tq: number; Tk: number; klen: GPUBuffer; causal: boolean }): GT {
    const q = t.matmul(xq, this.p(A.wq));
    const k = t.matmul(xkv, this.p(A.wk));
    const v = t.matmul(xkv, this.p(A.wv));
    return t.matmul(t.attention(q, k, v, { ...o, H: this.m.cfg.heads }).out, this.p(A.wo));
  }

  private ffn(t: Tape, F: Ffn, x: GT): GT {
    return t.addRow(t.matmul(t.relu(t.addRow(t.matmul(x, this.p(F.w1)), this.p(F.b1))), this.p(F.w2)), this.p(F.b2));
  }

  private logits(t: Tape, b: Batch): GT {
    const m = this.m;
    const Tt = b.tgt.length / b.B;
    let memory: GT | null = null;
    let srcLen: GPUBuffer | null = null;
    if (b.src && b.srcLen) {
      srcLen = this.g.upload(b.srcLen);
      let x = this.embedIn(t, m.srcEmb!, b.src, b.B, T_SRC);
      for (const L of m.enc) {
        x = t.layerNorm(t.add(x, this.mha(t, L.self, x, x, { B: b.B, Tq: T_SRC, Tk: T_SRC, klen: srcLen, causal: false })), this.p(L.n1.g), this.p(L.n1.b));
        x = t.layerNorm(t.add(x, this.ffn(t, L.ffn, x)), this.p(L.n2.g), this.p(L.n2.b));
      }
      memory = x;
    }
    const tgtLen = this.g.upload(b.tgtLen);
    let x = this.embedIn(t, m.tgtEmb, b.tgt, b.B, Tt);
    for (const L of m.dec) {
      x = t.layerNorm(t.add(x, this.mha(t, L.self, x, x, { B: b.B, Tq: Tt, Tk: Tt, klen: tgtLen, causal: true })), this.p(L.n1.g), this.p(L.n1.b));
      if (L.cross && L.n2 && memory && srcLen)
        x = t.layerNorm(t.add(x, this.mha(t, L.cross, x, memory, { B: b.B, Tq: Tt, Tk: T_SRC, klen: srcLen, causal: false })), this.p(L.n2.g), this.p(L.n2.b));
      x = t.layerNorm(t.add(x, this.ffn(t, L.ffn, x)), this.p(L.n3.g), this.p(L.n3.b));
    }
    return t.addRow(t.matmul(x, this.p(m.wout)), this.p(m.bout));
  }

  /** Encode one Adam step on a mini-batch (sentences for GPT, pairs for the translator). */
  step(batch: (string[] | Pair)[], opt: Optim) {
    const g = this.g;
    zeroGrads(g, this.params);
    const b = this.batch(batch);
    const t = new Tape(g, true);
    const loss = t.softmaxCE(this.logits(t, b), g.upload(b.targets), g.upload(b.rowScale));
    t.backward();
    this.t++;
    const lr = scheduledLr(opt, this.t);
    for (const p of this.params) adam(g, p, { lr, t: this.t, gscale: 1 });
    g.run('sumInto', [loss, this.lossAcc], [b.tgt.length, 1], 1);
    g.submit();
  }

  /** The mean gradients of a batch, without updating (to check the GPU against the CPU). */
  async gradients(batch: (string[] | Pair)[]): Promise<Float32Array[]> {
    const g = this.g;
    zeroGrads(g, this.params);
    const b = this.batch(batch);
    const t = new Tape(g, true);
    t.softmaxCE(this.logits(t, b), g.upload(b.targets), g.upload(b.rowScale));
    t.backward();
    return g.read(...this.params.map((p) => [p.grad, size(p)] as [GPUBuffer, number]));
  }

  /** Sum of the steps' mean losses since the last call. */
  async collect(): Promise<number> {
    const [l] = await this.g.read([this.lossAcc, 1]);
    this.g.zero(this.lossAcc, 1);
    this.g.submit();
    return l[0];
  }

  /** Weights and optimiser state back into the CPU model. */
  async pull(m: Model) {
    const items: [GPUBuffer, number][] = [];
    for (const p of this.params) items.push([p.buf, size(p)], [p.m!, size(p)], [p.v!, size(p)]);
    const out = await this.g.read(...items);
    m.params.forEach((mat, k) => {
      mat.data.set(out[k * 3]);
      m.adam.m[k].set(out[k * 3 + 1]);
      m.adam.v[k].set(out[k * 3 + 2]);
    });
    m.adam.t = this.t;
  }

  // ── batches ──

  private batch(items: (string[] | Pair)[]): Batch {
    const B = items.length;
    const gpt = this.m.cfg.kind === 'gpt';
    const Tt = gpt ? T_LM : T_TGT;
    const V = gpt ? LM_VOCAB : TGT_VOCAB;
    const b: Batch = {
      B,
      tgt: new Float32Array(B * Tt),
      tgtLen: new Float32Array(B),
      targets: new Float32Array(B * Tt).fill(-1),
      rowScale: new Float32Array(B * Tt),
    };
    if (!gpt) {
      b.src = new Float32Array(B * T_SRC);
      b.srcLen = new Float32Array(B);
    }
    items.forEach((it, i) => {
      const words = Array.isArray(it) ? it : it.en;
      const seq = [BOS, ...words, EOS].map((w) => V.indexOf(w));
      const n = seq.length - 1; // decoder positions
      for (let k = 0; k < n; k++) {
        b.tgt[i * Tt + k] = seq[k];
        b.targets[i * Tt + k] = seq[k + 1];
        b.rowScale[i * Tt + k] = 1 / (n * B);
      }
      b.tgtLen[i] = n;
      if (!Array.isArray(it)) {
        it.es.forEach((w, k) => (b.src![i * T_SRC + k] = SRC_VOCAB.indexOf(w)));
        b.srcLen![i] = it.es.length;
      }
    });
    return b;
  }

  /** Decoder inputs for prefixes being written (GPT: <s> + words; translator: + the source). */
  private prefixBatch(prefixes: string[][], sources?: string[][]): Batch {
    const B = prefixes.length;
    const gpt = this.m.cfg.kind === 'gpt';
    const Tt = gpt ? T_LM : T_TGT;
    const V = gpt ? LM_VOCAB : TGT_VOCAB;
    const b: Batch = { B, tgt: new Float32Array(B * Tt), tgtLen: new Float32Array(B), targets: new Float32Array(0), rowScale: new Float32Array(0) };
    prefixes.forEach((p, i) => {
      [BOS, ...p].forEach((w, k) => (b.tgt[i * Tt + k] = V.indexOf(w)));
      b.tgtLen[i] = p.length + 1;
    });
    if (sources) {
      b.src = new Float32Array(B * T_SRC);
      b.srcLen = new Float32Array(B);
      sources.forEach((s, i) => {
        s.forEach((w, k) => (b.src![i * T_SRC + k] = SRC_VOCAB.indexOf(w)));
        b.srcLen![i] = s.length;
      });
    }
    return b;
  }

  /** Logits of every position, read back. */
  private async run(b: Batch): Promise<{ data: Float32Array; T: number; V: number }> {
    const t = new Tape(this.g, false);
    const out = this.logits(t, b);
    const [data] = await this.g.read([out.buf, size(out)]);
    return { data, T: b.tgt.length / b.B, V: out.c };
  }

  /** Probabilities after each prefix's last word. */
  private async nextProbs(prefixes: string[][], sources?: string[][]): Promise<Float32Array[]> {
    const { data, T, V } = await this.run(this.prefixBatch(prefixes, sources));
    return prefixes.map((p, i) => {
      const row = data.subarray((i * T + p.length) * V, (i * T + p.length + 1) * V);
      let mx = -Infinity;
      for (const v of row) mx = Math.max(mx, v);
      const e = row.map((v) => Math.exp(v - mx));
      const s = e.reduce((a, b2) => a + b2, 0);
      return e.map((v) => v / s);
    });
  }

  // ── evaluation, batched ──

  /** GPT: how often the favourite next word is grammatical, and how many written sentences are. */
  async lmEvaluate(sentences: string[][], samples: number, r: () => number): Promise<{ next: number; generated: number; written: string[][] }> {
    const { data, T, V } = await this.run(this.prefixBatch(sentences));
    let ok = 0, total = 0;
    sentences.forEach((s, i) => {
      for (let k = 0; k <= s.length; k++) {
        const row = data.subarray((i * T + k) * V, (i * T + k + 1) * V);
        let best = 0;
        for (let j = 1; j < V; j++) if (row[j] > row[best]) best = j;
        total++;
        if (nextWords(s.slice(0, k))?.includes(LM_VOCAB[best])) ok++;
      }
    });
    const written = await this.generate(samples, 1, r);
    const good = written.filter((s) => s.length <= MAX_SRC && reference(s)).length;
    return { next: ok / total, generated: samples ? good / samples : 0, written };
  }

  /** GPT: write `count` sentences from scratch, all at once. */
  async generate(count: number, temperature: number, r: () => number): Promise<string[][]> {
    const out: string[][] = Array.from({ length: count }, () => []);
    const done = new Array(count).fill(false);
    while (done.some((d) => !d)) {
      const active = out.map((_, i) => i).filter((i) => !done[i]);
      const probs = await this.nextProbs(active.map((i) => out[i]));
      active.forEach((i, k) => {
        const ranked = Array.from(probs[k], (p, j) => ({ word: LM_VOCAB[j], p })).sort((a, b) => b.p - a.p);
        const w = sample(ranked, temperature, r);
        if (w === EOS) done[i] = true;
        else {
          out[i].push(w);
          if (out[i].length > MAX_SRC) done[i] = true;
        }
      });
    }
    return out;
  }

  /** Translator: greedy translations of a batch of Spanish sentences, and how many are exact. */
  async translateExact(pairs: Pair[]): Promise<number> {
    const out: string[][] = pairs.map(() => []);
    const done = new Array(pairs.length).fill(false);
    for (let step = 0; step < MAX_TGT && done.some((d) => !d); step++) {
      const active = pairs.map((_, i) => i).filter((i) => !done[i]);
      const probs = await this.nextProbs(active.map((i) => out[i]), active.map((i) => pairs[i].es));
      active.forEach((i, k) => {
        let best = 0;
        for (let j = 1; j < probs[k].length; j++) if (probs[k][j] > probs[k][best]) best = j;
        const w = TGT_VOCAB[best];
        if (w === EOS) done[i] = true;
        else out[i].push(w);
      });
    }
    return pairs.filter((p, i) => out[i].join(' ') === p.en.join(' ')).length / Math.max(1, pairs.length);
  }

  dispose() {
    freeParams(this.g, this.params);
    for (const b of this.pe.values()) this.g.release(b);
    this.g.release(this.lossAcc);
  }
}
