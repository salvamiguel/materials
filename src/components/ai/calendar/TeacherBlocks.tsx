import React from 'react';
import { CERTS, SESIONES, Profesor, Sesion } from './data';
import styles from './calendar.module.css';

interface Grupo {
  prof: Profesor;
  semanas: Sesion[];
}

function agrupar(sesiones: Sesion[]): Grupo[] {
  const grupos: Grupo[] = [];
  sesiones.forEach((s) => {
    const ultimo = grupos[grupos.length - 1];
    const continua = ultimo && ultimo.prof === s.prof && ultimo.semanas[ultimo.semanas.length - 1].n === s.n - 1;
    if (continua) {
      ultimo.semanas.push(s);
    } else {
      grupos.push({ prof: s.prof, semanas: [s] });
    }
  });
  return grupos;
}

export default function TeacherBlocks(): React.ReactElement {
  const grupos = agrupar(SESIONES);

  return (
    <div className={styles.calWrapper}>
      <div className={styles.blocks}>
        {grupos.map((g) => {
          const first = g.semanas[0];
          const last = g.semanas[g.semanas.length - 1];
          const sesiones = g.semanas.reduce((acc, s) => acc + (s.o ? 2 : 1), 0);
          const blockClass = g.prof === 'Salva' ? styles.blockSalva : styles.blockJavier;

          return (
            <div key={`${g.prof}-${first.n}`} className={`${styles.block} ${blockClass}`}>
              <div className={styles.blockHead}>
                <span className={styles.blockWho}>{g.prof}</span>
                <span className={`${styles.blockWeeks} ${styles.mono}`}>
                  {g.semanas.length === 1 ? `Semana ${first.n}` : `Semanas ${first.n}–${last.n}`}
                </span>
              </div>
              <div className={`${styles.blockDates} ${styles.mono}`}>
                {(first.o || first.p)} → {last.p} · {sesiones} sesiones
              </div>
              <ul className={styles.blockList}>
                {g.semanas.map((s) => {
                  const cert = CERTS[s.cert];
                  return (
                    <li key={s.n} className={styles.blockItem}>
                      <span className={styles.chip} style={{ background: cert.soft, color: cert.color }}>
                        <span className={styles.dot} style={{ background: cert.color }} />
                        {cert.label}
                      </span>
                      <span>{s.tema}</span>
                      <span className={`${styles.blockItemMeta} ${styles.mono}`}>
                        {s.o ? `${s.o} online · ` : ''}
                        {s.p} presencial
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
