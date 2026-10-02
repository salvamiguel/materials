/// <reference types="@webgpu/types" />
/* A small WebGPU tensor engine for the AI demos.
 *
 * - `Gpu` owns the device, the compiled kernels and a pool of buffers, so a
 *   training step reuses the same memory every time.
 * - A step records every dispatch into one compute pass and submits once:
 *   the GPU runs it while JavaScript prepares the next one.
 * - `Tape` is reverse-mode autodiff on batches: each operation dispatches its
 *   forward kernel and records the kernels of its backward pass, which run in
 *   reverse after the loss. Gradients accumulate into `grad` buffers.
 *
 * Shapes are 2-D (rows × cols) row-major f32; images are NHWC (one row per
 * pixel, one column per channel) so a convolution is im2col + a matmul. */

import { KERNELS, MATMUL, type KernelName } from './kernels';


export interface GT {
  buf: GPUBuffer;
  r: number;
  c: number;
  /** Gradient buffer, when anything upstream is trainable. */
  grad: GPUBuffer | null;
}

export const size = (t: GT) => t.r * t.c;

const STORAGE = 0x0080 | 0x0004 | 0x0008; // STORAGE | COPY_SRC | COPY_DST
const UNIFORM = 0x0040 | 0x0008; // UNIFORM | COPY_DST

let cached: Promise<Gpu | null> | null = null;
let whyNot = '';

/** The shared GPU, or null (see `gpuUnavailableReason`). */
export function getGpu(): Promise<Gpu | null> {
  if (!cached) cached = Gpu.create();
  return cached;
}

export const gpuUnavailableReason = () => whyNot;

export class Gpu {
  private pipelines = new Map<string, GPUComputePipeline>();
  private free = new Map<number, GPUBuffer[]>();
  private uniforms: GPUBuffer[] = [];
  /** Buffers and uniforms lent during the current step. */
  private lent: GPUBuffer[] = [];
  private lentUniforms: GPUBuffer[] = [];
  private enc: GPUCommandEncoder | null = null;
  private pass: GPUComputePassEncoder | null = null;
  /** Dispatches in the last step, for the curious. */
  dispatches = 0;
  lost = false;

  private constructor(readonly device: GPUDevice, readonly name: string) {
    device.lost.then(() => {
      this.lost = true;
      cached = null;
    });
  }

