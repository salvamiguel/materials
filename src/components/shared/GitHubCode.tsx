import React, { useEffect, useState } from 'react';
import CodeBlock from '@theme/CodeBlock';
import { VscGithub, VscFile } from 'react-icons/vsc';

import styles from './GitHubCode.module.css';

interface GitHubCodeProps {
  url: string;
  language: string;
  title?: string;
}

function toRawUrl(url: string): string {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/,
  );
  if (!match) return url;
  const [, owner, repo, branch, path] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

function toRepoUrl(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? `https://github.com/${match[1]}` : url;
}

function getFileName(url: string): string {
  return url.split('/').pop() || 'file';
}

export default function GitHubCode({ url, language, title }: GitHubCodeProps) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(toRawUrl(url))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(setCode)
      .catch((err) => setError(err.message));
  }, [url]);

  return (
    <div className={styles.container}>
      <div className={styles.buttons}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          <VscFile /> Ver fichero
        </a>
        <a
          href={toRepoUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.btn} ${styles.btnSecondary}`}
        >
          <VscGithub /> Ver Repositorio
        </a>
      </div>

      {error && <p className={styles.error}>Error al cargar el fichero: {error}</p>}

      {code === null && !error && <p className={styles.loading}>Cargando...</p>}

      {code !== null && (
        <CodeBlock language={language} title={title || getFileName(url)}>
          {code}
        </CodeBlock>
      )}
    </div>
  );
}
