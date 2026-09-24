import type { Args, Ctx, Service } from '../spec';
import { opt, req } from '../spec';
import type { Bucket, PublicAccessBlock, S3Object } from '../types';
import { TAKEN_BUCKETS } from '../seed';
import { validatePolicyDocument } from '../iam-eval';
import { asArray, CliError, contentType, digest, err, hexChars, humanSize, iso, localStamp, ServiceError, serviceErrorText } from '../util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── shared bucket helpers ────────────────────────────────────────────

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function validBucketName(name: string): boolean {
  return BUCKET_RE.test(name) && !name.includes('..') && !/^\d+\.\d+\.\d+\.\d+$/.test(name) && !name.startsWith('xn--');
}

const invalidPath = () => new CliError('Error: Invalid argument type', 252);

const bucketArn = (b: string) => `arn:aws:s3:::${b}`;
const objectArn = (b: string, k: string) => `arn:aws:s3:::${b}/${k}`;

/** ctx.authorize, naming `api` in the error. */
function allow(ctx: Ctx, action: string, resource: string, api: string) {
  try {
    ctx.authorize(action, resource);
  } catch (e) {
    if (e instanceof ServiceError && !e.api) e.api = api;
    throw e;
  }
}

function bucket(ctx: Ctx, name: string, api: string): Bucket {
  const b = ctx.st.s3[name];
  if (!b) throw err('NoSuchBucket', 'The specified bucket does not exist', api);
  return b;
}

