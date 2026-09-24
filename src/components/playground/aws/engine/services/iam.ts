import type { Ctx, Service } from '../spec';
import { opt, req } from '../spec';
import type { IamGroup, IamPolicy, IamRole, IamUser, PlaygroundState } from '../types';
import { AWS_MANAGED } from '../managed';
import { validatePolicyDocument } from '../iam-eval';
import { err, iamId, iso, secretChars } from '../util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const NAME_RE = /^[\w+=,.@-]{1,64}$/;

function checkName(value: string, field: string) {
  if (!NAME_RE.test(value)) {
    throw err('ValidationError', `1 validation error detected: Value '${value}' at '${field}' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\w+=,.@-]+`);
  }
}

const arn = (st: PlaygroundState, kind: string, name: string, path = '/') => `arn:aws:iam::${st.accountId}:${kind}${path}${name}`;

export function getUser(ctx: Ctx, name: string): IamUser {
  const u = ctx.st.iam.users[name];
  if (!u) throw err('NoSuchEntity', `The user with name ${name} cannot be found.`);
  return u;
}

export function getRole(ctx: Ctx, name: string): IamRole {
  const r = ctx.st.iam.roles[name];
  if (!r) throw err('NoSuchEntity', `The role with name ${name} cannot be found.`);
  return r;
}

function getGroup(ctx: Ctx, name: string): IamGroup {
  const g = ctx.st.iam.groups[name];
  if (!g) throw err('NoSuchEntity', `The group with name ${name} cannot be found.`);
  return g;
}

export function findPolicy(st: PlaygroundState, policyArn: string): IamPolicy | undefined {
  return st.iam.policies[policyArn] ?? AWS_MANAGED[policyArn];
}

function attachable(ctx: Ctx, policyArn: string): IamPolicy {
  const p = findPolicy(ctx.st, policyArn);
  if (!p) throw err('NoSuchEntity', `Policy ${policyArn} does not exist or is not attachable.`);
  return p;
}

function checkDocument(doc: string, kind: 'identity' | 'trust') {
  const problem = validatePolicyDocument(doc, kind);
  if (problem) throw err('MalformedPolicyDocument', problem);
}

const decode = (doc: string) => {
  try {
    return JSON.parse(doc);
  } catch {
    return doc;
  }
};

const userView = (u: IamUser) => ({ Path: u.Path, UserName: u.UserName, UserId: u.UserId, Arn: u.Arn, CreateDate: u.CreateDate, ...(u.Tags?.length ? { Tags: u.Tags } : {}) });
const groupView = (g: IamGroup) => ({ Path: g.Path, GroupName: g.GroupName, GroupId: g.GroupId, Arn: g.Arn, CreateDate: g.CreateDate });
const roleView = (r: IamRole, full = false) => ({
  Path: r.Path,
  RoleName: r.RoleName,
  RoleId: r.RoleId,
  Arn: r.Arn,
  CreateDate: r.CreateDate,
  AssumeRolePolicyDocument: decode(r.AssumeRolePolicyDocument),
  ...(r.Description ? { Description: r.Description } : {}),
  MaxSessionDuration: r.MaxSessionDuration,
  ...(full ? { RoleLastUsed: {} } : {}),
  ...(r.Tags?.length ? { Tags: r.Tags } : {}),
});

function attachmentCount(st: PlaygroundState, policyArn: string): number {
  const all = [...Object.values(st.iam.users), ...Object.values(st.iam.groups), ...Object.values(st.iam.roles)];
  return all.filter((e) => e.attached.includes(policyArn)).length;
}

const policyView = (st: PlaygroundState, p: IamPolicy) => ({
  PolicyName: p.PolicyName,
  PolicyId: p.PolicyId,
  Arn: p.Arn,
  Path: p.Path,
  DefaultVersionId: p.DefaultVersionId,
  AttachmentCount: attachmentCount(st, p.Arn),
  PermissionsBoundaryUsageCount: 0,
  IsAttachable: true,
  CreateDate: p.CreateDate,
  UpdateDate: p.UpdateDate,
  ...(p.Description ? { Description: p.Description } : {}),
});

