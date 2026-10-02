import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { FaRobot } from 'react-icons/fa';

import styles from './LabActions.module.css';

/** Button that opens the interactive Transformer demo. */
export default function TransformerLink({ children }: { children?: React.ReactNode }) {
  const url = useBaseUrl('/transformer');
  return (
    <div className={styles.labActions}>
      <div className={styles.buttons}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnPrimary}`}
          title="Un Transformer que predice la siguiente palabra, como GPT: entrénalo y mira a qué palabras atiende"
        >
          <FaRobot /> {children || 'Prueba el Transformer interactivo'}
        </a>
      </div>
    </div>
  );
}
