// Provider schemas for autocompletion, fetched from the engine's worker on
// demand and cached. Custom providers (*.provider.json) are read directly
// from the workspace files.

import { BUNDLED_PROVIDERS, type ProviderIndex, type SchemaBlock } from '../engine';
import { BUILTIN_SOURCE, type Schemas } from './complete';

/** The part of TfplayEngine the cache needs. */
export interface SchemaEngine {
  loadProvider(name: string): Promise<unknown>;
  providerIndex(source: string): Promise<ProviderIndex | null>;
  typeSchema(source: string, kind: 'resource' | 'data', type: string): Promise<SchemaBlock | null>;
}

interface Custom {
  index: ProviderIndex;
  resources: Record<string, SchemaBlock>;
  data: Record<string, SchemaBlock>;
}

export class SchemaCache implements Schemas {
  private idx = new Map<string, ProviderIndex>();
  private types = new Map<string, { resource: Set<string>; data: Set<string> }>();
  private custom = new Map<string, Custom>();
  private customKey = '';
  private blocks = new Map<string, SchemaBlock | undefined>();
  private inflight = new Set<string>();
  private failed = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(private engine: SchemaEngine) {
    this.fetchIndex(BUILTIN_SOURCE, () => this.engine.providerIndex(BUILTIN_SOURCE));
  }

  /** Called when something that was loading arrives. */
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Reads the custom providers defined in the workspace. */
  setFiles(files: Record<string, string>) {
    const names = Object.keys(files)
      .filter((f) => f.endsWith('.provider.json'))
      .sort();
    const key = names.map((f) => f + '\0' + files[f]).join('\0');
    if (key === this.customKey) return;
    this.customKey = key;
    this.custom.clear();
    for (const f of names) {
      try {
        const p = JSON.parse(files[f]);
        if (!p?.name) continue;
        const source = String(p.source || `hashicorp/${p.name}`).toLowerCase();
        const resources = p.resources || {};
        const data = p.data_sources || {};
        this.custom.set(source, {
          index: { name: p.name, source, version: p.version, provider: p.provider, resources: Object.keys(resources).sort(), data_sources: Object.keys(data).sort() },
          resources,
          data,
        });
      } catch {
        // invalid JSON while typing: the provider is simply not offered
      }
    }
  }

  indexes(): ProviderIndex[] {
    const out = [...this.custom.values()].map((c) => c.index);
    for (const [source, i] of this.idx) if (!this.custom.has(source)) out.push(i);
    return out;
  }

  bundled(): string[] {
    return Object.keys(BUNDLED_PROVIDERS);
  }

  load(source: string) {
    const name = BUNDLED_PROVIDERS[source];
    if (!name) return;
    this.fetchIndex(source, () => this.engine.loadProvider(name).then(() => this.engine.providerIndex(source)));
  }

  block(source: string, kind: 'resource' | 'data', type: string): SchemaBlock | null | undefined {
    const c = this.custom.get(source);
    if (c) return (kind === 'data' ? c.data : c.resources)[type];
    const types = this.types.get(source);
    if (!types) {
      if (this.failed.has(source) || (!BUNDLED_PROVIDERS[source] && !this.inflight.has(source))) return undefined;
      this.load(source);
      return null;
    }
    if (!types[kind].has(type)) return undefined;
    const key = `${source}|${kind}|${type}`;
    if (this.blocks.has(key)) return this.blocks.get(key);
    if (!this.inflight.has(key)) {
      this.inflight.add(key);
      this.engine.typeSchema(source, kind, type).then(
        (b) => this.done(key, () => this.blocks.set(key, b ?? undefined)),
        () => this.done(key, () => this.blocks.set(key, undefined)),
      );
    }
    return null;
  }

  private fetchIndex(source: string, get: () => Promise<ProviderIndex | null>) {
    if (this.idx.has(source) || this.inflight.has(source) || this.failed.has(source)) return;
    this.inflight.add(source);
    get().then(
      (i) =>
        this.done(source, () => {
          if (!i) {
            this.failed.add(source);
            return;
          }
          this.idx.set(source, i);
          this.types.set(source, { resource: new Set(i.resources), data: new Set(i.data_sources) });
        }),
      () => this.done(source, () => this.failed.add(source)),
    );
  }

  private done(key: string, apply: () => void) {
    this.inflight.delete(key);
    apply();
    this.listeners.forEach((l) => l());
  }
}
