// Entry point of the simulated shell + AWS CLI.
//   run(line, state, now) → { output, exitCode, state }
// The state is never mutated: every command works on a copy, which is only
// kept when the command succeeds (or partially succeeds, like `aws s3 cp`).

import jmespath from 'jmespath';
import type { Args, Ctx, Op, Opt, Service } from './spec';
import { apiName } from './spec';
import type { Identity, PlaygroundState } from './types';
import { CONFIGURE_SUBCOMMANDS, GLOBAL_OPTS, SERVICES, opOptions } from './registry';
import { awsHelp, opHelp, serviceHelp, SHELL_HELP } from './help';
import { coerce, parseShorthand, ShorthandError } from './shorthand';
import { formatJson, formatTable, formatText, formatYaml } from './format';
import { evaluate } from './iam-eval';
import { resolveIdentity } from './credentials';
import { findPolicy } from './services/iam';
import { advanceEc2 } from './services/ec2';
import { HOME, ec2Region, isRegion } from './seed';
import { CliError, ServiceError, secretChars, serviceErrorText } from './util';
import { shellSplit } from '../../shared/shell';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface RunResult {
  output: string;
  exitCode: number;
  state: PlaygroundState;
  /** The UI should clear the screen. */
  clear?: boolean;
  /** Failed AWS call: keep the state from before the command. */
  discard?: boolean;
}

export const VERSION = 'aws-cli/2.31.3 Python/3.13.7 Linux/6.8.0 exe/x86_64.playground prompt/off';

const usage = (msg: string) =>
  new CliError(
    `\nusage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\nTo see help text, you can run:\n\n  aws help\n  aws <command> help\n  aws <command> <subcommand> help\n\naws: error: ${msg}`,
    252,
  );

function invalidChoice(what: string, choices: string[]) {
  const rows: string[] = [];
  for (let i = 0; i < choices.length; i += 2) rows.push(choices[i].padEnd(36) + (choices[i + 1] ? `| ${choices[i + 1]}` : ''));
  return usage(`argument ${what}: Invalid choice, valid choices are:\n\n${rows.join('\n')}`);
}

// ── local file system ────────────────────────────────────────────────

export function resolvePath(st: PlaygroundState, p: string): string {
  let path = p;
  if (path === '~' || path.startsWith('~/')) path = HOME + path.slice(1);
  if (!path.startsWith('/')) path = st.cwd.replace(/\/$/, '') + '/' + path;
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function isDir(st: PlaygroundState, abs: string): boolean {
  if (abs === '/' || abs === HOME || abs === HOME + '/.aws') return true;
  const prefix = abs.replace(/\/$/, '') + '/';
  return Object.keys(st.files).some((f) => f.startsWith(prefix)) || HOME.startsWith(prefix);
}

/** ~/.aws/config and ~/.aws/credentials, rendered from the profiles. */
function awsFile(st: PlaygroundState, abs: string): string | undefined {
  const entries = Object.entries(st.profiles);
  if (abs === HOME + '/.aws/credentials') {
    return entries
      .filter(([, p]) => p.aws_access_key_id)
      .map(([n, p]) => `[${n}]\naws_access_key_id = ${p.aws_access_key_id}\naws_secret_access_key = ${p.aws_secret_access_key ?? ''}\n`)
      .join('\n');
  }
  if (abs === HOME + '/.aws/config') {
    return entries
      .map(([n, p]) => {
        const keys = (['region', 'output', 'role_arn', 'source_profile', 'role_session_name'] as const).filter((k) => p[k]);
        return `[${n === 'default' ? 'default' : 'profile ' + n}]\n${keys.map((k) => `${k} = ${p[k]}`).join('\n')}\n`;
      })
      .join('\n');
  }
  return undefined;
}

export function readFile(st: PlaygroundState, abs: string): string | undefined {
  return st.files[abs] ?? awsFile(st, abs);
}

function listDir(st: PlaygroundState, abs: string): string[] {
  const prefix = abs === '/' ? '/' : abs + '/';
  const names = new Set<string>();
  for (const f of Object.keys(st.files)) {
    if (!f.startsWith(prefix)) continue;
    const rest = f.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    names.add(slash >= 0 ? rest.slice(0, slash + 1) : rest);
  }
  if (abs === HOME) names.add('.aws/');
  if (abs === HOME + '/.aws') {
    names.add('config');
    names.add('credentials');
  }
  if (HOME.startsWith(prefix) && abs !== HOME) names.add(HOME.slice(prefix.length).split('/')[0] + '/');
  return [...names].sort();
}

// ── shell parsing ────────────────────────────────────────────────────

/** $VAR and ${VAR} expansion, skipping single-quoted text. */
function expand(line: string, env: Record<string, string>): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      if (quote === "'" || c !== '$') {
        out += c;
        continue;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '$') {
      const m = /^\$(?:\{(\w+)\}|(\w+))/.exec(line.slice(i));
      if (m) {
        out += env[m[1] ?? m[2]] ?? (m[2] === 'HOME' || m[1] === 'HOME' ? HOME : '');
        i += m[0].length - 1;
        continue;
      }
    }
    out += c;
  }
  return out;
}

