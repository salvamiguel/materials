import { describe, expect, test } from 'bun:test';
import { Cluster } from './cluster';
import { runLine } from './shell';
import { buildDiagram } from '../diagramModel';
import { parseSelector, matches, humanDuration, templateHash } from './util';
import { parseCron, nextCron } from './validate';

const T0 = Date.UTC(2026, 8, 26, 9, 0, 0);

const DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          readinessProbe:
            httpGet:
              path: /
              port: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
`;

function session(files: Record<string, string> = { 'web.yaml': DEPLOY }) {
  const cl = Cluster.create(T0, 7);
  const ctx = { cl, files };
  return {
    cl,
    files,
    async run(line: string) {
      const r = await runLine(line, ctx);
      if (r.writeFiles) Object.assign(files, r.writeFiles);
      return r;
    },
    /** Runs a streaming command until it ends (or `ms` pass). */
    async stream(line: string, ms = 60_000) {
      const r = await runLine(line, ctx);
      let out = r.output;
      if (!r.stream) return { out, code: r.exitCode };
      for (let t = 0; t < ms; t += 250) {
        cl.advance(250);
        const p = r.stream.poll(cl);
        out += p.text;
        if (p.done) return { out, code: p.exitCode ?? 0 };
      }
      out += r.stream.stop(cl);
      return { out, code: 130 };
    },
    wait(ms: number) {
      cl.advance(ms);
    },
    pods(ns = 'default') {
      return cl.list('Pod', ns).filter((p) => !p.metadata.deletionTimestamp);
    },
  };
}

describe('bootstrap', () => {
  test('a kind-like cluster with system pods running', () => {
    const s = session();
    expect(s.cl.list('Node').map((n) => n.metadata.name)).toEqual(['playground-control-plane', 'playground-worker', 'playground-worker2']);
    const sys = s.cl.list('Pod', 'kube-system');
    expect(sys.length).toBeGreaterThan(8);
    expect(sys.every((p) => p.status.phase === 'Running')).toBe(true);
    expect(s.cl.s.events.length).toBe(0);
  });
});

describe('apply and self-healing', () => {
  test('creates the deployment, its replica set and pods', async () => {
    const s = session();
    const r = await s.run('kubectl apply -f web.yaml');
    expect(r.output).toBe('deployment.apps/web created\nservice/web created\n');
    s.wait(15_000);
    const out = (await s.run('kubectl get deploy')).output;
    expect(out).toMatch(/web\s+3\/3\s+3\s+3/);
    expect(s.pods().length).toBe(3);
    expect(s.cl.get('Endpoints', 'default', 'web').subsets[0].addresses.length).toBe(3);
    expect((await s.run('kubectl apply -f web.yaml')).output).toContain('deployment.apps/web unchanged');
  });

  test('a deleted pod is replaced by the ReplicaSet', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    s.wait(15_000);
    const victim = s.pods()[0].metadata.name;
    expect((await s.run(`kubectl delete pod ${victim}`)).output).toBe(`pod "${victim}" deleted\n`);
    s.wait(10_000);
    const names = s.pods().map((p) => p.metadata.name);
    expect(names).not.toContain(victim);
    expect(names.length).toBe(3);
  });

  test('kubectl scale keeps the replicas on the next apply without replicas', async () => {
    const s = session({ 'd.yaml': DEPLOY.replace('  replicas: 3\n', '') });
    await s.run('kubectl apply -f d.yaml');
    await s.run('kubectl scale deploy/web --replicas=4');
    s.wait(10_000);
    await s.run('kubectl apply -f d.yaml');
    expect(s.cl.get('Deployment', 'default', 'web').spec.replicas).toBe(4);
  });
});

describe('rolling update', () => {
  test('respects maxSurge/maxUnavailable and finishes', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    s.wait(15_000);
    await s.run('kubectl set image deploy/web nginx=nginx:1.28');
    let maxPods = 0;
    let minReady = 99;
    for (let t = 0; t < 40_000; t += 250) {
      s.wait(250);
      const pods = s.pods();
      maxPods = Math.max(maxPods, pods.length);
      minReady = Math.min(
        minReady,
        pods.filter((p) => p.status.conditions?.find((c: { type: string; status: string }) => c.type === 'Ready')?.status === 'True').length,
      );
    }
    expect(maxPods).toBeLessThanOrEqual(4);
    expect(minReady).toBeGreaterThanOrEqual(3);
    expect(s.pods().every((p) => p.spec.containers[0].image === 'nginx:1.28')).toBe(true);
    const hist = (await s.run('kubectl rollout history deploy/web')).output;
    expect(hist).toMatch(/1\s+<none>\n2\s+<none>/);
  });

  test('a broken image stalls the rollout and undo recovers', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    s.wait(15_000);
    await s.run('kubectl set image deploy/web nginx=nginx:no-existe');
    s.wait(20_000);
    const pods = (await s.run('kubectl get pods')).output;
    expect(pods).toMatch(/ImagePullBackOff|ErrImagePull/);
    expect(s.pods().filter((p) => p.spec.containers[0].image === 'nginx:1.27').length).toBe(3);
    expect((await s.run('kubectl rollout undo deploy/web')).output).toBe('deployment.apps/web rolled back\n');
    const st = await s.stream('kubectl rollout status deploy/web');
    expect(st.out).toContain('deployment "web" successfully rolled out');
    expect(s.pods().every((p) => p.spec.containers[0].image === 'nginx:1.27')).toBe(true);
  });

  test('Recreate kills every old pod before starting new ones', async () => {
    const s = session({
      'r.yaml': DEPLOY.replace(/  strategy:\n    rollingUpdate:\n      maxSurge: 1\n      maxUnavailable: 0\n/, '  strategy:\n    type: Recreate\n'),
    });
    await s.run('kubectl apply -f r.yaml');
    s.wait(15_000);
    await s.run('kubectl set image deploy/web nginx=nginx:1.28');
    let mixed = false;
    for (let t = 0; t < 30_000; t += 250) {
      s.wait(250);
      const imgs = new Set(s.cl.list('Pod', 'default').map((p) => p.spec.containers[0].image));
      if (imgs.size > 1) mixed = true;
    }
    expect(mixed).toBe(false);
    expect(s.pods().every((p) => p.spec.containers[0].image === 'nginx:1.28')).toBe(true);
  });
});

describe('failures', () => {
  test('a crashing container ends in CrashLoopBackOff with restarts', async () => {
    const s = session({
      'c.yaml': `apiVersion: v1