  static async create(): Promise<Gpu | null> {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.gpu) {
      whyNot = 'Este navegador no ofrece WebGPU.';
      return null;
    }
    try {
      const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        whyNot = 'WebGPU está, pero no hay ninguna GPU disponible.';
        return null;
      }
      const limits = adapter.limits;
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
          maxBufferSize: limits.maxBufferSize,
          maxStorageBuffersPerShaderStage: Math.min(8, limits.maxStorageBuffersPerShaderStage),
        },
      });
      const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
      const name = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' · ') || 'GPU';
      return new Gpu(device, name);
    } catch (e) {
      whyNot = `No se pudo abrir la GPU: ${(e as Error).message}`;
      return null;
    }
  }

  // ── memory ──

  /** A zero-initialised-on-request buffer of n floats, from the pool. Persistent unless `temp`. */
  buffer(n: number, temp = true): GPUBuffer {
    const bytes = Math.max(16, Math.ceil((n * 4) / 16) * 16);
    const list = this.free.get(bytes);
    const b = list?.pop() ?? this.device.createBuffer({ size: bytes, usage: STORAGE });
    if (temp) this.lent.push(b);
    return b;
  }

  /** Give a persistent buffer back to the pool. */
  release(b: GPUBuffer) {
    const list = this.free.get(b.size) ?? [];
    list.push(b);
    this.free.set(b.size, list);
  }

  upload(data: Float32Array, temp = true): GPUBuffer {
    const b = this.buffer(data.length, temp);
    this.device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
    return b;
  }

  write(b: GPUBuffer, data: Float32Array) {
    this.device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  tensor(r: number, c: number, opts: { grad?: boolean; temp?: boolean; data?: Float32Array } = {}): GT {
    const temp = opts.temp ?? true;
    const buf = opts.data ? this.upload(opts.data, temp) : this.buffer(r * c, temp);
    let grad: GPUBuffer | null = null;
    if (opts.grad) {
      grad = this.buffer(r * c, temp);
      this.zero(grad, r * c);
    }
    return { buf, r, c, grad };
  }

  // ── dispatching ──

  private pipeline(key: string, code: string): GPUComputePipeline {
    let p = this.pipelines.get(key);
    if (!p) {
      p = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } });
      this.pipelines.set(key, p);
    }
    return p;
  }

  /** Compile every kernel and report the ones that fail (an invalid kernel would silently void a whole step). */
  async check(): Promise<string[]> {
    const errors: string[] = [];
    const all: [string, string][] = [...Object.entries(KERNELS), ['matmul', MATMUL]];
    for (const [name, code] of all) {
      this.device.pushErrorScope('validation');
      const module = this.device.createShaderModule({ code });
      const info = await module.getCompilationInfo();
      for (const msg of info.messages) if (msg.type === 'error') errors.push(`${name}: ${msg.message} (línea ${msg.lineNum})`);
      this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const err = await this.device.popErrorScope();
      if (err && !errors.some((e) => e.startsWith(name))) errors.push(`${name}: ${err.message}`);
    }
    return errors;
  }

  private ensurePass(): GPUComputePassEncoder {
    if (!this.pass) {
      this.enc = this.device.createCommandEncoder();
      this.pass = this.enc.beginComputePass();
      this.dispatches = 0;
    }
    return this.pass;
  }

  private bind(p: GPUComputePipeline, params: number[], buffers: GPUBuffer[]) {
    const ub = this.uniforms.pop() ?? this.device.createBuffer({ size: 64, usage: UNIFORM });
    this.lentUniforms.push(ub);
    const data = new Float32Array(16);
    data.set(params.slice(0, 16));
    this.device.queue.writeBuffer(ub, 0, data);
    return this.device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ub } }, ...buffers.map((b, i) => ({ binding: i + 1, resource: { buffer: b } }))],
    });
  }

  /** Run a 1-D kernel over `threads` threads. */
  run(name: KernelName, buffers: GPUBuffer[], params: number[], threads: number) {
    if (threads <= 0) return;
    const p = this.pipeline(name, KERNELS[name]);
    const pass = this.ensurePass();
    pass.setPipeline(p);
    pass.setBindGroup(0, this.bind(p, params, buffers));
    const groups = Math.ceil(threads / 64);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    this.dispatches++;
  }

  zero(b: GPUBuffer, n: number) {
    this.run('zero', [b], [n], n);
  }

  /** C (+)= α · op(A) · op(B); A is M×K after op, B is K×N after op. */
  matmulRaw(A: GPUBuffer, B: GPUBuffer, C: GPUBuffer, M: number, N: number, K: number, ta: boolean, tb: boolean, acc: boolean, alpha = 1) {
    const p = this.pipeline('matmul', MATMUL);
    const pass = this.ensurePass();
    pass.setPipeline(p);
    pass.setBindGroup(0, this.bind(p, [M, N, K, ta ? 1 : 0, tb ? 1 : 0, acc ? 1 : 0, alpha], [A, B, C]));
    pass.dispatchWorkgroups(Math.ceil(N / 16), Math.ceil(M / 16));
    this.dispatches++;
  }

  /** Submit everything recorded and recycle the step's temporary memory. */
  submit() {
    if (this.pass && this.enc) {
      this.pass.end();
      this.device.queue.submit([this.enc.finish()]);
    }
    this.pass = null;
    this.enc = null;
    for (const b of this.lent) this.release(b);
    this.lent = [];
    this.uniforms.push(...this.lentUniforms);
    this.lentUniforms = [];
  }

  /** Read buffers back to the CPU (submits pending work first). */
  async read(...items: [GPUBuffer, number][]): Promise<Float32Array[]> {
    this.submit();
    const enc = this.device.createCommandEncoder();
    const staging = items.map(([b, n]) => {
      const bytes = Math.max(16, Math.ceil((n * 4) / 16) * 16);
      const s = this.device.createBuffer({ size: bytes, usage: 0x0001 | 0x0008 }); // MAP_READ | COPY_DST
      enc.copyBufferToBuffer(b, 0, s, 0, bytes);
      return s;
    });
    this.device.queue.submit([enc.finish()]);
    return Promise.all(
      staging.map(async (s, i) => {
        await s.mapAsync(1); // GPUMapMode.READ
        const out = new Float32Array(s.getMappedRange().slice(0, items[i][1] * 4));
        s.unmap();
        s.destroy();
        return out;
      }),
    );
  }

  /** Wait until the GPU has finished everything submitted. */
  async idle() {
    this.submit();
    await this.device.queue.onSubmittedWorkDone();
  }
}

