import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import type { ProviderIndex } from '../engine';
import { BUILTIN_SOURCE, complete, traversalBefore, type CompletionResult, type Schemas } from './complete';
import { FUNCTIONS } from './functions';
import { SchemaCache, type SchemaEngine } from './schemas';
import { expandSnippet } from './snippet';

// ── fixtures: the real provider schemas shipped with the playground ──

const root = new URL('../../../../../', import.meta.url);
const readProvider = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`static/tfplay/providers/${name}.json.gz`, root))).toString());

const PROVIDERS: Record<string, any> = {
  'hashicorp/aws': readProvider('aws'),
  'hashicorp/random': readProvider('random'),
  'hashicorp/local': readProvider('local'),
  [BUILTIN_SOURCE]: {
    name: 'terraform',
    source: BUILTIN_SOURCE,
    provider: {},
    resources: { terraform_data: { attributes: { id: { type: 'string', computed: true }, input: { type: 'dynamic', optional: true } } } },
    data_sources: {},
  },
};
const BUNDLED = ['hashicorp/aws', 'hashicorp/random', 'hashicorp/null', 'hashicorp/local', 'hashicorp/google'];

const toIndex = (p: any): ProviderIndex => ({
  name: p.name,
  source: p.source,
  version: p.version,
  provider: p.provider,
  resources: Object.keys(p.resources).sort(),
  data_sources: Object.keys(p.data_sources || {}).sort(),
});

function fakeSchemas(loaded = Object.keys(PROVIDERS)) {
  const requested: string[] = [];
  const set = new Set(loaded);
  const schemas: Schemas = {
    indexes: () => [...set].map((s) => toIndex(PROVIDERS[s])),
    bundled: () => BUNDLED,
    load: (s) => requested.push(s),
    block(source, kind, type) {
      if (set.has(source)) return PROVIDERS[source][kind === 'data' ? 'data_sources' : 'resources'][type];
      if (!BUNDLED.includes(source)) return undefined;
      requested.push(source);
      return null;
    },
  };
  return { schemas, requested };
}

/** Completes at the "|" in src (the file main.tf unless another is given). */
function at(src: string, opts: { file?: string; files?: Record<string, string>; schemas?: Schemas } = {}): CompletionResult | undefined {
  const offset = src.indexOf('|');
  const filename = opts.file ?? 'main.tf';
  return complete({
    files: { ...opts.files, [filename]: src.slice(0, offset) + src.slice(offset + 1) },
    filename,
    offset,
    schemas: opts.schemas ?? fakeSchemas().schemas,
  });
}
const labels = (r?: CompletionResult) => r?.items.map((i) => i.label) ?? [];
const find = (r: CompletionResult | undefined, label: string) => r?.items.find((i) => i.label === label);
/** Every wanted label is offered (the missing ones show in the failure). */
const expectAll = (got: string[], want: string[]) => expect(want.filter((w) => !got.includes(w))).toEqual([]);

const CONFIG = `
variable "region" {
  type        = string
  description = "Región de AWS"
  default     = "eu-west-1"
}
variable "cidr" { type = string }

locals {
  name = "demo-\${var.region}"
  tags = { Project = "curso" }
}

resource "aws_vpc" "main" {
  cidr_block = var.cidr
}

resource "aws_instance" "web" {
  count = 2
  ami   = data.aws_ami.ubuntu.id
}

data "aws_ami" "ubuntu" {
  most_recent = true
}
`;
const inConfig = (src: string, schemas?: Schemas) => at(src, { files: { 'config.tf': CONFIG }, schemas });

// ── tests ──

describe('top level', () => {
  test('block types, with snippets', () => {
    const r = at('res|');
    expect(labels(r)[0]).toBe('resource');
    expect(find(r, 'resource')?.insert).toBe('resource "$1" "${2:nombre}" {\n  $0\n}');
    expect(find(r, 'resource')?.retrigger).toBe(true);
    expect(r?.from).toBe(0);
    expect(r?.to).toBe(3);
  });

  test('every block type on an empty line', () => {
    expectAll(labels(at('\n|\n')), ['resource', 'data', 'variable', 'output', 'locals', 'module', 'provider', 'terraform']);
  });

  test('nothing in comments, heredocs or plain strings', () => {
    expect(at('# var.|')).toBeUndefined();
    expect(at('/* res| */')).toBeUndefined();
    expect(at('locals {\n  x = <<EOF\nres|\nEOF\n}')).toBeUndefined();
    expect(at('resource "aws_instance" "w" {\n  ami = "ami-|"\n}')).toBeUndefined();
  });

  test('only in Terraform files', () => {
    expect(at('res|', { file: 'notas.txt' })).toBeUndefined();
  });
});

