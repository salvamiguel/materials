// Credential resolution, as the AWS CLI does it:
//   --profile  >  AWS_ACCESS_KEY_ID/… env vars  >  AWS_PROFILE  >  "default"
// Profiles can hold keys, or role_arn + source_profile to assume a role.

import type { Identity, PlaygroundState, SessionCredential } from './types';
import { trustAllows } from './iam-eval';
import { CliError, err, iamId, iso, secretChars } from './util';

export const NO_CREDENTIALS = 'Unable to locate credentials. You can configure credentials by running "aws configure".';

function identityForKey(st: PlaygroundState, keyId: string, secret: string | undefined, token: string | undefined, now: Date): Identity {
  for (const u of Object.values(st.iam.users)) {
    const k = u.accessKeys.find((x) => x.AccessKeyId === keyId);
    if (!k) continue;
    if (k.Status !== 'Active') throw err('InvalidClientTokenId', 'The security token included in the request is invalid.');
    if (k.SecretAccessKey !== secret) {
      throw err('SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method. Consult the service documentation for details.');
    }
    return { kind: 'user', userName: u.UserName, arn: u.Arn, userId: u.UserId, accessKeyId: keyId };
  }
  const s = st.sessions[keyId];
  if (!s || s.SecretAccessKey !== secret || s.SessionToken !== token) {
    throw err('InvalidClientTokenId', 'The security token included in the request is invalid.');
  }
  if (new Date(s.Expiration) < now) throw err('ExpiredToken', 'The security token included in the request is expired');
  if (s.kind === 'user') {
    const u = st.iam.users[s.userName!];
    if (!u) throw err('InvalidClientTokenId', 'The security token included in the request is invalid.');
    return { kind: 'user', userName: u.UserName, arn: u.Arn, userId: u.UserId, accessKeyId: keyId };
  }
  const role = st.iam.roles[s.roleName!];
  return {
    kind: 'role',
    roleName: s.roleName!,
    sessionName: s.sessionName!,
    arn: `arn:aws:sts::${st.accountId}:assumed-role/${s.roleName}/${s.sessionName}`,
    userId: `${role?.RoleId ?? 'AROAUNKNOWN'}:${s.sessionName}`,
    accessKeyId: keyId,
  };
}

/** Principal ARN used in trust policies: the user, or the role (not the session). */
export const principalArn = (st: PlaygroundState, id: Identity) =>
  id.kind === 'user' ? id.arn : `arn:aws:iam::${st.accountId}:role/${id.roleName}`;

export function assumeRole(
  st: PlaygroundState,
  caller: Identity,
  roleArn: string,
  sessionName: string,
  durationSeconds: number,
  now: Date,
  authorize: (action: string, resources: string[]) => void,
): SessionCredential {
  authorize('sts:AssumeRole', [roleArn]);
  const denied = () =>
    err('AccessDenied', `User: ${caller.arn} is not authorized to perform: sts:AssumeRole on resource: ${roleArn}`);
  const m = /^arn:aws:iam::(\d{12}):role\/(?:.*\/)?([\w+=,.@-]+)$/.exec(roleArn);
  if (!m) throw err('ValidationError', `${roleArn} is invalid`);
  if (!/^[\w+=,.@-]{2,64}$/.test(sessionName)) {
    throw err('ValidationError', `1 validation error detected: Value '${sessionName}' at 'roleSessionName' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\w+=,.@-]*`);
  }
  const role = m[1] === st.accountId ? st.iam.roles[m[2]] : undefined;
  if (!role || !trustAllows(role.AssumeRolePolicyDocument, principalArn(st, caller), st.accountId)) throw denied();
  if (durationSeconds > role.MaxSessionDuration) {
    throw err('ValidationError', `The requested DurationSeconds exceeds the MaxSessionDuration set for this role.`);
  }
  const cred: SessionCredential = {
    AccessKeyId: iamId(st, 'ASIA').slice(0, 20),
    SecretAccessKey: secretChars(st, 40),
    SessionToken: 'IQoJb3JpZ2luX2VjE' + secretChars(st, 180),
    Expiration: iso(new Date(now.getTime() + durationSeconds * 1000)),
    kind: 'role',
    roleName: role.RoleName,
    sessionName,
  };
  st.sessions[cred.AccessKeyId] = cred;
  return cred;
}

export interface Resolved {
  identity: Identity;
  profile: string;
}

/**
 * Resolves who is calling. `authorizeAs` lets role profiles check the
 * source identity's permission to call sts:AssumeRole.
 */
export function resolveIdentity(
  st: PlaygroundState,
  profileFlag: string | undefined,
  now: Date,
  authorizeAs: (id: Identity, action: string, resources: string[]) => void,
): Resolved {
  const env = st.env;
  if (!profileFlag && env.AWS_ACCESS_KEY_ID) {
    if (!env.AWS_SECRET_ACCESS_KEY) throw new CliError(NO_CREDENTIALS, 253);
    return { identity: identityForKey(st, env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY, env.AWS_SESSION_TOKEN, now), profile: 'env' };
  }
  const name = profileFlag ?? env.AWS_PROFILE ?? 'default';
  return { identity: fromProfile(st, name, now, authorizeAs, 0), profile: name };
}

function fromProfile(
  st: PlaygroundState,
  name: string,
  now: Date,
  authorizeAs: (id: Identity, action: string, resources: string[]) => void,
  depth: number,
): Identity {
  const p = st.profiles[name];
  if (!p) {
    if (name === 'default') throw new CliError(NO_CREDENTIALS, 253);
    throw new CliError(`The config profile (${name}) could not be found`, 253);
  }
  if (p.role_arn) {
    if (!p.source_profile) throw new CliError(`The profile "${name}" has a role_arn but no source_profile`, 253);
    if (depth > 3) throw new CliError('Infinite loop in credential configuration detected', 253);
    const source = fromProfile(st, p.source_profile, now, authorizeAs, depth + 1);
    const cached = st.sessions[st.roleCache?.[name] ?? ''];
    if (cached && cached.roleName === p.role_arn.split('/').pop() && new Date(cached.Expiration) > now) {
      return identityForKey(st, cached.AccessKeyId, cached.SecretAccessKey, cached.SessionToken, now);
    }
    const session = p.role_session_name ?? `botocore-session-${Math.floor(now.getTime() / 1000)}`;
    const cred = assumeRole(st, source, p.role_arn, session, 3600, now, (action, res) => authorizeAs(source, action, res));
    st.roleCache = { ...st.roleCache, [name]: cred.AccessKeyId };
    return identityForKey(st, cred.AccessKeyId, cred.SecretAccessKey, cred.SessionToken, now);
  }
  if (!p.aws_access_key_id) throw new CliError(NO_CREDENTIALS, 253);
  return identityForKey(st, p.aws_access_key_id, p.aws_secret_access_key, undefined, now);
}