const attachedView = (st: PlaygroundState, arns: string[]) => ({
  AttachedPolicies: arns.map((a) => ({ PolicyName: findPolicy(st, a)?.PolicyName ?? a.split('/').pop(), PolicyArn: a })),
});

type Entity = 'user' | 'group' | 'role';

function entity(ctx: Ctx, kind: Entity, name: string): IamUser | IamGroup | IamRole {
  return kind === 'user' ? getUser(ctx, name) : kind === 'group' ? getGroup(ctx, name) : getRole(ctx, name);
}

const Kind: Record<Entity, string> = { user: 'User', group: 'Group', role: 'Role' };

/** attach-/detach-/list-attached-<kind>-policies and the inline policy ops. */
function policyOps(kind: Entity) {
  const nameOpt = `${kind}-name`;
  const K = Kind[kind];
  const res = (a: Json, ctx: Ctx) => arn(ctx.st, kind, a[nameOpt]);
  return [
    {
      name: `attach-${kind}-policy`,
      help: `Adjunta una política administrada a ${kind === 'user' ? 'un usuario' : kind === 'group' ? 'un grupo' : 'un rol'}.`,
      opts: [req(nameOpt, 'string'), req('policy-arn', 'string')],
      action: `iam:Attach${K}Policy`,
      resource: res,
      run: (a: Json, ctx: Ctx) => {
        const e = entity(ctx, kind, a[nameOpt]);
        attachable(ctx, a['policy-arn']);
        if (!e.attached.includes(a['policy-arn'])) e.attached.push(a['policy-arn']);
        return undefined;
      },
    },
    {
      name: `detach-${kind}-policy`,
      help: 'Quita una política administrada.',
      opts: [req(nameOpt, 'string'), req('policy-arn', 'string')],
      action: `iam:Detach${K}Policy`,
      resource: res,
      run: (a: Json, ctx: Ctx) => {
        const e = entity(ctx, kind, a[nameOpt]);
        if (!e.attached.includes(a['policy-arn'])) throw err('NoSuchEntity', `Policy ${a['policy-arn']} was not found.`);
        e.attached = e.attached.filter((x) => x !== a['policy-arn']);
        return undefined;
      },
    },
    {
      name: `list-attached-${kind}-policies`,
      help: 'Lista las políticas administradas adjuntas.',
      opts: [req(nameOpt, 'string')],
      action: `iam:ListAttached${K}Policies`,
      resource: res,
      run: (a: Json, ctx: Ctx) => attachedView(ctx.st, entity(ctx, kind, a[nameOpt]).attached),
    },
    {
      name: `put-${kind}-policy`,
      help: 'Crea o reemplaza una política en línea (inline).',
      opts: [req(nameOpt, 'string'), req('policy-name', 'string'), req('policy-document', 'doc')],
      action: `iam:Put${K}Policy`,
      resource: res,
      run: (a: Json, ctx: Ctx) => {
        const e = entity(ctx, kind, a[nameOpt]);
        checkName(a['policy-name'], 'policyName');
        checkDocument(a['policy-document'], 'identity');
        e.inline[a['policy-name']] = a['policy-document'];
        return undefined;
      },
    },
    {
      name: `get-${kind}-policy`,
      help: 'Muestra una política en línea.',
      opts: [req(nameOpt, 'string'), req('policy-name', 'string')],
      action: `iam:Get${K}Policy`,
      resource: res,
      run: (a: Json, ctx: Ctx) => {
        const e = entity(ctx, kind, a[nameOpt]);
        const d = e.inline[a['policy-name']];
        if (d === undefined) throw err('NoSuchEntity', `The ${kind} policy with name ${a['policy-name']} cannot be found.`);
        return { [`${K}Name`]: a[nameOpt], PolicyName: a['policy-name'], PolicyDocument: decode(d) };
      },
    },
    {
      name: `list-${kind}-policies`,
      help: 'Lista los nombres de las políticas en línea.',
      opts: [req(nameOpt, 'string')],
      action: `iam:List${K}Policies`,
      resource: res,
      run: (a: Json, ctx: Ctx) => ({ PolicyNames: Object.keys(entity(ctx, kind, a[nameOpt]).inline).sort() }),
    },
    {
      name: `delete-${kind}-policy`,
      help: 'Borra una política en línea.',
      opts: [req(nameOpt, 'string'), req('policy-name', 'string')],
      action: `iam:Delete${K}Policy`,
      resource: res,
      run: (a: Json, ctx: Ctx) => {
        const e = entity(ctx, kind, a[nameOpt]);
        if (e.inline[a['policy-name']] === undefined) throw err('NoSuchEntity', `The ${kind} policy with name ${a['policy-name']} cannot be found.`);
        delete e.inline[a['policy-name']];
        return undefined;
      },
    },
  ];
}