function hasUnquoted(line: string, ch: string): boolean {
  let quote: string | null = null;
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ch) return true;
  }
  return false;
}

/** Splits "cmd … > file" / ">> file". */
function redirection(tokens: string[]): { tokens: string[]; file?: string; append?: boolean } {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = /^(>>?)(.*)$/.exec(t);
    if (!m) continue;
    const file = m[2] || tokens[i + 1];
    if (!file) throw new CliError("bash: syntax error near unexpected token `newline'", 2);
    return { tokens: tokens.slice(0, i), file, append: m[1] === '>>' };
  }
  return { tokens };
}

// ── identity for the prompt (no side effects) ────────────────────────

export function describeSession(st: PlaygroundState): { who: string; region?: string } {
  const env = st.env;
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  const byKey = (key?: string): string => {
    if (!key) return 'sin-credenciales';
    const user = Object.values(st.iam.users).find((u) => u.accessKeys.some((k) => k.AccessKeyId === key));
    if (user) return user.UserName;
    const s = st.sessions[key];
    return s?.kind === 'role' ? `rol:${s.roleName}` : s?.userName ?? '¿?';
  };
  if (env.AWS_ACCESS_KEY_ID) return { who: byKey(env.AWS_ACCESS_KEY_ID), region };
  const name = env.AWS_PROFILE ?? 'default';
  const p = st.profiles[name];
  if (!p) return { who: `perfil ${name}?`, region };
  const who = p.role_arn ? `rol:${p.role_arn.split('/').pop()}` : byKey(p.aws_access_key_id);
  return { who: name === 'default' ? who : `${who} (${name})`, region: region ?? p.region };
}

const CONFIGURE_STEPS = [
  { label: 'AWS Access Key ID', key: 'aws_access_key_id', mask: true },
  { label: 'AWS Secret Access Key', key: 'aws_secret_access_key', mask: true },
  { label: 'Default region name', key: 'region', mask: false },
  { label: 'Default output format', key: 'output', mask: false },
] as const;

export function promptText(st: PlaygroundState): string {
  if (st.prompt) {
    const step = CONFIGURE_STEPS[st.prompt.step];
    const cur = st.profiles[st.prompt.profile]?.[step.key];
    const shown = cur ? (step.mask ? '*'.repeat(16) + cur.slice(-4) : cur) : 'None';
    return `${step.label} [${shown}]: `;
  }
  const { who, region } = describeSession(st);
  const dir = st.cwd === HOME ? '~' : st.cwd.startsWith(HOME + '/') ? '~' + st.cwd.slice(HOME.length) : st.cwd;
  return `${who}@${region ?? 'sin-región'} ${dir} $ `;
}

// ── main entry ───────────────────────────────────────────────────────

