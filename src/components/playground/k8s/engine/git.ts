// A small simulated Git: the editor's files are the working tree of a repo
// whose "remote" ArgoCD reads. Commits keep full snapshots (the files are
// small), which makes status, diff, revert and checkout trivial.

import { fnv32a } from './util';
import { unifiedDiff } from './kubectl/patch';
import { shellSplit } from '../../shared/shell';

export interface Commit {
  sha: string;
  parent?: string;
  message: string;
  author: string;
  time: number;
  files: Record<string, string>;
}

export interface GitRepo {
  remote: string;
  branch: string;
  commits: Commit[];
  /** Local HEAD. */
  head: string;
  /** What the remote has (origin/main). */
  pushed: string;
  /** Staging area: a full snapshot. */
  index: Record<string, string>;
  /** Bumped on every push (ArgoCD refreshes on it, like a webhook). */
  pushSeq: number;
}

export const DEFAULT_REMOTE = 'https://git.playground.local/alumno/playground.git';
const AUTHOR = 'Alumno <alumno@playground.local>';
const MAX_COMMITS = 60;

/** Files that are not part of the repo. */
const ignored = (p: string) => p.startsWith('.kubectl-edit/');

function tracked(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) if (!ignored(k)) out[k] = v;
  return out;
}

function makeSha(seed: string): string {
  let s = '';
  let h = fnv32a(seed);
  for (let i = 0; i < 5; i++) {
    h = fnv32a(seed + i + h);
    s += h.toString(16).padStart(8, '0');
  }
  return s;
}

export const short = (sha: string) => sha.slice(0, 7);

export function initRepo(files: Record<string, string>, remote = DEFAULT_REMOTE, now = Date.now()): GitRepo {
  const snap = tracked(files);
  const sha = makeSha(JSON.stringify(snap) + remote + now);
  const c: Commit = { sha, message: 'Initial commit', author: AUTHOR, time: now, files: snap };
  return { remote, branch: 'main', commits: [c], head: sha, pushed: sha, index: { ...snap }, pushSeq: 0 };
}

export function commitBySha(repo: GitRepo, ref: string): Commit | undefined {
  if (!ref) return undefined;
  if (ref === 'HEAD') return commitBySha(repo, repo.head);
  const m = /^(HEAD|origin\/main|main)(~(\d+)|\^+)?$/.exec(ref);
  if (m) {
    let c = commitBySha(repo, m[1] === 'origin/main' ? repo.pushed : repo.head);
    const n = m[3] ? parseInt(m[3], 10) : (m[2] || '').length;
    for (let i = 0; i < n && c; i++) c = c.parent ? commitBySha(repo, c.parent) : undefined;
    return c;
  }
  return repo.commits.find((c) => c.sha.startsWith(ref.toLowerCase()));
}

export function normalizeRepoUrl(u: string): string {
  return u
    .trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function sameRepo(a: string, b: string) {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}

/** The pushed snapshot at a revision (what a clone of the remote sees). */
export function remoteSnapshot(repo: GitRepo, revision: string | undefined): Commit | undefined {
  const rev = !revision || revision === 'HEAD' || revision === repo.branch || revision === `refs/heads/${repo.branch}` ? repo.pushed : revision;
  const c = commitBySha(repo, rev);
  if (!c) return undefined;
  // Only pushed history is visible from the remote.
  let cur: Commit | undefined = commitBySha(repo, repo.pushed);
  while (cur) {
    if (cur.sha === c.sha) return c;
    cur = cur.parent ? commitBySha(repo, cur.parent) : undefined;
  }
  return undefined;
}

function changes(a: Record<string, string>, b: Record<string, string>) {
  const out: { path: string; kind: 'modified' | 'new file' | 'deleted' }[] = [];
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(p in a)) out.push({ path: p, kind: 'new file' });
    else if (!(p in b)) out.push({ path: p, kind: 'deleted' });
    else if (a[p] !== b[p]) out.push({ path: p, kind: 'modified' });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

function aheadBy(repo: GitRepo): number {
  let n = 0;
  let c = commitBySha(repo, repo.head);
  while (c && c.sha !== repo.pushed) {
    n++;
    c = c.parent ? commitBySha(repo, c.parent) : undefined;
  }
  return n;
}

function gitDate(ms: number) {
  const d = new Date(ms);
  return d.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, (_, wd, day, mon, y, t) => `${wd} ${mon} ${parseInt(day, 10)} ${t} ${y} +0000`);
}

