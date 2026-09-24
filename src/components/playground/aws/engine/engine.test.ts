import { describe, expect, test } from 'bun:test';
import { run, promptText } from './engine';
import { initialState } from './seed';
import { parseShorthand } from './shorthand';
import { formatJson, formatTable, formatText, formatYaml } from './format';
import { evaluate, trustAllows, validatePolicyDocument } from './iam-eval';
import { complete } from './complete';
import { SCENARIOS, advance, stepDone, type CommandLog } from './scenarios';
import type { PlaygroundState } from './types';

const T0 = new Date('2026-09-24T10:00:00Z').getTime();

/** Runs commands in order on a fresh account, one simulated minute apart. */
function session(...cmds: string[]) {
  let st = initialState(new Date(T0));
  let minute = 0;
  const results: { cmd: string; output: string; exitCode: number }[] = [];
  const exec = (cmd: string) => {
    const r = run(cmd, st, new Date(T0 + ++minute * 60_000));
    st = r.state;
    results.push({ cmd, output: r.output, exitCode: r.exitCode });
    return r;
  };
  cmds.forEach(exec);
  return {
    exec,
    get state(): PlaygroundState {
      return st;
    },
    results,
    last: () => results[results.length - 1],
  };
}

const json = (s: string) => JSON.parse(s);

describe('shorthand', () => {
  test('lists continue until the next key', () => {
    expect(parseShorthand('Name=instance-state-name,Values=running,stopped')).toEqual({
      Name: 'instance-state-name',
      Values: ['running', 'stopped'],
    });
  });
  test('nested lists of structures', () => {
    expect(parseShorthand('ResourceType=instance,Tags=[{Key=Name,Value=web},{Key=env,Value=dev}]')).toEqual({
      ResourceType: 'instance',
      Tags: [
        { Key: 'Name', Value: 'web' },
        { Key: 'env', Value: 'dev' },
      ],
    });
  });
  test('reports where it failed', () => {
    expect(() => parseShorthand('Name')).toThrow("Expected: '=', received: 'EOF'");
  });
});

describe('formats', () => {
  const identity = { UserId: 'AIDAEXAMPLE', Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/admin' };
  test('json uses 4 spaces like the CLI', () => {
    expect(formatJson({ a: 1 })).toBe('{\n    "a": 1\n}\n');
  });
  test('text prints scalars sorted by key', () => {
    expect(formatText(identity)).toBe('123456789012\tarn:aws:iam::123456789012:user/admin\tAIDAEXAMPLE\n');
  });
  test('text prefixes nested lists with their key', () => {
    const data = { Reservations: [{ Instances: [{ InstanceId: 'i-1', State: { Name: 'running' } }] }] };
    // A dict with no scalars prints no line of its own (as in awscli).
    expect(formatText(data)).toBe('INSTANCES\ti-1\nSTATE\trunning\n');
  });
  test('text: a list of scalars is tab separated', () => {
    expect(formatText(['a', 'b', 'c'])).toBe('a\tb\tc\n');
  });
  test('table has the operation as title and sorted headers', () => {
    const t = formatTable(identity, 'GetCallerIdentity').split('\n');
    expect(t[0]).toMatch(/^-+$/);
    expect(t[1]).toContain('GetCallerIdentity');
    expect(t[3]).toMatch(/Account.*Arn.*UserId/);
    expect(t[5]).toContain('123456789012');
  });
  test('yaml quotes strings that look like numbers', () => {
    expect(formatYaml(identity)).toContain("Account: '123456789012'");
  });
});

describe('iam evaluation', () => {
  const allowS3Read = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:Get*', 's3:List*'], Resource: '*' }] });
  const denyDelete = JSON.stringify({ Statement: [{ Effect: 'Deny', Action: 's3:*', Resource: 'arn:aws:s3:::secreto/*' }] });
  test('wildcard actions', () => {
    expect(evaluate([allowS3Read], 's3:GetObject', ['arn:aws:s3:::b/k'])).toBe('allow');
    expect(evaluate([allowS3Read], 's3:PutObject', ['arn:aws:s3:::b/k'])).toBe('implicit-deny');
  });
  test('explicit deny wins', () => {
    expect(evaluate([allowS3Read, denyDelete], 's3:GetObject', ['arn:aws:s3:::secreto/x'])).toBe('explicit-deny');
  });
  test('"*" requests need Resource "*"', () => {
    const scoped = JSON.stringify({ Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: 'arn:aws:s3:::b' }] });
    expect(evaluate([scoped], 's3:ListAllMyBuckets', ['*'])).toBe('implicit-deny');
  });
  test('NotAction', () => {
    const power = JSON.stringify({ Statement: [{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }] });
    expect(evaluate([power], 'ec2:RunInstances', ['*'])).toBe('allow');
    expect(evaluate([power], 'iam:CreateUser', ['*'])).toBe('implicit-deny');
  });
  test('trust policies', () => {
    const trust = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'sts:AssumeRole' }] });
    expect(trustAllows(trust, 'arn:aws:iam::123456789012:user/admin', '123456789012')).toBe(true);
    const ec2 = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
    expect(trustAllows(ec2, 'arn:aws:iam::123456789012:user/admin', '123456789012')).toBe(false);
  });
  test('identity policies may not name a principal', () => {
    expect(validatePolicyDocument('{"Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:*","Resource":"*"}]}', 'identity')).toBe(
      'Policy document should not specify a principal.',
    );
    expect(validatePolicyDocument('{nope', 'identity')).toBe('This policy contains invalid Json');
  });
});

