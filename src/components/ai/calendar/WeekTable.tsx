import React from 'react';
import { CERTS, SESIONES, PROF_ONLINE_2, Profesor } from './data';
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
                  {s.brk && (
                    <tr>
                      <td className={styles.breakNote} colSpan={6}>
                        · · · {s.brk} · · ·
                      </td>
                    </tr>
                  )}
                  <tr className={rowClass}>
                    <td className={styles.mono}>{s.n}</td>
                    {s.o ? (
                      <td className={styles.dateCell}>
                        <span className={styles.mono}>{s.o}</span>
                        <span className={styles.dateTrack}>martes · online 1 y 2</span>
                      </td>
                    ) : (
                      <td className={styles.noneCell}>sin sesión online</td>
                    )}
                    <td className={styles.dateCell}>
                      <span className={styles.mono}>{s.p}</span>
                      <span className={styles.dateTrack}>miércoles · presencial</span>
                    </td>
                    <td>
                      <span className={styles.chip} style={{ background: cert.soft, color: cert.color }}>
                        <span className={styles.dot} style={{ background: cert.color }} />
                        {cert.label}
                      </span>
                    </td>
                    <td className={styles.temaCell}>{s.tema}</td>
                    <td>
                      <Who prof={s.prof} grupos={s.o ? 'presencial · online 1' : 'presencial'} />
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
