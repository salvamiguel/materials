// YAML (and Helm template) highlighting for the editor, and colours for
// kubectl's output in the terminal.

import type { Token } from '../terraform/highlight';
import type { OutLine } from '../shared/Terminal';

export function highlightYaml(src: string): Token[] {
  const out: Token[] = [];
  const push = (text: string, cls?: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ text, cls });
  };
  const lines = src.split('\n');
  lines.forEach((line, li) => {
    if (li > 0) push('\n');
    // Helm/Go template actions anywhere in the line.
    const parts = line.split(/(\{\{-?[\s\S]*?-?\}\})/);
    if (parts.length > 1 && /^\s*\{\{/.test(line) && /\}\}\s*$/.test(line) && parts.filter(Boolean).length === 1) {
      push(line, 'interp');
      return;
    }
    let rest = line;
    const ind = /^\s*/.exec(rest)![0];
    push(ind);
    rest = rest.slice(ind.length);
    if (/^#/.test(rest)) {
      push(rest, 'comment');
      return;
    }
    if (/^(---|\.\.\.)\s*$/.test(rest)) {
      push(rest, 'kw');
      return;
    }
    const dash = /^(-\s+|-$)/.exec(rest);
    if (dash) {
      push(dash[0], 'kw');
      rest = rest.slice(dash[0].length);
    }
    const key = /^((?:"[^"]*"|'[^']*'|[^\s:#{}[\],"'][^:#]*?))(\s*:)(?=\s|$)/.exec(rest);
    if (key && !rest.startsWith('{{')) {
      push(key[1], 'attr');
      push(key[2]);
      rest = rest.slice(key[0].length);
    }
    value(rest, push);
  });
  return out;
}

function value(text: string, push: (t: string, c?: string) => void) {
  const re =
    /(\{\{-?[\s\S]*?-?\}\})|(\s#.*$)|("(?:[^"\\]|\\.)*"|'[^']*')|(\b(?:true|false|null|yes|no|True|False)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b(?![\w.-]))|([|>][-+]?\s*$)|(&\w+|\*\w+|!!\w+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index), 'str');
    const cls = m[1] ? 'interp' : m[2] ? 'comment' : m[3] ? 'str' : m[4] ? 'lit' : m[5] ? 'num' : m[6] ? 'kw' : 'fn';
    push(m[0], cls);
    last = re.lastIndex;
  }
  if (last < text.length) push(text.slice(last), text.slice(last).trim() ? 'str' : undefined);
}

export function highlightK8s(src: string, filename: string): Token[] {
  if (/\.(ya?ml|tpl)$/.test(filename) || /NOTES\.txt$/.test(filename) || filename.endsWith('.helmignore')) return highlightYaml(src);
  return [{ text: src }];
}

// ── terminal ─────────────────────────────────────────────────────────

const BAD =
  /\b(CrashLoopBackOff|Error|ErrImagePull|ImagePullBackOff|InvalidImageName|CreateContainerConfigError|CreateContainerError|OOMKilled|Failed|Evicted|NotReady|Unknown|Lost|BackoffLimitExceeded|ProgressDeadlineExceeded|FailedScheduling|FailedMount|Unhealthy|BackOff|Killing)\b/g;
const WARN =
  /\b(Pending|ContainerCreating|PodInitializing|Terminating|Init:[\w/:]+|Released|WaitForFirstConsumer|SchedulingDisabled|Suspended|<pending>|<unknown>)\b/g;
const GOOD = /\b(Running|Ready|Bound|Active|Complete|Completed|Available|deployed|Succeeded|True)\b/g;

