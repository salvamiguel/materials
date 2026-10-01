import { describe, expect, test } from 'bun:test';

import { DIGITS, GRID, emptyGrid, makeClassDataset, newMachine, learn, accuracy, renderGlyph, shift } from '../perceptron/model';
import {
  applyPreset,
  evaluate,
  forward,
  fromJSON,
  fromShareCode,
  magnify,
  newNet,
  pack,
  shareCode,
  softmax,
  toJSON,
  trainStep,
  unpack,
  type ArchId,
} from './model';

const train = makeClassDataset(DIGITS, 600, 21);
const test_ = makeClassDataset(DIGITS, 200, 22);

function trained(arch: ArchId, epochs: number, opts: { freezeFirst?: boolean } = {}) {
  const n = newNet(arch, DIGITS, 3);
  for (let e = 0; e < epochs; e++) for (const ex of train) trainStep(n, ex, 0.02, opts);
  return n;
}

describe('forward pass', () => {
  test('shapes: LeNet goes 16×16 → 4×16×16 → 4×8×8 → 8×8×8 → 8×2×2 → 10', () => {
    const n = newNet('lenet', DIGITS);
    const a = forward(n, renderGlyph('3'));
    expect(a.layers[0].z.length).toBe(4 * 256);
    expect(a.layers[0].pool.length).toBe(4 * 64);
    expect(a.layers[1].z.length).toBe(8 * 64);
    expect(a.layers[1].pool.length).toBe(8 * 4);
    expect(n.features).toBe(32);
    expect(a.probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 5);
    expect(newNet('shallow', DIGITS).features).toBe(64);
  });

  test('a vertical-stroke filter fires on a vertical stroke, not on a horizontal one', () => {
    const n = newNet('shallow', ['a', 'b']);
    applyPreset(n, 0, 'v');
    const g = emptyGrid();
    for (let y = 2; y < 12; y++) g[y * GRID + 6] = 1;
    const m = magnify(n, g, 0, 6, 5);
    expect(m.z).toBeCloseTo(2); // 3 × 1 − 1
    expect(m.cells.filter((c) => c.px).length).toBe(3);
    const h = emptyGrid();
    for (let x = 2; x < 12; x++) h[6 * GRID + x] = 1;
    const a = forward(n, h);
    expect(Math.max(...a.layers[0].a.subarray(0, 256))).toBe(0);
  });

  test('the magnifier agrees with the forward pass', () => {
    const n = newNet('lenet', DIGITS, 7);
    const g = renderGlyph('8');
    const a = forward(n, g);
    for (const [x, y] of [[0, 0], [5, 7], [15, 15]]) expect(magnify(n, g, 2, x, y).z).toBeCloseTo(a.layers[0].z[2 * 256 + y * 16 + x], 5);
  });

  test('a shifted drawing shifts the first feature map with it', () => {
    const n = newNet('shallow', DIGITS, 5);
    const g = renderGlyph('7', { w: 6, h: 9, x: 3, y: 3, bold: false, italic: 0 });
    const a = forward(n, g).layers[0].z, b = forward(n, shift(g, 2, 2)).layers[0].z;
    for (let y = 1; y < 12; y++) for (let x = 1; x < 12; x++) expect(b[(y + 2) * 16 + x + 2]).toBeCloseTo(a[y * 16 + x], 5);
  });

  test('softmax is stable for large logits', () => {
    const p = softmax(new Float32Array([1000, 1000, 0]));
    expect(p[0]).toBeCloseTo(0.5);
    expect(p[2]).toBeCloseTo(0);
  });
});

describe('learning', () => {
  test('a gradient step lowers the loss on that example', () => {
    for (const arch of ['shallow', 'lenet'] as const) {
      const n = newNet(arch, DIGITS, 9);
      const ex = { grid: renderGlyph('5'), ch: '5', target: false };
      const before = trainStep(n, ex, 0.02).loss;
      expect(trainStep(n, ex, 0).loss).toBeLessThan(before);
    }
  });

  test('LeNet learns the digits wherever they are, beating the raw perceptron', () => {
    const n = trained('lenet', 12);
    const cnn = evaluate(n, test_).accuracy;
    expect(evaluate(n, train).accuracy).toBeGreaterThan(0.9);
    expect(cnn).toBeGreaterThan(0.75);
    const p = newMachine('mark1', DIGITS);
    for (let e = 0; e < 12; e++) for (const ex of train) learn(p, ex, 0.1);
    expect(cnn).toBeGreaterThan(accuracy(p, test_) + 0.3);
  });

  test('frozen first-layer filters stay put', () => {
    const n = newNet('lenet', DIGITS, 4);
    const w = n.layers[0].w.slice(), w2 = n.layers[1].w.slice();
    trainStep(n, { grid: renderGlyph('1'), ch: '1', target: false }, 0.1, { freezeFirst: true });
    expect(Array.from(n.layers[0].w)).toEqual(Array.from(w));
    expect(Array.from(n.layers[1].w)).not.toEqual(Array.from(w2));
  });
});

describe('saving', () => {
  test('pack/unpack keeps the predictions', () => {
    const n = trained('lenet', 2);
    const back = unpack(pack(n));
    expect(back.arch).toBe('lenet');
    let same = 0;
    for (const e of test_) if (forward(back, e.grid).winner === forward(n, e.grid).winner) same++;
    expect(same / test_.length).toBeGreaterThan(0.95);
  });

  test('share codes and JSON round-trip', async () => {
    const n = newNet('shallow', ['A', 'B', 'C'], 2);
    const back = await fromShareCode(await shareCode(n));
    expect(back.arch).toBe('shallow');
    expect(back.classes).toEqual(['A', 'B', 'C']);
    const j = fromJSON(toJSON(n));
    j.dense.forEach((v, i) => expect(v).toBeCloseTo(n.dense[i], 3));
    expect(() => fromJSON('{"format":"perceptron"}')).toThrow();
    expect(() => unpack(new Uint8Array([0x50, 0, 0]))).toThrow();
  });
});
