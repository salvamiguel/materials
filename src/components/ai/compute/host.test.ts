import { describe, expect, test } from 'bun:test';

import { DIGITS, makeClassDataset, makeDataset, newMachine } from '../perceptron/model';
import { newNet } from '../cnn/model';
import { GPT_CONFIG, newModel } from '../transformer/model';
import { makeSentences } from '../transformer/grammar';
import { Host, type FromHost } from './host';
import { makeTrainer } from './trainers';

/** A host whose messages are collected, and a way to wait for the next one of a kind. */
function harness() {
  const got: FromHost[] = [];
  const waiters: [(m: FromHost) => boolean, (m: FromHost) => void][] = [];
  const host = new Host((m) => {
    got.push(m);
    for (const w of [...waiters]) if (w[0](m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w[1](m);
    }
  }, makeTrainer);
  const next = (pred: (m: FromHost) => boolean) => new Promise<FromHost>((r) => waiters.push([pred, r]));
  return { host, got, next };
}

describe('the training host', () => {
  test('perceptron: a step reports, ×100 trains until it converges and sends the weights', async () => {
    const { host, next } = harness();
    const machine = newMachine('centered', ['0']);
    host.handle({ t: 'init', demo: 'perceptron', state: { machine, data: { train: makeDataset('0', 60, 1, { variants: false }), test: makeDataset('0', 30, 2, { variants: false }) }, eta: 0.1 } });
    host.handle({ t: 'step' });
    const first = (await next((m) => m.t === 'tick')) as Extract<FromHost, { t: 'tick' }>;
    expect((first.report as { text: string }).text.length).toBeGreaterThan(10);
    expect((first.stats as { seen: number }).seen).toBe(1);
    host.handle({ t: 'speed', speed: 100 });
    const end = (await next((m) => m.t === 'tick' && !m.running)) as Extract<FromHost, { t: 'tick' }>;
    const stats = end.stats as { done: string; points: unknown[] } | undefined;
    const done = stats ?? ((await next((m) => m.t === 'tick' && !!m.stats)) as Extract<FromHost, { t: 'tick' }>).stats;
    expect((done as { done: string }).done).toBe('converged');
  });

  test('batches: the perceptron learns with batches of 32 too', async () => {
    const { host, next, got } = harness();
    host.handle({ t: 'init', demo: 'perceptron', state: { machine: newMachine('normalized', DIGITS), data: { train: makeClassDataset(DIGITS, 200, 1), test: makeClassDataset(DIGITS, 100, 2) }, eta: 0.1 } });
    host.handle({ t: 'compute', compute: { backend: 'cpu', batch: 32 } });
    await next((m) => m.t === 'compute');
    host.handle({ t: 'speed', speed: 100 });
    await new Promise((r) => setTimeout(r, 1500));
    host.handle({ t: 'speed', speed: 0 });
    await next((m) => m.t === 'tick' && !m.running);
    const ticks = got.filter((m): m is Extract<FromHost, { t: 'tick' }> => m.t === 'tick' && !!m.stats);
    const pts = (ticks[ticks.length - 1].stats as { points: { train: number }[] }).points;
    expect(pts[pts.length - 1].train).toBeGreaterThan(0.6);
    expect(ticks.some((t) => t.snapshot)).toBe(true);
  });

  test('without a GPU, asking for one falls back to the CPU with a reason', async () => {
    const { host, next } = harness();
    host.handle({ t: 'init', demo: 'cnn', state: { net: newNet('lenet', DIGITS, 1), data: { train: makeClassDataset(DIGITS, 40, 1), test: makeClassDataset(DIGITS, 20, 2) }, opts: { lr: 0.02, augment: false, freezeFirst: false } } });
    host.handle({ t: 'compute', compute: { backend: 'gpu', batch: 8 } });
    const c = (await next((m) => m.t === 'compute')) as Extract<FromHost, { t: 'compute' }>;
    expect(c.backend).toBe('cpu');
    expect(c.error).toContain('WebGPU');
  });

  test('CNN and GPT train in steps and the benchmark measures the CPU', async () => {
    const { host, next, got } = harness();
    host.handle({ t: 'init', demo: 'cnn', state: { net: newNet('shallow', DIGITS, 1), data: { train: makeClassDataset(DIGITS, 40, 1), test: makeClassDataset(DIGITS, 20, 2) }, opts: { lr: 0.02, augment: true, freezeFirst: false } } });
    host.handle({ t: 'step' });
    const t = (await next((m) => m.t === 'tick')) as Extract<FromHost, { t: 'tick' }>;
    expect((t.report as { text: string }).text).toContain('Pérdida');
    host.handle({ t: 'bench', sizes: [1, 4], batch: 8, backends: ['cpu', 'gpu'] });
    await next((m) => m.t === 'bench' && m.done);
    const rows = got.filter((m): m is Extract<FromHost, { t: 'bench' }> => m.t === 'bench' && !!m.row).map((m) => m.row!);
    const cpu = rows.filter((r) => r.backend === 'cpu');
    expect(cpu.length).toBe(2);
    expect(cpu[0].rate!).toBeGreaterThan(cpu[1].rate!); // ×4 the filters is slower
    expect(rows.filter((r) => r.backend === 'gpu').every((r) => r.rate === null)).toBe(true);

    const g2 = harness();
    const m = newModel(GPT_CONFIG, 1);
    g2.host.handle({ t: 'init', demo: 'gpt', state: { cfg: m.cfg, params: m.params.map((p) => p.data), data: { train: makeSentences(200, 1, 'train'), test: makeSentences(20, 2, 'test') }, lr: 0.003 } });
    g2.host.handle({ t: 'step' });
    const t2 = (await g2.next((x) => x.t === 'tick')) as Extract<FromHost, { t: 'tick' }>;
    expect((t2.stats as { steps: number; seen: number }).seen).toBe(8);
    expect((t2.snapshot as { params: Float32Array[] }).params.length).toBe(m.params.length);
  }, 30_000);
});

describe('trainers', () => {
  test('perceptron: several steps per call walk through the data (regression)', async () => {
    const { PerceptronTrainer } = await import('../perceptron/trainer');
    const data = { train: makeDataset('3', 200, 2, { variants: true }), test: makeDataset('3', 100, 3, { variants: true }) };
    const t = new PerceptronTrainer({ machine: newMachine('centered', ['3']), data, eta: 0.1 });
    const a = await t.advance({ steps: 600, verbose: false, abort: () => false });
    const pts = (a.stats as { points: { train: number }[] }).points;
    expect(pts[pts.length - 1].train).toBeGreaterThan(0.95);
  });
});