function spans(line: string): OutLine['tokens'] {
  const marks: { s: number; e: number; cls: string }[] = [];
  for (const [re, cls] of [
    [BAD, 'err'],
    [WARN, 'warn'],
    [GOOD, 'ok'],
  ] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (!marks.some((x) => m!.index < x.e && m!.index + m![0].length > x.s)) marks.push({ s: m.index, e: m.index + m[0].length, cls });
    }
  }
  marks.sort((a, b) => a.s - b.s);
  const tokens: OutLine['tokens'] = [];
  let at = 0;
  for (const mk of marks) {
    if (mk.s > at) tokens.push({ text: line.slice(at, mk.s) });
    tokens.push({ text: line.slice(mk.s, mk.e), cls: mk.cls });
    at = mk.e;
  }
  if (at < line.length) tokens.push({ text: line.slice(at) });
  return tokens;
}

export function colorizeKubectl(text: string): OutLine[] {
  const lines = text.replace(/\n$/, '').split('\n');
  let yaml = false;
  return lines.map((line, i): OutLine => {
    if (i === 0) yaml = /^(apiVersion|kind|---)/.test(line);
    if (!line) return { tokens: [] };
    if (/^(error|Error from server|Error:|fatal|panic)/i.test(line) || /^\S+: \(\d+\) /.test(line) || /^sh: .*not found/.test(line))
      return { tokens: [{ text: line, cls: 'err' }] };
    if (/^(Warning|warning|W\d{4})/.test(line)) return { tokens: [{ text: line, cls: 'warn' }] };
    if (/^\^C$/.test(line)) return { tokens: [{ text: line, cls: 'dim' }] };
    if (/^#/.test(line)) return { tokens: [{ text: line, cls: 'dim' }] };
    if (/^\+(?!\+\+)/.test(line)) return { tokens: [{ text: line, cls: 'add' }] };
    if (/^-(?!--)/.test(line) && !yaml) return { tokens: [{ text: line, cls: 'del' }] };
    if (/^(diff -u|@@ |\+\+\+ |--- \/)/.test(line)) return { tokens: [{ text: line, cls: 'bold' }] };
    // Results of apply/create/delete…
    const act =
      /^(\S+?\/\S+|\S+ "[^"]+") (created|configured|unchanged|deleted|force deleted|scaled|exposed|autoscaled|labeled|annotated|patched|replaced|rolled back|restarted|paused|resumed|image updated|env updated|cordoned|uncordoned|drained|evicted|skipped rollback|patched \(no change\)|not labeled)(.*)$/.exec(
        line,
      );
    if (act) {
      const cls = /deleted|evicted|drained|cordoned/.test(act[2]) ? 'del' : /unchanged|no change|not |skipped/.test(act[2]) ? 'dim' : 'add';
      return { tokens: [{ text: act[1] + ' ' }, { text: act[2], cls }, { text: act[3], cls: 'dim' }] };
    }
    if (/successfully rolled out|rolling update complete|roll out complete|condition met|STATUS: deployed|Happy Helming/.test(line))
      return { tokens: [{ text: line, cls: 'ok bold' }] };
    if (/^Waiting for /.test(line)) return { tokens: [{ text: line, cls: 'dim' }] };
    // Table headers: all caps words.
    if (/^[A-Z][A-Z0-9()%/.-]*(?: [A-Z0-9()%/.-]+)*(?:\s{2,}[A-Z][A-Z0-9()%/. -]*)+\s*$/.test(line))
      return { tokens: [{ text: line, cls: 'bold' }], nowrap: true };
    if (yaml) {
      const m = /^(\s*(?:- )?)([\w./-]+:)(.*)$/.exec(line);
      if (m) return { tokens: [{ text: m[1] }, { text: m[2], cls: 'key' }, { text: m[3], cls: 'str' }] };
      return { tokens: [{ text: line }] };
    }
    const kv = /^(\s*)([A-Z][\w -]*?:)(\s.*)?$/.exec(line);
    if (kv && !/https?:/.test(kv[2])) return { tokens: [{ text: kv[1] }, { text: kv[2], cls: 'key' }, ...spans(kv[3] || '')] };
    return { tokens: spans(line), nowrap: /\s{3,}\S/.test(line) };
  });
}
