import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Terminal, { type TermEntry } from '../shared/Terminal';
import { run, promptText, VERSION } from './engine/engine';
import { initialState } from './engine/seed';
import { complete, completionOptions } from './engine/complete';
import { SCENARIOS, advance, type CommandLog } from './engine/scenarios';
import type { PlaygroundState } from './engine/types';
import { colorizeAws } from './highlight';
import { FilesPanel, HelpPanel, ResourcesPanel, ScenarioPanel } from './Panels';
import ui from '../shared/playground.module.css';
import styles from './aws.module.css';

const STORAGE = 'awsplay:v1:';
const MAX_ENTRIES = 300;

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

const WELCOME = `Playground de AWS CLI · ${VERSION.split(' ')[0]} simulada en tu navegador.
Cuenta 123456789012, usuario admin, región eu-west-1. Nada llega a AWS.

Prueba "aws sts get-caller-identity", "aws help" o elige un escenario en el panel "Escenario".
Tab autocompleta · ↑/↓ historial · Ctrl+L limpia.
`;

type Side = 'scenario' | 'resources' | 'files' | 'help';

const TOOLBAR: { cmd: string; label: string; title: string }[] = [
  { cmd: 'aws sts get-caller-identity', label: '¿quién soy?', title: 'aws sts get-caller-identity' },
  { cmd: 'aws s3 ls', label: 's3 ls', title: 'Lista tus buckets' },
  {
    cmd: "aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType,PublicIpAddress]' --output table",
    label: 'instancias',
    title: 'Instancias en tabla',
  },
  { cmd: "aws iam list-users --query 'Users[].UserName' --output text", label: 'usuarios', title: 'Usuarios de IAM' },
  { cmd: 'aws help', label: 'help', title: 'Ayuda de la CLI' },
];