/** Runs every $(…) in the line, left to right, and splices in its output. */
function substitute(line: string, st: PlaygroundState, now: Date, depth: number): { line: string; state: PlaygroundState; failed?: RunResult } {
  let out = '';
  let quote: string | null = null;
  let state = st;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      out += c;
      continue;
    }
    if (c === "'" && !quote) quote = "'";
    else if (c === '"') quote = quote === '"' ? null : '"';
    else if (c === '$' && line[i + 1] === '(') {
      let level = 1;
      let j = i + 2;
      for (; j < line.length && level; j++) {
        if (line[j] === '(') level++;
        else if (line[j] === ')') level--;
      }
      if (!level) {
        if (depth > 3) throw new CliError('bash: demasiadas $( ) anidadas', 1);
        const r = run(line.slice(i + 2, j - 1), state, now, depth + 1);
        if (r.exitCode !== 0) return { line, state, failed: r };
        state = r.state;
        out += r.output.replace(/\n+$/, '');
        i = j - 1;
        continue;
      }
    }
    out += c;
  }
  return { line: out, state };
}

export function run(line: string, st0: PlaygroundState, now: Date = new Date(), depth = 0): RunResult {
  let st: PlaygroundState = structuredClone(st0);
  try {
    if (st.prompt) return configureAnswer(line, st);
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return { output: '', exitCode: 0, state: st0 };
    if (trimmed.includes('$(')) {
      const sub = substitute(trimmed, st0, now, depth);
      if (sub.failed) return sub.failed;
      trimmed = sub.line;
      st0 = sub.state;
      st = structuredClone(st0);
    }
    if (hasUnquoted(trimmed, '|')) {
      return { output: 'bash: las tuberías (|) no están disponibles en el playground. Usa --query y --output para filtrar.\n', exitCode: 1, state: st0 };
    }
    if (hasUnquoted(trimmed, ';') || hasUnquoted(trimmed, '&')) {
      return { output: 'bash: ";" y "&&" no están disponibles: ejecuta los comandos de uno en uno.\n', exitCode: 1, state: st0 };
    }
    const r = redirection(shellSplit(expand(trimmed, st.env)));
    let res = dispatch(r.tokens, st, now);
    if (res.discard) res = { output: res.output, exitCode: res.exitCode, state: st0 };
    if (r.file && res.exitCode === 0 && !res.clear) {
      const abs = resolvePath(res.state, r.file);
      if (isDir(res.state, abs)) return { output: `bash: ${r.file}: Is a directory\n`, exitCode: 1, state: res.state };
      const prev = r.append ? res.state.files[abs] ?? '' : '';
      const state = res.state === st0 ? structuredClone(st0) : res.state;
      state.files[abs] = prev + res.output;
      return { output: '', exitCode: 0, state };
    }
    return res;
  } catch (e) {
    if (e instanceof CliError) return { output: e.message + '\n', exitCode: e.exitCode, state: st0 };
    throw e;
  }
}

const BUILTINS = ['aws', 'ls', 'cd', 'pwd', 'cat', 'echo', 'touch', 'mkdir', 'rm', 'export', 'unset', 'env', 'printenv', 'whoami', 'help', 'clear', 'history'];
export const SHELL_COMMANDS = BUILTINS;

