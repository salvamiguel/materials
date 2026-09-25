/* Layered (Sugiyama-style) layout for the dependency graph.
 *
 * 1. Ranks: longest path from the dependencies; sources (variables, …) are
 *    then pulled right next to their first consumer so edges stay short.
 * 2. Edges spanning several columns get a virtual node in every column they
 *    cross: that reserves a lane between the boxes, so no edge crosses a node.
 * 3. Order inside each column: barycenter sweeps down and up, keeping the
 *    order with the fewest crossings.
 * 4. Vertical position: each slot moves towards the mean of its neighbours
 *    (straighter edges) while keeping its order and spacing.
 * 5. Ports: the edges leaving/entering a node are spread along its side,
 *    sorted by where they go, so they don't start on top of each other.
 */

export interface LayoutInput {
  nodes: { id: string; kind: string }[];
  /** from depends on to: drawn as an arrow to → from. */
  edges: { from: string; to: string }[];
}

export interface PlacedNode {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
}

export interface RoutedEdge {
  from: string;
  to: string;
  d: string;
  /** Polyline of the route (without curve control points), for tests. */
  points: [number, number][];
}

export const NODE_H = 30;
const ROW_GAP = 14;
const LANE_GAP = 10;
const COL_GAP = 64;
const CHAR_W = 7.2;
const MARGIN = 16;

interface Slot {
  id: string;
  real: boolean;
  rank: number;
  size: number;
  up: string[];
  down: string[];
}

const nodeWidth = (id: string) => id.length * CHAR_W + 24;

function ranks(input: LayoutInput) {
  const deps = new Map<string, string[]>();
  const users = new Map<string, string[]>();
  for (const n of input.nodes) {
    deps.set(n.id, []);
    users.set(n.id, []);
  }
  for (const e of input.edges) {
    if (!deps.has(e.from) || !deps.has(e.to) || e.from === e.to) continue;
    deps.get(e.from)!.push(e.to);
    users.get(e.to)!.push(e.from);
  }
  const rank = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    let r = 0;
    for (const d of deps.get(id)!) r = Math.max(r, visit(d, stack) + 1);
    stack.delete(id);
    rank.set(id, r);
    return r;
  };
  input.nodes.forEach((n) => visit(n.id, new Set()));
  // Pull sources right, next to their closest consumer.
  for (const n of input.nodes) {
    const us = users.get(n.id)!;
    if (deps.get(n.id)!.length === 0 && us.length) {
      rank.set(n.id, Math.max(rank.get(n.id)!, Math.min(...us.map((u) => rank.get(u)!)) - 1));
    }
  }
  // Drop empty columns.
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((r, i) => [r, i]));
  for (const [id, r] of rank) rank.set(id, remap.get(r)!);
  return rank;
}

function crossings(layers: string[][], slots: Map<string, Slot>) {
  let total = 0;
  for (let r = 0; r + 1 < layers.length; r++) {
    const pos = new Map(layers[r + 1].map((id, i) => [id, i]));
    const segs: [number, number][] = [];
    layers[r].forEach((id, i) => slots.get(id)!.down.forEach((d) => segs.push([i, pos.get(d)!])));
    for (let a = 0; a < segs.length; a++) {
      for (let b = a + 1; b < segs.length; b++) {
        if ((segs[a][0] - segs[b][0]) * (segs[a][1] - segs[b][1]) < 0) total++;
      }
    }
  }
  return total;
}

