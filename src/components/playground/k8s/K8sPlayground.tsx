import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { SiKubernetes } from 'react-icons/si';
import { IoLink } from 'react-icons/io5';
import { MdSettingsBackupRestore } from 'react-icons/md';
import { TbPlayerPauseFilled, TbPlayerPlayFilled, TbHelp, TbSquareRoundedX } from 'react-icons/tb';
import HclEditor from '../terraform/HclEditor';
import Terminal, { type TermEntry } from '../shared/Terminal';
import ZoomControl, { usePlaygroundZoom, zoomStyle } from '../shared/Zoom';
import { decodeShare, encodeShare } from '../shared/share';
import { fetchRepoFiles, parseRepoQuery, repoLabel } from '../terraform/github';
import { Cluster } from './engine/cluster';
import { runLine, SHELL_HELP, type ShellCtx } from './engine/shell';
import type { Stream } from './engine/kubectl/streams';
import { podExec, podPrompt, type PodShell } from './engine/podshell';
import { parseQuantity } from './engine/util';
import type { FaultKind, Obj } from './engine/types';
import ClusterDiagram from './ClusterDiagram';
import ContextMenu from './ContextMenu';
import { buildDiagram, buildNodesView } from './diagramModel';
import { infoFor, menuFor, nodeMenu, type MenuItem } from './info';
import { colorizeKubectl, highlightK8s } from './highlight';
import { completeLine } from './complete';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples';
import { K8splayWasm } from './wasm';
import { helmCommand, kustomizeDocs } from './helm';
import shared from '../shared/playground.module.css';
import styles from './k8s.module.css';

const STORAGE = 'k8splay:v1:';
const SPEEDS = [1, 2, 5, 20];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(STORAGE + key, JSON.stringify(value));
  } catch {
    // private mode / quota: the playground still works, it just forgets
  }
}

function freshCluster() {
  return Cluster.create(Math.floor(Date.now() / 1000) * 1000, (Math.random() * 2 ** 31) | 0);
}

function loadCluster(): Cluster {
  try {
    const raw = localStorage.getItem(STORAGE + 'cluster');
    if (raw) return Cluster.fromJSON(raw);
  } catch {
    // corrupted: start again
  }
  return freshCluster();
}

/** Line range of the YAML document that starts at `line`. */
function docLines(text: string, line: number): number {
  const lines = text.split('\n');
  let n = 0;
  for (let i = line - 1; i < lines.length; i++) {
    if (i > line - 1 && /^---/.test(lines[i])) break;
    n++;
  }
  while (n > 1 && !lines[line - 2 + n]?.trim()) n--;
  return Math.max(1, n);
}

