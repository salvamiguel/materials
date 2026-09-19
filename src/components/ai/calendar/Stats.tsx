import React, { useMemo } from 'react';
import { SESIONES } from './data';
import styles from './calendar.module.css';

export default function Stats(): React.ReactElement {
  const stats = useMemo(() => {
    const presenciales = SESIONES.length;
    const online = SESIONES.filter((s) => s.o).length;
    const total = presenciales + online;
    const porProfesor = SESIONES.reduce<Record<string, number>>((acc, s) => {
      acc[s.prof] = (acc[s.prof] ?? 0) + (s.o ? 2 : 1);
      return acc;
    }, {});

    return [
      { n: total, l: 'sesiones en total' },
      { n: presenciales, l: 'presenciales · miércoles' },
      { n: online, l: 'online · martes' },
      { n: `${porProfesor.Salva ?? 0} / ${porProfesor.Javier ?? 0}`, l: 'Salva / Javier' },
    ];
  }, []);

  return (
    <div className={styles.calWrapper}>
      <div className={styles.stats}>
        {stats.map((s) => (
          <div key={s.l} className={styles.stat}>
            <div className={`${styles.statNumber} ${styles.mono}`}>{s.n}</div>
            <div className={styles.statLabel}>{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
