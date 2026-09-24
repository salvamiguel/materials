// Identity-based policy evaluation, as IAM does it for a single account:
// an explicit Deny wins, otherwise at least one Allow is needed.
// Conditions are not evaluated (statements with a Condition never match).

import { asArray, globMatch } from './util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Decision = 'allow' | 'implicit-deny' | 'explicit-deny';

function matchesAction(stmt: Json, action: string): boolean {
  if (stmt.NotAction !== undefined) return !asArray<string>(stmt.NotAction).some((p) => globMatch(p, action, true));
  return asArray<string>(stmt.Action).some((p) => globMatch(p, action, true));
}

function matchesResource(stmt: Json, resource: string): boolean {
  if (stmt.NotResource !== undefined) return !asArray<string>(stmt.NotResource).some((p) => globMatch(p, resource));
  if (stmt.Resource === undefined) return false;
  // Actions without resource-level permissions are requested on "*", which
  // only a Resource of "*" covers.
  return asArray<string>(stmt.Resource).some((p) => (resource === '*' ? p === '*' : globMatch(p, resource)));
}

export function evaluate(documents: string[], action: string, resources: string[]): Decision {
  let allowed = false;
  for (const raw of documents) {
    let d: Json;
    try {
      d = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const stmt of asArray<Json>(d.Statement)) {
      if (!stmt || stmt.Condition) continue;
      if (!matchesAction(stmt, action)) continue;
      if (!resources.every((r) => matchesResource(stmt, r))) continue;
      if (stmt.Effect === 'Deny') return 'explicit-deny';
      if (stmt.Effect === 'Allow') allowed = true;
    }
  }
  return allowed ? 'allow' : 'implicit-deny';
}

/** Does the role's trust policy let `principalArn` (in `accountId`) assume it? */
export function trustAllows(trustPolicy: string, principalArn: string, accountId: string): boolean {
  let d: Json;
  try {
    d = JSON.parse(trustPolicy);
  } catch {
    return false;
  }
  for (const stmt of asArray<Json>(d.Statement)) {
    if (stmt.Effect !== 'Allow' || stmt.Condition) continue;
    if (!asArray<string>(stmt.Action).some((a) => globMatch(a, 'sts:AssumeRole', true))) continue;
    const principal = stmt.Principal;
    if (principal === '*') return true;
    const aws = asArray<string>(principal?.AWS);
    for (const p of aws) {
      if (p === '*' || p === accountId || p === `arn:aws:iam::${accountId}:root` || p === principalArn) return true;
    }
  }
  return false;
}

/** Problems IAM reports for identity policy documents (MalformedPolicyDocument). */
export function validatePolicyDocument(raw: string, kind: 'identity' | 'trust' | 'resource'): string | undefined {
  let d: Json;
  try {
    d = JSON.parse(raw);
  } catch {
    return 'This policy contains invalid Json';
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'Syntax errors in policy.';
  if (d.Version !== undefined && d.Version !== '2012-10-17' && d.Version !== '2008-10-17') {
    return 'The policy must contain a valid version string';
  }
  const stmts = asArray<Json>(d.Statement);
  if (!stmts.length) return 'Syntax errors in policy.';
  for (const s of stmts) {
    if (!s || (s.Effect !== 'Allow' && s.Effect !== 'Deny')) return 'Syntax errors in policy.';
    if (s.Action === undefined && s.NotAction === undefined) return 'Policy statement must contain actions.';
    if (kind === 'identity') {
      if (s.Principal !== undefined || s.NotPrincipal !== undefined) return 'Policy document should not specify a principal.';
      if (s.Resource === undefined && s.NotResource === undefined) return 'Policy statement must contain resources.';
    }
    if (kind === 'trust' && s.Principal === undefined && s.NotPrincipal === undefined) {
      return 'AssumeRolepolicy contained an invalid principal: .';
    }
    if (kind === 'resource' && s.Principal === undefined && s.NotPrincipal === undefined) {
      return 'Missing required field Principal';
    }
  }
  return undefined;
}
