// Cluster networking as seen by curl: cluster DNS, Services (ClusterIP with
// round-robin over ready endpoints, NodePort, LoadBalancer), Ingress routing,
// pod IPs and `kubectl port-forward`.

import type { Cluster } from './cluster';
import { INGRESS_IP, NODES } from './bootstrap';
import { podReady } from './controllers/common';
import { serviceEndpoints, targetPortFor } from './controllers/infra';
import { httpAnswer } from './runtime';
import type { Obj } from './types';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface From {
  /** Pod the request comes from (kubectl exec / run); undefined: your laptop. */
  pod?: Obj;
}

type Target =
  | { kind: 'service'; svc: Obj; port: number }
  | { kind: 'pod'; pod: Obj; port: number }
  | { kind: 'ingress'; port: number }
  | { kind: 'error'; code: number; msg: string };

export interface HttpResponse {
  status: number;
  body: string;
  server: string;
  pod?: Obj;
}

/** Resolves a DNS name inside the cluster. */
export function resolveName(cl: Cluster, name: string, ns: string): { ips: string[]; fqdn: string; svc?: Obj; pods?: Obj[] } | undefined {
  const n = name.replace(/\.$/, '').toLowerCase();
  const parts = n.replace(/\.cluster\.local$/, '').replace(/\.svc$/, '').split('.');
  // pod-0.headless[.ns]
  if (parts.length >= 2) {
    const svc = cl.get('Service', parts[2] || ns, parts[1]);
    if (svc && svc.spec.clusterIP === 'None') {
      const pod = cl.list('Pod', svc.metadata.namespace).find((p) => p.spec.hostname === parts[0] && p.spec.subdomain === svc.metadata.name);
      if (pod?.status?.podIP) return { ips: [pod.status.podIP], fqdn: `${parts[0]}.${svc.metadata.name}.${svc.metadata.namespace}.svc.cluster.local`, pods: [pod] };
    }
  }
  if (parts.length <= 2) {
    const svc = cl.get('Service', parts[1] || ns, parts[0]);
    if (svc) {
      const fqdn = `${svc.metadata.name}.${svc.metadata.namespace}.svc.cluster.local`;
      if (svc.spec.clusterIP === 'None') {
        const pods = serviceEndpoints(cl, svc).ready;
        return { ips: pods.map((p) => p.status.podIP), fqdn, svc, pods };
      }
      if (svc.spec.type === 'ExternalName') return { ips: [], fqdn: svc.spec.externalName, svc };
      return { ips: [svc.spec.clusterIP], fqdn, svc };
    }
  }
  return undefined;
}

function podByIp(cl: Cluster, ip: string) {
  return cl.list('Pod').find((p) => p.status?.podIP === ip && !p.spec.hostNetwork && !p.metadata.deletionTimestamp);
}

function ingressHosts(cl: Cluster): string[] {
  return cl.list('Ingress').flatMap((i) => (i.spec?.rules || []).map((r: Json) => r.host).filter(Boolean));
}

