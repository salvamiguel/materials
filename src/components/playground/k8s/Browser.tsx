// The Browser tab: an address bar over the simulated network (port-forwards
// on localhost, Ingress hosts, NodePorts). HTML pages render in a sandboxed
// iframe (no scripts); argocd-server renders the ArgoCD UI.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TbArrowLeft, TbArrowRight, TbLock, TbLockOpen, TbReload, TbWorld } from 'react-icons/tb';
import type { Cluster } from './engine/cluster';
import { httpGet, type HttpResponse } from './engine/net';
import ArgoUI from './argocd/ArgoUI';
import styles from './k8s.module.css';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Props {
  cl: Cluster;
  url: string;
  onUrl: (url: string) => void;
  /** Changes whenever the cluster does (re-render). */
  rv: number;
  onChange: () => void;
  iconBase: string;
  defaultRepo?: string;
}

type Page = { res: HttpResponse } | { error: string; code: number };

function normalize(u: string): string {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//.test(t) ? t : `http://${t}`;
}

function split(url: string): { scheme: string; host: string; path: string } {
  const m = /^(https?):\/\/([^/?#]+)(.*)$/.exec(url) || [];
  return { scheme: m[1] || 'http', host: m[2] || '', path: m[3] || '/' };
}

/** Addresses worth offering: port-forwards and Ingress hosts. */
function suggestions(cl: Cluster): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  for (const pf of cl.s.portForwards) {
    const target = cl.get(pf.kind, pf.namespace, pf.name);
    const argo = target && /argocd-server/.test(pf.name);
    const https = argo || pf.port === 443;
    out.push({
      url: `${https ? 'https' : 'http'}://localhost:${pf.local}`,
      label: `${pf.kind === 'Service' ? 'svc' : pf.kind.toLowerCase()}/${pf.name} (${pf.namespace})`,
    });
  }
  for (const ing of cl.list('Ingress'))
    for (const r of ing.spec?.rules || [])
      if (r.host) out.push({ url: `http://${r.host}${r.http?.paths?.[0]?.path || '/'}`, label: `ingress/${ing.metadata.name}` });
  return out;
}

export default function Browser({ cl, url, onUrl, rv, onChange, iconBase, defaultRepo }: Props) {
  const [input, setInput] = useState(url);
  const [page, setPage] = useState<Page | undefined>();
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [trusted, setTrusted] = useState<Record<string, boolean>>({});
  const [loads, setLoads] = useState(0);

  useEffect(() => setInput(url), [url]);

  const fetchPage = useCallback((): Page | undefined => {
    if (!url) return undefined;
    const r = httpGet(cl, url, {});
    return 'error' in r ? r : { res: r };
  }, [cl, url]);

  // Load on navigation and poll every 2 s (the class page refreshes itself;
  // a port-forward that dies turns into an error page).
  useEffect(() => {
    setPage(fetchPage());
    const t = setInterval(() => {
      setPage((prev) => {
        const next = fetchPage();
        if (!prev || !next) return next;
        if ('res' in prev && 'res' in next && prev.res.body === next.res.body && prev.res.status === next.res.status && !!prev.res.argocd === !!next.res.argocd)
          return prev;
        if ('error' in prev && 'error' in next && prev.error === next.error) return prev;
        return next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, [fetchPage, loads]);

  const go = (u: string) => {
    const n = normalize(u);
    if (!n) return;
    if (url) setBack((b) => [...b.slice(-30), url]);
    setFwd([]);
    onUrl(n);
    setLoads((x) => x + 1);
  };

  const { scheme, host, path } = split(url);
  const sugg = useMemo(() => suggestions(cl), [cl, rv]); // eslint-disable-line react-hooks/exhaustive-deps

  let content: React.ReactNode;
  if (!url) {
    content = (
      <div className={styles.browserBlank}>
        <TbWorld className={styles.browserBlankIcon} aria-hidden />
        <p>
          Este navegador llega a lo que llegaría el de tu portátil: un <code>kubectl port-forward … &amp;</code> en <code>localhost</code>, los hosts de un
          Ingress o un NodePort.
        </p>
        {!sugg.length && (
          <p>
            Prueba: <code>kubectl port-forward svc/argocd-server -n argocd 8443:443 &amp;</code> y abre <code>https://localhost:8443</code>.
          </p>
        )}
      </div>
    );
  } else if (!page) content = null;
  else if ('error' in page) {
    const refused = page.code === 7 || page.code === 52;
    content = (
      <div className={styles.browserError}>
        <h3>{page.code === 6 ? 'No se puede acceder a este sitio' : 'No se puede acceder a este sitio web'}</h3>
        <p>
          {page.code === 6 ? (
            <>
              No se ha encontrado la dirección IP del servidor de <b>{host.split(':')[0]}</b>.
            </>
          ) : refused ? (
            <>
              <b>{host}</b> ha rechazado la conexión.
            </>
          ) : (
            page.error
          )}
        </p>
        <code className={styles.browserCode}>
          {page.code === 6 ? 'DNS_PROBE_FINISHED_NXDOMAIN' : refused ? 'ERR_CONNECTION_REFUSED' : 'ERR_CONNECTION_TIMED_OUT'}
        </code>
        {/^(localhost|127\.0\.0\.1)/.test(host) && (
          <p className={styles.browserHint}>
            ¿Está corriendo el port-forward? Lánzalo en segundo plano, p. ej.{' '}
            <code>kubectl port-forward svc/NOMBRE {host.split(':')[1] || '8080'}:80 &amp;</code> (lo ves con <code>jobs</code>).
          </p>
        )}
      </div>
    );
  } else if (page.res.argocd) {
    if (scheme !== 'https') {
      // argocd-server redirects plain HTTP to HTTPS.
      content = (
        <div className={styles.browserError}>
          <h3>307 Temporary Redirect</h3>
          <p>argocd-server solo habla HTTPS.</p>
          <button type="button" className={styles.browserBtn} onClick={() => go(url.replace(/^http:/, 'https:'))}>
            Ir a {url.replace(/^http:/, 'https:')}
          </button>
        </div>
      );
    } else if (!trusted[host]) {
      content = (
        <div className={`${styles.browserError} ${styles.browserCert}`}>
          <TbLockOpen className={styles.browserCertIcon} aria-hidden />
          <h3>La conexión no es privada</h3>
          <p>
            <b>{host}</b> usa un certificado autofirmado (el que genera argocd-server al arrancar). Es lo mismo que te dice <code>curl</code> sin{' '}
            <code>-k</code> o <code>argocd login</code> sin <code>--insecure</code>.
          </p>
          <code className={styles.browserCode}>NET::ERR_CERT_AUTHORITY_INVALID</code>
          <button type="button" className={styles.browserBtn} onClick={() => setTrusted((t) => ({ ...t, [host]: true }))}>
            Acceder a {host.split(':')[0]} (sitio no seguro)
          </button>
        </div>
      );
    } else {
      content = (
        <ArgoUI
          cl={cl}
          path={path === '/' ? '/applications' : path}
          onNavigate={(p) => go(`${scheme}://${host}${p}`)}
          onChange={onChange}
          iconBase={iconBase}
          defaultRepo={defaultRepo}
        />
      );
    }
  } else if (scheme === 'https' && page.res.pod) {
    content = (
      <div className={styles.browserError}>
        <h3>Este sitio no puede proporcionar una conexión segura</h3>
        <p>
          <b>{host}</b> ha enviado una respuesta no válida: el servidor habla HTTP, no HTTPS.
        </p>
        <code className={styles.browserCode}>ERR_SSL_PROTOCOL_ERROR</code>
        <button type="button" className={styles.browserBtn} onClick={() => go(url.replace(/^https:/, 'http:'))}>
          Probar {url.replace(/^https:/, 'http:')}
        </button>
      </div>
    );
  } else if (/<html|<!doctype/i.test(page.res.body)) {
    content = <iframe className={styles.browserFrame} sandbox="" srcDoc={page.res.body} title={url} />;
  } else {
    let body = page.res.body;
    try {
      if (/^\s*[{[]/.test(body)) body = JSON.stringify(JSON.parse(body) as Json, null, 2);
    } catch {
      // not JSON after all
    }
    content = <pre className={styles.browserText}>{body}</pre>;
  }

  const secure = scheme === 'https';
  return (
    <div className={styles.browser}>
      <form
        className={styles.browserBar}
        onSubmit={(e) => {
          e.preventDefault();
          go(input);
        }}
      >
        <button
          type="button"
          aria-label="Atrás"
          disabled={!back.length}
          onClick={() => {
            const prev = back[back.length - 1];
            setBack((b) => b.slice(0, -1));
            setFwd((f) => [url, ...f]);
            onUrl(prev);
          }}
        >
          <TbArrowLeft aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Adelante"
          disabled={!fwd.length}
          onClick={() => {
            const next = fwd[0];
            setFwd((f) => f.slice(1));
            setBack((b) => [...b, url]);
            onUrl(next);
          }}
        >
          <TbArrowRight aria-hidden />
        </button>
        <button type="button" aria-label="Recargar" onClick={() => setLoads((x) => x + 1)} disabled={!url}>
          <TbReload aria-hidden />
        </button>
        <label className={styles.browserAddr}>
          {url && (secure ? <TbLock aria-hidden className={trusted[host] ? styles.browserInsecure : undefined} /> : <TbWorld aria-hidden />)}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="localhost:8080, https://localhost:8443, http://web.localhost/…"
            aria-label="Dirección"
            spellCheck={false}
          />
        </label>
      </form>
      {sugg.length > 0 && (
        <div className={styles.browserSugg}>
          {sugg.map((x) => (
            <button key={x.url} type="button" onClick={() => go(x.url)} title={x.label} aria-pressed={url.startsWith(x.url)}>
              {x.url.replace(/^https?:\/\//, '')}
              <small>{x.label}</small>
            </button>
          ))}
        </div>
      )}
      <div className={styles.browserPage}>{content}</div>
    </div>
  );
}
