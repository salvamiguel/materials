// What a container "does" in the simulation: which images exist, which
// ports they listen on, what they log, whether and when they exit, and what
// they answer over HTTP. It is all inferred from the image and the command.

import type { Cluster } from './cluster';
import type { Obj } from './types';
import { unbase64 } from './util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Program {
  /** server: listens and answers HTTP; forever: runs without serving; exit: ends. */
  mode: 'server' | 'forever' | 'exit';
  ports: number[];
  /** For mode exit: how long it runs and how it ends. */
  runMs: number;
  exitCode: number;
  startLogs: string[];
  /** Printed every periodMs while running (`while true; do echo …; sleep N; done`). */
  loop?: { periodMs: number; lines: string[] };
  /** Logs printed right before exiting. */
  exitLogs: string[];
  pullMs: number;
  /** The image can't be pulled (typo, tag that doesn't exist). */
  pullError?: string;
}

interface ImageInfo {
  ports: number[];
  mode: Program['mode'];
  /** Logs when it starts. */
  logs: (c: Json) => string[];
  pullMs: number;
  /** Required env vars; missing ones make it exit(1) with this log. */
  requires?: { any: string[]; log: string[] };
}

const NGINX_LOGS = [
  '/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration',
  '/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh',
  '/docker-entrypoint.sh: Configuration complete; ready for start up',
  '{T} [notice] 1#1: using the "epoll" event method',
  '{T} [notice] 1#1: nginx/{V}',
  '{T} [notice] 1#1: start worker processes',
];

