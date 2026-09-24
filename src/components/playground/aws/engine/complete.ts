// Tab completion: shell commands, aws services/operations/options, option
// values (regions, output formats, profiles, choices), s3:// paths and
// local paths.

import type { PlaygroundState } from './types';
import { CONFIGURE_SUBCOMMANDS, GLOBAL_OPTS, SERVICES, opOptions } from './registry';
import { REGIONS } from './seed';
import { SHELL_COMMANDS, isDir, resolvePath } from './engine';

function commonPrefix(items: string[]): string {
  if (!items.length) return '';
  let p = items[0];
  for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

function localCandidates(st: PlaygroundState, partial: string): string[] {
  const slash = partial.lastIndexOf('/');
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
  const abs = resolvePath(st, dirPart || '.');
  if (!isDir(st, abs)) return [];
  const prefix = abs === '/' ? '/' : abs + '/';
  const names = new Set<string>();
  for (const f of Object.keys(st.files)) {
    if (!f.startsWith(prefix)) continue;
    const rest = f.slice(prefix.length);
    const i = rest.indexOf('/');
    const name = i >= 0 ? rest.slice(0, i + 1) : rest;
    if (name && name !== '.keep') names.add(name);
  }
  return [...names].map((n) => dirPart + n);
}

function s3Candidates(st: PlaygroundState, partial: string): string[] {
  const m = /^s3:\/\/([^/]*)(\/(.*))?$/.exec(partial);
  if (!m) return [];
  if (m[2] === undefined) return Object.keys(st.s3).map((b) => `s3://${b}/`);
  const bucket = st.s3[m[1]];
  if (!bucket) return [];
  const keyPart = m[3] ?? '';
  const base = keyPart.slice(0, keyPart.lastIndexOf('/') + 1);
  const names = new Set<string>();
  for (const k of Object.keys(bucket.objects)) {
    if (!k.startsWith(base)) continue;
    const rest = k.slice(base.length);
    const i = rest.indexOf('/');
    names.add(i >= 0 ? rest.slice(0, i + 1) : rest);
  }
  return [...names].map((n) => `s3://${m[1]}/${base}${n}`);
}

function matchesFor(input: string, st: PlaygroundState): { head: string; current: string; matches: string[] } {
  const tokens = input.split(/\s+/);
  const current = tokens[tokens.length - 1];
  const before = tokens.slice(0, -1);
  const head = input.slice(0, input.length - current.length);
  let candidates: string[] = [];

  if (before.length === 0) {
    candidates = SHELL_COMMANDS;
  } else if (before[0] !== 'aws') {
    candidates = localCandidates(st, current);
  } else {
    const words = before.slice(1).filter((w) => !w.startsWith('--'));
    const prev = before[before.length - 1];
    const service = SERVICES.find((s) => s.name === words[0]);
    const op = service?.ops.find((o) => o.name === words[1]);
    const prevOpt = prev?.startsWith('--') ? prev.slice(2) : undefined;
    const optSpec = op && prevOpt ? opOptions(service!, op.opts).find((o) => o.name === prevOpt) : undefined;
    if (prevOpt === 'region') candidates = REGIONS.map((r) => r.name);
    else if (prevOpt === 'output') candidates = GLOBAL_OPTS.output.values!;
    else if (prevOpt === 'profile') candidates = Object.keys(st.profiles);
    else if (optSpec?.choices) candidates = optSpec.choices;
    else if (current.startsWith('s3://')) candidates = s3Candidates(st, current);
    else if (current.startsWith('file://')) candidates = localCandidates(st, current.slice(7)).map((c) => 'file://' + c);
    else if (current.startsWith('--') || (current === '' && words.length >= 2 && op)) {
      const used = new Set(before.filter((w) => w.startsWith('--')).map((w) => w.slice(2)));
      const own = op ? opOptions(service!, op.opts).map((o) => o.name) : [];
      candidates = [...own, ...Object.keys(GLOBAL_OPTS)].filter((n) => !used.has(n)).map((n) => `--${n}`);
    } else if (words.length === 0) {
      candidates = [...SERVICES.map((s) => s.name), 'configure', 'help'];
    } else if (words.length === 1 && words[0] === 'configure') {
      candidates = [...CONFIGURE_SUBCOMMANDS, 'help'];
    } else if (words.length === 1 && service) {
      candidates = [...service.ops.map((o) => o.name), 'help'];
    } else if (op && (op.positional?.length ?? 0) > 0) {
      candidates = [...localCandidates(st, current), ...s3Candidates(st, current || 's3://')];
    }
  }

  const matches = [...new Set(candidates)].filter((c) => c.startsWith(current)).sort();
  return { head, current, matches };
}

/** Returns the new input line, or undefined when there is nothing to complete. */
export function complete(input: string, st: PlaygroundState): string | undefined {
  const { head, current, matches } = matchesFor(input, st);
  if (!matches.length) return undefined;
  if (matches.length === 1) {
    const m = matches[0];
    return head + m + (m.endsWith('/') ? '' : ' ');
  }
  const prefix = commonPrefix(matches);
  return prefix.length > current.length ? head + prefix : undefined;
}

/** All candidates, for the UI to list when Tab can't pick one. */
export function completionOptions(input: string, st: PlaygroundState): string[] {
  const { matches } = matchesFor(input, st);
  return matches.length > 1 ? matches : [];
}