// ── autodiff on batches ──────────────────────────────────────────────

/** Records the backward kernels of one training step. */
export class Tape {
  private back: (() => void)[] = [];
  constructor(readonly g: Gpu, readonly training = true) {}

  private out(r: number, c: number, ...inputs: GT[]): GT {
    return this.g.tensor(r, c, { grad: this.training && inputs.some((t) => t.grad) });
  }

  private record(o: GT, fn: () => void) {
    if (this.training && o.grad) this.back.push(fn);
  }

  /** Run the recorded backward kernels, newest first. */
  backward() {
    for (let i = this.back.length - 1; i >= 0; i--) this.back[i]();
    this.back = [];
  }

  /** A constant (input data, masks…). */
  input(data: Float32Array, r: number, c: number): GT {
    return this.g.tensor(r, c, { data });
  }

  matmul(a: GT, b: GT, ta = false, tb = false): GT {
    const M = ta ? a.c : a.r, K = ta ? a.r : a.c, N = tb ? b.r : b.c;
    const o = this.out(M, N, a, b);
    this.g.matmulRaw(a.buf, b.buf, o.buf, M, N, K, ta, tb, false);
    this.record(o, () => {
      // dA = dO · Bᵀ (or its transpose), dB = Aᵀ · dO.
      if (a.grad) {
        if (!ta) this.g.matmulRaw(o.grad!, b.buf, a.grad, M, K, N, false, !tb, true);
        else this.g.matmulRaw(b.buf, o.grad!, a.grad, K, M, N, tb, true, true);
      }
      if (b.grad) {
        if (!tb) this.g.matmulRaw(a.buf, o.grad!, b.grad, K, N, M, !ta, false, true);
        else this.g.matmulRaw(o.grad!, a.buf, b.grad, N, K, M, true, ta, true);
      }
    });
    return o;
  }

  add(a: GT, b: GT): GT {
    const n = size(a);
    const o = this.out(a.r, a.c, a, b);
    this.g.run('add', [a.buf, b.buf, o.buf], [n], n);
    this.record(o, () => {
      for (const t of [a, b]) if (t.grad) this.g.run('axpy', [o.grad!, t.grad], [n, 1], n);
    });
    return o;
  }

  addRow(a: GT, b: GT): GT {
    const n = size(a);
    const o = this.out(a.r, a.c, a, b);
    this.g.run('addRow', [a.buf, b.buf, o.buf], [n, a.c], n);
    this.record(o, () => {
      if (a.grad) this.g.run('axpy', [o.grad!, a.grad], [n, 1], n);
      if (b.grad) this.g.run('colSum', [o.grad!, b.grad], [a.c, a.r], a.c);
    });
    return o;
  }

  scale(a: GT, s: number): GT {
    const n = size(a);
    const o = this.out(a.r, a.c, a);
    this.g.run('scale', [a.buf, o.buf], [n, s], n);
    this.record(o, () => {
      if (a.grad) this.g.run('axpy', [o.grad!, a.grad], [n, s], n);
    });
    return o;
  }

  relu(a: GT): GT {
    const n = size(a);
    const o = this.out(a.r, a.c, a);
    this.g.run('relu', [a.buf, o.buf], [n], n);
    this.record(o, () => {
      if (a.grad) this.g.run('reluBack', [a.buf, o.grad!, a.grad], [n], n);
    });
    return o;
  }

  /** Adds row (r mod T) of the constant `pe` to every row. */
  addPe(a: GT, pe: GPUBuffer, T: number): GT {
    const n = size(a);
    const o = this.out(a.r, a.c, a);
    this.g.run('addPe', [a.buf, pe, o.buf], [n, a.c, T], n);
    this.record(o, () => {
      if (a.grad) this.g.run('axpy', [o.grad!, a.grad], [n, 1], n);
    });
    return o;
  }

  embed(table: GT, ids: GPUBuffer, tokens: number): GT {
    const d = table.c;
    const o = this.out(tokens, d, table);
    this.g.run('embed', [table.buf, ids, o.buf], [tokens * d, d], tokens * d);
    this.record(o, () => {
      if (table.grad) this.g.run('embedBack', [o.grad!, ids, table.grad], [table.r * d, d, tokens], table.r * d);
    });
    return o;
  }

