// The playground's shell: kubectl (alias k), helm, kustomize, curl, and a
// few Unix tools for pipes (grep, head, wc, sort, uniq, base64), for loops,
// `> file` redirection and `&`.

import type { Cluster } from './cluster';
import { kubectl, KUBECTL_HELP, type Ctx, type Result } from './kubectl';
import { curlCommand, wgetCommand } from './net';
import { unbase64, base64 } from './util';
import { shellSplit } from '../../shared/shell';
import type { Stream } from './kubectl/streams';

export interface ShellCtx extends Ctx {
  helm?: (args: string[], ctx: ShellCtx) => Promise<Result>;
}

export interface ShellResult extends Result {
  clear?: boolean;
}

export const SHELL_HELP = `Comandos del playground (todo es simulado y ocurre en tu navegador):

  kubectl …  (o k …)     get, describe, apply -f/-k, create, delete, logs [-f], exec [-it],
                         run, expose, scale, rollout, set image, label, patch, diff, edit,
                         top, port-forward, wait, events, explain, cordon/drain…
  helm …                 install, upgrade, rollback, uninstall, list, history, template,
                         lint, show values, get values/manifest
  kustomize build DIR    renderiza un kustomization.yaml (como kubectl kustomize)
  curl URL · wget URL    peticiones HTTP: a un port-forward (localhost), a un Ingress
                         (su host), a un NodePort o a un LoadBalancer
  ls [dir] · cat FICHERO los ficheros del editor
  watch CMD              repite CMD cada 2 s (Ctrl+C para salir)
  sleep N                espera N segundos simulados
  clear · help

Tuberías y bucles: | grep | head | tail | wc -l | sort | uniq -c | base64 -d,
  for i in $(seq 10); do curl -s …; done | sort | uniq -c
  kubectl create deployment web --image=nginx --dry-run=client -o yaml > web.yaml
  kubectl port-forward svc/web 8080:80 &   (luego: curl localhost:8080 · kill %1)

Ctrl+C detiene los comandos que se quedan esperando (get -w, logs -f, rollout status…).`;

const ok = (output: string): ShellResult => ({ output, exitCode: 0 });

/** Text filters for pipes. */
function filter(cmd: string[], input: string): { output: string; exitCode: number } {
  const [name, ...a] = cmd;
  const lines = input
    .replace(/\n$/, '')
    .split('\n')
    .filter((_, i, arr) => !(arr.length === 1 && arr[0] === ''));
  const out = (ls: string[]) => ({ output: ls.length ? ls.join('\n') + '\n' : '', exitCode: 0 });
  switch (name) {
    case 'grep': {
      const flags = a.filter((x) => x.startsWith('-')).join('');
      const pat = a.find((x) => !x.startsWith('-')) ?? '';
      let re: RegExp;
      try {
        re = new RegExp(flags.includes('F') ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pat, flags.includes('i') ? 'i' : '');
      } catch {
        re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
      const hit = lines.filter((l) => re.test(l) !== flags.includes('v'));
      if (flags.includes('c')) return { output: `${hit.length}\n`, exitCode: hit.length ? 0 : 1 };
      return { ...out(hit), exitCode: hit.length ? 0 : 1 };
    }
    case 'head':
    case 'tail': {
      const nArg = a.find((x) => /^-?\d+$/.test(x.replace(/^-n/, ''))) || '10';
      const n = Math.abs(parseInt(nArg.replace(/^-n/, '').replace(/^-/, ''), 10)) || parseInt(a[a.indexOf('-n') + 1] || '10', 10);
      return out(name === 'head' ? lines.slice(0, n) : lines.slice(-n));
    }
    case 'wc':
      return { output: `${a.includes('-l') ? lines.length : input.length}\n`, exitCode: 0 };
    case 'sort':
      return out(
        a.includes('-r') ? [...lines].sort().reverse() : a.includes('-n') ? [...lines].sort((x, y) => parseFloat(x) - parseFloat(y)) : [...lines].sort(),
      );
    case 'uniq': {
      const res: [string, number][] = [];
      for (const l of lines) {
        const last = res[res.length - 1];
        if (last && last[0] === l) last[1]++;
        else res.push([l, 1]);
      }
      return out(a.includes('-c') ? res.map(([l, n]) => `${String(n).padStart(7)} ${l}`) : res.map(([l]) => l));
    }
    case 'base64':
      if (a.includes('-d') || a.includes('--decode') || a.includes('-D')) return { output: unbase64(input.trim()), exitCode: 0 };
      return { output: base64(input) + '\n', exitCode: 0 };
    case 'cat':
      return { output: input, exitCode: 0 };
    case 'tr':
      return { output: input.split(a[0] || '').join(a[1] || ''), exitCode: 0 };
    case 'cut': {
      const d = a.find((x) => x.startsWith('-d'))?.slice(2) || '\t';
      const f = parseInt(a.find((x) => x.startsWith('-f'))?.slice(2) || '1', 10);
      return out(lines.map((l) => l.split(d)[f - 1] ?? ''));
    }
    case 'awk': {
      const m = /\{\s*print\s+\$(\d+)\s*\}/.exec(a.join(' '));
      if (!m) return { output: 'awk: el playground solo entiende {print $N}\n', exitCode: 1 };
      return out(lines.map((l) => l.trim().split(/\s+/)[parseInt(m[1], 10) - 1] ?? ''));
    }
    case 'jq':
      try {
        const v = JSON.parse(input);
        const path = (a.find((x) => !x.startsWith('-')) || '.').replace(/^\./, '');
        const res = path ? path.split('.').reduce((c: unknown, k) => (c as Record<string, unknown>)?.[k.replace(/\[\]$/, '')], v) : v;
        return { output: (a.includes('-r') && typeof res === 'string' ? res : JSON.stringify(res, null, 2)) + '\n', exitCode: 0 };
      } catch {
        return { output: 'jq: error: la entrada no es JSON\n', exitCode: 2 };
      }
    default:
      return { output: `sh: ${name}: command not found\n`, exitCode: 127 };
  }
}

function splitPipes(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '|' && line[i + 1] !== '|') {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

function expandSeq(list: string): string[] {
  let m = /^\$\(seq\s+(\d+)(?:\s+(\d+))?\)$/.exec(list.trim());
  if (m) {
    const [a, b] = m[2] ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1, parseInt(m[1], 10)];
    return Array.from({ length: Math.max(0, Math.min(200, b - a + 1)) }, (_, i) => String(a + i));
  }
  m = /^\{(\d+)\.\.(\d+)\}$/.exec(list.trim());
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    return Array.from({ length: Math.max(0, Math.min(200, b - a + 1)) }, (_, i) => String(a + i));
  }
  return shellSplit(list);
}

