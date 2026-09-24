import type { Opt, Service } from './spec';
import { opt } from './spec';
import { sts } from './services/sts';
import { iam } from './services/iam';
import { s3, s3api } from './services/s3';
import { ec2 } from './services/ec2';

export const SERVICES: Service[] = [sts, iam, s3, s3api, ec2];

export const GLOBAL_OPTS: Record<string, { type: 'string' | 'bool'; help: string; values?: string[] }> = {
  region: { type: 'string', help: 'Región (eu-west-1, us-east-1…)' },
  output: { type: 'string', help: 'json | table | text | yaml', values: ['json', 'text', 'table', 'yaml', 'yaml-stream'] },
  query: { type: 'string', help: "Filtra la respuesta con JMESPath: --query 'Buckets[].Name'" },
  profile: { type: 'string', help: 'Perfil de ~/.aws/config' },
  'no-cli-pager': { type: 'bool', help: 'Sin paginador (aquí nunca lo hay)' },
  'no-paginate': { type: 'bool', help: 'Aceptada, sin efecto' },
  debug: { type: 'bool', help: 'Aceptada, sin efecto' },
  'endpoint-url': { type: 'string', help: 'Aceptada, sin efecto' },
  'no-verify-ssl': { type: 'bool', help: 'Aceptada, sin efecto' },
  color: { type: 'string', help: 'Aceptada, sin efecto' },
};

const DRY_RUN = opt('dry-run', 'bool', 'Comprueba permisos sin hacer nada (DryRunOperation)');

/** Options an operation accepts, including the implicit ones. */
export function opOptions(service: Service, opOpts: Opt[]): Opt[] {
  return service.name === 'ec2' ? [...opOpts, DRY_RUN] : opOpts;
}

export const CONFIGURE_SUBCOMMANDS = ['list', 'get', 'set', 'list-profiles'];
