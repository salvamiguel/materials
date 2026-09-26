import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { SiTerraform } from 'react-icons/si';
import { IoLink } from 'react-icons/io5';
import { MdSettingsBackupRestore } from 'react-icons/md';
import HclEditor from './HclEditor';
import Terminal, { type TermEntry } from '../shared/Terminal';
import ZoomControl, { usePlaygroundZoom, zoomStyle } from '../shared/Zoom';
import { shellSplit } from '../shared/shell';
import { decodeShare, encodeShare } from '../shared/share';
import { colorizeOutput } from './highlight';
import GraphView from './GraphView';
import StatePanel from './StatePanel';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples';
import { fetchRepoFiles, parseRepoQuery, repoLabel } from './github';
import { localFiles } from './localFiles';
import { complete, type Schemas } from './completion/complete';
import { SchemaCache } from './completion/schemas';
import { TfplayEngine, type ChangeInfo, type Diag, type GraphInfo, type RunResponse } from './engine';
import styles from '../shared/playground.module.css';

const STORAGE = 'tfplay:v1:';
const LOCK_FILE = '.terraform.lock.hcl';

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

const HELP = `Comandos disponibles (el prefijo "terraform" es opcional):

  init                      instala los proveedores que pide la configuración
  validate                  valida la sintaxis y los tipos
  fmt                       formatea los ficheros (terraform fmt)
  plan [-destroy] [-var k=v] muestra el plan de ejecución
  apply [-var k=v]          aplica el plan (se autoaprueba)
  destroy                   destruye todo lo que hay en el estado
  output [nombre]           muestra los outputs del estado
  state list | state show ADDR
  show                      muestra el estado completo
  graph                     grafo de dependencias (formato DOT)
  providers                 árbol de proveedores requeridos
  console [expresión]       evalúa expresiones HCL (sin argumento: modo interactivo)
  clear                     limpia la terminal

Todo ocurre en tu navegador: los recursos son simulados, nadie crea
infraestructura real ni se necesitan credenciales.`;

const WELCOME = `Terraform playground: el motor (Go + hashicorp/hcl compilado a WebAssembly)
se ejecuta en tu navegador. Proveedores: aws (≈1700 recursos), google (≈1350),
random, null, local, terraform_data y los que definas en *.provider.json.
Escribe "help" o usa los botones. Empieza por "init".`;

const SUGGESTIONS = [
  'init', 'validate', 'fmt', 'plan', 'plan -destroy', 'apply', 'destroy', 'output', 'state list',
  'state show ', 'show', 'graph', 'providers', 'console', 'help', 'clear',
];

type Panel = 'state' | 'graph' | 'help';

const NO_SCHEMAS: Schemas = { indexes: () => [], bundled: () => [], load: () => undefined, block: () => undefined };

/** What the user can do about an engine or provider download error. */
function loadHint(msg: string, base: string): string {
  if (/WebAssembly|disallowed by embedder/i.test(msg)) {
    return 'Tu navegador tiene WebAssembly desactivado (por ejemplo, el modo de seguridad mejorada de Edge). Añade este sitio como excepción o prueba con otro navegador.';
  }
  if (/No se pudo descargar|Failed to fetch|NetworkError|HTTP \d{3}/i.test(msg)) {
    return `Parece que tu red (proxy o firewall corporativo) bloquea la descarga de los ficheros del playground. Prueba desde otra red o pide que permitan ${new URL(base, window.location.href).href}.`;
  }
  return '';
}

function languageLabel(name: string) {
  if (name.endsWith('.provider.json')) return 'proveedor';
  if (name.endsWith('.tfvars')) return 'tfvars';
  if (name.endsWith('.tf')) return 'HCL';
  return '';
}

