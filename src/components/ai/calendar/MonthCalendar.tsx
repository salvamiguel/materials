import React, { useMemo } from 'react';
import { CERTS, SESIONES, MESES_CALENDARIO, inicial, CertKey, Profesor } from './data';
import styles from './calendar.module.css';

interface Marca {
  modo: 'online' | 'presencial';
  cert: CertKey;
  prof: Profesor;
  n: number;
}

function clave(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

const NOMBRE_MES = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export default function MonthCalendar(): React.ReactElement {
  const marcas = useMemo(() => {
    const map = new Map<string, Marca>();
    SESIONES.forEach((s) => {
      if (s.o) map.set(s.o, { modo: 'online', cert: s.cert, prof: s.prof, n: s.n });
      map.set(s.p, { modo: 'presencial', cert: s.cert, prof: s.prof, n: s.n });
    });
    return map;
  }, []);

  return (
    <div className={styles.calWrapper}>
      <div className={styles.months}>
        {MESES_CALENDARIO.map(([y, m]) => {
          const primero = new Date(y, m, 1);
          const offset = (primero.getDay() + 6) % 7;
          const inicio = new Date(y, m, 1 - offset);
          const dias: Date[] = [];
          for (let i = 0; i < 42; i++) {
            const dt = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
            if (i >= 35 && dt.getMonth() !== m) break;
            dias.push(dt);
          }

          return (
            <div key={`${y}-${m}`} className={styles.month}>
              <h3>{NOMBRE_MES.format(new Date(y, m, 1))}</h3>
              <div className={styles.mgrid}>
                {DIAS_SEMANA.map((d) => (
                  <div key={d} className={styles.wd}>
                    {d}
                  </div>
                ))}
                {dias.map((dt) => {
                  const enMes = dt.getMonth() === m;
                  const info = enMes ? marcas.get(clave(dt)) : undefined;
                  return (
                    <div
                      key={dt.toISOString()}
                      className={`${styles.day} ${!enMes ? styles.dayOut : ''} ${info ? styles.dayHas : ''}`}
                    >
                      <span className={`${styles.dnum} ${styles.mono}`}>{dt.getDate()}</span>
                      {info && (
                        <span
                          className={`${styles.dmark} ${styles.mono}`}
                          style={{ background: CERTS[info.cert].soft, color: CERTS[info.cert].color }}
                          title={`Semana ${info.n} · ${info.modo === 'presencial' ? 'Presencial' : 'Online'} · ${info.prof}`}
                        >
                          {(info.modo === 'presencial' ? 'P' : 'O') + '·' + inicial(info.prof)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