const callerUserName = (ctx: Ctx): string => {
  if (ctx.identity.kind !== 'user') throw err('ValidationError', 'Must specify userName when calling with non-User credentials');
  return ctx.identity.userName;
};

export const iam: Service = {
  name: 'iam',
  help: 'Usuarios, grupos, roles y políticas (IAM)',
  ops: [
    // ── users ──
    {
      name: 'create-user',
      help: 'Crea un usuario de IAM.',
      opts: [req('user-name', 'string'), opt('path', 'string'), opt('tags', 'structs')],
      action: 'iam:CreateUser',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name']),
      example: 'aws iam create-user --user-name ana',
      run: (a, ctx) => {
        const name = a['user-name'];
        checkName(name, 'userName');
        if (ctx.st.iam.users[name]) throw err('EntityAlreadyExists', `User with name ${name} already exists.`);
        const path = a.path ?? '/';
        const u: IamUser = {
          UserName: name,
          UserId: iamId(ctx.st, 'AIDA'),
          Arn: arn(ctx.st, 'user', name, path),
          Path: path,
          CreateDate: iso(ctx.now),
          ...(a.tags ? { Tags: a.tags } : {}),
          groups: [],
          attached: [],
          inline: {},
          accessKeys: [],
        };
        ctx.st.iam.users[name] = u;
        return { User: userView(u) };
      },
    },
    {
      name: 'get-user',
      help: 'Muestra un usuario (sin --user-name, el que hace la llamada).',
      opts: [opt('user-name', 'string')],
      action: 'iam:GetUser',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name'] ?? (ctx.identity.kind === 'user' ? ctx.identity.userName : '*')),
      run: (a, ctx) => ({ User: userView(getUser(ctx, a['user-name'] ?? callerUserName(ctx))) }),
    },
    {
      name: 'list-users',
      help: 'Lista los usuarios de la cuenta.',
      opts: [opt('path-prefix', 'string')],
      action: 'iam:ListUsers',
      run: (a, ctx) => ({
        Users: Object.values(ctx.st.iam.users)
          .filter((u) => !a['path-prefix'] || u.Path.startsWith(a['path-prefix']))
          .sort((x, y) => x.UserName.localeCompare(y.UserName))
          .map(userView),
      }),
    },
    {
      name: 'delete-user',
      help: 'Borra un usuario (antes hay que quitarle políticas, grupos y claves).',
      opts: [req('user-name', 'string')],
      action: 'iam:DeleteUser',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name']),
      run: (a, ctx) => {
        const u = getUser(ctx, a['user-name']);
        if (u.accessKeys.length) throw err('DeleteConflict', 'Cannot delete entity, must delete access keys first.');
        if (u.attached.length || Object.keys(u.inline).length) throw err('DeleteConflict', 'Cannot delete entity, must detach all policies first.');
        if (u.groups.length) throw err('DeleteConflict', 'Cannot delete entity, must remove users from group first.');
        delete ctx.st.iam.users[u.UserName];
        return undefined;
      },
    },
    // ── access keys ──
    {
      name: 'create-access-key',
      help: 'Crea una clave de acceso (máximo 2 por usuario).',
      opts: [opt('user-name', 'string')],
      action: 'iam:CreateAccessKey',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name'] ?? (ctx.identity.kind === 'user' ? ctx.identity.userName : '*')),
      run: (a, ctx) => {
        const u = getUser(ctx, a['user-name'] ?? callerUserName(ctx));
        if (u.accessKeys.length >= 2) throw err('LimitExceeded', 'Cannot exceed quota for AccessKeysPerUser: 2');
        const key = { AccessKeyId: iamId(ctx.st, 'AKIA').slice(0, 20), SecretAccessKey: secretChars(ctx.st, 40), Status: 'Active' as const, CreateDate: iso(ctx.now) };
        u.accessKeys.push(key);
        return { AccessKey: { UserName: u.UserName, ...key } };
      },
    },
    {
      name: 'list-access-keys',
      help: 'Lista las claves de acceso de un usuario.',
      opts: [opt('user-name', 'string')],
      action: 'iam:ListAccessKeys',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name'] ?? (ctx.identity.kind === 'user' ? ctx.identity.userName : '*')),
      run: (a, ctx) => {
        const u = getUser(ctx, a['user-name'] ?? callerUserName(ctx));
        return { AccessKeyMetadata: u.accessKeys.map((k) => ({ UserName: u.UserName, AccessKeyId: k.AccessKeyId, Status: k.Status, CreateDate: k.CreateDate })) };
      },
    },
    {
      name: 'update-access-key',
      help: 'Activa o desactiva una clave de acceso.',
      opts: [req('access-key-id', 'string'), req('status', 'string', '', { choices: ['Active', 'Inactive'] }), opt('user-name', 'string')],
      action: 'iam:UpdateAccessKey',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name'] ?? '*'),
      run: (a, ctx) => {
        const u = getUser(ctx, a['user-name'] ?? callerUserName(ctx));
        const k = u.accessKeys.find((x) => x.AccessKeyId === a['access-key-id']);
        if (!k) throw err('NoSuchEntity', `The Access Key with id ${a['access-key-id']} cannot be found.`);
        k.Status = a.status;
        return undefined;
      },
    },
    {
      name: 'delete-access-key',
      help: 'Borra una clave de acceso.',
      opts: [req('access-key-id', 'string'), opt('user-name', 'string')],
      action: 'iam:DeleteAccessKey',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name'] ?? '*'),
      run: (a, ctx) => {
        const u = getUser(ctx, a['user-name'] ?? callerUserName(ctx));
        if (!u.accessKeys.some((x) => x.AccessKeyId === a['access-key-id'])) {
          throw err('NoSuchEntity', `The Access Key with id ${a['access-key-id']} cannot be found.`);
        }
        u.accessKeys = u.accessKeys.filter((x) => x.AccessKeyId !== a['access-key-id']);
        return undefined;
      },
    },
    // ── groups ──
    {
      name: 'create-group',
      help: 'Crea un grupo de IAM.',
      opts: [req('group-name', 'string'), opt('path', 'string')],
      action: 'iam:CreateGroup',
      resource: (a, ctx) => arn(ctx.st, 'group', a['group-name']),
      run: (a, ctx) => {
        const name = a['group-name'];
        checkName(name, 'groupName');
        if (ctx.st.iam.groups[name]) throw err('EntityAlreadyExists', `Group with name ${name} already exists.`);
        const path = a.path ?? '/';
        const g: IamGroup = { GroupName: name, GroupId: iamId(ctx.st, 'AGPA'), Arn: arn(ctx.st, 'group', name, path), Path: path, CreateDate: iso(ctx.now), attached: [], inline: {} };
        ctx.st.iam.groups[name] = g;
        return { Group: groupView(g) };
      },
    },
    {
      name: 'get-group',
      help: 'Muestra un grupo y sus usuarios.',
      opts: [req('group-name', 'string')],
      action: 'iam:GetGroup',
      resource: (a, ctx) => arn(ctx.st, 'group', a['group-name']),
      run: (a, ctx) => {
        const g = getGroup(ctx, a['group-name']);
        const users = Object.values(ctx.st.iam.users).filter((u) => u.groups.includes(g.GroupName));
        return { Users: users.map(userView), Group: groupView(g) };
      },
    },
    {
      name: 'list-groups',
      help: 'Lista los grupos.',
      opts: [],
      action: 'iam:ListGroups',
      run: (_a, ctx) => ({ Groups: Object.values(ctx.st.iam.groups).sort((x, y) => x.GroupName.localeCompare(y.GroupName)).map(groupView) }),
    },
    {
      name: 'list-groups-for-user',
      help: 'Lista los grupos de un usuario.',
      opts: [req('user-name', 'string')],
      action: 'iam:ListGroupsForUser',
      resource: (a, ctx) => arn(ctx.st, 'user', a['user-name']),
      run: (a, ctx) => ({ Groups: getUser(ctx, a['user-name']).groups.map((g) => groupView(getGroup(ctx, g))) }),
    },
    {
      name: 'add-user-to-group',
      help: 'Añade un usuario a un grupo.',
      opts: [req('group-name', 'string'), req('user-name', 'string')],
      action: 'iam:AddUserToGroup',
      resource: (a, ctx) => arn(ctx.st, 'group', a['group-name']),
      run: (a, ctx) => {
        const g = getGroup(ctx, a['group-name']);
        const u = getUser(ctx, a['user-name']);
        if (!u.groups.includes(g.GroupName)) u.groups.push(g.GroupName);
        return undefined;
      },
    },
    {
      name: 'remove-user-from-group',
      help: 'Saca a un usuario de un grupo.',
      opts: [req('group-name', 'string'), req('user-name', 'string')],
      action: 'iam:RemoveUserFromGroup',
      resource: (a, ctx) => arn(ctx.st, 'group', a['group-name']),
      run: (a, ctx) => {
        getGroup(ctx, a['group-name']);
        const u = getUser(ctx, a['user-name']);
        u.groups = u.groups.filter((g) => g !== a['group-name']);
        return undefined;
      },
    },
    {
      name: 'delete-group',
      help: 'Borra un grupo vacío y sin políticas.',
      opts: [req('group-name', 'string')],
      action: 'iam:DeleteGroup',
      resource: (a, ctx) => arn(ctx.st, 'group', a['group-name']),
      run: (a, ctx) => {
        const g = getGroup(ctx, a['group-name']);
        if (Object.values(ctx.st.iam.users).some((u) => u.groups.includes(g.GroupName))) {
          throw err('DeleteConflict', 'Cannot delete entity, must remove users from group first.');
        }
        if (g.attached.length || Object.keys(g.inline).length) throw err('DeleteConflict', 'Cannot delete entity, must delete policies first.');
        delete ctx.st.iam.groups[g.GroupName];
        return undefined;
      },
    },
    // ── roles ──
    {
      name: 'create-role',
      help: 'Crea un rol con su política de confianza (quién puede asumirlo).',
      opts: [
        req('role-name', 'string'),
        req('assume-role-policy-document', 'doc', 'Política de confianza (JSON o file://)'),
        opt('description', 'string'),
        opt('max-session-duration', 'int'),
        opt('path', 'string'),
        opt('tags', 'structs'),
      ],
      action: 'iam:CreateRole',
      resource: (a, ctx) => arn(ctx.st, 'role', a['role-name']),
      example: 'aws iam create-role --role-name LectorS3 --assume-role-policy-document file://politicas/confianza-cuenta.json',
      run: (a, ctx) => {
        const name = a['role-name'];
        checkName(name, 'roleName');
        if (ctx.st.iam.roles[name]) throw err('EntityAlreadyExists', `Role with name ${name} already exists.`);
        checkDocument(a['assume-role-policy-document'], 'trust');
        const path = a.path ?? '/';
        const r: IamRole = {
          RoleName: name,
          RoleId: iamId(ctx.st, 'AROA'),
          Arn: arn(ctx.st, 'role', name, path),
          Path: path,
          CreateDate: iso(ctx.now),
          ...(a.description ? { Description: a.description } : {}),
          MaxSessionDuration: a['max-session-duration'] ?? 3600,
          AssumeRolePolicyDocument: a['assume-role-policy-document'],
          ...(a.tags ? { Tags: a.tags } : {}),
          attached: [],
          inline: {},
        };
        ctx.st.iam.roles[name] = r;
        const { MaxSessionDuration: _m, ...view } = roleView(r);
        return { Role: view };
      },
    },
    {
      name: 'get-role',
      help: 'Muestra un rol.',
      opts: [req('role-name', 'string')],
      action: 'iam:GetRole',
      resource: (a, ctx) => arn(ctx.st, 'role', a['role-name']),
      run: (a, ctx) => ({ Role: roleView(getRole(ctx, a['role-name']), true) }),
    },
    {
      name: 'list-roles',
      help: 'Lista los roles.',
      opts: [opt('path-prefix', 'string')],
      action: 'iam:ListRoles',
      run: (a, ctx) => ({
        Roles: Object.values(ctx.st.iam.roles)
          .filter((r) => !a['path-prefix'] || r.Path.startsWith(a['path-prefix']))
          .sort((x, y) => x.RoleName.localeCompare(y.RoleName))
          .map((r) => roleView(r)),
      }),
    },
    {
      name: 'update-assume-role-policy',
      help: 'Cambia la política de confianza de un rol.',
      opts: [req('role-name', 'string'), req('policy-document', 'doc')],
      action: 'iam:UpdateAssumeRolePolicy',
      resource: (a, ctx) => arn(ctx.st, 'role', a['role-name']),
      run: (a, ctx) => {
        const r = getRole(ctx, a['role-name']);
        checkDocument(a['policy-document'], 'trust');
        r.AssumeRolePolicyDocument = a['policy-document'];
        return undefined;
      },
    },
    {
      name: 'delete-role',
      help: 'Borra un rol (antes hay que quitarle las políticas).',
      opts: [req('role-name', 'string')],
      action: 'iam:DeleteRole',
      resource: (a, ctx) => arn(ctx.st, 'role', a['role-name']),
      run: (a, ctx) => {
        const r = getRole(ctx, a['role-name']);
        if (r.attached.length || Object.keys(r.inline).length) throw err('DeleteConflict', 'Cannot delete entity, must detach all policies first.');
        if (Object.values(ctx.st.iam.instanceProfiles).some((p) => p.roles.includes(r.RoleName))) {
          throw err('DeleteConflict', 'Cannot delete entity, must remove roles from instance profile first.');
        }
        delete ctx.st.iam.roles[r.RoleName];
        return undefined;
      },
    },
    // ── managed policies ──
    {
      name: 'create-policy',
      help: 'Crea una política administrada por el cliente.',
      opts: [req('policy-name', 'string'), req('policy-document', 'doc'), opt('description', 'string'), opt('path', 'string')],
      action: 'iam:CreatePolicy',
      resource: (a, ctx) => arn(ctx.st, 'policy', a['policy-name']),
      example: 'aws iam create-policy --policy-name EscribirInformes --policy-document file://politicas/escribir-informes.json',
      run: (a, ctx) => {
        const name = a['policy-name'];
        checkName(name, 'policyName');
        const path = a.path ?? '/';
        const policyArn = arn(ctx.st, 'policy', name, path);
        if (ctx.st.iam.policies[policyArn]) throw err('EntityAlreadyExists', `A policy called ${name} already exists. Duplicate names are not allowed.`);
        checkDocument(a['policy-document'], 'identity');
        const now = iso(ctx.now);
        const p: IamPolicy = {
          PolicyName: name,
          PolicyId: iamId(ctx.st, 'ANPA'),
          Arn: policyArn,
          Path: path,
          DefaultVersionId: 'v1',
          CreateDate: now,
          UpdateDate: now,
          ...(a.description ? { Description: a.description } : {}),
          document: a['policy-document'],
          awsManaged: false,
        };
        ctx.st.iam.policies[policyArn] = p;
        const { Description: _d, ...view } = policyView(ctx.st, p);
        return { Policy: view };
      },
    },
    {
      name: 'list-policies',
      help: 'Lista políticas: --scope AWS (de AWS), Local (tuyas) o All.',
      opts: [opt('scope', 'string', '', { choices: ['All', 'AWS', 'Local'] }), opt('only-attached', 'bool')],
      action: 'iam:ListPolicies',
      run: (a, ctx) => {
        const scope = a.scope ?? 'All';
        const all = [...(scope !== 'Local' ? Object.values(AWS_MANAGED) : []), ...(scope !== 'AWS' ? Object.values(ctx.st.iam.policies) : [])];
        return {
          Policies: all
            .map((p) => {
              const { Description: _d, ...v } = policyView(ctx.st, p);
              return v;
            })
            .filter((p) => !a['only-attached'] || p.AttachmentCount > 0),
        };
      },
    },
    {
      name: 'get-policy',
      help: 'Muestra una política administrada.',
      opts: [req('policy-arn', 'string')],
      action: 'iam:GetPolicy',
      resource: (a) => a['policy-arn'],
      run: (a, ctx) => {
        const p = findPolicy(ctx.st, a['policy-arn']);
        if (!p) throw err('NoSuchEntity', `Policy ${a['policy-arn']} was not found.`);
        return { Policy: policyView(ctx.st, p) };
      },
    },
    {
      name: 'get-policy-version',
      help: 'Muestra el documento de una versión de la política.',
      opts: [req('policy-arn', 'string'), req('version-id', 'string')],
      action: 'iam:GetPolicyVersion',
      resource: (a) => a['policy-arn'],
      run: (a, ctx) => {
        const p = findPolicy(ctx.st, a['policy-arn']);
        if (!p) throw err('NoSuchEntity', `Policy ${a['policy-arn']} was not found.`);
        if (a['version-id'] !== p.DefaultVersionId) throw err('NoSuchEntity', `Policy ${p.Arn} version ${a['version-id']} does not exist or is not attachable.`);
        return { PolicyVersion: { Document: decode(p.document), VersionId: p.DefaultVersionId, IsDefaultVersion: true, CreateDate: p.CreateDate } };
      },
    },
    {
      name: 'delete-policy',
      help: 'Borra una política administrada por el cliente.',
      opts: [req('policy-arn', 'string')],
      action: 'iam:DeletePolicy',
      resource: (a) => a['policy-arn'],
      run: (a, ctx) => {
        const p = ctx.st.iam.policies[a['policy-arn']];
        if (!p) {
          if (AWS_MANAGED[a['policy-arn']]) throw err('AccessDenied', 'Cannot delete AWS managed policies.');
          throw err('NoSuchEntity', `Policy ${a['policy-arn']} was not found.`);
        }
        if (attachmentCount(ctx.st, p.Arn)) throw err('DeleteConflict', 'Cannot delete a policy attached to entities.');
        delete ctx.st.iam.policies[p.Arn];
        return undefined;
      },
    },
    ...policyOps('user'),
    ...policyOps('group'),
    ...policyOps('role'),
    // ── instance profiles ──
    {
      name: 'create-instance-profile',
      help: 'Crea un perfil de instancia (para dar un rol a una EC2).',
      opts: [req('instance-profile-name', 'string'), opt('path', 'string')],
      action: 'iam:CreateInstanceProfile',
      resource: (a, ctx) => arn(ctx.st, 'instance-profile', a['instance-profile-name']),
      run: (a, ctx) => {
        const name = a['instance-profile-name'];
        checkName(name, 'instanceProfileName');
        if (ctx.st.iam.instanceProfiles[name]) throw err('EntityAlreadyExists', `Instance Profile ${name} already exists.`);
        const path = a.path ?? '/';
        const p = { InstanceProfileName: name, InstanceProfileId: iamId(ctx.st, 'AIPA'), Arn: arn(ctx.st, 'instance-profile', name, path), Path: path, CreateDate: iso(ctx.now), roles: [] as string[] };
        ctx.st.iam.instanceProfiles[name] = p;
        return { InstanceProfile: instanceProfileView(ctx, p) };
      },
    },
    {
      name: 'add-role-to-instance-profile',
      help: 'Mete un rol en un perfil de instancia (solo cabe uno).',
      opts: [req('instance-profile-name', 'string'), req('role-name', 'string')],
      action: 'iam:AddRoleToInstanceProfile',
      resource: (a, ctx) => arn(ctx.st, 'instance-profile', a['instance-profile-name']),
      run: (a, ctx) => {
        const p = ctx.st.iam.instanceProfiles[a['instance-profile-name']];
        if (!p) throw err('NoSuchEntity', `Instance Profile ${a['instance-profile-name']} cannot be found.`);
        getRole(ctx, a['role-name']);
        if (p.roles.length) throw err('LimitExceeded', 'Cannot exceed quota for InstanceSessionsPerInstanceProfile: 1');
        p.roles.push(a['role-name']);
        return undefined;
      },
    },
    {
      name: 'remove-role-from-instance-profile',
      help: 'Saca el rol de un perfil de instancia.',
      opts: [req('instance-profile-name', 'string'), req('role-name', 'string')],
      action: 'iam:RemoveRoleFromInstanceProfile',
      resource: (a, ctx) => arn(ctx.st, 'instance-profile', a['instance-profile-name']),
      run: (a, ctx) => {
        const p = ctx.st.iam.instanceProfiles[a['instance-profile-name']];
        if (!p) throw err('NoSuchEntity', `Instance Profile ${a['instance-profile-name']} cannot be found.`);
        if (!p.roles.includes(a['role-name'])) throw err('NoSuchEntity', `The role with name ${a['role-name']} cannot be found.`);
        p.roles = p.roles.filter((r) => r !== a['role-name']);
        return undefined;
      },
    },
    {
      name: 'list-instance-profiles',
      help: 'Lista los perfiles de instancia.',
      opts: [],
      action: 'iam:ListInstanceProfiles',
      run: (_a, ctx) => ({ InstanceProfiles: Object.values(ctx.st.iam.instanceProfiles).map((p) => instanceProfileView(ctx, p)) }),
    },
    {
      name: 'delete-instance-profile',
      help: 'Borra un perfil de instancia vacío.',
      opts: [req('instance-profile-name', 'string')],
      action: 'iam:DeleteInstanceProfile',
      resource: (a, ctx) => arn(ctx.st, 'instance-profile', a['instance-profile-name']),
      run: (a, ctx) => {
        const p = ctx.st.iam.instanceProfiles[a['instance-profile-name']];
        if (!p) throw err('NoSuchEntity', `Instance Profile ${a['instance-profile-name']} cannot be found.`);
        if (p.roles.length) throw err('DeleteConflict', 'Cannot delete entity, must remove roles from instance profile first.');
        delete ctx.st.iam.instanceProfiles[p.InstanceProfileName];
        return undefined;
      },
    },
  ],
};

function instanceProfileView(ctx: Ctx, p: { InstanceProfileName: string; InstanceProfileId: string; Arn: string; Path: string; CreateDate: string; roles: string[] }) {
  return {
    Path: p.Path,
    InstanceProfileName: p.InstanceProfileName,
    InstanceProfileId: p.InstanceProfileId,
    Arn: p.Arn,
    CreateDate: p.CreateDate,
    Roles: p.roles.filter((r) => ctx.st.iam.roles[r]).map((r) => roleView(ctx.st.iam.roles[r])),
  };
}
