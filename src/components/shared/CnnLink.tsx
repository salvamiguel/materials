import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { FaLayerGroup } from 'react-icons/fa';

import styles from './LabActions.module.css';

/** Button that opens the interactive convolutional network demo. */
export default function CnnLink({ children }: { children?: React.ReactNode }) {
  const url = useBaseUrl('/cnn');
  return (
    <div className={styles.labActions}>
      <div className={styles.buttons}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnPrimary}`}
          title="Diseña filtros, mira los mapas de activación y entrena una red tipo LeNet"
        >
          <FaLayerGroup /> {children || 'Prueba la red convolucional interactiva'}
        </a>
      </div>
    </div>
  );
}