/** 1-D placement: centres as close as possible to `want`, in order, at least `gap[i]` apart (pool adjacent violators). */
function place(want: number[], gap: number[]): number[] {
  const off = [0];
  for (let i = 1; i < want.length; i++) off[i] = off[i - 1] + gap[i - 1];
  const blocks: { sum: number; n: number }[] = [];
  want.forEach((v, i) => {
    blocks.push({ sum: v - off[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n + off[out.length]);
  return out;
}

export function layoutGraph(input: LayoutInput) {
  const rank = ranks(input);
  const kind = new Map(input.nodes.map((n) => [n.id, n.kind]));
  const slots = new Map<string, Slot>();
  for (const n of input.nodes) slots.set(n.id, { id: n.id, real: true, rank: rank.get(n.id)!, size: NODE_H, up: [], down: [] });

  // Chains of slots, left (dependency) to right (dependent).
  const chains: { from: string; to: string; path: string[] }[] = [];
  const back: { from: string; to: string }[] = [];
  input.edges.forEach((e, i) => {
    if (!slots.has(e.from) || !slots.has(e.to) || e.from === e.to) return;
    const r0 = rank.get(e.to)!;
    const r1 = rank.get(e.from)!;
    if (r1 <= r0) {
      back.push(e);
      return;
    }
    const path = [e.to];
    for (let r = r0 + 1; r < r1; r++) {
      const id = `\u0000${i}:${r}`;
      slots.set(id, { id, real: false, rank: r, size: 0, up: [], down: [] });
      path.push(id);
    }
    path.push(e.from);
    for (let k = 0; k + 1 < path.length; k++) {
      slots.get(path[k])!.down.push(path[k + 1]);
      slots.get(path[k + 1])!.up.push(path[k]);
    }
    chains.push({ from: e.from, to: e.to, path });
  });

  const layers: string[][] = [];
  for (const s of slots.values()) (layers[s.rank] = layers[s.rank] || []).push(s.id);
  for (let r = 0; r < layers.length; r++) layers[r] = layers[r] || [];

  // Initial order: first column by name, then by barycenter of the column on the left.
  const idx = new Map<string, number>();
  const index = (r: number) => layers[r].forEach((id, i) => idx.set(id, i));
  const sortBy = (r: number, side: 'up' | 'down') => {
    const score = new Map(
      layers[r].map((id) => {
        const ns = slots.get(id)![side];
        return [id, ns.length ? ns.reduce((a, n) => a + idx.get(n)!, 0) / ns.length : idx.get(id)!];
      }),
    );
    layers[r].sort((a, b) => score.get(a)! - score.get(b)! || idx.get(a)! - idx.get(b)!);
    index(r);
  };
  layers[0].sort((a, b) => a.localeCompare(b));
  index(0);
  for (let r = 1; r < layers.length; r++) {
    layers[r].sort((a, b) => a.localeCompare(b));
    index(r);
    sortBy(r, 'up');
  }
  let best = layers.map((l) => [...l]);
  let bestCross = crossings(layers, slots);
  for (let it = 0; it < 12 && bestCross > 0; it++) {
    if (it % 2 === 0) for (let r = layers.length - 2; r >= 0; r--) sortBy(r, 'down');
    else for (let r = 1; r < layers.length; r++) sortBy(r, 'up');
    const c = crossings(layers, slots);
    if (c < bestCross) {
      bestCross = c;
      best = layers.map((l) => [...l]);
    }
  }
  best.forEach((l, r) => {
    layers[r] = l;
    index(r);
  });

  // Vertical positions (centres).
  const gapsOf = (layer: string[]) =>
    layer.slice(1).map((id, i) => {
      const a = slots.get(layer[i])!;
      const b = slots.get(id)!;
      return (a.size + b.size) / 2 + (a.real && b.real ? ROW_GAP : LANE_GAP);
    });
  const cy = new Map<string, number>();
  for (const layer of layers) {
    const gaps = gapsOf(layer);
    let y = 0;
    layer.forEach((id, i) => {
      if (i) y += gaps[i - 1];
      cy.set(id, y);
    });
  }
  for (let it = 0; it < 24; it++) {
    const order = it % 2 === 0 ? layers.map((_, r) => r) : layers.map((_, r) => layers.length - 1 - r);
    for (const r of order) {
      const layer = layers[r];
      const want = layer.map((id) => {
        const s = slots.get(id)!;
        const ns = [...s.up, ...s.down];
        return ns.length ? ns.reduce((a, n) => a + cy.get(n)!, 0) / ns.length : cy.get(id)!;
      });
      place(want, gapsOf(layer)).forEach((y, i) => cy.set(layer[i], y));
    }
  }
  let minTop = Infinity;
  for (const s of slots.values()) minTop = Math.min(minTop, cy.get(s.id)! - s.size / 2);
  const shift = MARGIN - minTop;
  for (const [id, y] of cy) cy.set(id, y + shift);

  // Columns.
  const colX: number[] = [];
  const colW: number[] = [];
  let x = MARGIN;
  for (const layer of layers) {
    const w = Math.max(24, ...layer.filter((id) => slots.get(id)!.real).map(nodeWidth));
    colX.push(x);
    colW.push(w);
    x += w + COL_GAP;
  }

  const placed = new Map<string, PlacedNode>();
  let height = 0;
  for (const s of slots.values()) {
    height = Math.max(height, cy.get(s.id)! + s.size / 2 + MARGIN);
    if (s.real) placed.set(s.id, { id: s.id, kind: kind.get(s.id)!, x: colX[s.rank], y: cy.get(s.id)! - NODE_H / 2, w: nodeWidth(s.id) });
  }

  // Ports: spread along the side, ordered by the other end.
  const port = new Map<string, number>(); // `${chainIndex}:out|in` -> y
  const spread = (id: string, list: { key: string; toward: number }[]) => {
    list.sort((a, b) => a.toward - b.toward);
    const top = placed.get(id)!.y;
    const span = Math.min(NODE_H - 10, (list.length - 1) * 6);
    list.forEach((p, k) => port.set(p.key, top + NODE_H / 2 - span / 2 + (list.length > 1 ? (span * k) / (list.length - 1) : 0)));
  };
  const outs = new Map<string, { key: string; toward: number }[]>();
  const ins = new Map<string, { key: string; toward: number }[]>();
  chains.forEach((c, i) => {
    const s = c.path[0];
    const t = c.path[c.path.length - 1];
    (outs.get(s) || outs.set(s, []).get(s)!).push({ key: `${i}:out`, toward: cy.get(c.path[1])! });
    (ins.get(t) || ins.set(t, []).get(t)!).push({ key: `${i}:in`, toward: cy.get(c.path[c.path.length - 2])! });
  });
  outs.forEach((l, id) => spread(id, l));
  ins.forEach((l, id) => spread(id, l));

  const fmt = (n: number) => Math.round(n * 10) / 10;
  const edges: RoutedEdge[] = chains.map((c, i) => {
    const s = slots.get(c.path[0])!;
    const t = slots.get(c.path[c.path.length - 1])!;
    const ys = port.get(`${i}:out`)!;
    const yt = port.get(`${i}:in`)!;
    // Leave through the right edge of the column so the curve never runs
    // over a wider box of the same column.
    const pts: [number, number][] = [
      [colX[s.rank] + nodeWidth(s.id), ys],
      [colX[s.rank] + colW[s.rank], ys],
    ];
    for (const id of c.path.slice(1, -1)) {
      const d = slots.get(id)!;
      pts.push([colX[d.rank], cy.get(id)!], [colX[d.rank] + colW[d.rank], cy.get(id)!]);
    }
    pts.push([colX[t.rank] - 2, yt]);
    let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
    for (let k = 1; k < pts.length; k++) {
      const [x2, y2] = pts[k];
      if (k % 2 === 1) d += ` L ${fmt(x2)} ${fmt(y2)}`;
      else {
        const [x1, y1] = pts[k - 1];
        const mx = (x1 + x2) / 2;
        d += ` C ${fmt(mx)} ${fmt(y1)}, ${fmt(mx)} ${fmt(y2)}, ${fmt(x2)} ${fmt(y2)}`;
      }
    }
    return { from: c.from, to: c.to, d, points: pts };
  });
  // Cycles should not happen in Terraform, but draw them anyway.
  for (const e of back) {
    const a = placed.get(e.to)!;
    const b = placed.get(e.from)!;
    const x1 = a.x + a.w;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x - 2;
    const y2 = b.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    edges.push({ from: e.from, to: e.to, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, points: [[x1, y1], [x2, y2]] });
  }

  return { placed, edges, width: x - COL_GAP + MARGIN, height, crossings: bestCross };
}
