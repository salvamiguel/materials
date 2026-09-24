import type { Args, Ctx, Op, Service } from '../spec';
import { opt, req } from '../spec';
import type { Ec2Region, PlaygroundState, Tag } from '../types';
import {
  IMAGES, INSTANCE_TYPES, REGIONS, availabilityZones, defaultSecurityGroup, describeImage, imageId, mainRouteTable,
} from '../seed';
import { asArray, cidrContains, cidrOverlaps, CliError, ec2Id, err, globMatch, hexChars, ipToString, iso, parseCidr, secretChars, tagsFromSpecs } from '../util';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const STATE_CODE: Record<string, number> = { pending: 0, running: 16, 'shutting-down': 32, terminated: 48, stopping: 64, stopped: 80 };
const state = (name: string) => ({ Code: STATE_CODE[name], Name: name });

// ── filters ──────────────────────────────────────────────────────────

type Getter = (item: Json) => unknown;

function tagValues(item: Json, name: string): unknown[] | undefined {
  const tags: Tag[] = item.Tags || [];
  if (name.startsWith('tag:')) return tags.filter((t) => t.Key === name.slice(4)).map((t) => t.Value);
  if (name === 'tag-key') return tags.map((t) => t.Key);
  if (name === 'tag-value') return tags.map((t) => t.Value);
  return undefined;
}

function applyFilters<T>(items: T[], filters: Json[] | undefined, getters: Record<string, Getter>): T[] {
  let out = items;
  for (const f of filters || []) {
    const name = String(f.Name ?? '');
    const values = asArray<unknown>(f.Values).map(String);
    if (!name || !values.length) throw err('InvalidParameterValue', `The filter '${name || 'null'}' is invalid`);
    if (!getters[name] && tagValues({}, name) === undefined) throw err('InvalidParameterValue', `The filter '${name}' is invalid`);
    out = out.filter((item) => {
      const got = tagValues(item, name) ?? asArray(getters[name](item));
      return got.some((g) => g !== undefined && g !== null && values.some((v) => globMatch(v, String(g))));
    });
  }
  return out;
}

function byIds<T extends Record<string, Json>>(items: T[], ids: string[] | undefined, key: string, code: string, noun: string): T[] {
  if (!ids?.length) return items;
  const missing = ids.filter((id) => !items.some((i) => i[key] === id));
  if (missing.length) {
    throw err(code, missing.length === 1 ? `The ${noun} ID '${missing[0]}' does not exist` : `The ${noun} IDs '${missing.join(', ')}' do not exist`);
  }
  return items.filter((i) => ids.includes(i[key]));
}

function checkId(id: string, prefix: string, code: string) {
  if (!new RegExp(`^${prefix}-[0-9a-f]{8,17}$`).test(id)) throw err(code, `Invalid id: "${id}"`);
}

// ── lookups ──────────────────────────────────────────────────────────

const arn = (ctx: Ctx, type: string, id: string) => `arn:aws:ec2:${ctx.region}:${ctx.st.accountId}:${type}/${id}`;

function allInstances(r: Ec2Region): Json[] {
  return r.reservations.flatMap((res) => res.Instances);
}

function instance(ctx: Ctx, id: string): Json {
  checkId(id, 'i', 'InvalidInstanceID.Malformed');
  const i = allInstances(ctx.ec2()).find((x) => x.InstanceId === id);
  if (!i) throw err('InvalidInstanceID.NotFound', `The instance ID '${id}' does not exist`);
  return i;
}

function vpc(ctx: Ctx, id: string): Json {
  const v = ctx.ec2().vpcs.find((x) => x.VpcId === id);
  if (!v) throw err('InvalidVpcID.NotFound', `The vpc ID '${id}' does not exist`);
  return v;
}

function subnet(ctx: Ctx, id: string): Json {
  const s = ctx.ec2().subnets.find((x) => x.SubnetId === id);
  if (!s) throw err('InvalidSubnetID.NotFound', `The subnet ID '${id}' does not exist`);
  return s;
}

function sg(ctx: Ctx, id: string): Json {
  const g = ctx.ec2().securityGroups.find((x) => x.GroupId === id);
  if (!g) throw err('InvalidGroup.NotFound', `The security group '${id}' does not exist`);
  return g;
}

function igw(ctx: Ctx, id: string): Json {
  const g = ctx.ec2().internetGateways.find((x) => x.InternetGatewayId === id);
  if (!g) throw err('InvalidInternetGatewayID.NotFound', `The internetGateway ID '${id}' does not exist`);
  return g;
}

function rtb(ctx: Ctx, id: string): Json {
  const t = ctx.ec2().routeTables.find((x) => x.RouteTableId === id);
  if (!t) throw err('InvalidRouteTableID.NotFound', `The routeTable ID '${id}' does not exist`);
  return t;
}

function volume(ctx: Ctx, id: string): Json {
  const v = ctx.ec2().volumes.find((x) => x.VolumeId === id);
  if (!v) throw err('InvalidVolume.NotFound', `The volume '${id}' does not exist.`);
  return v;
}

const defaultVpc = (r: Ec2Region) => r.vpcs.find((v) => v.IsDefault);

/** Every taggable resource of the region, by id. */
function findResource(r: Ec2Region, id: string): { item: Json; type: string } | undefined {
  const lists: [Json[], string, string][] = [
    [r.vpcs, 'VpcId', 'vpc'],
    [r.subnets, 'SubnetId', 'subnet'],
    [r.internetGateways, 'InternetGatewayId', 'internet-gateway'],
    [r.routeTables, 'RouteTableId', 'route-table'],
    [r.securityGroups, 'GroupId', 'security-group'],
    [r.keyPairs, 'KeyPairId', 'key-pair'],
    [allInstances(r), 'InstanceId', 'instance'],
    [r.volumes, 'VolumeId', 'volume'],
    [r.addresses, 'AllocationId', 'elastic-ip'],
  ];
  for (const [items, key, type] of lists) {
    const item = items.find((i) => i[key] === id);
    if (item) return { item, type };
  }
  return undefined;
}

function setTags(item: Json, tags: Tag[]) {
  const current: Tag[] = item.Tags || [];
  for (const t of tags) {
    const i = current.findIndex((c) => c.Key === t.Key);
    if (i >= 0) current[i] = t;
    else current.push(t);
  }
  item.Tags = current;
}

const tagOpt = opt('tag-specifications', 'structs', "ResourceType=<tipo>,Tags=[{Key=Name,Value=<valor>}]");

function publicIp(st: PlaygroundState): string {
  const h = hexChars(st, 6);
  const first = [3, 18, 34, 52, 54][parseInt(h[0], 16) % 5];
  return `${first}.${parseInt(h.slice(1, 3), 16)}.${parseInt(h.slice(3, 5), 16)}.${(parseInt(h.slice(5), 16) % 250) + 2}`;
}

const dnsFor = (region: string, ip: string, pub: boolean) =>
  pub
    ? `ec2-${ip.replace(/\./g, '-')}.${region === 'us-east-1' ? 'compute-1' : region + '.compute'}.amazonaws.com`
    : `ip-${ip.replace(/\./g, '-')}.${region === 'us-east-1' ? 'ec2' : region + '.compute'}.internal`;

// ── state transitions ────────────────────────────────────────────────

/** Completes transitions started by previous commands (pending → running…). */
export function advanceEc2(st: PlaygroundState) {
  for (const [region, r] of Object.entries(st.ec2)) {
    for (const i of allInstances(r)) {
      const next: string | undefined = i._next;
      if (!next) continue;
      delete i._next;
      i.State = state(next);
      if (next === 'running') {
        delete i.StateReason;
        i.StateTransitionReason = '';
        if (i.MetadataOptions) i.MetadataOptions.State = 'applied';
        for (const n of i.NetworkInterfaces || []) if (n.Attachment) n.Attachment.Status = 'attached';
        if (i._public && !i.PublicIpAddress) {
          const ip = publicIp(st);
          i.PublicIpAddress = ip;
          i.PublicDnsName = dnsFor(region, ip, true);
          for (const n of i.NetworkInterfaces || []) n.Association = { IpOwnerId: 'amazon', PublicDnsName: i.PublicDnsName, PublicIp: ip };
        }
      }
      if (next === 'stopped' || next === 'terminated') {
        const eip = r.addresses.find((a) => a.InstanceId === i.InstanceId);
        if (!eip || next === 'terminated') {
          delete i.PublicIpAddress;
          i.PublicDnsName = '';
          for (const n of i.NetworkInterfaces || []) delete n.Association;
        }
        if (eip && next === 'terminated') {
          delete eip.InstanceId;
          delete eip.AssociationId;
          delete eip.PrivateIpAddress;
          delete eip.NetworkInterfaceId;
        }
        i.StateReason = { Code: 'Client.UserInitiatedShutdown', Message: 'Client.UserInitiatedShutdown: User initiated shutdown' };
      }
      if (next === 'terminated') {
        i.NetworkInterfaces = [];
        i.SecurityGroups = [];
        delete i.PrivateIpAddress;
        i.PrivateDnsName = '';
        delete i.SubnetId;
        delete i.VpcId;
        for (const v of r.volumes) {
          const att = v.Attachments?.find((x: Json) => x.InstanceId === i.InstanceId);
          if (!att) continue;
          if (att.DeleteOnTermination) v._deleted = true;
          v.Attachments = [];
          v.State = 'available';
        }
        r.volumes = r.volumes.filter((v) => !v._deleted);
        i.BlockDeviceMappings = [];
      }
    }
    for (const v of r.volumes) {
      if (v.State === 'creating') v.State = 'available';
      for (const a of v.Attachments || []) if (a.State === 'attaching') a.State = 'attached';
      if (v._detaching) {
        delete v._detaching;
        v.Attachments = [];
        v.State = 'available';
      }
    }
    for (const x of r.vpcs) if (x.State === 'pending') x.State = 'available';
  }
}

