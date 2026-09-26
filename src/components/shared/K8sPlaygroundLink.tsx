import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { SiKubernetes } from 'react-icons/si';

import styles from './LabActions.module.css';

interface Props {
  /** Id of a built-in example (src/components/playground/k8s/examples.ts). */
  example?: string;
  children?: React.ReactNode;
}

/** Button that opens the Kubernetes playground, optionally with one of its examples loaded. */
export default function K8sPlaygroundLink({ example, children }: Props) {
  const url = useBaseUrl('/k8s-playground');
  return (
    <div className={styles.labActions}>
      <div className={styles.buttons}>
        <a
          href={example ? `${url}?example=${encodeURIComponent(example)}` : url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnPrimary}`}
          title="Un clúster simulado en tu navegador, con diagrama en vivo"
        >
          <SiKubernetes /> {children || 'Pruébalo en el playground de Kubernetes'}
        </a>
      </div>
    </div>
  );
}
