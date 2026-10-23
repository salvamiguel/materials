import React from 'react';
import { CERTS, SESIONES, PROF_ONLINE_2, Profesor, Sesion, parseFecha } from './data';
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

/** Primera y última fecha del bloque; online y presencial ya no van al mismo ritmo, así que se comparan todas. */
function rangoFechas(semanas: Sesion[], online2?: boolean): [string, string] {
  const fechas = semanas.flatMap((s) => (online2 ? [s.o] : [s.o, s.p])).filter((f): f is string => Boolean(f));
  fechas.sort((a, b) => parseFecha(a).getTime() - parseFecha(b).getTime());
  return [fechas[0], fechas[fechas.length - 1]];
}

/** «3–8 · 14–20»: las semanas del bloque agrupadas en tramos consecutivos. */
function tramosSemanas(semanas: Sesion[]): string {
  const tramos: Array<[number, number]> = [];
  semanas.forEach(({ n }) => {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo[1] === n - 1) ultimo[1] = n;
    else tramos.push([n, n]);
  });
  const texto = tramos.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(' · ');
  return `${semanas.length === 1 ? 'Semana' : 'Semanas'} ${texto}`;
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
          const [desde, hasta] = rangoFechas(g.semanas, g.online2);
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
                  {tramosSemanas(g.semanas)}
                </span>
              </div>
              <div className={`${styles.blockDates} ${styles.mono}`}>
                {desde} → {hasta} · {sesiones} sesiones
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