const IMAGES: [RegExp, ImageInfo][] = [
  [/^(docker\.io\/)?(library\/)?nginx(:|$)|nginxinc\/nginx-unprivileged/, { ports: [80], mode: 'server', logs: () => NGINX_LOGS, pullMs: 2500 }],
  [
    /^(docker\.io\/)?(library\/)?httpd(:|$)/,
    {
      ports: [80],
      mode: 'server',
      logs: () => [
        "AH00558: httpd: Could not reliably determine the server's fully qualified domain name",
        '[mpm_event:notice] AH00489: Apache/2.4.62 (Unix) configured -- resuming normal operations',
      ],
      pullMs: 2200,
    },
  ],
  [/traefik\/whoami/, { ports: [80], mode: 'server', logs: () => ['{T} Starting up on port 80'], pullMs: 1200 }],
  [/hashicorp\/http-echo/, { ports: [5678], mode: 'server', logs: () => ['{T} [INFO] server is listening on :5678'], pullMs: 1200 }],
  [/podinfo/, { ports: [9898], mode: 'server', logs: () => ['{"level":"info","msg":"Starting podinfo","port":"9898"}'], pullMs: 2000 }],
  [/google-samples\/hello-app|gcr\.io\/google-samples/, { ports: [8080], mode: 'server', logs: () => ['{T} Server listening on port 8080'], pullMs: 1800 }],
  [/echoserver|echo-server|http-https-echo/, { ports: [8080], mode: 'server', logs: () => ['Listening on port 8080.'], pullMs: 1800 }],
  [
    /^(docker\.io\/)?(library\/)?redis(:|$)|bitnami\/redis/,
    {
      ports: [6379],
      mode: 'forever',
      logs: () => ['1:C {T} # oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo', '1:M {T} * Ready to accept connections tcp'],
      pullMs: 2200,
    },
  ],
  [
    /^(docker\.io\/)?(library\/)?postgres(:|$)|bitnami\/postgresql/,
    {
      ports: [5432],
      mode: 'forever',
      pullMs: 3500,
      logs: () => ['PostgreSQL init process complete; ready for start up.', '{T} UTC [1] LOG:  database system is ready to accept connections'],
      requires: {
        any: ['POSTGRES_PASSWORD', 'POSTGRES_HOST_AUTH_METHOD'],
        log: [
          'Error: Database is uninitialized and superuser password is not specified.',
          '       You must specify POSTGRES_PASSWORD to a non-empty value for the',
          '       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".',
        ],
      },
    },
  ],
  [
    /^(docker\.io\/)?(library\/)?(mysql|mariadb)(:|$)/,
    {
      ports: [3306],
      mode: 'forever',
      pullMs: 4000,
      logs: () => [
        "{T} 0 [System] [MY-010931] [Server] /usr/sbin/mysqld: ready for connections. Version: '8.4.2'  socket: '/var/run/mysqld/mysqld.sock'  port: 3306",
      ],
      requires: {
        any: ['MYSQL_ROOT_PASSWORD', 'MYSQL_ALLOW_EMPTY_PASSWORD', 'MYSQL_RANDOM_ROOT_PASSWORD', 'MARIADB_ROOT_PASSWORD'],
        log: [
          '{T} [ERROR] [Entrypoint]: Database is uninitialized and password option is not specified',
          '    You need to specify one of the following as an environment variable:',
          '    - MYSQL_ROOT_PASSWORD',
          '    - MYSQL_ALLOW_EMPTY_PASSWORD',
          '    - MYSQL_RANDOM_ROOT_PASSWORD',
        ],
      },
    },
  ],
  [
    /^(docker\.io\/)?(library\/)?mongo(:|$)/,
    {
      ports: [27017],
      mode: 'forever',
      logs: () => ['{"t":{"$date":"{T}"},"s":"I","c":"NETWORK","msg":"Waiting for connections","attr":{"port":27017}}'],
      pullMs: 3500,
    },
  ],
  [/^(docker\.io\/)?(library\/)?(rabbitmq|memcached)(:|$)/, { ports: [5672, 11211], mode: 'forever', logs: () => ['Server startup complete'], pullMs: 2500 }],
  [
    /coredns/,
    {
      ports: [53, 9153],
      mode: 'forever',
      logs: () => [
        '.:53',
        '[INFO] plugin/reload: Running configuration SHA512 = 591cf328cccc12bc490481273e738df59329c62c0b729d94e8b61db9961c2fa5',
        'CoreDNS-1.11.3',
        'linux/amd64, go1.21.11, a6338e9',
      ],
      pullMs: 1500,
    },
  ],
  [
    /ingress-nginx\/controller/,
    {
      ports: [80, 443],
      mode: 'server',
      logs: () => [
        '-------------------------------------------------------------------------------',
        'NGINX Ingress controller',
        '  Release:       v1.11.2',
        '-------------------------------------------------------------------------------',
        'I0926 {T} 7 main.go:205] "Creating API client" host="https://10.96.0.1:443"',
        'I0926 {T} 7 controller.go:213] "Backend successfully reloaded"',
      ],
      pullMs: 3000,
    },
  ],
  [
    /metrics-server/,
    {
      ports: [10250],
      mode: 'forever',
      logs: () => ['I0926 {T} 1 serving.go:374] Generated self-signed cert', 'I0926 {T} 1 secure_serving.go:213] Serving securely on [::]:10250'],
      pullMs: 1500,
    },
  ],
  [
    /argoproj\/argocd/,
    {
      ports: [8080],
      mode: 'server',
      pullMs: 4000,
      logs: (c) => {
        const what = argoComponent(c);
        return [`time="{T}" level=info msg="${what === 'server' ? 'argocd-server' : `argocd-${what}`} v2.13.3+b9b8fc7 serving on port ${argoPort(c)}"`];
      },
    },
  ],
  [/dexidp\/dex/, { ports: [5556], mode: 'forever', logs: () => ['time="{T}" level=info msg="listening (http) on 0.0.0.0:5556"'], pullMs: 2000 }],
  [/library\/redis/, { ports: [6379], mode: 'forever', logs: () => ['1:M {T} * Ready to accept connections tcp'], pullMs: 1500 }],
  [
    /gitops-status-demo-app/,
    { ports: [8080], mode: 'server', logs: (c) => [`gitops-status-demo ${demoVersion(c.image)} listening on :8080`], pullMs: 1800 },
  ],
  [
    /kube-proxy|kindnet|local-path-provisioner|etcd|kube-apiserver|kube-controller-manager|kube-scheduler/,
    { ports: [], mode: 'forever', logs: () => ['I0926 {T} 1 server.go:484] "Version info" version="v1.33.1"'], pullMs: 800 },
  ],
  [
    /^(docker\.io\/)?(library\/)?(busybox|alpine|ubuntu|debian|centos|fedora|curlimages\/curl|bash)(:|$)|nicolaka\/netshoot/,
    { ports: [], mode: 'exit', logs: () => [], pullMs: 900 },
  ],
  [/^(docker\.io\/)?(library\/)?(python|node|golang|ruby|openjdk|eclipse-temurin)(:|$)/, { ports: [], mode: 'exit', logs: () => [], pullMs: 3500 }],
  [/^(docker\.io\/)?(library\/)?perl(:|$)/, { ports: [], mode: 'exit', logs: () => [], pullMs: 3000 }],
];

