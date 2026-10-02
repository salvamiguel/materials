/* Checks the GPU engine against the CPU code it mirrors: the same model, the
 * same batch, one training step on each, and the results compared. Run it in
 * a browser with WebGPU, e.g. from the console of any demo page:
 *   (await import('/path/to/selftest.js')).runSelfTest()
 * or bundle it (bun build src/components/ai/gpu/selftest.ts --target browser)
 * into a page. Software GPUs (SwiftShader) are fine: it checks numbers, not speed. */

import { Tape, getGpu, gpuUnavailableReason, param, size, type Gpu } from './engine';
import { DIGITS, LETTERS, makeClassDataset, makeDataset, newMachine, learnBatch, rng, type Mode } from '../perceptron/model';
import { PerceptronGpu } from '../perceptron/gpu';
import { newNet, trainBatch as cnnTrainBatch, evaluate as cnnEvaluate, type ArchId } from '../cnn/model';
import { CnnGpu } from '../cnn/gpu';
import { GPT_CONFIG, DEFAULT_CONFIG, newModel, accumulate, withD, lmEvaluate, type Config } from '../transformer/model';
import { makePairs, makeSentences } from '../transformer/grammar';
import { TransformerGpu } from '../transformer/gpu';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function compare(name: string, a: ArrayLike<number>, b: ArrayLike<number>, tol: number, allowFlips = 0): Check {
  let worst = 0, flips = 0;
  if (a.length !== b.length) return { name, ok: false, detail: `tamaños ${a.length} ≠ ${b.length}` };
  for (let i = 0; i < a.length; i++) {
    const err = Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(a[i]));
    if (err > tol) flips++;
    worst = Math.max(worst, err);
  }
  return { name, ok: flips <= allowFlips, detail: `error máx ${worst.toExponential(2)}, fuera de tolerancia ${flips}/${a.length}` };
}

const flat = (xs: ArrayLike<number>[]) => Float32Array.from(xs.flatMap((x) => Array.from(x)));

async function matmulChecks(g: Gpu): Promise<Check[]> {
  const r = rng(5);
  const rand = (n: number) => Float32Array.from({ length: n }, () => r() * 2 - 1);
  const out: Check[] = [];
  const M = 19, K = 23, N = 17;
  for (const [ta, tb] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const A = rand(M * K), B = rand(K * N), G = rand(M * N);
    const a = (i: number, k: number) => (ta ? A[k * M + i] : A[i * K + k]);
    const b = (k: number, j: number) => (tb ? B[j * K + k] : B[k * N + j]);
    const C = new Float32Array(M * N), dA = new Float32Array(M * K), dB = new Float32Array(K * N);
    for (let i = 0; i < M; i++)
      for (let j = 0; j < N; j++) {
        let s = 0;
        for (let k = 0; k < K; k++) {
          s += a(i, k) * b(k, j);
          const gg = G[i * N + j];
          dA[ta ? k * M + i : i * K + k] += gg * b(k, j);
          dB[tb ? j * K + k : k * N + j] += gg * a(i, k);
        }
        C[i * N + j] = s;
      }
    const pa = param(g, ta ? K : M, ta ? M : K, A), pb = param(g, tb ? N : K, tb ? K : N, B);
    const t = new Tape(g, true);
    const c = t.matmul(pa, pb, ta, tb);
    // writeBuffer runs at once; the zeroing of c.grad is still queued in the pass: submit it first.
    g.submit();
    g.write(c.grad!, G);
    t.backward();
    const [gc, ga, gb] = await g.read([c.buf, M * N], [pa.grad, M * K], [pb.grad, K * N]);
    const tag = `${ta ? 'Aᵀ' : 'A'}·${tb ? 'Bᵀ' : 'B'}`;
    out.push(compare(`matmul ${tag}`, C, gc, 1e-4), compare(`matmul ${tag} ∂A`, dA, ga, 1e-4), compare(`matmul ${tag} ∂B`, dB, gb, 1e-4));
  }
  return out;
}

async function perceptronChecks(g: Gpu): Promise<Check[]> {
  const out: Check[] = [];
  const cases: [Mode, boolean, number][] = [
    ['mark1', false, 1],
    ['normalized', true, 2],
    ['scanner', false, 1],
    ['scanner', true, 2],
  ];
  for (const [mode, cls, scale] of cases) {
    const data = cls ? makeClassDataset(DIGITS, 24, 3) : makeDataset('3', 24, 3);
    const classes = cls ? DIGITS : ['3'];
    const cpu = newMachine(mode, classes, scale);
    const gpuM = newMachine(mode, classes, scale);
    const pg = new PerceptronGpu(g, gpuM);
    for (let s = 0; s < 3; s++) {
      const batch = data.slice(s * 8, s * 8 + 8);
      learnBatch(cpu, batch, 0.1);
      pg.step(batch, 0.1);
    }
    await pg.pull(gpuM);
    const name = `perceptrón ${mode} ${cls ? 'clasificador' : 'detector'} ×${scale}`;
    out.push(compare(`${name}: pesos`, flat(cpu.weights), flat(gpuM.weights), 1e-4, 2), compare(`${name}: umbrales`, cpu.thetas, gpuM.thetas, 1e-4));
    pg.dispose();
  }
  return out;
}