describe('block labels', () => {
  test('resource types of the loaded providers', () => {
    const r = at('resource "aws_ins|"');
    expect(labels(r)[0]).toBe('aws_instance');
    expect(r?.from).toBe('resource "'.length);
    expect(labels(r)).not.toContain('aws_ami'); // a data source
  });

  test('the label is replaced whole', () => {
    const r = at('resource "aws_ins|tance" "web" {}');
    expect(r?.to).toBe('resource "aws_instance'.length);
  });

  test('data source types', () => {
    expect(labels(at('data "aws_am|"'))).toContain('aws_ami');
  });

  test('providers that are not loaded yet are offered as prefixes and load on demand', () => {
    const { schemas, requested } = fakeSchemas([BUILTIN_SOURCE]);
    const empty = at('resource "|"', { schemas });
    expectAll(labels(empty), ['aws_', 'google_', 'terraform_data']);
    expect(find(empty, 'aws_')?.retrigger).toBe(true);
    const typing = at('resource "aws_|"', { schemas });
    expect(typing?.pending).toContain('hashicorp/aws');
    expect(requested).toContain('hashicorp/aws');
  });

  test('provider names and backends', () => {
    expectAll(labels(at('provider "|"')), ['aws', 'random', 'google']);
    expectAll(labels(at('terraform {\n  backend "|"\n}')), ['s3', 'local']);
  });

  test('dynamic blocks: the nested blocks of the resource', () => {
    const r = at('resource "aws_security_group" "sg" {\n  dynamic "ing|"\n}');
    expect(labels(r)[0]).toBe('ingress');
  });
});

describe('block bodies', () => {
  const body = (inside: string, type = 'aws_instance') => at(`resource "${type}" "web" {\n${inside}\n}`);

  test('arguments, nested blocks and meta-arguments of the schema', () => {
    const r = body('  |');
    expectAll(labels(r), ['ami', 'instance_type', 'root_block_device', 'count', 'for_each', 'lifecycle', 'depends_on']);
    expect(labels(r)).not.toContain('arn'); // computed only
    expect(find(r, 'instance_type')?.insert).toBe('instance_type = "$1"');
    expect(find(r, 'root_block_device')?.insert).toBe('root_block_device {\n  $0\n}');
  });

  test('required arguments first', () => {
    const r = body('  |', 'random_password');
    expect(labels(r)[0]).toBe('length');
    expect(find(r, 'length')?.detail).toContain('obligatorio');
  });

  test('arguments already set are left out, and count excludes for_each', () => {
    const r = body('  ami = "x"\n  count = 2\n  |');
    expect(labels(r)).not.toContain('ami');
    expect(labels(r)).not.toContain('count');
    expect(labels(r)).not.toContain('for_each');
    expect(labels(r)).toContain('instance_type');
  });

  test('only the name when "=" already follows', () => {
    const r = body('  inst| = "t3.micro"');
    expect(find(r, 'instance_type')?.insert).toBe('instance_type');
  });

  test('nested blocks', () => {
    expectAll(labels(body('  root_block_device {\n    vol|\n  }')), ['volume_size', 'volume_type']);
  });

  test('list(object) attributes are written as blocks', () => {
    const sg = at('resource "aws_security_group" "sg" {\n  ingr|\n}');
    expect(find(sg, 'ingress')?.insert).toBe('ingress {\n  $0\n}');
    expectAll(labels(at('resource "aws_security_group" "sg" {\n  ingress {\n    |\n  }\n}')), ['from_port', 'to_port', 'protocol', 'cidr_blocks']);
  });

  test('dynamic content follows the target block', () => {
    const r = at('resource "aws_security_group" "sg" {\n  dynamic "ingress" {\n    for_each = var.x\n    content {\n      |\n    }\n  }\n}');
    expect(labels(r)).toContain('from_port');
  });

  test('lifecycle', () => {
    expectAll(labels(body('  lifecycle {\n    |\n  }')), ['create_before_destroy', 'prevent_destroy', 'ignore_changes', 'replace_triggered_by', 'precondition']);
    expectAll(labels(body('  lifecycle {\n    ignore_changes = [|]\n  }')), ['tags', 'ami']);
    expect(labels(body('  lifecycle {\n    ignore_changes = |\n  }'))[0]).toBe('all');
  });

  test('a schema that is still loading', () => {
    const { schemas } = fakeSchemas([BUILTIN_SOURCE]);
    const r = at('resource "aws_instance" "web" {\n  |\n}', { schemas });
    expect(r?.pending).toContain('hashicorp/aws');
    expect(labels(r)).toContain('count');
  });

  test('variable, output, terraform and provider blocks', () => {
    expectAll(labels(at('variable "x" {\n  |\n}')), ['type', 'default', 'description', 'sensitive', 'validation']);
    expect(labels(at('output "x" {\n  |\n}'))[0]).toBe('value');
    expectAll(labels(at('terraform {\n  |\n}')), ['required_providers', 'backend', 'required_version']);
    expectAll(labels(at('terraform {\n  backend "s3" {\n    |\n  }\n}')), ['bucket', 'key', 'region', 'use_lockfile']);
    expect(labels(at('provider "aws" {\n  reg|\n}'))[0]).toBe('region');
  });

  test('required_providers entries', () => {
    const r = at('terraform {\n  required_providers {\n    |\n  }\n}');
    expect(find(r, 'aws')?.insert).toContain('source  = "hashicorp/aws"');
    expect(labels(at('terraform {\n  required_providers {\n    aws = {\n      |\n    }\n  }\n}'))).toEqual(['source', 'version', 'configuration_aliases']);
    expect(labels(at('terraform {\n  required_providers {\n    aws = {\n      source = "hashi|"\n    }\n  }\n}'))).toContain('hashicorp/aws');
  });
});