function locate(cl: Cluster, host: string, port: number | undefined, from: From): Target {
  const ns = from.pod?.metadata.namespace || cl.s.namespace;
  const h = host.toLowerCase();
  // localhost
  if (h === 'localhost' || h === '127.0.0.1') {
    if (from.pod) return { kind: 'pod', pod: from.pod, port: port ?? 80 };
    const pf = cl.s.portForwards.find((f) => f.local === (port ?? 80));
    if (!pf) return { kind: 'error', code: 7, msg: `Failed to connect to ${host} port ${port ?? 80} after 0 ms: Couldn't connect to server` };
    const obj = cl.get(pf.kind, pf.namespace, pf.name);
    if (!obj) return { kind: 'error', code: 52, msg: 'Empty reply from server' };
    if (pf.kind === 'Service') return { kind: 'service', svc: obj, port: pf.port };
    if (pf.kind === 'Pod') return { kind: 'pod', pod: obj, port: pf.port };
    return { kind: 'error', code: 7, msg: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server` };
  }
  // Ingress controller (the /etc/hosts of the playground points every Ingress host to it).
  if (h === INGRESS_IP || ingressHosts(cl).includes(h) || h.endsWith('.localhost') || h.endsWith('.nip.io')) {
    if (h !== INGRESS_IP && !ingressHosts(cl).includes(h) && !cl.list('Ingress').some((i) => (i.spec?.rules || []).some((r: Json) => !r.host))) {
      return { kind: 'error', code: 6, msg: `Could not resolve host: ${host}` };
    }
    return { kind: 'ingress', port: port ?? 80 };
  }
  // Node IPs: NodePorts.
  const node = NODES.find((n) => n.ip === h || n.name === h);
  if (node) {
    const svc = cl.list('Service').find((s) => (s.spec.ports || []).some((p: Json) => p.nodePort === port));
    if (!svc) return { kind: 'error', code: 7, msg: `Failed to connect to ${host} port ${port ?? 80} after 0 ms: Couldn't connect to server` };
    if (svc.metadata.name === 'ingress-nginx-controller') return { kind: 'ingress', port: 80 };
    const sp = svc.spec.ports.find((p: Json) => p.nodePort === port);
    return { kind: 'service', svc, port: sp.port };
  }
  // LoadBalancer IPs.
  const lb = cl.list('Service').find((s) => (s.status?.loadBalancer?.ingress || []).some((i: Json) => i.ip === h));
  if (lb) {
    if (lb.metadata.name === 'ingress-nginx-controller') return { kind: 'ingress', port: port ?? 80 };
    return { kind: 'service', svc: lb, port: port ?? lb.spec.ports[0].port };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const svc = cl.list('Service').find((s) => s.spec.clusterIP === h);
    if (svc) {
      if (!from.pod) return { kind: 'error', code: 28, msg: `Failed to connect to ${host} port ${port ?? 80} after 3002 ms: Timeout was reached` };
      return { kind: 'service', svc, port: port ?? 80 };
    }
    const pod = podByIp(cl, h);
    if (pod) {
      if (!from.pod) return { kind: 'error', code: 28, msg: `Failed to connect to ${host} port ${port ?? 80} after 3002 ms: Timeout was reached` };
      return { kind: 'pod', pod, port: port ?? 80 };
    }
    return { kind: 'error', code: 28, msg: `Failed to connect to ${host} port ${port ?? 80} after 3002 ms: Timeout was reached` };
  }
  if (!from.pod) return { kind: 'error', code: 6, msg: `Could not resolve host: ${host}` };
  const r = resolveName(cl, h, ns);
  if (!r) return { kind: 'error', code: 6, msg: `Could not resolve host: ${host}` };
  if (r.pods && (r.svc?.spec.clusterIP === 'None' || !r.svc)) {
    const pod = r.pods[0];
    if (!pod) return { kind: 'error', code: 6, msg: `Could not resolve host: ${host}` };
    return { kind: 'pod', pod, port: port ?? 80 };
  }
  return { kind: 'service', svc: r.svc!, port: port ?? 80 };
}

function nginxAccessLog(cl: Cluster, pod: Obj, path: string, status: number, bytes: number, from: From) {
  const rt = cl.s.pods[pod.metadata.uid];
  const c = pod.spec.containers[0];
  if (!rt || !c || !/nginx|httpd/.test(c.image)) return;
  const cr = rt.containers[c.name];
  if (!cr) return;
  const d = new Date(cl.now);
  const mon = d.toUTCString().split(' ')[2];
  const stamp = `${String(d.getUTCDate()).padStart(2, '0')}/${mon}/${d.getUTCFullYear()}:${d.toISOString().slice(11, 19)} +0000`;
  const ip = from.pod?.status?.podIP || '10.244.0.1';
  cr.logs.push({ t: cl.now, text: `${ip} - - [${stamp}] "GET ${path} HTTP/1.1" ${status} ${bytes} "-" "curl/8.10.1" "-"` });
}

function toPod(cl: Cluster, pod: Obj, port: number, path: string, host: string, from: From): HttpResponse | { error: string; code: number } {
  if (!podReady(pod) && pod.status?.phase !== 'Running') {
    return { error: `Failed to connect to ${pod.status?.podIP || host} port ${port} after 0 ms: Couldn't connect to server`, code: 7 };
  }
  const a = httpAnswer(cl, pod, port, path, host);
  if ('refused' in a) return { error: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`, code: 7 };
  nginxAccessLog(cl, pod, path, a.status, a.body.length, from);
  const img = pod.spec.containers[0]?.image || '';
  return { status: a.status, body: a.body, pod, server: /nginx/.test(img) ? 'nginx' : /httpd/.test(img) ? 'Apache' : '' };
}

function toService(cl: Cluster, svc: Obj, port: number, path: string, host: string, from: From): HttpResponse | { error: string; code: number } {
  const portSpec = (svc.spec.ports || []).find((p: Json) => p.port === port);
  if (!portSpec) return { error: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`, code: 7 };
  const { ready } = serviceEndpoints(cl, svc);
  if (!ready.length) return { error: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`, code: 7 };
  const i = (cl.s.rr[svc.metadata.uid] = ((cl.s.rr[svc.metadata.uid] ?? -1) + 1) % ready.length);
  // Deterministic but not strictly alternating, like iptables' random choice.
  const pick = ready[(i * 7 + Math.floor(cl.random() * ready.length)) % ready.length];
  const tp = targetPortFor(pick, portSpec.targetPort) ?? port;
  return toPod(cl, pick, tp, path, host, from);
}

function toIngress(cl: Cluster, hostHeader: string, path: string, from: From): HttpResponse | { error: string; code: number } {
  const host = hostHeader.split(':')[0].toLowerCase();
  let best: { ing: Obj; p: Json; len: number } | undefined;
  for (const ing of cl.list('Ingress')) {
    if (!ing.status?.loadBalancer?.ingress) continue;
    for (const r of ing.spec?.rules || []) {
      if (r.host && r.host !== host && !(r.host.startsWith('*.') && host.endsWith(r.host.slice(1)))) continue;
      for (const p of r.http?.paths || []) {
        const pp: string = p.path || '/';
        const ok = p.pathType === 'Exact' ? path.split('?')[0] === pp : path === pp || path.startsWith(pp.endsWith('/') ? pp : pp + '/') || pp === '/';
        if (ok && (!best || pp.length > best.len)) best = { ing, p, len: pp.length };
      }
    }
  }
  if (!best) {
    const def = cl.list('Ingress').find((i) => i.spec?.defaultBackend?.service);
    if (def) best = { ing: def, p: { backend: def.spec.defaultBackend }, len: 0 };
  }
  if (!best) return { status: 404, body: '<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n', server: 'nginx' };
  const b = best.p.backend.service;
  const svc = cl.get('Service', best.ing.metadata.namespace, b.name);
  const unavailable = { status: 503, body: '<html>\n<head><title>503 Service Temporarily Unavailable</title></head>\n<body>\n<center><h1>503 Service Temporarily Unavailable</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n', server: 'nginx' };
  if (!svc) return unavailable;
  const port = b.port?.number ?? (svc.spec.ports || []).find((p: Json) => p.name === b.port?.name)?.port;
  const r = toService(cl, svc, port, rewrite(best.ing, best.p, path), host, from);
  if ('error' in r) return unavailable;
  return { ...r, server: 'nginx' };
}

function rewrite(ing: Obj, p: Json, path: string) {
  const target = ing.metadata.annotations?.['nginx.ingress.kubernetes.io/rewrite-target'];
  if (!target) return path;
  const m = new RegExp(`^${p.path}`).exec(path);
  if (!m) return path;
  return target.replace(/\$(\d)/g, (_: string, i: string) => m[parseInt(i, 10)] ?? '') || '/';
}

/** One HTTP GET. */
export function httpGet(cl: Cluster, url: string, from: From, hostHeader?: string): HttpResponse | { error: string; code: number } {
  const m = /^(?:(https?):\/\/)?([^/:?#]+)(?::(\d+))?([^#]*)$/.exec(url.trim());
  if (!m) return { error: `URL rejected: Malformed input to a URL function`, code: 3 };
  const [, scheme, host, portStr, rest] = m;
  const port = portStr ? parseInt(portStr, 10) : scheme === 'https' ? 443 : undefined;
  const path = rest || '/';
  const t = locate(cl, host, port, from);
  if (t.kind === 'error') return { error: t.msg, code: t.code };
  if (t.kind === 'ingress') return toIngress(cl, hostHeader || host, path, from);
  if (t.kind === 'service') {
    if (t.svc.spec.type === 'ExternalName') return { error: `Could not resolve host: ${t.svc.spec.externalName}`, code: 6 };
    return toService(cl, t.svc, t.port, path, hostHeader || host, from);
  }
  return toPod(cl, t.pod, t.port, path, hostHeader || host, from);
}

const REASONS: Record<number, string> = { 200: 'OK', 404: 'Not Found', 503: 'Service Temporarily Unavailable', 500: 'Internal Server Error' };

/** `curl [-s] [-i] [-I] [-H 'Host: x'] [-o file] [-w fmt] URL`. */
export function curlCommand(cl: Cluster, args: string[], from: From): { output: string; exitCode: number } {
  let include = false;
  let head = false;
  let silent = false;
  let showErr = false;
  let hostHeader: string | undefined;
  let discard = false;
  let write = '';
  let fail = false;
  const urls: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-i' || a === '--include') include = true;
    else if (a === '-I' || a === '--head') head = true;
    else if (a === '-s' || a === '--silent') silent = true;
    else if (a === '-S' || a === '--show-error') showErr = true;
    else if (a === '-sS' || a === '-Ss') silent = showErr = true;
    else if (a === '-f' || a === '--fail' || a === '-fsSL' || a === '-sf' || a === '-fs') {
      fail = true;
      if (a.includes('s')) silent = true;
      if (a.includes('S')) showErr = true;
    } else if (a === '-L' || a === '-v' || a === '-k' || a === '--insecure') continue;
    else if (a === '-H' || a === '--header') {
      const h = args[++i] || '';
      const hm = /^host:\s*(.+)$/i.exec(h);
      if (hm) hostHeader = hm[1].trim();
    } else if (a === '-o' || a === '--output') discard = (args[++i] || '') === '/dev/null' || true;
    else if (a === '-w' || a === '--write-out') write = args[++i] || '';
    else if (a === '-m' || a === '--max-time' || a === '--connect-timeout' || a === '-X') i++;
    else if (a.startsWith('-')) continue;
    else urls.push(a);
  }
  if (!urls.length) return { output: 'curl: try \'curl --help\' or \'curl --manual\' for more information\n', exitCode: 2 };
  let out = '';
  let code = 0;
  for (const url of urls) {
    const r = httpGet(cl, url, from, hostHeader);
    if ('error' in r) {
      if (!silent || showErr) out += `curl: (${r.code}) ${r.error}\n`;
      code = r.code;
      if (write) out += write.replace(/%\{http_code\}/g, '000').replace(/\\n/g, '\n');
      continue;
    }
    if (fail && r.status >= 400) {
      if (!silent || showErr) out += `curl: (22) The requested URL returned error: ${r.status}\n`;
      code = 22;
      continue;
    }
    const headers = `HTTP/1.1 ${r.status} ${REASONS[r.status] || ''}\n${r.server ? `Server: ${r.server}${r.server === 'nginx' && r.pod ? '/1.27.2' : ''}\n` : ''}Date: ${new Date(cl.now).toUTCString()}\nContent-Type: ${r.body.trimStart().startsWith('{') ? 'application/json' : r.body.includes('<html') ? 'text/html' : 'text/plain; charset=utf-8'}\nContent-Length: ${r.body.length}\n\n`;
    if (head) out += headers;
    else {
      if (include) out += headers;
      if (!discard) out += r.body;
    }
    if (write) out += write.replace(/%\{http_code\}/g, String(r.status)).replace(/%\{remote_ip\}/g, r.pod?.status?.podIP || '').replace(/\\n/g, '\n');
  }
  return { output: out, exitCode: code };
}

export function wgetCommand(cl: Cluster, args: string[], from: From): { output: string; exitCode: number } {
  const url = args.find((a) => !a.startsWith('-') && a !== '-');
  const quiet = args.some((a) => a === '-q' || a.startsWith('-q'));
  if (!url) return { output: 'BusyBox v1.37.0 (2024-09-26 21:31:42 UTC) multi-call binary.\n\nUsage: wget [-cqS] [-O FILE] URL...\n', exitCode: 1 };
  const r = httpGet(cl, url, from);
  if ('error' in r) {
    const host = /^(?:https?:\/\/)?([^/:]+)/.exec(url)?.[1] || url;
    const msg = r.code === 6 ? `wget: bad address '${host}'` : r.code === 28 ? `wget: download timed out` : `wget: can't connect to remote host (${host}): Connection refused`;
    return { output: `${quiet ? '' : `Connecting to ${host}\n`}${msg}\n`, exitCode: 1 };
  }
  if (r.status >= 400) return { output: `${quiet ? '' : `Connecting to ${url}\n`}wget: server returned error: HTTP/1.1 ${r.status} ${REASONS[r.status] || ''}\n`, exitCode: 1 };
  return { output: (quiet ? '' : `Connecting to ${url}\nwriting to stdout\n`) + r.body + (quiet ? '' : `-                    100% |********************************|   ${r.body.length}  0:00:00 ETA\nwritten to stdout\n`), exitCode: 0 };
}

export function nslookup(cl: Cluster, name: string, from: From): { output: string; exitCode: number } {
  const ns = from.pod?.metadata.namespace || cl.s.namespace;
  const head = 'Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\n';
  const r = resolveName(cl, name, ns);
  if (!r || (!r.ips.length && r.svc?.spec.type !== 'ExternalName')) {
    return { output: `${head}** server can't find ${name.includes('.') ? name : `${name}.${ns}.svc.cluster.local`}: NXDOMAIN\n\n`, exitCode: 1 };
  }
  if (r.svc?.spec.type === 'ExternalName') return { output: `${head}${name}.${ns}.svc.cluster.local\tcanonical name = ${r.fqdn}\n`, exitCode: 0 };
  return { output: head + r.ips.map((ip) => `Name:\t${r.fqdn}\nAddress: ${ip}\n`).join('\n') + '\n', exitCode: 0 };
}