  layerNorm(a: GT, gamma: GT, beta: GT): GT {
    const o = this.out(a.r, a.c, a, gamma, beta);
    const xhat = this.g.buffer(size(a));
    const inv = this.g.buffer(a.r);
    this.g.run('layerNorm', [a.buf, gamma.buf, beta.buf, o.buf, xhat, inv], [a.r, a.c], a.r);
    this.record(o, () => {
      if (a.grad) this.g.run('layerNormBack', [o.grad!, gamma.buf, xhat, inv, a.grad], [a.r, a.c], a.r);
      if (gamma.grad && beta.grad) this.g.run('layerNormParams', [o.grad!, xhat, gamma.grad, beta.grad], [a.c, a.r], a.c);
    });
    return o;
  }

  /** Multi-head scaled dot-product attention on B sequences at once. q: B·Tq × d; k, v: B·Tk × d.
   *  klen: valid keys per sequence (padding is masked); causal hides later keys. Returns output and the weights. */
  attention(q: GT, k: GT, v: GT, o: { B: number; H: number; Tq: number; Tk: number; klen: GPUBuffer; causal: boolean }): { out: GT; p: GPUBuffer } {
    const { B, H, Tq, Tk, klen, causal } = o;
    const d = q.c, dk = d / H;
    const nS = B * H * Tq * Tk;
    const scores = this.g.buffer(nS);
    const p = this.g.buffer(nS);
    const scale = 1 / Math.sqrt(dk);
    this.g.run('attnScores', [q.buf, k.buf, klen, scores], [nS, H, Tq, Tk, d, scale, causal ? 1 : 0], nS);
    this.g.run('softmaxRows', [scores, p], [B * H * Tq, Tk], B * H * Tq);
    const out = this.out(B * Tq, d, q, k, v);
    this.g.run('attnOut', [p, v.buf, out.buf], [B * Tq * d, H, Tq, Tk, d], B * Tq * d);
    this.record(out, () => {
      const dp = this.g.buffer(nS);
      const ds = this.g.buffer(nS);
      const dims = [H, Tq, Tk, d];
      this.g.run('attnDP', [out.grad!, v.buf, dp], [nS, ...dims], nS);
      this.g.run('softmaxBack', [p, dp, ds], [B * H * Tq, Tk, scale], B * H * Tq);
      if (q.grad) this.g.run('attnDQ', [ds, k.buf, q.grad], [B * Tq * d, ...dims], B * Tq * d);
      if (k.grad) this.g.run('attnDK', [ds, q.buf, k.grad], [B * Tk * d, ...dims], B * Tk * d);
      // dV has the same shape of sum as dK, with the weights in place of dS and dout in place of q.
      if (v.grad) this.g.run('attnDK', [p, out.grad!, v.grad], [B * Tk * d, ...dims], B * Tk * d);
    });
    return { out, p };
  }

  /** 3×3-style patches of NHWC maps: (B·Ho·Wo) × (C·kh·kw). */
  im2col(x: GT, s: { B: number; H: number; W: number; C: number; kh: number; kw: number; pad: number }): GT {
    const Ho = s.H + 2 * s.pad - s.kh + 1, Wo = s.W + 2 * s.pad - s.kw + 1;
    const K = s.C * s.kh * s.kw;
    const o = this.out(s.B * Ho * Wo, K, x);
    const n = size(o);
    const dims = [s.H, s.W, s.C, s.kh, s.kw, s.pad, Ho, Wo];
    this.g.run('im2col', [x.buf, o.buf], [n, ...dims], n);
    this.record(o, () => {
      if (x.grad) this.g.run('col2im', [o.grad!, x.grad], [size(x), ...dims], size(x));
    });
    return o;
  }

  /** Max-pool NHWC maps (B, H, W, C) with a ph×pw window. */
  maxPool(x: GT, s: { B: number; H: number; W: number; C: number; ph: number; pw: number }): { out: GT; arg: GPUBuffer } {
    const nOut = s.B * (s.H / s.ph) * (s.W / s.pw) * s.C;
    const o = this.out(nOut / s.C, s.C, x);
    const arg = this.g.buffer(nOut);
    this.g.run('maxPool', [x.buf, o.buf, arg], [nOut, s.H, s.W, s.C, s.ph, s.pw], nOut);
    this.record(o, () => {
      if (x.grad) this.g.run('maxPoolBack', [o.grad!, arg, x.grad], [nOut], nOut);
    });
    return { out: o, arg };
  }

