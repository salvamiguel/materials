import React from 'react';
import type { IconType } from 'react-icons';
import {
  FaAws,
  FaFlask,
  FaBookOpen,
  FaComments,
  FaGamepad,
  FaTrophy,
  FaClipboardCheck,
  FaRoute,
  FaArrowRight,
  FaExternalLinkAlt,
} from 'react-icons/fa';

import styles from './SkillBuilderLab.module.css';

type Tipo = 'lab' | 'curso' | 'simulearn' | 'cloud-quest' | 'jam' | 'examen' | 'plan';

const TIPOS: Record<Tipo, { label: string; cta: string; icon: IconType; className: string }> = {
  lab: { label: 'Lab', cta: 'Abrir laboratorio', icon: FaFlask, className: styles.tipoLab },
  curso: { label: 'Curso', cta: 'Abrir curso', icon: FaBookOpen, className: styles.tipoCurso },
  simulearn: { label: 'AWS SimuLearn', cta: 'Abrir simulación', icon: FaComments, className: styles.tipoSimulearn },
  'cloud-quest': { label: 'AWS Cloud Quest', cta: 'Jugar', icon: FaGamepad, className: styles.tipoQuest },
  jam: { label: 'AWS Jam', cta: 'Entrar al Jam', icon: FaTrophy, className: styles.tipoJam },
  examen: { label: 'Examen de práctica', cta: 'Hacer examen', icon: FaClipboardCheck, className: styles.tipoExamen },
  plan: { label: 'Plan de aprendizaje', cta: 'Ver plan', icon: FaRoute, className: styles.tipoPlan },
};

interface SkillBuilderLabProps {
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

export default function SkillBuilderLab({ title, url, tipo = 'lab', children }: SkillBuilderLabProps) {
  const t = TIPOS[tipo];
  const Icon = t.icon;

  return (
    <div className={styles.card}>
      <FaAws className={styles.watermark} aria-hidden="true" />

      <div className={styles.header}>
        <div className={styles.logo} aria-hidden="true">
          <FaAws />
        </div>
        <div className={styles.brand}>
          <span className={styles.brandName}>AWS Skill Builder</span>
          <span className={`${styles.tipo} ${t.className}`}>
            <Icon aria-hidden="true" /> {t.label}
          </span>
        </div>
      </div>

      <div className={styles.title}>{title}</div>
      {children && <div className={styles.desc}>{children}</div>}

      <div className={styles.footer}>
        <span className={styles.meta}>
          <FaExternalLinkAlt aria-hidden="true" /> skillbuilder.aws · nueva ventana
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
