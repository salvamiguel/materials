import { describe, expect, test } from 'bun:test';
import { layoutGraph, NODE_H, type LayoutInput } from './graphLayout';

// Samples every edge (lines and the cubic curves between columns) and checks
// that no sample falls inside a node box.
function throughBoxes(input: LayoutInput) {
  const { placed, edges } = layoutGraph(input);
  const boxes = [...placed.values()];
  const hits: string[] = [];
  for (const e of edges) {
    const p = e.points;
    const samples: [number, number][] = [];
    for (let k = 1; k < p.length; k++) {
      const [x1, y1] = p[k - 1];
      const [x2, y2] = p[k];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        if (k % 2 === 1) samples.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
        else {
          const u = 1 - t;
          const mx = (x1 + x2) / 2;
          samples.push([u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2, u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2]);
        }
      }
    }
    for (const b of boxes) {
      if (samples.some(([x, y]) => x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + NODE_H - 1)) hits.push(`${e.to} -> ${e.from} crosses ${b.id}`);
    }
  }
  return hits;
}

// The "gcp" example from the screenshot.
const GCP: LayoutInput = {
  nodes: [
    'var.entorno', 'var.proyecto', 'var.puertos', 'var.rango', 'provider.google',
    'google_compute_network.vpc', 'google_service_account.vm', 'google_storage_bucket.estaticos',
    'google_compute_firewall.web', 'google_project_iam_member.logs', 'google_compute_subnetwork.app',
    'google_compute_instance.web', 'output.ip_publica', 'output.cuenta_servicio', 'output.bucket',
  ].map((id) => ({ id, kind: id.split('.')[0].replace('var', 'variable').replace(/^google_.*/, 'resource') })),
  edges: [
    ['provider.google', 'var.proyecto'],
    ...['google_compute_network.vpc', 'google_service_account.vm', 'google_storage_bucket.estaticos', 'google_compute_firewall.web', 'google_project_iam_member.logs', 'google_compute_subnetwork.app', 'google_compute_instance.web'].map((r) => [r, 'provider.google']),
    ['google_compute_network.vpc', 'var.entorno'],
    ['google_service_account.vm', 'var.entorno'],
    ['google_storage_bucket.estaticos', 'var.entorno'],
    ['google_storage_bucket.estaticos', 'var.proyecto'],
    ['google_compute_firewall.web', 'google_compute_network.vpc'],
    ['google_compute_firewall.web', 'var.puertos'],
    ['google_compute_firewall.web', 'var.entorno'],
    ['google_project_iam_member.logs', 'google_service_account.vm'],
    ['google_project_iam_member.logs', 'var.proyecto'],
    ['google_compute_subnetwork.app', 'google_compute_network.vpc'],
    ['google_compute_subnetwork.app', 'var.rango'],
    ['google_compute_subnetwork.app', 'var.entorno'],
    ['google_compute_instance.web', 'google_compute_subnetwork.app'],
    ['google_compute_instance.web', 'google_service_account.vm'],
    ['google_compute_instance.web', 'var.entorno'],
    ['output.ip_publica', 'google_compute_instance.web'],
    ['output.cuenta_servicio', 'google_service_account.vm'],
    ['output.bucket', 'google_storage_bucket.estaticos'],
  ].map(([from, to]) => ({ from, to })),
};

function randomDag(seed: number, n: number): LayoutInput {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}.${'x'.repeat(Math.floor(rnd() * 20))}`, kind: 'resource' }));
  const edges: LayoutInput['edges'] = [];
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) if (rnd() < 2.2 / i) edges.push({ from: nodes[i].id, to: nodes[j].id });
  }
  return { nodes, edges };
}

describe('graph layout', () => {
  test('no edge runs through a node (gcp example)', () => {
    expect(throughBoxes(GCP)).toEqual([]);
  });

  test('no edge runs through a node (random graphs)', () => {
    for (let seed = 1; seed <= 200; seed++) expect(throughBoxes(randomDag(seed, 6 + (seed % 30)))).toEqual([]);
  });

  test('nodes in a column never overlap', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { placed } = layoutGraph(randomDag(seed, 25));
      const byX = new Map<number, number[]>();
      for (const p of placed.values()) byX.set(p.x, [...(byX.get(p.x) || []), p.y]);
      for (const ys of byX.values()) {
        ys.sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(NODE_H);
      }
    }
  });

  test('every edge goes left to right and sources sit next to their first consumer', () => {
    const { placed, edges } = layoutGraph(GCP);
    for (const e of edges) expect(placed.get(e.to)!.x).toBeLessThan(placed.get(e.from)!.x);
    // var.rango is only used by the subnetwork: it must be in the column right before it.
    const cols = [...new Set([...placed.values()].map((p) => p.x))].sort((a, b) => a - b);
    const col = (id: string) => cols.indexOf(placed.get(id)!.x);
    expect(col('var.rango')).toBe(col('google_compute_subnetwork.app') - 1);
  });
});
