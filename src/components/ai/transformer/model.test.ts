import { describe, expect, test } from 'bun:test';

import { rng } from '../perceptron/model';
import { Graph, Mat } from './autograd';
import { HELD_OUT, SRC_VOCAB, TGT_VOCAB, makePairs, reference } from './grammar';
import {
  DEFAULT_CONFIG,
  evaluate,
  fromJSON,
  fromShareCode,
  newModel,
  pack,
  pairLoss,
  positionalEncoding,
  shareCode,
  toJSON,
  trainBatch,
  translate,
  unpack,
} from './model';

const train = makePairs(3000, 1, 'train');
const test_ = makePairs(150, 2, 'test');

describe('grammar', () => {
  test('every generated pair matches its reference translation', () => {
    for (const p of [...train.slice(0, 500), ...test_]) expect(reference(p.es)).toEqual(p.en);
  });

  test('held-out noun–adjective pairs appear only in the test set', () => {
    const has = (p: { es: string[] }, [n, a]: [string, string]) =>
      p.es.some((w, i) => w.startsWith(n.slice(0, 3)) && p.es[i + 1]?.startsWith(a.slice(0, 3)));
    expect(train.some((p) => HELD_OUT.some((h) => has(p, h)))).toBe(false);
    expect(test_.every((p) => HELD_OUT.some((h) => has(p, h)))).toBe(true);
  });

  test('English puts adjectives first and says "an" before a vowel', () => {
    expect(reference('el gato negro come una manzana roja'.split(' '))).toEqual('the black cat eats a red apple'.split(' '));
    expect(reference('un perro viejo ve una manzana'.split(' '))).toEqual('an old dog sees an apple'.split(' '));
    expect(reference('los perros comen el gato'.split(' '))).toBeNull(); // dogs only eat food here
    expect(reference('el gato negra come'.split(' '))).toBeNull();
  });
});

describe('autograd', () => {
  test('gradients match finite differences through every operation', () => {
    const r = rng(3);
    const param = (rows: number, cols: number) => {
      const m = new Mat(rows, cols, undefined, true);
      for (let i = 0; i < m.data.length; i++) m.data[i] = r() * 2 - 1;
      return m;
    };
    const table = param(5, 4), w = param(4, 4), b = param(1, 4), gm = param(1, 4), bt = param(1, 4), w2 = param(4, 3);
    const run = (gr: Graph) => {
      const x = gr.embed(table, [1, 3, 0]);
      const h = gr.layerNorm(gr.add(x, gr.relu(gr.addRow(gr.matmul(x, w), b))), gm, bt);
      const s = gr.softmaxRows(gr.scale(gr.matmulT(gr.cols(h, 0, 2), gr.cols(h, 2, 2)), 0.7), (i, j) => j > i);
      const mix = gr.concatCols([gr.matmul(s, gr.cols(h, 0, 2)), gr.cols(h, 2, 2)]);
      return gr.crossEntropy(gr.matmul(mix, w2), [2, 0, 1]);
    };
    const g = new Graph(true);
    g.backward(run(g));
    for (const p of [table, w, b, gm, bt, w2])
      for (let i = 0; i < p.data.length; i++) {
        const keep = p.data[i];
        p.data[i] = keep + 1e-3;
        const up = run(new Graph(false)).data[0];
        p.data[i] = keep - 1e-3;
        const down = run(new Graph(false)).data[0];
        p.data[i] = keep;
        expect(p.grad![i]).toBeCloseTo((up - down) / 2e-3, 2);
      }
  });
});

describe('the transformer', () => {
  test('attention rows are probabilities and the decoder cannot look ahead', () => {
    const m = newModel(DEFAULT_CONFIG, 2);
    const t = translate(m, 'el gato come una manzana'.split(' '), 'the cat eats an apple'.split(' '));
    const self = t.trace.decSelf[0];
    expect(self.rows).toBe(6); // <s> + 5 words
    for (const h of self.heads)
      for (let i = 0; i < self.rows; i++) {
        let s = 0;
        for (let j = 0; j < self.cols; j++) {
          s += h[i * self.cols + j];
          if (j > i) expect(h[i * self.cols + j]).toBe(0);
        }
        expect(s).toBeCloseTo(1, 5);
      }
    expect(t.trace.cross[0].cols).toBe(5);
    expect(t.trace.enc[0].heads.length).toBe(2);
  });

  test('positional encoding is the sinusoid of the paper', () => {
    const pe = positionalEncoding(3, 4);
    expect(pe.get(0, 0)).toBe(0);
    expect(pe.get(0, 1)).toBe(1);
    expect(pe.get(2, 0)).toBeCloseTo(Math.sin(2));
    expect(pe.get(2, 3)).toBeCloseTo(Math.cos(2 / 100));
  });

  test('without positional encoding word order is invisible', () => {
    const m = newModel({ ...DEFAULT_CONFIG, posEnc: false }, 4);
    for (let s = 0; s < 30; s++) trainBatch(m, train.slice(s * 8, s * 8 + 8));
    const a = translate(m, 'el perro ve la vaca'.split(' ')).words;
    const b = translate(m, 'la vaca ve el perro'.split(' ')).words;
    expect(a).toEqual(b);
  });

  test('a training step lowers the loss', () => {
    const m = newModel(DEFAULT_CONFIG, 5);
    const batch = train.slice(0, 8);
    const before = batch.reduce((s, p) => s + pairLoss(new Graph(false), m, p).data[0], 0);
    for (let i = 0; i < 5; i++) trainBatch(m, batch);
    const after = batch.reduce((s, p) => s + pairLoss(new Graph(false), m, p).data[0], 0);
    expect(after).toBeLessThan(before);
  });

  test('it learns to translate, including phrases it never saw, and attends across the reordering', () => {
    const m = newModel(DEFAULT_CONFIG, 1);
    let k = 0;
    for (let s = 0; s < 400; s++) trainBatch(m, Array.from({ length: 8 }, () => train[k++ % train.length]));
    expect(evaluate(m, test_).exact).toBeGreaterThan(0.8);
    const es = 'el gato negro come una manzana roja'.split(' ');
    const t = translate(m, es, reference(es)!);
    // While writing "black" the model looks mostly at "negro", past "gato".
    const cross = t.trace.cross[0];
    const row = es.map((_, j) => cross.heads.reduce((s, h) => s + h[1 * cross.cols + j], 0));
    expect(row.indexOf(Math.max(...row))).toBe(es.indexOf('negro'));
  });
});

describe('saving', () => {
  test('pack, share codes and JSON keep the translations', async () => {
    const m = newModel({ ...DEFAULT_CONFIG, heads: 4 }, 6);
    for (let s = 0; s < 40; s++) trainBatch(m, train.slice(s * 8, s * 8 + 8));
    const es = 'la niña ve un libro'.split(' ');
    const want = translate(m, es).words;
    for (const back of [unpack(pack(m)), await fromShareCode(await shareCode(m)), fromJSON(toJSON(m))]) {
      expect(back.cfg.heads).toBe(4);
      expect(translate(back, es).words).toEqual(want);
    }
    expect(() => fromJSON('{"format":"cnn"}')).toThrow();
    expect(SRC_VOCAB.length).toBeGreaterThan(50);
    expect(TGT_VOCAB[0]).toBe('·');
  });
});