// Tags and names that don't exist, to practise ImagePullBackOff.
const BAD_TAG = /(^|[-_.])(does-?not-?exist|nonexistent|notfound|not-found|typo|missing|bad|broken-pull|no-?existe|inexistente|falsa|mala|999\.\d+)([-_.]|$)/i;
const TYPOS = /^(ngnix|nignx|ngix|nginxx|busybxo|bussybox|redis-server|postgress|mongodb)(:|$)/i;

export function imageInfo(image: string): ImageInfo | undefined {
  return IMAGES.find(([re]) => re.test(image))?.[1];
}

export function imageTag(image: string): string {
  return /:([^/:@]+)$/.exec(image)?.[1] || 'latest';
}

export function pullError(image: string): string | undefined {
  if (!image || /\s/.test(image) || /[A-Z]/.test(image.split(':')[0])) return 'InvalidImageName';
  const repo = image.split('@')[0].replace(/:[^/:]+$/, '');
  const tag = imageTag(image);
  if (TYPOS.test(image) || BAD_TAG.test(tag)) {
    return `failed to pull and unpack image "docker.io/library/${repo}:${tag}": failed to resolve reference "docker.io/library/${repo}:${tag}": ${TYPOS.test(image) ? 'pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed' : `docker.io/library/${repo}:${tag}: not found`}`;
  }
  return undefined;
}

/** Tag and version shown in the nginx startup log. */
function nginxVersion(image: string) {
  const t = imageTag(image);
  return /^\d+\.\d+(\.\d+)?/.test(t) ? (t.split('-')[0].split('.').length === 2 ? `${t.split('-')[0]}.2` : t.split('-')[0]) : '1.27.2';
}

/** The container's command line as one shell string. */
export function commandLine(c: Json): string {
  const parts = [...(c.command || []), ...(c.args || [])].map(String);
  if (parts[0] === 'sh' || parts[0] === '/bin/sh' || parts[0] === 'bash' || parts[0] === '/bin/bash') {
    const i = parts.indexOf('-c');
    if (i >= 0) return parts.slice(i + 1).join(' ');
  }
  return parts.join(' ');
}

const PI =
  '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196442881097566593344612847564823378678316527120190914564856692346034861045432664821339360726024914127372458700660631558817488152092096282925409171536436789259036001133053054882046652138414695194151160943305727036575959195309218611738193261179310511854807446237996274956735188575272489122793818301194912';

