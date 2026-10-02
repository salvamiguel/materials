import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { FaLanguage } from 'react-icons/fa';

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
          title="Un Transformer que traduce del español al inglés: entrénalo y mira su atención"
        >
          <FaLanguage /> {children || 'Prueba el Transformer interactivo'}
        </a>
      </div>
    </div>
  );
}
