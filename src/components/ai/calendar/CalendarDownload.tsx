import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { FaLaptop, FaUniversity, FaApple, FaGoogle, FaMicrosoft } from 'react-icons/fa';
import { FiDownload, FiArrowUpRight, FiInfo } from 'react-icons/fi';

import { SESIONES, parseFecha } from './data';
import { GRUPOS, HORARIO, ICS_DIR, Grupo } from './ics';
import styles from './CalendarDownload.module.css';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fecha = (d: Date) => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;

function GrupoCard({ grupo }: { grupo: Grupo }) {
  const { siteConfig } = useDocusaurusContext();
  const g = GRUPOS[grupo];
  const path = useBaseUrl(`/${ICS_DIR}/${g.archivo}`);
  const httpsUrl = `${siteConfig.url}${path}`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

  const fechas = SESIONES.map((s) => (grupo === 'online' ? s.o : s.p))
    .filter((f): f is string => Boolean(f))
    .map(parseFecha);

  const Icon = grupo === 'online' ? FaLaptop : FaUniversity;
  const suscripciones = [
    { label: 'Apple', icon: FaApple, href: webcalUrl, externo: false },
    {
      label: 'Google',
      icon: FaGoogle,
      href: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`,
      externo: true,
    },
    {
      label: 'Outlook',
      icon: FaMicrosoft,
      href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(g.nombre)}`,
      externo: true,
    },
  ];

  return (
    <article className={`${styles.card} ${grupo === 'online' ? styles.online : styles.presencial}`}>
      <header className={styles.header}>
        <span className={styles.badge} aria-hidden="true">
          <Icon />
        </span>
        <div className={styles.count}>
          <span className={styles.countNumber}>{fechas.length}</span>
          <span className={styles.countLabel}>clases</span>
        </div>
      </header>

      <div className={styles.intro}>
        <span className={styles.eyebrow}>Grupo {grupo}</span>
        <h3 className={styles.title}>{g.dia}</h3>
        <span className={styles.time}>
          {HORARIO.inicio} – {HORARIO.fin}
        </span>
      </div>

      <dl className={styles.details}>
        <div>
          <dt>Inicio</dt>
          <dd>{fecha(fechas[0])}</dd>
        </div>
        <div>
          <dt>Fin</dt>
          <dd>{fecha(fechas[fechas.length - 1])}</dd>
        </div>
        <div>
          <dt>Lugar</dt>
          <dd>
            {g.direccion ? (
              <a
                className={styles.map}
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.mapa ?? g.lugar)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Ver en Google Maps"
              >
                <span>
                  {g.direccion[0]}
                  <br />
                  <span className={styles.muted}>{g.direccion[1]}</span>
                </span>
                <FiArrowUpRight aria-hidden="true" />
              </a>
            ) : (
              g.lugar
            )}
          </dd>
        </div>
      </dl>

      <footer className={styles.actions}>
        <a className={styles.download} href={path} download={g.archivo}>
          <FiDownload aria-hidden="true" />
          Descargar calendario
        </a>
        <div className={styles.subscribe}>
          <span className={styles.subscribeLabel}>Suscribirse</span>
          <span className={styles.subscribeLinks}>
            {suscripciones.map(({ label, icon: SIcon, href, externo }) => (
              <a
                key={label}
                href={href}
                title={`Suscribirse en ${label}`}
                {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <SIcon aria-hidden="true" /> {label}
              </a>
            ))}
          </span>
        </div>
      </footer>
    </article>
  );
}

export default function CalendarDownload(): React.ReactElement {
  return (
    <div className={styles.wrapper}>
      <div className={styles.grid}>
        <GrupoCard grupo="online" />
        <GrupoCard grupo="presencial" />
      </div>
      <p className={styles.note}>
        <FiInfo aria-hidden="true" />
        <span>
          Si te suscribes, el calendario se actualiza solo cuando cambie alguna fecha; la descarga es una copia fija.
          Cada clase incluye un aviso 30 minutos antes.
        </span>
      </p>
    </div>
  );
}
