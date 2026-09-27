// State of the simulated cluster. Everything is plain JSON so it can be
// saved in localStorage and restored.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Obj = Json;

export interface KEvent {
  id: number;
  namespace: string;
  involved: { kind: string; name: string; uid: string; namespace?: string; fieldPath?: string };
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  source: string;
  count: number;
  first: number;
  last: number;
}

export type FaultKind = 'crash' | 'unready' | 'oom' | 'imagepull';

export interface LogLine {
  t: number;
  text: string;
}

/** What the kubelet knows about a container that the API object doesn't show. */
export interface ContainerRt {
  /** waiting | running | terminated */
  state: 'waiting' | 'running' | 'terminated';
  reason?: string;
  message?: string;
  /** When the current state started (sim ms). */
  since: number;
  /** When the next transition happens (pull done, exit, backoff over…). */
  next?: number;
  exitCode?: number;
  restarts: number;
  ready: boolean;
  /** Became ready at; probes failing reset it. */
  readyAt?: number;
  last?: { reason: string; exitCode: number; startedAt: number; finishedAt: number };
  logs: LogLine[];
  prevLogs: LogLine[];
  /** Index of the next loop line to print (for `while true; do echo…` programs). */
  loopAt?: number;
  livenessFailAt?: number;
  pulledAt?: number;
  pulling?: number;
  pullFails?: number;
  toBackoff?: boolean;
  createdAt?: number;
}

export interface PodRt {
  /** Pod phase as the kubelet sees it. */
  stage: 'scheduling' | 'pulling' | 'init' | 'starting' | 'running' | 'done' | 'blocked';
  since: number;
  next?: number;
  containers: Record<string, ContainerRt>;
  /** Waiting on a missing ConfigMap/Secret/PVC. */
  blockedBy?: string;
  lastSchedAttempt?: number;
  killed?: boolean;
}

export interface Source {
  file: string;
  line: number;
  /** Rendered by helm/kustomize from this file (the line is in the rendered output). */
  via?: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  chartVersion: string;
  appVersion: string;
  revision: number;
  status: 'deployed' | 'superseded' | 'failed' | 'uninstalled';
  updated: number;
  values: Json;
  manifest: string;
  notes: string;
  /** Where the chart came from in the workspace. */
  path: string;
}

export interface ClusterState {
  version: 1;
  /** Simulated wall clock (ms since epoch). */
  now: number;
  rng: number;
  rv: number;
  eventSeq: number;
  objects: Record<string, Obj>;
  events: KEvent[];
  pods: Record<string, PodRt>;
  faults: Record<string, FaultKind>;
  /** Simulated CPU load (0–200 % of the requests) per workload uid. */
  load: Record<string, number>;
  sources: Record<string, Source>;
  namespace: string;
  /** Images already pulled per node. */
  images: Record<string, string[]>;
  portForwards: { local: number; kind: string; namespace: string; name: string; port: number }[];
  /** Round-robin counters per Service. */
  rr: Record<string, number>;
  helm: HelmRelease[];
  /** Deployment progress bookkeeping. */
  progress: Record<string, { at: number; key: string }>;
  /** Nodes marked as down by the user (uid → since). */
  downNodes: Record<string, number>;
  /** Last HPA scale-down candidate per HPA uid. */
  hpa: Record<string, { at: number; recommendations: { t: number; r: number }[] }>;
  /** Finished Jobs a CronJob already reported. */
  cronSeen?: Record<string, string[]>;
  /** Pod templates of past StatefulSet revisions. */
  revisions?: Record<string, Record<string, Obj>>;
  /** ArgoCD, once installed (see argocd/). */
  argocd?: ArgoState;
}

export interface RenderedDoc {
  obj: Obj;
  file: string;
  line: number;
}

/** What the repo-server rendered for an Application. */
export interface ArgoManifests {
  /** Source + revision it was rendered for. */
  key: string;
  revision: string;
  message?: string;
  author?: string;
  docs: RenderedDoc[];
  error?: string;
  at: number;
  sourceType: 'Directory' | 'Kustomize' | 'Helm';
}

export interface ArgoState {
  installed: boolean;
  version: string;
  /** Where it was installed (argocd). */
  namespace: string;
  manifests: Record<string, ArgoManifests>;
  /** Per Application (ns/name) bookkeeping of the controller. */
  apps: Record<string, { comparedAt: number; lastAutoSync?: string; driftSince?: number; retries?: number }>;
  /** Rendered manifests of every history entry (for rollbacks), by app then id. */
  historyDocs: Record<string, Record<string, RenderedDoc[]>>;
  /** Parameters found by git generators of ApplicationSets (the repo-server fills them). */
  appsetParams: Record<string, Record<string, string>[]>;
  /** argocd CLI session. */
  session?: { server: string; user: string };
  /** Web UI session (the Browser tab). */
  ui?: { user: string };
  /** Push counter of the local remote the repo-server last saw. */
  seenPush?: number;
}

export class ApiError extends Error {
  constructor(
    public reason: 'NotFound' | 'AlreadyExists' | 'Invalid' | 'BadRequest' | 'Forbidden' | 'Conflict' | 'MethodNotAllowed',
    message: string,
  ) {
    super(message);
  }
}
