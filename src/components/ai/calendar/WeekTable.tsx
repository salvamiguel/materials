import React from 'react';
import { CERTS, SESIONES, PROF_ONLINE_2, Profesor, Sesion, semana } from './data';
import styles from './calendar.module.css';

function Who({ prof, grupos }: { prof: Profesor; grupos: string }): React.ReactElement {
  const key = prof === 'Salva' ? 'salva' : prof === 'Javier' ? 'javier' : 'moises';
  return (
    <span className={styles.whoLine}>
      <span className={styles.who} style={{ background: `var(--cal-${key}-soft)`, color: `var(--cal-${key})` }}>
        {prof}
      </span>
      <span className={styles.dateTrack}>{grupos}</span>
    </span>
  );
}

/** Notas de parón previas a la semana; si presencial y online no coinciden se indica el grupo. */
function paronesSemana(s: Sesion): string[] {
  if (s.brk && s.brk === s.brkO) return [s.brk];
  return [s.brk && `${s.brk} (presencial)`, s.brkO && `${s.brkO} (online)`].filter((n): n is string => Boolean(n));
}

export default function WeekTable(): React.ReactElement {
  return (
    <div className={styles.calWrapper}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Sem</th>
              <th>Online</th>
              <th>Presencial</th>
              <th>Certificación</th>
              <th>Sesión</th>
              <th>Profesor</th>
            </tr>
          </thead>
          <tbody>
            {SESIONES.map((s) => {
              const cert = CERTS[s.cert];
              const rowClass = s.prof === 'Salva' ? styles.rowSalva : styles.rowJavier;
              return (
                <React.Fragment key={s.n}>
                  {paronesSemana(s).map((nota) => (
                    <tr key={nota}>
                      <td className={styles.breakNote} colSpan={6}>
                        · · · {nota} · · ·
                      </td>
                    </tr>
                  ))}
                  <tr className={rowClass}>
                    <td className={styles.mono}>{semana(s)}</td>
                    {s.o ? (
                      <td className={styles.dateCell}>
                        <span className={styles.mono}>{s.o}</span>
                        <span className={styles.dateTrack}>martes · online 1 y 2</span>
                      </td>
                    ) : (
                      <td className={styles.noneCell}>sin sesión online</td>
                    )}
                    {s.p ? (
                      <td className={styles.dateCell}>
                        <span className={styles.mono}>{s.p}</span>
                        <span className={styles.dateTrack}>miércoles · presencial</span>
                      </td>
                    ) : (
                      <td className={styles.noneCell}>sin sesión presencial</td>
                    )}
                    <td>
                      <span className={styles.chip} style={{ background: cert.soft, color: cert.color }}>
                        <span className={styles.dot} style={{ background: cert.color }} />
                        {cert.label}
                      </span>
                    </td>
                    <td className={styles.temaCell}>{s.tema}</td>
                    <td>
                      <Who prof={s.prof} grupos={[s.p && 'presencial', s.o && 'online 1'].filter(Boolean).join(' · ')} />
                      {s.o && <Who prof={PROF_ONLINE_2} grupos="online 2" />}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
