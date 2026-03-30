import React from 'react';
import { VscExtensions, VscVscode } from 'react-icons/vsc';
import styles from './InstallExtension.module.css';

interface InstallExtensionProps {
  id: string;
  label?: string;
}

export default function InstallExtension({ id, label }: InstallExtensionProps) {
  const extensionUrl = `vscode:extension/${id}`;
  const displayLabel = label || id;

  return (
    <a
      href={extensionUrl}
      className={styles.btn}
    >
      <VscExtensions /> Instala {displayLabel} en <VscVscode />
     </a>
  );
}
