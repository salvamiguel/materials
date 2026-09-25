// Terraform autocompletion for the playground editor, in the spirit of the
// HashiCorp VS Code extension: block types, resource and data source types,
// arguments and nested blocks from the provider schemas, meta-arguments,
// references (var., local., module., data., aws_instance.web.…), functions
// and a few values. Pure: the schemas come through the Schemas interface.

import type { ProviderIndex, SchemaAttribute, SchemaBlock, SchemaNestedBlock } from '../engine';
import { FUNCTIONS } from './functions';
import { attrOf, dirOf, joinDir, literal, moduleDirs, outlineModule, type ModuleOutline } from './outline';
import { scan, type BlockNode, type Frame } from './scan';

export type ItemKind = 'keyword' | 'block' | 'attribute' | 'type' | 'provider' | 'reference' | 'function' | 'value';

export interface CompletionItem {
  label: string;
  kind: ItemKind;
  detail?: string;
  doc?: string;
  /** Snippet: $1 and ${1:text} are tab stops, $0 is where the cursor ends. */
  insert: string;
  /** Show the list again after inserting (e.g. "var." lists the variables). */
  retrigger?: boolean;
  required?: boolean;
  /** Sort group: lower first. */
  group?: number;
}

export interface CompletionResult {
  /** Text range the chosen item replaces. */
  from: number;
  to: number;
  items: CompletionItem[];
  /** Shown while a provider schema downloads. */
  pending?: string;
}

/** Provider schemas, looked up synchronously. The implementation loads what
 * is missing in the background and asks for completion again when it arrives. */
export interface Schemas {
  /** Providers whose index is available. */
  indexes(): ProviderIndex[];
  /** Sources that can be downloaded on demand. */
  bundled(): string[];
  /** Starts downloading a provider. */
  load(source: string): void;
  /** Schema of a type: null while loading, undefined if it doesn't exist. */
  block(source: string, kind: 'resource' | 'data', type: string): SchemaBlock | null | undefined;
}

export interface CompletionRequest {
  files: Record<string, string>;
  filename: string;
  offset: number;
  schemas: Schemas;
}

export const BUILTIN_SOURCE = 'terraform.io/builtin/terraform';

// ── static vocabulary ──

type Spec = [name: string, detail: string, doc: string, insert?: string, retrigger?: boolean];

const TOP_BLOCKS: Spec[] = [
  ['resource', 'bloque', 'Un objeto de infraestructura que Terraform crea y gestiona.', 'resource "$1" "${2:nombre}" {\n  $0\n}', true],
  ['data', 'bloque', 'Consulta algo que ya existe (solo lectura).', 'data "$1" "${2:nombre}" {\n  $0\n}', true],
  ['variable', 'bloque', 'Parámetro de entrada del módulo (var.nombre).', 'variable "$1" {\n  type        = ${2:string}\n  description = "$3"\n}'],
  ['output', 'bloque', 'Valor que el módulo expone (y que apply muestra).', 'output "$1" {\n  value = $0\n}'],
  ['locals', 'bloque', 'Valores con nombre calculados una vez (local.nombre).', 'locals {\n  $0\n}'],
  ['module', 'bloque', 'Usa otro módulo, como una función con entradas y salidas.', 'module "$1" {\n  source = "$2"\n  $0\n}'],
  ['provider', 'bloque', 'Configura un proveedor (región, alias...).', 'provider "$1" {\n  $0\n}', true],
  ['terraform', 'bloque', 'Ajustes de Terraform: proveedores requeridos, backend, versión.', 'terraform {\n  required_providers {\n    $0\n  }\n}', true],
  ['moved', 'bloque', 'Renombra o mueve un recurso sin destruirlo.', 'moved {\n  from = $1\n  to   = $2\n}'],
  ['import', 'bloque', 'Trae un objeto existente al estado.', 'import {\n  to = $1\n  id = "$2"\n}'],
  ['removed', 'bloque', 'Saca un recurso del estado, destruyéndolo o no.', 'removed {\n  from = $1\n\n  lifecycle {\n    destroy = ${2:false}\n  }\n}'],
  ['check', 'bloque', 'Comprobaciones que avisan (sin bloquear) tras plan y apply.', 'check "$1" {\n  assert {\n    condition     = $2\n    error_message = "$3"\n  }\n}'],
];

const RESOURCE_META: Spec[] = [
  ['count', 'number · meta-argumento', 'Crea este número de instancias; count.index es la posición de cada una.', 'count = $0'],
  ['for_each', 'map o set(string) · meta-argumento', 'Crea una instancia por elemento; each.key y each.value en cada una.', 'for_each = $0'],
  ['depends_on', 'list · meta-argumento', 'Dependencias que Terraform no puede deducir de las referencias.', 'depends_on = [$0]'],
  ['provider', 'meta-argumento', 'Usa otra configuración del proveedor (con alias), p. ej. aws.west.', 'provider = $0', true],
];
const LIFECYCLE_BLOCK: Spec = ['lifecycle', 'bloque · meta-argumento', 'Ajusta el ciclo de vida: create_before_destroy, prevent_destroy, ignore_changes...', 'lifecycle {\n  $0\n}', true];

const MODULE_META: Spec[] = [
  ['source', 'string · obligatorio', 'Dónde está el módulo: una carpeta local ("./modules/red").', 'source = "$1"', true],
  ['version', 'string', 'Versión del módulo (solo para módulos de un registry).', 'version = "$1"'],
  ...RESOURCE_META.slice(0, 3),
  ['providers', 'map · meta-argumento', 'Qué configuraciones de proveedor recibe el módulo.', 'providers = {\n  $0\n}'],
];

const CONDITION: Spec[] = [
  ['condition', 'bool · obligatorio', 'Expresión que debe ser true.', 'condition = $0'],
  ['error_message', 'string · obligatorio', 'Mensaje si la condición es false.', 'error_message = "$1"'],
];

interface Static {
  attrs?: Spec[];
  blocks?: Spec[];
  /** Required attribute names. */
  required?: string[];
}

