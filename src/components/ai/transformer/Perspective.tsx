import React, { useCallback, useEffect, useRef, useState } from 'react';

import cs from '../cnn/cnn.module.css';
import { weights } from './AttentionViews';
import type { Trace } from './model';

/* The Transformer in perspective, like the figure of the paper: the encoder
 * tower on the left, the decoder on the right. Every floor is one layer and
 * every word is a strip of its d numbers (green positive, red negative).
 * Lines are attention: inside each tower from the floor below, and the
 * cross-attention from the top of the encoder to every decoder layer; the
 * selected output word's lines are drawn in amber. Same small pinhole
 * camera on a 2D canvas as the convolutional network's view. */

interface Props {
  trace: Trace;
  d: number;
  src: string[];
  /** Decoder input: <s> and the words written so far. */
  dec: string[];
  /** What each decoder position predicts (its row of the output). */
  out: string[];
  head: number;
  selected: number;
  onSelect: (row: number) => void;
}

type V3 = [number, number, number];

const VIEWS = {
  persp: { yaw: -20, pitch: 14, label: 'Perspectiva' },
  front: { yaw: 0, pitch: 4, label: 'De frente' },
  side: { yaw: -62, pitch: 22, label: 'Lateral' },
} as const;
type ViewId = keyof typeof VIEWS;

const FOV = (36 * Math.PI) / 180;
const AMBER = '#ffb020';
const STEP = 2.3; // between words
const FLOOR = 7; // between layers
const STRIP_W = 0.9;
const STRIP_H = 4.2;
const GAP = 5; // between the towers

