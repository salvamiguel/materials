import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { SiKubernetes, SiTerraform } from 'react-icons/si';
import { VscGithub, VscVscode, VscRemote, VscRepoForked } from 'react-icons/vsc';

import styles from './LabActions.module.css';

interface LabActionsProps {
  repo: string;
  codespace?: boolean;
  devcontainer?: boolean;
  fork?: boolean;
  vscode?: boolean;
  vscodeDev?: boolean;
  title?: string;
  /** Opens the repo in the Terraform playground: true (default branch) or one button per branch. */
  playground?: boolean | string[];
  /** Opens the repo's YAML (manifests, kustomizations, Helm charts) in the Kubernetes playground: true or one button per branch. */
  k8s?: boolean | string[];
  /** Subdirectory of the repo to open in the Kubernetes playground. */
  k8sPath?: string;
}

function repoToPath(repo: string): string {
  const match = repo.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
  return match ? match[1] : repo;
}

export default function LabActions({ repo, codespace = false, fork = false, vscode = true, vscodeDev = true, title, playground = false, k8s = false, k8sPath }: LabActionsProps) {
  const repoPath = repoToPath(repo);
  const playgroundUrl = useBaseUrl('/terraform-playground');
  const playgroundLinks = (playground === true ? [''] : playground || []).map((ref) => ({
    ref,
    href: `${playgroundUrl}?repo=${repoPath}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`,
  }));
  const k8sUrl = useBaseUrl('/k8s-playground');
  const k8sLinks = (k8s === true ? [''] : k8s || []).map((ref) => ({
    ref,
    href: `${k8sUrl}?repo=${repoPath}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}${k8sPath ? `&path=${encodeURIComponent(k8sPath)}` : ''}`,
  }));
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
          className={`${styles.btn} ${styles.btnPrimary}`}
        >
          <VscGithub /> Abrir en GitHub
        </a>

        {playgroundLinks.map(({ ref, href }) => (
          <a
            key={ref}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnPrimary}`}
            title={`Carga los ficheros .tf${ref ? ` de la rama ${ref}` : ''} en el playground de Terraform`}
          >
            <SiTerraform /> {ref ? `Playground (${ref})` : 'Abrir en el playground'}
          </a>
        ))}

        {k8sLinks.map(({ ref, href }) => (
          <a
            key={`k8s-${ref}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnPrimary}`}
            title={`Carga los manifiestos${ref ? ` de la rama ${ref}` : ''} en el playground de Kubernetes`}
          >
            <SiKubernetes /> {ref ? `Kubernetes (${ref})` : 'Abrir en el playground de Kubernetes'}
          </a>
        ))}

        {vscode && (
          <a
            href={vscodeUrl}
            className={`${styles.btn} ${styles.btnSecondary}`}
          >
            <VscVscode /> Clonar en VSCode
          </a>
        )}

        {vscodeDev && (
          <a
            href={vscodeDevUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.btn} ${styles.btnSecondary}`}
          >
            <VscRemote /> Abrir en vscode.dev
          </a>
        )}

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