/** Runs one simple command (no pipes). */
async function simple(line: string, ctx: ShellCtx): Promise<ShellResult> {
  const args = shellSplit(line);
  if (!args.length) return ok('');
  const [cmd, ...rest] = args;
  const cl = ctx.cl;
  switch (cmd) {
    case 'kubectl':
    case 'k':
    case 'kubecolor':
      return kubectl(rest, ctx);
    case 'helm':
      if (!ctx.helm) return { output: 'helm: no disponible\n', exitCode: 1 };
      return ctx.helm(rest, ctx);
    case 'kustomize':
      if (rest[0] !== 'build') return { output: 'Usage:\n  kustomize build DIR\n', exitCode: 1 };
      return kubectl(['kustomize', ...rest.slice(1)], ctx);
    case 'curl':
      return curlCommand(cl, rest, {});
    case 'wget':
      return wgetCommand(cl, rest, {});
    case 'nslookup':
    case 'dig':
    case 'host':
      return {
        output: `;; connection timed out; no servers could be reached\n\n(Estás fuera del clúster: el DNS interno (${rest[0] || 'servicio'}.default.svc.cluster.local) solo resuelve dentro de un pod. Prueba: kubectl run tmp --rm -it --image=busybox -- nslookup ${rest[0] || 'web'})\n`,
        exitCode: 1,
      };
    case 'echo':
      return ok(rest.join(' ') + '\n');
    case 'ls': {
      const dir = (rest.find((x) => !x.startsWith('-')) || '').replace(/^\.\/?/, '').replace(/\/$/, '');
      const prefix = dir ? dir + '/' : '';
      const names = new Set<string>();
      for (const f of Object.keys(ctx.files))
        if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0] + (f.slice(prefix.length).includes('/') ? '/' : ''));
      if (!names.size) return { output: `ls: cannot access '${dir}': No such file or directory\n`, exitCode: 2 };
      return ok([...names].sort().join('\n') + '\n');
    }
    case 'cat': {
      let out = '';
      for (const f of rest) {
        const p = f.replace(/^\.\//, '');
        if (ctx.files[p] === undefined) return { output: out + `cat: ${f}: No such file or directory\n`, exitCode: 1 };
        out += ctx.files[p].endsWith('\n') ? ctx.files[p] : ctx.files[p] + '\n';
      }
      return ok(out);
    }
    case 'pwd':
      return ok('/home/alumno/playground\n');
    case 'whoami':
      return ok('alumno\n');
    case 'date':
      return ok(new Date(cl.now).toUTCString().replace('GMT', 'UTC') + '\n');
    case 'help':
      return ok(SHELL_HELP + '\n');
    case 'sleep': {
      const secs = parseFloat(rest[0] || '1');
      const until = cl.now + secs * 1000;
      const stream: Stream = { poll: (c) => ({ text: '', done: c.now >= until, exitCode: 0 }), stop: () => '^C\n' };
      return { output: '', exitCode: 0, stream };
    }
    case 'watch': {
      const inner = rest.filter((x, i) => !(x === '-n' || rest[i - 1] === '-n')).join(' ');
      let last = '';
      let lastAt = -Infinity;
      const render = async (c: Cluster) => {
        const r = await simple(inner, { ...ctx, cl: c });
        return `Every 2.0s: ${inner}\n\n${r.output}`;
      };
      const first = await render(cl);
      last = first;
      lastAt = cl.now;
      let pending: string | undefined;
      const stream: Stream = {
        poll(c) {
          if (c.now - lastAt < 2000) return { text: '' };
          lastAt = c.now;
          // watch reruns synchronously: kubectl get never awaits.
          void render(c).then((t) => (pending = t));
          if (pending && pending.replace(/\d+s|\d+m\d*s?/g, '') !== last.replace(/\d+s|\d+m\d*s?/g, '')) {
            last = pending;
            return { text: `\n${pending}` };
          }
          return { text: '' };
        },
        stop: () => '^C\n',
      };
      return { output: first, exitCode: 0, stream };
    }
    case 'clear':
      return { output: '', exitCode: 0, clear: true };
    case 'docker':
    case 'kind':
    case 'minikube':
      return { output: `${cmd}: el playground ya es un clúster (kind simulado con 3 nodos). Usa kubectl directamente.\n`, exitCode: 1 };
    case 'terraform':
      return { output: 'terraform: está en su propio playground (/terraform-playground).\n', exitCode: 127 };
    default:
      return { output: `sh: ${cmd}: command not found${/^kub/.test(cmd) ? ' (¿querías decir kubectl?)' : ''}\n`, exitCode: 127 };
  }
}