kind: Pod
metadata:
  name: crash
spec:
  containers:
    - name: c
      image: busybox
      command: ["sh", "-c", "echo arrancando; exit 1"]
`,
    });
    await s.run('kubectl apply -f c.yaml');
    s.wait(60_000);
    const out = (await s.run('kubectl get pod crash')).output;
    expect(out).toMatch(/CrashLoopBackOff|Error/);
    expect(s.cl.get('Pod', 'default', 'crash').status.containerStatuses[0].restartCount).toBeGreaterThanOrEqual(2);
    expect((await s.run('kubectl logs crash --previous')).output).toContain('arrancando');
  });

  test('a missing ConfigMap blocks the pod until it exists', async () => {
    const s = session({
      'p.yaml': `apiVersion: v1
kind: Pod
metadata:
  name: p
spec:
  containers:
    - name: c
      image: nginx
      envFrom:
        - configMapRef:
            name: cfg
`,
    });
    await s.run('kubectl apply -f p.yaml');
    s.wait(8000);
    expect((await s.run('kubectl get pod p')).output).toContain('CreateContainerConfigError');
    await s.run('kubectl create configmap cfg --from-literal=A=1');
    s.wait(5000);
    expect((await s.run('kubectl get pod p')).output).toContain('Running');
    expect((await s.run('kubectl exec p -- printenv A')).output).toBe('1\n');
  });

  test('strict decoding rejects unknown fields and wrong types', async () => {
    const s = session({ 'bad.yaml': DEPLOY.replace('replicas: 3', 'replica: 3') });
    const r = await s.run('kubectl apply -f bad.yaml');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('strict decoding error: unknown field "spec.replica"');
    s.files['bad2.yaml'] = DEPLOY.replace('app: web\n  template', 'app: otra\n  template');
    const r2 = await s.run('kubectl apply -f bad2.yaml');
    expect(r2.output).toContain('`selector` does not match template `labels`');
  });

  test('node failure evicts pods to other nodes', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    s.wait(15_000);
    const node = s.cl.get('Node', undefined, 'playground-worker');
    s.cl.s.downNodes[node.metadata.uid] = s.cl.now;
    s.wait(40_000);
    const ready = s.pods().filter((p) => p.spec.nodeName !== 'playground-worker' && p.status.phase === 'Running');
    expect(ready.length).toBe(3);
    expect((await s.run('kubectl get nodes')).output).toMatch(/playground-worker\s+NotReady/);
  });
});

describe('networking', () => {
  test('services balance over ready pods; outside needs port-forward', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    s.wait(15_000);
    expect((await s.run('curl -s http://web')).exitCode).toBe(6);
    const pf = await s.run('kubectl port-forward svc/web 8080:80 &');
    expect(pf.stream?.background).toBe(true);
    const out = (await s.run('curl -s localhost:8080')).output;
    expect(out).toContain('Welcome to nginx!');
    const inPod = await s.stream('kubectl run t --rm -it --restart=Never --image=busybox -- wget -qO- http://web');
    expect(inPod.out).toContain('Welcome to nginx!');
    expect(inPod.out).toContain('pod "t" deleted');
  });

  test('canary: the service splits traffic across both versions', async () => {
    const mk = (name: string, track: string, n: number, text: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
spec:
  replicas: ${n}
  selector:
    matchLabels: {app: api, track: ${track}}
  template:
    metadata:
      labels: {app: api, track: ${track}}
    spec:
      containers:
        - name: api
          image: hashicorp/http-echo
          args: ["-text=${text}"]
---
`;
    const s = session({
      'c.yaml':
        mk('stable', 'stable', 3, 'v1') +
        mk('canary', 'canary', 1, 'v2') +
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: api\nspec:\n  selector: {app: api}\n  ports: [{port: 80, targetPort: 5678}]\n',
    });
    await s.run('kubectl apply -f c.yaml');
    s.wait(15_000);
    await s.run('kubectl port-forward svc/api 9000:80 &');
    const out = (await s.run('for i in $(seq 40); do curl -s localhost:9000; done | sort | uniq -c')).output;
    expect(out).toMatch(/\d+ v1\n/);
    expect(out).toMatch(/\d+ v2\n/);
  });

  test('ingress routes by host and path', async () => {
    const s = session({
      'i.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo
spec:
  selector: {matchLabels: {app: echo}}
  template:
    metadata: {labels: {app: echo}}
    spec:
      containers: [{name: e, image: hashicorp/http-echo, args: ["-text=hola ingress"]}]
---
apiVersion: v1
kind: Service
metadata: {name: echo}
spec:
  selector: {app: echo}
  ports: [{port: 80, targetPort: 5678}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: echo}
spec:
  rules:
    - host: echo.local
      http:
        paths:
          - {path: /, pathType: Prefix, backend: {service: {name: echo, port: {number: 80}}}}
`,
    });
    await s.run('kubectl apply -f i.yaml');
    s.wait(15_000);
    expect((await s.run('curl -s http://echo.local/')).output).toBe('hola ingress\n');
  });
});

describe('statefulsets, jobs and HPA', () => {
  test('statefulset pods start in order with their own PVC', async () => {
    const s = session({
      's.yaml': `apiVersion: apps/v1
kind: StatefulSet
metadata: {name: db}
spec:
  serviceName: db
  replicas: 3
  selector: {matchLabels: {app: db}}
  template:
    metadata: {labels: {app: db}}
    spec:
      containers: [{name: r, image: redis:7}]
  volumeClaimTemplates:
    - metadata: {name: data}
      spec: {accessModes: [ReadWriteOnce], resources: {requests: {storage: 1Gi}}}
`,
    });
    await s.run('kubectl apply -f s.yaml');
    s.wait(4000);
    expect(s.pods().map((p) => p.metadata.name)).toEqual(['db-0']);
    s.wait(30_000);
    expect(s.pods().map((p) => p.metadata.name)).toEqual(['db-0', 'db-1', 'db-2']);
    expect(s.cl.list('PersistentVolumeClaim', 'default').map((p) => `${p.metadata.name}:${p.status.phase}`)).toEqual([
      'data-db-0:Bound',
      'data-db-1:Bound',
      'data-db-2:Bound',
    ]);
  });

  test('jobs complete and cronjobs create jobs on schedule', async () => {
    const s = session({
      'j.yaml': `apiVersion: batch/v1
kind: CronJob
metadata: {name: hi}
spec:
  schedule: "*/1 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers: [{name: hi, image: busybox, command: ["sh", "-c", "echo hola"]}]
`,
    });
    await s.run('kubectl apply -f j.yaml');
    s.wait(130_000);
    const jobs = s.cl.list('Job', 'default');
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect((await s.run('kubectl get jobs')).output).toContain('Complete');
    expect((await s.run(`kubectl logs job/${jobs[0].metadata.name}`)).output).toBe('hola\n');
  });

  test('the HPA scales with the simulated load', async () => {
    const s = session({
      'h.yaml': `apiVersion: apps/v1
kind: Deployment
metadata: {name: calc}
spec:
  replicas: 1
  selector: {matchLabels: {app: calc}}
  template:
    metadata: {labels: {app: calc}}
    spec:
      containers: [{name: c, image: nginx, resources: {requests: {cpu: 200m}}}]
`,
    });
    await s.run('kubectl apply -f h.yaml');
    await s.run('kubectl autoscale deploy calc --min=1 --max=5 --cpu-percent=50');
    s.wait(10_000);
    s.cl.s.load[s.cl.get('Deployment', 'default', 'calc').metadata.uid] = 0.6;
    s.wait(60_000);
    expect(s.cl.get('Deployment', 'default', 'calc').spec.replicas).toBeGreaterThanOrEqual(4);
    delete s.cl.s.load[s.cl.get('Deployment', 'default', 'calc').metadata.uid];
    s.wait(120_000);
    expect(s.cl.get('Deployment', 'default', 'calc').spec.replicas).toBe(1);
  });
});

describe('kubectl output', () => {
  test('get -o jsonpath, yaml and name', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    expect((await s.run("kubectl get deploy web -o jsonpath='{.spec.replicas}'")).output).toBe('3');
    expect((await s.run('kubectl get deploy -o name')).output).toBe('deployment.apps/web\n');
    const y = (await s.run('kubectl get svc web -o yaml')).output;
    expect(y).toMatch(/^apiVersion: v1\nkind: Service\n/);
    expect(y).toContain('clusterIP: 10.96.');
  });

  test('create --dry-run -o yaml > file writes the manifest', async () => {
    const s = session({});
    const r = await s.run('kubectl create deployment api --image=nginx:1.27 --replicas=2 --dry-run=client -o yaml > api.yaml');
    expect(r.output).toBe('');
    expect(s.files['api.yaml']).toContain('replicas: 2');
    expect((await s.run('kubectl apply -f api.yaml')).output).toBe('deployment.apps/api created\n');
  });

  test('errors look like kubectl', async () => {
    const s = session();
    expect((await s.run('kubectl get pod nope')).output).toBe('Error from server (NotFound): pods "nope" not found\n');
    expect((await s.run('kubectl get foo')).output).toContain(`the server doesn't have a resource type "foo"`);
    expect((await s.run('kubectl get pods')).output).toBe('No resources found in default namespace.\n');
  });

  test('secrets decode through a pipe', async () => {
    const s = session();
    await s.run('kubectl create secret generic db --from-literal=password=s3cr3t');
    expect((await s.run("kubectl get secret db -o jsonpath='{.data.password}' | base64 -d")).output).toBe('s3cr3t');
  });
});

