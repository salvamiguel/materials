import React from 'react';
import { VscSettingsGear, VscVscode } from 'react-icons/vsc';
import styles from './OpenSettings.module.css';

interface OpenSettingsProps {
  setting: string;
  label?: string;
}

export default function OpenSettings({ setting, label }: OpenSettingsProps) {
  const settingsUrl = `vscode://settings/${setting}`;
  const displayLabel = label || setting;

  return (
    <a
      href={settingsUrl}
      className={styles.btn}
    >
      <VscSettingsGear /> Abrir {displayLabel} en <VscVscode />
    </a>
  );
}
