import React from 'react';
import { CERTS, BLOQUES, SESIONES, PROF_ONLINE_2, Profesor, Sesion, inicial } from './data';
import styles from './calendar.module.css';

const FILAS_ONLINE: Array<{ label: string; prof: (s: Sesion) => Profesor }> = [
  { label: 'Online 1 · martes', prof: (s) => s.prof },
  { label: 'Online 2 · martes', prof: () => PROF_ONLINE_2 },
];

export default function WeekRail(): React.ReactElement {
  return (
    <div className={styles.calWrapper}>
      <div className={styles.railWrap}>
        <div className={styles.rail}>
          <div className={styles.railLine}>
            <div />
            {BLOQUES.map((b) => {
              const cert = CERTS[b.cert];
              return (
                <div
                  key={b.label}
                  className={styles.blk}
                  style={{
                    gridColumn: `span ${b.to - b.from + 1}`,
                    background: cert.soft,
                    color: cert.color,
                  }}
                >
                  {b.label}
                </div>
              );
            })}
          </div>

          <div className={styles.railLine}>
            <div className={styles.railLabel} />
            {SESIONES.map((s) => (
              <div key={s.n} className={`${styles.railWeek} ${styles.mono}`}>
                {s.n}
              </div>
            ))}
          </div>

          <div className={styles.railLine}>
            <div className={styles.railLabel}>Presencial · miércoles</div>
            {SESIONES.map((s) => {
              const cert = CERTS[s.cert];
              return (
                <div
                  key={s.n}
                  className={`${styles.cell} ${styles.cellPresencial} ${styles.mono} ${s.brk ? styles.brk : ''}`}
                  style={{ background: cert.color }}
                  title={`Semana ${s.n} · ${s.p} · ${s.prof}`}
                >
                  {inicial(s.prof)}
                </div>
              );
            })}
          </div>

          {FILAS_ONLINE.map((fila) => (
            <div key={fila.label} className={styles.railLine}>
              <div className={styles.railLabel}>{fila.label}</div>
              {SESIONES.map((s) => {
                if (!s.o) {
                  return (
                    <div
                      key={s.n}
                      className={`${styles.cell} ${styles.cellNone} ${styles.mono}`}
                      title={`Semana ${s.n} · la cohorte online aún no ha empezado`}
                    >
                      –
                    </div>
                  );
                }
                const cert = CERTS[s.cert];
                const prof = fila.prof(s);
                return (
                  <div
                    key={s.n}
                    className={`${styles.cell} ${styles.cellOnline} ${styles.mono} ${s.brk ? styles.brk : ''}`}
                    style={{ color: cert.color }}
                    title={`Semana ${s.n} · ${s.o} · ${prof}`}
                  >
                    {inicial(prof)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.legend}>
        {Object.values(CERTS).map((c) => (
          <span key={c.label}>
            <span className={styles.sw} style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
        <span>
          <span className={styles.sw} style={{ background: 'var(--ifm-color-emphasis-500)' }} />
          Relleno = presencial
        </span>
        <span>
          <span className={styles.swOutline} />
          Contorno = online
        </span>
        <span>
          <b>S</b>&nbsp;Salva&nbsp;&nbsp;<b>J</b>&nbsp;Javier&nbsp;&nbsp;<b>M</b>&nbsp;Moisés
        </span>
      </div>
    </div>
  );
}
