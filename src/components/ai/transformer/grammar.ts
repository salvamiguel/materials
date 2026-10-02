/* A small Spanish → English grammar for the translator to learn.
 *
 *   [det noun adj?] verb [det noun adj?]
 *   el gato negro come una manzana roja  →  the black cat eats a red apple
 *
 * It is tiny on purpose but keeps what makes translation more than a lookup:
 * adjectives move in front of the noun, Spanish gender and number agreement
 * collapse in English, and the verb's number follows the subject. A few
 * noun–adjective pairs are kept out of training so the test set measures
 * whether the network composes words it knows into phrases it never saw. */

import { rng } from '../perceptron/model';

export const PAD = '·';
export const BOS = '<s>';
export const EOS = '</s>';

type Gender = 'm' | 'f';

interface Noun {
  es: [string, string];
  en: [string, string];
  g: Gender;
  /** Can be the subject of the verbs below. */
  animate: boolean;
}

const NOUNS: Noun[] = [
  { es: ['gato', 'gatos'], en: ['cat', 'cats'], g: 'm', animate: true },
  { es: ['perro', 'perros'], en: ['dog', 'dogs'], g: 'm', animate: true },
  { es: ['niño', 'niños'], en: ['boy', 'boys'], g: 'm', animate: true },
  { es: ['niña', 'niñas'], en: ['girl', 'girls'], g: 'f', animate: true },
  { es: ['vaca', 'vacas'], en: ['cow', 'cows'], g: 'f', animate: true },
  { es: ['libro', 'libros'], en: ['book', 'books'], g: 'm', animate: false },
  { es: ['pez', 'peces'], en: ['fish', 'fish'], g: 'm', animate: false },
  { es: ['casa', 'casas'], en: ['house', 'houses'], g: 'f', animate: false },
  { es: ['manzana', 'manzanas'], en: ['apple', 'apples'], g: 'f', animate: false },
  { es: ['flor', 'flores'], en: ['flower', 'flowers'], g: 'f', animate: false },
];

/** Spanish forms: m.sg, f.sg, m.pl, f.pl. */
const ADJS: { es: [string, string, string, string]; en: string }[] = [
  { es: ['negro', 'negra', 'negros', 'negras'], en: 'black' },
  { es: ['blanco', 'blanca', 'blancos', 'blancas'], en: 'white' },
  { es: ['rojo', 'roja', 'rojos', 'rojas'], en: 'red' },
  { es: ['pequeño', 'pequeña', 'pequeños', 'pequeñas'], en: 'small' },
  { es: ['grande', 'grande', 'grandes', 'grandes'], en: 'big' },
  { es: ['viejo', 'vieja', 'viejos', 'viejas'], en: 'old' },
];

/** Spanish sg/pl, English sg/pl. */
const VERBS: { es: [string, string]; en: [string, string]; objects?: string[] }[] = [
  { es: ['come', 'comen'], en: ['eats', 'eat'], objects: ['manzana', 'pez', 'flor'] },
  { es: ['ve', 'ven'], en: ['sees', 'see'] },
  { es: ['tiene', 'tienen'], en: ['has', 'have'] },
  { es: ['quiere', 'quieren'], en: ['wants', 'want'] },
];

/** Definite or indefinite; Spanish m.sg, f.sg, m.pl, f.pl → English sg, pl. */
const DETS: { es: [string, string, string, string]; en: [string, string] }[] = [
  { es: ['el', 'la', 'los', 'las'], en: ['the', 'the'] },
  { es: ['un', 'una', 'unos', 'unas'], en: ['a', 'some'] },
];

/** Noun–adjective pairs never seen in training (any gender or number). */
export const HELD_OUT: [string, string][] = [
  ['gato', 'blanco'],
  ['vaca', 'negro'],
  ['manzana', 'rojo'],
  ['casa', 'pequeño'],
  ['perro', 'viejo'],
];

export interface Pair {
  es: string[];
  en: string[];
}

interface Phrase {
  noun: number;
  plural: boolean;
  det: number;
  /** Adjective index or -1. */
  adj: number;
}

function phraseEs(p: Phrase): string[] {
  const n = NOUNS[p.noun];
  const form = (n.g === 'f' ? 1 : 0) + (p.plural ? 2 : 0);
  const out = [DETS[p.det].es[form], n.es[p.plural ? 1 : 0]];
  if (p.adj >= 0) out.push(ADJS[p.adj].es[form]);
  return out;
}

function phraseEn(p: Phrase): string[] {
  const n = NOUNS[p.noun];
  const out = [DETS[p.det].en[p.plural ? 1 : 0]];
  if (p.adj >= 0) out.push(ADJS[p.adj].en);
  out.push(n.en[p.plural ? 1 : 0]);
  // "a" becomes "an" before a vowel: the decoder must look ahead at what comes next.
  if (out[0] === 'a' && /^[aeiou]/.test(out[1])) out[0] = 'an';
  return out;
}

