import type { Ec2Region, PlaygroundState } from './types';
import { digest, ec2Id, iamId, iso } from './util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ACCOUNT_ID = '123456789012';
export const HOME = '/home/alumno';
export const DEFAULT_REGION = 'eu-west-1';

export const REGIONS: { name: string; azs: number; optIn?: boolean }[] = [
  { name: 'us-east-1', azs: 6 },
  { name: 'us-east-2', azs: 3 },
  { name: 'us-west-1', azs: 2 },
  { name: 'us-west-2', azs: 4 },
  { name: 'ca-central-1', azs: 3 },
  { name: 'sa-east-1', azs: 3 },
  { name: 'eu-west-1', azs: 3 },
  { name: 'eu-west-2', azs: 3 },
  { name: 'eu-west-3', azs: 3 },
  { name: 'eu-central-1', azs: 3 },
  { name: 'eu-north-1', azs: 3 },
  { name: 'eu-south-2', azs: 3, optIn: true },
  { name: 'ap-south-1', azs: 3 },
  { name: 'ap-northeast-1', azs: 3 },
  { name: 'ap-northeast-2', azs: 4 },
  { name: 'ap-southeast-1', azs: 3 },
  { name: 'ap-southeast-2', azs: 3 },
];

export const isRegion = (r: string) => REGIONS.some((x) => x.name === r);

const WORD: Record<string, string> = {
  east: 'e', west: 'w', north: 'n', south: 's', central: 'c', northeast: 'ne', southeast: 'se', northwest: 'nw', southwest: 'sw',
};

/** eu-west-1 → euw1, as used in AZ ids (euw1-az1). */
export function regionCode(region: string): string {
  const [geo, dir, n] = region.split('-');
  return geo + (WORD[dir] ?? dir[0]) + n;
}

export function availabilityZones(region: string): { ZoneName: string; ZoneId: string }[] {
  const info = REGIONS.find((r) => r.name === region);
  const letters = region === 'us-west-1' ? ['a', 'c'] : 'abcdef'.slice(0, info?.azs ?? 3).split('');
  return letters.map((l, i) => ({ ZoneName: region + l, ZoneId: `${regionCode(region)}-az${i + 1}` }));
}

export interface ImageSpec {
  name: string;
  description: string;
  owner: string;
  alias?: string;
  arch: 'x86_64' | 'arm64';
  platform: string;
  root: string;
  created: string;
}

export const IMAGES: ImageSpec[] = [
  {
    name: 'al2023-ami-2023.8.20250915.0-kernel-6.1-x86_64',
    description: 'Amazon Linux 2023 AMI 2023.8.20250915.0 x86_64 HVM kernel-6.1',
    owner: '137112412989', alias: 'amazon', arch: 'x86_64', platform: 'Linux/UNIX', root: '/dev/xvda', created: '2025-09-15T21:30:12.000Z',
  },
  {
    name: 'al2023-ami-2023.8.20250915.0-kernel-6.1-arm64',
    description: 'Amazon Linux 2023 AMI 2023.8.20250915.0 arm64 HVM kernel-6.1',
    owner: '137112412989', alias: 'amazon', arch: 'arm64', platform: 'Linux/UNIX', root: '/dev/xvda', created: '2025-09-15T21:30:40.000Z',
  },
  {
    name: 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20250821',
    description: 'Canonical, Ubuntu, 24.04, amd64 noble image',
    owner: '099720109477', arch: 'x86_64', platform: 'Linux/UNIX', root: '/dev/sda1', created: '2025-08-21T10:12:03.000Z',
  },
  {
    name: 'Windows_Server-2022-English-Full-Base-2025.09.10',
    description: 'Microsoft Windows Server 2022 Full Locale English AMI provided by Amazon',
    owner: '801119661308', alias: 'amazon', arch: 'x86_64', platform: 'Windows', root: '/dev/sda1', created: '2025-09-10T07:44:19.000Z',
  },
];

export const imageId = (region: string, name: string) => 'ami-0' + digest(region + '|' + name).slice(0, 16);

export function describeImage(region: string, img: ImageSpec): Json {
  const id = imageId(region, img.name);
  return {
    Architecture: img.arch,
    CreationDate: img.created,
    ImageId: id,
    ImageLocation: `${img.alias ?? img.owner}/${img.name}`,
    ImageType: 'machine',
    Public: true,
    OwnerId: img.owner,
    PlatformDetails: img.platform,
    ...(img.platform === 'Windows' ? { Platform: 'windows' } : {}),
    UsageOperation: img.platform === 'Windows' ? 'RunInstances:0002' : 'RunInstances',
    State: 'available',
    BlockDeviceMappings: [
      {
        DeviceName: img.root,
        Ebs: { DeleteOnTermination: true, SnapshotId: 'snap-0' + digest(id).slice(0, 16), VolumeSize: img.platform === 'Windows' ? 30 : 8, VolumeType: 'gp3', Encrypted: false },
      },
    ],
    Description: img.description,
    EnaSupport: true,
    Hypervisor: 'xen',
    ...(img.alias ? { ImageOwnerAlias: img.alias } : {}),
    Name: img.name,
    RootDeviceName: img.root,
    RootDeviceType: 'ebs',
    SriovNetSupport: 'simple',
    VirtualizationType: 'hvm',
    BootMode: img.arch === 'arm64' ? 'uefi' : 'uefi-preferred',
  };
}