describe('cli behaviour', () => {
  test('get-caller-identity as admin', () => {
    const s = session('aws sts get-caller-identity');
    expect(json(s.last().output).Arn).toBe('arn:aws:iam::123456789012:user/admin');
  });

  test('missing required argument', () => {
    const s = session('aws s3api create-bucket');
    expect(s.last().exitCode).toBe(252);
    expect(s.last().output).toContain('aws: error: the following arguments are required: --bucket');
  });

  test('unknown operation and option', () => {
    expect(session('aws ec2 launch-instance').last().output).toContain('argument operation: Invalid choice');
    expect(session('aws s3 ls --foo bar').last().output).toContain('Unknown options: --foo, bar');
  });

  test('bucket lifecycle: BucketNotEmpty, then rb --force', () => {
    const s = session('aws s3 mb s3://b-uev-1', 'aws s3 cp web/index.html s3://b-uev-1/', 'aws s3 rb s3://b-uev-1');
    expect(s.last().exitCode).toBe(1);
    expect(s.last().output).toContain('(BucketNotEmpty)');
    const r = s.exec('aws s3 rb s3://b-uev-1 --force');
    expect(r.output).toBe('delete: s3://b-uev-1/index.html\nremove_bucket: b-uev-1\n');
    expect(s.state.s3['b-uev-1']).toBeUndefined();
  });

  test('bucket names are global and validated', () => {
    expect(session('aws s3 mb s3://test').last().output).toContain('BucketAlreadyExists');
    expect(session('aws s3 mb s3://Mayusculas').last().output).toContain('InvalidBucketName');
  });

  test('create-bucket needs a LocationConstraint outside us-east-1', () => {
    expect(session('aws s3api create-bucket --bucket x-uev-1').last().output).toContain('IllegalLocationConstraintException');
    expect(session('aws s3api create-bucket --bucket x-uev-1 --create-bucket-configuration LocationConstraint=eu-west-1').last().exitCode).toBe(0);
    expect(session('aws s3api create-bucket --bucket x-uev-1 --region us-east-1').last().exitCode).toBe(0);
  });

  test('a failed call changes nothing', () => {
    const s = session('aws iam create-user --user-name ana');
    const before = JSON.stringify(s.state.iam);
    s.exec('aws iam create-user --user-name ana');
    expect(s.last().output).toContain('EntityAlreadyExists');
    expect(JSON.stringify(s.state.iam)).toBe(before);
  });

  test('delete-user conflicts until policies are detached', () => {
    const s = session(
      'aws iam create-user --user-name ana',
      'aws iam attach-user-policy --user-name ana --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess',
      'aws iam delete-user --user-name ana',
    );
    expect(s.last().output).toContain('(DeleteConflict)');
    s.exec('aws iam detach-user-policy --user-name ana --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess');
    expect(s.exec('aws iam delete-user --user-name ana').exitCode).toBe(0);
  });

  test('instances go pending → running and stop → stopped', () => {
    const s = session(
      "AMI=$(aws ec2 describe-images --owners amazon --filters Name=name,Values='al2023-ami-*-x86_64' --query 'Images[0].ImageId' --output text)",
      "ID=$(aws ec2 run-instances --image-id $AMI --instance-type t3.micro --query 'Instances[0].InstanceId' --output text)",
    );
    const state = () => s.exec("aws ec2 describe-instances --instance-ids $ID --query 'Reservations[0].Instances[0].State.Name' --output text").output.trim();
    expect(state()).toBe('running');
    const stop = json(s.exec('aws ec2 stop-instances --instance-ids $ID').output);
    expect(stop.StoppingInstances[0].CurrentState).toEqual({ Code: 64, Name: 'stopping' });
    expect(state()).toBe('stopped');
    expect(s.exec('aws ec2 wait instance-stopped --instance-ids $ID').exitCode).toBe(0);
  });

  test('architecture mismatch between AMI and instance type', () => {
    const s = session(
      "AMI=$(aws ec2 describe-images --owners amazon --filters Name=name,Values='al2023-ami-*-x86_64' --query 'Images[0].ImageId' --output text)",
      'aws ec2 run-instances --image-id $AMI --instance-type t4g.micro',
    );
    expect(s.last().output).toContain("The architecture 'arm64' of the specified instance type does not match");
  });

  test('--dry-run', () => {
    const s = session('aws ec2 describe-vpcs --dry-run');
    expect(s.last().output).toContain('(DryRunOperation)');
  });

  test('VPC with a subnet cannot be deleted', () => {
    const s = session(
      "VPC=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --query Vpc.VpcId --output text)",
      'aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.1.0/24',
      'aws ec2 create-subnet --vpc-id $VPC --cidr-block 10.0.1.128/25',
      'aws ec2 delete-vpc --vpc-id $VPC',
    );
    expect(s.results[2].output).toContain('InvalidSubnet.Conflict');
    expect(s.last().output).toContain('(DependencyViolation)');
  });

  test('--query and --output', () => {
    const s = session("aws ec2 describe-regions --query 'Regions[?starts_with(RegionName, `eu`)].RegionName' --output text");
    expect(s.last().output.trim().split('\t')).toEqual(['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1']);
    expect(session("aws ec2 describe-vpcs --query 'length(Vpcs)'").last().output).toBe('1\n');
    expect(session("aws ec2 describe-vpcs --query 'Vpcs[?'").last().exitCode).toBe(252);
  });

  test('region and credentials errors', () => {
    const s = session('unset x', 'aws s3 ls --region mars-east-1');
    expect(s.last().output).toContain('Could not connect to the endpoint URL: "https://s3.mars-east-1.amazonaws.com/"');
    s.exec('export AWS_ACCESS_KEY_ID=AKIANOTREAL00000000 AWS_SECRET_ACCESS_KEY=x');
    expect(s.exec('aws sts get-caller-identity').output).toContain('(InvalidClientTokenId)');
    expect(s.exec('aws s3 ls').output).toContain('(InvalidAccessKeyId)');
    s.exec('unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY');
    expect(s.exec('aws sts get-caller-identity --profile nadie').output).toContain('The config profile (nadie) could not be found');
  });

  test('assume-role credentials exported by hand', () => {
    const s = session(
      'aws iam create-role --role-name Lector --assume-role-policy-document file://politicas/confianza-cuenta.json',
      'aws iam attach-role-policy --role-name Lector --policy-arn arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess',
      "export AWS_ACCESS_KEY_ID=$(aws sts assume-role --role-arn arn:aws:iam::123456789012:role/Lector --role-session-name yo --query Credentials.AccessKeyId --output text)",
    );
    const cred = Object.values(s.state.sessions)[0];
    s.exec(`export AWS_SECRET_ACCESS_KEY=${cred.SecretAccessKey} AWS_SESSION_TOKEN=${cred.SessionToken}`);
    expect(json(s.exec('aws sts get-caller-identity').output).Arn).toBe('arn:aws:sts::123456789012:assumed-role/Lector/yo');
    expect(s.exec('aws ec2 describe-vpcs').exitCode).toBe(0);
    const denied = s.exec('aws ec2 create-vpc --cidr-block 10.1.0.0/16');
    expect(denied.output).toContain('(UnauthorizedOperation)');
    expect(denied.output).toContain('because no identity-based policy allows the ec2:CreateVpc action');
    expect(promptText(s.state)).toContain('rol:Lector');
  });

  test('a service role cannot be assumed by a user', () => {
    const s = session(
      'aws iam create-role --role-name ParaEc2 --assume-role-policy-document file://politicas/confianza-ec2.json',
      'aws sts assume-role --role-arn arn:aws:iam::123456789012:role/ParaEc2 --role-session-name yo',
    );
    expect(s.last().output).toContain('is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::123456789012:role/ParaEc2');
  });

  test('file:// that does not exist', () => {
    const s = session('aws iam create-policy --policy-name X --policy-document file://no-existe.json');
    expect(s.last().output).toContain("Unable to load paramfile file://no-existe.json: [Errno 2] No such file or directory: 'no-existe.json'");
  });

  test('shell: redirection, cd, pipes and unknown commands', () => {
    const s = session('echo hola > saludo.txt', 'echo adios >> saludo.txt', 'cat saludo.txt');
    expect(s.last().output).toBe('hola\nadios\n');
    expect(s.exec('cd web').exitCode).toBe(0);
    expect(s.exec('ls').output).toBe('error.html  index.html  style.css\n');
    expect(s.exec('aws s3 ls | grep x').output).toContain('tuberías');
    expect(s.exec('grep x').exitCode).toBe(127);
  });

  test('aws configure asks four questions', () => {
    const s = session('aws configure --profile nuevo');
    expect(promptText(s.state)).toBe('AWS Access Key ID [None]: ');
    s.exec('AKIAIOSFODNN7EXAMPLE');
    s.exec('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(promptText(s.state)).toBe('Default region name [None]: ');
    s.exec('us-east-1');
    s.exec('');
    expect(s.state.prompt).toBeUndefined();
    expect(json(s.exec('aws sts get-caller-identity --profile nuevo').output).Arn).toContain('user/admin');
  });

  test('tab completion', () => {
    const st = initialState(new Date(T0));
    expect(complete('aws ec2 run', st)).toBe('aws ec2 run-instances ');
    expect(complete('aws s3api create-bucket --crea', st)).toBe('aws s3api create-bucket --create-bucket-configuration ');
    expect(complete('cat pol', st)).toBe('cat politicas/');
    expect(complete('aws s3 ls --output ta', st)).toBe('aws s3 ls --output table ');
  });
});

describe('scenarios', () => {
  for (const sc of SCENARIOS) {
    test(`${sc.label}: every step works and gets its check mark`, () => {
      const s = session();
      const log: CommandLog = { ok: [], failed: [] };
      let progress = advance(sc, 0, s.state, log);
      expect(progress).toBe(0);
      for (const step of sc.steps) {
        const r = s.exec(step.command);
        (r.exitCode === 0 ? log.ok : log.failed).push(step.command);
        if (step.expectError) expect({ step: step.command, exit: r.exitCode }).not.toEqual({ step: step.command, exit: 0 });
        else expect({ step: step.command, output: r.output, exit: r.exitCode }).toMatchObject({ exit: 0 });
        expect({ step: step.command, done: stepDone(step, s.state, log) }).toEqual({ step: step.command, done: true });
        progress = advance(sc, progress, s.state, log);
        expect({ step: step.command, progress }).toEqual({ step: step.command, progress: sc.steps.indexOf(step) + 1 });
      }
    });
  }
});
