/* Perceptron demo: the machine's logic, free of React so it can be tested.
 *
 * The retina is a 16×16 grid of 0/1 cells. Three wirings decide what reaches
 * the weights (the knobs):
 *   - mark1:    every cell drives its own knob (256 weights), like the 1958 Mark I.
 *   - centered: the drawing is first moved to the middle of the grid, so a
 *               shifted glyph looks the same to the 256 knobs.
 *   - normalized: centered and also rescaled to a fixed 10×14 box, so size
 *               stops mattering too.
 *   - scanner:  a 7×9 template (63 knobs) slides over the whole retina and the
 *               best match is what the meter reads.
 * The meter reads the weighted sum S; the lamp lights when S ≥ θ (threshold).
 * Learning is Rosenblatt's rule: on a mistake, w ← w + η·(t − y)·x, θ ← θ − η·(t − y). */

export const GRID = 16;
export const CELLS = GRID * GRID;
export const SCAN_W = 7;
export const SCAN_H = 9;
/** Knobs turn between -WMAX and +WMAX, as the Mark I's motor-driven potentiometers had end stops. */
export const WMAX = 1;
export const THETA_MAX = 30;

export type Mode = 'mark1' | 'centered' | 'normalized' | 'scanner';
export type Grid = Uint8Array;

export const MODES: { id: Mode; label: string; knobs: string; blurb: string }[] = [
  {
    id: 'mark1',
    label: 'MARK I',
    knobs: '16×16',
    blurb: 'Cada celda de la retina va cableada a su propio mando: 256 pesos. Si mueves el dibujo, cambian los cables que se encienden.',
  },
  {
    id: 'centered',
    label: 'CENTRADO',
    knobs: '16×16',
    blurb: 'Antes de llegar a los mandos, el dibujo se recentra en la retina. Un mismo carácter desplazado activa los mismos pesos.',
  },
  {
    id: 'normalized',
    label: 'NORMALIZADO',
    knobs: '16×16',
    blurb: 'Además de centrarlo, el dibujo se reescala a una caja fija de 10×14. Un carácter grande y uno pequeño llegan iguales a los mandos.',
  },
  {
    id: 'scanner',
    label: 'ESCÁNER',
    knobs: '7×9',
    blurb: 'Una plantilla de 7×9 pesos recorre toda la retina; el voltímetro marca la posición con mejor coincidencia (una convolución con max-pooling).',
  },
];

export function knobDims(mode: Mode): { w: number; h: number } {
  return mode === 'scanner' ? { w: SCAN_W, h: SCAN_H } : { w: GRID, h: GRID };
}

export function emptyGrid(): Grid {
  return new Uint8Array(CELLS);
}

export function emptyWeights(mode: Mode): Float32Array {
  const { w, h } = knobDims(mode);
  return new Float32Array(w * h);
}

// ── deterministic randomness ─────────────────────────────────────────

/** mulberry32: small seeded PRNG so a dataset can be regenerated identically. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── glyphs ───────────────────────────────────────────────────────────

/** 5×7 bitmap font: each row is 5 bits, most significant on the left. */
const FONT: Record<string, number[]> = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
};

export const DIGITS = '0123456789'.split('');
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface GlyphStyle {
  /** Glyph box size in cells. */
  w: number;
  h: number;
  /** Top-left corner of the box. */
  x: number;
  y: number;
  bold: boolean;
  /** Horizontal shear, in cells per row (positive leans right). */
  italic: number;
}

export const DEFAULT_STYLE: GlyphStyle = { w: 8, h: 12, x: 4, y: 2, bold: true, italic: 0 };

/** Draws a character into a fresh grid by sampling the 5×7 font. */
export function renderGlyph(ch: string, style: GlyphStyle = DEFAULT_STYLE): Grid {
  const rows = FONT[ch.toUpperCase()];
  const g = emptyGrid();
  if (!rows) return g;
  const { w, h, x, y, bold, italic } = style;
  const yc = y + h / 2;
  for (let py = y; py < y + h; py++) {
    if (py < 0 || py >= GRID) continue;
    const shift = italic * (yc - py - 0.5);
    for (let px = 0; px < GRID; px++) {
      const lx = px + 0.5 - x - shift;
      if (lx < 0 || lx >= w) continue;
      const gx = Math.floor((lx * 5) / w);
      const gy = Math.floor(((py - y + 0.5) * 7) / h);
      if ((rows[gy] >> (4 - gx)) & 1) {
        g[py * GRID + px] = 1;
        if (bold && px + 1 < GRID) g[py * GRID + px + 1] = 1;
      }
    }
  }
  return g;
}

