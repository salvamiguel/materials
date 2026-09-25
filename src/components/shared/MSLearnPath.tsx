import React from 'react';
import type { IconType } from 'react-icons';
import {
  FaMicrosoft,
  FaRoute,
  FaBookOpen,
  FaClipboardCheck,
  FaCloud,
  FaArrowRight,
  FaExternalLinkAlt,
} from 'react-icons/fa';

import styles from './MSLearnPath.module.css';

type Tipo = 'ruta' | 'modulo' | 'examen' | 'sandbox';

const TIPOS: Record<Tipo, { label: string; cta: string; icon: IconType; className: string }> = {
  ruta: { label: 'Ruta de aprendizaje', cta: 'Abrir ruta', icon: FaRoute, className: styles.tipoRuta },
  modulo: { label: 'Módulo', cta: 'Abrir módulo', icon: FaBookOpen, className: styles.tipoModulo },
  examen: { label: 'Guía del examen', cta: 'Ver guía', icon: FaClipboardCheck, className: styles.tipoExamen },
  sandbox: { label: 'Sandbox gratuito', cta: 'Abrir sandbox', icon: FaCloud, className: styles.tipoSandbox },
};

interface MSLearnPathProps {
  title: string;
  url: string;
  tipo?: Tipo;
  children?: React.ReactNode;
}

function abrirVentana(e: React.MouseEvent<HTMLAnchorElement>, url: string) {
  const width = Math.min(1280, window.screen.availWidth);
  const height = Math.min(900, window.screen.availHeight);
  const left = Math.max(0, (window.screen.availWidth - width) / 2);
  const top = Math.max(0, (window.screen.availHeight - height) / 2);
  const win = window.open(url, '_blank', `popup,width=${width},height=${height},left=${left},top=${top}`);
  // Si el navegador bloquea el popup, el enlace abre una pestaña nueva con target="_blank".
  if (win) {
    win.opener = null;
    e.preventDefault();
  }
}

export default function MSLearnPath({ title, url, tipo = 'ruta', children }: MSLearnPathProps) {
  const t = TIPOS[tipo];
  const Icon = t.icon;

  return (
    <div className={styles.card}>
      <FaMicrosoft className={styles.watermark} aria-hidden="true" />

      <div className={styles.header}>
        <div className={styles.logo} aria-hidden="true">
          <FaMicrosoft />
        </div>
        <div className={styles.brand}>
          <span className={styles.brandName}>Microsoft Learn</span>
          <span className={`${styles.tipo} ${t.className}`}>
            <Icon aria-hidden="true" /> {t.label}
          </span>
        </div>
      </div>

      <div className={styles.title}>{title}</div>
      {children && <div className={styles.desc}>{children}</div>}

      <div className={styles.footer}>
        <span className={styles.meta}>
          <FaExternalLinkAlt aria-hidden="true" /> learn.microsoft.com · gratis · nueva ventana
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.cta}
          onClick={(e) => abrirVentana(e, url)}
          aria-label={`${t.cta}: ${title} (se abre en una ventana nueva)`}
        >
          {t.cta} <FaArrowRight className={styles.arrow} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
