/* A tiny reverse-mode automatic differentiation engine for 2-D matrices:
 * just the operations a Transformer needs. Every operation run on a Graph
 * records how to send gradients back to its inputs; `backward` replays the
 * record in reverse. Parameters keep their gradient between calls so a
 * batch can accumulate before the optimiser step. */

export class Mat {
  readonly data: Float32Array;
  grad: Float32Array | null = null;
  constructor(
    readonly r: number,
    readonly c: number,
    data?: Float32Array,
    /** Parameters (and anything depending on them) carry gradients. */
    readonly needsGrad = false,
  ) {
    this.data = data ?? new Float32Array(r * c);
    if (needsGrad) this.grad = new Float32Array(r * c);
  }
  get(i: number, j: number) {
    return this.data[i * this.c + j];
  }
}

export class Graph {
  private tape: (() => void)[] = [];
  /** Without gradients (inference) nothing is recorded. */
  constructor(readonly training: boolean) {}

  private out(r: number, c: number, ...inputs: Mat[]): Mat {
    return new Mat(r, c, undefined, this.training && inputs.some((m) => m.grad));
  }

  private record(o: Mat, fn: () => void) {
    if (this.training && o.grad) this.tape.push(fn);
  }

  backward(loss: Mat) {
    loss.grad!.fill(1);
    for (let i = this.tape.length - 1; i >= 0; i--) this.tape[i]();
    this.tape = [];
  }

  /** Rows of `table` picked by id. */
  embed(table: Mat, ids: number[]): Mat {
    const d = table.c;
    const o = this.out(ids.length, d, table);
    ids.forEach((id, i) => o.data.set(table.data.subarray(id * d, id * d + d), i * d));
    this.record(o, () => {
      if (!table.grad) return;
      ids.forEach((id, i) => {
        for (let k = 0; k < d; k++) table.grad![id * d + k] += o.grad![i * d + k];
      });
    });
    return o;
  }

  add(a: Mat, b: Mat): Mat {
    const o = this.out(a.r, a.c, a, b);
    for (let i = 0; i < o.data.length; i++) o.data[i] = a.data[i] + b.data[i];
    this.record(o, () => {
      for (const m of [a, b]) if (m.grad) for (let i = 0; i < o.data.length; i++) m.grad[i] += o.grad![i];
    });
    return o;
  }

  /** a + row vector b, broadcast down the rows. */
  addRow(a: Mat, b: Mat): Mat {
    const o = this.out(a.r, a.c, a, b);
    for (let i = 0; i < a.r; i++) for (let j = 0; j < a.c; j++) o.data[i * a.c + j] = a.data[i * a.c + j] + b.data[j];
    this.record(o, () => {
      if (a.grad) for (let i = 0; i < o.data.length; i++) a.grad[i] += o.grad![i];
      if (b.grad) for (let i = 0; i < a.r; i++) for (let j = 0; j < a.c; j++) b.grad[j] += o.grad![i * a.c + j];
    });
    return o;
  }

  scale(a: Mat, s: number): Mat {
    const o = this.out(a.r, a.c, a);
    for (let i = 0; i < o.data.length; i++) o.data[i] = a.data[i] * s;
    this.record(o, () => {
      if (a.grad) for (let i = 0; i < o.data.length; i++) a.grad[i] += o.grad![i] * s;
    });
    return o;
  }

  /** a · b. */
  matmul(a: Mat, b: Mat): Mat {
    const n = a.r, k = a.c, m = b.c;
    const o = this.out(n, m, a, b);
    const A = a.data, B = b.data, O = o.data;
    for (let i = 0; i < n; i++)
      for (let p = 0; p < k; p++) {
        const v = A[i * k + p];
        if (!v) continue;
        for (let j = 0; j < m; j++) O[i * m + j] += v * B[p * m + j];
      }
    this.record(o, () => {
      const G = o.grad!;
      if (a.grad)
        for (let i = 0; i < n; i++)
          for (let p = 0; p < k; p++) {
            let s = 0;
            for (let j = 0; j < m; j++) s += G[i * m + j] * B[p * m + j];
            a.grad[i * k + p] += s;
          }
      if (b.grad)
        for (let i = 0; i < n; i++)
          for (let p = 0; p < k; p++) {
            const v = A[i * k + p];
            if (!v) continue;
            for (let j = 0; j < m; j++) b.grad[p * m + j] += v * G[i * m + j];
          }
    });
    return o;
  }