function dispatch(tokens: string[], st: PlaygroundState, now: Date): RunResult {
  const [cmd, ...args] = tokens;
  const ok = (output = ''): RunResult => ({ output: output && !output.endsWith('\n') ? output + '\n' : output, exitCode: 0, state: st });
  const fail = (output: string, code = 1): RunResult => ({ output: output + '\n', exitCode: code, state: st });

  const assign = /^([A-Za-z_]\w*)=(.*)$/s.exec(cmd ?? '');
  if (assign && !args.length) {
    st.env[assign[1]] = assign[2];
    return ok();
  }

  switch (cmd) {
    case 'aws':
      return runAws(args, st, now);
    case 'help':
      return ok(SHELL_HELP);
    case 'clear':
      return { output: '', exitCode: 0, state: st, clear: true };
    case 'pwd':
      return ok(st.cwd);
    case 'whoami':
      return ok('alumno');
    case 'cd': {
      const target = resolvePath(st, args[0] ?? '~');
      if (!isDir(st, target)) return fail(`bash: cd: ${args[0]}: No such file or directory`);
      st.cwd = target;
      return ok();
    }
    case 'ls': {
      const paths = args.filter((a) => !a.startsWith('-'));
      const out: string[] = [];
      for (const p of paths.length ? paths : ['.']) {
        const abs = resolvePath(st, p);
        if (readFile(st, abs) !== undefined && !abs.endsWith('/')) {
          out.push(p);
          continue;
        }
        if (!isDir(st, abs)) return fail(`ls: cannot access '${p}': No such file or directory`, 2);
        if (paths.length > 1) out.push(`${p}:`);
        out.push(listDir(st, abs).filter((n) => args.includes('-a') || !n.startsWith('.')).join('  '));
      }
      return ok(out.filter((x) => x !== '').join('\n'));
    }
    case 'cat': {
      if (!args.length) return fail('cat: falta el nombre del fichero');
      const out: string[] = [];
      for (const p of args) {
        const abs = resolvePath(st, p);
        const c = readFile(st, abs);
        if (c === undefined) return fail(isDir(st, abs) ? `cat: ${p}: Is a directory` : `cat: ${p}: No such file or directory`);
        out.push(c);
      }
      return { output: out.join(''), exitCode: 0, state: st };
    }
    case 'echo': {
      const noNewline = args[0] === '-n';
      const text = (noNewline ? args.slice(1) : args).join(' ');
      return { output: text + (noNewline ? '' : '\n'), exitCode: 0, state: st };
    }
    case 'touch':
      for (const p of args) {
        const abs = resolvePath(st, p);
        if (st.files[abs] === undefined) st.files[abs] = '';
      }
      return ok();
    case 'mkdir':
      for (const p of args.filter((a) => !a.startsWith('-'))) {
        const abs = resolvePath(st, p);
        if (!isDir(st, abs)) st.files[abs + '/.keep'] = '';
      }
      return ok();
    case 'rm': {
      const recursive = args.some((a) => /^-\w*r/i.test(a));
      for (const p of args.filter((a) => !a.startsWith('-'))) {
        const abs = resolvePath(st, p);
        if (st.files[abs] !== undefined) delete st.files[abs];
        else if (isDir(st, abs)) {
          if (!recursive) return fail(`rm: cannot remove '${p}': Is a directory`);
          for (const f of Object.keys(st.files)) if (f.startsWith(abs + '/')) delete st.files[f];
        } else return fail(`rm: cannot remove '${p}': No such file or directory`);
      }
      return ok();
    }
    case 'export':
      if (!args.length) return ok(Object.entries(st.env).map(([k, v]) => `declare -x ${k}="${v}"`).join('\n'));
      for (const a of args) {
        const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a);
        if (m) st.env[m[1]] = m[2];
        else if (!/^[A-Za-z_]\w*$/.test(a)) return fail(`bash: export: \`${a}': not a valid identifier`);
      }
      return ok();
    case 'unset':
      for (const a of args) delete st.env[a];
      return ok();
    case 'env':
    case 'printenv': {
      const base: Record<string, string> = { HOME, USER: 'alumno', SHELL: '/bin/bash', PWD: st.cwd, ...st.env };
      if (cmd === 'printenv' && args[0]) return base[args[0]] !== undefined ? ok(base[args[0]]) : { output: '', exitCode: 1, state: st };
      return ok(Object.entries(base).map(([k, v]) => `${k}=${v}`).join('\n'));
    }
    default:
      return fail(`bash: ${cmd}: command not found\n(el playground tiene "aws" y unos pocos comandos básicos; escribe "help")`, 127);
  }
}

// ── aws ──────────────────────────────────────────────────────────────

interface Globals {
  region?: string;
  output?: string;
  query?: string;
  profile?: string;
  [k: string]: string | boolean | undefined;
}

function parseGlobals(args: string[]): { globals: Globals; rest: string[] } {
  const globals: Globals = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq > 0 ? t.slice(2, eq) : t.slice(2);
      const spec = GLOBAL_OPTS[name];
      if (spec) {
        if (spec.type === 'bool') {
          globals[name] = true;
          continue;
        }
        const value = eq > 0 ? t.slice(eq + 1) : args[++i];
        if (value === undefined) throw usage(`argument --${name}: expected one argument`);
        if (spec.values && !spec.values.includes(value)) throw invalidChoice(`--${name}`, spec.values);
        globals[name] = value;
        continue;
      }
    }
    rest.push(t);
  }
  return { globals, rest };
}