/** Very small interpreter for the scripts people put in manifests. */
function interpret(script: string, env: Record<string, string>, now: number): Pick<Program, 'mode' | 'runMs' | 'exitCode' | 'startLogs' | 'loop' | 'exitLogs'> {
  const expand = (s: string) => s.replace(/\$\{?(\w+)\}?/g, (_, v) => env[v] ?? '').replace(/\$\(date\)/g, new Date(now).toUTCString());
  const out: string[] = [];
  let runMs = 800;
  const loopM = /while\s+(true|:|\[\s*1\s*\]);?\s*do\s+([\s\S]*?);?\s*done/.exec(script);
  const stmts = (s: string) =>
    s
      .split(/;|&&|\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  const echo = (st: string): string | undefined => {
    const m = /^(?:echo|printf)\s+(?:-[en]\s+)?(.*)$/.exec(st);
    if (!m) return undefined;
    return expand(m[1].replace(/^["']|["']$/g, '')).replace(/\\n$/, '');
  };
  const before = loopM ? script.slice(0, loopM.index) : script;
  for (const st of stmts(before)) {
    const e = echo(st);
    if (e !== undefined) out.push(e);
    else if (/^date\b/.test(st)) out.push(new Date(now).toUTCString().replace('GMT', 'UTC'));
    else if (/^perl\b.*bpi\(\s*(\d+)/.test(st)) out.push(PI.slice(0, 2 + Math.min(500, parseInt(/bpi\(\s*(\d+)/.exec(st)![1], 10))));
    else if (/^(sleep\s+(infinity|inf)|tail\s+-f\s+\/dev\/null)/.test(st)) return { mode: 'forever', runMs: 0, exitCode: 0, startLogs: out, exitLogs: [] };
    else if (/^sleep\s+([\d.]+)([smh]?)$/.test(st)) {
      const m = /^sleep\s+([\d.]+)([smh]?)$/.exec(st)!;
      runMs += parseFloat(m[1]) * ({ '': 1000, s: 1000, m: 60_000, h: 3_600_000 }[m[2]] ?? 1000);
    } else if (/^exit\s+(\d+)/.test(st)) {
      return { mode: 'exit', runMs, exitCode: parseInt(/^exit\s+(\d+)/.exec(st)![1], 10), startLogs: [], exitLogs: out };
    } else if (/^(false|cat \/nonexistent)/.test(st)) {
      return {
        mode: 'exit',
        runMs,
        exitCode: 1,
        startLogs: [],
        exitLogs: [...out, st.startsWith('cat') ? `cat: can't open '/nonexistent': No such file or directory` : ''].filter(Boolean),
      };
    }
  }
  if (loopM) {
    let period = 1000;
    const lines: string[] = [];
    for (const st of stmts(loopM[2])) {
      const e = echo(st);
      if (e !== undefined) lines.push(e);
      else if (/^date\b/.test(st)) lines.push('{DATE}');
      const s = /^sleep\s+([\d.]+)/.exec(st);
      if (s) period = parseFloat(s[1]) * 1000;
    }
    return {
      mode: 'forever',
      runMs: 0,
      exitCode: 0,
      startLogs: out,
      loop: lines.length ? { periodMs: Math.max(500, period), lines } : undefined,
      exitLogs: [],
    };
  }
  return { mode: 'exit', runMs, exitCode: 0, startLogs: [], exitLogs: out };
}

/** Env vars of a container, resolving ConfigMaps/Secrets (missing ones are skipped). */
export function containerEnv(cl: Cluster, pod: Obj, c: Json): Record<string, string> {
  const ns = pod.metadata.namespace;
  const env: Record<string, string> = {
    HOSTNAME: pod.metadata.name,
    KUBERNETES_SERVICE_HOST: '10.96.0.1',
    KUBERNETES_SERVICE_PORT: '443',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  };
  for (const ef of c.envFrom || []) {
    const src = ef.configMapRef ? cl.get('ConfigMap', ns, ef.configMapRef.name) : ef.secretRef ? cl.get('Secret', ns, ef.secretRef.name) : undefined;
    for (const [k, v] of Object.entries(src?.data || {})) env[(ef.prefix || '') + k] = ef.secretRef ? unbase64(String(v)) : String(v);
  }
  for (const e of c.env || []) {
    if (e.value !== undefined) env[e.name] = String(e.value).replace(/\$\((\w+)\)/g, (_, v) => env[v] ?? `$(${v})`);
    else if (e.valueFrom?.configMapKeyRef) {
      const v = cl.get('ConfigMap', ns, e.valueFrom.configMapKeyRef.name)?.data?.[e.valueFrom.configMapKeyRef.key];
      if (v !== undefined) env[e.name] = v;
    } else if (e.valueFrom?.secretKeyRef) {
      const v = cl.get('Secret', ns, e.valueFrom.secretKeyRef.name)?.data?.[e.valueFrom.secretKeyRef.key];
      if (v !== undefined) env[e.name] = unbase64(v);
    } else if (e.valueFrom?.fieldRef) {
      const f = e.valueFrom.fieldRef.fieldPath;
      env[e.name] =
        f === 'metadata.name'
          ? pod.metadata.name
          : f === 'metadata.namespace'
            ? ns
            : f === 'status.podIP'
              ? pod.status?.podIP || ''
              : f === 'spec.nodeName'
                ? pod.spec?.nodeName || ''
                : f.startsWith('metadata.labels[')
                  ? (pod.metadata.labels?.[f.slice(17, -2)] ?? '')
                  : '';
    }
  }
  return env;
}

export function program(cl: Cluster, pod: Obj, c: Json): Program {
  const info = imageInfo(c.image || '');
  const env = containerEnv(cl, pod, c);
  const script = commandLine(c);
  const hasCmd = (c.command || []).length > 0 || (info?.mode === 'exit' && (c.args || []).length > 0);
  const base = {
    pullMs: info?.pullMs ?? 2500,
    pullError: pullError(c.image || ''),
  };
  const stamp = (lines: string[]) =>
    lines.map((l) => l.replace(/\{T\}/g, new Date(cl.now).toISOString().replace('T', ' ').slice(0, 19)).replace(/\{V\}/g, nginxVersion(c.image)));

  if (hasCmd || info?.mode === 'exit') {
    const r = interpret(script, env, cl.now);
    // A server image whose command still runs the server (e.g. nginx -g 'daemon off;').
    if (info && info.mode === 'server' && /nginx|httpd|http-echo|whoami|podinfo/.test(script) && r.mode === 'exit' && r.exitLogs.length === 0) {
      return { ...base, mode: 'server', ports: serverPorts(c, info), runMs: 0, exitCode: 0, startLogs: stamp(info.logs(c)), exitLogs: [] };
    }
    return { ...base, ...r, ports: r.mode === 'forever' && info?.mode === 'server' ? serverPorts(c, info) : [], startLogs: r.startLogs, exitLogs: r.exitLogs };
  }
  if (info?.requires && !info.requires.any.some((k) => env[k])) {
    return { ...base, mode: 'exit', ports: [], runMs: 1500, exitCode: 1, startLogs: [], exitLogs: stamp(info.requires.log) };
  }
  if (info) return { ...base, mode: info.mode, ports: serverPorts(c, info), runMs: 0, exitCode: 0, startLogs: stamp(info.logs(c)), exitLogs: [] };
  // Unknown image: a web app listening where it says it listens.
  const declared = (c.ports || []).map((p: Json) => p.containerPort).filter(Boolean);
  return {
    ...base,
    mode: 'server',
    ports: declared.length ? declared : [8080],
    runMs: 0,
    exitCode: 0,
    startLogs: [`Listening on :${declared[0] || 8080}`],
    exitLogs: [],
  };
}

/** Which ArgoCD component a container runs (from its args). */
export function argoComponent(c: Json): string {
  const cmd = [...(c.command || []), ...(c.args || [])].join(' ');
  const m = /argocd-(server|repo-server|application-controller|applicationset-controller|notifications)/.exec(cmd);
  return m ? m[1] : 'server';
}

function argoPort(c: Json): number {
  return { server: 8080, 'repo-server': 8081, 'application-controller': 8082, 'applicationset-controller': 7000, notifications: 9001 }[argoComponent(c)] ?? 8080;
}

/** gitops-status-demo-app: the version is the image tag ("dev" for latest). */
export function demoVersion(image: string) {
  const t = imageTag(image);
  return t === 'latest' ? 'dev' : t;
}

function demoColor(version: string) {
  return version.startsWith('v1') ? '#22c55e' : version.startsWith('v2') ? '#3b82f6' : version.startsWith('v3') ? '#a855f7' : '#6b7280';
}

function serverPorts(c: Json, info: ImageInfo): number[] {
  const img = c.image || '';
  const args = (c.args || []).join(' ');
  if (/argoproj\/argocd/.test(img)) return [argoPort(c)];
  if (/gitops-status-demo-app/.test(img)) {
    const env = (c.env || []).find((e: Json) => e.name === 'PORT');
    return [env?.value ? parseInt(env.value, 10) : 8080];
  }
  if (/http-echo/.test(img)) {
    const m = /-listen[= ]:?(\d+)/.exec(args);
    return [m ? parseInt(m[1], 10) : 5678];
  }
  if (/podinfo/.test(img)) {
    const m = /--port[= ](\d+)/.exec([...(c.command || []), ...(c.args || [])].join(' '));
    return [m ? parseInt(m[1], 10) : 9898];
  }
  if (/whoami/.test(img)) {
    const m = /--port[= ](\d+)/.exec(args);
    if (m) return [parseInt(m[1], 10)];
    const env = (c.env || []).find((e: Json) => e.name === 'WHOAMI_PORT_NUMBER');
    if (env) return [parseInt(env.value, 10)];
  }
  return info.ports;
}

// ── HTTP ─────────────────────────────────────────────────────────────

/** Files a container sees under its ConfigMap/Secret volume mounts. */
export function mountedFiles(cl: Cluster, pod: Obj, c: Json): Record<string, string> {
  const files: Record<string, string> = {};
  const ns = pod.metadata.namespace;
  for (const m of c.volumeMounts || []) {
    const vol = (pod.spec.volumes || []).find((v: Json) => v.name === m.name);
    if (!vol) continue;
    let data: Record<string, string> | undefined;
    if (vol.configMap) data = cl.get('ConfigMap', ns, vol.configMap.name)?.data;
    if (vol.secret) {
      const s = cl.get('Secret', ns, vol.secret.secretName);
      data = s ? Object.fromEntries(Object.entries(s.data || {}).map(([k, v]) => [k, unbase64(String(v))])) : undefined;
    }
    if (!data) continue;
    const items = (vol.configMap || vol.secret).items as { key: string; path: string }[] | undefined;
    const entries = items ? items.filter((it) => it.key in data!).map((it) => [it.path, data![it.key]] as const) : Object.entries(data);
    for (const [k, v] of entries) {
      if (m.subPath) {
        if (m.subPath === k) files[m.mountPath] = v;
      } else files[`${m.mountPath.replace(/\/$/, '')}/${k}`] = v;
    }
  }
  return files;
}

export interface HttpResult {
  status: number;
  body: string;
  /** The ArgoCD web UI (the playground's browser draws it). */
  argocd?: boolean;
}

/** What a pod's container answers to GET path on port. */
export function httpAnswer(cl: Cluster, pod: Obj, port: number, path: string, host: string): HttpResult | { refused: true } {
  for (const c of pod.spec.containers || []) {
    const p = program(cl, pod, c);
    if (p.mode !== 'server' && !(p.mode === 'forever' && p.ports.length && imageInfo(c.image)?.mode === 'server')) continue;
    if (!p.ports.includes(port)) continue;
    const img: string = c.image || '';
    const env = containerEnv(cl, pod, c);
    const files = mountedFiles(cl, pod, c);
    if (/nginx|httpd/.test(img) && !/ingress-nginx/.test(img)) {
      const root = /httpd/.test(img) ? '/usr/local/apache2/htdocs' : '/usr/share/nginx/html';
      const clean = path.split('?')[0];
      const file = files[`${root}${clean === '/' ? '/index.html' : clean}`] ?? (clean.endsWith('/') ? files[`${root}${clean}index.html`] : undefined);
      if (file !== undefined) return { status: 200, body: file };
      if (clean === '/' || clean === '/index.html') {
        return {
          status: 200,
          body: /httpd/.test(img)
            ? '<html><body><h1>It works!</h1></body></html>\n'
            : `<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n<p><em>Thank you for using nginx.</em></p>\n</body>\n</html>\n`,
        };
      }
      return {
        status: 404,
        body: `<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>nginx/${nginxVersion(img)}</center>\n</body>\n</html>\n`,
      };
    }
    if (/http-echo/.test(img)) {
      const all: string[] = [...(c.command || []), ...(c.args || [])].map(String);
      const i = all.findIndex((a) => /^--?text(=|$)/.test(a));
      const text = i < 0 ? 'hello-world' : all[i].includes('=') ? all[i].slice(all[i].indexOf('=') + 1) : (all[i + 1] ?? '');
      return { status: 200, body: text.replace(/\$\((\w+)\)/g, (_, v) => env[v] ?? '') + '\n' };
    }
    if (/whoami/.test(img)) {
      return {
        status: 200,
        body: `Hostname: ${pod.metadata.name}\nIP: 127.0.0.1\nIP: ${pod.status?.podIP}\nRemoteAddr: 10.244.0.1:48212\nGET ${path} HTTP/1.1\nHost: ${host}\nUser-Agent: curl/8.10.1\nAccept: */*\n`,
      };
    }
    if (/podinfo/.test(img)) {
      const color = env.PODINFO_UI_COLOR || '#34577c';
      const msg = env.PODINFO_UI_MESSAGE || `greetings from podinfo v${imageTag(img).replace(/^v/, '')}`;
      return {
        status: 200,
        body:
          JSON.stringify(
            {
              hostname: pod.metadata.name,
              version: imageTag(img).replace(/^v/, ''),
              revision: '',
              color,
              logo: 'https://raw.githubusercontent.com/stefanprodan/podinfo/gh-pages/cuddle_clap.gif',
              message: msg,
              goos: 'linux',
              goarch: 'amd64',
              runtime: 'go1.23.2',
              num_goroutine: '8',
              num_cpu: '4',
            },
            null,
            2,
          ) + '\n',
      };
    }
    if (/argoproj\/argocd/.test(img)) {
      if (argoComponent(c) !== 'server') return { status: 404, body: '404 page not found\n' };
      if (path.startsWith('/healthz')) return { status: 200, body: 'ok\n' };
      if (path.startsWith('/api/version')) return { status: 200, body: JSON.stringify({ Version: 'v2.13.3+b9b8fc7', BuildDate: '2025-01-03T15:25:45Z', GoVersion: 'go1.23.1', Platform: 'linux/amd64' }) + '\n' };
      return {
        status: 200,
        argocd: true,
        body: '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Argo CD</title><base href="/"><link rel="icon" type="image/png" href="assets/favicon/favicon-32x32.png" sizes="32x32"/></head><body><noscript><p>Your browser does not support JavaScript. Please enable JavaScript to view the site. Alternatively, Argo CD can be used with the <a href="https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd/">Argo CD CLI</a>.</p></noscript><div id="app"></div></body><script defer="defer" src="main.67d3d35d60308e91.js"></script></html>\n',
      };
    }
    if (/gitops-status-demo-app/.test(img)) {
      const version = demoVersion(img);
      const color = env.APP_COLOR || demoColor(version);
      const started = Date.parse(pod.status?.startTime || '') || cl.now;
      const up = Math.max(0, Math.floor((cl.now - started) / 1000));
      const uptime = up >= 3600 ? `${Math.floor(up / 3600)}h${Math.floor((up % 3600) / 60)}m${up % 60}s` : up >= 60 ? `${Math.floor(up / 60)}m${up % 60}s` : `${up}s`;
      const envName = env.ENV || 'local';
      const clean = path.split('?')[0];
      if (clean === '/health') return { status: 200, body: JSON.stringify({ status: 'ok', version }) + '\n' };
      if (clean === '/api/status') return { status: 200, body: JSON.stringify({ version, hostname: pod.metadata.name, env: envName, color, uptime }) + '\n' };
      if (clean !== '/') return { status: 404, body: '404 page not found\n' };
      return { status: 200, body: statusPage(version, pod.metadata.name, envName, uptime, color) };
    }
    if (/hello-app|google-samples/.test(img)) {
      return { status: 200, body: `Hello, world!\nVersion: ${imageTag(img).replace(/^v/, '')}.0.0\nHostname: ${pod.metadata.name}\n` };
    }
    if (/echoserver|echo-server/.test(img)) {
      return {
        status: 200,
        body: `Hostname: ${pod.metadata.name}\n\nRequest Information:\n\tmethod=GET\n\treal path=${path}\n\trequest_uri=http://${host}:8080${path}\n`,
      };
    }
    const msg = env.MESSAGE || env.GREETING || env.APP_MESSAGE;
    const version = env.VERSION || env.APP_VERSION || imageTag(img);
    return { status: 200, body: `${msg ? msg + '\n' : ''}Hola desde ${pod.metadata.name} (${img}, versión ${version})\n` };
  }
  return { refused: true };
}

/** gitops-status-demo-app's static/index.html, with what its JavaScript would fill in. */
function statusPage(version: string, hostname: string, env: string, uptime: string, color: string) {
  const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Status</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background-color: ${esc(color)}; color: white; }
        .container { text-align: center; padding: 2rem; max-width: 600px; width: 100%; }
        .status-icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 2.5rem; margin-bottom: 0.5rem; font-weight: 700; }
        .subtitle { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }
        .version-badge { display: inline-block; background: rgba(255,255,255,0.25); padding: 0.3rem 1rem; border-radius: 20px; font-size: 0.9rem; margin-bottom: 1rem; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem; }
        .info-card { background: rgba(255,255,255,0.15); border-radius: 12px; padding: 1.2rem; border: 1px solid rgba(255,255,255,0.2); }
        .info-card .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.8; margin-bottom: 0.3rem; }
        .info-card .value { font-size: 1.1rem; font-weight: 600; word-break: break-all; }
    </style>
</head>
<body>
    <div class="container">
        <div class="status-icon">&#10003;</div>
        <div class="version-badge" id="version">${esc(version)}</div>
        <h1>System Operational</h1>
        <p class="subtitle">All systems are running normally</p>
        <div class="info-grid">
            <div class="info-card"><div class="label">Hostname</div><div class="value" id="hostname">${esc(hostname)}</div></div>
            <div class="info-card"><div class="label">Environment</div><div class="value" id="env">${esc(env)}</div></div>
            <div class="info-card"><div class="label">Uptime</div><div class="value" id="uptime">${esc(uptime)}</div></div>
            <div class="info-card"><div class="label">Color</div><div class="value" id="color">${esc(color)}</div></div>
        </div>
    </div>
</body>
</html>
`;
}
