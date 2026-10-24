import React from 'react';
import { CERTS, ONLINE, PRESENCIAL, PROF_ONLINE_2, Profesor } from './data';
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

export default function WeekTable({ grupo }: { grupo: 'online' | 'presencial' }): React.ReactElement {
  const online = grupo === 'online';
  const sesiones = online ? ONLINE : PRESENCIAL;

  return (
    <div className={styles.calWrapper}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Clase</th>
              <th>{online ? 'Online · martes' : 'Presencial · miércoles'}</th>
              <th>Certificación</th>
              <th>Sesión</th>
              <th>Profesor</th>
            </tr>
          </thead>
          <tbody>
            {sesiones.map((s) => {
              const cert = CERTS[s.cert];
              const rowClass = s.prof === 'Salva' ? styles.rowSalva : styles.rowJavier;
              return (
                <React.Fragment key={s.n}>
                  {s.brk && (
                    <tr>
                      <td className={styles.breakNote} colSpan={5}>
                        · · · {s.brk} · · ·
                      </td>
                    </tr>
                  )}
                  <tr className={rowClass}>
                    <td className={styles.mono}>{s.n}</td>
                    <td className={styles.dateCell}>
                      <span className={styles.mono}>{s.f}</span>
                      <span className={styles.dateTrack}>{online ? 'martes · online 1 y 2' : 'miércoles · presencial'}</span>
                    </td>
                    <td>
                      <span className={styles.chip} style={{ background: cert.soft, color: cert.color }}>
                        <span className={styles.dot} style={{ background: cert.color }} />
                        {cert.label}
                      </span>
                    </td>
                    <td className={styles.temaCell}>{s.tema}</td>
                    <td>
                      <Who prof={s.prof} grupos={online ? 'online 1' : 'presencial'} />
                      {online && <Who prof={PROF_ONLINE_2} grupos="online 2" />}
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
