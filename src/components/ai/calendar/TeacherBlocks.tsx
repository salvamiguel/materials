import React from 'react';
import { CERTS, ONLINE, PRESENCIAL, PROF_ONLINE_2, Profesor, Sesion, parseFecha } from './data';
import styles from './calendar.module.css';

interface Bloque {
  prof: Profesor;
  sesiones: Sesion[];
}

interface Modalidad {
  titulo: string;
  /** Texto que acompaña a la fecha de cada sesión en la lista. */
  meta: string;
  bloques: Bloque[];
}

const BLOCK_CLASS: Record<Profesor, string> = {
  Salva: styles.blockSalva,
  Javier: styles.blockJavier,
  Moisés: styles.blockMoises,
};

/** Tramos consecutivos de sesiones con el mismo profesor. */
function agrupar(sesiones: Sesion[], prof: (s: Sesion) => Profesor): Bloque[] {
  const bloques: Bloque[] = [];
  sesiones.forEach((s) => {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.prof === prof(s)) ultimo.sesiones.push(s);
    else bloques.push({ prof: prof(s), sesiones: [s] });
  });
  return bloques;
}

const MODALIDADES: Modalidad[] = [
  { titulo: 'Online 1 · martes', meta: 'online 1', bloques: agrupar(ONLINE, (s) => s.prof) },
  { titulo: 'Online 2 · martes', meta: 'online 2', bloques: agrupar(ONLINE, () => PROF_ONLINE_2) },
  { titulo: 'Presencial · miércoles', meta: 'presencial', bloques: agrupar(PRESENCIAL, (s) => s.prof) },
];

function tramo(sesiones: Sesion[]): string {
  const [a, b] = [sesiones[0].n, sesiones[sesiones.length - 1].n];
  return a === b ? `Clase ${a}` : `Clases ${a}–${b}`;
}

export default function TeacherBlocks(): React.ReactElement {
  return (
    <div className={styles.calWrapper}>
      {MODALIDADES.map((m) => (
        <section key={m.titulo}>
          <h3>{m.titulo}</h3>
          <div className={styles.blocks}>
            {m.bloques.map((b) => {
              const fechas = b.sesiones.map((s) => parseFecha(s.f));
              const desde = b.sesiones[0].f;
              const hasta = b.sesiones[b.sesiones.length - 1].f;
              return (
                <div key={`${b.prof}-${desde}`} className={`${styles.block} ${BLOCK_CLASS[b.prof]}`}>
                  <div className={styles.blockHead}>
                    <span className={styles.blockWho}>{b.prof}</span>
                    <span className={`${styles.blockWeeks} ${styles.mono}`}>{tramo(b.sesiones)}</span>
                  </div>
                  <div className={`${styles.blockDates} ${styles.mono}`}>
                    {fechas.length === 1 ? desde : `${desde} → ${hasta}`} · {b.sesiones.length}{' '}
                    {b.sesiones.length === 1 ? 'sesión' : 'sesiones'}
                  </div>
                  <ul className={styles.blockList}>
                    {b.sesiones.map((s) => {
                      const cert = CERTS[s.cert];
                      return (
                        <li key={s.n} className={styles.blockItem}>
                          <span className={styles.chip} style={{ background: cert.soft, color: cert.color }}>
                            <span className={styles.dot} style={{ background: cert.color }} />
                            {cert.label}
                          </span>
                          <span>{s.tema}</span>
                          <span className={`${styles.blockItemMeta} ${styles.mono}`}>
                            {s.f} {m.meta}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