export default function TerraformPlayground() {
  const base = useBaseUrl('/tfplay/');
  const engineRef = useRef<TfplayEngine | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMsg, setStatusMsg] = useState('');
  const [bootSeq, setBootSeq] = useState(0);
  const awsPlayground = useBaseUrl('/aws-playground');

  const [files, setFiles] = useState<Record<string, string>>(() => load('files', DEFAULT_EXAMPLE.files));
  const [active, setActive] = useState<string>(() => load('active', Object.keys(DEFAULT_EXAMPLE.files)[0]));
  const [state, setState] = useState<string>(() => load('state', ''));
  const [installed, setInstalled] = useState<string[]>(() => load('installed', []));
  const [initialized, setInitialized] = useState<boolean>(() => load('initialized', false));
  const [exampleId, setExampleId] = useState<string>(() => load('example', DEFAULT_EXAMPLE.id));

  const [entries, setEntries] = useState<TermEntry[]>([{ id: 0, prompt: '', command: undefined as any, output: WELCOME }]);
  const [busy, setBusy] = useState(false);
  const [consoleMode, setConsoleMode] = useState(false);
  const [diags, setDiags] = useState<Diag[]>([]);
  const [changes, setChanges] = useState<ChangeInfo[]>([]);
  const [graph, setGraph] = useState<GraphInfo | undefined>();
  const [graphError, setGraphError] = useState<string | undefined>();
  const [panel, setPanel] = useState<Panel>('state');
  const [shareMsg, setShareMsg] = useState('');
  const zoom = usePlaygroundZoom();
  const seq = useRef(1);
  // Provider schemas for autocompletion; schemaVersion changes when one arrives.
  const [schemas, setSchemas] = useState<SchemaCache>();
  const [schemaVersion, setSchemaVersion] = useState(0);

  // Boot the engine in a worker.
  useEffect(() => {
    setStatus('loading');
    setStatusMsg('');
    const en = new TfplayEngine(base);
    engineRef.current = en;
    en.ready.then(
      () => setStatus('ready'),
      (err) => {
        setStatus('error');
        setStatusMsg(String(err.message || err));
      },
    );
    const cache = new SchemaCache(en);
    const unsubscribe = cache.subscribe(() => setSchemaVersion((v) => v + 1));
    setSchemas(cache);
    return () => {
      unsubscribe();
      en.terminate();
    };
  }, [base, bootSeq]);

  useEffect(() => schemas?.setFiles(files), [schemas, files]);
  // Installed providers are already in the worker: list their types right away.
  useEffect(() => installed.forEach((source) => schemas?.load(source)), [schemas, installed]);

  // Shared links: #code=<deflate+base64url of the files>
  useEffect(() => {
    const m = /^#code=(.+)$/.exec(window.location.hash);
    if (!m) return;
    decodeShare(m[1]).then(
      (shared) => {
        setFiles(shared);
        setActive(Object.keys(shared).find((f) => f.endsWith('.tf')) || Object.keys(shared)[0]);
        setState('');
        setInstalled([]);
        setInitialized(false);
        setExampleId('');
        history.replaceState(null, '', window.location.pathname + window.location.search);
        addEntry('', 'Configuración cargada desde un enlace compartido. Ejecuta "init".');
      },
      () => addEntry('', 'Error: el enlace compartido no es válido.'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Links from the lessons: ?repo=owner/name[&ref=branch][&path=dir] loads the
  // Terraform files of that GitHub repository.
  useEffect(() => {
    const r = parseRepoQuery(window.location.search);
    const url = new URL(window.location.href);
    if (!url.searchParams.has('repo')) return;
    ['repo', 'ref', 'path'].forEach((k) => url.searchParams.delete(k));
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (!r) {
      addEntry('', 'Error: el parámetro "repo" no es válido (usa ?repo=usuario/repositorio).');
      return;
    }
    const label = repoLabel(r);
    const pristine = !state.trim() && EXAMPLES.some((e) => JSON.stringify(e.files) === JSON.stringify(files));
    if (!pristine && !window.confirm(`Abrir ${label} reemplaza tus ficheros y borra el estado actual. ¿Continuar?`)) return;
    addEntry('', `Descargando los ficheros de github.com/${label}…`);
    fetchRepoFiles(r).then(
      (repoFiles) => {
        const names = Object.keys(repoFiles).sort();
        setFiles(repoFiles);
        setActive(names.find((f) => f === 'main.tf') || names.find((f) => f.endsWith('.tf') && !f.includes('/')) || names[0]);
        setState('');
        setInstalled([]);
        setInitialized(false);
        setChanges([]);
        setDiags([]);
        setExampleId(`gh:${label}`);
        addEntry('', `Cargado github.com/${label}: ${names.join(', ')}.\nEjecuta "init" para empezar.`);
      },
      (err) => addEntry('', `Error: ${(err as Error).message}\nPuedes abrir el repositorio en GitHub y copiar los ficheros a mano.`),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => save('files', files), [files]);
  useEffect(() => save('active', active), [active]);
  useEffect(() => save('state', state), [state]);
  useEffect(() => save('installed', installed), [installed]);
  useEffect(() => save('initialized', initialized), [initialized]);
  useEffect(() => save('example', exampleId), [exampleId]);

  const fileNames = useMemo(
    () =>
      Object.keys(files).sort((a, b) => {
        const rank = (n: string) => (n === LOCK_FILE ? 3 : n.includes('/') ? 2 : n.endsWith('.tf') ? 0 : 1);
        return rank(a) - rank(b) || a.localeCompare(b);
      }),
    [files],
  );
  const current = files[active] !== undefined ? active : fileNames[0];

  const addEntry = useCallback((command: string | undefined, output: string, prompt = '$ terraform ') => {
    const id = seq.current++;
    setEntries((e) => [...e, { id, prompt, command: command as string, output }]);
    return id;
  }, []);

  // Live validation + graph refresh while typing (debounced).
  useEffect(() => {
    if (status !== 'ready') return;
    const t = setTimeout(async () => {
      const en = engineRef.current!;
      try {
        const g = await en.run({ command: 'graph', files });
        if (g.graph) {
          setGraph(g.graph);
          setGraphError(undefined);
        } else if (g.exit_code) {
          setGraphError('No se puede dibujar el grafo: la configuración tiene errores (mira la terminal o ejecuta validate).');
        }
        const v = await en.run({ command: 'validate', files, installed });
        const lockProblem = v.diagnostics.some((d) => d.summary === 'Inconsistent dependency lock file');
        setDiags(lockProblem ? g.diagnostics : v.diagnostics);
      } catch {
        // ignore: the terminal reports real errors when commands run
      }
    }, 600);
    return () => clearTimeout(t);
  }, [files, installed, status]);

  const runCommand = useCallback(
    async (line: string) => {
      const en = engineRef.current;
      if (consoleMode) {
        if (line === 'exit' || line === 'quit') {
          setConsoleMode(false);
          addEntry(line, '', '> ');
          return;
        }
        if (!line) return;
        const id = addEntry(line, '', '> ');
        const r = await en!.run({ command: 'console', args: [line], files, state, installed });
        setEntries((e) => e.map((x) => (x.id === id ? { ...x, output: r.output } : x)));
        return;
      }
      let args = shellSplit(line);
      if (args[0] === 'terraform') args = args.slice(1);
      const display = args.join(' ');
      if (args.length === 0) {
        addEntry('', '');
        return;
      }
      let cmd = args[0];
      let rest = args.slice(1);
      switch (cmd) {
        case 'clear':
          setEntries([]);
          return;
        case 'help':
        case '-help':
        case '--help':
          addEntry(display, HELP);
          return;
        case 'version':
        case '-version':
          addEntry(display, 'Terraform v1.16.4 (playground)\non js_wasm\n');
          return;
      }
      if (status !== 'ready' || !en) {
        const hint = loadHint(statusMsg, base);
        addEntry(
          display,
          status === 'error' ? `Error: el motor no se pudo cargar.\n\n${statusMsg}\n${hint ? `\n${hint}\n` : ''}` : 'El motor todavía se está cargando…',
        );
        return;
      }
      if (cmd === 'state') {
        const sub = rest[0];
        if (sub !== 'list' && sub !== 'show') {
          addEntry(display, 'Uso: terraform state <list|show> [dirección]\n\nEl playground implementa "state list" y "state show".');
          return;
        }
        cmd = 'state_' + sub;
        rest = rest.slice(1);
      }
      if (cmd === 'console' && rest.length === 0) {
        setConsoleMode(true);
        addEntry(display, 'Modo consola: escribe expresiones HCL (var.x, local.y, aws_vpc.main.id, cidrsubnet(...)).\nEscribe "exit" para salir.');
        return;
      }
      const vars: Record<string, string> = {};
      const positional: string[] = [];
      let destroy = false;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '-var' && i + 1 < rest.length) {
          const [k, ...v] = rest[++i].split('=');
          vars[k] = v.join('=');
        } else if (a.startsWith('-var=')) {
          const [k, ...v] = a.slice(5).split('=');
          vars[k] = v.join('=');
        } else if (a === '-destroy') {
          destroy = true;
        } else if (a.startsWith('-')) {
          // -auto-approve, -no-color, -input=false... are accepted and ignored
        } else {
          positional.push(a);
        }
      }
      if (cmd === 'console') positional.splice(0, positional.length, rest.join(' '));

      const id = seq.current++;
      setEntries((e) => [...e, { id, prompt: '$ terraform ', command: display, output: '', pending: true }]);
      setBusy(true);
      let resp: RunResponse;
      try {
        resp = await en.run({ command: cmd, args: positional, files, state, installed, vars, destroy });
      } catch (err) {
        const msg = (err as Error).message;
        const hint = loadHint(msg, base);
        resp = { output: `Error: ${msg}\n${hint ? `\n${hint}\n` : ''}`, exit_code: 1, diagnostics: [] };
      }
      setBusy(false);
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, output: resp.output, exitCode: resp.exit_code, pending: false } : x)));
      if (resp.diagnostics?.length) setDiags(resp.diagnostics);
      else if (['validate', 'plan', 'apply', 'destroy'].includes(cmd)) setDiags([]);
      if (cmd === 'init' && resp.exit_code === 0) {
        setInitialized(true);
        setInstalled((prev) => Array.from(new Set([...prev, ...(resp.installed || [])])).sort());
      }
      // fmt rewrites files, init writes the lock file and local_file writes
      // (or, on destroy, deletes) the files it manages.
      if ((resp.files && Object.keys(resp.files).length) || resp.removed_files?.length) {
        setFiles((f) => {
          const next = { ...f, ...resp.files };
          for (const name of resp.removed_files || []) delete next[name];
          return next;
        });
      }
      if (resp.state !== undefined && resp.state !== null) setState(resp.state);
      if (resp.changes && (cmd === 'plan' || cmd === 'apply' || cmd === 'destroy')) {
        setChanges(cmd === 'plan' ? resp.changes : []);
      }
      if (cmd === 'graph' && resp.graph) {
        setGraph(resp.graph);
        setPanel('graph');
      }
      if ((cmd === 'apply' || cmd === 'destroy') && resp.exit_code === 0) setPanel('state');
    },
    [addEntry, base, consoleMode, files, installed, state, status, statusMsg],
  );

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    if (state.trim() && !window.confirm('Cargar un ejemplo reemplaza los ficheros y borra el estado actual. ¿Continuar?')) return;
    setFiles(ex.files);
    setActive(Object.keys(ex.files).find((f) => f === 'main.tf') || Object.keys(ex.files)[0]);
    setState('');
    setInstalled([]);
    setInitialized(false);
    setChanges([]);
    setDiags([]);
    setExampleId(ex.id);
    addEntry(undefined, `Ejemplo cargado: ${ex.label}.\n${ex.description}`);
  };

  const addFile = () => {
    const name = window.prompt('Nombre del fichero (p. ej. outputs.tf, terraform.tfvars, modules/red/main.tf o mi.provider.json):');
    if (!name) return;
    const clean = name.trim().replace(/^\.\//, '');
    if (!clean || files[clean] !== undefined) return;
    setFiles((f) => ({ ...f, [clean]: '' }));
    setActive(clean);
  };

  const removeFile = (name: string) => {
    if (!window.confirm(`¿Borrar ${name}?`)) return;
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
      const url = `${window.location.origin}${window.location.pathname}#code=${code}`;
      await navigator.clipboard.writeText(url);
      setShareMsg('Enlace copiado');
    } catch {
      setShareMsg('No se pudo copiar el enlace');
    }
    setTimeout(() => setShareMsg(''), 2500);
  };

  const resetAll = () => {
    if (!window.confirm('Se borrarán el estado, los proveedores instalados y los ficheros creados por local_file (tus ficheros .tf se mantienen). ¿Continuar?')) return;
    const created = localFiles(state);
    setState('');
    setInstalled([]);
    setInitialized(false);
    setChanges([]);
    setFiles((f) => {
      const next = { ...f };
      delete next[LOCK_FILE];
      for (const name of created.keys()) delete next[name];
      return next;
    });
    addEntry(undefined, 'Estado e inicialización borrados. Ejecuta "init" de nuevo.');
  };

  const fileDiags = useMemo(() => diags.filter((d) => d.filename === current), [diags, current]);
  const completeAt = useCallback(
    (text: string, offset: number) =>
      current === undefined ? undefined : complete({ files: { ...files, [current]: text }, filename: current, offset, schemas: schemas ?? NO_SCHEMAS }),
    [files, current, schemas],
  );
  // Files written by local_file: editing one simulates a change made outside Terraform.
  const created = useMemo(() => localFiles(state), [state]);
  const createdBy = (name: string) => (files[name] !== undefined ? created.get(name) : undefined);
  const errorCount = diags.filter((d) => d.severity === 'error').length;

  const toolbar: { cmd: string; label: string; cls?: string; title: string }[] = [
    { cmd: 'init', label: 'init', title: 'terraform init: instala los proveedores' },
    { cmd: 'validate', label: 'validate', title: 'terraform validate' },
    { cmd: 'fmt', label: 'fmt', title: 'terraform fmt: formatea el código' },
    { cmd: 'plan', label: 'plan', cls: styles.btnPlan, title: 'terraform plan' },
    { cmd: 'apply', label: 'apply', cls: styles.btnApply, title: 'terraform apply -auto-approve' },
    { cmd: 'destroy', label: 'destroy', cls: styles.btnDestroy, title: 'terraform destroy -auto-approve' },
  ];

  return (
    <div className={styles.playground} style={zoomStyle(zoom.zoom)}>
      <div className={styles.topbar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <SiTerraform className={`${styles.titleIcon} ${styles.titleIconTf}`} aria-hidden />
            Terraform playground
          </h1>
          <span
            className={`${styles.status} ${status === 'ready' ? styles.statusOk : status === 'error' ? styles.statusErr : ''}`}
            title={statusMsg}
          >
            {status === 'loading' ? 'Cargando motor…' : status === 'ready' ? 'Motor listo · 100 % en el navegador' : 'Error al cargar el motor'}
          </span>
        </div>
        <div className={styles.topActions}>
          <ZoomControl {...zoom} />
          <label className={styles.exampleLabel}>
            Ejemplo
            <select value={exampleId} onChange={(e) => loadExample(e.target.value)} className={styles.select}>
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
          <button className={styles.btnGhost} onClick={share} title="Copia un enlace con todos los ficheros">
            <IoLink aria-hidden /> {shareMsg || 'Compartir'}
          </button>
          <button className={styles.btnGhost} onClick={resetAll} title="Borra el estado, los proveedores instalados y los ficheros creados por local_file">
            <MdSettingsBackupRestore aria-hidden /> Reiniciar
          </button>
        </div>
      </div>

      {status === 'error' && (
        <div className={styles.loadError} role="alert">
          <div className={styles.loadErrorText}>
            <strong>No se pudo cargar el motor de Terraform.</strong>
            {loadHint(statusMsg, base) && <span>{loadHint(statusMsg, base)}</span>}
            <code className={styles.loadErrorMsg}>{statusMsg}</code>
          </div>
          <div className={styles.loadErrorActions}>
            <button className={styles.btn} onClick={() => setBootSeq((n) => n + 1)}>
              Reintentar
            </button>
            <a className={styles.btnGhost} href={awsPlayground}>
              Ir al playground de AWS CLI
            </a>
          </div>
        </div>
      )}

      <div className={styles.workspace}>
        <section className={styles.editorPane} aria-label="Ficheros">
          <div className={styles.tabs} role="tablist">
            {fileNames.map((name) => (
              <div
                key={name}
                role="tab"
                aria-selected={name === current}
                className={`${styles.tab} ${name === current ? styles.tabActive : ''} ${createdBy(name) ? styles.tabCreated : ''}`}
                onClick={() => setActive(name)}
                onDoubleClick={() => renameFile(name)}
                title={
                  createdBy(name)
                    ? `Fichero creado por ${createdBy(name)}. Edítalo o bórralo para simular un cambio hecho fuera de Terraform: el próximo plan lo detectará.`
                    : 'Doble clic para renombrar'
                }
              >
                <span>{name}</span>
                {diags.some((d) => d.filename === name && d.severity === 'error') && <i className={styles.tabDot} />}
                {fileNames.length > 1 && (
                  <button
                    className={styles.tabClose}
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
            <button className={styles.tabAdd} onClick={addFile} aria-label="Nuevo fichero" title="Nuevo fichero">
              +
            </button>
          </div>
          {current !== undefined && (
            <HclEditor
              filename={current}
              value={files[current] ?? ''}
              onChange={(v) => setFiles((f) => ({ ...f, [current]: v }))}
              diagnostics={fileDiags}
              complete={/\.(tf|tfvars)$/.test(current) ? completeAt : undefined}
              completionVersion={schemaVersion}
            />
          )}
          <div className={styles.editorFooter}>
            <span>{createdBy(current || '') ? `creado por ${createdBy(current || '')}` : languageLabel(current || '')}</span>
            {errorCount > 0 ? (
              <span className={styles.footErr}>
                {errorCount} {errorCount === 1 ? 'error' : 'errores'}: {diags.find((d) => d.severity === 'error')?.summary}
              </span>
            ) : (
              <span>
                {!initialized ? 'Sin inicializar' : installed.length ? `Proveedores: ${installed.join(', ')}` : 'Inicializado'}
              </span>
            )}
          </div>
        </section>

        <section className={styles.termPane} aria-label="Terminal">
          <div className={styles.toolbar}>
            {toolbar.map((b) => (
              <button
                key={b.cmd}
                className={`${styles.btn} ${b.cls || ''}`}
                disabled={busy || status !== 'ready'}
                onClick={() => runCommand(b.cmd)}
                title={b.title}
              >
                {b.label}
              </button>
            ))}
          </div>
          <Terminal
            entries={entries}
            prompt={consoleMode ? '> ' : '$ terraform '}
            busy={busy}
            onCommand={runCommand}
            suggestions={SUGGESTIONS}
            colorize={colorizeOutput}
            ariaLabel="Línea de comandos de terraform"
            placeholder="plan, apply, state list, console…"
          />
        </section>
      </div>

      <section className={styles.panels}>
        <div className={styles.panelTabs} role="tablist">
          {(
            [
              ['state', 'Estado (terraform.tfstate)'],
              ['graph', 'Grafo de dependencias'],
              ['help', 'Cómo funciona'],
            ] as [Panel, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={panel === id}
              className={`${styles.panelTab} ${panel === id ? styles.panelTabActive : ''}`}
              onClick={() => setPanel(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.panelBody}>
          {panel === 'state' && (
            <StatePanel
              state={state}
              onChange={setState}
              onReset={() => {
                setState('');
                addEntry(undefined, 'Estado borrado: la próxima vez Terraform planificará crearlo todo.');
              }}
              onShow={(addr) => runCommand(`state show '${addr}'`)}
            />
          )}
          {panel === 'graph' && <GraphView graph={graph} changes={changes} error={graphError} zoom={zoom.zoom} />}
          {panel === 'help' && <HowItWorks />}
        </div>
      </section>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className={styles.help}>
      <p>
        Este playground no llama a ninguna nube ni a ningún servidor. Un pequeño motor escrito en Go con las mismas
        librerías que usa Terraform (<code>hashicorp/hcl</code> y <code>go-cty</code>) está compilado a WebAssembly y se
        ejecuta en tu navegador.
      </p>
      <ul>
        <li>
          <b>Lenguaje real</b>: expresiones, funciones, <code>for</code>, <code>count</code>, <code>for_each</code>,{' '}
          <code>dynamic</code>, módulos locales, validaciones, <code>lifecycle</code> y <code>moved</code> se evalúan como
          en Terraform. Los valores que solo existen tras crear algo aparecen como <i>(known after apply)</i>.
        </li>
        <li>
          <b>Proveedores simulados</b>: los esquemas de <code>hashicorp/aws</code> (unos 1700 recursos) y{' '}
          <code>hashicorp/google</code> (unos 1350) son los reales, así que Terraform sabe qué argumentos existen,
          cuáles son obligatorios y cuáles fuerzan un reemplazo. Al hacer <code>apply</code> se inventan
          identificadores, ARNs, <code>self_link</code> e IPs verosímiles.
        </li>
        <li>
          <b>Estado</b>: se guarda en tu navegador. Puedes editarlo para simular cambios hechos a mano en la consola
          (drift) y ver cómo <code>plan</code> propone deshacerlos.
        </li>
        <li>
          <b>Ficheros locales</b>: <code>local_file</code> crea de verdad su fichero, que aparece como una pestaña más.
          Edítalo o bórralo y el siguiente <code>plan</code> detectará el cambio hecho fuera de Terraform;{' '}
          <code>apply</code> lo deja como dice la configuración.
        </li>
        <li>
          <b>Autocompletado</b>: el editor sugiere bloques, tipos de recursos, argumentos (los obligatorios primero),
          referencias como <code>var.</code> o <code>aws_vpc.main.</code> y funciones mientras escribes;{' '}
          <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> lo abre a mano y <kbd>Tab</kbd> salta entre los huecos de lo insertado.
        </li>
        <li>
          <b>Proveedor propio</b>: crea un fichero <code>*.provider.json</code> con recursos y atributos (
          <code>required</code>, <code>optional</code>, <code>computed</code>, <code>force_new</code>,{' '}
          <code>default</code>) y valores <code>mock</code>. Mira el ejemplo «Proveedor propio».
        </li>
      </ul>
      <p>
        Limitaciones: no hay backends remotos, ni <code>import</code>, ni módulos del registry, y los data sources
        devuelven datos de ejemplo. Para practicar con AWS de verdad, usa los laboratorios del curso.
      </p>
    </div>
  );
}