const isOptionToken = (t: string) => t.startsWith('--') && t.length > 2;
const pascal = (name: string) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');

function readParam(st: PlaygroundState, name: string, value: string): string {
  const m = /^(fileb?):\/\/(.*)$/.exec(value);
  if (!m) return value;
  const content = readFile(st, resolvePath(st, m[2]));
  if (content === undefined) {
    throw new CliError(`\nError parsing parameter '--${name}': Unable to load paramfile ${value}: [Errno 2] No such file or directory: '${m[2]}'`, 252);
  }
  return content;
}

function parseStruct(st: PlaygroundState, o: Opt, raw: string): Json {
  const text = readParam(st, o.name, raw).trim();
  let v: Json;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      v = JSON.parse(text);
    } catch (e) {
      throw new CliError(`\nError parsing parameter '--${o.name}': Invalid JSON: ${(e as Error).message}\nJSON received: ${text}`, 252);
    }
  } else {
    try {
      v = parseShorthand(text);
    } catch (e) {
      if (e instanceof ShorthandError) throw new CliError(`\nError parsing parameter '--${o.name}': ${e.message}`, 252);
      throw e;
    }
  }
  return o.coerce ? coerce(v) : v;
}

function convert(st: PlaygroundState, o: Opt, values: string[]): Json {
  const v = values[0];
  switch (o.type) {
    case 'int': {
      if (!/^-?\d+$/.test(v)) {
        throw new CliError(`\nParameter validation failed:\nInvalid type for parameter ${pascal(o.name)}, value: ${v}, type: <class 'str'>, valid types: <class 'int'>`, 252);
      }
      return Number(v);
    }
    case 'strings': {
      if (values.length === 1 && v.trim().startsWith('[')) {
        try {
          return JSON.parse(v);
        } catch (e) {
          throw new CliError(`\nError parsing parameter '--${o.name}': Invalid JSON: ${(e as Error).message}`, 252);
        }
      }
      return values;
    }
    case 'struct':
      return parseStruct(st, o, v);
    case 'structs': {
      if (values.length === 1) {
        const parsed = parseStruct(st, o, v);
        return Array.isArray(parsed) ? parsed : [parsed];
      }
      return values.map((x) => parseStruct(st, o, x));
    }
    case 'doc':
    case 'blob':
      return readParam(st, o.name, v);
    default:
      return readParam(st, o.name, v);
  }
}

function parseOpArgs(st: PlaygroundState, service: Service, op: Op, tokens: string[]): Args {
  const opts = opOptions(service, op.opts);
  const a: Args = { _: [] };
  const unknown: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isOptionToken(t)) {
      a._.push(t);
      continue;
    }
    let name = t.slice(2);
    let inline: string | undefined;
    const eq = name.indexOf('=');
    if (eq > 0) {
      inline = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    let o = opts.find((x) => x.name === name);
    let negated = false;
    if (!o && name.startsWith('no-')) {
      o = opts.find((x) => x.name === name.slice(3) && x.type === 'bool');
      negated = !!o;
    }
    if (!o) {
      unknown.push(t);
      while (i + 1 < tokens.length && !isOptionToken(tokens[i + 1])) unknown.push(tokens[++i]);
      continue;
    }
    if (o.type === 'bool') {
      a[o.name] = !negated;
      continue;
    }
    const values: string[] = inline !== undefined ? [inline] : [];
    if (inline === undefined) {
      while (i + 1 < tokens.length && !isOptionToken(tokens[i + 1])) {
        values.push(tokens[++i]);
        if (o.type !== 'strings' && o.type !== 'structs') break;
      }
    }
    if (!values.length) throw usage(`argument --${o.name}: expected one argument`);
    const value = convert(st, o, values);
    if (o.choices && typeof value === 'string' && !o.choices.includes(value)) {
      throw usage(`argument --${o.name}: Invalid choice: '${value}' (choose from ${o.choices.map((c) => `'${c}'`).join(', ')})`);
    }
    a[o.name] = value;
  }
  const positional = op.positional || [];
  if (a._.length > positional.length) unknown.push(...a._.slice(positional.length));
  if (unknown.length) throw usage(`Unknown options: ${unknown.join(', ')}`);
  const missing = [
    ...positional.filter((p, i) => p.required && a._[i] === undefined).map((p) => p.name),
    ...opts.filter((o) => o.required && a[o.name] === undefined).map((o) => `--${o.name}`),
  ];
  if (missing.length) throw usage(`the following arguments are required: ${missing.join(', ')}`);
  return a;
}

