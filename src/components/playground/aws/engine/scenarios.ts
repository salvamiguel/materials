// Guided scenarios. Each step has a command the student can click to paste,
// and is marked as done from the account state or from the commands run.

import type { PlaygroundState } from './types';

export interface Step {
  text: string;
  command: string;
  /** The step is about seeing an error: any attempt counts. */
  expectError?: boolean;
  check?: (st: PlaygroundState) => boolean;
  /** Command prefix that counts as doing the step; defaults to "aws <svc> <op>". */
  ran?: string;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  steps: Step[];
}

export interface CommandLog {
  ok: string[];
  failed: string[];
}

export const normalize = (cmd: string) => cmd.trim().replace(/\s+/g, ' ');

/**
 * Progress is sequential and sticky: the next step is ticked when its
 * condition holds, and ticked steps stay ticked even if later steps undo
 * what they checked (deleting the user created in step 3, for instance).
 */
export function advance(sc: Scenario, done: number, st: PlaygroundState, log: CommandLog): number {
  let i = done;
  while (i < sc.steps.length && stepDone(sc.steps[i], st, log)) i++;
  return i;
}

export function stepDone(step: Step, st: PlaygroundState, log: CommandLog): boolean {
  if (step.check) return step.check(st);
  const prefix = normalize(step.ran ?? step.command.split(/\s+/).slice(0, 3).join(' '));
  const list = step.expectError ? [...log.ok, ...log.failed] : log.ok;
  return list.some((c) => normalize(c).startsWith(prefix));
}

const ACC = '123456789012';
const ec2 = (st: PlaygroundState) => st.ec2['eu-west-1'];
const instances = (st: PlaygroundState) => (ec2(st)?.reservations ?? []).flatMap((r) => r.Instances);
const tagged = (item: { Tags?: { Key: string; Value: string }[] }, name: string) => item.Tags?.some((t) => t.Key === 'Name' && t.Value === name);
const sgWeb = (st: PlaygroundState) => ec2(st)?.securityGroups.find((g) => g.GroupName === 'web');
const opens = (st: PlaygroundState, port: number) => !!sgWeb(st)?.IpPermissions.some((p: { FromPort?: number }) => p.FromPort === port);
const labVpc = (st: PlaygroundState) => ec2(st)?.vpcs.find((v) => tagged(v, 'lab'));

