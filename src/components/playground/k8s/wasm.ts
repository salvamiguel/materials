// Client for static/k8splay/worker.js: kustomize and Helm's template engine
// (Go compiled to WebAssembly, tools/k8splay), loaded on first use.

export interface RenderedResource {
  yaml: string;
  origin?: string;
  generator?: string;
  configuredIn?: string;
}

export interface KustomizeResponse {
  yaml: string;
  resources: RenderedResource[] | null;
  error?: string;
}

export interface HelmRequest {
  files: Record<string, string>;
  chartDir: string;
  release: string;
  namespace: string;
  revision?: number;
  isInstall?: boolean;
  isUpgrade?: boolean;
  valueFiles?: string[];
  set?: string[];
  setString?: string[];
  values?: Record<string, unknown>;
  strict?: boolean;
}

export interface HelmResponse {
  manifests: { template: string; name: string; yaml: string }[] | null;
  notes: string;
  chart: { name: string; version: string; appVersion: string; description: string; type: string };
  userValues: Record<string, unknown> | null;
  defaultValues: string;
  error?: string;
}

/** What helm.ts needs (a fake one in the tests). */
export interface Renderer {
  kustomize(req: { files: Record<string, string>; dir: string }): Promise<KustomizeResponse>;
  helm(req: HelmRequest): Promise<HelmResponse>;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class K8splayWasm implements Renderer {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private failure?: Error;
  readonly ready: Promise<void>;

  constructor(baseUrl: string) {
    const abs = new URL(baseUrl, window.location.href).href;
    this.worker = new Worker(abs + 'worker.js');
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    this.worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      this.fail(new Error(e.message ? `Error en el motor de helm/kustomize: ${e.message}` : `No se pudo descargar ${abs}worker.js`));
    };
    this.ready = this.call('boot', abs).then(() => undefined);
  }

  private fail(err: Error) {
    this.failure = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  kustomize(req: { files: Record<string, string>; dir: string }): Promise<KustomizeResponse> {
    return this.call('kustomize', req);
  }

  helm(req: HelmRequest): Promise<HelmResponse> {
    return this.call('helm', req);
  }

  terminate() {
    this.worker.terminate();
  }
}