export const INSTANCE_TYPES: Record<string, { arch: 'x86_64' | 'arm64'; vcpu: number; mem: number }> = {
  't2.micro': { arch: 'x86_64', vcpu: 1, mem: 1024 },
  't2.small': { arch: 'x86_64', vcpu: 1, mem: 2048 },
  't3.nano': { arch: 'x86_64', vcpu: 2, mem: 512 },
  't3.micro': { arch: 'x86_64', vcpu: 2, mem: 1024 },
  't3.small': { arch: 'x86_64', vcpu: 2, mem: 2048 },
  't3.medium': { arch: 'x86_64', vcpu: 2, mem: 4096 },
  't3.large': { arch: 'x86_64', vcpu: 2, mem: 8192 },
  't4g.micro': { arch: 'arm64', vcpu: 2, mem: 1024 },
  't4g.small': { arch: 'arm64', vcpu: 2, mem: 2048 },
  'm5.large': { arch: 'x86_64', vcpu: 2, mem: 8192 },
  'm7g.large': { arch: 'arm64', vcpu: 2, mem: 8192 },
  'c5.large': { arch: 'x86_64', vcpu: 2, mem: 4096 },
  'c7g.large': { arch: 'arm64', vcpu: 2, mem: 4096 },
  'r5.large': { arch: 'x86_64', vcpu: 2, mem: 16384 },
  'g4dn.xlarge': { arch: 'x86_64', vcpu: 4, mem: 16384 },
};

/** Bucket names already taken by "other AWS customers". */
export const TAKEN_BUCKETS = new Set(['test', 'bucket', 'my-bucket', 'mybucket', 'example', 'aws', 'backup', 'data', 'web', 'www', 'prueba', 'demo', 'logs', 'images']);

// AWS's documented example credentials: realistic and obviously fake.
const ADMIN_KEY = 'AKIAIOSFODNN7EXAMPLE';
const ADMIN_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

export function initialState(now: Date): PlaygroundState {
  const created = iso(now);
  const st: PlaygroundState = {
    version: 1,
    accountId: ACCOUNT_ID,
    seq: 1000,
    iam: { users: {}, groups: {}, roles: {}, policies: {}, instanceProfiles: {} },
    s3: {},
    ec2: {},
    sessions: {},
    profiles: {},
    env: {},
    files: { ...LOCAL_FILES },
    cwd: HOME,
  };
  const secret = ADMIN_SECRET;
  st.iam.users.admin = {
    UserName: 'admin',
    UserId: iamId(st, 'AIDA'),
    Arn: `arn:aws:iam::${ACCOUNT_ID}:user/admin`,
    Path: '/',
    CreateDate: created,
    groups: [],
    attached: ['arn:aws:iam::aws:policy/AdministratorAccess'],
    inline: {},
    accessKeys: [{ AccessKeyId: ADMIN_KEY, SecretAccessKey: secret, Status: 'Active', CreateDate: created }],
  };
  st.profiles.default = { aws_access_key_id: ADMIN_KEY, aws_secret_access_key: secret, region: DEFAULT_REGION, output: 'json' };
  return st;
}