describe('expressions', () => {
  test('roots, resource types and functions', () => {
    const r = inConfig('output "x" {\n  value = |\n}');
    expectAll(labels(r), ['var', 'local', 'module', 'data', 'aws_vpc', 'aws_instance', 'cidrsubnet', 'jsonencode']);
    expect(find(r, 'var')?.insert).toBe('var.');
    expect(find(r, 'aws_vpc')?.insert).toBe('aws_vpc.');
  });

  test('variables, with type and description', () => {
    const r = inConfig('output "x" {\n  value = var.|\n}');
    expect(labels(r)).toEqual(['cidr', 'region']);
    expect(find(r, 'region')?.detail).toBe('string');
    expect(find(r, 'region')?.doc).toContain('Región de AWS');
  });

  test('locals', () => {
    expect(labels(inConfig('output "x" {\n  value = local.|\n}'))).toEqual(['name', 'tags']);
  });

  test('resources and their attributes', () => {
    expect(labels(inConfig('output "x" {\n  value = aws_vpc.|\n}'))).toEqual(['main']);
    const attrs = inConfig('output "x" {\n  value = aws_vpc.main.ci|\n}');
    expect(labels(attrs)[0]).toBe('cidr_block');
    expectAll(labels(inConfig('output "x" {\n  value = aws_vpc.main.|\n}')), ['id', 'arn', 'cidr_block']);
  });

  test('through indexes, splats and nested blocks', () => {
    expect(labels(inConfig('output "x" {\n  value = aws_instance.web[0].root_block_device[0].|\n}'))).toContain('volume_size');
    expect(labels(inConfig('output "x" {\n  value = aws_instance.web[*].|\n}'))).toContain('public_ip');
    expect(labels(inConfig('output "x" {\n  value = aws_instance.web.*.|\n}'))).toContain('public_ip');
  });

  test('data sources', () => {
    expect(labels(inConfig('output "x" {\n  value = data.|\n}'))).toEqual(['aws_ami']);
    expect(labels(inConfig('output "x" {\n  value = data.aws_ami.|\n}'))).toEqual(['ubuntu']);
    expectAll(labels(inConfig('output "x" {\n  value = data.aws_ami.ubuntu.|\n}')), ['id', 'image_id', 'name']);
  });

  test('inside interpolations and function calls', () => {
    expect(labels(inConfig('output "x" {\n  value = "web-${var.|}"\n}'))).toContain('region');
    expect(labels(inConfig('output "x" {\n  value = upper(var.re|)\n}'))[0]).toBe('region');
    expect(labels(inConfig('output "x" {\n  value = { a = var.|, b = 1 }\n}'))).toContain('cidr');
  });

  test('functions', () => {
    const r = at('output "x" {\n  value = cidrs|\n}');
    expect(labels(r).slice(0, 2)).toEqual(['cidrsubnet', 'cidrsubnets']);
    expect(find(r, 'cidrsubnet')?.insert).toBe('cidrsubnet($0)');
    expect(find(r, 'cidrsubnet')?.detail).toBe('cidrsubnet(prefix string, newbits number, netnum number) string');
    expect(find(at('output "x" {\n  value = times|\n}'), 'timestamp')?.insert).toBe('timestamp()');
  });

  test('each and count where they exist', () => {
    const src = (meta: string, ref: string) => `resource "aws_subnet" "s" {\n  ${meta}\n  cidr_block = ${ref}|\n}`;
    expect(labels(at(src('for_each = toset(["a"])', 'each.')))).toEqual(['key', 'value']);
    expect(labels(at(src('count = 2', 'count.')))).toEqual(['index']);
    expect(labels(at(src('count = 2', '')))).toContain('count');
    expect(labels(at(src('count = 2', '')))).not.toContain('each');
  });

  test('values that fit the argument come first', () => {
    expect(labels(at('resource "aws_instance" "w" {\n  monitoring = |\n}')).slice(0, 2)).toEqual(['false', 'true']);
    expectAll(labels(at('variable "x" {\n  type = |\n}')), ['string', 'number', 'bool', 'list', 'map', 'object']);
    expect(labels(at('variable "x" {\n  type = list(|)\n}'))).toContain('string');
  });

  test('provider references', () => {
    const r = at('provider "aws" {\n  alias = "west"\n}\nresource "aws_vpc" "v" {\n  provider = |\n}');
    expect(labels(r)).toEqual(['aws.west']);
  });

  test('dynamic iterators', () => {
    const r = at('resource "aws_security_group" "sg" {\n  dynamic "ingress" {\n    for_each = var.x\n    content {\n      from_port = ingress.|\n    }\n  }\n}');
    expect(labels(r)).toEqual(['key', 'value']);
  });

  test('maps have free-form keys', () => {
    const r = at('resource "aws_instance" "w" {\n  root_block_device {\n    tags = { | }\n  }\n}');
    expect(r?.items ?? []).toEqual([]);
  });
});