/** A random but legible style: size, position, weight and slant vary. */
export function randomStyle(r: () => number, opts: { variants?: boolean } = {}): GlyphStyle {
  const variants = opts.variants ?? true;
  const h = 9 + Math.floor(r() * 5); // 9..13
  const w = 6 + Math.floor(r() * 4); // 6..9
  const bold = variants ? r() < 0.5 : true;
  const italic = variants && r() < 0.3 ? 0.2 + r() * 0.15 : 0;
  const x = Math.floor(r() * (GRID - w - (bold ? 1 : 0) + 1));
  const y = Math.floor(r() * (GRID - h + 1));
  return { w, h, x, y, bold, italic };
}

/** Flips each cell with probability p. */
export function addNoise(g: Grid, p: number, r: () => number = Math.random): Grid {
  const out = g.slice();
  for (let i = 0; i < CELLS; i++) if (r() < p) out[i] ^= 1;
  return out;
}

export function shift(g: Grid, dx: number, dy: number): Grid {
  const out = emptyGrid();
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const nx = x + dx, ny = y + dy;
      if (g[y * GRID + x] && nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) out[ny * GRID + nx] = 1;
    }
  return out;
}

export function bbox(g: Grid): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1;
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++)
      if (g[y * GRID + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export const NORM_W = 10;
export const NORM_H = 14;

/** Rescales the drawing's bounding box to NORM_W×NORM_H (nearest neighbour) and centres it. */
export function normalize(g: Grid): Grid {
  const b = bbox(g);
  const out = emptyGrid();
  if (!b) return out;
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  const ox = (GRID - NORM_W) / 2, oy = (GRID - NORM_H) / 2;
  // Each target cell takes the OR of the source cells it covers, so thin strokes survive shrinking.
  for (let ty = 0; ty < NORM_H; ty++) {
    const sy0 = b.y0 + Math.floor((ty * bh) / NORM_H);
    const sy1 = Math.max(sy0, b.y0 + Math.ceil(((ty + 1) * bh) / NORM_H) - 1);
    for (let tx = 0; tx < NORM_W; tx++) {
      const sx0 = b.x0 + Math.floor((tx * bw) / NORM_W);
      const sx1 = Math.max(sx0, b.x0 + Math.ceil(((tx + 1) * bw) / NORM_W) - 1);
      let on = 0;
      for (let sy = sy0; sy <= sy1 && !on; sy++) for (let sx = sx0; sx <= sx1 && !on; sx++) on = g[sy * GRID + sx];
      out[(oy + ty) * GRID + ox + tx] = on;
    }
  }
  return out;
}

/** Moves the drawing so its bounding box sits in the middle of the grid. */
export function center(g: Grid): Grid {
  const b = bbox(g);
  if (!b) return g.slice();
  const dx = Math.floor((GRID - (b.x1 - b.x0 + 1)) / 2) - b.x0;
  const dy = Math.floor((GRID - (b.y1 - b.y0 + 1)) / 2) - b.y0;
  return shift(g, dx, dy);
}

// ── the perceptron ───────────────────────────────────────────────────

export interface Reading {
  /** Weighted sum the voltmeter shows. */
  sum: number;
  /** What each knob sees (0/1), aligned with the weights. */
  input: Uint8Array;
  /** Scanner only: where the template matched best. */
  at?: { x: number; y: number };
}

function dot(w: Float32Array, x: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) if (x[i]) s += w[i];
  return s;
}

/** Copies the SCAN_W×SCAN_H window at (x, y). */
export function patch(g: Grid, x: number, y: number): Uint8Array {
  const p = new Uint8Array(SCAN_W * SCAN_H);
  for (let j = 0; j < SCAN_H; j++)
    for (let i = 0; i < SCAN_W; i++) p[j * SCAN_W + i] = g[(y + j) * GRID + x + i];
  return p;
}

export function read(mode: Mode, w: Float32Array, g: Grid): Reading {
  if (mode === 'mark1') return { sum: dot(w, g), input: g };
  if (mode === 'centered' || mode === 'normalized') {
    const c = mode === 'centered' ? center(g) : normalize(g);
    return { sum: dot(w, c), input: c };
  }
  let best: Reading | null = null;
  for (let y = 0; y <= GRID - SCAN_H; y++)
    for (let x = 0; x <= GRID - SCAN_W; x++) {
      const p = patch(g, x, y);
      const s = dot(w, p);
      // Ties go to the window with more ink, so a blank template still "looks" at the drawing.
      if (!best || s > best.sum || (s === best.sum && ink(p) > ink(best.input))) best = { sum: s, input: p, at: { x, y } };
    }
  return best!;
}

function ink(p: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < p.length; i++) n += p[i];
  return n;
}