async function cnnChecks(g: Gpu): Promise<Check[]> {
  const out: Check[] = [];
  const data = makeClassDataset(LETTERS.slice(0, 5), 32, 4);
  for (const [arch, width] of [['shallow', 1], ['lenet', 1], ['lenet', 4]] as [ArchId, number][]) {
    const cpu = newNet(arch, LETTERS.slice(0, 5), 7, width);
    const mirror = newNet(arch, LETTERS.slice(0, 5), 7, width);
    const cg = new CnnGpu(g, mirror);
    for (let s = 0; s < 2; s++) {
      const batch = data.slice(s * 16, s * 16 + 16);
      cnnTrainBatch(cpu, batch, 0.05);
      cg.step(batch, 0.05);
    }
    await cg.pull(mirror);
    const name = `CNN ${arch} ×${width}`;
    const cpuW = flat([...cpu.layers.flatMap((L) => [L.w, L.b]), cpu.dense, cpu.dbias]);
    const gpuW = flat([...mirror.layers.flatMap((L) => [L.w, L.b]), mirror.dense, mirror.dbias]);
    out.push(compare(`${name}: pesos tras 2 pasos`, cpuW, gpuW, 1e-3));
    const ec = cnnEvaluate(cpu, data), eg = await cg.evaluate(data);
    out.push(compare(`${name}: evaluación`, [ec.accuracy, ec.loss], [eg.accuracy, eg.loss], 1e-3));
    cg.dispose();
  }
  return out;
}

async function transformerChecks(g: Gpu): Promise<Check[]> {
  const out: Check[] = [];
  const sentences = makeSentences(16, 1, 'train');
  const pairs = makePairs(16, 1, 'train');
  const cfgs: [string, Config][] = [
    ['GPT d=32', GPT_CONFIG],
    ['GPT d=128 4 cabezas', { ...withD(GPT_CONFIG, 128), heads: 4 }],
    ['traductor d=32', DEFAULT_CONFIG],
    ['traductor 2 capas sin posiciones', { ...DEFAULT_CONFIG, layers: 2, posEnc: false }],
  ];
  for (const [name, cfg] of cfgs) {
    const m = newModel(cfg, 3);
    const batch = cfg.kind === 'gpt' ? sentences.slice(0, 8) : pairs.slice(0, 8);
    for (const it of batch) accumulate(m, it);
    const cpuGrads = m.params.map((p) => p.grad!.map((v) => v / batch.length));
    m.params.forEach((p) => p.grad!.fill(0));
    const tg = new TransformerGpu(g, m);
    const gpuGrads = await tg.gradients(batch);
    out.push(compare(`Transformer ${name}: gradientes`, flat(cpuGrads), flat(gpuGrads), 2e-3, 3));
    if (cfg.kind === 'gpt') {
      const held = makeSentences(10, 2, 'test');
      const ec = lmEvaluate(m, held, 0);
      const eg = await tg.lmEvaluate(held, 0, rng(1));
      out.push(compare(`Transformer ${name}: siguiente palabra`, [ec.next], [eg.next], 0.05));
    } else {
      out.push({ name: `Transformer ${name}: traducción por lotes`, ok: (await tg.translateExact(pairs.slice(0, 4))) >= 0, detail: 'se ejecuta' });
    }
    tg.dispose();
  }
  return out;
}

export async function runSelfTest(): Promise<Check[]> {
  const g = await getGpu();
  if (!g) return [{ name: 'WebGPU', ok: false, detail: gpuUnavailableReason() }];
  const checks: Check[] = [{ name: 'WebGPU', ok: true, detail: g.name }];
  const broken = await g.check();
  checks.push({ name: 'compilar los kernels', ok: !broken.length, detail: broken.join(' | ') || 'todos compilan' });
  for (const run of [matmulChecks, perceptronChecks, cnnChecks, transformerChecks]) {
    try {
      checks.push(...(await run(g)));
    } catch (e) {
      checks.push({ name: run.name, ok: false, detail: `excepción: ${(e as Error).stack ?? e}` });
    }
  }
  void size;
  return checks;
}