describe('diagram', () => {
  test('groups an app and links its objects', async () => {
    const s = session();
    await s.run('kubectl apply -f web.yaml');
    s.wait(15_000);
    const d = buildDiagram(s.cl, { showSystem: false });
    expect(d.nodes.map((n) => n.kind).sort()).toEqual(['Deployment', 'Pod', 'Pod', 'Pod', 'ReplicaSet', 'Service']);
    expect(d.edges.filter((e) => e.kind === 'select' && e.live).length).toBe(3);
    expect(d.edges.filter((e) => e.kind === 'owner').length).toBe(4);
    expect(d.lanes.map((l) => l.label)).toEqual(['default']);
    // Every node inside its lane.
    const lane = d.lanes[0];
    for (const n of d.nodes) expect(n.y >= lane.y && n.y + n.h <= lane.y + lane.h).toBe(true);
    // The deployment's source is the file and line of its document.
    const dep = s.cl.get('Deployment', 'default', 'web');
    expect(s.cl.sourceOf(dep)?.source).toEqual({ file: 'web.yaml', line: 1 });
    const pod = s.pods()[0];
    expect(s.cl.sourceOf(pod)?.source.file).toBe('web.yaml');
    expect(s.cl.sourceOf(s.cl.get('Service', 'default', 'web'))?.source.line).toBe(27);
  });
});

describe('util', () => {
  test('selectors', () => {
    const sel = parseSelector('app=web,tier in (a,b),!legacy');
    expect(matches(sel, { app: 'web', tier: 'a' })).toBe(true);
    expect(matches(sel, { app: 'web', tier: 'c' })).toBe(false);
    expect(matches(sel, { app: 'web', tier: 'a', legacy: 'x' })).toBe(false);
  });

  test('human durations like kubectl', () => {
    expect(humanDuration(5_000)).toBe('5s');
    expect(humanDuration(150_000)).toBe('2m30s');
    expect(humanDuration(3 * 3_600_000 + 60_000)).toBe('3h1m');
    expect(humanDuration(50 * 3_600_000)).toBe('2d2h');
  });

  test('cron', () => {
    const c = parseCron('*/15 * * * *');
    expect(new Date(nextCron(c, Date.UTC(2026, 0, 1, 10, 7))).toISOString()).toBe('2026-01-01T10:15:00.000Z');
  });

  test('template hashes are stable', () => {
    expect(templateHash({ b: 1, a: 2 })).toBe(templateHash({ a: 2, b: 1 }));
  });
});
