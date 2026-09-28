import React, { useMemo, useState } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';
import { C, Chip, FONT, box, input, label } from './ui';

const PRESETS: { expr: string; name: string }[] = [
  { expr: '*/15 * * * *', name: 'Cada 15 min' },
  { expr: '0 9 * * 1-5', name: 'Laborables 9:00' },
  { expr: '30 2 * * 0', name: 'Domingos 2:30' },
  { expr: '0 */4 * * *', name: 'Cada 4 horas' },
  { expr: '0 0 1 * *', name: 'Día 1 del mes' },
  { expr: '0 9,13 * * 1-5', name: '9:00 y 13:00' },
];

const FIELDS = [
  { name: 'minuto', min: 0, max: 59 },
  { name: 'hora', min: 0, max: 23 },
  { name: 'día del mes', min: 1, max: 31 },
  { name: 'mes', min: 1, max: 12 },
  { name: 'día de la semana', min: 0, max: 7 },
];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_PL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const DAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

interface Field {
  values: Set<number>;
  any: boolean;
  text: string;
}

function parseField(src: string, idx: number): Field {
  const { min, max, name } = FIELDS[idx];
  const values = new Set<number>();
  if (src === '*') {
    for (let v = min; v <= max; v++) values.add(v);
    return { values, any: true, text: '' };
  }
  for (const part of src.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`"${part}" no es válido en el campo ${name}`);
    let lo = m[1] === '*' ? min : parseInt(m[1], 10);
    let hi = m[2] !== undefined ? parseInt(m[2], 10) : m[1] === '*' || m[3] ? max : lo;
    const step = m[3] ? parseInt(m[3], 10) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`"${part}" está fuera del rango ${min}-${max} del campo ${name}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (idx === 4 && values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return { values, any: false, text: src };
}

function list(nums: number[], fmt: (n: number) => string): string {
  const s = nums.map(fmt);
  return s.length <= 1 ? s.join('') : `${s.slice(0, -1).join(', ')} y ${s[s.length - 1]}`;
}

function describe(src: string[], f: Field[]): string {
  const [mi, ho, dom, mon, dow] = f;
  const parts: string[] = [];
  const step = (s: string) => /^\*\/(\d+)$/.exec(s)?.[1];
  if (mi.any && ho.any) parts.push('cada minuto');
  else if (step(src[0]) && ho.any) parts.push(`cada ${step(src[0])} minutos`);
  else if (step(src[1]) && src[0] === '0') parts.push(`cada ${step(src[1])} horas, en punto`);
  else if (ho.any) parts.push(`en el minuto ${list([...mi.values], String)} de cada hora`);
  else {
    const hours = [...ho.values];
    const mins = [...mi.values];
    if (hours.length * mins.length <= 6)
      parts.push(`a las ${list(hours.flatMap((h) => mins.map((m) => h * 60 + m)), (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`)}`);
    else parts.push(`en los minutos ${src[0]} de las horas ${src[1]}`);
  }
  if (!dom.any && !dow.any) parts.push(`los días ${list([...dom.values], String)} del mes o los ${list([...dow.values], (d) => DAYS_PL[d])}`);
  else if (!dom.any) parts.push(`el día ${list([...dom.values], String)} del mes`);
  else if (!dow.any) {
    const d = [...dow.values].sort();
    parts.push(d.join(',') === '1,2,3,4,5' ? 'de lunes a viernes' : `los ${list(d, (x) => DAYS_PL[x])}`);
  }
  if (!mon.any) parts.push(`en ${list([...mon.values], (m) => MONTHS[m])}`);
  return parts.join(', ');
}

function matches(d: Date, f: Field[]): boolean {
  const [mi, ho, dom, mon, dow] = f;
  if (!mi.values.has(d.getMinutes()) || !ho.values.has(d.getHours()) || !mon.values.has(d.getMonth() + 1)) return false;
  const domOk = dom.values.has(d.getDate());
  const dowOk = dow.values.has(d.getDay());
  // Classic cron: when both day fields are restricted, either one is enough.
  if (!dom.any && !dow.any) return domOk || dowOk;
  return domOk && dowOk;
}

function nextRuns(f: Field[], from: Date, count: number, limitDays = 400): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const end = from.getTime() + limitDays * 86400000;
  while (out.length < count && d.getTime() < end) {
    if (matches(d, f)) out.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}

export default function CronCalendar() {
  const [expr, setExpr] = useState(PRESETS[1].expr);
  const now = useMemo(() => new Date(), []);

  const parsed = useMemo(() => {
    const src = expr.trim().split(/\s+/);
    if (src.length !== 5) return { error: `Una expresión cron tiene 5 campos; aquí hay ${src.length}.` };
    try {
      const f = src.map(parseField);
      return { src, f, text: describe(src, f), runs: nextRuns(f, now, 8) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [expr, now]);

  // Heat map of the next 7 days: runs per day and hour.
  const grid = useMemo(() => {
    if (!('f' in parsed) || !parsed.f) return null;
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const d = new Date(start);
    for (let i = 0; i < 7 * 24 * 60; i++) {
      if (matches(d, parsed.f)) g[Math.floor(i / 1440)][d.getHours()]++;
      d.setMinutes(d.getMinutes() + 1);
    }
    return { g, start };
  }, [parsed, now]);

  const fmt = (d: Date) =>
    `${DAYS_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  return (
    <DemoWrapper title="Calendario cron" description="Escribe una expresión cron y mira cuándo se ejecutaría">
      <div style={{ marginBottom: 10 }}>
        {PRESETS.map((p) => (
          <Chip key={p.expr} active={p.expr === expr} onClick={() => setExpr(p.expr)}>
            {p.name}
          </Chip>
        ))}
      </div>
      <label style={label}>Expresión (minuto hora día-del-mes mes día-de-la-semana)</label>
      <input style={{ ...input, fontSize: 16, color: 'error' in parsed ? C.red : C.yellow }} value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false} />

      {'error' in parsed ? (
        <div style={{ ...box, color: C.red, marginTop: 10 }}>{parsed.error}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, margin: '10px 0', fontFamily: FONT, fontSize: 12 }}>
            {parsed.src.map((s, i) => (
              <div key={i} style={{ ...box, padding: 6, textAlign: 'center' }}>
                <div style={{ color: C.yellow, fontSize: 15 }}>{s}</div>
                <div style={{ color: C.dim, fontSize: 11 }}>{FIELDS[i].name}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 15, margin: '8px 0 12px' }}>
            Se ejecuta <strong>{parsed.text}</strong>.
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ ...box, flex: '1 1 220px' }}>
              <div style={{ color: C.dim, marginBottom: 6 }}>Próximas ejecuciones</div>
              {parsed.runs.length ? parsed.runs.map((r, i) => <div key={i} style={{ color: C.green }}>{fmt(r)}</div>) : <div>Ninguna en el próximo año.</div>}
            </div>
            {grid && (
              <div style={{ ...box, flex: '2 1 360px', overflowX: 'auto' }}>
                <div style={{ color: C.dim, marginBottom: 6 }}>Próximos 7 días (cada celda es una hora)</div>
                {grid.g.map((row, di) => {
                  const day = new Date(grid.start.getTime() + di * 86400000);
                  return (
                    <div key={di} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
                      <span style={{ width: 34, fontSize: 11 }}>{DAYS_SHORT[day.getDay()]}</span>
                      {row.map((n, h) => (
                        <span
                          key={h}
                          title={`${DAYS[day.getDay()]} ${h}:00 — ${n} ejecución(es)`}
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 2,
                            background: n === 0 ? C.panel : n === 1 ? 'rgba(152,195,121,0.55)' : C.green,
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 2, marginLeft: 36, fontSize: 10, color: C.dim }}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} style={{ width: 12, textAlign: 'center' }}>{h % 6 === 0 ? h : ''}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10, marginBottom: 0 }}>
        Si restringes a la vez el día del mes y el día de la semana, cron ejecuta la tarea cuando se cumple <em>cualquiera</em> de los dos. Las horas
        son las del servidor (revisa su zona horaria con <code>timedatectl</code>).
      </p>
    </DemoWrapper>
  );
}