function diffText(a: Record<string, string>, b: Record<string, string>, paths?: string[]): string {
  let out = '';
  for (const ch of changes(a, b)) {
    if (paths?.length && !paths.some((p) => ch.path === p || ch.path.startsWith(p.replace(/\/?$/, '/')))) continue;
    const before = a[ch.path] ?? '';
    const after = b[ch.path] ?? '';
    const body = unifiedDiff(before, after, ch.kind === 'new file' ? '/dev/null' : `a/${ch.path}`, ch.kind === 'deleted' ? '/dev/null' : `b/${ch.path}`);
    out += `diff --git a/${ch.path} b/${ch.path}\n${ch.kind === 'new file' ? 'new file mode 100644\n' : ch.kind === 'deleted' ? 'deleted file mode 100644\n' : ''}index ${makeSha(before).slice(0, 7)}..${makeSha(after).slice(0, 7)}${ch.kind === 'modified' ? ' 100644' : ''}\n${body}`;
  }
  return out;
}

function stat(a: Record<string, string>, b: Record<string, string>) {
  let ins = 0;
  let del = 0;
  const ch = changes(a, b);
  for (const c of ch) {
    const d = unifiedDiff(a[c.path] ?? '', b[c.path] ?? '', 'a', 'b').split('\n');
    ins += d.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    del += d.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  }
  const parts = [`${ch.length} file${ch.length === 1 ? '' : 's'} changed`];
  if (ins) parts.push(`${ins} insertion${ins === 1 ? '' : 's'}(+)`);
  if (del) parts.push(`${del} deletion${del === 1 ? '' : 's'}(-)`);
  return ` ${parts.join(', ')}\n${ch
    .filter((c) => c.kind !== 'modified')
    .map((c) => ` ${c.kind === 'new file' ? 'create' : 'delete'} mode 100644 ${c.path}\n`)
    .join('')}`;
}

export interface GitResult {
  output: string;
  exitCode: number;
  repo: GitRepo;
  /** New working tree (checkout, revert, reset --hard). */
  files?: Record<string, string>;
  pushed?: boolean;
}

function newCommit(repo: GitRepo, message: string, files: Record<string, string>, now: number): Commit {
  return {
    sha: makeSha(message + JSON.stringify(files) + repo.head + now + repo.commits.length),
    parent: repo.head,
    message,
    author: AUTHOR,
    time: now,
    files,
  };
}

function addCommit(repo: GitRepo, c: Commit): GitRepo {
  let commits = [...repo.commits, c];
  if (commits.length > MAX_COMMITS) commits = commits.slice(commits.length - MAX_COMMITS);
  return { ...repo, commits, head: c.sha, index: { ...c.files } };
}

