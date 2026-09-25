import { describe, expect, test } from 'bun:test';
import { fetchRepoFiles, isPlaygroundFile, parseRepoQuery } from './github';

const TREE = ['.gitignore', '.vscode/settings.json', 'README.md', 'main.tf', 'modules/webapp/main.tf', 'modules/webapp/versions.tf', 'dev.tfvars', '.terraform.lock.hcl', '.terraform/modules/x.tf', 'mi.provider.json'];

function fakeFetch(opts: { api?: number; jsdelivr?: boolean; raw?: number } = {}) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://api.github.com/')) {
      if (opts.api && opts.api !== 200) return new Response('{"message":"rate limit"}', { status: opts.api });
      return Response.json({ tree: [...TREE.map((path) => ({ path, type: 'blob' })), { path: 'modules', type: 'tree' }] });
    }
    if (url.startsWith('https://data.jsdelivr.com/')) {
      if (!opts.jsdelivr) return new Response('', { status: 503 });
      return Response.json({ files: TREE.map((p) => ({ name: '/' + p })) });
    }
    if (url.startsWith('https://raw.githubusercontent.com/') && opts.raw && opts.raw !== 200) return new Response('', { status: opts.raw });
    return new Response(`# ${url}`);
  };
  return { fn, calls };
}

describe('parseRepoQuery', () => {
  test('owner/name with defaults', () => {
    expect(parseRepoQuery('?repo=salvamiguel/tf-first-example')).toEqual({ owner: 'salvamiguel', repo: 'tf-first-example', ref: 'HEAD', path: '' });
  });
  test('full GitHub URL, ref and path', () => {
    expect(parseRepoQuery('?repo=https://github.com/a/b.git&ref=aws&path=/envs/dev/')).toEqual({ owner: 'a', repo: 'b', ref: 'aws', path: 'envs/dev' });
  });
  test('rejects traversal and junk', () => {
    expect(parseRepoQuery('?repo=a/b&path=../x')).toBeUndefined();
    expect(parseRepoQuery('?repo=a/b&ref=../../x')).toBeUndefined();
    expect(parseRepoQuery('?repo=a')).toBeUndefined();
    expect(parseRepoQuery('?repo=a/b/c')).toBeUndefined();
    expect(parseRepoQuery('?repo=<x>/b')).toBeUndefined();
    expect(parseRepoQuery('')).toBeUndefined();
  });
});

test('isPlaygroundFile keeps Terraform files only', () => {
  expect(TREE.filter(isPlaygroundFile)).toEqual(['main.tf', 'modules/webapp/main.tf', 'modules/webapp/versions.tf', 'dev.tfvars', 'mi.provider.json']);
});

describe('fetchRepoFiles', () => {
  const r = { owner: 'o', repo: 'r', ref: 'aws', path: '' };

  test('lists with the API and downloads from raw', async () => {
    const f = fakeFetch();
    const files = await fetchRepoFiles(r, f.fn);
    expect(Object.keys(files).sort()).toEqual(['dev.tfvars', 'main.tf', 'mi.provider.json', 'modules/webapp/main.tf', 'modules/webapp/versions.tf']);
    expect(files['main.tf']).toBe('# https://raw.githubusercontent.com/o/r/aws/main.tf');
    expect(f.calls.filter((c) => c.includes('api.github.com'))).toHaveLength(1);
  });

  test('falls back to jsDelivr when the API is rate limited', async () => {
    const f = fakeFetch({ api: 403, jsdelivr: true });
    const files = await fetchRepoFiles(r, f.fn);
    expect(Object.keys(files)).toHaveLength(5);
    expect(f.calls.some((c) => c === 'https://data.jsdelivr.com/v1/packages/gh/o/r@aws?structure=flat')).toBe(true);
  });

  test('falls back to the jsDelivr CDN when raw fails', async () => {
    const f = fakeFetch({ raw: 403 });
    const files = await fetchRepoFiles(r, f.fn);
    expect(files['main.tf']).toBe('# https://cdn.jsdelivr.net/gh/o/r@aws/main.tf');
  });

  test('subdirectory becomes the root', async () => {
    const files = await fetchRepoFiles({ ...r, path: 'modules/webapp' }, fakeFetch().fn);
    expect(Object.keys(files).sort()).toEqual(['main.tf', 'versions.tf']);
  });

  test('clear errors', async () => {
    await expect(fetchRepoFiles(r, fakeFetch({ api: 404 }).fn)).rejects.toThrow('No se encuentra el repositorio público o/r@aws');
    await expect(fetchRepoFiles(r, fakeFetch({ api: 403 }).fn)).rejects.toThrow('No se pudo listar o/r@aws (API de GitHub: HTTP 403 · jsDelivr: HTTP 503)');
    await expect(fetchRepoFiles({ ...r, path: 'nada' }, fakeFetch().fn)).rejects.toThrow('no contiene ficheros .tf');
  });
});