export const SCENARIOS: Scenario[] = [
  {
    id: 'primeros-pasos',
    label: '1 · ¿Quién soy?',
    description: 'Credenciales, perfiles, regiones y formatos de salida.',
    steps: [
      { text: 'Pregunta a AWS quién hace las llamadas: cuenta, ARN e id.', command: 'aws sts get-caller-identity' },
      { text: 'Mira de dónde salen las credenciales y la región.', command: 'aws configure list' },
      { text: 'Las claves viven en ~/.aws/credentials (y la región en ~/.aws/config).', command: 'cat ~/.aws/credentials', ran: 'cat ~/.aws/credentials' },
      { text: 'Lista las regiones, solo los nombres.', command: "aws ec2 describe-regions --query 'Regions[].RegionName' --output text" },
      { text: 'Zonas de disponibilidad de otra región, en tabla.', command: 'aws ec2 describe-availability-zones --region us-east-1 --output table' },
      { text: 'La misma identidad en YAML.', command: 'aws sts get-caller-identity --output yaml', ran: 'aws sts get-caller-identity --output yaml' },
    ],
  },
  {
    id: 'web-s3',
    label: '2 · Web estática en S3',
    description: 'Bucket, subida de ficheros, alojamiento web y bloqueo de acceso público.',
    steps: [
      { text: 'Crea el bucket (el nombre es único en todo AWS).', command: 'aws s3 mb s3://web-uev-2627', check: (st) => !!st.s3['web-uev-2627'] },
      {
        text: 'Sube la carpeta web/ entera.',
        command: 'aws s3 cp web/ s3://web-uev-2627/ --recursive',
        check: (st) => !!st.s3['web-uev-2627']?.objects['index.html'],
      },
      { text: 'Comprueba el contenido y el tamaño total.', command: 'aws s3 ls s3://web-uev-2627 --human-readable --summarize' },
      {
        text: 'Activa el alojamiento de web estática.',
        command: 'aws s3 website s3://web-uev-2627 --index-document index.html --error-document error.html',
        check: (st) => !!st.s3['web-uev-2627']?.website,
      },
      {
        text: 'Intenta hacer el bucket público. Fallará: los buckets nuevos bloquean las políticas públicas.',
        command: 'aws s3api put-bucket-policy --bucket web-uev-2627 --policy file://politicas/bucket-publico.json',
        expectError: true,
      },
      {
        text: 'Desactiva solo el bloqueo de políticas públicas.',
        command:
          'aws s3api put-public-access-block --bucket web-uev-2627 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false',
        check: (st) => st.s3['web-uev-2627']?.publicAccessBlock?.BlockPublicPolicy === false,
      },
      {
        text: 'Ahora sí: aplica la política de lectura pública.',
        command: 'aws s3api put-bucket-policy --bucket web-uev-2627 --policy file://politicas/bucket-publico.json',
        check: (st) => !!st.s3['web-uev-2627']?.policy,
      },
      { text: 'Lee la política aplicada.', command: 'aws s3api get-bucket-policy --bucket web-uev-2627 --query Policy --output text' },
    ],
  },
  {
    id: 'iam-usuarios',
    label: '3 · Usuarios, grupos y políticas',
    description: 'IAM: grupos con políticas administradas, usuarios, claves de acceso y el orden para borrar.',
    steps: [
      { text: 'Crea el grupo desarrollo.', command: 'aws iam create-group --group-name desarrollo', check: (st) => !!st.iam.groups.desarrollo },
      {
        text: 'Dale permisos de solo lectura en EC2 (política de AWS).',
        command: 'aws iam attach-group-policy --group-name desarrollo --policy-arn arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess',
        check: (st) => !!st.iam.groups.desarrollo?.attached.includes('arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess'),
      },
      { text: 'Crea la usuaria ana.', command: 'aws iam create-user --user-name ana', check: (st) => !!st.iam.users.ana },
      {
        text: 'Métela en el grupo: hereda sus permisos.',
        command: 'aws iam add-user-to-group --group-name desarrollo --user-name ana',
        check: (st) => !!st.iam.users.ana?.groups.includes('desarrollo'),
      },
      { text: 'Crea una clave de acceso para ana (el secreto solo se ve ahora).', command: 'aws iam create-access-key --user-name ana', check: (st) => (st.iam.users.ana?.accessKeys.length ?? 0) > 0 },
      { text: 'Consulta sus grupos en tabla.', command: 'aws iam list-groups-for-user --user-name ana --output table' },
      { text: 'Intenta borrarla: IAM no te deja mientras tenga claves o grupos.', command: 'aws iam delete-user --user-name ana', expectError: true },
      {
        text: 'Borra su clave (el id sale de otra llamada con $( )).',
        command: "aws iam delete-access-key --user-name ana --access-key-id $(aws iam list-access-keys --user-name ana --query 'AccessKeyMetadata[0].AccessKeyId' --output text)",
        check: (st) => !!st.iam.users.ana && st.iam.users.ana.accessKeys.length === 0,
      },
      {
        text: 'Sácala del grupo.',
        command: 'aws iam remove-user-from-group --group-name desarrollo --user-name ana',
        check: (st) => !!st.iam.users.ana && !st.iam.users.ana.groups.length,
      },
      {
        text: 'Ahora sí se puede borrar.',
        command: 'aws iam delete-user --user-name ana',
        check: (st) => !st.iam.users.ana && !!st.iam.groups.desarrollo,
      },
    ],
  },
  {
    id: 'asumir-rol',
    label: '4 · Asumir un rol',
    description: 'Mínimo privilegio: un rol de solo lectura, un perfil que lo asume y un AccessDenied de verdad.',
    steps: [
      { text: 'Crea el bucket de informes (como admin).', command: 'aws s3 mb s3://informes-uev-2627', check: (st) => !!st.s3['informes-uev-2627'] },
      {
        text: 'Crea el rol LectorS3. Su política de confianza deja que lo asuma cualquier identidad de la cuenta.',
        command: 'aws iam create-role --role-name LectorS3 --assume-role-policy-document file://politicas/confianza-cuenta.json',
        check: (st) => !!st.iam.roles.LectorS3,
      },
      {
        text: 'Dale solo lectura en S3.',
        command: 'aws iam attach-role-policy --role-name LectorS3 --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
        check: (st) => !!st.iam.roles.LectorS3?.attached.includes('arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'),
      },
      {
        text: 'Crea un perfil "lector" que asume el rol…',
        command: `aws configure set role_arn arn:aws:iam::${ACC}:role/LectorS3 --profile lector`,
        check: (st) => !!st.profiles.lector?.role_arn,
      },
      { text: '…usando tus credenciales de admin…', command: 'aws configure set source_profile default --profile lector', check: (st) => st.profiles.lector?.source_profile === 'default' },
      { text: '…y con su propia región (no se hereda).', command: 'aws configure set region eu-west-1 --profile lector', check: (st) => st.profiles.lector?.region === 'eu-west-1' },
      { text: '¿Quién eres con ese perfil?', command: 'aws sts get-caller-identity --profile lector', ran: 'aws sts get-caller-identity --profile lector' },
      { text: 'Leer funciona.', command: 'aws s3 ls --profile lector', ran: 'aws s3 ls --profile lector' },
      { text: 'Escribir no: AccessDenied.', command: 'aws s3 cp datos/ventas.csv s3://informes-uev-2627/ --profile lector', expectError: true, ran: 'aws s3 cp datos/ventas.csv s3://informes-uev-2627/ --profile lector' },
      {
        text: 'Como admin, crea una política que permite escribir solo en ese bucket.',
        command: 'aws iam create-policy --policy-name EscribirInformes --policy-document file://politicas/escribir-informes.json',
        check: (st) => !!st.iam.policies[`arn:aws:iam::${ACC}:policy/EscribirInformes`],
      },
      {
        text: 'Añádela al rol.',
        command: `aws iam attach-role-policy --role-name LectorS3 --policy-arn arn:aws:iam::${ACC}:policy/EscribirInformes`,
        check: (st) => !!st.iam.roles.LectorS3?.attached.includes(`arn:aws:iam::${ACC}:policy/EscribirInformes`),
      },
      {
        text: 'Vuelve a subir el fichero con el perfil lector.',
        command: 'aws s3 cp datos/ventas.csv s3://informes-uev-2627/ --profile lector',
        check: (st) => !!st.s3['informes-uev-2627']?.objects['ventas.csv'],
      },
    ],
  },
  {
    id: 'ec2',
    label: '5 · Lanzar una instancia EC2',
    description: 'Par de claves, security group, AMI, run-instances, --query, parar y terminar.',
    steps: [
      {
        text: 'Crea un par de claves y guarda la privada en lab.pem.',
        command: 'aws ec2 create-key-pair --key-name lab --query KeyMaterial --output text > lab.pem',
        check: (st) => !!ec2(st)?.keyPairs.some((k) => k.KeyName === 'lab') && !!st.files['/home/alumno/lab.pem'],
      },
      {
        text: 'Crea un security group y guarda su id en $SG.',
        command: 'SG=$(aws ec2 create-security-group --group-name web --description "SSH y HTTP" --query GroupId --output text)',
        check: (st) => !!sgWeb(st) && !!st.env.SG,
      },
      { text: 'Abre SSH (22)…', command: 'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr 0.0.0.0/0', check: (st) => opens(st, 22) },
      { text: '…y HTTP (80).', command: 'aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0', check: (st) => opens(st, 80) },
      {
        text: 'Busca la AMI de Amazon Linux 2023 (x86_64) y guárdala en $AMI.',
        command: "AMI=$(aws ec2 describe-images --owners amazon --filters 'Name=name,Values=al2023-ami-*-x86_64' --query 'Images[0].ImageId' --output text)",
        check: (st) => /^ami-/.test(st.env.AMI ?? ''),
      },
      {
        text: 'Lanza la instancia con nombre web.',
        command:
          "aws ec2 run-instances --image-id $AMI --instance-type t3.micro --key-name lab --security-group-ids $SG --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=web}]'",
        check: (st) => instances(st).some((i) => tagged(i, 'web')),
      },
      {
        text: 'Mírala en tabla: id, estado e IP pública.',
        command: "aws ec2 describe-instances --filters Name=tag:Name,Values=web --query 'Reservations[].Instances[].[InstanceId,State.Name,PublicIpAddress]' --output table",
      },
      {
        text: 'Guarda su id en $ID.',
        command:
          "ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)",
        check: (st) => /^i-/.test(st.env.ID ?? ''),
      },
      {
        text: 'Párala.',
        command: 'aws ec2 stop-instances --instance-ids $ID',
        check: (st) => instances(st).some((i) => i.InstanceId === st.env.ID && ['stopping', 'stopped', 'shutting-down', 'terminated'].includes(i.State.Name)),
      },
      {
        text: 'Termínala (se borra).',
        command: 'aws ec2 terminate-instances --instance-ids $ID',
        check: (st) => instances(st).some((i) => i.InstanceId === st.env.ID && ['shutting-down', 'terminated'].includes(i.State.Name)),
      },
      { text: 'Borra el security group.', command: 'aws ec2 delete-security-group --group-id $SG', check: (st) => !!st.env.SG && !sgWeb(st) },
    ],
  },
  {
    id: 'vpc',
    label: '6 · Una VPC desde cero',
    description: 'VPC, subred pública y privada, internet gateway, tabla de rutas y dependencias.',
    steps: [
      {
        text: 'Crea la VPC 10.0.0.0/16 y guarda su id.',
        command: "VPC=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=lab}]' --query Vpc.VpcId --output text)",
        check: (st) => !!labVpc(st),
      },
      {
        text: 'Subred pública en eu-west-1a.',
        command: 'PUB=$(aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.1.0/24 --availability-zone eu-west-1a --query Subnet.SubnetId --output text)',
        check: (st) => !!ec2(st)?.subnets.some((s) => s.CidrBlock === '10.0.1.0/24' && s.VpcId === labVpc(st)?.VpcId),
      },
      {
        text: 'Subred privada en eu-west-1b.',
        command: 'PRIV=$(aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.2.0/24 --availability-zone eu-west-1b --query Subnet.SubnetId --output text)',
        check: (st) => !!ec2(st)?.subnets.some((s) => s.CidrBlock === '10.0.2.0/24' && s.VpcId === labVpc(st)?.VpcId),
      },
      {
        text: 'Crea un internet gateway…',
        command: 'IGW=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text)',
        check: (st) => /^igw-/.test(st.env.IGW ?? ''),
      },
      {
        text: '…y conéctalo a la VPC.',
        command: 'aws ec2 attach-internet-gateway --internet-gateway-id $IGW --vpc-id $VPC',
        check: (st) => !!ec2(st)?.internetGateways.some((g) => g.Attachments.some((a: { VpcId: string }) => a.VpcId === labVpc(st)?.VpcId)),
      },
      {
        text: 'Crea una tabla de rutas…',
        command: 'RTB=$(aws ec2 create-route-table --vpc-id $VPC --query RouteTable.RouteTableId --output text)',
        check: (st) => /^rtb-/.test(st.env.RTB ?? ''),
      },
      {
        text: '…con la ruta 0.0.0.0/0 hacia el internet gateway…',
        command: 'aws ec2 create-route --route-table-id $RTB --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW',
        check: (st) => !!ec2(st)?.routeTables.some((t) => t.RouteTableId === st.env.RTB && t.Routes.some((r: { DestinationCidrBlock: string }) => r.DestinationCidrBlock === '0.0.0.0/0')),
      },
      {
        text: '…y asóciala a la subred pública.',
        command: 'aws ec2 associate-route-table --route-table-id $RTB --subnet-id $PUB',
        check: (st) => !!ec2(st)?.routeTables.some((t) => t.RouteTableId === st.env.RTB && t.Associations.some((a: { SubnetId?: string }) => a.SubnetId === st.env.PUB)),
      },
      {
        text: 'Que las instancias de la subred pública reciban IP pública.',
        command: 'aws ec2 modify-subnet-attribute --subnet-id $PUB --map-public-ip-on-launch',
        check: (st) => !!ec2(st)?.subnets.some((s) => s.SubnetId === st.env.PUB && s.MapPublicIpOnLaunch),
      },
      {
        text: 'Revisa las subredes de la VPC.',
        command: "aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --query 'Subnets[].[SubnetId,CidrBlock,AvailabilityZone,MapPublicIpOnLaunch]' --output table",
      },
      { text: 'Intenta borrar la VPC: tiene dependencias.', command: 'aws ec2 delete-vpc --vpc-id $VPC', expectError: true },
    ],
  },
  {
    id: 'query',
    label: '7 · --query y --output',
    description: 'JMESPath para quedarte solo con lo que te interesa.',
    steps: [
      { text: 'Solo las regiones europeas, en texto.', command: "aws ec2 describe-regions --query 'Regions[?starts_with(RegionName, `eu`)].RegionName' --output text" },
      {
        text: 'Tipos de instancia de la capa gratuita, en tabla.',
        command: "aws ec2 describe-instance-types --query 'InstanceTypes[?FreeTierEligible].[InstanceType,VCpuInfo.DefaultVCpus,MemoryInfo.SizeInMiB]' --output table",
      },
      { text: 'Nombres de las políticas administradas por AWS.', command: "aws iam list-policies --scope AWS --query 'Policies[].PolicyName' --output text" },
      {
        text: 'Proyección con nombres propios.',
        command: "aws ec2 describe-images --owners amazon --query 'Images[].{Id:ImageId,Arq:Architecture,Nombre:Name}' --output table",
      },
      { text: '¿Cuántas VPC hay?', command: "aws ec2 describe-vpcs --query 'length(Vpcs)'" },
      { text: 'Security groups en YAML.', command: "aws ec2 describe-security-groups --query 'SecurityGroups[].[GroupName,GroupId]' --output yaml" },
    ],
  },
];
