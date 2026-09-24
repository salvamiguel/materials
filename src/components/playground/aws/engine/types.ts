// Shape of the simulated AWS account, local shell and CLI session.
// Resources are stored in the same shape the AWS APIs return them, so
// describe/list operations can mostly return them as they are.

export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Tag {
  Key: string;
  Value: string;
}

// ── IAM ──────────────────────────────────────────────────────────────

export interface AccessKey {
  AccessKeyId: string;
  SecretAccessKey: string;
  Status: 'Active' | 'Inactive';
  CreateDate: string;
}

export interface IamUser {
  UserName: string;
  UserId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  Tags?: Tag[];
  groups: string[];
  attached: string[]; // policy ARNs
  inline: Record<string, string>;
  accessKeys: AccessKey[];
}

export interface IamGroup {
  GroupName: string;
  GroupId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  attached: string[];
  inline: Record<string, string>;
}

export interface IamRole {
  RoleName: string;
  RoleId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  Description?: string;
  MaxSessionDuration: number;
  AssumeRolePolicyDocument: string;
  Tags?: Tag[];
  attached: string[];
  inline: Record<string, string>;
}

export interface IamPolicy {
  PolicyName: string;
  PolicyId: string;
  Arn: string;
  Path: string;
  DefaultVersionId: string;
  CreateDate: string;
  UpdateDate: string;
  Description?: string;
  document: string;
  awsManaged: boolean;
}

export interface InstanceProfile {
  InstanceProfileName: string;
  InstanceProfileId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  roles: string[];
}

export interface IamState {
  users: Record<string, IamUser>;
  groups: Record<string, IamGroup>;
  roles: Record<string, IamRole>;
  policies: Record<string, IamPolicy>; // by ARN, customer-managed only
  instanceProfiles: Record<string, InstanceProfile>;
}

// ── S3 ───────────────────────────────────────────────────────────────

export interface S3Object {
  Key: string;
  body: string;
  Size: number;
  ETag: string;
  LastModified: string;
  ContentType: string;
  VersionId?: string;
}

export interface PublicAccessBlock {
  BlockPublicAcls: boolean;
  IgnorePublicAcls: boolean;
  BlockPublicPolicy: boolean;
  RestrictPublicBuckets: boolean;
}

export interface Bucket {
  Name: string;
  CreationDate: string;
  region: string;
  versioning?: 'Enabled' | 'Suspended';
  policy?: string;
  publicAccessBlock?: PublicAccessBlock;
  tags?: Tag[];
  website?: { IndexDocument: { Suffix: string }; ErrorDocument?: { Key: string } };
  objects: Record<string, S3Object>;
}

// ── EC2 (one per region) ─────────────────────────────────────────────

export interface Ec2Region {
  vpcs: Json[];
  subnets: Json[];
  internetGateways: Json[];
  routeTables: Json[];
  securityGroups: Json[];
  keyPairs: (Json & { material?: string })[];
  reservations: Json[];
  volumes: Json[];
  addresses: Json[];
}

// ── Session, credentials and local shell ─────────────────────────────

export interface Profile {
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  region?: string;
  output?: string;
  role_arn?: string;
  source_profile?: string;
  role_session_name?: string;
}

/** Temporary credentials handed out by sts:AssumeRole / GetSessionToken. */
export interface SessionCredential {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration: string;
  kind: 'role' | 'user';
  roleName?: string;
  sessionName?: string;
  userName?: string;
}

export interface ConfigurePrompt {
  profile: string;
  step: number;
}

export interface PlaygroundState {
  version: 1;
  accountId: string;
  seq: number;
  iam: IamState;
  s3: Record<string, Bucket>;
  ec2: Record<string, Ec2Region>;
  sessions: Record<string, SessionCredential>;
  profiles: Record<string, Profile>;
  env: Record<string, string>;
  files: Record<string, string>; // absolute path → content
  /** Cached role credentials per profile (like ~/.aws/cli/cache). */
  roleCache?: Record<string, string>;
  cwd: string;
  prompt?: ConfigurePrompt;
}

/** Who is making the call once credentials are resolved. */
export type Identity =
  | { kind: 'user'; userName: string; arn: string; userId: string; accessKeyId: string }
  | {
      kind: 'role';
      roleName: string;
      sessionName: string;
      arn: string;
      userId: string;
      accessKeyId: string;
    };
