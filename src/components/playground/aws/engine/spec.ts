import type { Ec2Region, Identity, PlaygroundState } from './types';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * string  single value (file:// allowed)
 * int     integer
 * bool    flag; --no-<name> sets false
 * strings one or more values (space separated, or a JSON array)
 * struct  one structure (shorthand or JSON, file:// allowed)
 * structs list of structures (one shorthand per value, or a JSON array)
 * doc     JSON document kept as a string (file:// allowed): policies
 * blob    file contents (fileb:// or file://) or a literal string
 */
export type OptType = 'string' | 'int' | 'bool' | 'strings' | 'struct' | 'structs' | 'doc' | 'blob';

export interface Opt {
  name: string;
  type: OptType;
  required?: boolean;
  help?: string;
  choices?: string[];
  /** Turn "true"/"false" and numbers inside shorthand into real types. */
  coerce?: boolean;
}

export type Args = Record<string, Json> & { _: string[] };

export interface Ctx {
  st: PlaygroundState;
  region: string;
  identity: Identity;
  now: Date;
  service: string;
  api: string;
  /** Checks IAM permissions for assumed roles; throws AccessDenied. */
  authorize(action: string, resources?: string | string[]): void;
  ec2(region?: string): Ec2Region;
  readLocal(path: string): string | undefined;
  writeLocal(path: string, content: string): void;
  resolveLocal(path: string): string;
  /** Text lines for operations that print instead of returning data (aws s3 …). */
  print(line: string): void;
  exitCode: number;
  /** --dry-run on EC2: after the permission check, answer DryRunOperation. */
  dryRun: boolean;
}

export interface Op {
  name: string;
  /** API operation name used in errors and table titles; defaults to PascalCase of `name`. */
  api?: string;
  help: string;
  opts: Opt[];
  /** Positional arguments (aws s3 …). */
  positional?: { name: string; required?: boolean }[];
  /** IAM action checked before running, with its resource(s). */
  action?: string;
  resource?: (a: Args, ctx: Ctx) => string | string[];
  example?: string;
  run(a: Args, ctx: Ctx): Json | undefined;
}

export interface Service {
  name: string;
  help: string;
  ops: Op[];
}

export const apiName = (op: Op) =>
  op.api ?? op.name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');

export const opt = (name: string, type: OptType, help = '', extra: Partial<Opt> = {}): Opt => ({ name, type, help, ...extra });
export const req = (name: string, type: OptType, help = '', extra: Partial<Opt> = {}): Opt => ({ name, type, help, required: true, ...extra });