// ── security group rules ─────────────────────────────────────────────

interface Rule {
  IpProtocol: string;
  FromPort?: number;
  ToPort?: number;
  cidr?: string;
  group?: string;
}

function rulesFromArgs(a: Args): Rule[] {
  if (a['ip-permissions']) {
    const rules: Rule[] = [];
    for (const p of a['ip-permissions'] as Json[]) {
      const proto = String(p.IpProtocol ?? '-1');
      const base = { IpProtocol: proto, ...(proto === '-1' ? {} : { FromPort: Number(p.FromPort), ToPort: Number(p.ToPort) }) };
      for (const r of asArray<Json>(p.IpRanges)) rules.push({ ...base, cidr: String(r.CidrIp) });
      for (const g of asArray<Json>(p.UserIdGroupPairs)) rules.push({ ...base, group: String(g.GroupId) });
    }
    return rules;
  }
  const protoArg = String(a.protocol ?? '');
  if (!protoArg) throw err('MissingParameter', 'The request must contain the parameter ipPermissions');
  const proto = protoArg === 'all' ? '-1' : protoArg;
  let from: number | undefined;
  let to: number | undefined;
  if (proto !== '-1') {
    const port = String(a.port ?? '');
    if (!port) throw err('InvalidParameterValue', 'Invalid value \'Must specify both from and to ports with TCP/UDP.\' for portRange.');
    const [x, y] = port.split('-');
    from = Number(x);
    to = y === undefined ? from : Number(y);
    if (port === '-1') {
      from = -1;
      to = -1;
    }
  }
  const base = { IpProtocol: proto, ...(proto === '-1' ? {} : { FromPort: from, ToPort: to }) };
  if (a['source-group']) return [{ ...base, group: a['source-group'] }];
  return [{ ...base, cidr: a.cidr ?? '0.0.0.0/0' }];
}

const sameRange = (p: Json, r: Rule) => p.IpProtocol === r.IpProtocol && p.FromPort === r.FromPort && p.ToPort === r.ToPort;

function describeRule(r: Rule): string {
  const proto = r.IpProtocol === '-1' ? 'ALL' : r.IpProtocol.toUpperCase();
  return `peer: ${r.cidr ?? r.group}, ${proto}, from port: ${r.FromPort ?? 'None'}, to port: ${r.ToPort ?? 'None'}, ALLOW`;
}

function resolveGroup(ctx: Ctx, a: Args): Json {
  if (a['group-id']) return sg(ctx, a['group-id']);
  if (a['group-name']) {
    const dv = defaultVpc(ctx.ec2());
    const g = ctx.ec2().securityGroups.find((x) => x.GroupName === a['group-name'] && x.VpcId === dv?.VpcId);
    if (!g) throw err('InvalidGroup.NotFound', `The security group '${a['group-name']}' does not exist in default VPC '${dv?.VpcId ?? 'none'}'`);
    return g;
  }
  throw err('MissingParameter', 'The request must contain the parameter groupName or groupId');
}

const ruleOpts = [
  opt('group-id', 'string'),
  opt('group-name', 'string'),
  opt('protocol', 'string', 'tcp | udp | icmp | all'),
  opt('port', 'string', 'Puerto o rango (22, 8000-8100)'),
  opt('cidr', 'string', 'Origen en CIDR (0.0.0.0/0)'),
  opt('source-group', 'string', 'Otro security group como origen'),
  opt('ip-permissions', 'structs', 'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0}]', { coerce: true }),
];

// ── instances ────────────────────────────────────────────────────────

function nextPrivateIp(r: Ec2Region, s: Json): string {
  const c = parseCidr(s.CidrBlock)!;
  const used = new Set(allInstances(r).map((i) => i.PrivateIpAddress));
  for (let n = 4 + 6; n < 2 ** (32 - c.bits) - 1; n++) {
    const ip = ipToString(c.base + n);
    if (!used.has(ip)) return ip;
  }
  throw err('InsufficientFreeAddressesInSubnet', `There are not enough free addresses in subnet '${s.SubnetId}' to satisfy the requested number of instances.`);
}

function transition(ctx: Ctx, ids: string[], action: string, key: string, fn: (i: Json) => string | undefined) {
  const list = ids.map((id) => instance(ctx, id));
  for (const i of list) ctx.authorize(action, arn(ctx, 'instance', i.InstanceId));
  if (ctx.dryRun) throw err('DryRunOperation', 'Request would have succeeded, but DryRun flag is set.');
  const out = list.map((i) => {
    const prev = i.State.Name;
    const cur = fn(i) ?? prev;
    return { CurrentState: state(cur), InstanceId: i.InstanceId, PreviousState: state(prev) };
  });
  return { [key]: out };
}

const describe = (name: string, action: string, help: string, run: (a: Args, ctx: Ctx) => Json, opts = [opt('filters', 'structs')]): Op => ({
  name,
  help,
  opts,
  action,
  run,
});