export function isK8sFile(path: string): boolean {
  if (path.split('/').some((p) => p.startsWith('.') && p !== '.helmignore')) return false;
  if (/(^|\/)\.helmignore$/.test(path)) return true;
  if (/(^|\/)(\.github|node_modules)\//.test(path)) return false;
  return /\.(ya?ml|tpl)$/.test(path) || /(^|\/)templates\/NOTES\.txt$/.test(path) || /\.env$/.test(path);
}

const WELCOME = `Kubernetes playground: un clúster simulado (kind, 3 nodos, Kubernetes v1.33) que vive en tu navegador.
Escribe "help" o empieza por: kubectl apply -f web.yaml
El diagrama de la derecha se actualiza solo. Pasa el ratón por encima de un recurso, haz clic
para ver su manifiesto o usa el botón derecho para borrarlo o simular fallos.`;

type Job = { id: number; line: string; stream: Stream };

export default function K8sPlayground() {
  const iconBase = useBaseUrl('/k8splay/icons/');
  const wasmBase = useBaseUrl('/k8splay/');
  const zoom = usePlaygroundZoom();

  const clRef = useRef<Cluster | null>(null);
  if (!clRef.current) clRef.current = loadCluster();
  const [, setTick] = useState(0);
  const [rv, setRv] = useState(0);

  const [files, setFiles] = useState<Record<string, string>>(() => load('files', DEFAULT_EXAMPLE.files));
  const [active, setActive] = useState<string>(() => load('active', Object.keys(DEFAULT_EXAMPLE.files)[0]));
  const [exampleId, setExampleId] = useState<string>(() => load('example', DEFAULT_EXAMPLE.id));
  const [speed, setSpeed] = useState<number>(() => load('speed', 1));
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<'apps' | 'nodes'>(() => load('view', 'apps'));
  const [showSystem, setShowSystem] = useState<boolean>(() => load('system', false));
  const [split, setSplit] = useState<number>(() => load('split', 38));
  const [termH, setTermH] = useState<number>(() => load('termH', 280));

  const [entries, setEntries] = useState<TermEntry[]>([{ id: 0, prompt: '', command: undefined as unknown as string, output: WELCOME }]);
  const [busy, setBusy] = useState(false);
  const [shell, setShell] = useState<(PodShell & { rm?: boolean }) | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [menu, setMenu] = useState<{ x: number; y: number; uid: string; target: 'object' | 'node' } | null>(null);
  const [reveal, setReveal] = useState<{ line: number; lines: number; seq: number } | undefined>();
  const [shareMsg, setShareMsg] = useState('');
  const [help, setHelp] = useState(false);
  const [wasmStatus, setWasmStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [insert, setInsert] = useState<{ text: string; seq: number } | undefined>();

  const seq = useRef(1);
  const fg = useRef<{ id: number; stream: Stream } | null>(null);
  const jobsRef = useRef<Job[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const wasmRef = useRef<K8splayWasm | null>(null);
  const cl = clRef.current;

  useEffect(() => save('files', files), [files]);
  useEffect(() => save('active', active), [active]);
  useEffect(() => save('example', exampleId), [exampleId]);
  useEffect(() => save('speed', speed), [speed]);
  useEffect(() => save('view', view), [view]);
  useEffect(() => save('system', showSystem), [showSystem]);
  useEffect(() => save('split', split), [split]);
  useEffect(() => save('termH', termH), [termH]);

  // The Go/WASM engine (helm, kustomize) loads on first use.
  const wasm = useCallback(async () => {
    if (!wasmRef.current) {
      setWasmStatus('loading');
      wasmRef.current = new K8splayWasm(wasmBase);
      wasmRef.current.ready.then(
        () => setWasmStatus('ready'),
        () => setWasmStatus('error'),
      );
    }
    await wasmRef.current.ready;
    return wasmRef.current;
  }, [wasmBase]);
  useEffect(() => () => wasmRef.current?.terminate(), []);

  const appendOutput = useCallback((id: number, text: string, done?: { exitCode?: number }) => {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, output: e.output + text, pending: false, ...(done ? { exitCode: done.exitCode } : {}) } : e)));
  }, []);

  const addEntry = useCallback((command: string | undefined, output: string, prompt = '$ ') => {
    const id = seq.current++;
    setEntries((e) => [...e.slice(-300), { id, prompt, command: command as string, output }]);
    return id;
  }, []);

  // Clock: advance the cluster and feed running commands.
  useEffect(() => {
    let lastRv = -1;
    let saveAt = 0;
    const t = setInterval(() => {
      const c = clRef.current!;
      if (!paused) c.advance(250 * speed);
      const f = fg.current;
      if (f) {
        const p = f.stream.poll(c);
        if (p.text) appendOutput(f.id, p.text);
        if (p.done) {
          fg.current = null;
          appendOutput(f.id, '', { exitCode: p.exitCode });
          setBusy(false);
          if (p.shell) setShell(p.shell);
        }
      }
      if (jobsRef.current.length) {
        const left: Job[] = [];
        for (const j of jobsRef.current) {
          const p = j.stream.poll(c);
          if (p.done)
            addEntry(undefined, `[${j.id}]+  ${p.exitCode ? `Exit ${p.exitCode}` : 'Done'}                    ${j.line}${p.text ? `\n${p.text}` : ''}`);
          else left.push(j);
        }
        if (left.length !== jobsRef.current.length) {
          jobsRef.current = left;
          setJobs(left);
        }
      }
      if (c.s.rv !== lastRv) {
        lastRv = c.s.rv;
        setRv(c.s.rv);
      }
      setTick((n) => n + 1);
      if (Date.now() - saveAt > 3000) {
        saveAt = Date.now();
        try {
          localStorage.setItem(STORAGE + 'cluster', c.toJSON());
        } catch {
          // quota
        }
      }
    }, 250);
    return () => clearInterval(t);
  }, [paused, speed, appendOutput, addEntry]);

  const ctx = useCallback((): ShellCtx => {
    const c: ShellCtx = {
      cl: clRef.current!,
      files: filesRef.current,
      kustomize: async (dir: string) => kustomizeDocs(await wasm(), filesRef.current, dir),
      helm: async (args, sctx) => helmCommand(args, sctx, await wasm()),
    };
    return c;
  }, [wasm]);

  const openSource = useCallback((uid: string) => {
    const c = clRef.current!;
    const o = c.byUid(uid);
    if (!o) return;
    const src = c.sourceOf(o);
    if (!src) return;
    const text = filesRef.current[src.source.file];
    if (text === undefined) return;
    setActive(src.source.file);
    setReveal({ line: src.source.line, lines: docLines(text, src.source.line), seq: seq.current++ });
  }, []);

  const select = useCallback(
    (uid: string | undefined) => {
      setSelected(uid);
      if (uid) openSource(uid);
    },
    [openSource],
  );

  const runCommand = useCallback(
    async (line: string) => {
      const c = clRef.current!;
      if (shell) {
        const prompt = podPrompt(shell);
        if (line.trim() === 'exit' || line.trim() === 'logout') {
          addEntry(line, shell.rm ? `pod "${shell.pod.metadata.name}" deleted\n` : '', prompt);
          if (shell.rm) {
            const p = c.get('Pod', shell.pod.metadata.namespace, shell.pod.metadata.name);
            if (p) c.deleteObject(p, { gracePeriod: 0, force: true });
          }
          setShell(null);
          return;
        }
        if (!c.get('Pod', shell.pod.metadata.namespace, shell.pod.metadata.name)) {
          addEntry(line, 'command terminated with exit code 137\n', prompt);
          setShell(null);
          return;
        }
        const r = podExec(c, shell, line);
        addEntry(line, r.output, prompt);
        if (r.exit) setShell(null);
        return;
      }
      const trimmed = line.trim();
      if (trimmed === 'clear') {
        setEntries([]);
        return;
      }
      if (trimmed === 'jobs') {
        addEntry(line, jobsRef.current.map((j) => `[${j.id}]+  Running                 ${j.line} &`).join('\n') + (jobsRef.current.length ? '\n' : ''));
        return;
      }
      const km = /^kill\s+%?(\d+)$/.exec(trimmed);
      if (km || trimmed === 'fg') {
        const j = km ? jobsRef.current.find((x) => x.id === parseInt(km[1], 10)) : jobsRef.current[jobsRef.current.length - 1];
        if (!j) {
          addEntry(line, `bash: kill: %${km?.[1] ?? ''}: no such job\n`);
          return;
        }
        j.stream.stop(c);
        jobsRef.current = jobsRef.current.filter((x) => x !== j);
        setJobs(jobsRef.current);
        addEntry(line, `[${j.id}]+  Terminated              ${j.line}\n`);
        return;
      }
      const id = addEntry(trimmed, '', '$ ');
      setEntries((es) => es.map((e) => (e.id === id ? { ...e, pending: true } : e)));
      setBusy(true);
      let r;
      try {
        r = await runLine(trimmed, ctx());
      } catch (err) {
        r = { output: `error: ${(err as Error).message}\n`, exitCode: 1 };
      }
      if (r.clear) {
        setEntries([]);
        setBusy(false);
        return;
      }
      if (r.writeFiles) {
        setFiles((f) => ({ ...f, ...r!.writeFiles }));
        if (r.openFile) setActive(r.openFile);
      }
      if (r.stream && r.stream.background) {
        const jid = (jobsRef.current[jobsRef.current.length - 1]?.id ?? 0) + 1;
        jobsRef.current = [...jobsRef.current, { id: jid, line: trimmed.replace(/\s*&$/, ''), stream: r.stream }];
        setJobs(jobsRef.current);
        appendOutput(id, `[${jid}] ${4000 + jid * 17}\n${r.output}`, { exitCode: 0 });
        setBusy(false);
      } else if (r.stream) {
        appendOutput(id, r.output);
        fg.current = { id, stream: r.stream };
      } else {
        appendOutput(id, r.output, { exitCode: r.exitCode });
        setBusy(false);
      }
      if (r.shell) setShell(r.shell);
      setRv(c.s.rv);
    },
    [shell, addEntry, appendOutput, ctx],
  );

  const interrupt = useCallback(() => {
    const f = fg.current;
    if (f) {
      fg.current = null;
      appendOutput(f.id, f.stream.stop(clRef.current!), { exitCode: 130 });
      setBusy(false);
    } else {
      addEntry('', '^C\n', shell ? podPrompt(shell) : '$ ');
    }
  }, [appendOutput, addEntry, shell]);

  // Shared links and repositories.
  useEffect(() => {
    const m = /^#code=(.+)$/.exec(window.location.hash);
    if (m) {
      decodeShare(m[1]).then(
        (shared) => {
          setFiles(shared);
          setActive(Object.keys(shared)[0]);
          setExampleId('');
          history.replaceState(null, '', window.location.pathname + window.location.search);
          addEntry(undefined, 'Ficheros cargados desde un enlace compartido.');
        },
        () => addEntry(undefined, 'Error: el enlace compartido no es válido.'),
      );
    }
    const url = new URL(window.location.href);
    const ex = url.searchParams.get('example');
    if (ex) {
      url.searchParams.delete('example');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      const e = EXAMPLES.find((x) => x.id === ex);
      if (e) {
        setFiles(e.files);
        setActive(Object.keys(e.files)[0]);
        setExampleId(e.id);
        addEntry(undefined, `Ejemplo: ${e.label}. ${e.description}${e.hint ? `\nPrueba: ${e.hint}` : ''}`);
        if (e.hint) setInsert({ text: e.hint, seq: seq.current++ });
      }
    }
    if (url.searchParams.has('repo')) {
      const r = parseRepoQuery(window.location.search);
      ['repo', 'ref', 'path'].forEach((k) => url.searchParams.delete(k));
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      if (!r) {
        addEntry(undefined, 'Error: el parámetro "repo" no es válido (usa ?repo=usuario/repositorio).');
        return;
      }
      const label = repoLabel(r);
      addEntry(undefined, `Descargando los manifiestos de github.com/${label}…`);
      fetchRepoFiles(r, undefined, isK8sFile, 'manifiestos YAML').then(
        (repoFiles) => {
          const names = Object.keys(repoFiles).sort();
          setFiles(repoFiles);
          setActive(names.find((f) => !f.includes('/')) || names[0]);
          setExampleId(`gh:${label}`);
          const hasK = names.some((n) => /(^|\/)kustomization\.ya?ml$/.test(n));
          const hasChart = names.some((n) => /(^|\/)Chart\.yaml$/.test(n));
          addEntry(
            undefined,
            `Cargado github.com/${label}: ${names.length} ficheros.\n${hasChart ? 'Contiene un chart de Helm: helm install <nombre> ./<carpeta>\n' : ''}${hasK ? 'Contiene kustomizations: kubectl apply -k <carpeta>\n' : ''}Para manifiestos sueltos: kubectl apply -f <fichero>`,
          );
        },
        (err) => addEntry(undefined, `Error: ${(err as Error).message}\nPuedes abrir el repositorio en GitHub y copiar los ficheros a mano.`),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileNames = useMemo(
    () =>
      Object.keys(files).sort((a, b) => {
        const rank = (n: string) => (n.startsWith('.kubectl-edit/') ? 3 : n.includes('/') ? 1 : 0);
        return rank(a) - rank(b) || a.localeCompare(b);
      }),
    [files],
  );
  const current = files[active] !== undefined ? active : fileNames[0];

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setFiles(ex.files);
    setActive(Object.keys(ex.files)[0]);
    setExampleId(ex.id);
    setSelected(undefined);
    addEntry(
      undefined,
      `Ejemplo: ${ex.label}. ${ex.description}${ex.hint ? `\nPrueba: ${ex.hint}` : ''}\n(Los recursos que ya había en el clúster siguen ahí: "Reiniciar clúster" lo deja vacío.)`,
    );
    if (ex.hint) setInsert({ text: ex.hint, seq: seq.current++ });
  };

  const addFile = () => {
    const name = window.prompt('Nombre del fichero (p. ej. service.yaml, overlays/dev/kustomization.yaml o chart/values.yaml):');
    if (!name) return;
    const clean = name.trim().replace(/^\.\//, '');
    if (!clean || files[clean] !== undefined) return;
    setFiles((f) => ({ ...f, [clean]: '' }));
    setActive(clean);
  };

  const removeFile = (name: string) => {
    if (!window.confirm(`¿Borrar ${name}? (los recursos que creó siguen en el clúster)`)) return;
    setFiles((f) => {
      const next = { ...f };
      delete next[name];
      return next;
    });
  };

  const renameFile = (name: string) => {
    const next = window.prompt('Nuevo nombre:', name);
    if (!next || next === name || files[next] !== undefined) return;
    setFiles((f) => {
      const copy: Record<string, string> = {};
      for (const [k, v] of Object.entries(f)) copy[k === name ? next : k] = v;
      return copy;
    });
    setActive(next);
  };

  const share = async () => {
    try {
      const code = await encodeShare(files);
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#code=${code}`);
      setShareMsg('Enlace copiado');
    } catch {
      setShareMsg('No se pudo copiar');
    }
    setTimeout(() => setShareMsg(''), 2500);
  };

  const resetCluster = () => {
    if (!window.confirm('Se borrará todo lo que hay en el clúster (tus ficheros se mantienen). ¿Continuar?')) return;
    fg.current = null;
    for (const j of jobsRef.current) j.stream.stop(clRef.current!);
    jobsRef.current = [];
    setJobs([]);
    setBusy(false);
    setShell(null);
    clRef.current = freshCluster();
    setSelected(undefined);
    addEntry(undefined, 'Clúster nuevo: 3 nodos, sin nada desplegado.');
  };

  // Context menu actions.
  const pick = (item: MenuItem) => {
    const m = menu;
    setMenu(null);
    if (!m) return;
    const c = clRef.current!;
    const o = c.byUid(m.uid);
    if (!o) return;
    if (item.cmd) {
      runCommand(item.cmd);
      return;
    }
    const note = (text: string) => addEntry(undefined, `# ${text}`);
    switch (item.action) {
      case 'open':
        openSource(m.uid);
        break;
      case 'fault':
        c.s.faults[m.uid] = item.fault as FaultKind;
        note(
          `Fallo simulado en ${o.kind}/${o.metadata.name}: ${item.label.toLowerCase()}. No es un comando de kubectl: en la vida real sería un bug, un OOM o una dependencia caída. Observa cómo reacciona Kubernetes.`,
        );
        break;
      case 'heal':
        delete c.s.faults[m.uid];
        note(`${o.kind}/${o.metadata.name} vuelve a estar sano.`);
        break;
      case 'load': {
        const level = item.load || 0;
        if (!level) {
          delete c.s.load[m.uid];
          note(`Sin carga de CPU en ${o.kind}/${o.metadata.name}.`);
        } else {
          const tpl = o.spec?.template?.spec;
          const req = (tpl?.containers || []).reduce((n: number, x: Obj) => n + (parseQuantity(x.resources?.requests?.cpu) || 0), 0) || 0.1;
          const reps = Math.max(1, o.spec?.replicas ?? 1);
          c.s.load[m.uid] = level * 1.5 * req * reps;
          note(
            `Carga de CPU simulada en ${o.kind}/${o.metadata.name}: ≈${Math.round(level * 150)} % de lo que piden sus pods. Mira "kubectl top pods" y "kubectl get hpa -w".`,
          );
        }
        break;
      }
      case 'node-down':
        c.s.downNodes[m.uid] = c.now;
        note(
          `Nodo ${o.metadata.name} apagado: el kubelet deja de responder. A los 20 s simulados (en un clúster real, 5 minutos) sus pods se desalojan y los controladores los recrean en otros nodos.`,
        );
        break;
      case 'node-up':
        delete c.s.downNodes[m.uid];
        note(`Nodo ${o.metadata.name} encendido de nuevo.`);
        break;
    }
    setRv(c.s.rv + 1);
  };

  // Splitters.
  const dragV = (e: React.PointerEvent) => {
    const el = (e.currentTarget as HTMLElement).parentElement!;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(75, Math.max(22, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dragH = (e: React.PointerEvent) => {
    const el = (e.currentTarget as HTMLElement).parentElement!;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => setTermH(Math.min(rect.height - 200, Math.max(120, rect.bottom - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const diagram = useMemo(
    () => (view === 'nodes' ? buildNodesView(cl, { showSystem }) : buildDiagram(cl, { showSystem })),
    // rv changes whenever the cluster does; the clock alone doesn't need a new layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rv, view, showSystem, cl],
  );
  const info = useCallback((uid: string) => {
    const o = clRef.current!.byUid(uid);
    return o ? infoFor(clRef.current!, o) : undefined;
  }, []);

  const menuObj = menu ? cl.byUid(menu.uid) : undefined;
  const menuItems = menuObj ? (menu!.target === 'node' ? nodeMenu(cl, menuObj) : menuFor(cl, menuObj)) : [];

  const activeDir = current?.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
  const chartDir = (() => {
    let d = activeDir;
    for (;;) {
      if (files[`${d ? d + '/' : ''}Chart.yaml`] !== undefined) return d;
      if (!d) return undefined;
      d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    }
  })();
  const kustomizeDir = files[`${activeDir ? activeDir + '/' : ''}kustomization.yaml`] !== undefined ? activeDir || '.' : undefined;
  const applyCmd =
    chartDir !== undefined
      ? `helm upgrade --install ${chartDir.split('/').pop() || 'app'} ./${chartDir}`
      : kustomizeDir
        ? `kubectl apply -k ${kustomizeDir}`
        : current && /\.(ya?ml|json)$/.test(current)
          ? `kubectl apply -f ${current}`
          : undefined;
  const docCount = current ? (files[current] || '').split(/^---\s*$/m).filter((d) => /\bkind:/.test(d)).length : 0;
  const simTime = new Date(cl.now).toISOString().slice(11, 19);

  return (
    <div className={`${shared.playground} ${styles.root}`} style={zoomStyle(zoom.zoom)}>
      <div className={shared.topbar}>
        <div className={shared.titleBlock}>
          <h1 className={shared.title}>
            <SiKubernetes className={`${shared.titleIcon} ${styles.titleIconK8s}`} aria-hidden />
            Kubernetes playground
          </h1>
          <span className={`${shared.status} ${wasmStatus === 'error' ? shared.statusErr : shared.statusOk}`}>
            {wasmStatus === 'loading'
              ? 'Cargando helm y kustomize…'
              : wasmStatus === 'error'
                ? 'helm/kustomize no disponibles'
                : 'Clúster simulado · 100 % en el navegador'}
          </span>
        </div>
        <div className={shared.topActions}>
          <ZoomControl {...zoom} />
          <label className={shared.exampleLabel}>
            Ejemplo
            <select value={exampleId} onChange={(e) => loadExample(e.target.value)} className={shared.select}>
              {!EXAMPLES.some((e) => e.id === exampleId) && (
                <option value={exampleId}>{exampleId.startsWith('gh:') ? `GitHub: ${exampleId.slice(3)}` : 'Personalizado'}</option>
              )}
              {EXAMPLES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <button className={shared.btnGhost} onClick={share} title="Copia un enlace con todos los ficheros">
            <IoLink aria-hidden /> {shareMsg || 'Compartir'}
          </button>
          <button className={shared.btnGhost} onClick={resetCluster} title="Borra todo lo desplegado y arranca un clúster nuevo">
            <MdSettingsBackupRestore aria-hidden /> Reiniciar clúster
          </button>
          <button className={shared.btnGhost} onClick={() => setHelp(true)} title="Cómo funciona">
            <TbHelp aria-hidden /> Ayuda
          </button>
        </div>
      </div>

      <div className={styles.workspace} style={{ '--split': `${split}%`, '--term-h': `${termH}px` } as React.CSSProperties}>
        <section className={styles.editorArea} aria-label="Manifiestos">
          <div className={shared.tabs} role="tablist">
            {fileNames.map((name) => (
              <div
                key={name}
                role="tab"
                aria-selected={name === current}
                className={`${shared.tab} ${name === current ? shared.tabActive : ''}`}
                onClick={() => setActive(name)}
                onDoubleClick={() => renameFile(name)}
                title="Doble clic para renombrar"
              >
                <span>{name}</span>
                {fileNames.length > 1 && (
                  <button
                    className={shared.tabClose}
                    aria-label={`Borrar ${name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(name);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button className={shared.tabAdd} onClick={addFile} aria-label="Nuevo fichero" title="Nuevo fichero">
              +
            </button>
          </div>
          {current !== undefined && (
            <HclEditor
              filename={current}
              value={files[current] ?? ''}
              onChange={(v) => setFiles((f) => ({ ...f, [current]: v }))}
              diagnostics={[]}
              highlighter={highlightK8s}
              reveal={reveal}
            />
          )}
          <div className={shared.editorFooter}>
            <span>
              {chartDir !== undefined
                ? `chart de Helm (${chartDir || '.'})`
                : kustomizeDir
                  ? 'kustomization'
                  : docCount
                    ? `YAML · ${docCount} objeto${docCount === 1 ? '' : 's'}`
                    : 'YAML'}
            </span>
            {applyCmd && (
              <button className={shared.btnSmall} onClick={() => runCommand(applyCmd)} disabled={busy || !!shell} title={applyCmd}>
                {applyCmd.startsWith('helm') ? 'helm upgrade --install' : applyCmd.includes(' -k ') ? 'apply -k' : 'kubectl apply'}
              </button>
            )}
          </div>
        </section>

        <button
          type="button"
          className={styles.vsplit}
          aria-label="Redimensionar"
          onPointerDown={dragV}
          onKeyDown={(e) =>
            e.key === 'ArrowLeft' ? setSplit((s) => Math.max(22, s - 3)) : e.key === 'ArrowRight' ? setSplit((s) => Math.min(75, s + 3)) : null
          }
        />

        <section className={styles.diagramArea} aria-label="Diagrama del clúster">
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>
              <SiKubernetes aria-hidden className={styles.titleIconK8s} /> Clúster
            </span>
            <div className={styles.seg} role="group" aria-label="Vista">
              <button type="button" aria-pressed={view === 'apps'} onClick={() => setView('apps')}>
                Recursos
              </button>
              <button type="button" aria-pressed={view === 'nodes'} onClick={() => setView('nodes')}>
                Nodos
              </button>
            </div>
            <label className={styles.check} title="Muestra kube-system, ingress-nginx…">
              <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> sistema
            </label>
            <div className={styles.seg} role="group" aria-label="Reloj del clúster">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                title={paused ? 'Reanudar el tiempo' : 'Pausar el tiempo'}
                aria-label={paused ? 'Reanudar' : 'Pausar'}
              >
                {paused ? <TbPlayerPlayFilled aria-hidden /> : <TbPlayerPauseFilled aria-hidden />}
              </button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s && !paused}
                  onClick={() => {
                    setSpeed(s);
                    setPaused(false);
                  }}
                  title={`El tiempo del clúster va ${s} veces más rápido`}
                >
                  {s}x
                </button>
              ))}
            </div>
            <span className={styles.clock} title="Hora del clúster (UTC)">
              {simTime}
            </span>
          </div>
          <ClusterDiagram
            diagram={diagram}
            iconBase={iconBase}
            selected={selected}
            onSelect={select}
            onContextMenu={(uid, x, y, target) => setMenu({ uid, x, y, target })}
            info={info}
            onOpenSource={openSource}
            empty={
              <div className={styles.emptyState}>
                <p>
                  El clúster está vacío. Aplica un manifiesto:{' '}
                  <code>kubectl apply -f {Object.keys(files).find((f) => /\.ya?ml$/.test(f)) || 'fichero.yaml'}</code>
                </p>
              </div>
            }
          />
          <div className={styles.legend} aria-hidden>
            <span>
              <i className={styles.legendDot} style={{ background: 'var(--k-ok)' }} /> listo
            </span>
            <span>
              <i className={styles.legendDot} style={{ background: 'var(--k-warn)' }} /> en curso
            </span>
            <span>
              <i className={styles.legendDot} style={{ background: 'var(--k-err)' }} /> fallando
            </span>
            <span>
              <svg width="22" height="6">
                <line x1="0" y1="3" x2="22" y2="3" stroke="var(--k-edge)" strokeWidth="1.5" />
              </svg>
              controla
            </span>
            <span>
              <svg width="22" height="6">
                <line x1="0" y1="3" x2="22" y2="3" stroke="var(--k-select)" strokeWidth="1.5" strokeDasharray="4 3" />
              </svg>
              enruta tráfico
            </span>
            <span>
              <svg width="22" height="6">
                <line x1="0" y1="3" x2="22" y2="3" stroke="var(--k-config)" strokeWidth="1.5" strokeDasharray="2 3" />
              </svg>
              usa config/volumen
            </span>
          </div>
        </section>

        <button
          type="button"
          className={styles.hsplit}
          aria-label="Redimensionar la terminal"
          onPointerDown={dragH}
          onKeyDown={(e) => (e.key === 'ArrowUp' ? setTermH((h) => h + 30) : e.key === 'ArrowDown' ? setTermH((h) => Math.max(120, h - 30)) : null)}
        />

        <section className={styles.termArea} aria-label="Terminal">
          <div className={styles.panelHead}>
            <div className={styles.termButtons}>
              {[
                ['kubectl get all', 'get all'],
                ['kubectl get pods -o wide', 'get pods'],
                ['kubectl get events', 'events'],
                ['kubectl get pods -w', 'get pods -w'],
              ].map(([cmd, label]) => (
                <button key={cmd} className={shared.btnSmallGhost} disabled={busy || !!shell} onClick={() => runCommand(cmd)} title={cmd}>
                  {label}
                </button>
              ))}
              {busy && (
                <button className={shared.btnSmall} onClick={interrupt} title="Detener el comando (Ctrl+C)">
                  <TbSquareRoundedX aria-hidden /> Ctrl+C
                </button>
              )}
            </div>
            {jobs.length > 0 && (
              <div className={styles.jobs}>
                {jobs.map((j) => (
                  <span key={j.id} className={styles.job} title={j.line}>
                    [{j.id}] {j.line.length > 40 ? j.line.slice(0, 40) + '…' : j.line}
                    <button type="button" aria-label={`Detener ${j.line}`} onClick={() => runCommand(`kill %${j.id}`)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Terminal
            entries={entries}
            prompt={shell ? podPrompt(shell) : '$ '}
            busy={busy}
            onCommand={runCommand}
            onInterrupt={interrupt}
            complete={(input) => (shell ? undefined : completeLine(clRef.current!, filesRef.current, input))}
            colorize={colorizeKubectl}
            ariaLabel="Terminal del clúster"
            placeholder={shell ? 'exit para salir del contenedor' : 'kubectl get pods, kubectl apply -f …, helm install…'}
            insert={insert}
          />
        </section>
      </div>

      {menu && menuObj && (
        <ContextMenu x={menu.x} y={menu.y} title={`${menuObj.kind}/${menuObj.metadata.name}`} items={menuItems} onPick={pick} onClose={() => setMenu(null)} />
      )}

      {help && (
        <div className={styles.helpDialog} role="dialog" aria-modal="true" aria-label="Cómo funciona" onClick={() => setHelp(false)}>
          <div className={styles.helpBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.helpHead}>
              <h2>Cómo funciona</h2>
              <button className={shared.btnGhost} onClick={() => setHelp(false)}>
                Cerrar
              </button>
            </div>
            <HowItWorks />
          </div>
        </div>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <div className={styles.help}>
      <p>
        No hay ningún clúster real: un pequeño API server escrito en TypeScript guarda los objetos y unos controladores simulan lo que hacen los de Kubernetes
        (Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob, HPA, Endpoints, volúmenes…) cada cuarto de segundo. El reloj del clúster se puede pausar
        o acelerar.
      </p>
      <ul>
        <li>
          <b>Pods creíbles</b>: el kubelet simulado descarga imágenes, arranca contenedores, evalúa las sondas y reinicia con back-off (
          <code>CrashLoopBackOff</code>). Una imagen con una etiqueta que no existe (<code>nginx:no-existe</code>) acaba en <code>ImagePullBackOff</code>;
          postgres sin <code>POSTGRES_PASSWORD</code> se cae como el de verdad; un <code>busybox</code> sin comando termina enseguida.
        </li>
        <li>
          <b>Red</b>: los Services reparten el tráfico entre los pods listos. Desde la terminal (fuera del clúster) llega con{' '}
          <code>kubectl port-forward … &amp;</code> + <code>curl localhost:PUERTO</code>, con un Ingress (<code>curl http://host/</code>) o con
          NodePort/LoadBalancer. Dentro de un pod (<code>kubectl exec</code>, <code>kubectl run -it</code>) funciona el DNS del clúster.
        </li>
        <li>
          <b>Diagrama</b>: pasa el ratón por un recurso para ver sus datos; haz clic para fijarlos y abrir el fichero que lo declara; con el botón derecho
          puedes borrarlo, escalarlo, hacer rollout/undo o simular fallos (pod caído, degradado, OOM, carga de CPU, nodo apagado). La vista «Nodos» muestra en
          qué nodo corre cada pod.
        </li>
        <li>
          <b>Kustomize y Helm</b>: <code>kubectl apply -k</code>, <code>kubectl kustomize</code> y <code>helm</code> usan las librerías reales (kustomize y el
          motor de plantillas de Helm con sprig) compiladas a WebAssembly; se descargan la primera vez que las usas.
        </li>
        <li>
          <b>Repositorios</b>: <code>?repo=usuario/repo</code> en la URL carga sus YAML (los botones de los laboratorios lo hacen por ti).
        </li>
      </ul>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em' }}>{SHELL_HELP}</pre>
      <p style={{ fontSize: '0.85em' }}>
        Iconos: <a href="https://github.com/kubernetes/community/tree/master/icons">Kubernetes Icons Set</a> (The Kubernetes Authors, CC-BY-4.0). Limitaciones:
        no hay RBAC, NetworkPolicies, CRDs ni operadores; los tiempos (desalojo, HPA) están acortados para que se vean en clase.
      </p>
    </div>
  );
}