/** IAM check for the caller; only assumed roles are restricted. */
function authorizer(st: PlaygroundState, service: string) {
  return (id: Identity, action: string, resources: string[]) => {
    if (id.kind !== 'role') return;
    const role = st.iam.roles[id.roleName];
    const docs = role ? [...role.attached.map((a) => findPolicy(st, a)?.document ?? ''), ...Object.values(role.inline)] : [];
    const decision = evaluate(docs, action, resources);
    if (decision === 'allow') return;
    const res = resources[0] ?? '*';
    const why = decision === 'explicit-deny' ? 'with an explicit deny in an identity-based policy' : `because no identity-based policy allows the ${action} action`;
    if (service === 'ec2') {
      throw new ServiceError(
        'UnauthorizedOperation',
        `You are not authorized to perform this operation. User: ${id.arn} is not authorized to perform: ${action} on resource: ${res} ${why}. Encoded authorization failure message: ${secretChars(st, 48)}`,
      );
    }
    const shown = service.startsWith('s3') ? `"${res}"` : res;
    throw new ServiceError('AccessDenied', `User: ${id.arn} is not authorized to perform: ${action} on resource: ${shown} ${why}`);
  };
}

/** Removes internal fields (_next, _public…) before printing. */
function strip(v: Json): Json {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, strip(x)]));
  }
  return v;
}

function format(data: Json, output: string, title: string): string {
  if (output === 'text') return formatText(data);
  if (output === 'table') return formatTable(data, title);
  if (output === 'yaml' || output === 'yaml-stream') return formatYaml(data);
  return formatJson(data);
}

