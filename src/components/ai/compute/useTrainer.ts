/* The page's side of training: starts the Web Worker (or, if the browser has
 * none, runs the same Host on the page), forwards commands and hands every
 * tick to the demo. Also keeps the engine status, the measured speed and the
 * benchmark results for the compute panel. */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Host, type Backend, type BenchRow, type FromHost, type Perf, type ToHost } from './host';
import { makeTrainer } from './trainers';

export interface EngineStatus {
  backend: Backend;
  gpu: string | null;
  error?: string;
  /** Training runs in a Web Worker (false: on the page). */
  worker: boolean;
  pending: boolean;
  /** The engine being prepared while `pending`. */
  target?: Backend;
}

export type Tick = Extract<FromHost, { t: 'tick' }>;

export function useTrainer(demo: string, init: () => Record<string, unknown>, onTick: (t: Tick) => void) {
  const port = useRef<{ post: (m: ToHost) => void; close: () => void } | null>(null);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const [status, setStatus] = useState<EngineStatus>({ backend: 'cpu', gpu: null, worker: true, pending: false });
  const [perf, setPerf] = useState<Perf>({ rate: 0, msPerStep: 0 });
  const [bench, setBench] = useState<{ rows: BenchRow[]; running: boolean }>({ rows: [], running: false });

  useEffect(() => {
    const receive = (m: FromHost) => {
      if (m.t === 'tick') {
        if (m.perf.rate) setPerf(m.perf);
        tickRef.current(m);
      } else if (m.t === 'compute') setStatus((s) => ({ ...s, backend: m.backend, gpu: m.gpu, error: m.error, pending: false }));
      else if (m.t === 'bench') setBench((b) => ({ rows: m.row ? [...b.rows.filter((r) => !(r.size === m.row!.size && r.backend === m.row!.backend)), m.row] : b.rows, running: !m.done }));
      else if (m.t === 'error') console.error('[entrenamiento]', m.message);
    };
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<FromHost>) => receive(e.data);
      const w = worker;
      port.current = { post: (m) => w.postMessage(m), close: () => w.terminate() };
    } catch {
      // No workers here: the same loop, on the page.
      const host = new Host((m) => setTimeout(() => receive(m), 0), makeTrainer);
      port.current = { post: (m) => host.handle(structuredClone(m)), close: () => host.handle({ t: 'speed', speed: 0 }) };
      setStatus((s) => ({ ...s, worker: false }));
    }
    port.current.post({ t: 'init', demo, state: init() });
    return () => port.current?.close();
    // The demo kind never changes for a mounted component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((m: ToHost) => port.current?.post(m), []);
  const setCompute = useCallback(
    (backend: Backend, batch: number) => {
      setStatus((s) => ({ ...s, pending: true, target: backend }));
      send({ t: 'compute', compute: { backend, batch } });
    },
    [send],
  );
  const runBench = useCallback(
    (sizes: number[], batch: number, backends: Backend[]) => {
      setBench({ rows: [], running: true });
      send({ t: 'bench', sizes, batch, backends });
    },
    [send],
  );

  return { send, status, perf, bench, setCompute, runBench, stopBench: () => send({ t: 'benchStop' }) };
}
