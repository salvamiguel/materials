import React, { useCallback, useEffect, useRef, useState } from 'react';

import { GRID, type Grid } from '../perceptron/model';
import cs from './cnn.module.css';
import { maxAbs } from './FeatureMap';
import type { Activations, Net } from './model';

/* The whole network in perspective, as in the classic CNN diagrams: every
 * layer is a stack of square maps facing the input, spaced along the depth
 * of the network, drawn live from the activations. Amber lines trace the
 * magnifier's receptive field: the 3×3 window of the image → the cell it
 * produces → the pooled cell that keeps it. Faint lines join the flattened
 * features to the winning class.
 *
 * Drawn on a 2D canvas with a small pinhole camera, no 3D library: the
 * scene is a few hundred flat quads sorted back to front. */

interface Props {
  net: Net;
  act: Activations;
  retina: Grid;
  focus: { f: number; x: number; y: number };
  /** While the first-layer sweep runs: how many cells of the focused map to show. */
  reveal?: number;
  onPick: (f: number, x: number, y: number) => void;
}

type V3 = [number, number, number];

interface Plane {
  /** Position along the network (world x) and the plane's centre height. */
  x: number;
  y: number;
  /** Side in world units and cells per side. */
  side: number;
  cells: number;
  values: (i: number) => number;
  signed?: boolean;
  scale: number;
  layer: number;
  channel: number;
  highlight?: boolean;
  /** Cells not drawn (sweep in progress) start at this index. */
  reveal?: number;
}

interface Column {
  x: number;
  values: Float32Array;
  scale: number;
  labels?: string[];
  winner?: number;
  cell: number;
}

const VIEWS = {
  persp: { yaw: 42, pitch: 18, label: 'Perspectiva' },
  side: { yaw: 78, pitch: 6, label: 'De frente' },
  top: { yaw: 30, pitch: 48, label: 'Desde arriba' },
} as const;
type ViewId = keyof typeof VIEWS;

const FOV = (38 * Math.PI) / 180;
const AMBER = '#ffb020';

function cellColor(v: number, scale: number, signed: boolean | undefined): string | null {
  const t = Math.min(1, Math.abs(v) / (scale || 1));
  if (t < 0.04) return null;
  if (v < 0 && signed) return `rgba(255, 77, 77, ${0.15 + 0.85 * t})`;
  return `rgba(46, 230, 140, ${0.15 + 0.85 * t})`;
}