const STATIC: Record<string, Static> = {
  variable: {
    attrs: [
      ['type', 'tipo', 'Tipo del valor: string, number, bool, list(...), map(...), object({...}).', 'type = $0', true],
      ['default', 'any', 'Valor si no se da otro; sin default la variable es obligatoria.', 'default = $0'],
      ['description', 'string', 'Para qué sirve (aparece en la documentación y al pedir el valor).', 'description = "$1"'],
      ['sensitive', 'bool', 'Oculta el valor en el plan y en la salida.', 'sensitive = ${1:true}'],
      ['nullable', 'bool', 'Si puede valer null (true por defecto).', 'nullable = ${1:false}'],
      ['ephemeral', 'bool', 'Valor efímero: no se guarda en el estado ni en el plan.', 'ephemeral = ${1:true}'],
    ],
    blocks: [['validation', 'bloque', 'Regla que debe cumplir el valor.', 'validation {\n  condition     = $1\n  error_message = "$2"\n}']],
  },
  output: {
    attrs: [
      ['value', 'any · obligatorio', 'Valor que se expone.', 'value = $0'],
      ['description', 'string', 'Qué es este valor.', 'description = "$1"'],
      ['sensitive', 'bool', 'Oculta el valor en la salida de apply.', 'sensitive = ${1:true}'],
      ['depends_on', 'list', 'Dependencias explícitas.', 'depends_on = [$0]'],
      ['ephemeral', 'bool', 'Salida efímera (solo en módulos hijos).', 'ephemeral = ${1:true}'],
    ],
    blocks: [['precondition', 'bloque', 'Comprobación antes de exponer el valor.', 'precondition {\n  condition     = $1\n  error_message = "$2"\n}']],
    required: ['value'],
  },
  terraform: {
    attrs: [['required_version', 'string', 'Versiones de Terraform admitidas, p. ej. ">= 1.5".', 'required_version = "${1:>= 1.5}"']],
    blocks: [
      ['required_providers', 'bloque', 'Proveedores que usa la configuración, con su origen y versión.', 'required_providers {\n  $0\n}', true],
      ['backend', 'bloque', 'Dónde se guarda el estado (s3, gcs, azurerm, local...).', 'backend "$1" {\n  $0\n}', true],
      ['cloud', 'bloque', 'Usa HCP Terraform para el estado y las ejecuciones.', 'cloud {\n  organization = "$1"\n\n  workspaces {\n    name = "$2"\n  }\n}'],
    ],
  },
  lifecycle: {
    attrs: [
      ['create_before_destroy', 'bool', 'Al reemplazar, crea el nuevo antes de destruir el viejo.', 'create_before_destroy = ${1:true}'],
      ['prevent_destroy', 'bool', 'Da error si un plan quiere destruir este recurso.', 'prevent_destroy = ${1:true}'],
      ['ignore_changes', 'list', 'Atributos cuyos cambios fuera de Terraform se ignoran (o all).', 'ignore_changes = [$0]', true],
      ['replace_triggered_by', 'list', 'Reemplaza este recurso cuando cambian los indicados.', 'replace_triggered_by = [$0]', true],
    ],
    blocks: [
      ['precondition', 'bloque', 'Comprobación antes de crear o modificar.', 'precondition {\n  condition     = $1\n  error_message = "$2"\n}'],
      ['postcondition', 'bloque', 'Comprobación sobre el resultado (self.atributo).', 'postcondition {\n  condition     = $1\n  error_message = "$2"\n}'],
    ],
  },
  condition: { attrs: CONDITION, required: ['condition', 'error_message'] },
  moved: {
    attrs: [
      ['from', 'dirección · obligatorio', 'Dirección anterior del recurso.', 'from = $0'],
      ['to', 'dirección · obligatorio', 'Dirección nueva.', 'to = $0'],
    ],
    required: ['from', 'to'],
  },
  import: {
    attrs: [
      ['to', 'dirección · obligatorio', 'Recurso de la configuración que recibe el objeto.', 'to = $0'],
      ['id', 'string · obligatorio', 'Identificador del objeto en el proveedor.', 'id = "$1"'],
      ['provider', 'referencia', 'Configuración del proveedor (alias).', 'provider = $0'],
      ['for_each', 'map o set', 'Importa varios objetos.', 'for_each = $0'],
    ],
    required: ['to', 'id'],
  },
  removed: {
    attrs: [['from', 'dirección · obligatorio', 'Recurso que se saca de la configuración.', 'from = $0']],
    blocks: [['lifecycle', 'bloque', 'destroy = false lo olvida sin destruirlo.', 'lifecycle {\n  destroy = ${1:false}\n}']],
    required: ['from'],
  },
  'removed.lifecycle': { attrs: [['destroy', 'bool · obligatorio', 'false: sale del estado pero sigue existiendo.', 'destroy = ${1:false}']] },
  check: {
    blocks: [
      ['assert', 'bloque', 'Condición que se comprueba (solo avisa).', 'assert {\n  condition     = $1\n  error_message = "$2"\n}'],
      ['data', 'bloque', 'Data source que solo se lee dentro del check.', 'data "$1" "${2:nombre}" {\n  $0\n}'],
    ],
  },
  cloud: {
    attrs: [
      ['organization', 'string', 'Organización de HCP Terraform.', 'organization = "$1"'],
      ['hostname', 'string', 'Servidor (app.terraform.io por defecto).', 'hostname = "$1"'],
    ],
    blocks: [['workspaces', 'bloque', 'Qué workspaces usa.', 'workspaces {\n  name = "$1"\n}']],
  },
  'backend.s3': {
    attrs: [
      ['bucket', 'string · obligatorio', 'Bucket S3 donde se guarda el estado.', 'bucket = "$1"'],
      ['key', 'string · obligatorio', 'Ruta del fichero de estado dentro del bucket.', 'key = "${1:terraform.tfstate}"'],
      ['region', 'string · obligatorio', 'Región del bucket.', 'region = "${1:eu-west-1}"'],
      ['use_lockfile', 'bool', 'Bloqueo nativo de S3 (un .tflock junto al estado).', 'use_lockfile = ${1:true}'],
      ['encrypt', 'bool', 'Cifra el estado en el bucket.', 'encrypt = ${1:true}'],
      ['profile', 'string', 'Perfil de credenciales de AWS.', 'profile = "$1"'],
      ['dynamodb_table', 'string · obsoleto', 'Bloqueo con DynamoDB (obsoleto: usa use_lockfile).', 'dynamodb_table = "$1"'],
    ],
    required: ['bucket', 'key', 'region'],
  },
  'backend.gcs': {
    attrs: [
      ['bucket', 'string · obligatorio', 'Bucket de Cloud Storage.', 'bucket = "$1"'],
      ['prefix', 'string', 'Carpeta dentro del bucket.', 'prefix = "$1"'],
    ],
    required: ['bucket'],
  },
  'backend.azurerm': {
    attrs: [
      ['resource_group_name', 'string', 'Grupo de recursos de la cuenta de almacenamiento.', 'resource_group_name = "$1"'],
      ['storage_account_name', 'string', 'Cuenta de almacenamiento.', 'storage_account_name = "$1"'],
      ['container_name', 'string', 'Contenedor.', 'container_name = "$1"'],
      ['key', 'string', 'Nombre del blob del estado.', 'key = "${1:terraform.tfstate}"'],
    ],
  },
  'backend.local': { attrs: [['path', 'string', 'Fichero de estado.', 'path = "${1:terraform.tfstate}"']] },
  'backend.remote': {
    attrs: [['organization', 'string', 'Organización de HCP Terraform.', 'organization = "$1"']],
    blocks: [['workspaces', 'bloque', 'Qué workspaces usa.', 'workspaces {\n  name = "$1"\n}']],
  },
};