export const clampW = (v: number) => Math.max(-WMAX, Math.min(WMAX, v));
export const clampTheta = (v: number) => Math.max(-THETA_MAX, Math.min(THETA_MAX, v));

/** A bank of perceptrons sharing one retina and one wiring. A detector has a
 * single unit; a classifier has one unit per class and answers with the unit
 * whose needle is furthest above its threshold. */
export interface Machine {
  mode: Mode;
  classes: string[];
  weights: Float32Array[];
  thetas: number[];
}

export function newMachine(mode: Mode, classes: string[]): Machine {
  return { mode, classes, weights: classes.map(() => emptyWeights(mode)), thetas: classes.map(() => 0) };
}

export const isClassifier = (m: Machine) => m.classes.length > 1;

export interface Decision {
  readings: Reading[];
  /** Detector: whether the lamp lights. */
  fired: boolean;
  /** Classifier: index of the winning unit. */
  winner: number;
}

export function decide(m: Machine, g: Grid): Decision {
  const readings = m.weights.map((w) => read(m.mode, w, g));
  let winner = 0;
  for (let k = 1; k < readings.length; k++)
    if (readings[k].sum - m.thetas[k] > readings[winner].sum - m.thetas[winner]) winner = k;
  return { readings, fired: readings[0].sum >= m.thetas[0], winner };
}

function nudge(m: Machine, k: number, input: Uint8Array, d: number) {
  const w = m.weights[k];
  for (let i = 0; i < w.length; i++) if (input[i]) w[i] = clampW(w[i] + d);
  m.thetas[k] = clampTheta(m.thetas[k] - d);
}

export interface StepResult {
  decision: Decision;
  correct: boolean;
  /** Units whose knobs were turned, with the sign of the turn. */
  changed: { unit: number; dir: 1 | -1 }[];
}

/** Whether the machine's answer for an example is right. */
export function isCorrect(m: Machine, d: Decision, e: Example): boolean {
  return isClassifier(m) ? m.classes[d.winner] === e.ch : d.fired === e.target;
}

/** One application of Rosenblatt's rule; mutates the machine.
 *  Detector: on a mistake, w ← w + η·(t − y)·x and θ ← θ − η·(t − y).
 *  Classifier: on a mistake, the right unit gets +η·x and the wrong winner −η·x. */
export function learn(m: Machine, e: Example, eta: number): StepResult {
  const decision = decide(m, e.grid);
  const correct = isCorrect(m, decision, e);
  const changed: StepResult['changed'] = [];
  if (!correct) {
    if (!isClassifier(m)) {
      const dir = e.target ? 1 : -1;
      nudge(m, 0, decision.readings[0].input, dir * eta);
      changed.push({ unit: 0, dir });
    } else {
      const right = m.classes.indexOf(e.ch);
      if (right >= 0) {
        nudge(m, right, decision.readings[right].input, eta);
        changed.push({ unit: right, dir: 1 });
      }
      nudge(m, decision.winner, decision.readings[decision.winner].input, -eta);
      changed.push({ unit: decision.winner, dir: -1 });
    }
  }
  return { decision, correct, changed };
}

export function accuracy(m: Machine, set: Example[]): number {
  if (!set.length) return 0;
  let ok = 0;
  for (const e of set) if (isCorrect(m, decide(m, e.grid), e)) ok++;
  return ok / set.length;
}

// ── datasets ─────────────────────────────────────────────────────────

export interface Example {
  grid: Grid;
  ch: string;
  /** Detector datasets: whether ch is the character to detect. */
  target: boolean;
}

export const familyOf = (ch: string) => (DIGITS.includes(ch) ? DIGITS : LETTERS);

/** Detector dataset: half the examples are the target character, the rest
 *  other characters of the same family. */
export function makeDataset(target: string, n: number, seed: number, opts: { noise?: number; variants?: boolean } = {}): Example[] {
  const r = rng(seed);
  const others = familyOf(target).filter((c) => c !== target);
  return shuffle(
    Array.from({ length: n }, (_, i) => {
      const pos = i % 2 === 0;
      return example(pos ? target : others[Math.floor(r() * others.length)], pos, r, opts);
    }),
    r,
  );
}

/** Classifier dataset: the classes in turn, so every class is equally represented. */
export function makeClassDataset(classes: string[], n: number, seed: number, opts: { noise?: number; variants?: boolean } = {}): Example[] {
  const r = rng(seed);
  return shuffle(
    Array.from({ length: n }, (_, i) => example(classes[i % classes.length], false, r, opts)),
    r,
  );
}

