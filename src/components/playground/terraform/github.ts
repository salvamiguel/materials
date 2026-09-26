/* Loads the Terraform files of a public GitHub repository into the playground.
 *
 * Listing: GitHub API (one call: git/trees?recursive=1), falling back to
 * jsDelivr when the API fails (60 requests/hour per IP without a token: a
 * whole classroom behind one NAT can exhaust it).
 * Contents: raw.githubusercontent.com (not counted against the API limit),
 * falling back to the jsDelivr CDN.
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit. HEAD = default branch. */
  ref: string;
  /** Optional subdirectory to open as the root module. */
  path: string;
}

type Fetch = (url: string) => Promise<Response>;

const NAME = /^[A-Za-z0-9_.-]+$/;
const MAX_FILES = 60;
const MAX_BYTES = 256 * 1024;

/** Parses the ?repo=owner/name[&ref=…][&path=…] query of the playground. */
export function parseRepoQuery(search: string): RepoRef | undefined {
  const q = new URLSearchParams(search);
  const repo = q.get('repo');
  if (!repo) return undefined;
  const m = /^(?:https?:\/\/github\.com\/)?([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(repo.trim());
  if (!m || !NAME.test(m[1]) || !NAME.test(m[2])) return undefined;
  const ref = (q.get('ref') || 'HEAD').trim();
  if (!/^[A-Za-z0-9_./-]+$/.test(ref) || ref.includes('..')) return undefined;
  const path = (q.get('path') || '').trim().replace(/^\/+|\/+$/g, '');
  if (path.split('/').some((p) => p === '..' || p === '.')) return undefined;
  return { owner: m[1], repo: m[2], ref, path };
}

export function repoLabel(r: RepoRef): string {
  return `${r.owner}/${r.repo}${r.ref !== 'HEAD' ? `@${r.ref}` : ''}${r.path ? `/${r.path}` : ''}`;
}

/** Files the playground understands. The lock file is skipped: init regenerates it for the simulated providers. */
export function isPlaygroundFile(path: string): boolean {
  if (path.split('/').some((p) => p.startsWith('.'))) return false; // .terraform/, .github/, .terraform.lock.hcl…
  return /\.(tf|tfvars)$/.test(path) || path.endsWith('.provider.json');
}

async function listGitHub(r: RepoRef, fetchFn: Fetch): Promise<string[]> {
  const res = await fetchFn(`https://api.github.com/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(r.ref)}?recursive=1`);
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`API de GitHub: HTTP ${res.status}`);
  const data = (await res.json()) as { tree?: { path: string; type: string }[] };
  return (data.tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
}

async function listJsDelivr(r: RepoRef, fetchFn: Fetch): Promise<string[]> {
  const version = r.ref === 'HEAD' ? '' : `@${r.ref}`;
  const res = await fetchFn(`https://data.jsdelivr.com/v1/packages/gh/${r.owner}/${r.repo}${version}?structure=flat`);
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`jsDelivr: HTTP ${res.status}`);
  const data = (await res.json()) as { files?: { name: string }[] };
  return (data.files || []).map((f) => f.name.replace(/^\//, ''));
}

class NotFound extends Error {}

async function fetchText(urls: string[], fetchFn: Fetch): Promise<string> {
  let last = '';
  for (const url of urls) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return await res.text();
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String((err as Error).message || err);
    }
  }
  throw new Error(last);
}

/** Downloads the Terraform files of the repository, keyed by path relative to `path`. */
export async function fetchRepoFiles(
  r: RepoRef,
  fetchFn: Fetch = (u) => fetch(u),
  accept: (path: string) => boolean = isPlaygroundFile,
  what = 'ficheros .tf',
): Promise<Record<string, string>> {
  let all: string[];
  const errors: string[] = [];
  try {
    all = await listGitHub(r, fetchFn);
  } catch (err) {
    errors.push(err instanceof NotFound ? 'API de GitHub: no existe' : String((err as Error).message || err));
    try {
      all = await listJsDelivr(r, fetchFn);
    } catch (err2) {
      if (err instanceof NotFound || err2 instanceof NotFound) {
        throw new Error(`No se encuentra el repositorio público ${repoLabel(r)}.`);
      }
      errors.push(String((err2 as Error).message || err2));
      throw new Error(`No se pudo listar ${repoLabel(r)} (${errors.join(' · ')}).`);
    }
  }
  const prefix = r.path ? `${r.path}/` : '';
  const paths = all.filter((p) => p.startsWith(prefix) && accept(p.slice(prefix.length))).sort();
  if (paths.length === 0) throw new Error(`${repoLabel(r)} no contiene ${what}.`);
  if (paths.length > MAX_FILES) throw new Error(`${repoLabel(r)} tiene demasiados ficheros (${paths.length}; máximo ${MAX_FILES}).`);

  const cdnRef = r.ref === 'HEAD' ? '' : `@${r.ref}`;
  const files: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      const enc = p.split('/').map(encodeURIComponent).join('/');
      let text: string;
      try {
        text = await fetchText(
          [
            `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.ref}/${enc}`,
            `https://cdn.jsdelivr.net/gh/${r.owner}/${r.repo}${cdnRef}/${enc}`,
          ],
          fetchFn,
        );
      } catch (err) {
        throw new Error(`No se pudo descargar ${p} (${(err as Error).message}).`);
      }
      if (text.length > MAX_BYTES) throw new Error(`${p} es demasiado grande para el playground.`);
      files[p.slice(prefix.length)] = text;
    }),
  );
  return files;
}
