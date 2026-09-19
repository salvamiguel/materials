import React from 'react';
import { CERTS, BLOQUES, SESIONES, inicial } from './data';
import styles from './calendar.module.css';

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

          <div className={styles.railLine}>
            <div className={styles.railLabel}>Online · martes</div>
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
              return (
                <div
                  key={s.n}
                  className={`${styles.cell} ${styles.cellOnline} ${styles.mono} ${s.brk ? styles.brk : ''}`}
                  style={{ color: cert.color }}
                  title={`Semana ${s.n} · ${s.o} · ${s.prof}`}
                >
                  {inicial(s.prof)}
                </div>
              );
            })}
          </div>
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
          <b>S</b>&nbsp;Salva&nbsp;&nbsp;<b>J</b>&nbsp;Javier
        </span>
      </div>
    </div>
  );
}
