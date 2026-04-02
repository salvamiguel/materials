import React, { useEffect, useRef, useState } from 'react';
import CodeBlock from '@theme/CodeBlock';

import styles from './GitHubCode.module.css';

interface GitHubCodeProps {
  url: string;
  language: string;
  title?: string;
  highlightLines?: string;
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

function createSvgIcon(pathD: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('stroke-width', '0');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('height', '1em');
  svg.setAttribute('width', '1em');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}

const FILE_ICON_PATH =
  'M10.57 1.14l3.28 3.3.15.17v9.89a1.5 1.5 0 01-1.5 1.5h-9a1.5 1.5 0 01-1.5-1.5v-12a1.5 1.5 0 011.5-1.5h6.9l.17.14zM10 5h3l-3-3v3zM3.5 14.5h9a.5.5 0 00.5-.5V6h-4V2H3.5a.5.5 0 00-.5.5v11.5a.5.5 0 00.5.5z';

const GITHUB_ICON_PATH =
  'M8 .2C3.6.2 0 3.8 0 8.15c0 3.51 2.27 6.5 5.42 7.55.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.2.48-2.67-1.06-2.67-1.06-.36-.92-.88-1.16-.88-1.16-.72-.5.05-.49.05-.49.8.06 1.22.82 1.22.82.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.76-.2-3.61-.88-3.61-3.93 0-.87.31-1.58.82-2.14-.08-.2-.36-1.01.08-2.1 0 0 .67-.22 2.2.82a7.65 7.65 0 014.01 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.9.08 2.1.51.56.82 1.27.82 2.14 0 3.06-1.86 3.73-3.63 3.93.29.25.54.74.54 1.49 0 1.08-.01 1.95-.01 2.21 0 .22.15.46.55.38A8.01 8.01 0 0016 8.15C16 3.8 12.4.2 8 .2z';

export default function GitHubCode({ url, language, title, highlightLines }: GitHubCodeProps) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(toRawUrl(url))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(setCode)
      .catch((err) => setError(err.message));
  }, [url]);

  useEffect(() => {
    if (!code || !containerRef.current) return;
    const buttonGroup = containerRef.current.querySelector(
      '[class*="buttonGroup"]',
    );
    if (!buttonGroup || buttonGroup.querySelector(`.${styles.ghBtn}`)) return;

    const fileLink = document.createElement('a');
    fileLink.href = url;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener noreferrer';
    fileLink.className = styles.ghBtn;
    fileLink.title = 'Ver fichero';
    fileLink.appendChild(createSvgIcon(FILE_ICON_PATH));

    const repoLink = document.createElement('a');
    repoLink.href = toRepoUrl(url);
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoLink.className = styles.ghBtn;
    repoLink.title = 'Ver repositorio';
    repoLink.appendChild(createSvgIcon(GITHUB_ICON_PATH));

    buttonGroup.insertBefore(repoLink, buttonGroup.firstChild);
    buttonGroup.insertBefore(fileLink, buttonGroup.firstChild);
  }, [code, url]);

  return (
    <div className={styles.container} ref={containerRef}>
      {error && <p className={styles.error}>Error al cargar el fichero: {error}</p>}

      {code === null && !error && <p className={styles.loading}>Cargando...</p>}

      {code !== null && (
        <CodeBlock
          language={language}
          title={title || getFileName(url)}
          metastring={highlightLines ? `{${highlightLines}}` : undefined}
        >
          {code}
        </CodeBlock>
      )}
    </div>
  );
}
