import React from 'react';
import { CERTS, SESIONES, PROF_ONLINE_2, Profesor, Sesion } from './data';
import styles from './calendar.module.css';

interface Grupo {
  prof: Profesor;
  semanas: Sesion[];
  /** true para el bloque del grupo Online 2, que solo cuenta las sesiones online. */
  online2?: boolean;
}

const BLOCK_CLASS: Record<Profesor, string> = {
  Salva: styles.blockSalva,
  Javier: styles.blockJavier,
  Moisés: styles.blockMoises,
};

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
  const grupos = [
    ...agrupar(SESIONES),
    { prof: PROF_ONLINE_2, semanas: SESIONES.filter((s) => s.o), online2: true },
  ];

  return (
    <div className={styles.calWrapper}>
      <div className={styles.blocks}>
        {grupos.map((g) => {
          const first = g.semanas[0];
          const last = g.semanas[g.semanas.length - 1];
          const sesiones = g.online2 ? g.semanas.length : g.semanas.reduce((acc, s) => acc + (s.o ? 2 : 1), 0);
          const blockClass = BLOCK_CLASS[g.prof];

          return (
            <div key={`${g.prof}-${first.n}`} className={`${styles.block} ${blockClass}`}>
              <div className={styles.blockHead}>
                <span className={styles.blockWho}>
                  {g.prof}
                  {g.online2 && <span className={styles.blockGroup}> · Online 2</span>}
                </span>
                <span className={`${styles.blockWeeks} ${styles.mono}`}>
                  {g.semanas.length === 1 ? `Semana ${first.n}` : `Semanas ${first.n}–${last.n}`}
                </span>
              </div>
              <div className={`${styles.blockDates} ${styles.mono}`}>
                {first.o || first.p} → {g.online2 ? last.o : last.p} · {sesiones} sesiones
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
                        {g.online2 ? (
                          `${s.o} online 2`
                        ) : (
                          <>
                            {s.o ? `${s.o} online 1 · ` : ''}
                            {s.p} presencial
                          </>
                        )}
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