export const ec2: Service = {
  name: 'ec2',
  help: 'Máquinas virtuales, redes (VPC), security groups, claves y volúmenes (EC2)',
  ops: [
    // ── regions, zones, images, types ──
    describe('describe-regions', 'ec2:DescribeRegions', 'Lista las regiones de AWS.', (a) => {
      let regions = REGIONS.filter((r) => a['all-regions'] || !r.optIn);
      if (a['region-names']) regions = REGIONS.filter((r) => a['region-names'].includes(r.name));
      const items = regions.map((r) => ({
        OptInStatus: r.optIn ? 'not-opted-in' : 'opt-in-not-required',
        RegionName: r.name,
        Endpoint: `ec2.${r.name}.amazonaws.com`,
      }));
      return { Regions: applyFilters(items, a.filters, { 'region-name': (i) => i.RegionName, 'opt-in-status': (i) => i.OptInStatus, endpoint: (i) => i.Endpoint }) };
    }, [opt('region-names', 'strings'), opt('all-regions', 'bool'), opt('filters', 'structs')]),
    describe('describe-availability-zones', 'ec2:DescribeAvailabilityZones', 'Zonas de disponibilidad de la región actual.', (a, ctx) => {
      const items = availabilityZones(ctx.region).map((z) => ({
        OptInStatus: 'opt-in-not-required',
        Messages: [],
        RegionName: ctx.region,
        ZoneName: z.ZoneName,
        ZoneId: z.ZoneId,
        GroupName: ctx.region,
        NetworkBorderGroup: ctx.region,
        ZoneType: 'availability-zone',
        State: 'available',
      }));
      return { AvailabilityZones: applyFilters(items, a.filters, { 'zone-name': (i) => i.ZoneName, 'zone-id': (i) => i.ZoneId, state: (i) => i.State, 'region-name': (i) => i.RegionName }) };
    }),
    describe('describe-images', 'ec2:DescribeImages', 'Busca AMIs (imágenes). Usa --owners amazon y --filters Name=name,Values=al2023-ami-*.', (a, ctx) => {
      let items = IMAGES.map((img) => describeImage(ctx.region, img));
      if (a['image-ids']) {
        for (const id of a['image-ids']) checkId(id, 'ami', 'InvalidAMIID.Malformed');
        items = byIds(items, a['image-ids'], 'ImageId', 'InvalidAMIID.NotFound', 'image');
      }
      if (a.owners) {
        const owners: string[] = a.owners;
        items = items.filter((i) => owners.some((o) => o === i.OwnerId || o === i.ImageOwnerAlias));
      }
      return {
        Images: applyFilters(items, a.filters, {
          name: (i) => i.Name,
          'image-id': (i) => i.ImageId,
          architecture: (i) => i.Architecture,
          'owner-alias': (i) => i.ImageOwnerAlias,
          'owner-id': (i) => i.OwnerId,
          'platform-details': (i) => i.PlatformDetails,
          platform: (i) => i.Platform,
          state: (i) => i.State,
          'root-device-type': (i) => i.RootDeviceType,
          'virtualization-type': (i) => i.VirtualizationType,
        }),
      };
    }, [opt('image-ids', 'strings'), opt('owners', 'strings'), opt('filters', 'structs')]),
    describe('describe-instance-types', 'ec2:DescribeInstanceTypes', 'CPU, memoria y arquitectura de los tipos de instancia.', (a) => {
      let names = Object.keys(INSTANCE_TYPES);
      if (a['instance-types']) {
        const bad = a['instance-types'].filter((t: string) => !INSTANCE_TYPES[t]);
        if (bad.length) throw err('InvalidInstanceType', `The following supplied instance types do not exist: [${bad.join(', ')}]`);
        names = a['instance-types'];
      }
      const items = names.map((n) => {
        const t = INSTANCE_TYPES[n];
        return {
          InstanceType: n,
          CurrentGeneration: !n.startsWith('t2'),
          FreeTierEligible: n === 't2.micro' || n === 't3.micro',
          ProcessorInfo: { SupportedArchitectures: [t.arch] },
          VCpuInfo: { DefaultVCpus: t.vcpu },
          MemoryInfo: { SizeInMiB: t.mem },
        };
      });
      return {
        InstanceTypes: applyFilters(items, a.filters, {
          'free-tier-eligible': (i) => String(i.FreeTierEligible),
          'processor-info.supported-architecture': (i) => i.ProcessorInfo.SupportedArchitectures,
          'instance-type': (i) => i.InstanceType,
          'current-generation': (i) => String(i.CurrentGeneration),
        }),
      };
    }, [opt('instance-types', 'strings'), opt('filters', 'structs')]),

    // ── VPC ──
    {
      name: 'create-vpc',
      help: 'Crea una VPC (red privada) con un rango CIDR entre /16 y /28.',
      opts: [req('cidr-block', 'string'), opt('instance-tenancy', 'string'), tagOpt],
      action: 'ec2:CreateVpc',
      resource: (_a, ctx) => arn(ctx, 'vpc', '*'),
      example: 'aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=lab}]"',
      run: (a, ctx) => {
        const c = parseCidr(a['cidr-block']);
        if (!c || c.bits < 16 || c.bits > 28) throw err('InvalidVpc.Range', `The CIDR '${a['cidr-block']}' is invalid.`);
        const r = ctx.ec2();
        const id = ec2Id(ctx.st, 'vpc');
        const tags = tagsFromSpecs(a['tag-specifications'], 'vpc');
        const v = {
          CidrBlock: a['cidr-block'],
          DhcpOptionsId: r.vpcs[0]?.DhcpOptionsId ?? ec2Id(ctx.st, 'dopt'),
          State: 'pending',
          VpcId: id,
          OwnerId: ctx.st.accountId,
          InstanceTenancy: a['instance-tenancy'] ?? 'default',
          Ipv6CidrBlockAssociationSet: [],
          CidrBlockAssociationSet: [{ AssociationId: ec2Id(ctx.st, 'vpc-cidr-assoc'), CidrBlock: a['cidr-block'], CidrBlockState: { State: 'associated' } }],
          IsDefault: false,
          ...(tags ? { Tags: tags } : {}),
        };
        r.vpcs.push(v);
        r.routeTables.push(mainRouteTable(ctx.st, id, a['cidr-block']));
        r.securityGroups.push(defaultSecurityGroup(ctx.st, ctx.region, id));
        return { Vpc: { ...v } };
      },
    },
    describe('describe-vpcs', 'ec2:DescribeVpcs', 'Lista las VPC de la región.', (a, ctx) => {
      const items = byIds(ctx.ec2().vpcs, a['vpc-ids'], 'VpcId', 'InvalidVpcID.NotFound', 'vpc');
      return {
        Vpcs: applyFilters(items, a.filters, {
          'vpc-id': (i) => i.VpcId,
          'cidr-block': (i) => i.CidrBlock,
          cidr: (i) => i.CidrBlock,
          'is-default': (i) => String(i.IsDefault),
          state: (i) => i.State,
          'owner-id': (i) => i.OwnerId,
        }),
      };
    }, [opt('vpc-ids', 'strings'), opt('filters', 'structs')]),
    {
      name: 'delete-vpc',
      help: 'Borra una VPC (antes hay que borrar subredes, gateways, security groups y tablas de rutas).',
      opts: [req('vpc-id', 'string')],
      action: 'ec2:DeleteVpc',
      resource: (a, ctx) => arn(ctx, 'vpc', a['vpc-id']),
      run: (a, ctx) => {
        const v = vpc(ctx, a['vpc-id']);
        const r = ctx.ec2();
        const dependent =
          r.subnets.some((s) => s.VpcId === v.VpcId) ||
          r.internetGateways.some((g) => g.Attachments.some((x: Json) => x.VpcId === v.VpcId)) ||
          r.securityGroups.some((g) => g.VpcId === v.VpcId && g.GroupName !== 'default') ||
          r.routeTables.some((t) => t.VpcId === v.VpcId && !t.Associations.some((x: Json) => x.Main));
        if (dependent) throw err('DependencyViolation', `The vpc '${v.VpcId}' has dependencies and cannot be deleted.`);
        r.vpcs = r.vpcs.filter((x) => x !== v);
        r.routeTables = r.routeTables.filter((t) => t.VpcId !== v.VpcId);
        r.securityGroups = r.securityGroups.filter((g) => g.VpcId !== v.VpcId);
        return undefined;
      },
    },

    // ── subnets ──
    {
      name: 'create-subnet',
      help: 'Crea una subred dentro de una VPC, en una zona de disponibilidad.',
      opts: [req('vpc-id', 'string'), req('cidr-block', 'string'), opt('availability-zone', 'string'), tagOpt],
      action: 'ec2:CreateSubnet',
      resource: (a, ctx) => arn(ctx, 'vpc', a['vpc-id']),
      example: 'aws ec2 create-subnet --vpc-id vpc-… --cidr-block 10.0.1.0/24 --availability-zone eu-west-1a',
      run: (a, ctx) => {
        const v = vpc(ctx, a['vpc-id']);
        const r = ctx.ec2();
        const c = parseCidr(a['cidr-block']);
        if (!c || c.bits < 16 || c.bits > 28 || !cidrContains(v.CidrBlock, a['cidr-block'])) {
          throw err('InvalidSubnet.Range', `The CIDR '${a['cidr-block']}' is invalid.`);
        }
        if (r.subnets.some((s) => s.VpcId === v.VpcId && cidrOverlaps(s.CidrBlock, a['cidr-block']))) {
          throw err('InvalidSubnet.Conflict', `The CIDR '${a['cidr-block']}' conflicts with another subnet`);
        }
        const zones = availabilityZones(ctx.region);
        const zone = a['availability-zone'] ? zones.find((z) => z.ZoneName === a['availability-zone']) : zones[r.subnets.length % zones.length];
        if (!zone) throw err('InvalidParameterValue', `Value (${a['availability-zone']}) for parameter availabilityZone is invalid. Subnets can currently only be created in the following availability zones: ${zones.map((z) => z.ZoneName).join(', ')}.`);
        const id = ec2Id(ctx.st, 'subnet');
        const tags = tagsFromSpecs(a['tag-specifications'], 'subnet');
        const s = {
          AvailabilityZone: zone.ZoneName,
          AvailabilityZoneId: zone.ZoneId,
          AvailableIpAddressCount: 2 ** (32 - c.bits) - 5,
          CidrBlock: a['cidr-block'],
          DefaultForAz: false,
          MapPublicIpOnLaunch: false,
          State: 'available',
          SubnetId: id,
          VpcId: v.VpcId,
          OwnerId: ctx.st.accountId,
          AssignIpv6AddressOnCreation: false,
          Ipv6CidrBlockAssociationSet: [],
          ...(tags ? { Tags: tags } : {}),
          SubnetArn: arn(ctx, 'subnet', id),
          EnableDns64: false,
          Ipv6Native: false,
          PrivateDnsNameOptionsOnLaunch: { HostnameType: 'ip-name', EnableResourceNameDnsARecord: false, EnableResourceNameDnsAAAARecord: false },
        };
        r.subnets.push(s);
        return { Subnet: { ...s } };
      },
    },
    describe('describe-subnets', 'ec2:DescribeSubnets', 'Lista las subredes.', (a, ctx) => {
      const items = byIds(ctx.ec2().subnets, a['subnet-ids'], 'SubnetId', 'InvalidSubnetID.NotFound', 'subnet');
      return {
        Subnets: applyFilters(items, a.filters, {
          'subnet-id': (i) => i.SubnetId,
          'vpc-id': (i) => i.VpcId,
          'availability-zone': (i) => i.AvailabilityZone,
          'cidr-block': (i) => i.CidrBlock,
          'default-for-az': (i) => String(i.DefaultForAz),
          'map-public-ip-on-launch': (i) => String(i.MapPublicIpOnLaunch),
          state: (i) => i.State,
        }),
      };
    }, [opt('subnet-ids', 'strings'), opt('filters', 'structs')]),
    {
      name: 'modify-subnet-attribute',
      help: 'Cambia atributos de la subred, p. ej. --map-public-ip-on-launch (subred pública).',
      opts: [req('subnet-id', 'string'), opt('map-public-ip-on-launch', 'bool')],
      action: 'ec2:ModifySubnetAttribute',
      resource: (a, ctx) => arn(ctx, 'subnet', a['subnet-id']),
      run: (a, ctx) => {
        const s = subnet(ctx, a['subnet-id']);
        if (a['map-public-ip-on-launch'] === undefined) throw err('MissingParameter', 'The request must contain exactly one attribute to modify');
        s.MapPublicIpOnLaunch = a['map-public-ip-on-launch'];
        return undefined;
      },
    },
    {
      name: 'delete-subnet',
      help: 'Borra una subred sin instancias.',
      opts: [req('subnet-id', 'string')],
      action: 'ec2:DeleteSubnet',
      resource: (a, ctx) => arn(ctx, 'subnet', a['subnet-id']),
      run: (a, ctx) => {
        const s = subnet(ctx, a['subnet-id']);
        const r = ctx.ec2();
        if (allInstances(r).some((i) => i.SubnetId === s.SubnetId && i.State.Name !== 'terminated')) {
          throw err('DependencyViolation', `The subnet '${s.SubnetId}' has dependencies and cannot be deleted.`);
        }
        r.subnets = r.subnets.filter((x) => x !== s);
        for (const t of r.routeTables) t.Associations = t.Associations.filter((x: Json) => x.SubnetId !== s.SubnetId);
        return undefined;
      },
    },

    // ── internet gateways ──
    {
      name: 'create-internet-gateway',
      help: 'Crea un internet gateway (salida a Internet de una VPC).',
      opts: [tagOpt],
      action: 'ec2:CreateInternetGateway',
      resource: (_a, ctx) => arn(ctx, 'internet-gateway', '*'),
      run: (a, ctx) => {
        const tags = tagsFromSpecs(a['tag-specifications'], 'internet-gateway');
        const g = { Attachments: [], InternetGatewayId: ec2Id(ctx.st, 'igw'), OwnerId: ctx.st.accountId, Tags: tags ?? [] };
        ctx.ec2().internetGateways.push(g);
        return { InternetGateway: { ...g } };
      },
    },
    {
      name: 'attach-internet-gateway',
      help: 'Conecta un internet gateway a una VPC.',
      opts: [req('internet-gateway-id', 'string'), req('vpc-id', 'string')],
      action: 'ec2:AttachInternetGateway',
      resource: (a, ctx) => arn(ctx, 'internet-gateway', a['internet-gateway-id']),
      run: (a, ctx) => {
        const g = igw(ctx, a['internet-gateway-id']);
        const v = vpc(ctx, a['vpc-id']);
        if (g.Attachments.length) throw err('Resource.AlreadyAssociated', `resource ${g.InternetGatewayId} is already attached to network ${g.Attachments[0].VpcId}`);
        const other = ctx.ec2().internetGateways.find((x) => x.Attachments.some((y: Json) => y.VpcId === v.VpcId));
        if (other) throw err('Resource.AlreadyAssociated', `Network ${v.VpcId} already has an internet gateway attached`);
        g.Attachments = [{ State: 'available', VpcId: v.VpcId }];
        return undefined;
      },
    },
    {
      name: 'detach-internet-gateway',
      help: 'Desconecta un internet gateway de su VPC.',
      opts: [req('internet-gateway-id', 'string'), req('vpc-id', 'string')],
      action: 'ec2:DetachInternetGateway',
      resource: (a, ctx) => arn(ctx, 'internet-gateway', a['internet-gateway-id']),
      run: (a, ctx) => {
        const g = igw(ctx, a['internet-gateway-id']);
        if (!g.Attachments.some((x: Json) => x.VpcId === a['vpc-id'])) throw err('Gateway.NotAttached', `resource ${g.InternetGatewayId} is not attached to network ${a['vpc-id']}`);
        g.Attachments = [];
        return undefined;
      },
    },
    {
      name: 'delete-internet-gateway',
      help: 'Borra un internet gateway desconectado.',
      opts: [req('internet-gateway-id', 'string')],
      action: 'ec2:DeleteInternetGateway',
      resource: (a, ctx) => arn(ctx, 'internet-gateway', a['internet-gateway-id']),
      run: (a, ctx) => {
        const g = igw(ctx, a['internet-gateway-id']);
        if (g.Attachments.length) throw err('DependencyViolation', `The internetGateway '${g.InternetGatewayId}' has dependencies and cannot be deleted.`);
        const r = ctx.ec2();
        r.internetGateways = r.internetGateways.filter((x) => x !== g);
        return undefined;
      },
    },
    describe('describe-internet-gateways', 'ec2:DescribeInternetGateways', 'Lista los internet gateways.', (a, ctx) => {
      const items = byIds(ctx.ec2().internetGateways, a['internet-gateway-ids'], 'InternetGatewayId', 'InvalidInternetGatewayID.NotFound', 'internetGateway');
      return {
        InternetGateways: applyFilters(items, a.filters, {
          'internet-gateway-id': (i) => i.InternetGatewayId,
          'attachment.vpc-id': (i) => i.Attachments.map((x: Json) => x.VpcId),
          'attachment.state': (i) => i.Attachments.map((x: Json) => x.State),
        }),
      };
    }, [opt('internet-gateway-ids', 'strings'), opt('filters', 'structs')]),

    // ── route tables ──
    {
      name: 'create-route-table',
      help: 'Crea una tabla de rutas en una VPC.',
      opts: [req('vpc-id', 'string'), tagOpt],
      action: 'ec2:CreateRouteTable',
      resource: (a, ctx) => arn(ctx, 'vpc', a['vpc-id']),
      run: (a, ctx) => {
        const v = vpc(ctx, a['vpc-id']);
        const t = mainRouteTable(ctx.st, v.VpcId, v.CidrBlock);
        t.Associations = [];
        const tags = tagsFromSpecs(a['tag-specifications'], 'route-table');
        if (tags) t.Tags = tags;
        ctx.ec2().routeTables.push(t);
        return { RouteTable: { ...t } };
      },
    },
    {
      name: 'create-route',
      help: 'Añade una ruta, p. ej. 0.0.0.0/0 hacia el internet gateway.',
      opts: [req('route-table-id', 'string'), req('destination-cidr-block', 'string'), opt('gateway-id', 'string')],
      action: 'ec2:CreateRoute',
      resource: (a, ctx) => arn(ctx, 'route-table', a['route-table-id']),
      run: (a, ctx) => {
        const t = rtb(ctx, a['route-table-id']);
        if (!parseCidr(a['destination-cidr-block'])) throw err('InvalidParameterValue', `Value (${a['destination-cidr-block']}) for parameter destinationCidrBlock is invalid. This is not a valid CIDR block.`);
        if (!a['gateway-id']) throw err('InvalidParameterCombination', 'No route target specified');
        const g = igw(ctx, a['gateway-id']);
        if (!g.Attachments.some((x: Json) => x.VpcId === t.VpcId)) {
          throw err('InvalidParameterValue', `route table ${t.RouteTableId} and network gateway ${g.InternetGatewayId} belong to different networks`);
        }
        if (t.Routes.some((r: Json) => r.DestinationCidrBlock === a['destination-cidr-block'])) {
          throw err('RouteAlreadyExists', `The route identified by ${a['destination-cidr-block']} already exists.`);
        }
        t.Routes.push({ DestinationCidrBlock: a['destination-cidr-block'], GatewayId: g.InternetGatewayId, Origin: 'CreateRoute', State: 'active' });
        return { Return: true };
      },
    },
    {
      name: 'delete-route',
      help: 'Quita una ruta.',
      opts: [req('route-table-id', 'string'), req('destination-cidr-block', 'string')],
      action: 'ec2:DeleteRoute',
      resource: (a, ctx) => arn(ctx, 'route-table', a['route-table-id']),
      run: (a, ctx) => {
        const t = rtb(ctx, a['route-table-id']);
        const r = t.Routes.find((x: Json) => x.DestinationCidrBlock === a['destination-cidr-block'] && x.GatewayId !== 'local');
        if (!r) throw err('InvalidRoute.NotFound', `no route with destination-cidr-block ${a['destination-cidr-block']} in route table ${t.RouteTableId}`);
        t.Routes = t.Routes.filter((x: Json) => x !== r);
        return undefined;
      },
    },
    {
      name: 'associate-route-table',
      help: 'Asocia una tabla de rutas a una subred.',
      opts: [req('route-table-id', 'string'), req('subnet-id', 'string')],
      action: 'ec2:AssociateRouteTable',
      resource: (a, ctx) => arn(ctx, 'route-table', a['route-table-id']),
      run: (a, ctx) => {
        const t = rtb(ctx, a['route-table-id']);
        const s = subnet(ctx, a['subnet-id']);
        if (s.VpcId !== t.VpcId) throw err('InvalidParameterValue', `routetable ${t.RouteTableId} and subnet ${s.SubnetId} belong to different networks`);
        const existing = ctx.ec2().routeTables.find((x) => x.Associations.some((y: Json) => y.SubnetId === s.SubnetId));
        if (existing) throw err('Resource.AlreadyAssociated', `the specified association for route table ${existing.RouteTableId} conflicts with an existing association`);
        const id = ec2Id(ctx.st, 'rtbassoc');
        t.Associations.push({ Main: false, RouteTableAssociationId: id, RouteTableId: t.RouteTableId, SubnetId: s.SubnetId, AssociationState: { State: 'associated' } });
        return { AssociationId: id, AssociationState: { State: 'associated' } };
      },
    },
    {
      name: 'disassociate-route-table',
      help: 'Deshace una asociación entre tabla de rutas y subred.',
      opts: [req('association-id', 'string')],
      action: 'ec2:DisassociateRouteTable',
      run: (a, ctx) => {
        const t = ctx.ec2().routeTables.find((x) => x.Associations.some((y: Json) => y.RouteTableAssociationId === a['association-id'] && !y.Main));
        if (!t) throw err('InvalidAssociationID.NotFound', `The association ID '${a['association-id']}' does not exist`);
        t.Associations = t.Associations.filter((y: Json) => y.RouteTableAssociationId !== a['association-id']);
        return undefined;
      },
    },
    describe('describe-route-tables', 'ec2:DescribeRouteTables', 'Lista las tablas de rutas.', (a, ctx) => {
      const items = byIds(ctx.ec2().routeTables, a['route-table-ids'], 'RouteTableId', 'InvalidRouteTableID.NotFound', 'routeTable');
      return {
        RouteTables: applyFilters(items, a.filters, {
          'route-table-id': (i) => i.RouteTableId,
          'vpc-id': (i) => i.VpcId,
          'association.main': (i) => i.Associations.map((x: Json) => String(!!x.Main)),
          'association.subnet-id': (i) => i.Associations.map((x: Json) => x.SubnetId),
          'route.gateway-id': (i) => i.Routes.map((x: Json) => x.GatewayId),
        }),
      };
    }, [opt('route-table-ids', 'strings'), opt('filters', 'structs')]),
    {
      name: 'delete-route-table',
      help: 'Borra una tabla de rutas sin asociaciones.',
      opts: [req('route-table-id', 'string')],
      action: 'ec2:DeleteRouteTable',
      resource: (a, ctx) => arn(ctx, 'route-table', a['route-table-id']),
      run: (a, ctx) => {
        const t = rtb(ctx, a['route-table-id']);
        if (t.Associations.length) throw err('DependencyViolation', `The routeTable '${t.RouteTableId}' has dependencies and cannot be deleted.`);
        const r = ctx.ec2();
        r.routeTables = r.routeTables.filter((x) => x !== t);
        return undefined;
      },
    },

    // ── security groups ──
    {
      name: 'create-security-group',
      help: 'Crea un security group (cortafuegos de instancia). Sin --vpc-id va a la VPC por defecto.',
      opts: [req('group-name', 'string'), req('description', 'string'), opt('vpc-id', 'string'), tagOpt],
      action: 'ec2:CreateSecurityGroup',
      resource: (_a, ctx) => arn(ctx, 'security-group', '*'),
      example: 'aws ec2 create-security-group --group-name web --description "HTTP y SSH"',
      run: (a, ctx) => {
        const r = ctx.ec2();
        const v = a['vpc-id'] ? vpc(ctx, a['vpc-id']) : defaultVpc(r);
        if (!v) throw err('VPCIdNotSpecified', 'No default VPC for this user');
        if (a['group-name'] === 'default' || a['group-name'].startsWith('sg-')) {
          throw err('InvalidParameterValue', `Group names may not be in the format sg-* or be named 'default'.`);
        }
        if (r.securityGroups.some((g) => g.VpcId === v.VpcId && g.GroupName === a['group-name'])) {
          throw err('InvalidGroup.Duplicate', `The security group '${a['group-name']}' already exists for VPC '${v.VpcId}'`);
        }
        const id = ec2Id(ctx.st, 'sg');
        const tags = tagsFromSpecs(a['tag-specifications'], 'security-group');
        r.securityGroups.push({
          Description: a.description,
          GroupName: a['group-name'],
          IpPermissions: [],
          OwnerId: ctx.st.accountId,
          GroupId: id,
          IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], PrefixListIds: [], UserIdGroupPairs: [] }],
          ...(tags ? { Tags: tags } : {}),
          VpcId: v.VpcId,
          SecurityGroupArn: arn(ctx, 'security-group', id),
        });
        return { GroupId: id, ...(tags ? { Tags: tags } : {}), SecurityGroupArn: arn(ctx, 'security-group', id) };
      },
    },
    describe('describe-security-groups', 'ec2:DescribeSecurityGroups', 'Lista los security groups y sus reglas.', (a, ctx) => {
      let items = byIds(ctx.ec2().securityGroups, a['group-ids'], 'GroupId', 'InvalidGroup.NotFound', 'security group');
      if (a['group-names']) {
        const dv = defaultVpc(ctx.ec2());
        const missing = a['group-names'].filter((n: string) => !items.some((g) => g.GroupName === n && g.VpcId === dv?.VpcId));
        if (missing.length) throw err('InvalidGroup.NotFound', `The security group '${missing[0]}' does not exist in default VPC '${dv?.VpcId ?? 'none'}'`);
        items = items.filter((g) => a['group-names'].includes(g.GroupName) && g.VpcId === dv?.VpcId);
      }
      return {
        SecurityGroups: applyFilters(items, a.filters, {
          'group-name': (i) => i.GroupName,
          'group-id': (i) => i.GroupId,
          'vpc-id': (i) => i.VpcId,
          description: (i) => i.Description,
          'ip-permission.from-port': (i) => i.IpPermissions.map((p: Json) => p.FromPort),
          'ip-permission.cidr': (i) => i.IpPermissions.flatMap((p: Json) => p.IpRanges.map((r: Json) => r.CidrIp)),
        }),
      };
    }, [opt('group-ids', 'strings'), opt('group-names', 'strings'), opt('filters', 'structs')]),
    {
      name: 'authorize-security-group-ingress',
      help: 'Abre un puerto de entrada: --group-id sg-… --protocol tcp --port 22 --cidr 0.0.0.0/0',
      opts: ruleOpts,
      action: 'ec2:AuthorizeSecurityGroupIngress',
      resource: (a, ctx) => arn(ctx, 'security-group', a['group-id'] ?? '*'),
      example: 'aws ec2 authorize-security-group-ingress --group-id sg-… --protocol tcp --port 80 --cidr 0.0.0.0/0',
      run: (a, ctx) => {
        const g = resolveGroup(ctx, a);
        const added: Json[] = [];
        for (const r of rulesFromArgs(a)) {
          if (r.cidr && !parseCidr(r.cidr)) throw err('InvalidParameterValue', `CIDR block ${r.cidr} is malformed`);
          if (r.group) sg(ctx, r.group);
          let perm = g.IpPermissions.find((p: Json) => sameRange(p, r));
          if (!perm) {
            perm = { IpProtocol: r.IpProtocol, ...(r.FromPort !== undefined ? { FromPort: r.FromPort, ToPort: r.ToPort } : {}), IpRanges: [], Ipv6Ranges: [], PrefixListIds: [], UserIdGroupPairs: [] };
            g.IpPermissions.push(perm);
          }
          const dup = r.cidr ? perm.IpRanges.some((x: Json) => x.CidrIp === r.cidr) : perm.UserIdGroupPairs.some((x: Json) => x.GroupId === r.group);
          if (dup) throw err('InvalidPermission.Duplicate', `the specified rule "${describeRule(r)}" already exists`);
          if (r.cidr) perm.IpRanges.push({ CidrIp: r.cidr });
          else perm.UserIdGroupPairs.push({ GroupId: r.group, UserId: ctx.st.accountId });
          const ruleId = ec2Id(ctx.st, 'sgr');
          added.push({
            SecurityGroupRuleId: ruleId,
            GroupId: g.GroupId,
            GroupOwnerId: ctx.st.accountId,
            IsEgress: false,
            IpProtocol: r.IpProtocol,
            FromPort: r.FromPort ?? -1,
            ToPort: r.ToPort ?? -1,
            ...(r.cidr ? { CidrIpv4: r.cidr } : { ReferencedGroupInfo: { GroupId: r.group, UserId: ctx.st.accountId } }),
            SecurityGroupRuleArn: arn(ctx, 'security-group-rule', ruleId),
          });
        }
        return { Return: true, SecurityGroupRules: added };
      },
    },
    {
      name: 'revoke-security-group-ingress',
      help: 'Cierra un puerto de entrada.',
      opts: ruleOpts,
      action: 'ec2:RevokeSecurityGroupIngress',
      resource: (a, ctx) => arn(ctx, 'security-group', a['group-id'] ?? '*'),
      run: (a, ctx) => {
        const g = resolveGroup(ctx, a);
        for (const r of rulesFromArgs(a)) {
          const perm = g.IpPermissions.find((p: Json) => sameRange(p, r));
          const has = perm && (r.cidr ? perm.IpRanges.some((x: Json) => x.CidrIp === r.cidr) : perm.UserIdGroupPairs.some((x: Json) => x.GroupId === r.group));
          if (!has) throw err('InvalidPermission.NotFound', 'The specified rule does not exist in this security group.');
          if (r.cidr) perm.IpRanges = perm.IpRanges.filter((x: Json) => x.CidrIp !== r.cidr);
          else perm.UserIdGroupPairs = perm.UserIdGroupPairs.filter((x: Json) => x.GroupId !== r.group);
          if (!perm.IpRanges.length && !perm.UserIdGroupPairs.length) g.IpPermissions = g.IpPermissions.filter((p: Json) => p !== perm);
        }
        return { Return: true };
      },
    },
    {
      name: 'delete-security-group',
      help: 'Borra un security group que no use ninguna instancia.',
      opts: [opt('group-id', 'string'), opt('group-name', 'string')],
      action: 'ec2:DeleteSecurityGroup',
      resource: (a, ctx) => arn(ctx, 'security-group', a['group-id'] ?? '*'),
      run: (a, ctx) => {
        const g = resolveGroup(ctx, a);
        if (g.GroupName === 'default') throw err('CannotDelete', `the specified group: "${g.GroupId}" name: "default" cannot be deleted by a user`);
        const r = ctx.ec2();
        const inUse =
          allInstances(r).some((i) => i.State.Name !== 'terminated' && i.SecurityGroups.some((x: Json) => x.GroupId === g.GroupId)) ||
          r.securityGroups.some((o) => o !== g && o.IpPermissions.some((p: Json) => p.UserIdGroupPairs.some((x: Json) => x.GroupId === g.GroupId)));
        if (inUse) throw err('DependencyViolation', `resource ${g.GroupId} has a dependent object`);
        r.securityGroups = r.securityGroups.filter((x) => x !== g);
        return { Return: true, GroupId: g.GroupId };
      },
    },

    // ── key pairs ──
    {
      name: 'create-key-pair',
      help: 'Crea un par de claves SSH. La clave privada solo se muestra una vez: guárdala con --query KeyMaterial --output text > clave.pem',
      opts: [req('key-name', 'string'), opt('key-type', 'string', '', { choices: ['rsa', 'ed25519'] }), opt('key-format', 'string', '', { choices: ['pem', 'ppk'] }), tagOpt],
      action: 'ec2:CreateKeyPair',
      resource: (a, ctx) => arn(ctx, 'key-pair', a['key-name']),
      example: 'aws ec2 create-key-pair --key-name lab --query KeyMaterial --output text > lab.pem',
      run: (a, ctx) => {
        const r = ctx.ec2();
        if (r.keyPairs.some((k) => k.KeyName === a['key-name'])) throw err('InvalidKeyPair.Duplicate', `The keypair already exists`);
        const type = a['key-type'] ?? 'rsa';
        const body = secretChars(ctx.st, type === 'rsa' ? 1600 : 380).match(/.{1,64}/g)!.join('\n');
        const material = type === 'rsa'
          ? `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`
          : `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
        const fingerprint = type === 'rsa'
          ? (hexChars(ctx.st, 40).match(/../g) as string[]).join(':')
          : secretChars(ctx.st, 43) + '=';
        const id = ec2Id(ctx.st, 'key');
        const tags = tagsFromSpecs(a['tag-specifications'], 'key-pair');
        r.keyPairs.push({ KeyPairId: id, KeyFingerprint: fingerprint, KeyName: a['key-name'], KeyType: type, Tags: tags ?? [], CreateTime: iso(ctx.now) });
        return { KeyFingerprint: fingerprint, KeyMaterial: material, KeyName: a['key-name'], KeyPairId: id, ...(tags ? { Tags: tags } : {}) };
      },
    },
    describe('describe-key-pairs', 'ec2:DescribeKeyPairs', 'Lista los pares de claves.', (a, ctx) => {
      let items = ctx.ec2().keyPairs;
      if (a['key-names']) {
        const missing = a['key-names'].filter((n: string) => !items.some((k) => k.KeyName === n));
        if (missing.length) throw err('InvalidKeyPair.NotFound', `The key pair '${missing[0]}' does not exist`);
        items = items.filter((k) => a['key-names'].includes(k.KeyName));
      }
      items = byIds(items, a['key-pair-ids'], 'KeyPairId', 'InvalidKeyPair.NotFound', 'key pair');
      return { KeyPairs: applyFilters(items, a.filters, { 'key-name': (i) => i.KeyName, 'key-pair-id': (i) => i.KeyPairId, 'key-type': (i) => i.KeyType }) };
    }, [opt('key-names', 'strings'), opt('key-pair-ids', 'strings'), opt('filters', 'structs')]),
    {
      name: 'delete-key-pair',
      help: 'Borra un par de claves.',
      opts: [opt('key-name', 'string'), opt('key-pair-id', 'string')],
      action: 'ec2:DeleteKeyPair',
      resource: (a, ctx) => arn(ctx, 'key-pair', a['key-name'] ?? a['key-pair-id'] ?? '*'),
      run: (a, ctx) => {
        const r = ctx.ec2();
        if (!a['key-name'] && !a['key-pair-id']) throw err('MissingParameter', 'The request must contain the parameter KeyName or KeyPairId');
        const k = r.keyPairs.find((x) => x.KeyName === a['key-name'] || x.KeyPairId === a['key-pair-id']);
        r.keyPairs = r.keyPairs.filter((x) => x !== k);
        return { Return: true, ...(k ? { KeyPairId: k.KeyPairId } : {}) };
      },
    },

    // ── instances ──
    {
      name: 'run-instances',
      help: 'Lanza instancias EC2 a partir de una AMI.',
      opts: [
        req('image-id', 'string'),
        opt('instance-type', 'string', 't3.micro, t2.micro…'),
        opt('count', 'string', 'Número (2) o rango (1:3)'),
        opt('key-name', 'string'),
        opt('security-group-ids', 'strings'),
        opt('security-groups', 'strings', 'Nombres (solo VPC por defecto)'),
        opt('subnet-id', 'string'),
        opt('associate-public-ip-address', 'bool'),
        opt('iam-instance-profile', 'struct', 'Name=<perfil>'),
        opt('user-data', 'blob', 'Script de arranque'),
        tagOpt,
      ],
      action: 'ec2:RunInstances',
      resource: (_a, ctx) => arn(ctx, 'instance', '*'),
      example: 'aws ec2 run-instances --image-id ami-… --instance-type t3.micro --key-name lab --security-group-ids sg-…',
      run: (a, ctx) => {
        const r = ctx.ec2();
        const imgId: string = a['image-id'];
        if (!/^ami-[0-9a-f]{8,17}$/.test(imgId)) throw err('InvalidAMIID.Malformed', `Invalid id: "${imgId}" (expecting "ami-...")`);
        const img = IMAGES.find((i) => imageId(ctx.region, i.name) === imgId);
        if (!img) throw err('InvalidAMIID.NotFound', `The image id '[${imgId}]' does not exist`);
        const typeName: string = a['instance-type'] ?? 'm1.small';
        const type = INSTANCE_TYPES[typeName];
        if (!type) {
          if (typeName === 'm1.small') throw err('Unsupported', 'The requested configuration is currently not supported. Please check the documentation for supported configurations.');
          throw err('InvalidParameterValue', `Invalid value '${typeName}' for InstanceType.`);
        }
        if (type.arch !== img.arch) {
          throw err('InvalidParameterValue', `The architecture '${type.arch}' of the specified instance type does not match the architecture '${img.arch}' of the specified AMI. Specify an instance type and an AMI that have matching architectures, and try again. You can use 'describe-instance-types' or 'describe-images' to discover the architecture of the instance type or AMI.`);
        }
        let s: Json;
        if (a['subnet-id']) s = subnet(ctx, a['subnet-id']);
        else {
          const dv = defaultVpc(r);
          if (!dv) throw err('VPCIdNotSpecified', 'No default VPC for this user. GroupName is only supported for EC2-Classic and default VPC.');
          s = r.subnets.filter((x) => x.VpcId === dv.VpcId && x.DefaultForAz).sort((x, y) => x.AvailabilityZone.localeCompare(y.AvailabilityZone))[0];
          if (!s) throw err('MissingInput', 'No subnets found for the default VPC. Please specify a subnet.');
        }
        if (a['key-name'] && !r.keyPairs.some((k) => k.KeyName === a['key-name'])) {
          throw err('InvalidKeyPair.NotFound', `The key pair '${a['key-name']}' does not exist`);
        }
        let groups: Json[] = [];
        for (const id of a['security-group-ids'] ?? []) {
          const g = r.securityGroups.find((x) => x.GroupId === id);
          if (!g) throw err('InvalidGroup.NotFound', `The security group '${id}' does not exist in VPC '${s.VpcId}'`);
          if (g.VpcId !== s.VpcId) throw err('InvalidParameter', `Security group ${id} and subnet ${s.SubnetId} belong to different networks.`);
          groups.push(g);
        }
        for (const name of a['security-groups'] ?? []) {
          const g = r.securityGroups.find((x) => x.GroupName === name && x.VpcId === s.VpcId);
          if (!g) throw err('InvalidGroup.NotFound', `The security group '${name}' does not exist in default VPC '${s.VpcId}'`);
          groups.push(g);
        }
        if (!groups.length) groups = [r.securityGroups.find((x) => x.VpcId === s.VpcId && x.GroupName === 'default')].filter(Boolean);
        let profile: Json;
        if (a['iam-instance-profile']) {
          const name = a['iam-instance-profile'].Name ?? String(a['iam-instance-profile'].Arn ?? '').split('/').pop();
          const p = ctx.st.iam.instanceProfiles[name];
          if (!p) throw err('InvalidParameterValue', `Value (${name}) for parameter iamInstanceProfile.name is invalid. Invalid IAM Instance Profile name`);
          profile = { Arn: p.Arn, Id: p.InstanceProfileId };
        }
        const [minS, maxS] = String(a.count ?? '1').split(':');
        const count = Number(maxS ?? minS);
        if (!Number.isInteger(count) || count < 1) throw err('InvalidParameterValue', `Value (${a.count}) for parameter count is invalid.`);
        if (count > 20) throw err('InstanceLimitExceeded', `You have requested more instances (${count}) than your current instance limit of 20 allows for the specified instance type. Please visit http://aws.amazon.com/contact-us/ec2-request to request an adjustment to this limit.`);
        const tags = tagsFromSpecs(a['tag-specifications'], 'instance');
        const volTags = tagsFromSpecs(a['tag-specifications'], 'volume');
        const now = iso(ctx.now);
        const isPublic = a['associate-public-ip-address'] ?? s.MapPublicIpOnLaunch;
        const image = describeImage(ctx.region, img);
        const instances: Json[] = [];
        for (let n = 0; n < count; n++) {
          const id = ec2Id(ctx.st, 'i');
          const ip = nextPrivateIp(r, s);
          const volId = ec2Id(ctx.st, 'vol');
          const sgs = groups.map((g) => ({ GroupName: g.GroupName, GroupId: g.GroupId }));
          const inst = {
            AmiLaunchIndex: n,
            ImageId: imgId,
            InstanceId: id,
            InstanceType: typeName,
            ...(a['key-name'] ? { KeyName: a['key-name'] } : {}),
            LaunchTime: now,
            Monitoring: { State: 'disabled' },
            Placement: { AvailabilityZone: s.AvailabilityZone, GroupName: '', Tenancy: 'default' },
            PrivateDnsName: dnsFor(ctx.region, ip, false),
            PrivateIpAddress: ip,
            ProductCodes: [],
            PublicDnsName: '',
            State: state('pending'),
            StateTransitionReason: '',
            SubnetId: s.SubnetId,
            VpcId: s.VpcId,
            Architecture: img.arch,
            BlockDeviceMappings: [{ DeviceName: img.root, Ebs: { AttachTime: now, DeleteOnTermination: true, Status: 'attached', VolumeId: volId } }],
            ClientToken: hexChars(ctx.st, 32).replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'),
            EbsOptimized: false,
            EnaSupport: true,
            Hypervisor: 'xen',
            ...(profile ? { IamInstanceProfile: profile } : {}),
            NetworkInterfaces: [
              {
                Attachment: { AttachTime: now, AttachmentId: ec2Id(ctx.st, 'eni-attach'), DeleteOnTermination: true, DeviceIndex: 0, Status: 'attaching', NetworkCardIndex: 0 },
                Description: '',
                Groups: sgs,
                Ipv6Addresses: [],
                MacAddress: (hexChars(ctx.st, 12).match(/../g) as string[]).join(':'),
                NetworkInterfaceId: ec2Id(ctx.st, 'eni'),
                OwnerId: ctx.st.accountId,
                PrivateDnsName: dnsFor(ctx.region, ip, false),
                PrivateIpAddress: ip,
                PrivateIpAddresses: [{ Primary: true, PrivateDnsName: dnsFor(ctx.region, ip, false), PrivateIpAddress: ip }],
                SourceDestCheck: true,
                Status: 'in-use',
                SubnetId: s.SubnetId,
                VpcId: s.VpcId,
                InterfaceType: 'interface',
              },
            ],
            RootDeviceName: img.root,
            RootDeviceType: 'ebs',
            SecurityGroups: sgs,
            SourceDestCheck: true,
            StateReason: { Code: 'pending', Message: 'pending' },
            ...(tags ? { Tags: tags } : {}),
            VirtualizationType: 'hvm',
            CpuOptions: { CoreCount: 1, ThreadsPerCore: type.vcpu > 1 ? 2 : 1 },
            MetadataOptions: { State: 'pending', HttpTokens: 'required', HttpPutResponseHopLimit: 2, HttpEndpoint: 'enabled', HttpProtocolIpv6: 'disabled', InstanceMetadataTags: 'disabled' },
            PlatformDetails: img.platform,
            UsageOperation: image.UsageOperation,
            UsageOperationUpdateTime: now,
            PrivateDnsNameOptions: { HostnameType: 'ip-name', EnableResourceNameDnsARecord: false, EnableResourceNameDnsAAAARecord: false },
            MaintenanceOptions: { AutoRecovery: 'default' },
            CurrentInstanceBootMode: image.BootMode === 'uefi' ? 'uefi' : 'legacy-bios',
            ...(a['user-data'] !== undefined ? { _userData: a['user-data'] } : {}),
            _next: 'running',
            _public: isPublic,
          };
          instances.push(inst);
          r.volumes.push({
            Attachments: [{ AttachTime: now, Device: img.root, InstanceId: id, State: 'attached', VolumeId: volId, DeleteOnTermination: true }],
            AvailabilityZone: s.AvailabilityZone,
            CreateTime: now,
            Encrypted: false,
            Size: image.BlockDeviceMappings[0].Ebs.VolumeSize,
            SnapshotId: image.BlockDeviceMappings[0].Ebs.SnapshotId,
            State: 'in-use',
            VolumeId: volId,
            Iops: 3000,
            ...(volTags ? { Tags: volTags } : {}),
            VolumeType: 'gp3',
            MultiAttachEnabled: false,
            Throughput: 125,
          });
        }
        const reservation = { Groups: [], Instances: instances, OwnerId: ctx.st.accountId, ReservationId: ec2Id(ctx.st, 'r') };
        r.reservations.push(reservation);
        return JSON.parse(JSON.stringify(reservation));
      },
    },
    describe('describe-instances', 'ec2:DescribeInstances', 'Lista instancias. Combínalo con --filters y --query.', (a, ctx) => {
      for (const id of a['instance-ids'] ?? []) checkId(id, 'i', 'InvalidInstanceID.Malformed');
      byIds(allInstances(ctx.ec2()), a['instance-ids'], 'InstanceId', 'InvalidInstanceID.NotFound', 'instance');
      const getters: Record<string, Getter> = {
        'instance-id': (i) => i.InstanceId,
        'instance-state-name': (i) => i.State.Name,
        'instance-state-code': (i) => String(i.State.Code),
        'instance-type': (i) => i.InstanceType,
        'image-id': (i) => i.ImageId,
        'key-name': (i) => i.KeyName,
        'vpc-id': (i) => i.VpcId,
        'subnet-id': (i) => i.SubnetId,
        'availability-zone': (i) => i.Placement.AvailabilityZone,
        'private-ip-address': (i) => i.PrivateIpAddress,
        'ip-address': (i) => i.PublicIpAddress,
        'instance.group-id': (i) => i.SecurityGroups.map((g: Json) => g.GroupId),
        'instance.group-name': (i) => i.SecurityGroups.map((g: Json) => g.GroupName),
        'group-id': (i) => i.SecurityGroups.map((g: Json) => g.GroupId),
        'group-name': (i) => i.SecurityGroups.map((g: Json) => g.GroupName),
        architecture: (i) => i.Architecture,
        'reservation-id': () => undefined,
      };
      const reservations = ctx
        .ec2()
        .reservations.map((res) => {
          let inst = res.Instances;
          if (a['instance-ids']) inst = inst.filter((i: Json) => a['instance-ids'].includes(i.InstanceId));
          inst = applyFilters(inst, a.filters, getters);
          return inst.length ? { ...res, Instances: inst } : undefined;
        })
        .filter(Boolean);
      return { Reservations: reservations };
    }, [opt('instance-ids', 'strings'), opt('filters', 'structs'), opt('max-results', 'int')]),
    {
      name: 'stop-instances',
      help: 'Para instancias (se conserva el disco; se pierde la IP pública).',
      opts: [req('instance-ids', 'strings'), opt('force', 'bool')],
      run: (a, ctx) =>
        transition(ctx, a['instance-ids'], 'ec2:StopInstances', 'StoppingInstances', (i) => {
          const s = i.State.Name;
          if (s === 'stopped' || s === 'stopping') return undefined;
          if (s === 'terminated' || s === 'shutting-down') throw err('IncorrectInstanceState', `This instance '${i.InstanceId}' is not in a state from which it can be stopped.`);
          i.State = state('stopping');
          i._next = 'stopped';
          i.StateTransitionReason = `User initiated (${iso(ctx.now).replace('T', ' ').replace('+00:00', ' GMT')})`;
          return 'stopping';
        }),
    },
    {
      name: 'start-instances',
      help: 'Arranca instancias paradas.',
      opts: [req('instance-ids', 'strings')],
      run: (a, ctx) =>
        transition(ctx, a['instance-ids'], 'ec2:StartInstances', 'StartingInstances', (i) => {
          const s = i.State.Name;
          if (s === 'running' || s === 'pending') return undefined;
          if (s !== 'stopped') throw err('IncorrectInstanceState', `The instance '${i.InstanceId}' is not in a state from which it can be started.`);
          i.State = state('pending');
          i._next = 'running';
          return 'pending';
        }),
    },
    {
      name: 'reboot-instances',
      help: 'Reinicia instancias.',
      opts: [req('instance-ids', 'strings')],
      run: (a, ctx) => {
        transition(ctx, a['instance-ids'], 'ec2:RebootInstances', 'X', (i) => {
          if (i.State.Name !== 'running') throw err('IncorrectState', `The instance '${i.InstanceId}' is not in the 'running' state.`);
          return undefined;
        });
        return undefined;
      },
    },
    {
      name: 'terminate-instances',
      help: 'Termina (borra) instancias. No tiene vuelta atrás.',
      opts: [req('instance-ids', 'strings')],
      run: (a, ctx) =>
        transition(ctx, a['instance-ids'], 'ec2:TerminateInstances', 'TerminatingInstances', (i) => {
          if (i.State.Name === 'terminated' || i.State.Name === 'shutting-down') return undefined;
          i.State = state('shutting-down');
          i._next = 'terminated';
          return 'shutting-down';
        }),
    },
    {
      name: 'wait',
      help: 'Espera a un estado: aws ec2 wait instance-running --instance-ids i-…',
      positional: [{ name: 'waiter', required: true }],
      opts: [opt('instance-ids', 'strings'), opt('filters', 'structs')],
      action: 'ec2:DescribeInstances',
      run: (a, ctx) => {
        const waiters: Record<string, string> = {
          'instance-running': 'running',
          'instance-stopped': 'stopped',
          'instance-terminated': 'terminated',
          'instance-exists': '*',
        };
        const want = waiters[a._[0]];
        if (!want) {
          throw new CliError(`aws: error: argument subcommand: Invalid choice, valid choices are:\n\n${Object.keys(waiters).join('\n')}`, 252);
        }
        const list = byIds(allInstances(ctx.ec2()), a['instance-ids'], 'InstanceId', 'InvalidInstanceID.NotFound', 'instance');
        const name = a._[0].split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join('');
        if (!list.length) throw new CliError(`\nWaiter ${name} failed: Max attempts exceeded`, 255);
        const bad = list.find((i) => want !== '*' && i.State.Name !== want);
        if (bad) {
          throw new CliError(
            `\nWaiter ${name} failed: Waiter encountered a terminal failure state: For expression "Reservations[].Instances[].State.Name" we matched expected path: "${bad.State.Name}" at least once`,
            255,
          );
        }
        return undefined;
      },
    },

    // ── tags ──
    {
      name: 'create-tags',
      help: 'Etiqueta recursos: --resources i-… vpc-… --tags Key=Name,Value=web',
      opts: [req('resources', 'strings'), req('tags', 'structs')],
      action: 'ec2:CreateTags',
      resource: (a, ctx) => a.resources.map((id: string) => arn(ctx, 'resource', id)),
      run: (a, ctx) => {
        const r = ctx.ec2();
        const found = a.resources.map((id: string) => {
          const f = findResource(r, id);
          if (!f) throw err('InvalidID', `The ID '${id}' is not valid`);
          return f;
        });
        const tags = (a.tags as Json[]).map((t) => ({ Key: String(t.Key), Value: String(t.Value ?? '') }));
        for (const f of found) setTags(f.item, tags);
        return undefined;
      },
    },
    {
      name: 'delete-tags',
      help: 'Quita etiquetas: --resources i-… --tags Key=Name',
      opts: [req('resources', 'strings'), opt('tags', 'structs')],
      action: 'ec2:DeleteTags',
      resource: (a, ctx) => a.resources.map((id: string) => arn(ctx, 'resource', id)),
      run: (a, ctx) => {
        for (const id of a.resources) {
          const f = findResource(ctx.ec2(), id);
          if (!f) throw err('InvalidID', `The ID '${id}' is not valid`);
          const keys = a.tags ? (a.tags as Json[]).map((t) => t.Key) : undefined;
          f.item.Tags = keys ? (f.item.Tags || []).filter((t: Tag) => !keys.includes(t.Key)) : [];
        }
        return undefined;
      },
    },
    describe('describe-tags', 'ec2:DescribeTags', 'Lista las etiquetas de todos los recursos.', (a, ctx) => {
      const r = ctx.ec2();
      const ids = [
        ...r.vpcs.map((x) => x.VpcId), ...r.subnets.map((x) => x.SubnetId), ...r.internetGateways.map((x) => x.InternetGatewayId),
        ...r.routeTables.map((x) => x.RouteTableId), ...r.securityGroups.map((x) => x.GroupId), ...r.keyPairs.map((x) => x.KeyPairId),
        ...allInstances(r).map((x) => x.InstanceId), ...r.volumes.map((x) => x.VolumeId), ...r.addresses.map((x) => x.AllocationId),
      ];
      const tags = ids.flatMap((id) => {
        const f = findResource(r, id)!;
        return (f.item.Tags || []).map((t: Tag) => ({ Key: t.Key, ResourceId: id, ResourceType: f.type, Value: t.Value }));
      });
      return {
        Tags: applyFilters(tags, a.filters, { 'resource-id': (t) => t.ResourceId, 'resource-type': (t) => t.ResourceType, key: (t) => t.Key, value: (t) => t.Value }),
      };
    }),

    // ── elastic IPs ──
    {
      name: 'allocate-address',
      help: 'Reserva una IP elástica (IP pública fija).',
      opts: [opt('domain', 'string', '', { choices: ['vpc', 'standard'] }), tagOpt],
      action: 'ec2:AllocateAddress',
      resource: (_a, ctx) => arn(ctx, 'elastic-ip', '*'),
      run: (a, ctx) => {
        const tags = tagsFromSpecs(a['tag-specifications'], 'elastic-ip');
        const addr = { PublicIp: publicIp(ctx.st), AllocationId: ec2Id(ctx.st, 'eipalloc'), PublicIpv4Pool: 'amazon', NetworkBorderGroup: ctx.region, Domain: 'vpc', ...(tags ? { Tags: tags } : {}) };
        ctx.ec2().addresses.push(addr);
        return { ...addr };
      },
    },
    {
      name: 'associate-address',
      help: 'Asigna una IP elástica a una instancia.',
      opts: [req('allocation-id', 'string'), req('instance-id', 'string')],
      action: 'ec2:AssociateAddress',
      resource: (a, ctx) => arn(ctx, 'instance', a['instance-id']),
      run: (a, ctx) => {
        const r = ctx.ec2();
        const addr = r.addresses.find((x) => x.AllocationId === a['allocation-id']);
        if (!addr) throw err('InvalidAllocationID.NotFound', `The allocation ID '${a['allocation-id']}' does not exist`);
        const i = instance(ctx, a['instance-id']);
        if (i.State.Name === 'terminated' || i.State.Name === 'shutting-down') throw err('IncorrectInstanceState', `The pending-instance-creation instance to which '${i.InstanceId}' is attached is not in a valid state for this operation`);
        for (const other of r.addresses) {
          if (other !== addr && other.InstanceId === i.InstanceId) {
            delete other.InstanceId;
            delete other.AssociationId;
          }
        }
        const assoc = ec2Id(ctx.st, 'eipassoc');
        Object.assign(addr, { InstanceId: i.InstanceId, AssociationId: assoc, PrivateIpAddress: i.PrivateIpAddress, NetworkInterfaceId: i.NetworkInterfaces[0]?.NetworkInterfaceId });
        i.PublicIpAddress = addr.PublicIp;
        i.PublicDnsName = dnsFor(ctx.region, addr.PublicIp, true);
        return { AssociationId: assoc };
      },
    },
    {
      name: 'disassociate-address',
      help: 'Quita la IP elástica de la instancia.',
      opts: [req('association-id', 'string')],
      action: 'ec2:DisassociateAddress',
      run: (a, ctx) => {
        const r = ctx.ec2();
        const addr = r.addresses.find((x) => x.AssociationId === a['association-id']);
        if (!addr) throw err('InvalidAssociationID.NotFound', `The association ID '${a['association-id']}' does not exist`);
        const i = allInstances(r).find((x) => x.InstanceId === addr.InstanceId);
        if (i) {
          delete i.PublicIpAddress;
          i.PublicDnsName = '';
        }
        delete addr.InstanceId;
        delete addr.AssociationId;
        delete addr.PrivateIpAddress;
        delete addr.NetworkInterfaceId;
        return undefined;
      },
    },
    {
      name: 'release-address',
      help: 'Libera una IP elástica (deja de cobrarse).',
      opts: [req('allocation-id', 'string')],
      action: 'ec2:ReleaseAddress',
      resource: (a, ctx) => arn(ctx, 'elastic-ip', a['allocation-id']),
      run: (a, ctx) => {
        const r = ctx.ec2();
        const addr = r.addresses.find((x) => x.AllocationId === a['allocation-id']);
        if (!addr) throw err('InvalidAllocationID.NotFound', `The allocation ID '${a['allocation-id']}' does not exist`);
        if (addr.AssociationId) throw err('InvalidIPAddress.InUse', `Address ${addr.PublicIp} is in use.`);
        r.addresses = r.addresses.filter((x) => x !== addr);
        return undefined;
      },
    },
    describe('describe-addresses', 'ec2:DescribeAddresses', 'Lista las IP elásticas.', (a, ctx) => {
      let items = byIds(ctx.ec2().addresses, a['allocation-ids'], 'AllocationId', 'InvalidAllocationID.NotFound', 'allocation');
      if (a['public-ips']) items = items.filter((x) => a['public-ips'].includes(x.PublicIp));
      return {
        Addresses: applyFilters(items, a.filters, {
          'allocation-id': (i) => i.AllocationId,
          'public-ip': (i) => i.PublicIp,
          'instance-id': (i) => i.InstanceId,
          'association-id': (i) => i.AssociationId,
        }),
      };
    }, [opt('allocation-ids', 'strings'), opt('public-ips', 'strings'), opt('filters', 'structs')]),

    // ── volumes ──
    {
      name: 'create-volume',
      help: 'Crea un volumen EBS en una zona de disponibilidad.',
      opts: [req('availability-zone', 'string'), opt('size', 'int', 'GiB'), opt('volume-type', 'string', '', { choices: ['gp3', 'gp2', 'io1', 'io2', 'st1', 'sc1', 'standard'] }), opt('encrypted', 'bool'), tagOpt],
      action: 'ec2:CreateVolume',
      resource: (_a, ctx) => arn(ctx, 'volume', '*'),
      run: (a, ctx) => {
        const zones = availabilityZones(ctx.region).map((z) => z.ZoneName);
        if (!zones.includes(a['availability-zone'])) throw err('InvalidParameterValue', `Invalid availability zone: [${a['availability-zone']}]`);
        if (a.size === undefined) throw err('MissingParameter', 'The request must contain the parameter size/snapshot');
        const type = a['volume-type'] ?? 'gp2';
        const tags = tagsFromSpecs(a['tag-specifications'], 'volume');
        const v = {
          Attachments: [],
          AvailabilityZone: a['availability-zone'],
          CreateTime: iso(ctx.now),
          Encrypted: !!a.encrypted,
          Size: a.size,
          SnapshotId: '',
          State: 'creating',
          VolumeId: ec2Id(ctx.st, 'vol'),
          Iops: type === 'gp3' ? 3000 : Math.max(100, a.size * 3),
          ...(tags ? { Tags: tags } : {}),
          VolumeType: type,
          MultiAttachEnabled: false,
          ...(type === 'gp3' ? { Throughput: 125 } : {}),
        };
        ctx.ec2().volumes.push(v);
        return { ...v };
      },
    },
    {
      name: 'attach-volume',
      help: 'Conecta un volumen a una instancia de la misma zona.',
      opts: [req('volume-id', 'string'), req('instance-id', 'string'), req('device', 'string', '/dev/sdf')],
      action: 'ec2:AttachVolume',
      resource: (a, ctx) => [arn(ctx, 'volume', a['volume-id']), arn(ctx, 'instance', a['instance-id'])],
      run: (a, ctx) => {
        const v = volume(ctx, a['volume-id']);
        const i = instance(ctx, a['instance-id']);
        if (v.State !== 'available') throw err('VolumeInUse', `${v.VolumeId} is already attached to an instance`);
        if (v.AvailabilityZone !== i.Placement.AvailabilityZone) {
          throw err('InvalidVolume.ZoneMismatch', `The volume '${v.VolumeId}' is not in the same availability zone as instance '${i.InstanceId}'`);
        }
        const att = { AttachTime: iso(ctx.now), Device: a.device, InstanceId: i.InstanceId, State: 'attaching', VolumeId: v.VolumeId };
        v.Attachments = [{ ...att, DeleteOnTermination: false }];
        v.State = 'in-use';
        i.BlockDeviceMappings.push({ DeviceName: a.device, Ebs: { AttachTime: att.AttachTime, DeleteOnTermination: false, Status: 'attached', VolumeId: v.VolumeId } });
        return att;
      },
    },
    {
      name: 'detach-volume',
      help: 'Desconecta un volumen.',
      opts: [req('volume-id', 'string')],
      action: 'ec2:DetachVolume',
      resource: (a, ctx) => arn(ctx, 'volume', a['volume-id']),
      run: (a, ctx) => {
        const v = volume(ctx, a['volume-id']);
        const att = v.Attachments?.[0];
        if (!att) throw err('IncorrectState', `Volume '${v.VolumeId}' is in the 'available' state.`);
        const i = allInstances(ctx.ec2()).find((x) => x.InstanceId === att.InstanceId);
        if (i) i.BlockDeviceMappings = i.BlockDeviceMappings.filter((b: Json) => b.Ebs.VolumeId !== v.VolumeId);
        v._detaching = true;
        const { DeleteOnTermination: _d, ...out } = att;
        return { ...out, State: 'detaching' };
      },
    },
    {
      name: 'delete-volume',
      help: 'Borra un volumen que no esté conectado.',
      opts: [req('volume-id', 'string')],
      action: 'ec2:DeleteVolume',
      resource: (a, ctx) => arn(ctx, 'volume', a['volume-id']),
      run: (a, ctx) => {
        const v = volume(ctx, a['volume-id']);
        if (v.Attachments?.length) throw err('VolumeInUse', `Volume ${v.VolumeId} is currently attached to ${v.Attachments[0].InstanceId}`);
        const r = ctx.ec2();
        r.volumes = r.volumes.filter((x) => x !== v);
        return undefined;
      },
    },
    describe('describe-volumes', 'ec2:DescribeVolumes', 'Lista los volúmenes EBS.', (a, ctx) => {
      const items = byIds(ctx.ec2().volumes, a['volume-ids'], 'VolumeId', 'InvalidVolume.NotFound', 'volume');
      return {
        Volumes: applyFilters(items, a.filters, {
          'volume-id': (i) => i.VolumeId,
          status: (i) => i.State,
          'availability-zone': (i) => i.AvailabilityZone,
          'volume-type': (i) => i.VolumeType,
          size: (i) => String(i.Size),
          'attachment.instance-id': (i) => (i.Attachments || []).map((x: Json) => x.InstanceId),
        }),
      };
    }, [opt('volume-ids', 'strings'), opt('filters', 'structs')]),
  ],
};

