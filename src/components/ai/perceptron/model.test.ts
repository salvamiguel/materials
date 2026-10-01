import { describe, expect, test } from 'bun:test';

import {
  CELLS,
  DIGITS,
  GRID,
  NORM_H,
  NORM_W,
  SCAN_H,
  SCAN_W,
  accuracy,
  bbox,
  center,
  decide,
  fromJSON,
  fromShareCode,
  learn,
  makeClassDataset,
  makeDataset,
  newMachine,
  normalize,
  pack,
  read,
  renderGlyph,
  shareCode,
  shift,
  toJSON,
  unpack,
  type Mode,
} from './model';

const ink = (g: Uint8Array) => g.reduce((a, b) => a + b, 0);

function train(mode: Mode, classes: string[], set: ReturnType<typeof makeDataset>, epochs: number) {
  const m = newMachine(mode, classes);
  for (let e = 0; e < epochs; e++) for (const ex of set) learn(m, ex, 0.1);
  return m;
}

describe('glyphs', () => {
  test('every digit renders inside the grid', () => {
    for (const d of DIGITS) {
      const g = renderGlyph(d);
      expect(g.length).toBe(CELLS);
      expect(ink(g)).toBeGreaterThan(10);
    }
  });

  test('different characters render differently', () => {
    expect(renderGlyph('1').join('')).not.toBe(renderGlyph('7').join(''));
  });

  test('datasets are reproducible from their seed and balanced', () => {
    const a = makeDataset('3', 200, 42);
    const b = makeDataset('3', 200, 42);
    expect(a.map((e) => e.grid.join('')).join()).toBe(b.map((e) => e.grid.join('')).join());
    expect(a.filter((e) => e.target).length).toBe(100);
    expect(a.filter((e) => e.target).every((e) => e.ch === '3')).toBe(true);
  });
});

describe('preprocessing', () => {
  test('centering undoes a shift', () => {
    const g = renderGlyph('7', { w: 6, h: 9, x: 0, y: 0, bold: false, italic: 0 });
    expect(center(shift(g, 5, 4)).join('')).toBe(center(g).join(''));
  });

  test('normalizing makes size irrelevant', () => {
    const small = renderGlyph('L', { w: 5, h: 7, x: 1, y: 2, bold: false, italic: 0 });
    const big = renderGlyph('L', { w: 10, h: 14, x: 4, y: 1, bold: false, italic: 0 });
    const n = normalize(small);
    expect(n.join('')).toBe(normalize(big).join(''));
    const b = bbox(n)!;
    expect(b.x1 - b.x0 + 1).toBe(NORM_W);
    expect(b.y1 - b.y0 + 1).toBe(NORM_H);
  });
});

describe('reading', () => {
  test('the sum adds the weights of the lit cells', () => {
    const m = newMachine('mark1', ['1']);
    const g = new Uint8Array(CELLS);
    g[0] = 1;
    g[5] = 1;
    m.weights[0][0] = 0.5;
    m.weights[0][5] = -0.2;
    m.weights[0][7] = 0.9;
    expect(read('mark1', m.weights[0], g).sum).toBeCloseTo(0.3);
  });

  test('the scanner finds its template anywhere', () => {
    const w = new Float32Array(SCAN_W * SCAN_H);
    w[0] = 1;
    w[SCAN_W + 1] = 1;
    const g = new Uint8Array(CELLS);
    g[5 * GRID + 6] = 1;
    g[6 * GRID + 7] = 1;
    const r = read('scanner', w, g);
    expect(r.sum).toBe(2);
    expect(r.at).toEqual({ x: 6, y: 5 });
  });
});

describe('learning', () => {
  test('one mistake turns the lit knobs by η and moves θ', () => {
    const m = newMachine('mark1', ['1']);
    m.thetas[0] = 1; // lamp off on a blank machine
    const ex = { grid: renderGlyph('1'), ch: '1', target: true };
    const r = learn(m, ex, 0.1);
    expect(r.correct).toBe(false);
    expect(m.thetas[0]).toBeCloseTo(0.9);
    for (let i = 0; i < CELLS; i++) expect(m.weights[0][i]).toBeCloseTo(ex.grid[i] ? 0.1 : 0);
  });

  test('a correct answer leaves the knobs alone', () => {
    const m = newMachine('mark1', ['1']);
    const r = learn(m, { grid: renderGlyph('1'), ch: '1', target: true }, 0.1);
    expect(r.correct).toBe(true);
    expect(r.changed).toEqual([]);
  });

  test('a detector learns its character', () => {
    const train_ = makeDataset('0', 200, 1, { variants: false });
    const test_ = makeDataset('0', 100, 2, { variants: false });
    const m = train('centered', ['0'], train_, 15);
    expect(accuracy(m, train_)).toBeGreaterThan(0.95);
    expect(accuracy(m, test_)).toBeGreaterThan(0.85);
  });

  test('centering beats the raw Mark I wiring on shifted glyphs', () => {
    const tr = makeDataset('7', 200, 3);
    const te = makeDataset('7', 200, 4);
    expect(accuracy(train('centered', ['7'], tr, 10), te)).toBeGreaterThan(accuracy(train('mark1', ['7'], tr, 10), te));
  });

  test('a classifier learns the ten digits', () => {
    const tr = makeClassDataset(DIGITS, 400, 5, { variants: false });
    const m = train('normalized', DIGITS, tr, 20);
    expect(accuracy(m, tr)).toBeGreaterThan(0.9);
    const d = decide(m, renderGlyph('4'));
    expect(DIGITS[d.winner]).toBe('4');
  });
});

describe('saving', () => {
  test('pack/unpack round-trips knobs in hundredths', () => {
    const m = train('scanner', ['A', 'B', 'C'], makeClassDataset(['A', 'B', 'C'], 60, 6), 2);
    const back = unpack(pack(m));
    expect(back.mode).toBe('scanner');
    expect(back.classes).toEqual(['A', 'B', 'C']);
    for (let k = 0; k < 3; k++) {
      expect(back.thetas[k]).toBeCloseTo(m.thetas[k], 2);
      for (let i = 0; i < m.weights[k].length; i++) expect(back.weights[k][i]).toBeCloseTo(m.weights[k][i], 2);
    }
  });

  test('share codes survive the trip through a URL', async () => {
    const m = train('mark1', ['5'], makeDataset('5', 50, 7), 1);
    const code = await shareCode(m);
    expect(code).toMatch(/^[zr][A-Za-z0-9_-]+$/);
    const back = await fromShareCode(code);
    expect(Array.from(back.weights[0]).map((v) => Math.round(v * 100) + 0)).toEqual(
      Array.from(m.weights[0]).map((v) => Math.round(v * 100) + 0),
    );
  });

  test('the JSON export round-trips', () => {
    const m = train('normalized', ['0', '1'], makeClassDataset(['0', '1'], 40, 8), 2);
    const back = fromJSON(toJSON(m));
    expect(back.mode).toBe('normalized');
    m.weights[1].forEach((x, i) => expect(back.weights[1][i]).toBeCloseTo(x, 2));
    expect(() => fromJSON('{"format":"other"}')).toThrow();
  });

  test('garbage is rejected', () => {
    expect(() => unpack(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
