/* 8-bit sound effects with the Web Audio API: square and triangle waves, no
 * samples. The AudioContext is created on the first sound, which always
 * follows a click, so browsers allow it to start. */

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let lastTick = 0;

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
}

export function isMuted() {
  return muted;
}

/** One note: frequency (Hz), start offset and length (s). */
function note(freq: number, at: number, len: number, wave: Wave = 'square', vol = 1, slideTo?: number) {
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + len);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, A4 = 440;

export const sfx = {
  /** A knob detent; rate-limited so a fast drag is a ratchet, not a buzz. */
  tick(value: number) {
    const now = performance.now();
    if (now - lastTick < 35) return;
    lastTick = now;
    note(900 + value * 400, 0, 0.025, 'square', 0.35);
  },
  /** The lamp lights. */
  on() {
    note(C5, 0, 0.06);
    note(G5, 0.06, 0.09);
  },
  off() {
    note(G5, 0, 0.05, 'square', 0.5);
    note(C5, 0.05, 0.07, 'square', 0.5);
  },
  /** Pen on a retina cell. */
  pixel(on: boolean) {
    note(on ? 1400 : 700, 0, 0.02, 'triangle', 0.5);
  },
  /** A training mistake: the knobs get turned. */
  error() {
    note(220, 0, 0.08, 'square', 0.5, 140);
  },
  /** A correct answer during step-by-step training. */
  ok() {
    note(E5, 0, 0.05, 'triangle', 0.7);
  },
  /** An epoch ends; the pitch climbs with the accuracy. */
  epoch(acc: number) {
    note(A4 * Math.pow(2, acc * 1.5), 0, 0.07, 'triangle', 0.8);
  },
  /** Every training example right. */
  win() {
    [C5, E5, G5, C6].forEach((f, i) => note(f, i * 0.09, 0.12));
    note(C6, 0.36, 0.3, 'triangle');
  },
  click() {
    note(1200, 0, 0.02, 'square', 0.4);
  },
  power() {
    note(110, 0, 0.5, 'sawtooth', 0.4, 880);
    [C5, G5, C6].forEach((f, i) => note(f, 0.45 + i * 0.07, 0.1));
  },
};
