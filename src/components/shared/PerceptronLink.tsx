import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { FaBrain } from 'react-icons/fa';

import styles from './LabActions.module.css';

/** Button that opens the interactive perceptron demo. */
export default function PerceptronLink({ children }: { children?: React.ReactNode }) {
  const url = useBaseUrl('/perceptron');
  return (
    <div className={styles.labActions}>
      <div className={styles.buttons}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnPrimary}`}
          title="Una réplica del Perceptrón Mark I: gira los pesos y entrénalo"
        >
          <FaBrain /> {children || 'Prueba el perceptrón interactivo'}
        </a>
      </div>
    </div>
  );
}
