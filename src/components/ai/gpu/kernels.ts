/* WGSL compute shaders for the demos' GPU engine. Every kernel reads its
 * sizes from a uniform block of 16 floats (`u(i)`), binds its buffers from
 * binding 1 on, and runs one thread per output element unless noted.
 * Large thread counts spill into the y dimension of the dispatch, so the
 * flat index is gid.x + gid.y · (64 · groups in x). */

const HEADER = /* wgsl */ `
struct Params { v: array<vec4<f32>, 4> }
@group(0) @binding(0) var<uniform> P: Params;
fn u(i: u32) -> f32 { return P.v[i / 4u][i % 4u]; }
fn n(i: u32) -> u32 { return u32(u(i) + 0.5); }
`;

/** A 1-D kernel: `body` sees `i` (the flat thread index) and returns early past `count`. */
function flat(bindings: string, count: string, body: string): string {
  return `${HEADER}
${bindings}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = gid.x + gid.y * nw.x * 64u;
  if (i >= ${count}) { return; }
${body}
}`;
}

const R = (b: number, name: string) => `@group(0) @binding(${b}) var<storage, read> ${name}: array<f32>;`;
const W = (b: number, name: string) => `@group(0) @binding(${b}) var<storage, read_write> ${name}: array<f32>;`;