export default function Perspective({ trace, d, src, dec, out, head, selected, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<{ yaw: number; pitch: number; zoom: number }>({ ...VIEWS.persp, zoom: 1 });
  const [view, setView] = useState<ViewId | null>('persp');
  const [spin, setSpin] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 460 });
  const hits = useRef<{ row: number; box: [number, number, number, number] }[]>([]);
  const props = useRef({ trace, d, src, dec, out, head, selected });
  props.current = { trace, d, src, dec, out, head, selected };

  const draw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { w: W, h: H } = size;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { trace: tr, d: dd, src: S, dec: D, out: O, head: hd, selected: sel } = props.current;
    if (!tr.encStates.length) return;

    // ── layout: x along the words, y up the layers ──
    const encX = (j: number) => j * STEP;
    const decX0 = (S.length - 1) * STEP + GAP + STRIP_W;
    const decX = (i: number) => decX0 + i * STEP;
    const yOf = (level: number) => level * FLOOR;
    const levels = tr.encStates.length; // embeddings + one per layer
    const width = decX(D.length - 1) + STRIP_W;
    const height = yOf(levels - 1) + STRIP_H;
    const center: V3 = [width / 2, height / 2, 0];

    // ── camera ──
    const yaw = (cam.current.yaw * Math.PI) / 180, pitch = (cam.current.pitch * Math.PI) / 180;
    const f: V3 = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const r = norm([-f[2], 0, f[0]]);
    const u = cross(r, f);
    const dist = Math.hypot(width, height) * 1.6;
    const eye: V3 = [center[0] - f[0] * dist, center[1] - f[1] * dist, center[2] - f[2] * dist];
    const F = H / 2 / Math.tan(FOV / 2);
    const raw = (p: V3): [number, number, number] => {
      const q: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const z = Math.max(0.1, dot(q, f));
      return [(dot(q, r) * F) / z, -(dot(q, u) * F) / z, z];
    };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of [
      [-1.5, -2.5, 0],
      [width + 1.5, -2.5, 0],
      [-1.5, height + 2.5, 0],
      [width + 1.5, height + 2.5, 0],
      [-1.5, -2.5, STRIP_W],
      [width + 1.5, height + 2.5, -STRIP_W],
    ] as V3[]) {
      const [a, b] = raw(p);
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, a);
      y0 = Math.min(y0, b);
      y1 = Math.max(y1, b);
    }
    const k = Math.min((W - 30) / (x1 - x0), (H - 40) / (y1 - y0)) / cam.current.zoom;
    const ox = W / 2 - (k * (x0 + x1)) / 2, oy = H / 2 + 10 - (k * (y0 + y1)) / 2;
    const proj = (p: V3): [number, number, number] => {
      const [a, b, z] = raw(p);
      return [ox + k * a, oy + k * b, z];
    };

    // ── vectors as strips ──
    const strips: { x: number; y: number; data: Float32Array; row: number; dec: boolean; level: number }[] = [];
    tr.encStates.forEach((st, lv) => S.forEach((_, j) => strips.push({ x: encX(j), y: yOf(lv), data: st.subarray(j * dd, j * dd + dd), row: j, dec: false, level: lv })));
    tr.decStates.forEach((st, lv) => D.forEach((_, i) => strips.push({ x: decX(i), y: yOf(lv), data: st.subarray(i * dd, i * dd + dd), row: i, dec: true, level: lv })));
    const depthOf = (s: (typeof strips)[number]) => proj([s.x, s.y + STRIP_H / 2, 0])[2];
    strips.sort((a, b) => depthOf(b) - depthOf(a));

    const newHits: typeof hits.current = [];
    for (const s of strips) {
      let mx = 1e-6;
      for (const v of s.data) mx = Math.max(mx, Math.abs(v));
      const cell = STRIP_H / dd;
      const corner = (cx: number, cy: number) => proj([s.x + cx, s.y + cy, 0]);
      const frame = [corner(0, 0), corner(STRIP_W, 0), corner(STRIP_W, STRIP_H), corner(0, STRIP_H)];
      ctx.beginPath();
      frame.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.closePath();
      ctx.fillStyle = '#15171a';
      ctx.fill();
      for (let i = 0; i < dd; i++) {
        const v = s.data[i] / mx;
        if (Math.abs(v) < 0.06) continue;
        const q = [corner(0, i * cell), corner(STRIP_W, i * cell), corner(STRIP_W, (i + 1) * cell), corner(0, (i + 1) * cell)];
        ctx.beginPath();
        q.forEach(([a, b], n) => (n ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
        ctx.closePath();
        ctx.fillStyle = v > 0 ? `rgba(46, 230, 140, ${0.15 + 0.85 * v})` : `rgba(255, 77, 77, ${0.15 - 0.85 * v})`;
        ctx.fill();
      }
      const isSel = s.dec && s.row === sel;
      ctx.beginPath();
      frame.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.closePath();
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeStyle = isSel ? AMBER : 'rgba(154, 163, 173, 0.45)';
      ctx.stroke();
      if (s.dec) {
        const xs = frame.map((p) => p[0]), ys = frame.map((p) => p[1]);
        newHits.push({ row: s.row, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    }
    hits.current = newHits;

    // ── attention lines ──
    const top = (x: number, lv: number) => proj([x + STRIP_W / 2, yOf(lv) + STRIP_H, 0]);
    const bottom = (x: number, lv: number) => proj([x + STRIP_W / 2, yOf(lv), 0]);
    const curve = (a: number[], b: number[], color: string, w: number) => {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      const my = (a[1] + b[1]) / 2;
      ctx.bezierCurveTo(a[0], my, b[0], my, b[0], b[1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.stroke();
    };
    tr.enc.forEach((map, l) => {
      for (let i = 0; i < map.rows; i++)
        weights(map, hd, i).forEach((v, j) => v > 0.12 && curve(top(encX(j), l), bottom(encX(i), l + 1), `rgba(46, 230, 140, ${0.1 + 0.4 * v})`, 0.5 + 2 * v));
    });
    tr.decSelf.forEach((map, l) => {
      for (let i = 0; i < map.rows; i++)
        weights(map, hd, i).forEach((v, j) => v > 0.12 && curve(top(decX(j), l), bottom(decX(i), l + 1), `rgba(154, 163, 173, ${0.08 + 0.3 * v})`, 0.5 + 1.5 * v));
    });
    const encTop = levels - 1;
    tr.cross.forEach((map, l) => {
      for (let i = 0; i < map.rows; i++) {
        const isSel = i === sel;
        weights(map, hd, i).forEach((v, j) => {
          if (v < (isSel ? 0.05 : 0.2)) return;
          const a = top(encX(j), encTop), b = proj([decX(i), yOf(l + 1) - 0.4, 0]);
          curve(a, b, isSel ? `rgba(255, 176, 32, ${0.3 + 0.7 * v})` : `rgba(255, 176, 32, ${0.04 + 0.12 * v})`, isSel ? 1 + 5 * v : 0.5 + v);
        });
      }
    });

    // ── words and names ──
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = (p: V3, text: string, color: string, font: string) => {
      const [a, b] = proj(p);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(text, a, b);
    };
    S.forEach((w, j) => label([encX(j) + STRIP_W / 2, -0.6, 0], w, '#f0ede8', '600 12px "JetBrains Mono", monospace'));
    D.forEach((w, i) => label([decX(i) + STRIP_W / 2, -0.6, 0], w, '#c4cad1', '500 12px "JetBrains Mono", monospace'));
    ctx.textBaseline = 'bottom';
    O.forEach((w, i) =>
      label([decX(i) + STRIP_W / 2, height + 1.4, 0], w, i === sel ? AMBER : '#4affa0', `${i === sel ? 700 : 600} 13px "JetBrains Mono", monospace`),
    );
    label([decX(0) + ((D.length - 1) * STEP) / 2, height + 4.2, 0], 'salida: siguiente palabra', '#9aa3ad', '10px "JetBrains Mono", monospace');
    label([((S.length - 1) * STEP) / 2, height + 1.6, 0], 'CODIFICADOR', '#9aa3ad', '700 11px "JetBrains Mono", monospace');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let lv = 0; lv < levels; lv++)
      label([-0.8, yOf(lv) + STRIP_H / 2, 0], lv ? `capa ${lv}` : 'embedding + posición', '#9aa3ad', '10px "JetBrains Mono", monospace');
    ctx.shadowBlur = 0;
  }, [size]);

  useEffect(draw, [draw, trace, src, dec, out, head, selected]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      setSize({ w, h: Math.round(Math.max(320, Math.min(540, w * 0.5))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const animateTo = useCallback(
    (id: ViewId) => {
      setView(id);
      setSpin(false);
      const from = { ...cam.current };
      const to = VIEWS[id];
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 500);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        cam.current = { yaw: from.yaw + (to.yaw - from.yaw) * e, pitch: from.pitch + (to.pitch - from.pitch) * e, zoom: from.zoom + (1 - from.zoom) * e };
        draw();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [draw],
  );

  useEffect(() => {
    if (!spin) return;
    let raf = 0, last = performance.now(), dir = 1;
    const loop = (now: number) => {
      cam.current.yaw += ((now - last) / 1000) * 10 * dir;
      if (Math.abs(cam.current.yaw) > 60) dir = -Math.sign(cam.current.yaw);
      last = now;
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [spin, draw]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current.zoom = Math.max(0.35, Math.min(2.2, cam.current.zoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
      setView(null);
      draw();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [draw]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, yaw: cam.current.yaw, pitch: cam.current.pitch };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        setSpin(false);
        setView(null);
      }
      cam.current.yaw = Math.max(-80, Math.min(80, start.yaw + dx * 0.3));
      cam.current.pitch = Math.max(-20, Math.min(70, start.pitch + dy * 0.3));
      draw();
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved) return;
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const hit = hits.current.find(({ box: [a, b, c, dd] }) => px >= a && px <= c && py >= b && py <= dd);
      if (hit) onSelect(hit.row);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div ref={wrap} className={cs.persp}>
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onDoubleClick={() => animateTo('persp')}
        role="img"
        aria-label={`El Transformer en perspectiva: codificador con ${src.length} palabras y decodificador con ${dec.length}; las líneas son la atención.`}
      />
      <div className={cs.perspBar}>
        {(Object.keys(VIEWS) as ViewId[]).map((id) => (
          <button key={id} className={view === id ? cs.perspOn : cs.perspBtn} onClick={() => animateTo(id)}>
            {VIEWS[id].label}
          </button>
        ))}
        <button className={spin ? cs.perspOn : cs.perspBtn} onClick={() => setSpin(!spin)} aria-pressed={spin}>
          Girar
        </button>
      </div>
      <p className={cs.perspHint}>Arrastra para girar · rueda para acercar · doble clic para volver · clic en una columna del decodificador para ver su atención</p>
    </div>
  );
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