export default function AwsPlayground() {
  const [state, setState] = useState<PlaygroundState>(() => load('state', null) ?? initialState(new Date()));
  const [entries, setEntries] = useState<TermEntry[]>(() => load('entries', null) ?? [{ id: 0, prompt: '', command: undefined as unknown as string, output: WELCOME }]);
  const [log, setLog] = useState<CommandLog>(() => load('log', { ok: [], failed: [] }));
  const [scenarioId, setScenarioId] = useState<string>(() => load('scenario', SCENARIOS[0].id));
  const [side, setSide] = useState<Side>(() => load('side', 'scenario'));
  const [progress, setProgress] = useState<Record<string, number>>(() => load('progress', {}));
  const [insert, setInsert] = useState<{ text: string; seq: number }>();
  const seq = useRef(entries.reduce((m, e) => Math.max(m, e.id), 0) + 1);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Deep links from the lessons: /aws-playground?escenario=vpc
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('escenario');
    if (id && SCENARIOS.some((x) => x.id === id)) {
      setScenarioId(id);
      setSide('scenario');
    }
  }, []);

  useEffect(() => save('state', state), [state]);
  useEffect(() => save('entries', entries.slice(-MAX_ENTRIES)), [entries]);
  useEffect(() => save('log', log), [log]);
  useEffect(() => save('scenario', scenarioId), [scenarioId]);
  useEffect(() => save('side', side), [side]);
  useEffect(() => save('progress', progress), [progress]);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  // Tick the next steps of the current scenario after every command.
  useEffect(() => {
    setProgress((p) => {
      const cur = p[scenario.id] ?? 0;
      const next = advance(scenario, cur, state, log);
      return next === cur ? p : { ...p, [scenario.id]: next };
    });
  }, [scenario, state, log]);
  const prompt = promptText(state);

  const addEntry = useCallback((command: string | undefined, output: string, entryPrompt = '', exitCode?: number) => {
    const id = seq.current++;
    setEntries((e) => [...e, { id, prompt: entryPrompt, command: command as string, output, exitCode }].slice(-MAX_ENTRIES));
  }, []);

  const runCommand = useCallback(
    (line: string) => {
      const before = stateRef.current;
      const shownPrompt = promptText(before);
      const trimmed = line.trim();
      if (!before.prompt && trimmed === 'clear') {
        setEntries([]);
        return;
      }
      if (!before.prompt && trimmed === 'history') {
        const cmds = entries.map((e) => e.command).filter(Boolean);
        addEntry(line, cmds.map((c, i) => `${String(i + 1).padStart(5)}  ${c}`).join('\n') + '\n', shownPrompt);
        return;
      }
      const r = run(line, before);
      stateRef.current = r.state;
      setState(r.state);
      if (r.clear) {
        setEntries([]);
        return;
      }
      // Secrets typed at the "aws configure" prompt are not echoed back in full.
      const echo = before.prompt && before.prompt.step < 2 && trimmed ? '*'.repeat(Math.max(0, trimmed.length - 4)) + trimmed.slice(-4) : line;
      addEntry(echo, r.output, shownPrompt, r.exitCode);
      if (!before.prompt && trimmed) setLog((l) => (r.exitCode === 0 ? { ...l, ok: [...l.ok, trimmed].slice(-500) } : { ...l, failed: [...l.failed, trimmed].slice(-500) }));
    },
    [addEntry, entries],
  );

  const onComplete = useCallback(
    (input: string) => {
      const next = complete(input, stateRef.current);
      if (next !== undefined) return next;
      const options = completionOptions(input, stateRef.current);
      if (options.length) addEntry(undefined, options.map((o) => o.split('/').filter(Boolean).pop() + (o.endsWith('/') ? '/' : '')).join('  ') + '\n');
      return undefined;
    },
    [addEntry],
  );

  const paste = useCallback((text: string) => setInsert((i) => ({ text, seq: (i?.seq ?? 0) + 1 })), []);

  const reset = () => {
    if (!window.confirm('¿Reiniciar la cuenta simulada? Se borran buckets, usuarios, instancias y el historial.')) return;
    const fresh = initialState(new Date());
    stateRef.current = fresh;
    setState(fresh);
    setLog({ ok: [], failed: [] });
    setProgress({});
    setEntries([{ id: seq.current++, prompt: '', command: undefined as unknown as string, output: WELCOME }]);
  };

  const backToAdmin = () => runCommand('unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN');
  const asOther = useMemo(() => !promptText(state).startsWith('admin@'), [state]);

  const sideTabs: [Side, string][] = [
    ['scenario', 'Escenario'],
    ['resources', 'Recursos'],
    ['files', 'Ficheros'],
    ['help', 'Cómo funciona'],
  ];

  return (
    <div className={ui.playground}>
      <div className={ui.topbar}>
        <div className={ui.titleBlock}>
          <h1 className={ui.title}>AWS CLI playground</h1>
          <span className={`${ui.status} ${ui.statusOk}`}>100 % en el navegador · cuenta simulada 123456789012</span>
        </div>
        <div className={ui.topActions}>
          <label className={ui.exampleLabel}>
            Escenario
            <select
              value={scenario.id}
              onChange={(e) => {
                setScenarioId(e.target.value);
                setSide('scenario');
              }}
              className={ui.select}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {asOther && (
            <button className={ui.btnGhost} onClick={backToAdmin} title="Quita AWS_PROFILE y las credenciales exportadas">
              Volver a admin
            </button>
          )}
          <button className={ui.btnGhost} onClick={reset} title="Vuelve a la cuenta inicial">
            Reiniciar
          </button>
        </div>
      </div>

      <div className={styles.workspace}>
        <section className={styles.termPane} aria-label="Terminal">
          <div className={ui.toolbar}>
            {TOOLBAR.map((b) => (
              <button key={b.cmd} className={ui.btn} onClick={() => runCommand(b.cmd)} title={b.title} disabled={!!state.prompt}>
                {b.label}
              </button>
            ))}
          </div>
          <Terminal
            entries={entries}
            prompt={prompt}
            busy={false}
            onCommand={runCommand}
            complete={state.prompt ? () => undefined : onComplete}
            colorize={colorizeAws}
            ariaLabel="Terminal con la CLI de AWS"
            placeholder={state.prompt ? '' : 'aws sts get-caller-identity'}
            insert={insert}
            wrap
          />
        </section>

        <section className={styles.sidePane} aria-label="Panel lateral">
          <div className={styles.sideTabs} role="tablist">
            {sideTabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={side === id} className={`${styles.sideTab} ${side === id ? styles.sideTabActive : ''}`} onClick={() => setSide(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className={styles.sideBody}>
            {side === 'scenario' && <ScenarioPanel scenario={scenario} progress={progress[scenario.id] ?? 0} paste={paste} execute={runCommand} busy={!!state.prompt} />}
            {side === 'resources' && <ResourcesPanel state={state} paste={paste} />}
            {side === 'files' && <FilesPanel state={state} paste={paste} />}
            {side === 'help' && <HelpPanel />}
          </div>
        </section>
      </div>
    </div>
  );
}