function runAws(args: string[], st: PlaygroundState, now: Date): RunResult {
  if (args.includes('--version')) return { output: VERSION + '\n', exitCode: 0, state: st };
  const { globals, rest } = parseGlobals(args);
  const [svcName, opName, ...opTokens] = rest;
  if (!svcName) throw usage('the following arguments are required: command');
  if (svcName === 'help') return { output: awsHelp(), exitCode: 0, state: st };
  if (svcName === 'configure') return configure(rest.slice(1), globals, st);
  const service = SERVICES.find((s) => s.name === svcName);
  if (!service) throw invalidChoice('command', [...SERVICES.map((s) => s.name), 'configure', 'help'].sort());
  if (!opName) throw usage('the following arguments are required: operation');
  if (opName === 'help') return { output: serviceHelp(service), exitCode: 0, state: st };
  const op = service.ops.find((o) => o.name === opName);
  if (!op) throw invalidChoice('operation', service.ops.map((o) => o.name).sort());
  if (opTokens[0] === 'help') return { output: opHelp(service, op), exitCode: 0, state: st };

  if (globals.query) {
    try {
      // Syntax check only (the untyped `compile` export of jmespath.js).
      (jmespath as unknown as { compile(q: string): unknown }).compile(globals.query);
    } catch (e) {
      throw usage(`argument --query: Bad value for --query ${globals.query}: ${(e as Error).message}`);
    }
  }

  const profileName = globals.profile ?? st.env.AWS_PROFILE ?? 'default';
  const profile = st.profiles[profileName];
  const region = globals.region ?? st.env.AWS_REGION ?? st.env.AWS_DEFAULT_REGION ?? profile?.region;
  const needsRegion = service.name === 'ec2' || service.name === 's3' || service.name === 's3api';
  if (needsRegion && !region) {
    throw new CliError('You must specify a region. You can also configure your region by running "aws configure".', 253);
  }
  if (region && !isRegion(region)) {
    const host = service.name.startsWith('s3') ? 's3' : service.name;
    throw new CliError(`\nCould not connect to the endpoint URL: "https://${host}.${region}.amazonaws.com/"`, 255);
  }
  const output = (globals.output ?? st.env.AWS_DEFAULT_OUTPUT ?? profile?.output ?? 'json') as string;

  const a = parseOpArgs(st, service, op, opTokens);
  const api = apiName(op);
  advanceEc2(st);

  const authorize = authorizer(st, service.name);
  let identity: Identity;
  try {
    identity = resolveIdentity(st, globals.profile, now, authorize).identity;
  } catch (e) {
    if (e instanceof ServiceError) {
      const code = service.name.startsWith('s3') && e.code === 'InvalidClientTokenId' ? 'InvalidAccessKeyId' : e.code;
      const msg = code === 'InvalidAccessKeyId' ? 'The AWS Access Key Id you provided does not exist in our records.' : e.message;
      return { output: `\n${serviceErrorText(new ServiceError(code, msg), api)}\n`, exitCode: 254, state: st, discard: true };
    }
    throw e;
  }

  const lines: string[] = [];
  const ctx: Ctx = {
    st,
    region: region ?? 'us-east-1',
    identity,
    now,
    service: service.name,
    api,
    authorize: (action, resources) => authorize(identity, action, Array.isArray(resources) ? resources : [resources ?? '*']),
    ec2: (r) => ec2Region(st, r ?? region ?? 'us-east-1', now),
    readLocal: (p) => readFile(st, resolvePath(st, p)),
    writeLocal: (p, c) => {
      st.files[resolvePath(st, p)] = c;
    },
    resolveLocal: (p) => resolvePath(st, p),
    print: (l) => lines.push(l),
    exitCode: 0,
    dryRun: !!a['dry-run'],
  };

  try {
    if (op.action) ctx.authorize(op.action, op.resource ? op.resource(a, ctx) : '*');
    if (ctx.dryRun && op.action) throw new ServiceError('DryRunOperation', 'Request would have succeeded, but DryRun flag is set.');
    let data = op.run(a, ctx);
    if (lines.length) return { output: lines.join('\n') + '\n', exitCode: ctx.exitCode, state: st };
    if (data === undefined || (data && typeof data === 'object' && !Array.isArray(data) && !Object.keys(data).length)) {
      return { output: '', exitCode: 0, state: st };
    }
    data = strip(data);
    if (globals.query) {
      try {
        data = jmespath.search(data, globals.query);
      } catch (e) {
        return { output: `\n${(e as Error).message}\n`, exitCode: 255, state: st };
      }
    }
    if ((data === null || data === undefined) && output === 'table') return { output: '', exitCode: 0, state: st };
    return { output: format(data ?? null, output, api), exitCode: 0, state: st };
  } catch (e) {
    if (e instanceof ServiceError) {
      const prefix = lines.length ? lines.join('\n') + '\n' : '';
      return { output: `${prefix}\n${serviceErrorText(e, api)}\n`, exitCode: 254, state: st, discard: !lines.length };
    }
    throw e;
  }
}

// ── aws configure ────────────────────────────────────────────────────

