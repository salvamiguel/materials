// Client for static/tfplay/worker.js, which runs the Go engine compiled to
// WebAssembly (tools/tfplay). Everything happens in the browser.

export interface Diag {
  severity: 'error' | 'warning';
  summary: string;
  detail: string;
  filename?: string;
  line?: number;
  column?: number;
  end_line?: number;
  end_column?: number;
}

export interface ChangeInfo {
  address: string;
  action: 'create' | 'update' | 'delete' | 'delete-create' | 'create-delete' | 'read' | 'no-op';
  reason?: string;
}

export interface GraphInfo {
  nodes: { id: string; kind: string }[];
  edges: { from: string; to: string }[];
}

export interface ProviderInfo {
  name: string;
  source: string;
  version?: string;
}

export interface RunRequest {
  command: string;
  args?: string[];
  files: Record<string, string>;
  state?: string;
  vars?: Record<string, string>;
  installed?: string[];
  available?: string[];
  destroy?: boolean;
}

export interface RunResponse {
  output: string;
  exit_code: number;
  state?: string;
  files?: Record<string, string>;
  diagnostics: Diag[];
  summary?: { add: number; change: number; destroy: number; read: number };
  changes?: ChangeInfo[];
  graph?: GraphInfo;
  required?: ProviderInfo[];
  installed?: string[];
}

// Providers shipped as static/tfplay/providers/<name>.json.gz
export const BUNDLED_PROVIDERS: Record<string, string> = {
  'hashicorp/aws': 'aws',
  'hashicorp/random': 'random',
  'hashicorp/null': 'null',
  'hashicorp/local': 'local',
};

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class TfplayEngine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
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
    this.ready = this.call('boot', abs).then(() => undefined);
  }

  private call<T = any>(method: string, ...args: unknown[]): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  loadProvider(name: string): Promise<ProviderInfo> {
    return this.call('loadProvider', name);
  }

  requiredProviders(files: Record<string, string>): Promise<ProviderInfo[]> {
    return this.call('requiredProviders', files);
  }

  /** Downloads the bundled provider schemas needed by the given sources. */
  async ensureProviders(sources: string[]): Promise<void> {
    await Promise.all(
      sources.filter((s) => BUNDLED_PROVIDERS[s]).map((s) => this.loadProvider(BUNDLED_PROVIDERS[s])),
    );
  }

  async run(req: RunRequest): Promise<RunResponse> {
    await this.ready;
    if (req.command === 'init') {
      const required = await this.requiredProviders(req.files);
      await this.ensureProviders(required.map((p) => p.source));
    } else if (req.installed?.length) {
      await this.ensureProviders(req.installed);
    }
    return this.call('run', { ...req, available: Object.keys(BUNDLED_PROVIDERS) });
  }

  terminate() {
    this.worker.terminate();
  }
}