function example(ch: string, target: boolean, r: () => number, opts: { noise?: number; variants?: boolean }): Example {
  let grid = renderGlyph(ch, randomStyle(r, { variants: opts.variants }));
  if (opts.noise) grid = addNoise(grid, opts.noise, r);
  return { grid, ch, target };
}

function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── saving and sharing ───────────────────────────────────────────────
/* A machine packs into bytes: a JSON header (mode, classes, thresholds)
 * followed by every weight as a signed byte in hundredths, which is exact
 * for the knob steps the UI and the learning rule use. */

const MAGIC = 0x50; // 'P'

export function pack(m: Machine): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({ v: 1, mode: m.mode, classes: m.classes, thetas: m.thetas.map((t) => Math.round(t * 100) / 100) }),
  );
  const n = m.weights.reduce((a, w) => a + w.length, 0);
  const out = new Uint8Array(3 + header.length + n);
  out[0] = MAGIC;
  out[1] = header.length >> 8;
  out[2] = header.length & 0xff;
  out.set(header, 3);
  let o = 3 + header.length;
  for (const w of m.weights) for (let i = 0; i < w.length; i++) out[o++] = Math.round(clampW(w[i]) * 100) & 0xff;
  return out;
}

export function unpack(bytes: Uint8Array): Machine {
  if (bytes[0] !== MAGIC) throw new Error('No es un fichero de pesos del perceptrón');
  const hl = (bytes[1] << 8) | bytes[2];
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(3, 3 + hl)));
  if (h.v !== 1 || !MODES.some((x) => x.id === h.mode) || !Array.isArray(h.classes) || !h.classes.length)
    throw new Error('Formato de pesos desconocido');
  const m = newMachine(h.mode, h.classes.map(String));
  const size = m.weights[0].length;
  if (bytes.length !== 3 + hl + size * m.classes.length) throw new Error('El fichero de pesos está incompleto');
  let o = 3 + hl;
  for (const w of m.weights) for (let i = 0; i < size; i++) w[i] = ((bytes[o++] << 24) >> 24) / 100;
  m.thetas = m.classes.map((_, k) => clampTheta(Number(h.thetas?.[k]) || 0));
  return m;
}

export function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(b: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([b as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Bytes → URL-safe code: deflated when the browser can (prefix "z"), raw otherwise ("r"). */
export async function encodeBytes(raw: Uint8Array): Promise<string> {
  if (typeof CompressionStream !== 'undefined') return 'z' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'r' + toBase64Url(raw);
}

export async function decodeBytes(code: string): Promise<Uint8Array> {
  const body = fromBase64Url(code.slice(1));
  if (code[0] === 'z') return pipe(body, new DecompressionStream('deflate-raw'));
  if (code[0] === 'r') return body;
  throw new Error('Código de pesos no válido');
}

/** A URL-safe code for the machine. */
export async function shareCode(m: Machine): Promise<string> {
  return encodeBytes(pack(m));
}

export async function fromShareCode(code: string): Promise<Machine> {
  return unpack(await decodeBytes(code));
}

/** Readable export for the download button: the knobs as plain numbers. */
export function toJSON(m: Machine): string {
  return JSON.stringify(
    {
      format: 'perceptron',
      v: 1,
      mode: m.mode,
      classes: m.classes,
      thetas: m.thetas.map((t) => Math.round(t * 100) / 100),
      weights: m.weights.map((w) => Array.from(w, (x) => Math.round(x * 100) / 100)),
    },
    null,
    1,
  );
}

export function fromJSON(text: string): Machine {
  const j = JSON.parse(text);
  if (j?.format !== 'perceptron' || j.v !== 1 || !MODES.some((x) => x.id === j.mode) || !Array.isArray(j.classes) || !j.classes.length)
    throw new Error('No es un fichero de pesos del perceptrón');
  const m = newMachine(j.mode, j.classes.map(String));
  if (!Array.isArray(j.weights) || j.weights.length !== m.classes.length) throw new Error('El fichero de pesos está incompleto');
  m.weights.forEach((w, k) => {
    const src = j.weights[k];
    if (!Array.isArray(src) || src.length !== w.length) throw new Error('El fichero de pesos está incompleto');
    for (let i = 0; i < w.length; i++) w[i] = clampW(Number(src[i]) || 0);
  });
  m.thetas = m.classes.map((_, k) => clampTheta(Number(j.thetas?.[k]) || 0));
  return m;
}