const BACKENDS = ['s3', 'gcs', 'azurerm', 'local', 'remote'];

const TYPES: Spec[] = [
  ['string', 'tipo', 'Texto.', 'string'],
  ['number', 'tipo', 'Número (entero o decimal).', 'number'],
  ['bool', 'tipo', 'true o false.', 'bool'],
  ['list', 'tipo', 'Lista ordenada de elementos del mismo tipo.', 'list($1)', true],
  ['set', 'tipo', 'Conjunto sin orden ni duplicados.', 'set($1)', true],
  ['map', 'tipo', 'Mapa de claves (texto) a valores del mismo tipo.', 'map($1)', true],
  ['object', 'tipo', 'Objeto con atributos de tipos concretos.', 'object({\n  $0\n})'],
  ['tuple', 'tipo', 'Lista de longitud fija con un tipo por posición.', 'tuple([$0])'],
  ['any', 'tipo', 'Cualquier tipo (Terraform lo deduce del valor).', 'any'],
  ['optional', 'tipo', 'Atributo opcional de un object, con valor por defecto.', 'optional($1)', true],
];

const ROOTS: Spec[] = [
  ['var', 'variables', 'Variables de entrada del módulo.', 'var.', true],
  ['local', 'valores locales', 'Valores definidos en bloques locals.', 'local.', true],
  ['module', 'módulos', 'Salidas de los módulos llamados: module.nombre.salida.', 'module.', true],
  ['data', 'data sources', 'Atributos de data sources: data.tipo.nombre.atributo.', 'data.', true],
  ['path', 'rutas', 'path.module, path.root y path.cwd.', 'path.', true],
  ['terraform', 'terraform', 'terraform.workspace: el workspace actual.', 'terraform.', true],
];

// ── helpers ──

const IDENT = /[A-Za-z0-9_-]/;

function item(spec: Spec, kind: ItemKind, group: number, required = false): CompletionItem {
  const [label, detail, doc, insert, retrigger] = spec;
  return { label, kind, detail, doc, insert: insert ?? label, retrigger, group, required };
}

/** Terraform type syntax for a schema type (cty JSON or a type expression). */
export function typeText(t: unknown): string {
  if (typeof t === 'string') return t === 'dynamic' ? 'any' : t;
  if (Array.isArray(t)) {
    const [k, e] = t;
    if (k === 'object') return 'object';
    if (k === 'tuple') return 'tuple';
    return `${k}(${typeText(e)})`;
  }
  return 'any';
}

/** The attributes of an object type, looking through list/set/map. */
function objectAttrs(t: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(t)) return undefined;
  const [k, e] = t;
  if (k === 'object' && e && typeof e === 'object') return e as Record<string, unknown>;
  if (k === 'list' || k === 'set' || k === 'map') return objectAttrs(e);
  return undefined;
}

const objectBlock = (attrs: Record<string, unknown>): SchemaBlock => ({
  attributes: Object.fromEntries(Object.entries(attrs).map(([k, t]) => [k, { type: t, optional: true }])),
});

/** list(object) / set(object) attributes are written as blocks (SDKv2 "attributes as blocks"). */
const isBlockLike = (a: SchemaAttribute) => Array.isArray(a.type) && (a.type[0] === 'list' || a.type[0] === 'set') && !!objectAttrs(a.type);

/** The schema inside an attribute of object type or a nested attribute. */
function innerBlock(a: SchemaAttribute | undefined): SchemaBlock | undefined {
  if (!a) return undefined;
  if (a.nested) return a.nested;
  const o = objectAttrs(a.type);
  return o ? objectBlock(o) : undefined;
}

function attrInsert(name: string, a: SchemaAttribute): { insert: string; retrigger?: boolean } {
  if (a.nested) {
    const n = a.nested.nesting;
    return { insert: n === 'list' || n === 'set' ? `${name} = [\n  {\n    $0\n  }\n]` : `${name} = {\n  $0\n}`, retrigger: true };
  }
  const t = a.type;
  if (t === 'string') return { insert: `${name} = "$1"` };
  if (t === 'bool') return { insert: `${name} = $0`, retrigger: true };
  if (Array.isArray(t)) {
    if (t[0] === 'list' || t[0] === 'set' || t[0] === 'tuple') return { insert: `${name} = [$0]` };
    if (t[0] === 'map' || t[0] === 'object') return { insert: `${name} = {\n  $0\n}`, retrigger: t[0] === 'object' };
  }
  return { insert: `${name} = $0` };
}

function attrDetail(a: SchemaAttribute): string {
  const parts = [a.nested ? (a.nested.nesting === 'list' || a.nested.nesting === 'set' ? `${a.nested.nesting}(object)` : 'object') : typeText(a.type)];
  if (a.required) parts.push('obligatorio');
  if (a.force_new) parts.push('fuerza reemplazo');
  if (a.sensitive) parts.push('sensible');
  return parts.join(' · ');
}

function blockDetail(nb: SchemaNestedBlock): string {
  const parts = ['bloque'];
  if (nb.nesting === 'list' || nb.nesting === 'set') parts.push(nb.max_items === 1 ? 'máx. 1' : 'repetible');
  if ((nb.min_items ?? 0) > 0) parts.push('obligatorio');
  return parts.join(' · ');
}