export default function Perspective({ net, act, retina, focus, reveal, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<{ yaw: number; pitch: number; zoom: number }>({ yaw: VIEWS.persp.yaw, pitch: VIEWS.persp.pitch, zoom: 1 });
  const [view, setView] = useState<ViewId | null>('persp');
  const [spin, setSpin] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 440 });
  /** Projected first-layer cells from the last frame, for clicking. */
  const hits = useRef<{ f: number; x: number; y: number; q: [number, number][]; depth: number }[]>([]);
  const props = useRef({ net, act, retina, focus, reveal });
  props.current = { net, act, retina, focus, reveal };

  // ── scene ──

  const build = useCallback(() => {
    const { net: n, act: a, retina: g, focus: fc, reveal: rv } = props.current;
    const planes: Plane[] = [];
    const labels: { x: number; y: number; text: string[] }[] = [];
    const LAYER_GAP = 10;
    let x = 0;
    const H = 16; // tallest map; everything is centred on y = 0

    planes.push({ x, y: 0, side: H, cells: GRID, values: (i) => g[i], scale: 1, layer: -1, channel: 0 });
    labels.push({ x, y: -H / 2, text: ['Entrada', '16×16'] });
    x += LAYER_GAP;

    n.layers.forEach((L, li) => {
      const A = a.layers[li];
      const S = L.size, SS = S * S, T = S / L.pool;
      const side = Math.max(5, S), pside = Math.max(5, T * (side / S) * 1.25);
      const sp = li === 0 ? 2.4 : 1.5;
      const aScale = Math.max(0.5, maxAbs(A.a));
      // Big networks: draw the first maps of each stack, it reads the same.
      const C = Math.min(L.cout, 8);
      for (let o = 0; o < C; o++)
        planes.push({
          x: x + o * sp,
          y: 0,
          side,
          cells: S,
          values: (i) => A.a[o * SS + i],
          scale: aScale,
          layer: li,
          channel: o,
          highlight: li === 0 && o === fc.f,
          reveal: li === 0 && o === fc.f ? rv : undefined,
        });
      labels.push({ x: x + ((C - 1) * sp) / 2, y: -side / 2, text: [`Conv 3×3 + ReLU`, `${L.cout} × ${S}×${S}`] });
      x += (C - 1) * sp + LAYER_GAP * 0.8;
      for (let o = 0; o < C; o++)
        planes.push({
          x: x + o * sp,
          y: 0,
          side: pside,
          cells: T,
          values: (i) => A.pool[o * T * T + i],
          scale: aScale,
          layer: li + 0.5,
          channel: o,
          highlight: li === 0 && o === fc.f,
        });
      labels.push({ x: x + ((C - 1) * sp) / 2, y: -pside / 2, text: [`Max-pool ${L.pool}×${L.pool}`, `${L.cout} × ${T}×${T}`] });
      x += (C - 1) * sp + LAYER_GAP;
    });

    const feat: Column = {
      x,
      values: a.features,
      scale: Math.max(0.5, maxAbs(a.features)),
      cell: Math.min(0.9, 22 / a.features.length),
    };
    labels.push({ x, y: -(feat.cell * a.features.length) / 2, text: ['Aplanar', `${a.features.length}`] });
    x += LAYER_GAP * 1.4;
    const out: Column = {
      x,
      values: a.probs,
      scale: 1,
      labels: n.classes,
      winner: a.winner,
      cell: Math.min(1.6, 22 / n.classes.length),
    };
    labels.push({ x, y: -(out.cell * n.classes.length) / 2, text: ['Softmax', `${n.classes.length} clases`] });
    return { planes, labels, feat, out, length: x };
  }, []);

  // ── drawing ──

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

    const scene = build();
    const { focus: fc, net: n } = props.current;
    const center: V3 = [scene.length / 2, 0, 0];
    const yaw = (cam.current.yaw * Math.PI) / 180, pitch = (cam.current.pitch * Math.PI) / 180;
    const f: V3 = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const r: V3 = norm([-f[2], 0, f[0]]); // f × up
    const u: V3 = cross(r, f);
    const D = Math.hypot(scene.length / 2, 12) * 2.6;
    const eye: V3 = [center[0] - f[0] * D, center[1] - f[1] * D, center[2] - f[2] * D];
    const F = H / 2 / Math.tan(FOV / 2);
    const raw = (p: V3): [number, number, number] => {
      const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const z = Math.max(0.1, dot(d, f));
      return [(dot(d, r) * F) / z, -(dot(d, u) * F) / z, z];
    };
    // Fit the projected network to the canvas, whatever the angle; the wheel zooms on top of that.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (p: V3) => {
      const [a, b] = raw(p);
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, a);
      y0 = Math.min(y0, b);
      y1 = Math.max(y1, b);
    };
    for (const p of scene.planes)
      for (const [dy, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) grow([p.x, p.y + (dy * p.side) / 2, (dz * p.side) / 2]);
    for (const l of scene.labels) grow([l.x, l.y - 4, 0]);
    grow([scene.out.x, 12, 4]);
    grow([scene.out.x, -12, 4]);
    const k = (Math.min((W - 40) / (x1 - x0 || 1), (H - 50) / (y1 - y0 || 1)) * 1) / cam.current.zoom;
    const ox = W / 2 - k * ((x0 + x1) / 2), oy = H / 2 + 8 - k * ((y0 + y1) / 2);
    const proj = (p: V3): [number, number, number] => {
      const [a, b, z] = raw(p);
      return [ox + k * a, oy + k * b, z];
    };
    // A point on a plane facing the network axis: column → +z, row → −y.
    const at = (p: Plane, col: number, row: number): V3 => [
      p.x,
      p.y + p.side / 2 - (row / p.cells) * p.side,
      -p.side / 2 + (col / p.cells) * p.side,
    ];
    const quad = (p: Plane, c0: number, r0: number, c1: number, r1: number) =>
      [at(p, c0, r0), at(p, c1, r0), at(p, c1, r1), at(p, c0, r1)].map(proj);
    const poly = (q: number[][]) => {
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
    };

    // Back to front.
    const order = scene.planes
      .map((p) => ({ p, depth: proj([p.x, p.y, 0])[2] }))
      .sort((a, b) => b.depth - a.depth);
    const newHits: typeof hits.current = [];
    for (const { p, depth } of order) {
      const frame = quad(p, 0, 0, p.cells, p.cells);
      poly(frame);
      ctx.fillStyle = 'rgba(21, 23, 26, 0.9)';
      ctx.fill();
      for (let row = 0; row < p.cells; row++)
        for (let col = 0; col < p.cells; col++) {
          const i = row * p.cells + col;
          if (p.reveal !== undefined && i >= p.reveal) continue;
          const color = p.layer === -1 ? (p.values(i) ? 'rgba(240, 237, 232, 0.95)' : null) : cellColor(p.values(i), p.scale, p.signed);
          const q = p.layer === 0 ? quad(p, col, row, col + 1, row + 1) : null;
          if (q) newHits.push({ f: p.channel, x: col, y: row, q: q.map(([a, b]) => [a, b] as [number, number]), depth });
          if (!color) continue;
          poly(q ?? quad(p, col, row, col + 1, row + 1));
          ctx.fillStyle = color;
          ctx.fill();
        }
      poly(frame);
      ctx.lineWidth = p.highlight ? 2 : 1;
      ctx.strokeStyle = p.highlight ? AMBER : 'rgba(154, 163, 173, 0.55)';
      ctx.stroke();
    }
    hits.current = newHits.sort((a, b) => a.depth - b.depth);

    // Columns: flattened features and the class outputs.
    const colPos = (col: Column, i: number): V3 => [col.x, (col.values.length / 2 - i - 0.5) * col.cell, 0];
    const box = (col: Column, i: number) => {
      const [x, y] = colPos(col, i);
      const h = col.cell * 0.42;
      return [
        [x, y + h, -h],
        [x, y + h, h],
        [x, y - h, h],
        [x, y - h, -h],
      ].map((p) => proj(p as V3));
    };
    const { feat, out } = scene;
    // Dense connections to the winner, strongest contributions brightest.
    const win = out.winner ?? 0;
    const target = proj(colPos(out, win));
    const Fn = n.features;
    let maxC = 1e-6;
    const contrib = Array.from(feat.values, (v, j) => {
      const cval = v * n.dense[win * Fn + j];
      maxC = Math.max(maxC, Math.abs(cval));
      return cval;
    });
    contrib.forEach((cval, j) => {
      if (Math.abs(cval) < maxC * 0.05) return;
      const s = proj(colPos(feat, j));
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(target[0], target[1]);
      ctx.strokeStyle = cval > 0 ? `rgba(46, 230, 140, ${0.08 + 0.5 * (cval / maxC)})` : `rgba(255, 77, 77, ${0.08 + 0.4 * (-cval / maxC)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    for (const col of [feat, out])
      for (let i = 0; i < col.values.length; i++) {
        const q = box(col, i);
        poly(q);
        ctx.fillStyle = 'rgba(21, 23, 26, 0.95)';
        ctx.fill();
        const color = cellColor(col.values[i], col.scale, false);
        if (color) {
          ctx.fillStyle = color;
          ctx.fill();
        }
        const isWin = col === out && i === win;
        ctx.strokeStyle = isWin ? AMBER : 'rgba(154, 163, 173, 0.5)';
        ctx.lineWidth = isWin ? 2 : 1;
        ctx.stroke();
        if (col.labels) {
          const [lx, ly] = proj([col.x, colPos(col, i)[1], col.cell * 0.9]);
          ctx.fillStyle = isWin ? AMBER : '#c4cad1';
          ctx.font = `${isWin ? 700 : 500} ${n.classes.length > 12 ? 9 : 11}px "JetBrains Mono", monospace`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
          ctx.shadowBlur = 3;
          ctx.fillText(`${col.labels[i]} ${Math.round(col.values[i] * 100)}%`, lx, ly);
          ctx.shadowBlur = 0;
        }
      }

    // Receptive field of the magnifier: image window → layer-1 cell → pooled cell.
    const inputPlane = scene.planes.find((p) => p.layer === -1)!;
    const c1 = scene.planes.find((p) => p.layer === 0 && p.channel === fc.f);
    const p1 = scene.planes.find((p) => p.layer === 0.5 && p.channel === fc.f);
    if (c1 && p1) {
      const L0 = n.layers[0];
      const win3 = quad(inputPlane, Math.max(0, fc.x - 1), Math.max(0, fc.y - 1), Math.min(GRID, fc.x + 2), Math.min(GRID, fc.y + 2));
      const cell = quad(c1, fc.x, fc.y, fc.x + 1, fc.y + 1);
      const bx = Math.floor(fc.x / L0.pool) * L0.pool, by = Math.floor(fc.y / L0.pool) * L0.pool;
      const block = quad(c1, bx, by, bx + L0.pool, by + L0.pool);
      const px = Math.floor(fc.x / L0.pool), py = Math.floor(fc.y / L0.pool);
      const pcell = quad(p1, px, py, px + 1, py + 1);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 176, 32, 0.75)';
      for (const [from, to] of [
        [win3, cell],
        [block, pcell],
      ])
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(from[k][0], from[k][1]);
          ctx.lineTo(to[k][0], to[k][1]);
          ctx.stroke();
        }
      ctx.lineWidth = 2;
      ctx.strokeStyle = AMBER;
      for (const q of [win3, cell, pcell]) {
        poly(q);
        ctx.stroke();
      }
      ctx.setLineDash([3, 3]);
      poly(block);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Layer names under each stack, with a dark halo so they read over lit cells.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const l of scene.labels) {
      const [lx, ly] = proj([l.x, l.y - 1.2, 0]);
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#d7dbe0';
      ctx.fillText(l.text[0], lx, ly);
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#9aa3ad';
      ctx.fillText(l.text[1], lx, ly + 14);
    }
    ctx.shadowBlur = 0;
  }, [build, size]);

  useEffect(draw, [draw, net, act, retina, focus, reveal]);

  // ── sizing ──

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      setSize({ w, h: Math.round(Math.max(300, Math.min(520, w * 0.48))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── camera ──

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
        cam.current.yaw = from.yaw + (to.yaw - from.yaw) * e;
        cam.current.pitch = from.pitch + (to.pitch - from.pitch) * e;
        cam.current.zoom = from.zoom + (1 - from.zoom) * e;
        draw();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [draw],
  );

  useEffect(() => {
    if (!spin) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      cam.current.yaw += ((now - last) / 1000) * 12;
      if (cam.current.yaw > 85) cam.current.yaw = -85;
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
      cam.current.yaw = Math.max(-85, Math.min(85, start.yaw + dx * 0.3));
      cam.current.pitch = Math.max(-30, Math.min(80, start.pitch + dy * 0.3));
      draw();
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved) return;
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const hit = hits.current.find((h) => inside(h.q, px, py));
      if (hit) onPick(hit.f, hit.x, hit.y);
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
        aria-label={`La red en perspectiva: entrada, ${net.layers.length} capas convolucionales con sus max-pool, vector aplanado y salida softmax. La red dice ${net.classes[act.winner]}.`}
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
      <p className={cs.perspHint}>Arrastra para girar · rueda para acercar · doble clic para volver · clic en un mapa de la capa 1 para la lupa</p>
    </div>
  );
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Point in a convex quad (either winding). */
function inside(q: [number, number][], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % q.length];
    const s = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