export const KERNELS = {
  /** x = 0. u: n */
  zero: flat(W(1, 'x'), 'n(0u)', `  x[i] = 0.0;`),

  /** dst += a · src. u: n, a */
  axpy: flat(`${R(1, 'src')}\n${W(2, 'dst')}`, 'n(0u)', `  dst[i] = dst[i] + u(1u) * src[i];`),

  /** y = a · x. u: n, a */
  scale: flat(`${R(1, 'x')}\n${W(2, 'y')}`, 'n(0u)', `  y[i] = u(1u) * x[i];`),

  /** y = a + b. u: n */
  add: flat(`${R(1, 'a')}\n${R(2, 'b')}\n${W(3, 'y')}`, 'n(0u)', `  y[i] = a[i] + b[i];`),

  /** y = x + row vector b. u: n, cols */
  addRow: flat(`${R(1, 'x')}\n${R(2, 'b')}\n${W(3, 'y')}`, 'n(0u)', `  y[i] = x[i] + b[i % n(1u)];`),

  /** db[j] += Σ_rows dy[r, j]: one thread per column. u: cols, rows */
  colSum: flat(
    `${R(1, 'dy')}\n${W(2, 'db')}`,
    'n(0u)',
    `  var s = 0.0;
  let cols = n(0u);
  for (var r = 0u; r < n(1u); r++) { s += dy[r * cols + i]; }
  db[i] = db[i] + s;`,
  ),

  /** y = max(0, x). u: n */
  relu: flat(`${R(1, 'x')}\n${W(2, 'y')}`, 'n(0u)', `  y[i] = max(0.0, x[i]);`),

  /** dx += dy where x > 0. u: n */
  reluBack: flat(`${R(1, 'x')}\n${R(2, 'dy')}\n${W(3, 'dx')}`, 'n(0u)', `  if (x[i] > 0.0) { dx[i] = dx[i] + dy[i]; }`),

  /** y[r, k] = x[r, k] + pe[(r mod T), k]. u: n, d, T */
  addPe: flat(
    `${R(1, 'x')}\n${R(2, 'pe')}\n${W(3, 'y')}`,
    'n(0u)',
    `  let d = n(1u);
  let r = i / d;
  y[i] = x[i] + pe[(r % n(2u)) * d + i % d];`,
  ),

  /** y[t, k] = table[ids[t], k]. u: n (= tokens · d), d */
  embed: flat(
    `${R(1, 'table')}\n${R(2, 'ids')}\n${W(3, 'y')}`,
    'n(0u)',
    `  let d = n(1u);
  y[i] = table[u32(ids[i / d]) * d + i % d];`,
  ),

  /** dtable[v, k] += Σ_t [ids[t] = v] dy[t, k]: one thread per table cell. u: V·d, d, tokens */
  embedBack: flat(
    `${R(1, 'dy')}\n${R(2, 'ids')}\n${W(3, 'dt')}`,
    'n(0u)',
    `  let d = n(1u);
  let v = f32(i / d);
  let k = i % d;
  var s = 0.0;
  for (var t = 0u; t < n(2u); t++) { if (ids[t] == v) { s += dy[t * d + k]; } }
  dt[i] = dt[i] + s;`,
  ),

  /** Layer norm of every row, keeping x̂ and 1/σ for the backward pass. One thread per row. u: rows, cols */
  layerNorm: flat(
    `${R(1, 'x')}\n${R(2, 'gamma')}\n${R(3, 'beta')}\n${W(4, 'y')}\n${W(5, 'xhat')}\n${W(6, 'inv')}`,
    'n(0u)',
    `  let c = n(1u);
  let o = i * c;
  var mu = 0.0;
  for (var j = 0u; j < c; j++) { mu += x[o + j]; }
  mu = mu / f32(c);
  var v = 0.0;
  for (var j = 0u; j < c; j++) { let e = x[o + j] - mu; v += e * e; }
  let s = 1.0 / sqrt(v / f32(c) + 1e-5);
  inv[i] = s;
  for (var j = 0u; j < c; j++) {
    let h = (x[o + j] - mu) * s;
    xhat[o + j] = h;
    y[o + j] = h * gamma[j] + beta[j];
  }`,
  ),

  /** dx += layer-norm backward, one thread per row. u: rows, cols */
  layerNormBack: flat(
    `${R(1, 'dy')}\n${R(2, 'gamma')}\n${R(3, 'xhat')}\n${R(4, 'inv')}\n${W(5, 'dx')}`,
    'n(0u)',
    `  let c = n(1u);
  let o = i * c;
  var sg = 0.0;
  var sgx = 0.0;
  for (var j = 0u; j < c; j++) {
    let gx = dy[o + j] * gamma[j];
    sg += gx;
    sgx += gx * xhat[o + j];
  }
  let k = inv[i] / f32(c);
  for (var j = 0u; j < c; j++) {
    let gx = dy[o + j] * gamma[j];
    dx[o + j] = dx[o + j] + k * (f32(c) * gx - sg - xhat[o + j] * sgx);
  }`,
  ),

  /** dγ, dβ of layer norm: one thread per column. u: cols, rows */
  layerNormParams: flat(
    `${R(1, 'dy')}\n${R(2, 'xhat')}\n${W(3, 'dg')}\n${W(4, 'db')}`,
    'n(0u)',
    `  let c = n(0u);
  var a = 0.0;
  var b = 0.0;
  for (var r = 0u; r < n(1u); r++) {
    a += dy[r * c + i] * xhat[r * c + i];
    b += dy[r * c + i];
  }
  dg[i] = dg[i] + a;
  db[i] = db[i] + b;`,
  ),

  /** Attention scores S[b,h,i,j] = scale · q·k over the head's columns; masked cells get −1e30.
   *  u: n, H, Tq, Tk, d, scale, causal */
  attnScores: flat(
    `${R(1, 'q')}\n${R(2, 'k')}\n${R(3, 'klen')}\n${W(4, 's')}`,
    'n(0u)',
    `  let H = n(1u); let Tq = n(2u); let Tk = n(3u); let d = n(4u);
  let dk = d / H;
  let j = i % Tk;
  let qi = (i / Tk) % Tq;
  let h = (i / (Tk * Tq)) % H;
  let b = i / (Tk * Tq * H);
  if (f32(j) >= klen[b] || (u(6u) > 0.5 && j > qi)) { s[i] = -1e30; return; }
  var acc = 0.0;
  let qo = (b * Tq + qi) * d + h * dk;
  let ko = (b * Tk + j) * d + h * dk;
  for (var c = 0u; c < dk; c++) { acc += q[qo + c] * k[ko + c]; }
  s[i] = acc * u(5u);`,
  ),

  /** Softmax of every row; one thread per row. u: rows, cols */
  softmaxRows: flat(
    `${R(1, 's')}\n${W(2, 'p')}`,
    'n(0u)',
    `  let c = n(1u);
  let o = i * c;
  var mx = -3.4e38;
  for (var j = 0u; j < c; j++) { mx = max(mx, s[o + j]); }
  var sum = 0.0;
  for (var j = 0u; j < c; j++) {
    let e = select(exp(s[o + j] - mx), 0.0, s[o + j] <= -1e29);
    p[o + j] = e;
    sum += e;
  }
  for (var j = 0u; j < c; j++) { p[o + j] = p[o + j] / sum; }`,
  ),

  /** out[b,i,c] = Σ_j P[b,h(c),i,j] · v[b,j,c]. u: n (= B·Tq·d), H, Tq, Tk, d */
  attnOut: flat(
    `${R(1, 'p')}\n${R(2, 'v')}\n${W(3, 'o')}`,
    'n(0u)',
    `  let H = n(1u); let Tq = n(2u); let Tk = n(3u); let d = n(4u);
  let c = i % d;
  let qi = (i / d) % Tq;
  let b = i / (d * Tq);
  let h = c / (d / H);
  let po = ((b * H + h) * Tq + qi) * Tk;
  var acc = 0.0;
  for (var j = 0u; j < Tk; j++) { acc += p[po + j] * v[(b * Tk + j) * d + c]; }
  o[i] = acc;`,
  ),

  /** dP[b,h,i,j] = dout[b,i,head] · v[b,j,head]. u: n, H, Tq, Tk, d */
  attnDP: flat(
    `${R(1, 'dout')}\n${R(2, 'v')}\n${W(3, 'dp')}`,
    'n(0u)',
    `  let H = n(1u); let Tq = n(2u); let Tk = n(3u); let d = n(4u);
  let dk = d / H;
  let j = i % Tk;
  let qi = (i / Tk) % Tq;
  let h = (i / (Tk * Tq)) % H;
  let b = i / (Tk * Tq * H);
  let oo = (b * Tq + qi) * d + h * dk;
  let vo = (b * Tk + j) * d + h * dk;
  var acc = 0.0;
  for (var c = 0u; c < dk; c++) { acc += dout[oo + c] * v[vo + c]; }
  dp[i] = acc;`,
  ),

  /** dS = scale · P ⊙ (dP − Σ_j P·dP), one thread per row. u: rows, cols, scale */
  softmaxBack: flat(
    `${R(1, 'p')}\n${R(2, 'dp')}\n${W(3, 'ds')}`,
    'n(0u)',
    `  let c = n(1u);
  let o = i * c;
  var dot = 0.0;
  for (var j = 0u; j < c; j++) { dot += p[o + j] * dp[o + j]; }
  for (var j = 0u; j < c; j++) { ds[o + j] = u(2u) * p[o + j] * (dp[o + j] - dot); }`,
  ),

  /** dq[b,i,c] += Σ_j dS[b,h,i,j] · k[b,j,c]. u: n (= B·Tq·d), H, Tq, Tk, d */
  attnDQ: flat(
    `${R(1, 'ds')}\n${R(2, 'k')}\n${W(3, 'dq')}`,
    'n(0u)',
    `  let H = n(1u); let Tq = n(2u); let Tk = n(3u); let d = n(4u);
  let c = i % d;
  let qi = (i / d) % Tq;
  let b = i / (d * Tq);
  let h = c / (d / H);
  let so = ((b * H + h) * Tq + qi) * Tk;
  var acc = 0.0;
  for (var j = 0u; j < Tk; j++) { acc += ds[so + j] * k[(b * Tk + j) * d + c]; }
  dq[i] = dq[i] + acc;`,
  ),

  /** dk[b,j,c] += Σ_i dS[b,h,i,j] · q[b,i,c] (also dv with P and dout). u: n (= B·Tk·d), H, Tq, Tk, d */
  attnDK: flat(
    `${R(1, 'ds')}\n${R(2, 'q')}\n${W(3, 'dk')}`,
    'n(0u)',
    `  let H = n(1u); let Tq = n(2u); let Tk = n(3u); let d = n(4u);
  let c = i % d;
  let j = (i / d) % Tk;
  let b = i / (d * Tk);
  let h = c / (d / H);
  var acc = 0.0;
  for (var qi = 0u; qi < Tq; qi++) { acc += ds[((b * H + h) * Tq + qi) * Tk + j] * q[(b * Tq + qi) * d + c]; }
  dk[i] = dk[i] + acc;`,
  ),

  /** im2col for 3-D maps in NHWC: rows (b, oy, ox), columns (c, v, u). u: n, H, W, C, kh, kw, pad, Ho, Wo */
  im2col: flat(
    `${R(1, 'x')}\n${W(2, 'cols')}`,
    'n(0u)',
    `  let H = n(1u); let Wd = n(2u); let C = n(3u); let kh = n(4u); let kw = n(5u);
  let pad = i32(n(6u)); let Ho = n(7u); let Wo = n(8u);
  let K = C * kh * kw;
  let col = i % K;
  let row = i / K;
  let uu = col % kw;
  let vv = (col / kw) % kh;
  let c = col / (kw * kh);
  let ox = row % Wo;
  let oy = (row / Wo) % Ho;
  let b = row / (Wo * Ho);
  let y = i32(oy + vv) - pad;
  let xx = i32(ox + uu) - pad;
  if (y < 0 || xx < 0 || y >= i32(H) || xx >= i32(Wd)) { cols[i] = 0.0; return; }
  cols[i] = x[((b * H + u32(y)) * Wd + u32(xx)) * C + c];`,
  ),

  /** dx += col2im(dcols): one thread per input cell. u: n (= B·H·W·C), H, W, C, kh, kw, pad, Ho, Wo */
  col2im: flat(
    `${R(1, 'dcols')}\n${W(2, 'dx')}`,
    'n(0u)',
    `  let H = n(1u); let Wd = n(2u); let C = n(3u); let kh = n(4u); let kw = n(5u);
  let pad = i32(n(6u)); let Ho = i32(n(7u)); let Wo = i32(n(8u));
  let K = C * kh * kw;
  let c = i % C;
  let x = i32((i / C) % Wd);
  let y = i32((i / (C * Wd)) % H);
  let b = i / (C * Wd * H);
  var acc = 0.0;
  for (var vv = 0u; vv < kh; vv++) {
    let oy = y + pad - i32(vv);
    if (oy < 0 || oy >= Ho) { continue; }
    for (var uu = 0u; uu < kw; uu++) {
      let ox = x + pad - i32(uu);
      if (ox < 0 || ox >= Wo) { continue; }
      let row = (b * u32(Ho) + u32(oy)) * u32(Wo) + u32(ox);
      acc += dcols[row * K + (c * kh + vv) * kw + uu];
    }
  }
  dx[i] = dx[i] + acc;`,
  ),

  /** Max-pool NHWC with a ph×pw window; arg keeps the flat index of the winner. u: n (outputs), H, W, C, ph, pw */
  maxPool: flat(
    `${R(1, 'x')}\n${W(2, 'y')}\n${W(3, 'arg')}`,
    'n(0u)',
    `  let H = n(1u); let Wd = n(2u); let C = n(3u); let ph = n(4u); let pw = n(5u);
  let Ho = H / ph; let Wo = Wd / pw;
  let c = i % C;
  let ox = (i / C) % Wo;
  let oy = (i / (C * Wo)) % Ho;
  let b = i / (C * Wo * Ho);
  var best = -3.4e38;
  var bi = 0u;
  for (var vv = 0u; vv < ph; vv++) {
    for (var uu = 0u; uu < pw; uu++) {
      let idx = ((b * H + oy * ph + vv) * Wd + ox * pw + uu) * C + c;
      if (x[idx] > best) { best = x[idx]; bi = idx; }
    }
  }
  y[i] = best;
  arg[i] = f32(bi);`,
  ),

  /** dx[arg[i]] += dy[i] (windows do not overlap, so no two threads collide). u: n */
  maxPoolBack: flat(`${R(1, 'dy')}\n${R(2, 'arg')}\n${W(3, 'dx')}`, 'n(0u)', `  let a = u32(arg[i]); dx[a] = dx[a] + dy[i];`),

  /** Softmax cross-entropy per row; rows with target < 0 are ignored. Writes dlogits and each row's weighted loss.
   *  u: rows, V */
  softmaxCE: flat(
    `${R(1, 'logits')}\n${R(2, 'tgt')}\n${R(3, 'rowScale')}\n${W(4, 'dlogits')}\n${W(5, 'loss')}`,
    'n(0u)',
    `  let V = n(1u);
  let o = i * V;
  let t = tgt[i];
  if (t < 0.0) {
    for (var j = 0u; j < V; j++) { dlogits[o + j] = 0.0; }
    loss[i] = 0.0;
    return;
  }
  var mx = -3.4e38;
  for (var j = 0u; j < V; j++) { mx = max(mx, logits[o + j]); }
  var sum = 0.0;
  for (var j = 0u; j < V; j++) { sum += exp(logits[o + j] - mx); }
  let w = rowScale[i];
  let ti = u32(t);
  for (var j = 0u; j < V; j++) {
    let p = exp(logits[o + j] - mx) / sum;
    dlogits[o + j] = w * (p - select(0.0, 1.0, j == ti));
  }
  loss[i] = -w * (logits[o + ti] - mx - log(sum));`,
  ),

  /** The perceptron's "loss": on a mistake the gradient is −(t − y) (detector) or +1 for the wrong winner
   *  and −1 for the right unit (classifier). Also counts mistakes. u: rows, U */
  perceptronLoss: flat(
    `${R(1, 's')}\n${R(2, 'tgt')}\n${W(3, 'ds')}\n${W(4, 'wrong')}`,
    'n(0u)',
    `  let U = n(1u);
  let o = i * U;
  for (var j = 0u; j < U; j++) { ds[o + j] = 0.0; }
  let t = u32(tgt[i]);
  if (U == 1u) {
    let y = select(0u, 1u, s[o] >= 0.0);
    ds[o] = -(f32(t) - f32(y));
    wrong[i] = select(0.0, 1.0, y != t);
    return;
  }
  var w = 0u;
  for (var j = 1u; j < U; j++) { if (s[o + j] > s[o + w]) { w = j; } }
  if (w != t) {
    ds[o + t] = -1.0;
    ds[o + w] = 1.0;
    wrong[i] = 1.0;
  } else {
    wrong[i] = 0.0;
  }`,
  ),

  /** Scanner scores: S[b,pos,unit] = Σ window x · w, for every template position. u: n, Hs, Ws, wh, ww, Ho, Wo, U */
  scanScores: flat(
    `${R(1, 'x')}\n${R(2, 'w')}\n${W(3, 's')}`,
    'n(0u)',
    `  let Hs = n(1u); let Ws = n(2u); let wh = n(3u); let ww = n(4u); let Ho = n(5u); let Wo = n(6u); let U = n(7u);
  let unit = i % U;
  let pos = (i / U) % (Ho * Wo);
  let b = i / (U * Ho * Wo);
  let oy = pos / Wo; let ox = pos % Wo;
  var acc = 0.0;
  for (var v = 0u; v < wh; v++) {
    let row = (b * Hs + oy + v) * Ws + ox;
    for (var q = 0u; q < ww; q++) {
      let px = x[row + q];
      if (px != 0.0) { acc += px * w[(v * ww + q) * U + unit]; }
    }
  }
  s[i] = acc;`,
  ),

  /** Ink (lit cells) under the template at every position, the scanner's tie-break. u: n (= B·Ho·Wo), Hs, Ws, wh, ww, Ho, Wo */
  scanInk: flat(
    `${R(1, 'x')}\n${W(2, 'ink')}`,
    'n(0u)',
    `  let Hs = n(1u); let Ws = n(2u); let wh = n(3u); let ww = n(4u); let Ho = n(5u); let Wo = n(6u);
  let pos = i % (Ho * Wo);
  let b = i / (Ho * Wo);
  let oy = pos / Wo; let ox = pos % Wo;
  var acc = 0.0;
  for (var v = 0u; v < wh; v++) { for (var q = 0u; q < ww; q++) { acc += x[(b * Hs + oy + v) * Ws + ox + q]; } }
  ink[i] = acc;`,
  ),

  /** Best position per (example, unit): highest score, ties to more ink, then the first. u: n (= B·U), P (positions), U */
  scanMax: flat(
    `${R(1, 's')}\n${R(2, 'ink')}\n${W(3, 'best')}\n${W(4, 'arg')}`,
    'n(0u)',
    `  let Pn = n(1u); let U = n(2u);
  let unit = i % U;
  let b = i / U;
  var bs = s[(b * Pn) * U + unit];
  var bp = 0u;
  for (var p = 1u; p < Pn; p++) {
    let v = s[(b * Pn + p) * U + unit];
    if (v > bs || (v == bs && ink[b * Pn + p] > ink[b * Pn + bp])) { bs = v; bp = p; }
  }
  best[i] = bs;
  arg[i] = f32(bp);`,
  ),

  /** dw[k, unit] += Σ_b dbest[b,unit] · x[b, window k at arg[b,unit]]. u: n (= wh·ww·U), Hs, Ws, ww, Wo, U, B */
  scanBack: flat(
    `${R(1, 'dbest')}\n${R(2, 'arg')}\n${R(3, 'x')}\n${W(4, 'dw')}`,
    'n(0u)',
    `  let Hs = n(1u); let Ws = n(2u); let ww = n(3u); let Wo = n(4u); let U = n(5u); let B = n(6u);
  let unit = i % U;
  let k = i / U;
  let v = k / ww; let q = k % ww;
  var acc = 0.0;
  for (var b = 0u; b < B; b++) {
    let g = dbest[b * U + unit];
    if (g == 0.0) { continue; }
    let p = u32(arg[b * U + unit]);
    let oy = p / Wo; let ox = p % Wo;
    acc += g * x[(b * Hs + oy + v) * Ws + ox + q];
  }
  dw[i] = dw[i] + acc;`,
  ),

  /** Plain gradient step: p −= lr · gscale · g, optionally clamped to ±limit. u: n, lr, gscale, limit */
  sgd: flat(
    `${R(1, 'g')}\n${W(2, 'p')}`,
    'n(0u)',
    `  var v = p[i] - u(1u) * u(2u) * g[i];
  if (u(3u) > 0.0) { v = clamp(v, -u(3u), u(3u)); }
  p[i] = v;`,
  ),

  /** Adam with per-component gradient clipping. u: n, lr, b1, b2, eps, c1, c2, clip, gscale */
  adam: flat(
    `${R(1, 'g')}\n${W(2, 'p')}\n${W(3, 'm')}\n${W(4, 'v')}`,
    'n(0u)',
    `  let gr = clamp(g[i] * u(8u), -u(7u), u(7u));
  let mm = u(2u) * m[i] + (1.0 - u(2u)) * gr;
  let vv = u(3u) * v[i] + (1.0 - u(3u)) * gr * gr;
  m[i] = mm;
  v[i] = vv;
  p[i] = p[i] - u(1u) * (mm / u(5u)) / (sqrt(vv / u(6u)) + u(4u));`,
  ),

  /** acc[0] += k · Σ x (one thread; for small per-row loss and mistake vectors). u: n, k */
  sumInto: flat(
    `${R(1, 'x')}\n${W(2, 'acc')}`,
    '1u',
    `  var s = 0.0;
  for (var j = 0u; j < n(0u); j++) { s += x[j]; }
  acc[0] = acc[0] + u(1u) * s;`,
  ),
};

