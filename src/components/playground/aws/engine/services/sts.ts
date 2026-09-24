import type { Service } from '../spec';
import { opt, req } from '../spec';
import { assumeRole } from '../credentials';
import { err, iamId, iso, secretChars } from '../util';

export const sts: Service = {
  name: 'sts',
  help: 'Identidad y credenciales temporales (STS)',
  ops: [
    {
      name: 'get-caller-identity',
      help: 'Dice quién eres: cuenta, ARN e id del usuario o rol que hace la llamada.',
      opts: [],
      example: 'aws sts get-caller-identity',
      // Always allowed, even with no permissions at all (as in AWS).
      run: (_a, ctx) => ({ UserId: ctx.identity.userId, Account: ctx.st.accountId, Arn: ctx.identity.arn }),
    },
    {
      name: 'assume-role',
      help: 'Asume un rol y devuelve credenciales temporales (hay que exportarlas o usar un perfil con role_arn).',
      opts: [req('role-arn', 'string'), req('role-session-name', 'string'), opt('duration-seconds', 'int')],
      example: 'aws sts assume-role --role-arn arn:aws:iam::123456789012:role/LectorS3 --role-session-name yo',
      run: (a, ctx) => {
        const duration = a['duration-seconds'] ?? 3600;
        if (duration < 900 || duration > 43200) {
          throw err('ValidationError', `1 validation error detected: Value '${duration}' at 'durationSeconds' failed to satisfy constraint: Member must have value greater than or equal to 900`);
        }
        const cred = assumeRole(ctx.st, ctx.identity, a['role-arn'], a['role-session-name'], duration, ctx.now, (action, res) => ctx.authorize(action, res));
        const role = ctx.st.iam.roles[cred.roleName!];
        return {
          Credentials: {
            AccessKeyId: cred.AccessKeyId,
            SecretAccessKey: cred.SecretAccessKey,
            SessionToken: cred.SessionToken,
            Expiration: cred.Expiration,
          },
          AssumedRoleUser: {
            AssumedRoleId: `${role.RoleId}:${cred.sessionName}`,
            Arn: `arn:aws:sts::${ctx.st.accountId}:assumed-role/${role.RoleName}/${cred.sessionName}`,
          },
        };
      },
    },
    {
      name: 'get-session-token',
      help: 'Credenciales temporales para un usuario de IAM (típico con MFA).',
      opts: [opt('duration-seconds', 'int'), opt('serial-number', 'string'), opt('token-code', 'string')],
      run: (a, ctx) => {
        if (ctx.identity.kind !== 'user') throw err('AccessDenied', 'Cannot call GetSessionToken with session credentials');
        const key = iamId(ctx.st, 'ASIA').slice(0, 20);
        const cred = {
          AccessKeyId: key,
          SecretAccessKey: secretChars(ctx.st, 40),
          SessionToken: 'FwoGZXIvYXdzE' + secretChars(ctx.st, 160),
          Expiration: iso(new Date(ctx.now.getTime() + (a['duration-seconds'] ?? 43200) * 1000)),
        };
        ctx.st.sessions[key] = { ...cred, kind: 'user', userName: ctx.identity.userName };
        return { Credentials: cred };
      },
    },
  ],
};
