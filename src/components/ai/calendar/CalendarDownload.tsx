import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { FaLaptop, FaUniversity, FaDownload, FaApple, FaGoogle, FaMicrosoft, FaClock, FaRegCalendarCheck } from 'react-icons/fa';

import { SESIONES, parseFecha } from './data';
import { GRUPOS, HORARIO, ICS_DIR, Grupo } from './ics';
import styles from './CalendarDownload.module.css';

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fechaCorta = (d: Date) => `${d.getDate()} ${MESES[d.getMonth()]}`;

function GrupoCard({ grupo }: { grupo: Grupo }) {
  const { siteConfig } = useDocusaurusContext();
  const g = GRUPOS[grupo];
  const path = useBaseUrl(`/${ICS_DIR}/${g.archivo}`);
  const httpsUrl = `${siteConfig.url}${path}`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

  const fechas = SESIONES.map((s) => (grupo === 'online' ? s.o : s.p))
    .filter((f): f is string => Boolean(f))
    .map(parseFecha);
  const primera = fechas[0];
  const ultima = fechas[fechas.length - 1];

  const Icon = grupo === 'online' ? FaLaptop : FaUniversity;

  return (
    <div className={`${styles.card} ${grupo === 'online' ? styles.online : styles.presencial}`}>
      <div className={styles.top}>
        <div className={styles.tile} aria-hidden="true">
          <span className={styles.tileMonth}>{MESES[primera.getMonth()]}</span>
          <span className={styles.tileDay}>{primera.getDate()}</span>
          <span className={styles.tileWeekday}>{DIAS[primera.getDay()]}</span>
        </div>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>
            <Icon aria-hidden="true" /> Grupo {grupo}
          </span>
          <span className={styles.title}>{g.dia}</span>
          <span className={styles.facts}>
            <span><FaRegCalendarCheck aria-hidden="true" /> {fechas.length} clases</span>
            <span><FaClock aria-hidden="true" /> {HORARIO.inicio}–{HORARIO.fin}</span>
          </span>
        </div>
      </div>

      <div className={styles.range}>
        <span>Primera clase <b>{fechaCorta(primera)}</b></span>
        <span className={styles.rangeLine} aria-hidden="true" />
        <span>Última <b>{fechaCorta(ultima)}</b></span>
      </div>

      <a className={styles.download} href={path} download={g.archivo}>
        <FaDownload aria-hidden="true" /> Descargar .ics
      </a>

      <div className={styles.apps}>
        <a className={styles.app} href={webcalUrl} title="Suscribirse en Apple Calendar u otra app compatible">
          <FaApple aria-hidden="true" /> Apple
        </a>
        <a
          className={styles.app}
          href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Suscribirse en Google Calendar"
        >
          <FaGoogle aria-hidden="true" /> Google
        </a>
        <a
          className={styles.app}
          href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(g.nombre)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Suscribirse en Outlook"
        >
          <FaMicrosoft aria-hidden="true" /> Outlook
        </a>
      </div>
    </div>
  );
}

export default function CalendarDownload(): React.ReactElement {
  return (
    <div className={styles.wrapper}>
      <div className={styles.grid}>
        <GrupoCard grupo="online" />
        <GrupoCard grupo="presencial" />
      </div>
      <details className={styles.help}>
        <summary>¿Descargar o suscribirse?</summary>
        <ul>
          <li>
            <b>Apple, Google u Outlook</b> te suscriben al calendario: si cambia alguna fecha, se actualiza solo.
            Es la opción recomendada.
          </li>
          <li>
            <b>Descargar .ics</b> importa una copia de las clases en cualquier app de calendario, pero no recibe
            cambios.
          </li>
          <li>Cada clase incluye un aviso 30 minutos antes.</li>
        </ul>
      </details>
    </div>
  );
}