const fits = (v: number, o: Phrase) => !VERBS[v].objects || VERBS[v].objects!.includes(NOUNS[o.noun].es[0]);

const isHeldOut = (p: Phrase) =>
  p.adj >= 0 && HELD_OUT.some(([n, a]) => NOUNS[p.noun].es[0] === n && ADJS[p.adj].es[0] === a);

function randomPhrase(r: () => number, animate: boolean): Phrase {
  const pool = NOUNS.map((n, i) => ({ n, i })).filter((x) => !animate || x.n.animate);
  return {
    noun: pool[Math.floor(r() * pool.length)].i,
    plural: r() < 0.35,
    det: r() < 0.6 ? 0 : 1,
    adj: r() < 0.6 ? Math.floor(r() * ADJS.length) : -1,
  };
}

function sentence(s: Phrase, v: number, o: Phrase): Pair {
  const verb = VERBS[v];
  return {
    es: [...phraseEs(s), verb.es[s.plural ? 1 : 0], ...phraseEs(o)],
    en: [...phraseEn(s), verb.en[s.plural ? 1 : 0], ...phraseEn(o)],
  };
}

/** Random sentences. `split` keeps training free of the held-out pairs and makes every test sentence use one. */
export function makePairs(n: number, seed: number, split: 'train' | 'test'): Pair[] {
  const r = rng(seed);
  const out: Pair[] = [];
  while (out.length < n) {
    const s = randomPhrase(r, true), o = randomPhrase(r, false);
    if (split === 'test') {
      const [noun, adj] = HELD_OUT[Math.floor(r() * HELD_OUT.length)];
      const ni = NOUNS.findIndex((x) => x.es[0] === noun);
      const target = NOUNS[ni].animate && r() < 0.5 ? s : o;
      target.noun = ni;
      target.adj = ADJS.findIndex((x) => x.es[0] === adj);
    } else if (isHeldOut(s) || isHeldOut(o)) continue;
    const verbs = VERBS.map((_, i) => i).filter((i) => fits(i, o));
    out.push(sentence(s, verbs[Math.floor(r() * verbs.length)], o));
  }
  return out;
}

export const SRC_VOCAB = [
  PAD,
  ...new Set([
    ...DETS.flatMap((d) => d.es),
    ...NOUNS.flatMap((n) => n.es),
    ...ADJS.flatMap((a) => a.es),
    ...VERBS.flatMap((v) => v.es),
  ]),
];

export const TGT_VOCAB = [
  PAD,
  BOS,
  EOS,
  ...new Set([...DETS.flatMap((d) => d.en), 'an', ...NOUNS.flatMap((n) => n.en), ...ADJS.map((a) => a.en), ...VERBS.flatMap((v) => v.en)]),
];

/** Words grouped for the sentence builder. */
export const WORDS = {
  det: [...new Set(DETS.flatMap((d) => d.es))],
  noun: NOUNS.flatMap((n) => n.es),
  adj: [...new Set(ADJS.flatMap((a) => a.es))],
  verb: VERBS.flatMap((v) => v.es),
};

/** Longest sentence: det noun adj verb det noun adj (+ EOS on the target side). */
export const MAX_SRC = 7;
export const MAX_TGT = 8;

/** Reference translation of a sentence the grammar can produce, or null for anything else. */
export function reference(es: string[]): string[] | null {
  const parse = (i: number, animate: boolean): [Phrase, number] | null => {
    const det = DETS.findIndex((d) => d.es.includes(es[i]));
    const noun = NOUNS.findIndex((n) => n.es.includes(es[i + 1]));
    if (det < 0 || noun < 0 || (animate && !NOUNS[noun].animate)) return null;
    const plural = NOUNS[noun].es[1] === es[i + 1] && NOUNS[noun].es[0] !== es[i + 1];
    const form = (NOUNS[noun].g === 'f' ? 1 : 0) + (plural ? 2 : 0);
    if (DETS[det].es[form] !== es[i]) return null;
    const adj = ADJS.findIndex((a) => a.es[form] === es[i + 2]);
    return [{ noun, plural, det, adj }, i + (adj >= 0 ? 3 : 2)];
  };
  const s = parse(0, true);
  if (!s) return null;
  const v = VERBS.findIndex((x) => x.es[s[0].plural ? 1 : 0] === es[s[1]]);
  if (v < 0) return null;
  const o = parse(s[1] + 1, false);
  if (!o || o[1] !== es.length || !fits(v, o[0])) return null;
  return sentence(s[0], v, o[0]).en;
}