describe('modules', () => {
  const files = {
    'modules/red/variables.tf': 'variable "cidr" {\n  type = string\n}\nvariable "nombre" {\n  type    = string\n  default = "red"\n}\n',
    'modules/red/outputs.tf': 'output "vpc_id" {\n  value       = "x"\n  description = "ID de la VPC"\n}\n',
  };

  test('module inputs, required first', () => {
    const r = at('module "red" {\n  source = "./modules/red"\n  |\n}', { files });
    expect(labels(r)[0]).toBe('cidr');
    expect(find(r, 'cidr')?.detail).toContain('obligatoria');
    expectAll(labels(r), ['nombre', 'count', 'depends_on']);
    expect(labels(r)).not.toContain('source'); // already set
    expect(labels(at('module "red" {\n  |\n}', { files }))[0]).toBe('source');
  });

  test('module outputs and local sources', () => {
    const main = 'module "red" {\n  source = "./modules/red"\n}\noutput "id" {\n  value = module.red.|\n}';
    expect(labels(at(main, { files }))).toEqual(['vpc_id']);
    expect(labels(at('module "red" {\n  source = "|"\n}', { files }))).toEqual(['./modules/red']);
    expect(labels(at('output "x" {\n  value = module.|\n}\nmodule "red" {\n  source = "./modules/red"\n}', { files }))).toEqual(['red']);
  });

  test('references are resolved inside the module being edited', () => {
    const r = at('output "o" {\n  value = var.|\n}', { files, file: 'modules/red/main.tf' });
    expect(labels(r)).toEqual(['cidr', 'nombre']);
  });
});

describe('tfvars', () => {
  test('variables of the root module that are not set yet', () => {
    const files = { 'variables.tf': 'variable "region" {}\nvariable "cidr" {\n  type = string\n}\n' };
    const r = at('region = "x"\nc|', { files, file: 'terraform.tfvars' });
    expect(labels(r)).toEqual(['cidr']);
    expect(find(r, 'cidr')?.insert).toBe('cidr = "$1"');
  });
});

