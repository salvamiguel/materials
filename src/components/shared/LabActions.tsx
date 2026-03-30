import React from 'react';
import { VscGithub, VscVscode, VscRemote, VscRepoForked } from 'react-icons/vsc';

import styles from './LabActions.module.css';

interface LabActionsProps {
  repo: string;
  codespace?: boolean;
  devcontainer?: boolean;
  fork?: boolean;
  title?: string;
}

function repoToPath(repo: string): string {
  const match = repo.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
  return match ? match[1] : repo;
}

export default function LabActions({ repo, codespace = false, fork = false, title }: LabActionsProps) {
  const repoPath = repoToPath(repo);
  const vscodeUrl = `vscode://vscode.git/clone?url=${encodeURIComponent(repo)}`;
  const vscodeDevUrl = `https://vscode.dev/github/${repoPath}`;
  const codespacesUrl = `https://codespaces.new/${repoPath}`;

  return (
    <div className={styles.labActions}>
      {title && <span className={styles.title}>{title}</span>}
      <div className={styles.buttons}>
        <a
          href={repo}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          <VscGithub /> Abrir en GitHub
        </a>


        <a
          href={vscodeUrl}
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          <VscVscode /> Clonar en VSCode
        </a>

        <a
          href={vscodeDevUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          <VscRemote /> Abrir en vscode.dev
        </a>

        {fork && (
          <a
            href={`${repo}/fork`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnSecondary}`}
          >
            <VscRepoForked /> Crea tu Fork
          </a>
        )}


        {codespace && (
          <a
            href={codespacesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnPrimary}`}
          >
            <VscRemote /> Abrir Codespace
          </a>
        )}
      </div>
    </div>
  );
}
