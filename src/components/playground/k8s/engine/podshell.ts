// A tiny shell inside a container, for `kubectl exec` and `kubectl run -it`:
// env, cat of mounted ConfigMaps/Secrets, ls, hostname, curl/wget, nslookup…

import type { Cluster } from './cluster';
import { curlCommand, nslookup, wgetCommand } from './net';
import { containerEnv, imageInfo, mountedFiles } from './runtime';
import { shellSplit } from '../../shared/shell';
import type { Obj } from './types';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PodShell {
  pod: Obj;
  container: Json;
  cwd: string;
}

function hasCurl(image: string) {
  return !/^(docker\.io\/)?(library\/)?(busybox|alpine)(:|$)/.test(image);
}

function hasWget(image: string) {
  return /busybox|alpine|curl|netshoot/.test(image) || !hasCurl(image);
}

function files(cl: Cluster, sh: PodShell): Record<string, string> {
  const { pod, container: c } = sh;
  const ns = pod.metadata.namespace;
  const f: Record<string, string> = {
    '/etc/hostname': `${pod.spec.hostname || pod.metadata.name}\n`,
    '/etc/resolv.conf': `search ${ns}.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5\n`,
    '/etc/hosts': `# Kubernetes-managed hosts file.\n127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost ip6-loopback\n${pod.status?.podIP}\t${pod.metadata.name}\n`,
    '/var/run/secrets/kubernetes.io/serviceaccount/namespace': ns,
    '/var/run/secrets/kubernetes.io/serviceaccount/token': 'eyJhbGciOiJSUzI1NiIsImtpZCI6InBsYXlncm91bmQifQ.simulado.firma',
    '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt': '-----BEGIN CERTIFICATE-----\n(simulado)\n-----END CERTIFICATE-----\n',
  };
  if (/nginx/.test(c.image)) {
    f['/usr/share/nginx/html/index.html'] = '<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n</body>\n</html>\n';
    f['/usr/share/nginx/html/50x.html'] = '<!DOCTYPE html>\n<html>\n<head>\n<title>Error</title>\n</head>\n</html>\n';
    f['/etc/nginx/nginx.conf'] = 'user  nginx;\nworker_processes  auto;\n\nevents {\n    worker_connections  1024;\n}\n\nhttp {\n    include       /etc/nginx/mime.types;\n    include /etc/nginx/conf.d/*.conf;\n}\n';
    f['/etc/nginx/conf.d/default.conf'] = 'server {\n    listen       80;\n    server_name  localhost;\n\n    location / {\n        root   /usr/share/nginx/html;\n        index  index.html index.htm;\n    }\n}\n';
  }
  Object.assign(f, mountedFiles(cl, pod, c));
  for (const m of c.volumeMounts || []) {
    const vol = (pod.spec.volumes || []).find((v: Json) => v.name === m.name);
    if (vol?.emptyDir || vol?.persistentVolumeClaim) f[`${m.mountPath.replace(/\/$/, '')}/.keep`] ??= '';
  }
  return f;
}

