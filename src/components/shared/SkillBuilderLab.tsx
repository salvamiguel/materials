import React from 'react';
import { FaAws } from 'react-icons/fa';
import { VscLinkExternal } from 'react-icons/vsc';

import styles from './SkillBuilderLab.module.css';

type Tipo = 'lab' | 'curso' | 'simulearn' | 'cloud-quest' | 'jam' | 'examen' | 'plan';

const TIPOS: Record<Tipo, string> = {
  lab: 'Lab',
  curso: 'Curso',
  simulearn: 'AWS SimuLearn',
  'cloud-quest': 'AWS Cloud Quest',
  jam: 'AWS Jam',
  examen: 'Examen de práctica',
  plan: 'Plan de aprendizaje',
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
  return (
    <div className={styles.card}>
      <FaAws className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>
        <span className={styles.tipo}>AWS Skill Builder · {TIPOS[tipo]}</span>
        <span className={styles.title}>{title}</span>
        {children && <div className={styles.desc}>{children}</div>}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.btn}
        onClick={(e) => abrirVentana(e, url)}
      >
        Abrir <VscLinkExternal />
      </a>
    </div>
  );
}