export function git(args: string[], repo: GitRepo, workTree: Record<string, string>, now: number): GitResult {
  const files = tracked(workTree);
  const head = commitBySha(repo, repo.head)!;
  const ok = (output: string, extra: Partial<GitResult> = {}): GitResult => ({ output, exitCode: 0, repo, ...extra });
  const fail = (output: string, code = 1): GitResult => ({ output, exitCode: code, repo });
  const [cmd, ...rest] = args;
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      return ok(
        'usage: git <command>\n\nEn el playground: status, add, commit, push, pull, log, diff, show, revert, restore/checkout, reset, remote -v, rev-parse.\nEl remoto es simulado: ArgoCD lee lo que empujas con git push.\n',
      );
    case 'status': {
      const staged = changes(head.files, repo.index);
      const unstaged = changes(repo.index, files).filter((c) => c.kind !== 'new file');
      const untracked = changes(repo.index, files).filter((c) => c.kind === 'new file');
      const ahead = aheadBy(repo);
      let out = `On branch ${repo.branch}\n`;
      out += ahead
        ? `Your branch is ahead of 'origin/${repo.branch}' by ${ahead} commit${ahead === 1 ? '' : 's'}.\n  (use "git push" to publish your local commits)\n`
        : `Your branch is up to date with 'origin/${repo.branch}'.\n`;
      if (staged.length)
        out += `\nChanges to be committed:\n  (use "git restore --staged <file>..." to unstage)\n${staged.map((c) => `\t${(c.kind + ':').padEnd(12)}${c.path}\n`).join('')}`;
      if (unstaged.length)
        out += `\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n${unstaged.map((c) => `\t${(c.kind + ':').padEnd(12)}${c.path}\n`).join('')}`;
      if (untracked.length)
        out += `\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n${untracked.map((c) => `\t${c.path}\n`).join('')}`;
      if (!staged.length && !unstaged.length && !untracked.length) out += '\nnothing to commit, working tree clean\n';
      else if (!staged.length) out += '\nno changes added to commit (use "git add" and/or "git commit -a")\n';
      return ok(out);
    }
    case 'add': {
      const all = rest.includes('-A') || rest.includes('--all') || rest.includes('.');
      const paths = rest.filter((a) => !a.startsWith('-'));
      if (!all && !paths.length) return fail("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\n");
      const index = { ...repo.index };
      const match = (p: string) => all || paths.some((x) => p === x.replace(/^\.\//, '') || p.startsWith(x.replace(/^\.\//, '').replace(/\/?$/, '/')));
      let hit = false;
      for (const p of new Set([...Object.keys(index), ...Object.keys(files)])) {
        if (!match(p)) continue;
        hit = true;
        if (p in files) index[p] = files[p];
        else delete index[p];
      }
      if (!hit && paths.length) return fail(`fatal: pathspec '${paths[0]}' did not match any files\n`, 128);
      return ok('', { repo: { ...repo, index } });
    }
    case 'commit': {
      const mi = rest.findIndex((a) => a === '-m' || a === '-am' || a === '--message');
      const inline = rest.find((a) => a.startsWith('--message='));
      const message = mi >= 0 ? rest[mi + 1] : inline ? inline.slice(10) : undefined;
      if (!message) return fail('error: el playground no abre un editor: usa git commit -m "mensaje"\n');
      let index = repo.index;
      if (rest.includes('-a') || rest.includes('-am') || rest.includes('--all')) {
        index = { ...index };
        for (const p of Object.keys(index)) {
          if (p in files) index[p] = files[p];
          else delete index[p];
        }
      }
      if (!changes(head.files, index).length) {
        const dirty = changes(index, files).length;
        return fail(
          `On branch ${repo.branch}\n${dirty ? 'Changes not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n\nno changes added to commit (use "git add" and/or "git commit -a")\n' : 'nothing to commit, working tree clean\n'}`,
        );
      }
      const c = newCommit(repo, message, index, now);
      return ok(`[${repo.branch} ${short(c.sha)}] ${message}\n${stat(head.files, index)}`, { repo: addCommit(repo, c) });
    }
    case 'push': {
      if (repo.pushed === repo.head) return ok('Everything up-to-date\n');
      const n = aheadBy(repo);
      return ok(
        `Enumerating objects: ${3 + n * 4}, done.\nCounting objects: 100% (${3 + n * 4}/${3 + n * 4}), done.\nDelta compression using up to 8 threads\nCompressing objects: 100% (${1 + n * 2}/${1 + n * 2}), done.\nWriting objects: 100% (${2 + n * 3}/${2 + n * 3}), 412 bytes | 412.00 KiB/s, done.\nTotal ${2 + n * 3} (delta ${n}), reused 0 (delta 0), pack-reused 0\nTo ${repo.remote}\n   ${short(repo.pushed)}..${short(repo.head)}  ${repo.branch} -> ${repo.branch}\n`,
        { repo: { ...repo, pushed: repo.head, pushSeq: repo.pushSeq + 1 }, pushed: true },
      );
    }
    case 'pull':
    case 'fetch':
      return ok(cmd === 'pull' ? 'Already up to date.\n' : '');
    case 'log': {
      const oneline = rest.includes('--oneline');
      const nArg = rest.find((a) => /^-\d+$/.test(a) || a.startsWith('-n'));
      const max = nArg ? parseInt(nArg.replace(/^-n?/, '') || rest[rest.indexOf(nArg) + 1], 10) : Infinity;
      const out: string[] = [];
      let c: Commit | undefined = head;
      while (c && out.length < max) {
        const deco = [c.sha === repo.head ? `HEAD -> ${repo.branch}` : '', c.sha === repo.pushed ? `origin/${repo.branch}` : ''].filter(Boolean).join(', ');
        const d = deco ? ` (${deco})` : '';
        out.push(oneline ? `${short(c.sha)}${d} ${c.message}` : `commit ${c.sha}${d}\nAuthor: ${c.author}\nDate:   ${gitDate(c.time)}\n\n    ${c.message}\n`);
        c = c.parent ? commitBySha(repo, c.parent) : undefined;
      }
      return ok(out.join('\n') + '\n');
    }
    case 'diff': {
      const paths = rest.filter((a) => !a.startsWith('-') && !commitBySha(repo, a));
      const refs = rest.filter((a) => !a.startsWith('-') && commitBySha(repo, a));
      if (rest.includes('--staged') || rest.includes('--cached')) return ok(diffText(head.files, repo.index, paths));
      if (refs.length === 2) return ok(diffText(commitBySha(repo, refs[0])!.files, commitBySha(repo, refs[1])!.files, paths));
      if (refs.length === 1) return ok(diffText(commitBySha(repo, refs[0])!.files, files, paths));
      return ok(diffText(repo.index, files, paths));
    }
    case 'show': {
      const c = commitBySha(repo, rest[0] || 'HEAD');
      if (!c) return fail(`fatal: bad object ${rest[0]}\n`, 128);
      const parent = c.parent ? commitBySha(repo, c.parent)?.files || {} : {};
      return ok(`commit ${c.sha}\nAuthor: ${c.author}\nDate:   ${gitDate(c.time)}\n\n    ${c.message}\n\n${diffText(parent, c.files)}`);
    }
    case 'revert': {
      if (changes(head.files, files).length)
        return fail(
          'error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\nfatal: revert failed\n',
          128,
        );
      const target = commitBySha(repo, rest.find((a) => !a.startsWith('-')) || 'HEAD');
      if (!target) return fail(`fatal: bad revision '${rest[0]}'\n`, 128);
      const parent = target.parent ? commitBySha(repo, target.parent)?.files || {} : {};
      const next = { ...head.files };
      for (const ch of changes(parent, target.files)) {
        if (ch.path in parent) next[ch.path] = parent[ch.path];
        else delete next[ch.path];
      }
      const c = newCommit(repo, `Revert "${target.message}"`, next, now);
      return ok(`[${repo.branch} ${short(c.sha)}] Revert "${target.message}"\n${stat(head.files, next)}`, {
        repo: addCommit(repo, c),
        files: { ...workTreeExtras(workTree), ...next },
      });
    }
    case 'restore':
    case 'checkout': {
      if (rest.includes('--staged')) {
        const paths = rest.filter((a) => !a.startsWith('-'));
        const index = { ...repo.index };
        for (const p of paths) {
          if (p in head.files) index[p] = head.files[p];
          else delete index[p];
        }
        return ok('', { repo: { ...repo, index } });
      }
      const paths = rest.filter((a) => a !== '--' && !a.startsWith('-'));
      if (cmd === 'checkout' && paths.length === 1 && !rest.includes('--') && !(paths[0] in repo.index)) {
        return fail(`error: el playground solo tiene la rama ${repo.branch}\n`);
      }
      const next = { ...workTree };
      for (const p of paths) {
        if (p === '.') {
          for (const k of Object.keys(next)) if (!ignored(k) && !(k in repo.index)) continue;
          Object.assign(next, repo.index);
        } else if (p in repo.index) next[p] = repo.index[p];
        else return fail(`error: pathspec '${p}' did not match any file(s) known to git\n`);
      }
      return ok('', { files: next });
    }
    case 'reset': {
      if (rest.includes('--hard')) {
        const target = commitBySha(repo, rest.find((a) => !a.startsWith('-')) || 'HEAD');
        if (!target) return fail(`fatal: ambiguous argument '${rest[1]}'\n`, 128);
        return ok(`HEAD is now at ${short(target.sha)} ${target.message}\n`, {
          repo: { ...repo, head: target.sha, index: { ...target.files } },
          files: { ...workTreeExtras(workTree), ...target.files },
        });
      }
      return ok('', { repo: { ...repo, index: { ...head.files } } });
    }
    case 'remote':
      return ok(rest.includes('-v') ? `origin\t${repo.remote} (fetch)\norigin\t${repo.remote} (push)\n` : 'origin\n');
    case 'rev-parse': {
      const c = commitBySha(repo, rest[0] === '--short' ? rest[1] : rest[0] || 'HEAD');
      if (!c) return fail(`fatal: ambiguous argument '${rest[0]}'\n`, 128);
      return ok((rest[0] === '--short' ? short(c.sha) : c.sha) + '\n');
    }
    case 'branch':
      return ok(`* ${repo.branch}\n`);
    case 'clone':
    case 'init':
      return fail(`${cmd}: el playground ya es un repositorio (${repo.remote}). Usa git status.\n`);
    case 'config':
      return ok('');
    default:
      return fail(`git: '${cmd}' is not a git command. See 'git --help'.\n`);
  }
}

/** Untracked-but-ignored files that a checkout must keep. */
function workTreeExtras(workTree: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(workTree)) if (ignored(k)) out[k] = v;
  return out;
}

export function gitLine(line: string, repo: GitRepo, files: Record<string, string>, now: number): GitResult {
  return git(shellSplit(line).slice(1), repo, files, now);
}
