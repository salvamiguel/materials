import React from 'react';
import { CERTS, ONLINE, PRESENCIAL, PROF_ONLINE_2, Profesor, Sesion, bloques, inicial } from './data';
import styles from './calendar.module.css';

interface Fila {
  label: string;
  modo: 'presencial' | 'online';
  prof: (s: Sesion) => Profesor;
}

const FILAS_PRESENCIAL: Fila[] = [{ label: 'Presencial · miércoles', modo: 'presencial', prof: (s) => s.prof }];

const FILAS_ONLINE: Fila[] = [
  { label: 'Online 1 · martes', modo: 'online', prof: (s) => s.prof },
  { label: 'Online 2 · martes', modo: 'online', prof: () => PROF_ONLINE_2 },
];

/** Una modalidad: tramos por certificación, numeración y una fila por grupo. */
function Rail({ sesiones, filas }: { sesiones: Sesion[]; filas: Fila[] }): React.ReactElement {
  return (
    <div className={styles.rail} style={{ '--semanas': sesiones.length } as React.CSSProperties}>
      <div className={styles.railLine}>
        <div />
        {bloques(sesiones).map((b, i) => {
          const cert = CERTS[b.cert];
          return (
            <div
              key={`${b.cert}-${i}`}
              className={styles.blk}
              title={b.label}
              style={{ gridColumn: `span ${b.n}`, background: cert.soft, color: cert.color }}
            >
              {b.n > 1 ? b.label : ''}
            </div>
          );
        })}
      </div>

      <div className={styles.railLine}>
        <div className={styles.railLabel} />
        {sesiones.map((s) => (
          <div key={s.n} className={`${styles.railWeek} ${styles.mono}`}>
            {s.n}
          </div>
        ))}
      </div>

      {filas.map((fila) => (
        <div key={fila.label} className={styles.railLine}>
          <div className={styles.railLabel}>{fila.label}</div>
          {sesiones.map((s) => {
            const cert = CERTS[s.cert];
            const prof = fila.prof(s);
            const presencial = fila.modo === 'presencial';
            return (
              <div
                key={s.n}
                className={`${styles.cell} ${presencial ? styles.cellPresencial : styles.cellOnline} ${styles.mono} ${s.brk ? styles.brk : ''}`}
                style={presencial ? { background: cert.color } : { color: cert.color }}
                title={`Clase ${s.n} · ${s.f} · ${prof}`}
              >
                {inicial(prof)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function WeekRail(): React.ReactElement {
  return (
    <div className={styles.calWrapper}>
      <div className={styles.railWrap}>
        <Rail sesiones={ONLINE} filas={FILAS_ONLINE} />
        <Rail sesiones={PRESENCIAL} filas={FILAS_PRESENCIAL} />
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