/** Items for the arguments and nested blocks a schema allows in a body. */
function schemaBodyItems(b: SchemaBlock): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const [name, a] of Object.entries(b.attributes || {})) {
    if (!a.required && !a.optional) continue; // computed only: can't be set
    if (isBlockLike(a)) {
      out.push({ label: name, kind: 'block', detail: `bloque · ${typeText(a.type)}`, doc: a.description, insert: `${name} {\n  $0\n}`, retrigger: true, group: 2 });
      continue;
    }
    out.push({ label: name, kind: 'attribute', detail: attrDetail(a), doc: a.description, ...attrInsert(name, a), required: a.required, group: a.required ? 0 : 1 });
  }
  for (const [name, nb] of Object.entries(b.blocks || {})) {
    const required = (nb.min_items ?? 0) > 0;
    out.push({ label: name, kind: 'block', detail: blockDetail(nb), doc: nb.description, insert: `${name} {\n  $0\n}`, retrigger: true, required, group: required ? 0 : 2 });
  }
  return out;
}

/** Items to reference an object's attributes (aws_instance.web.<here>). */
function memberItemsOf(b: SchemaBlock): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const [name, a] of Object.entries(b.attributes || {})) {
    out.push({ label: name, kind: 'attribute', detail: attrDetail({ ...a, required: false }), doc: a.description, insert: name, group: 1 });
  }
  for (const [name, nb] of Object.entries(b.blocks || {})) {
    const many = nb.nesting === 'list' || nb.nesting === 'set';
    out.push({ label: name, kind: 'block', detail: many ? `bloque · ${nb.nesting} (usa ${name}[0])` : 'bloque', insert: name, group: 2 });
  }
  return out;
}

/** Walks a reference path (["root_block_device", "[]"]) through a schema. */
function walk(b: SchemaBlock | undefined, steps: string[]): SchemaBlock | undefined {
  let cur = b;
  for (const s of steps) {
    if (!cur) return undefined;
    if (s === '[]') continue;
    if (cur.blocks?.[s]) cur = cur.blocks[s];
    else cur = innerBlock(cur.attributes?.[s]);
  }
  return cur;
}

function matchScore(label: string, prefix: string): number | undefined {
  if (!prefix) return 0;
  const l = label.toLowerCase();
  const p = prefix.toLowerCase();
  if (l.startsWith(p)) return 0;
  const i = l.indexOf(p);
  if (i > 0 && /[_.\-/]/.test(l[i - 1])) return 1;
  if (i > 0) return 2;
  if (p.length < 3) return undefined;
  let j = 0;
  for (const ch of l) if (ch === p[j] && ++j === p.length) return 3;
  return undefined;
}

function rank(items: CompletionItem[], prefix: string, limit = 300): CompletionItem[] {
  const seen = new Set<string>();
  const scored: [number, CompletionItem][] = [];
  for (const it of items) {
    const key = it.kind + ':' + it.label;
    if (seen.has(key)) continue;
    const s = matchScore(it.label, prefix);
    if (s === undefined) continue;
    seen.add(key);
    scored.push([s, it]);
  }
  // Once something is typed, the shortest match is usually the one meant:
  // aws_ins → aws_instance, inst → instance_type.
  const byLength = (a: CompletionItem, b: CompletionItem) => (prefix ? a.label.length - b.label.length : 0);
  scored.sort(([sa, a], [sb, b]) => sa - sb || (a.group ?? 5) - (b.group ?? 5) || byLength(a, b) || a.label.localeCompare(b.label));
  return scored.slice(0, limit).map(([, it]) => it);
}