const CONFIG_KEYS = ['aws_access_key_id', 'aws_secret_access_key', 'region', 'output', 'role_arn', 'source_profile', 'role_session_name'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

function configure(args: string[], globals: Globals, st: PlaygroundState): RunResult {
  const profile = globals.profile ?? st.env.AWS_PROFILE ?? 'default';
  const [sub, ...rest] = args;
  const ok = (output = ''): RunResult => ({ output: output && !output.endsWith('\n') ? output + '\n' : output, exitCode: 0, state: st });
  if (!sub) {
    st.prompt = { profile, step: 0 };
    return ok();
  }
  if (sub === 'help') {
    return ok(`aws configure [--profile <perfil>]         pregunta claves, región y formato
aws configure list [--profile <perfil>]    muestra de dónde sale cada valor
aws configure list-profiles                lista los perfiles
aws configure get <clave> [--profile p]    lee un valor (region, output, role_arn…)
aws configure set <clave> <valor> [--profile p]
Claves: ${CONFIG_KEYS.join(', ')}
Un perfil con role_arn y source_profile asume ese rol automáticamente.`);
  }
  if (!CONFIGURE_SUBCOMMANDS.includes(sub)) throw invalidChoice('operation', [...CONFIGURE_SUBCOMMANDS, 'help']);
  if (sub === 'list-profiles') return ok(Object.keys(st.profiles).join('\n'));
  if (sub === 'list') {
    const p = st.profiles[profile];
    if (!p && profile !== 'default') throw new CliError(`The config profile (${profile}) could not be found`, 253);
    const env = st.env;
    const fromEnv = !globals.profile && !!env.AWS_ACCESS_KEY_ID;
    const mask = (v?: string) => (v ? '*'.repeat(16) + v.slice(-4) : '<not set>');
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    const rows: [string, string, string, string][] = [
      ['profile', profile === 'default' && !globals.profile && !env.AWS_PROFILE ? '<not set>' : profile, globals.profile ? 'manual' : env.AWS_PROFILE ? 'env' : 'None', globals.profile ? '--profile' : env.AWS_PROFILE ? 'AWS_PROFILE' : 'None'],
      fromEnv ? ['access_key', mask(env.AWS_ACCESS_KEY_ID), 'env', ''] : ['access_key', mask(p?.aws_access_key_id), p?.aws_access_key_id ? 'shared-credentials-file' : 'None', p?.aws_access_key_id ? '' : 'None'],
      fromEnv ? ['secret_key', mask(env.AWS_SECRET_ACCESS_KEY), 'env', ''] : ['secret_key', mask(p?.aws_secret_access_key), p?.aws_secret_access_key ? 'shared-credentials-file' : 'None', p?.aws_secret_access_key ? '' : 'None'],
      region ? ['region', region, 'env', env.AWS_REGION ? 'AWS_REGION' : 'AWS_DEFAULT_REGION'] : ['region', p?.region ?? '<not set>', p?.region ? 'config-file' : 'None', p?.region ? '~/.aws/config' : 'None'],
    ];
    const head = `      Name                    Value             Type    Location\n      ----                    -----             ----    --------`;
    return ok(head + '\n' + rows.map(([n, v, t, l]) => `${n.padStart(10)} ${v.padStart(24)} ${t.padStart(16)}    ${l}`).join('\n'));
  }
  if (sub === 'get') {
    const key = (rest[0] ?? '').replace(/^(default|profile\.\w+)\./, '') as ConfigKey;
    const v = st.profiles[profile]?.[key];
    return v ? ok(v) : { output: '', exitCode: 1, state: st };
  }
  // set
  const [rawKey, value] = rest;
  if (!rawKey || value === undefined) throw usage('the following arguments are required: varname, value');
  const key = rawKey.replace(/^(default|profile\.[\w-]+)\./, '') as ConfigKey;
  const target = rawKey.startsWith('profile.') ? rawKey.split('.')[1] : profile;
  if (!CONFIG_KEYS.includes(key)) {
    throw new CliError(`El playground solo entiende estas claves: ${CONFIG_KEYS.join(', ')}`, 252);
  }
  st.profiles[target] = { ...st.profiles[target], [key]: value };
  return ok();
}

function configureAnswer(line: string, st: PlaygroundState): RunResult {
  const prompt = st.prompt!;
  const step = CONFIGURE_STEPS[prompt.step];
  const value = line.trim();
  if (value) st.profiles[prompt.profile] = { ...st.profiles[prompt.profile], [step.key]: value };
  else st.profiles[prompt.profile] = { ...st.profiles[prompt.profile] };
  st.prompt = prompt.step + 1 < CONFIGURE_STEPS.length ? { ...prompt, step: prompt.step + 1 } : undefined;
  return { output: '', exitCode: 0, state: st };
}

