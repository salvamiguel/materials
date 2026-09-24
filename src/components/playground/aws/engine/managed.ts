// A small set of AWS-managed policies. The S3, EC2 and IAM ones use the real
// documents (trimmed to the services the playground simulates);
// ReadOnlyAccess and PowerUserAccess are reduced versions.

import type { IamPolicy } from './types';

const doc = (statements: object[]) => JSON.stringify({ Version: '2012-10-17', Statement: statements });

const MANAGED: { name: string; id: string; description: string; path?: string; document: string }[] = [
  {
    name: 'AdministratorAccess',
    id: 'ANPAIWMBCKSKIEE64ZLYK',
    description: 'Provides full access to AWS services and resources.',
    document: doc([{ Effect: 'Allow', Action: '*', Resource: '*' }]),
  },
  {
    name: 'PowerUserAccess',
    id: 'ANPAJYRXTHIB4FOVS3ZXS',
    description: 'Provides full access to AWS services and resources, but does not allow management of Users and groups.',
    document: doc([
      { Effect: 'Allow', NotAction: ['iam:*', 'organizations:*', 'account:*'], Resource: '*' },
      {
        Effect: 'Allow',
        Action: ['iam:CreateServiceLinkedRole', 'iam:DeleteServiceLinkedRole', 'iam:ListRoles', 'organizations:DescribeOrganization', 'account:ListRegions', 'account:GetAccountInformation'],
        Resource: '*',
      },
    ]),
  },
  {
    name: 'ReadOnlyAccess',
    id: 'ANPAILL3HVNFSB6DCOWYQ',
    description: 'Provides read-only access to AWS services and resources.',
    document: doc([
      {
        Effect: 'Allow',
        Action: ['ec2:Describe*', 'ec2:Get*', 'iam:Get*', 'iam:List*', 'iam:Generate*', 's3:Get*', 's3:List*', 's3:Describe*', 'sts:GetCallerIdentity'],
        Resource: '*',
      },
    ]),
  },
  {
    name: 'AmazonS3FullAccess',
    id: 'ANPAIFIR6V6BVTRAHWINE',
    description: 'Provides full access to all buckets via the AWS Management Console.',
    document: doc([{ Effect: 'Allow', Action: ['s3:*', 's3-object-lambda:*'], Resource: '*' }]),
  },
  {
    name: 'AmazonS3ReadOnlyAccess',
    id: 'ANPAIZTJ4DXE7G6AGAE6M',
    description: 'Provides read only access to all buckets via the AWS Management Console.',
    document: doc([
      { Effect: 'Allow', Action: ['s3:Get*', 's3:List*', 's3:Describe*', 's3-object-lambda:Get*', 's3-object-lambda:List*'], Resource: '*' },
    ]),
  },
  {
    name: 'AmazonEC2FullAccess',
    id: 'ANPAI3VAJF5ZCRZ7MCQE6',
    description: 'Provides full access to Amazon EC2 via the AWS Management Console.',
    document: doc([
      { Action: 'ec2:*', Effect: 'Allow', Resource: '*' },
      { Effect: 'Allow', Action: 'elasticloadbalancing:*', Resource: '*' },
      { Effect: 'Allow', Action: 'cloudwatch:*', Resource: '*' },
      { Effect: 'Allow', Action: 'autoscaling:*', Resource: '*' },
    ]),
  },
  {
    name: 'AmazonEC2ReadOnlyAccess',
    id: 'ANPAIGDT4SV4GSETWTBZK',
    description: 'Provides read only access to Amazon EC2 via the AWS Management Console.',
    document: doc([
      { Effect: 'Allow', Action: 'ec2:Describe*', Resource: '*' },
      { Effect: 'Allow', Action: 'elasticloadbalancing:Describe*', Resource: '*' },
      { Effect: 'Allow', Action: ['cloudwatch:ListMetrics', 'cloudwatch:GetMetricStatistics', 'cloudwatch:Describe*'], Resource: '*' },
      { Effect: 'Allow', Action: 'autoscaling:Describe*', Resource: '*' },
    ]),
  },
  {
    name: 'IAMFullAccess',
    id: 'ANPAI7XKCFMBPM3QQRRVQ',
    description: 'Provides full access to IAM via the AWS Management Console.',
    document: doc([{ Effect: 'Allow', Action: ['iam:*', 'organizations:DescribeAccount', 'organizations:DescribeOrganization', 'organizations:ListAccounts'], Resource: '*' }]),
  },
  {
    name: 'IAMReadOnlyAccess',
    id: 'ANPAJKSO7NDY4T57MWDSQ',
    description: 'Provides read only access to IAM via the AWS Management Console.',
    document: doc([
      { Effect: 'Allow', Action: ['iam:GenerateCredentialReport', 'iam:GenerateServiceLastAccessedDetails', 'iam:Get*', 'iam:List*', 'iam:SimulateCustomPolicy', 'iam:SimulatePrincipalPolicy'], Resource: '*' },
    ]),
  },
];

const CREATED = '2015-02-06T18:39:46+00:00';

export const AWS_MANAGED: Record<string, IamPolicy> = Object.fromEntries(
  MANAGED.map((p) => {
    const arn = `arn:aws:iam::aws:policy/${p.name}`;
    return [
      arn,
      {
        PolicyName: p.name,
        PolicyId: p.id,
        Arn: arn,
        Path: '/',
        DefaultVersionId: 'v1',
        CreateDate: CREATED,
        UpdateDate: CREATED,
        Description: p.description,
        document: p.document,
        awsManaged: true,
      },
    ];
  }),
);