  /** Softmax cross-entropy; starts the backward pass. Returns the per-row weighted losses. */
  softmaxCE(logits: GT, targets: GPUBuffer, rowScale: GPUBuffer): GPUBuffer {
    const loss = this.g.buffer(logits.r);
    const d = logits.grad ?? this.g.buffer(size(logits));
    this.g.run('softmaxCE', [logits.buf, targets, rowScale, d, loss], [logits.r, logits.c], logits.r);
    return loss;
  }

  /** The perceptron rule as a loss: writes the gradient of the scores; returns per-row mistakes (1/0). */
  perceptronLoss(scores: GT, targets: GPUBuffer): GPUBuffer {
    const wrong = this.g.buffer(scores.r);
    const d = scores.grad ?? this.g.buffer(size(scores));
    this.g.run('perceptronLoss', [scores.buf, targets, d, wrong], [scores.r, scores.c], scores.r);
    return wrong;
  }

  /** The scanner: slide a wh×ww template (columns = units) over B single-channel Hs×Ws images and keep,
   *  per unit, the best position (ties to more ink). Returns B × U scores. */
  scan(x: GT, w: GT, s: { B: number; Hs: number; Ws: number; wh: number; ww: number }): { best: GT; arg: GPUBuffer } {
    const U = w.c;
    const Ho = s.Hs - s.wh + 1, Wo = s.Ws - s.ww + 1, Pn = Ho * Wo;
    const scores = this.g.buffer(s.B * Pn * U);
    const ink = this.g.buffer(s.B * Pn);
    this.g.run('scanScores', [x.buf, w.buf, scores], [s.B * Pn * U, s.Hs, s.Ws, s.wh, s.ww, Ho, Wo, U], s.B * Pn * U);
    this.g.run('scanInk', [x.buf, ink], [s.B * Pn, s.Hs, s.Ws, s.wh, s.ww, Ho, Wo], s.B * Pn);
    const best = this.out(s.B, U, w);
    const arg = this.g.buffer(s.B * U);
    this.g.run('scanMax', [scores, ink, best.buf, arg], [s.B * U, Pn, U], s.B * U);
    this.record(best, () => {
      if (w.grad) this.g.run('scanBack', [best.grad!, arg, x.buf, w.grad], [s.wh * s.ww * U, s.Hs, s.Ws, s.ww, Wo, U, s.B], s.wh * s.ww * U);
    });
    return { best, arg };
  }
}

// ── parameters and optimisers ────────────────────────────────────────

export interface Param extends GT {
  grad: GPUBuffer;
  /** Adam moments, created on first use. */
  m?: GPUBuffer;
  v?: GPUBuffer;
}

export function param(g: Gpu, r: number, c: number, data: Float32Array): Param {
  const t = g.tensor(r, c, { data, temp: false, grad: false });
  const grad = g.buffer(r * c, false);
  g.zero(grad, r * c);
  return { ...t, grad };
}

export function zeroGrads(g: Gpu, ps: Param[]) {
  for (const p of ps) g.zero(p.grad, size(p));
}

export function sgd(g: Gpu, p: Param, lr: number, gscale: number, limit = 0) {
  g.run('sgd', [p.grad, p.buf], [size(p), lr, gscale, limit], size(p));
}

export function adam(g: Gpu, p: Param, o: { lr: number; t: number; gscale: number; clip?: number; b1?: number; b2?: number; eps?: number }) {
  const n = size(p);
  if (!p.m) {
    p.m = g.buffer(n, false);
    p.v = g.buffer(n, false);
    g.zero(p.m, n);
    g.zero(p.v!, n);
  }
  const b1 = o.b1 ?? 0.9, b2 = o.b2 ?? 0.98;
  g.run('adam', [p.grad, p.buf, p.m, p.v!], [n, o.lr, b1, b2, o.eps ?? 1e-9, 1 - Math.pow(b1, o.t), 1 - Math.pow(b2, o.t), o.clip ?? 5, o.gscale], n);
}

export function freeParams(g: Gpu, ps: Param[]) {
  for (const p of ps) for (const b of [p.buf, p.grad, p.m, p.v]) if (b) g.release(b);
}