/** EC2 state for a region, created with its default VPC on first use. */
export function ec2Region(st: PlaygroundState, region: string, now: Date): Ec2Region {
  if (st.ec2[region]) return st.ec2[region];
  const r: Ec2Region = {
    vpcs: [], subnets: [], internetGateways: [], routeTables: [], securityGroups: [], keyPairs: [], reservations: [], volumes: [], addresses: [],
  };
  st.ec2[region] = r;
  const vpcId = ec2Id(st, 'vpc');
  const owner = st.accountId;
  r.vpcs.push({
    CidrBlock: '172.31.0.0/16',
    DhcpOptionsId: ec2Id(st, 'dopt'),
    State: 'available',
    VpcId: vpcId,
    OwnerId: owner,
    InstanceTenancy: 'default',
    CidrBlockAssociationSet: [{ AssociationId: ec2Id(st, 'vpc-cidr-assoc'), CidrBlock: '172.31.0.0/16', CidrBlockState: { State: 'associated' } }],
    IsDefault: true,
    BlockPublicAccessStates: { InternetGatewayBlockMode: 'off' },
  });
  availabilityZones(region)
    .slice(0, 3)
    .forEach((az, i) => {
      const subnetId = ec2Id(st, 'subnet');
      r.subnets.push({
        AvailabilityZone: az.ZoneName,
        AvailabilityZoneId: az.ZoneId,
        AvailableIpAddressCount: 4091,
        CidrBlock: `172.31.${i * 16}.0/20`,
        DefaultForAz: true,
        MapPublicIpOnLaunch: true,
        MapCustomerOwnedIpOnLaunch: false,
        State: 'available',
        SubnetId: subnetId,
        VpcId: vpcId,
        OwnerId: owner,
        AssignIpv6AddressOnCreation: false,
        Ipv6CidrBlockAssociationSet: [],
        SubnetArn: `arn:aws:ec2:${region}:${owner}:subnet/${subnetId}`,
        EnableDns64: false,
        Ipv6Native: false,
        PrivateDnsNameOptionsOnLaunch: { HostnameType: 'ip-name', EnableResourceNameDnsARecord: false, EnableResourceNameDnsAAAARecord: false },
      });
    });
  const igwId = ec2Id(st, 'igw');
  r.internetGateways.push({ Attachments: [{ State: 'available', VpcId: vpcId }], InternetGatewayId: igwId, OwnerId: owner, Tags: [] });
  r.routeTables.push(mainRouteTable(st, vpcId, '172.31.0.0/16', [{ DestinationCidrBlock: '0.0.0.0/0', GatewayId: igwId, Origin: 'CreateRoute', State: 'active' }]));
  r.securityGroups.push(defaultSecurityGroup(st, region, vpcId));
  void now;
  return r;
}

export function mainRouteTable(st: PlaygroundState, vpcId: string, cidr: string, extra: Json[] = []): Json {
  const rtbId = ec2Id(st, 'rtb');
  return {
    Associations: [{ Main: true, RouteTableAssociationId: ec2Id(st, 'rtbassoc'), RouteTableId: rtbId, AssociationState: { State: 'associated' } }],
    PropagatingVgws: [],
    RouteTableId: rtbId,
    Routes: [{ DestinationCidrBlock: cidr, GatewayId: 'local', Origin: 'CreateRouteTable', State: 'active' }, ...extra],
    Tags: [],
    VpcId: vpcId,
    OwnerId: st.accountId,
  };
}

export function defaultSecurityGroup(st: PlaygroundState, region: string, vpcId: string): Json {
  const groupId = ec2Id(st, 'sg');
  return {
    Description: 'default VPC security group',
    GroupName: 'default',
    IpPermissions: [
      {
        IpProtocol: '-1',
        IpRanges: [],
        Ipv6Ranges: [],
        PrefixListIds: [],
        UserIdGroupPairs: [{ GroupId: groupId, UserId: st.accountId }],
      },
    ],
    OwnerId: st.accountId,
    GroupId: groupId,
    IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], PrefixListIds: [], UserIdGroupPairs: [] }],
    VpcId: vpcId,
    SecurityGroupArn: `arn:aws:ec2:${region}:${st.accountId}:security-group/${groupId}`,
  };
}

// ── Local files of the student ───────────────────────────────────────

const f = (path: string) => `${HOME}/${path}`;

export const LOCAL_FILES: Record<string, string> = {
  [f('LEEME.txt')]: `Bienvenido al playground de AWS CLI.

Nada de lo que hagas aquí toca AWS: la cuenta 123456789012 es simulada
y vive en tu navegador. Prueba:

  aws sts get-caller-identity
  aws s3 ls
  aws ec2 describe-vpcs --output table
  aws help

Ficheros de ejemplo: web/ (una web estática), datos/ y politicas/.
`,
  [f('web/index.html')]: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Mi primera web en S3</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>Hola desde Amazon S3</h1>
    <p>Esta página se sirve desde un bucket.</p>
  </body>
</html>
`,
  [f('web/style.css')]: `body { font-family: system-ui, sans-serif; margin: 3rem; color: #232f3e; }
h1 { color: #ff9900; }
`,
  [f('web/error.html')]: `<!doctype html>
<html lang="es"><body><h1>404</h1><p>Página no encontrada.</p></body></html>
`,
  [f('datos/ventas.csv')]: `fecha,producto,unidades,importe
2026-09-01,camiseta,12,180.00
2026-09-01,taza,30,225.00
2026-09-02,camiseta,7,105.00
2026-09-03,sudadera,4,140.00
`,
  [f('datos/informe.txt')]: `Informe trimestral: ventas en línea con el objetivo.
`,
  [f('politicas/confianza-cuenta.json')]: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::123456789012:root" },
      "Action": "sts:AssumeRole"
    }
  ]
}
`,
  [f('politicas/confianza-ec2.json')]: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
`,
  [f('politicas/escribir-informes.json')]: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::informes-uev-2627/*"
    }
  ]
}
`,
  [f('politicas/bucket-publico.json')]: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LecturaPublica",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::web-uev-2627/*"
    }
  ]
}
`,
  [f('politicas/solo-describe.json')]: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ec2:Describe*"],
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Action": "ec2:TerminateInstances",
      "Resource": "*"
    }
  ]
}
`,
};