function resolve(cwd: string, p: string) {
  const path = p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p}`;
  const parts: string[] = [];
  for (const s of path.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') parts.pop();
    else parts.push(s);
  }
  return '/' + parts.join('/');
}

const ROOT_DIRS = ['bin', 'dev', 'etc', 'home', 'lib', 'media', 'mnt', 'opt', 'proc', 'root', 'run', 'sbin', 'srv', 'sys', 'tmp', 'usr', 'var'];

/** Runs one command line in the container. Returns output and exit code; `exit` ends the session. */
export function podExec(cl: Cluster, sh: PodShell, line: string): { output: string; exitCode: number; exit?: boolean } {
  const trimmed = line.trim();
  if (!trimmed) return { output: '', exitCode: 0 };
  // Several commands: a; b && c
  if (/;|&&/.test(trimmed) && !/^(sh|bash) -c/.test(trimmed)) {
    let out = '';
    let code = 0;
    for (const part of trimmed.split(/;|&&/)) {
      const r = podExec(cl, sh, part);
      out += r.output;
      code = r.exitCode;
      if (r.exit) return { output: out, exitCode: code, exit: true };
    }
    return { output: out, exitCode: code };
  }
  const args = shellSplit(trimmed);
  const env = containerEnv(cl, sh.pod, sh.container);
  const expand = (s: string) => s.replace(/\$\{?(\w+)\}?/g, (_, v) => env[v] ?? '');
  const [cmd, ...rest] = args.map(expand);
  const fs = files(cl, sh);
  const shName = /busybox|alpine/.test(sh.container.image) ? 'sh' : '/bin/sh';
  const notFound = (c: string) => ({ output: `${shName}: ${c}: not found\n`, exitCode: 127 });
  switch (cmd) {
    case 'exit':
      return { output: '', exitCode: 0, exit: true };
    case 'sh':
    case 'bash':
    case '/bin/sh':
    case '/bin/bash': {
      if (cmd.includes('bash') && /busybox|alpine/.test(sh.container.image)) return { output: `OCI runtime exec failed: exec failed: unable to start container process: exec: "${cmd}": executable file not found in $PATH: unknown\n`, exitCode: 126 };
      const i = rest.indexOf('-c');
      if (i >= 0) return podExec(cl, sh, rest.slice(i + 1).join(' '));
      return { output: '', exitCode: 0 };
    }
    case 'env':
    case 'printenv':
      if (rest[0]) return env[rest[0]] !== undefined ? { output: env[rest[0]] + '\n', exitCode: 0 } : { output: '', exitCode: 1 };
      return { output: Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', exitCode: 0 };
    case 'echo':
      return { output: rest.join(' ') + '\n', exitCode: 0 };
    case 'hostname':
      return { output: `${sh.pod.spec.hostname || sh.pod.metadata.name}\n`, exitCode: 0 };
    case 'whoami':
      return { output: 'root\n', exitCode: 0 };
    case 'id':
      return { output: 'uid=0(root) gid=0(root) groups=0(root)\n', exitCode: 0 };
    case 'pwd':
      return { output: sh.cwd + '\n', exitCode: 0 };
    case 'cd':
      sh.cwd = resolve(sh.cwd, rest[0] || '/');
      return { output: '', exitCode: 0 };
    case 'date':
      return { output: new Date(cl.now).toUTCString().replace('GMT', 'UTC') + '\n', exitCode: 0 };
    case 'uname':
      return { output: rest.includes('-a') ? `Linux ${sh.pod.metadata.name} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux\n` : 'Linux\n', exitCode: 0 };
    case 'ps':
      return { output: `PID   USER     TIME  COMMAND\n    1 root      0:00 ${[...(sh.container.command || []), ...(sh.container.args || [])].join(' ') || imageInfo(sh.container.image)?.mode === 'server' ? 'nginx: master process nginx -g daemon off;' : 'sh'}\n   42 root      0:00 ps\n`, exitCode: 0 };
    case 'cat': {
      let out = '';
      let code = 0;
      for (const p of rest) {
        const path = resolve(sh.cwd, p);
        if (fs[path] !== undefined) out += fs[path];
        else {
          out += `cat: ${p}: No such file or directory\n`;
          code = 1;
        }
      }
      return { output: out, exitCode: code };
    }
    case 'ls': {
      const target = resolve(sh.cwd, rest.filter((r) => !r.startsWith('-'))[0] || '.');
      if (fs[target] !== undefined) return { output: target.split('/').pop() + '\n', exitCode: 0 };
      const prefix = target === '/' ? '/' : target + '/';
      const names = new Set<string>();
      for (const f of Object.keys(fs)) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split('/')[0]);
      if (target === '/') ROOT_DIRS.forEach((d) => names.add(d));
      names.delete('.keep');
      if (!names.size && !Object.keys(fs).some((f) => f.startsWith(prefix))) {
        if (['/tmp', '/home', '/root', '/mnt', '/opt', '/srv'].includes(target)) return { output: '', exitCode: 0 };
        return { output: `ls: ${rest[0] || target}: No such file or directory\n`, exitCode: 1 };
      }
      return { output: [...names].sort().join('\n') + (names.size ? '\n' : ''), exitCode: 0 };
    }
    case 'curl':
      if (!hasCurl(sh.container.image)) return notFound('curl');
      return curlCommand(cl, rest, { pod: sh.pod });
    case 'wget':
      if (!hasWget(sh.container.image)) return notFound('wget');
      return wgetCommand(cl, rest, { pod: sh.pod });
    case 'nslookup':
    case 'host':
    case 'dig':
      if (!rest[0]) return { output: 'Usage: nslookup HOST\n', exitCode: 1 };
      return nslookup(cl, rest[rest.length - 1], { pod: sh.pod });
    case 'ping':
      return { output: `PING ${rest[0]}: 56 data bytes\n(ICMP no llega a las IPs de los Services en Kubernetes: prueba con curl o wget)\n`, exitCode: 1 };
    case 'sleep':
    case 'true':
      return { output: '', exitCode: 0 };
    case 'false':
      return { output: '', exitCode: 1 };
    case 'redis-cli':
      if (!/redis/.test(sh.container.image)) return notFound(cmd);
      return { output: rest.map((r) => r.toUpperCase()).includes('PING') ? 'PONG\n' : 'OK\n', exitCode: 0 };
    case 'psql':
    case 'mysql':
      if (!/postgres|mysql|mariadb/.test(sh.container.image)) return notFound(cmd);
      return { output: `${cmd} (simulado): conexión correcta a la base de datos local.\n`, exitCode: 0 };
    case 'nginx':
      if (!/nginx/.test(sh.container.image)) return notFound(cmd);
      return { output: rest.includes('-t') ? 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n' : 'nginx version: nginx/1.27.2\n', exitCode: 0 };
    case 'touch':
    case 'mkdir':
    case 'rm':
      return { output: '', exitCode: 0 };
    default:
      return notFound(cmd);
  }
}

export function podPrompt(sh: PodShell) {
  const busy = /busybox|alpine/.test(sh.container.image);
  return busy ? `${sh.cwd === '/' ? '/' : sh.cwd} # ` : `root@${sh.pod.metadata.name}:${sh.cwd}# `;
}
