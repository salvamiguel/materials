import React, { useState } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';
import { C, FONT, box } from './ui';

type Op = '&&' | '||' | ';';
const OPS: Op[] = ['&&', '||', ';'];

const COMMANDS = [
  { cmd: 'mkdir -p /tmp/app', fail: 'mkdir: /tmp/app: Permission denied' },
  { cmd: 'cp config.yml /tmp/app/', fail: "cp: config.yml: No such file or directory" },
  { cmd: 'echo "Copiado"', fail: '' },
  { cmd: 'echo "Algo falló" >&2', fail: '' },
];

interface Step {
  i: number;
  ran: boolean;
  status?: number;
  why: string;
  fatal?: boolean;
}

// Bash semantics: && runs the next command if the previous status is 0, || if it is not,
// ; always. With set -e the script stops on a failure unless the failing command is
// followed by && or || (only the last command of an &&/|| list counts).
function simulate(ops: Op[], fails: boolean[], setE: boolean): { steps: Step[]; last: number; stopped: boolean } {
  const steps: Step[] = [];
  let status = 0;
  let stopped = false;
  for (let i = 0; i < COMMANDS.length; i++) {
    if (stopped) {
      steps.push({ i, ran: false, why: 'set -e ya ha terminado el script' });
      continue;
    }
    const op = i === 0 ? ';' : ops[i - 1];
    const run = op === ';' || (op === '&&' && status === 0) || (op === '||' && status !== 0);
    if (!run) {
      steps.push({ i, ran: false, why: op === '&&' ? '&& solo sigue si el anterior acabó con 0' : '|| solo sigue si el anterior falló' });
      continue;
    }
    const canFail = COMMANDS[i].fail !== '';
    status = canFail && fails[i] ? 1 : 0;
    const next = i < COMMANDS.length - 1 ? ops[i] : ';';
    const exempt = next === '&&' || next === '||';
    const fatal = setE && status !== 0 && !exempt;
    steps.push({ i, ran: true, status, why: op === ';' ? (i === 0 ? 'primer comando' : '; ejecuta siempre') : op === '&&' ? 'el anterior acabó con 0' : 'el anterior falló', fatal });
    if (fatal) stopped = true;
  }
  return { steps, last: status, stopped };
}

export default function ExitCodeDemo() {
  const [ops, setOps] = useState<Op[]>(['&&', '&&', '||']);
  const [fails, setFails] = useState<boolean[]>([false, true, false, false]);
  const [setE, setSetE] = useState(false);
  const r = simulate(ops, fails, setE);

  const toggleFail = (i: number) => setFails((f) => f.map((v, j) => (j === i ? !v : v)));
  const cycleOp = (i: number) => setOps((o) => o.map((v, j) => (j === i ? OPS[(OPS.indexOf(v) + 1) % OPS.length] : v)));

  return (
    <DemoWrapper title="Exit codes, && y ||" description="Decide qué comandos fallan y cómo se encadenan, y mira cuáles se ejecutan">
      <label style={{ fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={setE} onChange={(e) => setSetE(e.target.checked)} /> Con <code>set -e</code> al principio del script
      </label>

      <div style={{ ...box, marginTop: 10, fontSize: 14, lineHeight: 2 }}>
        <span style={{ color: C.dim }}>$ </span>
        {COMMANDS.map((c, i) => (
          <span key={i}>
            {i > 0 && (
              <button
                type="button"
                onClick={() => cycleOp(i - 1)}
                title="Cambiar el operador"
                style={{ fontFamily: FONT, fontSize: 14, background: 'transparent', color: C.purple, border: `1px dashed ${C.purple}`, borderRadius: 4, margin: '0 6px', cursor: 'pointer' }}
              >
                {ops[i - 1]}
              </button>
            )}
            <span style={{ color: C.green }}>{c.cmd}</span>
          </span>
        ))}
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, margin: '4px 0 10px' }}>Pulsa un operador para cambiarlo entre &&, || y ;.</div>

      <div style={{ display: 'grid', gap: 6 }}>
        {r.steps.map((s) => {
          const c = COMMANDS[s.i];
          const canFail = c.fail !== '';
          return (
            <div
              key={s.i}
              style={{
                ...box,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                opacity: s.ran ? 1 : 0.45,
                borderColor: s.fatal ? C.red : C.border,
              }}
            >
              <span style={{ width: 70, color: s.ran ? (s.status === 0 ? C.green : C.red) : C.dim }}>
                {s.ran ? `$? = ${s.status}` : 'no se ejecuta'}
              </span>
              <span style={{ flex: '1 1 200px' }}>{c.cmd}</span>
              {canFail && (
                <label style={{ fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={fails[s.i]} onChange={() => toggleFail(s.i)} /> que falle
                </label>
              )}
              <span style={{ flexBasis: '100%', fontSize: 12, color: C.dim }}>
                {s.why}
                {s.ran && s.status !== 0 && canFail ? ` · stderr: ${c.fail}` : ''}
                {s.fatal ? ' · set -e: el script termina aquí' : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 14 }}>
        {r.stopped ? (
          <span style={{ color: C.red }}>El script terminó por set -e con código {r.last}.</span>
        ) : (
          <span>
            Resultado de la línea: <code>$? = {r.last}</code> {r.last === 0 ? '(éxito)' : '(error)'}.
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8, marginBottom: 0 }}>
        Con <code>set -e</code>, un fallo seguido de <code>&&</code> o <code>||</code> no detiene el script: se considera «comprobado». Solo cuenta el último
        comando de cada lista.
      </p>
    </DemoWrapper>
  );
}