  /** a · bᵀ: every row of a against every row of b (attention scores). */
  matmulT(a: Mat, b: Mat): Mat {
    const n = a.r, k = a.c, m = b.r;
    const o = this.out(n, m, a, b);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let p = 0; p < k; p++) s += a.data[i * k + p] * b.data[j * k + p];
        o.data[i * m + j] = s;
      }
    this.record(o, () => {
      const G = o.grad!;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++) {
          const g = G[i * m + j];
          if (!g) continue;
          for (let p = 0; p < k; p++) {
            if (a.grad) a.grad[i * k + p] += g * b.data[j * k + p];
            if (b.grad) b.grad[j * k + p] += g * a.data[i * k + p];
          }
        }
    });
    return o;
  }

  /** Softmax of every row; masked cells (mask(i, j) true) get probability 0. */
  softmaxRows(a: Mat, mask?: (i: number, j: number) => boolean): Mat {
    const o = this.out(a.r, a.c, a);
    for (let i = 0; i < a.r; i++) {
      let mx = -Infinity;
      for (let j = 0; j < a.c; j++) if (!mask?.(i, j)) mx = Math.max(mx, a.data[i * a.c + j]);
      let s = 0;
      for (let j = 0; j < a.c; j++) {
        const e = mask?.(i, j) ? 0 : Math.exp(a.data[i * a.c + j] - mx);
        o.data[i * a.c + j] = e;
        s += e;
      }
      for (let j = 0; j < a.c; j++) o.data[i * a.c + j] /= s;
    }
    this.record(o, () => {
      if (!a.grad) return;
      for (let i = 0; i < a.r; i++) {
        let dot = 0;
        for (let j = 0; j < a.c; j++) dot += o.grad![i * a.c + j] * o.data[i * a.c + j];
        for (let j = 0; j < a.c; j++) a.grad[i * a.c + j] += o.data[i * a.c + j] * (o.grad![i * a.c + j] - dot);
      }
    });
    return o;
  }

  relu(a: Mat): Mat {
    const o = this.out(a.r, a.c, a);
    for (let i = 0; i < o.data.length; i++) o.data[i] = a.data[i] > 0 ? a.data[i] : 0;
    this.record(o, () => {
      if (a.grad) for (let i = 0; i < o.data.length; i++) if (a.data[i] > 0) a.grad[i] += o.grad![i];
    });
    return o;
  }

  /** Normalise every row to mean 0 and variance 1, then scale by gamma and shift by beta. */
  layerNorm(a: Mat, gamma: Mat, beta: Mat, eps = 1e-5): Mat {
    const n = a.r, c = a.c;
    const o = this.out(n, c, a, gamma, beta);
    const xhat = new Float32Array(n * c);
    const inv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let mu = 0;
      for (let j = 0; j < c; j++) mu += a.data[i * c + j];
      mu /= c;
      let v = 0;
      for (let j = 0; j < c; j++) v += (a.data[i * c + j] - mu) ** 2;
      inv[i] = 1 / Math.sqrt(v / c + eps);
      for (let j = 0; j < c; j++) {
        const x = (a.data[i * c + j] - mu) * inv[i];
        xhat[i * c + j] = x;
        o.data[i * c + j] = x * gamma.data[j] + beta.data[j];
      }
    }
    this.record(o, () => {
      const G = o.grad!;
      for (let i = 0; i < n; i++) {
        let sg = 0, sgx = 0;
        for (let j = 0; j < c; j++) {
          const g = G[i * c + j];
          if (gamma.grad) gamma.grad[j] += g * xhat[i * c + j];
          if (beta.grad) beta.grad[j] += g;
          const gx = g * gamma.data[j];
          sg += gx;
          sgx += gx * xhat[i * c + j];
        }
        if (a.grad)
          for (let j = 0; j < c; j++) {
            const gx = G[i * c + j] * gamma.data[j];
            a.grad[i * c + j] += (inv[i] / c) * (c * gx - sg - xhat[i * c + j] * sgx);
          }
      }
    });
    return o;
  }

  /** Columns [start, start + len). */
  cols(a: Mat, start: number, len: number): Mat {
    const o = this.out(a.r, len, a);
    for (let i = 0; i < a.r; i++) for (let j = 0; j < len; j++) o.data[i * len + j] = a.data[i * a.c + start + j];
    this.record(o, () => {
      if (a.grad) for (let i = 0; i < a.r; i++) for (let j = 0; j < len; j++) a.grad[i * a.c + start + j] += o.grad![i * len + j];
    });
    return o;
  }

  concatCols(parts: Mat[]): Mat {
    const c = parts.reduce((s, p) => s + p.c, 0);
    const o = this.out(parts[0].r, c, ...parts);
    let off = 0;
    const offs = parts.map((p) => {
      for (let i = 0; i < p.r; i++) for (let j = 0; j < p.c; j++) o.data[i * c + off + j] = p.data[i * p.c + j];
      off += p.c;
      return off - p.c;
    });
    this.record(o, () => {
      parts.forEach((p, k) => {
        if (p.grad) for (let i = 0; i < p.r; i++) for (let j = 0; j < p.c; j++) p.grad[i * p.c + j] += o.grad![i * c + offs[k] + j];
      });
    });
    return o;
  }

  /** Mean cross-entropy of every row of logits against its target id. */
  crossEntropy(logits: Mat, targets: number[]): Mat {
    const n = logits.r, V = logits.c;
    const probs = new Float32Array(n * V);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      let mx = -Infinity;
      for (let j = 0; j < V; j++) mx = Math.max(mx, logits.data[i * V + j]);
      let s = 0;
      for (let j = 0; j < V; j++) s += probs[i * V + j] = Math.exp(logits.data[i * V + j] - mx);
      for (let j = 0; j < V; j++) probs[i * V + j] /= s;
      loss -= Math.log(Math.max(probs[i * V + targets[i]], 1e-12));
    }
    const o = this.out(1, 1, logits);
    o.data[0] = loss / n;
    this.record(o, () => {
      if (!logits.grad) return;
      const g = o.grad![0] / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < V; j++) logits.grad[i * V + j] += g * (probs[i * V + j] - (j === targets[i] ? 1 : 0));
    });
    return o;
  }
}
