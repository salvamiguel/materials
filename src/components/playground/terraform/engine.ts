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
  /** Workspace files the command deleted (local_file on destroy/replace). */
  removed_files?: string[];
  diagnostics: Diag[];
  summary?: { add: number; change: number; destroy: number; read: number };
  changes?: ChangeInfo[];
  graph?: GraphInfo;
  required?: ProviderInfo[];
  installed?: string[];
}

/** Schema of a resource, data source, provider or nested block (the playground
 * provider format, see tools/tfplay/README.md). */
export interface SchemaBlock {
  attributes?: Record<string, SchemaAttribute>;
  blocks?: Record<string, SchemaNestedBlock>;
  description?: string;
}

export interface SchemaAttribute {
  /** cty JSON type ("string", ["list","string"]...) or a type expression ("list(string)"). */
  type?: unknown;
  nested?: SchemaNestedBlock;
  description?: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  sensitive?: boolean;
  force_new?: boolean;
  default?: unknown;
}

export interface SchemaNestedBlock extends SchemaBlock {
  nesting?: 'single' | 'group' | 'list' | 'set' | 'map';
  min_items?: number;
  max_items?: number;
}

export interface ProviderIndex extends ProviderInfo {
  provider?: SchemaBlock;
  resources: string[];
  data_sources: string[];
}

// Providers shipped as static/tfplay/providers/<name>.json.gz
export const BUNDLED_PROVIDERS: Record<string, string> = {
  'hashicorp/aws': 'aws',
  'hashicorp/random': 'random',
  'hashicorp/null': 'null',
  'hashicorp/local': 'local',
  'hashicorp/google': 'google',
};

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class TfplayEngine {
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
    // A worker.js that is blocked or fails to parse only fires "error":
    // fail every pending call instead of loading forever.
    this.worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      this.fail(new Error(e.message ? `Error en el motor: ${e.message}` : `No se pudo descargar ${abs}worker.js`));
    };
    this.worker.onmessageerror = () => this.fail(new Error('El motor devolvió un mensaje ilegible'));
    this.ready = this.call('boot', abs).then(() => undefined);
  }

  private fail(err: Error) {
    this.failure = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private call<T = any>(method: string, ...args: unknown[]): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      if (this.failure) return reject(this.failure);
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

  /** What a loaded provider offers (null if it isn't loaded). */
  async providerIndex(source: string): Promise<ProviderIndex | null> {
    await this.ready;
    return this.call('schema', { source });
  }

  /** Schema of a resource or data source type (null if unknown or not loaded). */
  async typeSchema(source: string, kind: 'resource' | 'data', type: string): Promise<SchemaBlock | null> {
    await this.ready;
    return this.call('schema', { source, kind, type });
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