export type KernelName = keyof typeof KERNELS;

/** Tiled matrix product C (+)= α · op(A) · op(B), 16×16 tiles. u: M, N, K, transA, transB, accumulate, alpha */
export const MATMUL = /* wgsl */ `${HEADER}
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read_write> C: array<f32>;
var<workgroup> As: array<array<f32, 16>, 16>;
var<workgroup> Bs: array<array<f32, 16>, 16>;
fn getA(r: u32, k: u32, M: u32, K: u32) -> f32 {
  if (r >= M || k >= K) { return 0.0; }
  if (u(3u) > 0.5) { return A[k * M + r]; }
  return A[r * K + k];
}
fn getB(k: u32, c: u32, K: u32, N: u32) -> f32 {
  if (k >= K || c >= N) { return 0.0; }
  if (u(4u) > 0.5) { return B[c * K + k]; }
  return B[k * N + c];
}
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let M = n(0u); let N = n(1u); let K = n(2u);
  let row = wg.y * 16u + l.y;
  let col = wg.x * 16u + l.x;
  var acc = 0.0;
  let tiles = (K + 15u) / 16u;
  for (var t = 0u; t < tiles; t++) {
    As[l.y][l.x] = getA(row, t * 16u + l.x, M, K);
    Bs[l.y][l.x] = getB(t * 16u + l.y, col, K, N);
    workgroupBarrier();
    for (var k = 0u; k < 16u; k++) { acc += As[l.y][k] * Bs[k][l.x]; }
    workgroupBarrier();
  }
  if (row < M && col < N) {
    let o = row * N + col;
    if (u(5u) > 0.5) { C[o] = C[o] + u(6u) * acc; } else { C[o] = u(6u) * acc; }
  }
}`;