function createBucket(ctx: Ctx, name: string, region: string): Bucket {
  if (!validBucketName(name)) throw err('InvalidBucketName', 'The specified bucket is not valid.', 'CreateBucket');
  if (ctx.st.s3[name]) {
    throw err('BucketAlreadyOwnedByYou', 'Your previous request to create the named bucket succeeded and you already own it.', 'CreateBucket');
  }
  if (TAKEN_BUCKETS.has(name)) {
    throw err('BucketAlreadyExists', 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.', 'CreateBucket');
  }
  const b: Bucket = {
    Name: name,
    CreationDate: iso(ctx.now),
    region,
    // New buckets block public access by default (AWS, April 2023).
    publicAccessBlock: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
    objects: {},
  };
  ctx.st.s3[name] = b;
  return b;
}

function putObject(ctx: Ctx, b: Bucket, key: string, body: string, type?: string): S3Object {
  const o: S3Object = {
    Key: key,
    body,
    Size: new TextEncoder().encode(body).length,
    ETag: `"${digest(body)}"`,
    LastModified: iso(ctx.now),
    ContentType: type ?? contentType(key),
    ...(b.versioning === 'Enabled' ? { VersionId: hexChars(ctx.st, 32) } : {}),
  };
  b.objects[key] = o;
  return o;
}

function isPublicPolicy(policy: string): boolean {
  try {
    const d = JSON.parse(policy);
    return asArray<Json>(d.Statement).some(
      (s) => s.Effect === 'Allow' && (s.Principal === '*' || asArray(s.Principal?.AWS).includes('*')),
    );
  } catch {
    return false;
  }
}

const sortedKeys = (b: Bucket, prefix = '') =>
  Object.keys(b.objects)
    .filter((k) => k.startsWith(prefix))
    .sort();

// ── s3:// paths and local paths ──────────────────────────────────────

interface S3Path {
  bucket: string;
  key: string;
}

function s3Path(p: string): S3Path | undefined {
  const m = /^s3:\/\/([^/]*)\/?(.*)$/.exec(p);
  return m ? { bucket: m[1], key: m[2] } : undefined;
}

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

function localFiles(ctx: Ctx, dir: string): string[] {
  const base = ctx.resolveLocal(dir).replace(/\/$/, '') + '/';
  return Object.keys(ctx.st.files)
    .filter((f) => f.startsWith(base) && !f.endsWith('/.keep'))
    .map((f) => f.slice(base.length))
    .sort();
}

function isLocalDir(ctx: Ctx, p: string): boolean {
  const abs = ctx.resolveLocal(p).replace(/\/$/, '') + '/';
  return abs === '/' || Object.keys(ctx.st.files).some((f) => f.startsWith(abs));
}

const joinKey = (prefix: string, rel: string) => (prefix && !prefix.endsWith('/') ? prefix + '/' : prefix) + rel;
const joinLocal = (dir: string, rel: string) => (dir.endsWith('/') ? dir : dir + '/') + rel;

// ── aws s3 (high level) ──────────────────────────────────────────────

function fail(ctx: Ctx, verb: string, what: string, e: unknown, api: string) {
  if (e instanceof ServiceError) {
    ctx.print(`${verb} failed: ${what} ${serviceErrorText(e, api)}`);
    ctx.exitCode = 1;
    return;
  }
  throw e;
}

interface Transfer {
  src: string;
  dst: string;
  kind: 'upload' | 'download' | 'copy';
}

/** Expands cp/mv/sync arguments into single-object transfers. */
function plan(ctx: Ctx, srcArg: string, dstArg: string, recursive: boolean): Transfer[] {
  const src = s3Path(srcArg);
  const dst = s3Path(dstArg);
  if (!src && !dst) throw invalidPath();
  if (src) {
    const b = bucket(ctx, src.bucket, recursive ? 'ListObjectsV2' : 'HeadObject');
    if (recursive) {
      allow(ctx, 's3:ListBucket', bucketArn(src.bucket), 'ListObjectsV2');
      const prefix = src.key && !src.key.endsWith('/') ? src.key + '/' : src.key;
      return sortedKeys(b, prefix).map((k) => {
        const rel = k.slice(prefix.length);
        return dst
          ? { src: `s3://${src.bucket}/${k}`, dst: `s3://${dst.bucket}/${joinKey(dst.key, rel)}`, kind: 'copy' as const }
          : { src: `s3://${src.bucket}/${k}`, dst: joinLocal(dstArg, rel), kind: 'download' as const };
      });
    }
    if (!b.objects[src.key]) throw err('404', 'Not Found', 'HeadObject');
    const name = basename(src.key);
    if (dst) {
      const key = !dst.key || dst.key.endsWith('/') ? dst.key + name : dst.key;
      return [{ src: srcArg, dst: `s3://${dst.bucket}/${key}`, kind: 'copy' }];
    }
    const local = dstArg.endsWith('/') || isLocalDir(ctx, dstArg) || dstArg === '.' ? joinLocal(dstArg, name) : dstArg;
    return [{ src: srcArg, dst: local, kind: 'download' }];
  }
  // local → s3
  const d = dst!;
  if (recursive) {
    if (!isLocalDir(ctx, srcArg)) throw new LocalMissing(srcArg);
    return localFiles(ctx, srcArg).map((rel) => ({
      src: joinLocal(srcArg, rel),
      dst: `s3://${d.bucket}/${joinKey(d.key, rel)}`,
      kind: 'upload' as const,
    }));
  }
  if (ctx.readLocal(srcArg) === undefined) {
    if (isLocalDir(ctx, srcArg)) throw new LocalMissing(srcArg, true);
    throw new LocalMissing(srcArg);
  }
  const key = !d.key || d.key.endsWith('/') ? d.key + basename(srcArg) : d.key;
  return [{ src: srcArg, dst: `s3://${d.bucket}/${key}`, kind: 'upload' }];
}

class LocalMissing extends Error {
  constructor(
    public path: string,
    public isDir = false,
  ) {
    super(path);
  }
}

function transfer(ctx: Ctx, t: Transfer, verb: string, move: boolean): boolean {
  const label = move ? 'move' : verb === 'sync' ? t.kind : t.kind;
  const api = t.kind === 'download' ? 'GetObject' : t.kind === 'copy' ? 'CopyObject' : 'PutObject';
  try {
    if (t.kind === 'upload') {
      const d = s3Path(t.dst)!;
      allow(ctx, 's3:PutObject', objectArn(d.bucket, d.key), api);
      const b = bucket(ctx, d.bucket, api);
      putObject(ctx, b, d.key, ctx.readLocal(t.src) ?? '');
      if (move) delete ctx.st.files[ctx.resolveLocal(t.src)];
    } else if (t.kind === 'download') {
      const s = s3Path(t.src)!;
      allow(ctx, 's3:GetObject', objectArn(s.bucket, s.key), api);
      const o = bucket(ctx, s.bucket, api).objects[s.key];
      ctx.writeLocal(t.dst, o.body);
      if (move) {
        allow(ctx, 's3:DeleteObject', objectArn(s.bucket, s.key), 'DeleteObject');
        delete ctx.st.s3[s.bucket].objects[s.key];
      }
    } else {
      const s = s3Path(t.src)!;
      const d = s3Path(t.dst)!;
      allow(ctx, 's3:GetObject', objectArn(s.bucket, s.key), api);
      allow(ctx, 's3:PutObject', objectArn(d.bucket, d.key), api);
      const o = bucket(ctx, s.bucket, api).objects[s.key];
      putObject(ctx, bucket(ctx, d.bucket, api), d.key, o.body, o.ContentType);
      if (move) delete ctx.st.s3[s.bucket].objects[s.key];
    }
    ctx.print(`${label}: ${t.src} to ${t.dst}`);
    return true;
  } catch (e) {
    fail(ctx, label, `${t.src} to ${t.dst}`, e, api);
    return false;
  }
}

function cpOrMv(a: Args, ctx: Ctx, move: boolean) {
  const [src, dst] = a._;
  let transfers: Transfer[];
  try {
    transfers = plan(ctx, src, dst, !!a.recursive);
  } catch (e) {
    if (e instanceof LocalMissing) {
      if (e.isDir) {
        const d = s3Path(dst)!;
        ctx.print(`upload failed: ${src} to s3://${d.bucket}/${d.key || basename(src)} [Errno 21] Is a directory: '${src}'`);
        ctx.exitCode = 1;
        return undefined;
      }
      ctx.print(`The user-provided path ${e.path} does not exist.`);
      ctx.exitCode = 255;
      return undefined;
    }
    if (e instanceof ServiceError) {
      ctx.print(`fatal error: ${serviceErrorText(e, 'ListObjectsV2')}`);
      ctx.exitCode = 1;
      return undefined;
    }
    throw e;
  }
  for (const t of transfers) {
    if (a.dryrun) ctx.print(`(dryrun) ${move ? 'move' : t.kind}: ${t.src} to ${t.dst}`);
    else transfer(ctx, t, move ? 'mv' : 'cp', move);
  }
  return undefined;
}

const pathOpts = [opt('recursive', 'bool', 'Recorre todo el directorio o prefijo'), opt('dryrun', 'bool', 'Muestra lo que haría sin hacerlo'), opt('quiet', 'bool')];

export const s3: Service = {
  name: 's3',
  help: 'Comandos de alto nivel para buckets y ficheros (S3)',
  ops: [
    {
      name: 'ls',
      help: 'Lista buckets, o el contenido de s3://bucket/prefijo.',
      positional: [{ name: 'path' }],
      opts: [opt('recursive', 'bool'), opt('human-readable', 'bool'), opt('summarize', 'bool')],
      example: 'aws s3 ls s3://mi-bucket --recursive --human-readable --summarize',
      run: (a, ctx) => {
        const target = a._[0];
        if (!target || target === 's3://') {
          allow(ctx, 's3:ListAllMyBuckets', '*', 'ListBuckets');
          Object.values(ctx.st.s3)
            .sort((x, y) => x.Name.localeCompare(y.Name))
            .forEach((b) => ctx.print(`${localStamp(b.CreationDate)} ${b.Name}`));
          return undefined;
        }
        const p = s3Path(target);
        if (!p) {
          throw invalidPath();
        }
        allow(ctx, 's3:ListBucket', bucketArn(p.bucket), 'ListObjectsV2');
        const b = bucket(ctx, p.bucket, 'ListObjectsV2');
        const size = (n: number) => (a['human-readable'] ? humanSize(n) : String(n)).padStart(10);
        let count = 0;
        let total = 0;
        if (a.recursive) {
          for (const k of sortedKeys(b, p.key)) {
            const o = b.objects[k];
            ctx.print(`${localStamp(o.LastModified)} ${size(o.Size)} ${k}`);
            count++;
            total += o.Size;
          }
        } else {
          const base = p.key.includes('/') ? p.key.slice(0, p.key.lastIndexOf('/') + 1) : '';
          const prefixes = new Set<string>();
          const files: string[] = [];
          for (const k of sortedKeys(b, p.key)) {
            const rest = k.slice(base.length);
            const slash = rest.indexOf('/');
            if (slash >= 0) prefixes.add(rest.slice(0, slash + 1));
            else files.push(k);
          }
          [...prefixes].sort().forEach((pre) => ctx.print(`${' '.repeat(27)}PRE ${pre}`));
          for (const k of files) {
            const o = b.objects[k];
            ctx.print(`${localStamp(o.LastModified)} ${size(o.Size)} ${k.slice(base.length)}`);
            count++;
            total += o.Size;
          }
        }
        if (a.summarize) {
          ctx.print('');
          ctx.print(`Total Objects: ${count}`);
          ctx.print(`   Total Size: ${a['human-readable'] ? humanSize(total) : total}`);
        }
        return undefined;
      },
    },
    {
      name: 'mb',
      help: 'Crea un bucket (el nombre es único en todo AWS).',
      positional: [{ name: 'path', required: true }],
      opts: [],
      example: 'aws s3 mb s3://web-uev-2627',
      run: (a, ctx) => {
        const p = s3Path(a._[0]);
        if (!p || !p.bucket) throw invalidPath();
        try {
          allow(ctx, 's3:CreateBucket', bucketArn(p.bucket), 'CreateBucket');
          createBucket(ctx, p.bucket, ctx.region);
          ctx.print(`make_bucket: ${p.bucket}`);
        } catch (e) {
          fail(ctx, 'make_bucket', `s3://${p.bucket}`, e, 'CreateBucket');
        }
        return undefined;
      },
    },
    {
      name: 'rb',
      help: 'Borra un bucket vacío (--force lo vacía antes).',
      positional: [{ name: 'path', required: true }],
      opts: [opt('force', 'bool', 'Borra antes todos los objetos')],
      run: (a, ctx) => {
        const p = s3Path(a._[0]);
        if (!p || !p.bucket) throw invalidPath();
        try {
          const b = bucket(ctx, p.bucket, 'DeleteBucket');
          if (a.force) {
            allow(ctx, 's3:ListBucket', bucketArn(b.Name), 'ListObjectsV2');
            for (const k of sortedKeys(b)) {
              allow(ctx, 's3:DeleteObject', objectArn(b.Name, k), 'DeleteObject');
              delete b.objects[k];
              ctx.print(`delete: s3://${b.Name}/${k}`);
            }
          }
          allow(ctx, 's3:DeleteBucket', bucketArn(b.Name), 'DeleteBucket');
          if (Object.keys(b.objects).length) throw err('BucketNotEmpty', 'The bucket you tried to delete is not empty', 'DeleteBucket');
          delete ctx.st.s3[b.Name];
          ctx.print(`remove_bucket: ${b.Name}`);
        } catch (e) {
          fail(ctx, 'remove_bucket', `s3://${p.bucket}`, e, 'DeleteBucket');
        }
        return undefined;
      },
    },
    {
      name: 'cp',
      help: 'Copia ficheros: local → S3 (upload), S3 → local (download) o S3 → S3.',
      positional: [{ name: 'origen', required: true }, { name: 'destino', required: true }],
      opts: pathOpts,
      example: 'aws s3 cp web/ s3://web-uev-2627/ --recursive',
      run: (a, ctx) => cpOrMv(a, ctx, false),
    },
    {
      name: 'mv',
      help: 'Mueve ficheros (copia y borra el origen).',
      positional: [{ name: 'origen', required: true }, { name: 'destino', required: true }],
      opts: pathOpts,
      run: (a, ctx) => cpOrMv(a, ctx, true),
    },
    {
      name: 'rm',
      help: 'Borra objetos de S3.',
      positional: [{ name: 'path', required: true }],
      opts: [opt('recursive', 'bool'), opt('dryrun', 'bool'), opt('quiet', 'bool')],
      run: (a, ctx) => {
        const p = s3Path(a._[0]);
        if (!p || !p.bucket) throw invalidPath();
        let keys: string[];
        try {
          const b = bucket(ctx, p.bucket, a.recursive ? 'ListObjectsV2' : 'DeleteObject');
          if (a.recursive) allow(ctx, 's3:ListBucket', bucketArn(b.Name), 'ListObjectsV2');
          keys = a.recursive ? sortedKeys(b, p.key) : [p.key];
        } catch (e) {
          if (e instanceof ServiceError) {
            ctx.print(`fatal error: ${serviceErrorText(e, 'ListObjectsV2')}`);
            ctx.exitCode = 1;
            return undefined;
          }
          throw e;
        }
        for (const k of keys) {
          const what = `s3://${p.bucket}/${k}`;
          if (a.dryrun) {
            ctx.print(`(dryrun) delete: ${what}`);
            continue;
          }
          try {
            allow(ctx, 's3:DeleteObject', objectArn(p.bucket, k), 'DeleteObject');
            delete ctx.st.s3[p.bucket].objects[k];
            ctx.print(`delete: ${what}`);
          } catch (e) {
            fail(ctx, 'delete', what, e, 'DeleteObject');
          }
        }
        return undefined;
      },
    },
    {
      name: 'sync',
      help: 'Sincroniza un directorio con un prefijo de S3 (solo copia lo nuevo o cambiado).',
      positional: [{ name: 'origen', required: true }, { name: 'destino', required: true }],
      opts: [opt('delete', 'bool', 'Borra en el destino lo que no está en el origen'), opt('dryrun', 'bool'), opt('quiet', 'bool')],
      example: 'aws s3 sync web/ s3://web-uev-2627/',
      run: (a, ctx) => {
        const [srcArg, dstArg] = a._;
        let transfers: Transfer[];
        try {
          transfers = plan(ctx, srcArg, dstArg, true);
        } catch (e) {
          if (e instanceof LocalMissing) {
            ctx.print(`The user-provided path ${e.path} does not exist.`);
            ctx.exitCode = 255;
            return undefined;
          }
          if (e instanceof ServiceError) {
            ctx.print(`fatal error: ${serviceErrorText(e, 'ListObjectsV2')}`);
            ctx.exitCode = 1;
            return undefined;
          }
          throw e;
        }
        const body = (p: string) => {
          const s = s3Path(p);
          return s ? ctx.st.s3[s.bucket]?.objects[s.key]?.body : ctx.readLocal(p);
        };
        const dst = s3Path(dstArg);
        if (dst && !ctx.st.s3[dst.bucket]) {
          ctx.print(`fatal error: An error occurred (NoSuchBucket) when calling the ListObjectsV2 operation: The specified bucket does not exist`);
          ctx.exitCode = 1;
          return undefined;
        }
        for (const t of transfers) {
          if (body(t.dst) === body(t.src)) continue;
          if (a.dryrun) ctx.print(`(dryrun) ${t.kind}: ${t.src} to ${t.dst}`);
          else transfer(ctx, t, 'sync', false);
        }
        if (a.delete) {
          const wanted = new Set(transfers.map((t) => t.dst));
          if (dst) {
            const b = ctx.st.s3[dst.bucket];
            const prefix = dst.key && !dst.key.endsWith('/') ? dst.key + '/' : dst.key;
            for (const k of sortedKeys(b, prefix)) {
              const what = `s3://${dst.bucket}/${k}`;
              if (wanted.has(what)) continue;
              if (a.dryrun) {
                ctx.print(`(dryrun) delete: ${what}`);
                continue;
              }
              try {
                allow(ctx, 's3:DeleteObject', objectArn(dst.bucket, k), 'DeleteObject');
                delete b.objects[k];
                ctx.print(`delete: ${what}`);
              } catch (e) {
                fail(ctx, 'delete', what, e, 'DeleteObject');
              }
            }
          } else {
            for (const rel of localFiles(ctx, dstArg)) {
              const local = joinLocal(dstArg, rel);
              if (wanted.has(local)) continue;
              if (a.dryrun) ctx.print(`(dryrun) delete: ${local}`);
              else {
                delete ctx.st.files[ctx.resolveLocal(local)];
                ctx.print(`delete: ${local}`);
              }
            }
          }
        }
        return undefined;
      },
    },
    {
      name: 'presign',
      help: 'Genera una URL temporal firmada para descargar un objeto.',
      positional: [{ name: 'path', required: true }],
      opts: [opt('expires-in', 'int', 'Segundos de validez (por defecto 3600)')],
      run: (a, ctx) => {
        const p = s3Path(a._[0]);
        if (!p || !p.bucket || !p.key) throw invalidPath();
        const d = ctx.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const region = ctx.st.s3[p.bucket]?.region ?? ctx.region;
        ctx.print(
          `https://${p.bucket}.s3.${region}.amazonaws.com/${p.key}?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
            `&X-Amz-Credential=${ctx.identity.accessKeyId}%2F${d.slice(0, 8)}%2F${region}%2Fs3%2Faws4_request` +
            `&X-Amz-Date=${d}&X-Amz-Expires=${a['expires-in'] ?? 3600}&X-Amz-SignedHeaders=host&X-Amz-Signature=${digest(p.key + d)}${digest(d + p.bucket)}`,
        );
        return undefined;
      },
    },
    {
      name: 'website',
      help: 'Activa el alojamiento de web estática en un bucket.',
      positional: [{ name: 'path', required: true }],
      opts: [opt('index-document', 'string'), opt('error-document', 'string')],
      example: 'aws s3 website s3://web-uev-2627 --index-document index.html --error-document error.html',
      run: (a, ctx) => {
        const p = s3Path(a._[0]);
        if (!p || !p.bucket) throw invalidPath();
        allow(ctx, 's3:PutBucketWebsite', bucketArn(p.bucket), 'PutBucketWebsite');
        const b = bucket(ctx, p.bucket, 'PutBucketWebsite');
        b.website = {
          IndexDocument: { Suffix: a['index-document'] ?? 'index.html' },
          ...(a['error-document'] ? { ErrorDocument: { Key: a['error-document'] } } : {}),
        };
        return undefined;
      },
    },
  ],
};

// ── aws s3api ─────────────────────────────────────────────────────────

const bucketOpt = req('bucket', 'string');
const bres = (a: Args) => bucketArn(a.bucket);

function objectView(o: S3Object) {
  return { Key: o.Key, LastModified: o.LastModified, ETag: o.ETag, Size: o.Size, StorageClass: 'STANDARD' };
}

export const s3api: Service = {
  name: 's3api',
  help: 'API de S3 operación a operación (buckets, objetos, políticas)',
  ops: [
    {
      name: 'create-bucket',
      help: 'Crea un bucket. Fuera de us-east-1 hace falta --create-bucket-configuration LocationConstraint=<región>.',
      opts: [bucketOpt, opt('create-bucket-configuration', 'struct', 'LocationConstraint=<región>'), opt('acl', 'string')],
      action: 's3:CreateBucket',
      resource: bres,
      example: 'aws s3api create-bucket --bucket informes-uev-2627 --create-bucket-configuration LocationConstraint=eu-west-1',
      run: (a, ctx) => {
        const lc = a['create-bucket-configuration']?.LocationConstraint as string | undefined;
        if (ctx.region === 'us-east-1') {
          if (lc && lc !== 'us-east-1') throw err('IllegalLocationConstraintException', `The ${lc} location constraint is incompatible for the region specific endpoint this request was sent to.`);
          if (lc === 'us-east-1') throw err('InvalidLocationConstraint', 'The specified location-constraint is not valid');
        } else if (!lc) {
          throw err('IllegalLocationConstraintException', 'The unspecified location constraint is incompatible for the region specific endpoint this request was sent to.');
        } else if (lc !== ctx.region) {
          throw err('IllegalLocationConstraintException', `The ${lc} location constraint is incompatible for the region specific endpoint this request was sent to.`);
        }
        createBucket(ctx, a.bucket, ctx.region);
        return { Location: ctx.region === 'us-east-1' ? `/${a.bucket}` : `http://${a.bucket}.s3.amazonaws.com/` };
      },
    },
    {
      name: 'list-buckets',
      help: 'Lista tus buckets.',
      opts: [],
      action: 's3:ListAllMyBuckets',
      run: (_a, ctx) => ({
        Buckets: Object.values(ctx.st.s3)
          .sort((x, y) => x.Name.localeCompare(y.Name))
          .map((b) => ({ Name: b.Name, CreationDate: b.CreationDate, BucketRegion: b.region })),
        Owner: { DisplayName: 'alumno', ID: digest(ctx.st.accountId) + digest('owner') },
        Prefix: null,
      }),
    },
    {
      name: 'head-bucket',
      help: 'Comprueba que un bucket existe y tienes acceso.',
      opts: [bucketOpt],
      action: 's3:ListBucket',
      resource: bres,
      run: (a, ctx) => {
        const b = ctx.st.s3[a.bucket];
        if (!b) throw err('404', 'Not Found');
        return { BucketRegion: b.region, AccessPointAlias: false };
      },
    },
    {
      name: 'get-bucket-location',
      help: 'Región del bucket (null = us-east-1).',
      opts: [bucketOpt],
      action: 's3:GetBucketLocation',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetBucketLocation');
        return { LocationConstraint: b.region === 'us-east-1' ? null : b.region };
      },
    },
    {
      name: 'delete-bucket',
      help: 'Borra un bucket vacío.',
      opts: [bucketOpt],
      action: 's3:DeleteBucket',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'DeleteBucket');
        if (Object.keys(b.objects).length) throw err('BucketNotEmpty', 'The bucket you tried to delete is not empty');
        delete ctx.st.s3[b.Name];
        return undefined;
      },
    },
    {
      name: 'put-object',
      help: 'Sube un objeto; --body es un fichero local.',
      opts: [bucketOpt, req('key', 'string'), opt('body', 'string', 'Fichero local'), opt('content-type', 'string')],
      action: 's3:PutObject',
      resource: (a) => objectArn(a.bucket, a.key),
      example: 'aws s3api put-object --bucket informes-uev-2627 --key 2026/ventas.csv --body datos/ventas.csv',
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'PutObject');
        let body = '';
        if (a.body !== undefined) {
          const c = ctx.readLocal(a.body);
          if (c === undefined) throw new CliError(`Error parsing parameter '--body': Blob values must be a path to a file.`);
          body = c;
        }
        const o = putObject(ctx, b, a.key, body, a['content-type']);
        return { ETag: o.ETag, ServerSideEncryption: 'AES256', ...(o.VersionId ? { VersionId: o.VersionId } : {}) };
      },
    },
    {
      name: 'get-object',
      help: 'Descarga un objeto al fichero local indicado.',
      positional: [{ name: 'outfile', required: true }],
      opts: [bucketOpt, req('key', 'string')],
      action: 's3:GetObject',
      resource: (a) => objectArn(a.bucket, a.key),
      example: 'aws s3api get-object --bucket informes-uev-2627 --key 2026/ventas.csv copia.csv',
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetObject');
        const o = b.objects[a.key];
        if (!o) throw err('NoSuchKey', 'The specified key does not exist.');
        ctx.writeLocal(a._[0], o.body);
        return {
          AcceptRanges: 'bytes',
          LastModified: o.LastModified,
          ContentLength: o.Size,
          ETag: o.ETag,
          ...(o.VersionId ? { VersionId: o.VersionId } : {}),
          ContentType: o.ContentType,
          ServerSideEncryption: 'AES256',
          Metadata: {},
        };
      },
    },
    {
      name: 'head-object',
      help: 'Metadatos de un objeto sin descargarlo.',
      opts: [bucketOpt, req('key', 'string')],
      action: 's3:GetObject',
      resource: (a) => objectArn(a.bucket, a.key),
      run: (a, ctx) => {
        const o = bucket(ctx, a.bucket, 'HeadObject').objects[a.key];
        if (!o) throw err('404', 'Not Found');
        return {
          AcceptRanges: 'bytes',
          LastModified: o.LastModified,
          ContentLength: o.Size,
          ETag: o.ETag,
          ...(o.VersionId ? { VersionId: o.VersionId } : {}),
          ContentType: o.ContentType,
          ServerSideEncryption: 'AES256',
          Metadata: {},
        };
      },
    },
    {
      name: 'list-objects-v2',
      help: 'Lista objetos; --delimiter / agrupa por "carpetas" (CommonPrefixes).',
      opts: [bucketOpt, opt('prefix', 'string'), opt('delimiter', 'string'), opt('max-keys', 'int')],
      action: 's3:ListBucket',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'ListObjectsV2');
        const prefix: string = a.prefix ?? '';
        const contents: Json[] = [];
        const common = new Set<string>();
        for (const k of sortedKeys(b, prefix)) {
          if (a.delimiter) {
            const i = k.indexOf(a.delimiter, prefix.length);
            if (i >= 0) {
              common.add(k.slice(0, i + a.delimiter.length));
              continue;
            }
          }
          contents.push(objectView(b.objects[k]));
        }
        const max = a['max-keys'] ?? 1000;
        const shown = contents.slice(0, max);
        return {
          ...(shown.length ? { Contents: shown } : {}),
          IsTruncated: contents.length > max,
          Name: b.Name,
          Prefix: prefix,
          ...(a.delimiter ? { Delimiter: a.delimiter } : {}),
          MaxKeys: max,
          ...(common.size ? { CommonPrefixes: [...common].sort().map((p) => ({ Prefix: p })) } : {}),
          KeyCount: shown.length + common.size,
        };
      },
    },
    {
      name: 'delete-object',
      help: 'Borra un objeto.',
      opts: [bucketOpt, req('key', 'string')],
      action: 's3:DeleteObject',
      resource: (a) => objectArn(a.bucket, a.key),
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'DeleteObject');
        delete b.objects[a.key];
        return b.versioning === 'Enabled' ? { DeleteMarker: true, VersionId: hexChars(ctx.st, 32) } : undefined;
      },
    },
    {
      name: 'put-bucket-versioning',
      help: 'Activa o suspende el versionado.',
      opts: [bucketOpt, req('versioning-configuration', 'struct', 'Status=Enabled|Suspended')],
      action: 's3:PutBucketVersioning',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'PutBucketVersioning');
        const status = a['versioning-configuration']?.Status;
        if (status !== 'Enabled' && status !== 'Suspended') throw err('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema');
        b.versioning = status;
        return undefined;
      },
    },
    {
      name: 'get-bucket-versioning',
      help: 'Estado del versionado.',
      opts: [bucketOpt],
      action: 's3:GetBucketVersioning',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetBucketVersioning');
        return b.versioning ? { Status: b.versioning } : undefined;
      },
    },
    {
      name: 'put-bucket-policy',
      help: 'Asigna la política del bucket (quién puede acceder a él).',
      opts: [bucketOpt, req('policy', 'doc')],
      action: 's3:PutBucketPolicy',
      resource: bres,
      example: 'aws s3api put-bucket-policy --bucket web-uev-2627 --policy file://politicas/bucket-publico.json',
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'PutBucketPolicy');
        const problem = validatePolicyDocument(a.policy, 'resource');
        if (problem) throw err('MalformedPolicy', problem === 'This policy contains invalid Json' ? 'Policies must be valid JSON and the first byte must be \'{\'' : problem);
        if (isPublicPolicy(a.policy) && b.publicAccessBlock?.BlockPublicPolicy) {
          throw err(
            'AccessDenied',
            `User: ${ctx.identity.arn} is not authorized to perform: s3:PutBucketPolicy on resource: "${bucketArn(b.Name)}" because public policies are blocked by the BlockPublicPolicy block public access setting.`,
          );
        }
        b.policy = a.policy;
        return undefined;
      },
    },
    {
      name: 'get-bucket-policy',
      help: 'Muestra la política del bucket.',
      opts: [bucketOpt],
      action: 's3:GetBucketPolicy',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetBucketPolicy');
        if (!b.policy) throw err('NoSuchBucketPolicy', 'The bucket policy does not exist');
        return { Policy: JSON.stringify(JSON.parse(b.policy)) };
      },
    },
    {
      name: 'delete-bucket-policy',
      help: 'Quita la política del bucket.',
      opts: [bucketOpt],
      action: 's3:DeleteBucketPolicy',
      resource: bres,
      run: (a, ctx) => {
        delete bucket(ctx, a.bucket, 'DeleteBucketPolicy').policy;
        return undefined;
      },
    },
    {
      name: 'put-public-access-block',
      help: 'Configura el bloqueo de acceso público del bucket.',
      opts: [bucketOpt, req('public-access-block-configuration', 'struct', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true', { coerce: true })],
      action: 's3:PutBucketPublicAccessBlock',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'PutPublicAccessBlock');
        const c = a['public-access-block-configuration'] ?? {};
        const flag = (k: keyof PublicAccessBlock) => c[k] === true;
        b.publicAccessBlock = {
          BlockPublicAcls: flag('BlockPublicAcls'),
          IgnorePublicAcls: flag('IgnorePublicAcls'),
          BlockPublicPolicy: flag('BlockPublicPolicy'),
          RestrictPublicBuckets: flag('RestrictPublicBuckets'),
        };
        return undefined;
      },
    },
    {
      name: 'get-public-access-block',
      help: 'Muestra el bloqueo de acceso público.',
      opts: [bucketOpt],
      action: 's3:GetBucketPublicAccessBlock',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetPublicAccessBlock');
        if (!b.publicAccessBlock) throw err('NoSuchPublicAccessBlockConfiguration', 'The public access block configuration was not found');
        return { PublicAccessBlockConfiguration: b.publicAccessBlock };
      },
    },
    {
      name: 'delete-public-access-block',
      help: 'Quita el bloqueo de acceso público.',
      opts: [bucketOpt],
      action: 's3:PutBucketPublicAccessBlock',
      resource: bres,
      run: (a, ctx) => {
        delete bucket(ctx, a.bucket, 'DeletePublicAccessBlock').publicAccessBlock;
        return undefined;
      },
    },
    {
      name: 'put-bucket-tagging',
      help: "Etiqueta un bucket: --tagging 'TagSet=[{Key=env,Value=dev}]'.",
      opts: [bucketOpt, req('tagging', 'struct')],
      action: 's3:PutBucketTagging',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'PutBucketTagging');
        b.tags = asArray<Json>(a.tagging?.TagSet).map((t) => ({ Key: String(t.Key), Value: String(t.Value ?? '') }));
        return undefined;
      },
    },
    {
      name: 'get-bucket-tagging',
      help: 'Muestra las etiquetas del bucket.',
      opts: [bucketOpt],
      action: 's3:GetBucketTagging',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetBucketTagging');
        if (!b.tags?.length) throw err('NoSuchTagSet', 'The TagSet does not exist');
        return { TagSet: b.tags };
      },
    },
    {
      name: 'get-bucket-website',
      help: 'Configuración de web estática del bucket.',
      opts: [bucketOpt],
      action: 's3:GetBucketWebsite',
      resource: bres,
      run: (a, ctx) => {
        const b = bucket(ctx, a.bucket, 'GetBucketWebsite');
        if (!b.website) throw err('NoSuchWebsiteConfiguration', 'The specified bucket does not have a website configuration');
        return b.website;
      },
    },
  ],
};

/** http endpoint of a website bucket, e.g. http://b.s3-website-eu-west-1.amazonaws.com */
export const websiteEndpoint = (b: Bucket) => `http://${b.Name}.s3-website-${b.region}.amazonaws.com`;
