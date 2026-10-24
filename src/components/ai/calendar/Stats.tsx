import React, { useMemo } from 'react';
import { ONLINE, PRESENCIAL } from './data';
import styles from './calendar.module.css';

export default function Stats(): React.ReactElement {
  const stats = useMemo(() => {
    const total = PRESENCIAL.length + ONLINE.length * 2;

    return [
      { n: total, l: 'sesiones en total' },
      { n: PRESENCIAL.length, l: 'presenciales · miércoles' },
      { n: ONLINE.length, l: 'online 1 · martes' },
      { n: ONLINE.length, l: 'online 2 · martes' },
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