/** Runs a full command line. */
export async function runLine(line: string, ctx: ShellCtx): Promise<ShellResult> {
  let l = line.trim();
  if (!l || l.startsWith('#')) return ok('');
  let background = false;
  if (/\s&$/.test(l)) {
    background = true;
    l = l.replace(/\s*&$/, '');
  }
  // Redirection.
  let redirect: { file: string; append: boolean } | undefined;
  const rm = /\s(>>?)\s*([^\s|>]+)\s*$/.exec(l);
  if (rm && !/['"][^'"]*>[^'"]*['"]\s*$/.test(l)) {
    redirect = { file: rm[2].replace(/^\.\//, ''), append: rm[1] === '>>' };
    l = l.slice(0, rm.index).trim();
  }
  l = l.replace(/\s2>&1\b/g, '').replace(/\s2>\/dev\/null\b/g, '');
  // Sequences: a && b ; c
  if (/\s(&&|;)\s/.test(l) && !/^for\s/.test(l)) {
    const parts = l.split(/\s(&&|;)\s/);
    let out = '';
    let code = 0;
    for (let i = 0; i < parts.length; i += 2) {
      if (i > 0 && parts[i - 1] === '&&' && code !== 0) break;
      const r = await runLine(parts[i], ctx);
      out += r.output;
      code = r.exitCode;
      if (r.stream || r.shell || r.clear) return { ...r, output: out };
    }
    return finish({ output: out, exitCode: code }, redirect, ctx);
  }
  // for VAR in LIST; do BODY; done [| filters]
  const fm = /^for\s+(\w+)\s+in\s+(.+?);\s*do\s+(.+?);?\s*done\s*(\|.*)?$/.exec(l);
  if (fm) {
    const [, v, list, body, pipes] = fm;
    let out = '';
    let code = 0;
    for (const item of expandSeq(list)) {
      const r = await runLine(body.replace(new RegExp(`\\$\\{?${v}\\}?`, 'g'), item), ctx);
      out += r.output;
      code = r.exitCode;
      if (/sleep\s+[\d.]+/.test(body)) ctx.cl.advance(parseFloat(/sleep\s+([\d.]+)/.exec(body)![1]) * 1000);
    }
    if (pipes) {
      for (const f of splitPipes(pipes.slice(1))) {
        const r = filter(shellSplit(f), out);
        out = r.output;
        code = r.exitCode;
      }
    }
    return finish({ output: out, exitCode: code }, redirect, ctx);
  }
  const stages = splitPipes(l);
  let r = await simple(stages[0], ctx);
  if (stages.length > 1) {
    if (r.stream) {
      r.stream.stop(ctx.cl);
      r = { ...r, stream: undefined };
    }
    let out = r.output;
    let code = r.exitCode;
    for (const f of stages.slice(1)) {
      const x = filter(shellSplit(f), out);
      out = x.output;
      code = x.exitCode;
    }
    r = { output: out, exitCode: code };
  }
  if (background && r.stream) {
    r.stream.background = true;
  }
  return finish(r, redirect, ctx);
}

function finish(r: ShellResult, redirect: { file: string; append: boolean } | undefined, ctx: ShellCtx): ShellResult {
  if (!redirect) return r;
  if (redirect.file === '/dev/null') return { ...r, output: '' };
  // Error lines stay on the terminal (stderr); the rest goes to the file.
  const errLines = r.output.split('\n').filter((x) => /^(error|Error from server|warning)/i.test(x));
  const body = r.output
    .split('\n')
    .filter((x) => !/^(error|Error from server|warning)/i.test(x))
    .join('\n');
  const prev = redirect.append ? ctx.files[redirect.file] || '' : '';
  return {
    ...r,
    output: errLines.length ? errLines.join('\n') + '\n' : '',
    writeFiles: { ...(r.writeFiles || {}), [redirect.file]: prev + body },
    openFile: redirect.file,
  };
}

export { KUBECTL_HELP };