describe('traversalBefore', () => {
  const t = (s: string) => traversalBefore(s, s.length);
  test('steps', () => {
    expect(t('aws_instance.web.')).toEqual(['aws_instance', 'web']);
    expect(t('x = aws_instance.web[count.index].')).toEqual(['aws_instance', 'web', '[]']);
    expect(t('a.b["k"][0].')).toEqual(['a', 'b', '[]', '[]']);
    expect(t('a.b.*.')).toEqual(['a', 'b', '[]']);
    expect(t('value = ')).toEqual([]);
  });
  test('unresolvable', () => {
    expect(t('lower(x).')).toBeNull();
    expect(t('"abc".')).toBeNull();
    expect(t('1.')).toBeNull();
  });
});

test('the functions offered are exactly those the engine implements', () => {
  const go = readFileSync(new URL('tools/tfplay/engine/funcs.go', root), 'utf8');
  const map = go.slice(go.indexOf('fns := map[string]function.Function{'));
  const names = new Set([...map.matchAll(/^\s*"([a-z0-9]+)":/gm)].map((m) => m[1]));
  for (const m of go.matchAll(/fns\["([a-z0-9]+)"\]\s*=/g)) names.add(m[1]);
  expect(Object.keys(FUNCTIONS).sort()).toEqual([...names].sort());
});

describe('SchemaCache', () => {
  function fakeEngine() {
    const calls: string[] = [];
    const engine: SchemaEngine = {
      loadProvider: async (name) => {
        calls.push('load:' + name);
      },
      providerIndex: async (source) =>
        PROVIDERS[source] && (source === BUILTIN_SOURCE || calls.includes('load:' + source.split('/')[1])) ? toIndex(PROVIDERS[source]) : null,
      typeSchema: async (source, kind, type) => PROVIDERS[source]?.[kind === 'data' ? 'data_sources' : 'resources'][type] ?? null,
    };
    return { engine, calls };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('loads providers and schemas on demand and notifies', async () => {
    const { engine, calls } = fakeEngine();
    const cache = new SchemaCache(engine);
    let changes = 0;
    cache.subscribe(() => changes++);
    await tick();
    expect(cache.indexes().map((i) => i.source)).toEqual([BUILTIN_SOURCE]);

    expect(cache.block('hashicorp/aws', 'resource', 'aws_vpc')).toBeNull();
    await tick();
    expect(calls).toEqual(['load:aws']);
    expect(cache.block('hashicorp/aws', 'resource', 'aws_vpc')).toBeNull(); // now the type schema
    await tick();
    expect(cache.block('hashicorp/aws', 'resource', 'aws_vpc')?.attributes?.cidr_block).toBeDefined();
    expect(cache.block('hashicorp/aws', 'resource', 'aws_nope')).toBeUndefined();
    expect(cache.block('acme/nope', 'resource', 'nope_x')).toBeUndefined();
    expect(changes).toBeGreaterThanOrEqual(3);
  });

  test('custom providers come from the workspace files', async () => {
    const cache = new SchemaCache(fakeEngine().engine);
    cache.setFiles({
      'pizza.provider.json': JSON.stringify({
        name: 'pizzeria',
        source: 'curso/pizzeria',
        resources: { pizzeria_pedido: { attributes: { tamano: { type: 'string', required: true } } } },
      }),
      'roto.provider.json': '{',
    });
    expect(cache.indexes().find((i) => i.source === 'curso/pizzeria')?.resources).toEqual(['pizzeria_pedido']);
    const files = { 'providers.tf': 'terraform {\n  required_providers {\n    pizzeria = { source = "curso/pizzeria" }\n  }\n}\n' };
    const r = at('resource "pizzeria_pedido" "p" {\n  |\n}', { files, schemas: cache });
    expect(labels(r)[0]).toBe('tamano');
  });
});

describe('expandSnippet', () => {
  test('tab stops, defaults and indentation', () => {
    const e = expandSnippet('resource "$1" "${2:nombre}" {\n  $0\n}', '  ');
    expect(e.text).toBe('resource "" "nombre" {\n    \n  }');
    expect(e.stops).toEqual([
      { start: 10, end: 10 },
      { start: 13, end: 19 },
      { start: 27, end: 27 },
    ]);
  });

  test('without $0 the cursor ends after the text; \\$ is a dollar', () => {
    expect(expandSnippet('var.')).toEqual({ text: 'var.', stops: [{ start: 4, end: 4 }] });
    expect(expandSnippet('x = "\\${a}"').text).toBe('x = "${a}"');
  });
});
