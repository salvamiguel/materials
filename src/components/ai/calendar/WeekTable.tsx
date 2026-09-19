import React from 'react';
import { CERTS, SESIONES } from './data';
import styles from './calendar.module.css';

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
                        <span className={styles.dateTrack}>martes · online</span>
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
                      <span
                        className={styles.who}
                        style={{
                          background: s.prof === 'Salva' ? 'var(--cal-salva-soft)' : 'var(--cal-javier-soft)',
                          color: s.prof === 'Salva' ? 'var(--cal-salva)' : 'var(--cal-javier)',
                        }}
                      >
                        {s.prof}
                      </span>
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