function normalizeSource(s: string): string {
  return s.toLowerCase().replace(/^registry\.terraform\.io\//, '');
}

// ── context ──

type Level =
  | { k: 'root' }
  | { k: 'schema'; block?: SchemaBlock; meta?: 'resource' | 'data' }
  | { k: 'dynamic'; target?: SchemaBlock }
  | { k: 'static'; name: string }
  | { k: 'module'; node: BlockNode }
  | { k: 'provider'; block?: SchemaBlock }
  | { k: 'required_providers' }
  | { k: 'none' };

class Ctx {
  readonly src: string;
  readonly dir: string;
  readonly frames: Frame[];
  readonly path: BlockNode[];
  pending?: string;
  private outlines = new Map<string, ModuleOutline>();

  constructor(readonly req: CompletionRequest, frames: Frame[]) {
    this.src = req.files[req.filename] ?? '';
    this.dir = dirOf(req.filename);
    this.frames = frames;
    this.path = frames.filter((f): f is Extract<Frame, { t: 'body' }> => f.t === 'body').slice(1).map((f) => f.node);
  }

  outline(dir = this.dir): ModuleOutline {
    let o = this.outlines.get(dir);
    if (!o) {
      o = outlineModule(this.req.files, dir);
      this.outlines.set(dir, o);
    }
    return o;
  }

  word(chars = IDENT) {
    const { src } = this;
    const at = this.req.offset;
    let from = at;
    while (from > 0 && chars.test(src[from - 1])) from--;
    let to = at;
    while (to < src.length && chars.test(src[to])) to++;
    return { from, to, prefix: src.slice(from, at) };
  }

  sourceFor(local: string): string {
    const rp = this.outline().requiredProviders.get(local) ?? this.outline('').requiredProviders.get(local);
    if (rp?.source) return normalizeSource(rp.source);
    return local === 'terraform' ? BUILTIN_SOURCE : `hashicorp/${local}`;
  }

  index(source: string): ProviderIndex | undefined {
    return this.req.schemas.indexes().find((i) => normalizeSource(i.source) === source);
  }

  /** Schema of a resource or data source type; loads its provider if needed. */
  typeSchema(kind: 'resource' | 'data', type: string): SchemaBlock | undefined {
    const source = this.sourceFor(type.split('_')[0]);
    const b = this.req.schemas.block(source, kind, type);
    if (b === null) this.pending = `Cargando el esquema de ${source}…`;
    return b ?? undefined;
  }

  providerSchema(local: string): SchemaBlock | undefined {
    const source = this.sourceFor(local);
    const idx = this.index(source);
    if (idx) return idx.provider;
    if (this.req.schemas.bundled().includes(source)) {
      this.req.schemas.load(source);
      this.pending = `Cargando el esquema de ${source}…`;
    }
    return undefined;
  }

  /** What can be written in the body at the given depth of the path. */
  level(depth = this.path.length): Level {
    let lv: Level = { k: 'root' };
    for (let d = 0; d < depth; d++) lv = this.child(lv, this.path[d]);
    return lv;
  }

  private child(lv: Level, b: BlockNode): Level {
    const t = b.type;
    switch (lv.k) {
      case 'root':
        if (t === 'resource' || t === 'data') return { k: 'schema', block: b.labels[0] ? this.typeSchema(t, b.labels[0]) : undefined, meta: t };
        if (t === 'provider') return { k: 'provider', block: b.labels[0] ? this.providerSchema(b.labels[0]) : undefined };
        if (t === 'module') return { k: 'module', node: b };
        if (STATIC[t]) return { k: 'static', name: t };
        return { k: 'none' };
      case 'schema':
        if (t === 'lifecycle' && lv.meta) return { k: 'static', name: 'lifecycle' };
        if (t === 'dynamic') {
          const name = b.labels[0];
          return { k: 'dynamic', target: name ? lv.block?.blocks?.[name] ?? innerBlock(lv.block?.attributes?.[name]) : undefined };
        }
        if (lv.block?.blocks?.[t]) return { k: 'schema', block: lv.block.blocks[t] };
        if (lv.block?.attributes?.[t] && isBlockLike(lv.block.attributes[t])) return { k: 'schema', block: innerBlock(lv.block.attributes[t]) };
        return { k: 'none' };
      case 'dynamic':
        return t === 'content' ? { k: 'schema', block: lv.target } : { k: 'none' };
      case 'static': {
        if (lv.name === 'terraform' && t === 'required_providers') return { k: 'required_providers' };
        if (lv.name === 'terraform' && t === 'backend') return STATIC[`backend.${b.labels[0]}`] ? { k: 'static', name: `backend.${b.labels[0]}` } : { k: 'none' };
        if (lv.name === 'terraform' && t === 'cloud') return { k: 'static', name: 'cloud' };
        if (lv.name === 'removed' && t === 'lifecycle') return { k: 'static', name: 'removed.lifecycle' };
        if (lv.name === 'check' && t === 'data') return { k: 'schema', block: b.labels[0] ? this.typeSchema('data', b.labels[0]) : undefined, meta: 'data' };
        if (['validation', 'precondition', 'postcondition', 'assert'].includes(t)) return { k: 'static', name: 'condition' };
        return { k: 'none' };
      }
      default:
        return { k: 'none' };
    }
  }

  /** The block (and schema) of the resource we're in, for self and ignore_changes. */
  resourceSchema(): SchemaBlock | undefined {
    const top = this.path[0];
    if (top?.type !== 'resource' || !top.labels[0]) return undefined;
    return this.typeSchema('resource', top.labels[0]);
  }

  /** The module a module block calls, when its source is a local directory. */
  moduleDir(source?: string): string | undefined {
    if (!source || !/^\.\.?\//.test(source)) return undefined;
    return joinDir(this.dir, source);
  }
}

// ── entry point ──

export function complete(req: CompletionRequest): CompletionResult | undefined {
  const { filename, offset } = req;
  const src = req.files[filename] ?? '';
  if (/\.tfvars$/.test(filename)) return completeTfvars(req, src);
  if (!filename.endsWith('.tf')) return undefined;
  const s = scan(src, offset);
  if (s.inComment || !s.at) return undefined;
  const ctx = new Ctx(req, s.at);
  const f = s.at[s.at.length - 1];
  let res: CompletionResult | undefined;
  switch (f.t) {
    case 'string':
      res = f.label ? completeLabel(ctx, f) : completeString(ctx, f);
      break;
    case 'heredoc':
      return undefined;
    case 'body':
      res = completeBody(ctx, f);
      break;
    case 'brace':
      res = f.afterEq ? completeExpr(ctx) : completeKey(ctx, f);
      break;
    default:
      res = completeExpr(ctx);
  }
  if (res && ctx.pending) res.pending = ctx.pending;
  if (!res && ctx.pending) {
    const w = ctx.word();
    return { from: w.from, to: w.to, items: [], pending: ctx.pending };
  }
  return res;
}

function completeTfvars(req: CompletionRequest, src: string): CompletionResult | undefined {
  const s = scan(src, req.offset);
  const f = s.at?.[s.at.length - 1];
  if (s.inComment || !s.at || s.at.length !== 1 || f?.t !== 'body') return undefined;
  const ctx = new Ctx(req, s.at);
  const w = ctx.word();
  if (f.line.some((t) => t.end <= w.from)) return undefined;
  const set = new Set(f.node.attrs.filter((a) => a.nameStart !== w.from).map((a) => a.name));
  const items: CompletionItem[] = [];
  for (const [name, v] of ctx.outline(dirOf(req.filename)).variables) {
    if (set.has(name)) continue;
    const isString = v.type === 'string';
    items.push({
      label: name,
      kind: 'attribute',
      detail: v.type ? `${v.type}${v.default === undefined ? ' · obligatoria' : ''}` : 'variable',
      doc: v.description,
      insert: isString ? `${name} = "$1"` : `${name} = $0`,
      required: v.default === undefined,
      group: v.default === undefined ? 0 : 1,
    });
  }
  return { from: w.from, to: w.to, items: rank(items, w.prefix) };
}

function completeBody(ctx: Ctx, f: Extract<Frame, { t: 'body' }>): CompletionResult | undefined {
  const w = ctx.word();
  if (f.line.some((t) => t.end <= w.from) || /^[0-9]/.test(w.prefix)) return undefined;
  const lv = ctx.level();
  let items: CompletionItem[] = [];
  switch (lv.k) {
    case 'root':
      items = TOP_BLOCKS.map((s) => item(s, 'keyword', 1));
      break;
    case 'schema':
      if (lv.block) items = schemaBodyItems(lv.block);
      if (lv.meta) {
        const has = (n: string) => !!attrOf(f.node, n);
        items.push(...RESOURCE_META.filter(([n]) => !(n === 'count' && has('for_each')) && !(n === 'for_each' && has('count'))).map((s) => item(s, 'keyword', 3)));
        items.push(item(LIFECYCLE_BLOCK, 'keyword', 3));
      }
      break;
    case 'dynamic':
      items = [
        item(['for_each', 'obligatorio', 'Colección: se crea un bloque por elemento.', 'for_each = $0'], 'attribute', 0, true),
        item(['iterator', 'nombre', 'Nombre de la variable del bucle (por defecto, la etiqueta del bloque).', 'iterator = $0'], 'attribute', 1),
        item(['labels', 'list(string)', 'Etiquetas de cada bloque generado.', 'labels = [$0]'], 'attribute', 1),
        item(['content', 'bloque · obligatorio', 'El cuerpo de cada bloque generado (usa <etiqueta>.value).', 'content {\n  $0\n}', true], 'block', 0, true),
      ];
      break;
    case 'static': {
      const st = STATIC[lv.name];
      items = [
        ...(st.attrs || []).map((s) => item(s, 'attribute', st.required?.includes(s[0]) ? 0 : 1, st.required?.includes(s[0]))),
        ...(st.blocks || []).map((s) => item(s, 'block', 2)),
      ];
      break;
    }
    case 'module': {
      items = MODULE_META.map((s) => item(s, 'keyword', s[0] === 'source' ? 0 : 3, s[0] === 'source'));
      const dir = ctx.moduleDir(literal(ctx.src, attrOf(lv.node, 'source')));
      if (dir !== undefined) {
        for (const [name, v] of ctx.outline(dir).variables) {
          const required = v.default === undefined;
          items.push({
            label: name,
            kind: 'attribute',
            detail: `${v.type ?? 'any'} · entrada del módulo${required ? ' · obligatoria' : ''}`,
            doc: v.description,
            insert: v.type === 'string' ? `${name} = "$1"` : `${name} = $0`,
            required,
            group: required ? 0 : 1,
          });
        }
      }
      break;
    }
    case 'provider':
      items = [
        ...(lv.block ? schemaBodyItems(lv.block) : []),
        item(['alias', 'string', 'Nombre de esta configuración alternativa (provider = aws.alias).', 'alias = "$1"'], 'keyword', 3),
      ];
      break;
    case 'required_providers': {
      const idx = ctx.req.schemas.indexes();
      const names = new Set([...ctx.req.schemas.bundled(), ...idx.map((i) => i.source)].filter((s) => s !== BUILTIN_SOURCE));
      for (const source of names) {
        const name = source.split('/').pop()!;
        const version = idx.find((i) => i.source === source)?.version;
        const constraint = version ? `\n  version = "~> ${version.split('.').slice(0, 2).join('.')}"` : '';
        items.push({ label: name, kind: 'provider', detail: source, insert: `${name} = {\n  source  = "${source}"${constraint}\n}`, group: 1 });
      }
      break;
    }
    default:
      return undefined;
  }
  // Leave out arguments already set in this block (they can't repeat).
  const set = new Set(f.node.attrs.filter((a) => a.nameStart !== w.from).map((a) => a.name));
  items = items.filter((it) => !(it.kind !== 'block' && set.has(it.label)));
  // Completing a name that already has " = …" or " {" after it: insert the name only.
  const eol = ctx.src.indexOf('\n', w.to);
  const after = ctx.src.slice(w.to, eol < 0 ? undefined : eol);
  if (/^\s*[={"]/.test(after)) items = items.map((it) => ({ ...it, insert: it.label, retrigger: false }));
  return { from: w.from, to: w.to, items: rank(items, w.prefix) };
}

function completeLabel(ctx: Ctx, f: Extract<Frame, { t: 'string' }>): CompletionResult | undefined {
  const { src } = ctx;
  const from = f.start + 1;
  let to = ctx.req.offset;
  while (to < src.length && src[to] !== '"' && src[to] !== '\n') to++;
  const prefix = src.slice(from, ctx.req.offset);
  const lv = ctx.level();
  const { type, index } = f.label!;
  let items: CompletionItem[] = [];
  if (lv.k === 'root' && index === 0 && (type === 'resource' || type === 'data')) {
    items = typeItems(ctx, type, prefix);
  } else if (lv.k === 'root' && index === 0 && type === 'provider') {
    const names = new Set([...ctx.req.schemas.bundled(), ...ctx.req.schemas.indexes().map((i) => i.source)].filter((s) => s !== BUILTIN_SOURCE).map((s) => s.split('/').pop()!));
    for (const n of ctx.outline().requiredProviders.keys()) names.add(n);
    items = [...names].map((n) => ({ label: n, kind: 'provider' as const, detail: ctx.sourceFor(n), insert: n, group: 1 }));
  } else if (lv.k === 'static' && lv.name === 'terraform' && type === 'backend' && index === 0) {
    items = BACKENDS.map((b) => ({ label: b, kind: 'value' as const, detail: 'backend', insert: b, group: 1 }));
  } else if (lv.k === 'schema' && type === 'dynamic' && index === 0 && lv.block) {
    items = schemaBodyItems(lv.block)
      .filter((it) => it.kind === 'block')
      .map((it) => ({ ...it, insert: it.label, retrigger: false }));
  } else if (lv.k === 'static' && lv.name === 'check' && type === 'data' && index === 0) {
    items = typeItems(ctx, 'data', prefix);
  } else {
    return undefined;
  }
  return { from, to, items: rank(items, prefix) };
}

/** Resource or data source types: those of the loaded providers, plus a
 * "aws_…" entry for each provider that can still be downloaded. */
function typeItems(ctx: Ctx, kind: 'resource' | 'data', prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const loaded = new Set<string>();
  for (const idx of ctx.req.schemas.indexes()) {
    loaded.add(normalizeSource(idx.source));
    const detail = idx.source === BUILTIN_SOURCE ? 'integrado en Terraform' : idx.source;
    for (const t of kind === 'resource' ? idx.resources : idx.data_sources) items.push({ label: t, kind: 'type', detail, insert: t, group: 1 });
  }
  const typed = prefix.includes('_') ? prefix.slice(0, prefix.indexOf('_')) : undefined;
  for (const source of ctx.req.schemas.bundled()) {
    if (loaded.has(source)) continue;
    const name = source.split('/').pop()!;
    if (typed !== undefined && ctx.sourceFor(typed) === source) {
      ctx.req.schemas.load(source);
      ctx.pending = `Cargando los tipos de ${source}…`;
    } else if (typed === undefined) {
      items.push({ label: `${name}_`, kind: 'provider', detail: `${source} · ver sus tipos`, insert: `${name}_`, retrigger: true, group: 2 });
    }
  }
  return items;
}

function completeString(ctx: Ctx, f: Extract<Frame, { t: 'string' }>): CompletionResult | undefined {
  const { src, frames } = ctx;
  const from = f.start + 1;
  let to = ctx.req.offset;
  while (to < src.length && src[to] !== '"' && src[to] !== '\n') to++;
  const prefix = src.slice(from, ctx.req.offset);
  const parent = frames[frames.length - 2];
  const lv = ctx.level();
  let items: CompletionItem[] = [];
  if (lv.k === 'required_providers' && parent?.t === 'brace' && parent.key === 'source') {
    items = ctx.req.schemas.bundled().map((s) => ({ label: s, kind: 'provider' as const, detail: 'incluido en el playground', insert: s, group: 1 }));
  } else if (lv.k === 'module' && parent?.t === 'attr' && parent.node.name === 'source') {
    items = moduleDirs(ctx.req.files, ctx.dir).map((d) => ({ label: d, kind: 'value' as const, detail: 'módulo local', insert: d, group: 1 }));
  } else {
    return undefined;
  }
  return { from, to, items: rank(items, prefix) };
}

/** Keys of an object constructor whose attribute has a known object type. */
function completeKey(ctx: Ctx, f: Extract<Frame, { t: 'brace' }>): CompletionResult | undefined {
  const { frames } = ctx;
  const i = frames.indexOf(f);
  const [attr, attrAt] = innermost(frames, 'attr', i);
  if (!attr || frames.slice(attrAt + 1, i).some((x) => x.t !== 'brack')) return undefined;
  const w = ctx.word();
  if (/^[0-9]/.test(w.prefix)) return undefined;
  const lv = ctx.level();
  let items: CompletionItem[] = [];
  if (lv.k === 'required_providers') {
    items = [
      item(['source', 'string', 'Origen en el registry: "hashicorp/aws".', 'source = "$1"', true], 'attribute', 0),
      item(['version', 'string', 'Versiones admitidas: "~> 6.0".', 'version = "$1"'], 'attribute', 1),
      item(['configuration_aliases', 'list', 'Alias que el módulo espera recibir.', 'configuration_aliases = [$0]'], 'attribute', 2),
    ];
  } else {
    const body = lv.k === 'schema' || lv.k === 'provider' ? lv.block : undefined;
    const inner = innerBlock(body?.attributes?.[attr.node.name]);
    if (!inner) return undefined;
    items = schemaBodyItems(inner).filter((it) => it.kind === 'attribute');
  }
  return { from: w.from, to: w.to, items: rank(items, w.prefix) };
}

/** Steps of the traversal written right before pos: "aws_instance.web[0]." → ["aws_instance", "web", "[]"].
 * null when the expression before the dot can't be resolved (a call, a literal...). */
export function traversalBefore(src: string, pos: number): string[] | null {
  const steps: string[] = [];
  let i = pos;
  while (src[i - 1] === '.') {
    i--;
    if (src[i - 1] === '*') {
      steps.unshift('[]');
      i--;
      continue;
    }
    let idx = 0;
    while (src[i - 1] === ']') {
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (src[j] === ']') depth++;
        else if (src[j] === '[' && --depth === 0) break;
        else if (src[j] === '\n') return null;
      }
      if (j < 0) return null;
      i = j;
      idx++;
    }
    let j = i;
    while (j > 0 && IDENT.test(src[j - 1])) j--;
    if (j === i || /[0-9]/.test(src[j])) return null;
    for (let k = 0; k < idx; k++) steps.unshift('[]');
    steps.unshift(src.slice(j, i));
    i = j;
  }
  if (steps.length && /[)\]"'}]/.test(src[i - 1] ?? '')) return null;
  return steps;
}

function completeExpr(ctx: Ctx): CompletionResult | undefined {
  const w = ctx.word();
  if (/^[0-9]/.test(w.prefix)) return undefined;
  const steps = traversalBefore(ctx.src, w.from);
  if (steps === null) return undefined;
  const items = steps.length ? memberItems(ctx, steps) : rootItems(ctx);
  if (!items) return undefined;
  return { from: w.from, to: w.to, items: rank(items, w.prefix) };
}

/** Names of the dynamic blocks around the cursor: their iterators (name.key, name.value). */
function iterators(ctx: Ctx): string[] {
  return ctx.path
    .filter((b) => b.type === 'dynamic' && b.labels[0])
    .map((b) => {
      const it = attrOf(b, 'iterator');
      return it ? ctx.src.slice(it.valueStart, it.valueEnd).trim() : b.labels[0];
    });
}

/** The innermost frame of a kind, and its position. */
function innermost<T extends Frame['t']>(frames: Frame[], t: T, before = frames.length): [Extract<Frame, { t: T }> | undefined, number] {
  for (let k = before - 1; k >= 0; k--) if (frames[k].t === t) return [frames[k] as Extract<Frame, { t: T }>, k];
  return [undefined, -1];
}

function rootItems(ctx: Ctx): CompletionItem[] {
  const items: CompletionItem[] = [];
  const { frames } = ctx;
  const f = frames[frames.length - 1];
  const [attrFrame] = innermost(frames, 'attr');
  const direct = f.t === 'attr';
  const lv = ctx.level();
  const name = attrFrame?.node.name;

  // Values that fit this argument come first.
  if (attrFrame && lv.k === 'static' && lv.name === 'variable' && name === 'type') {
    return TYPES.map((s) => item(s, 'keyword', 0));
  }
  if (attrFrame && lv.k === 'static' && lv.name === 'lifecycle' && name === 'ignore_changes') {
    const schema = ctx.resourceSchema();
    const out: CompletionItem[] = direct ? [{ label: 'all', kind: 'value', detail: 'ignora todos los atributos', insert: 'all', group: 0 }] : [];
    if (schema) out.push(...memberItemsOf(schema).filter((it) => schema.blocks?.[it.label] || schema.attributes?.[it.label]?.optional || schema.attributes?.[it.label]?.required));
    return out;
  }
  if (attrFrame && direct && name === 'provider' && ((lv.k === 'schema' && lv.meta) || (lv.k === 'static' && lv.name === 'import'))) {
    const out = ctx.outline().providers.map((p) => ({
      label: p.alias ? `${p.name}.${p.alias}` : p.name,
      kind: 'provider' as const,
      detail: p.alias ? 'configuración con alias' : 'configuración por defecto',
      insert: p.alias ? `${p.name}.${p.alias}` : p.name,
      group: 0,
    }));
    if (out.length) return out;
  }
  if (attrFrame && direct) {
    let schemaAttr: SchemaAttribute | undefined;
    if (lv.k === 'schema' || lv.k === 'provider') schemaAttr = lv.block?.attributes?.[name!];
    const isBool =
      schemaAttr?.type === 'bool' ||
      (lv.k === 'static' && ['sensitive', 'nullable', 'ephemeral', 'create_before_destroy', 'prevent_destroy', 'destroy', 'use_lockfile', 'encrypt'].includes(name!));
    if (isBool) items.push({ label: 'true', kind: 'value', detail: 'bool', insert: 'true', group: 0 }, { label: 'false', kind: 'value', detail: 'bool', insert: 'false', group: 0 });
  }

  // References.
  items.push(...ROOTS.map((s) => item(s, 'reference', 1)));
  const top = ctx.path[0];
  if (top && attrOf(top, 'for_each')) items.push(item(['each', 'for_each', 'each.key y each.value de la instancia actual.', 'each.', true], 'reference', 1));
  if (top && attrOf(top, 'count')) items.push(item(['count', 'count', 'count.index: la posición de la instancia (0, 1, 2...).', 'count.', true], 'reference', 1));
  if (top?.type === 'resource' && ctx.path.some((b) => b.type === 'postcondition' || b.type === 'provisioner' || b.type === 'connection')) {
    items.push(item(['self', 'este recurso', 'Los atributos del propio recurso.', 'self.', true], 'reference', 1));
  }
  for (const it of iterators(ctx)) items.push(item([it, 'iterador de dynamic', `${it}.key y ${it}.value del elemento actual.`, `${it}.`, true], 'reference', 1));
  const types = new Set(ctx.outline().resources.map((r) => r.labels[0]));
  for (const t of types) items.push({ label: t, kind: 'reference', detail: 'recurso', insert: `${t}.`, retrigger: true, group: 1 });

  // Functions and literals.
  for (const [fn, info] of Object.entries(FUNCTIONS)) {
    const noArgs = /\(\)/.test(info.sig);
    items.push({ label: fn, kind: 'function', detail: info.sig, doc: info.doc, insert: noArgs ? `${fn}()` : `${fn}($0)`, group: 2 });
  }
  for (const lit of ['true', 'false', 'null']) items.push({ label: lit, kind: 'value', detail: 'literal', insert: lit, group: 3 });
  return items;
}

function memberItems(ctx: Ctx, steps: string[]): CompletionItem[] | undefined {
  const [head, ...rest] = steps;
  const o = ctx.outline();
  const names = (blocks: BlockNode[], type: string) =>
    blocks
      .filter((b) => b.labels[0] === type)
      .map((b) => ({
        label: b.labels[1],
        kind: 'reference' as const,
        detail: `${type}${attrOf(b, 'count') ? ' · count (usa [0])' : attrOf(b, 'for_each') ? ' · for_each (usa ["clave"])' : ''}`,
        insert: b.labels[1],
        group: 1,
      }));
  switch (head) {
    case 'var':
      if (rest.length) return undefined;
      return [...o.variables].map(([name, v]) => ({
        label: name,
        kind: 'reference',
        detail: v.type ?? 'variable',
        doc: [v.description, v.default !== undefined ? `Por defecto: ${v.default.length > 60 ? v.default.slice(0, 57) + '…' : v.default}` : undefined].filter(Boolean).join('\n') || undefined,
        insert: name,
        group: 1,
      }));
    case 'local':
      if (rest.length) return undefined;
      return [...o.locals].map(([name, value]) => ({
        label: name,
        kind: 'reference',
        detail: value.length > 48 ? value.slice(0, 45) + '…' : value,
        insert: name,
        group: 1,
      }));
    case 'module': {
      if (!rest.length) return [...o.modules.keys()].map((name) => ({ label: name, kind: 'reference', detail: 'módulo', insert: `${name}.`, retrigger: true, group: 1 }));
      if (rest.length !== 1) return undefined;
      const dir = ctx.moduleDir(o.modules.get(rest[0]));
      if (dir === undefined) return undefined;
      return [...ctx.outline(dir).outputs].map(([name, out]) => ({ label: name, kind: 'reference', detail: 'output del módulo', doc: out.description, insert: name, group: 1 }));
    }
    case 'data':
      if (!rest.length) {
        return [...new Set(o.data.map((b) => b.labels[0]))].map((t) => ({ label: t, kind: 'reference', detail: 'data source', insert: `${t}.`, retrigger: true, group: 1 }));
      }
      if (rest.length === 1) return names(o.data, rest[0]);
      return membersOf(ctx.typeSchema('data', rest[0]), rest.slice(2));
    case 'each':
      return rest.length
        ? undefined
        : [
            { label: 'key', kind: 'reference', detail: 'clave del elemento', insert: 'key', group: 1 },
            { label: 'value', kind: 'reference', detail: 'valor del elemento', insert: 'value', group: 1 },
          ];
    case 'count':
      return rest.length ? undefined : [{ label: 'index', kind: 'reference', detail: 'number', doc: 'Posición de la instancia: 0, 1, 2...', insert: 'index', group: 1 }];
    case 'path':
      return rest.length
        ? undefined
        : [
            { label: 'module', kind: 'reference', detail: 'string', doc: 'Carpeta del módulo actual.', insert: 'module', group: 1 },
            { label: 'root', kind: 'reference', detail: 'string', doc: 'Carpeta del módulo raíz.', insert: 'root', group: 1 },
            { label: 'cwd', kind: 'reference', detail: 'string', doc: 'Carpeta desde la que se ejecuta Terraform.', insert: 'cwd', group: 1 },
          ];
    case 'terraform':
      return rest.length ? undefined : [{ label: 'workspace', kind: 'reference', detail: 'string', doc: 'Nombre del workspace actual.', insert: 'workspace', group: 1 }];
    case 'self':
      return membersOf(ctx.resourceSchema(), rest);
  }
  if (iterators(ctx).includes(head) && !rest.length) {
    return [
      { label: 'key', kind: 'reference', detail: 'clave o índice', insert: 'key', group: 1 },
      { label: 'value', kind: 'reference', detail: 'valor del elemento', insert: 'value', group: 1 },
    ];
  }
  if (o.resources.some((b) => b.labels[0] === head)) {
    if (!rest.length) return names(o.resources, head);
    return membersOf(ctx.typeSchema('resource', head), rest.slice(1));
  }
  return undefined;
}

function membersOf(schema: SchemaBlock | undefined, steps: string[]): CompletionItem[] | undefined {
  const b = walk(schema, steps);
  return b ? memberItemsOf(b) : undefined;
}
