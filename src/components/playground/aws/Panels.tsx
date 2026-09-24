import React, { useMemo, useState } from 'react';
import type { PlaygroundState } from './engine/types';
import { describeSession, readFile } from './engine/engine';
import { websiteEndpoint } from './engine/services/s3';
import { HOME } from './engine/seed';
import type { Scenario } from './engine/scenarios';
import ui from '../shared/playground.module.css';
import styles from './aws.module.css';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Actions {
  /** Paste a command in the terminal input. */
  paste: (cmd: string) => void;
  /** Run a command right away. */
  execute: (cmd: string) => void;
  busy: boolean;
}

// ── scenario ─────────────────────────────────────────────────────────

export function ScenarioPanel({ scenario, progress, paste, execute, busy }: { scenario: Scenario; progress: number } & Actions) {
  const done = scenario.steps.map((_, i) => i < progress);
  const count = progress;
  const next = progress;
  return (
    <div>
      <div className={styles.scenarioHead}>
        <div className={styles.scenarioTitle}>{scenario.label}</div>
        <div className={styles.scenarioDesc}>{scenario.description}</div>
        <div className={styles.progress}>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${(count / scenario.steps.length) * 100}%` }} />
          </div>
          {count}/{scenario.steps.length}
        </div>
      </div>
      <ol className={styles.steps}>
        {scenario.steps.map((s, i) => (
          <li key={i} className={`${styles.step} ${done[i] ? styles.stepDone : ''} ${i === next ? styles.stepNext : ''}`}>
            <span className={styles.check} aria-label={done[i] ? 'hecho' : 'pendiente'}>
              {done[i] ? '✓' : i + 1}
            </span>
            <div>
              <div className={styles.stepText}>
                {s.text}
                {s.expectError && <span className={styles.expect}>error esperado</span>}
              </div>
              <div className={styles.cmd}>
                <button className={styles.cmdText} onClick={() => paste(s.command)} title="Pegar en el terminal">
                  {s.command}
                </button>
                <button className={styles.cmdRun} onClick={() => execute(s.command)} disabled={busy} title="Ejecutar">
                  ▶
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── resources ────────────────────────────────────────────────────────

function Group({ title, count, children, extra }: { title: string; count?: number; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {extra}
      </div>
      {children}
    </div>
  );
}

function Items<T>({ kind, items, render }: { kind: string; items: T[]; render: (item: T) => React.ReactNode }) {
  return (
    <>
      <div className={styles.kind}>{kind}</div>
      {items.length ? <ul className={styles.items}>{items.map(render)}</ul> : <div className={styles.empty}>ninguno</div>}
    </>
  );
}

function Item({ name, meta, badge, onClick }: { name: string; meta?: string; badge?: string; onClick: () => void }) {
  return (
    <li className={styles.item} onClick={onClick} title="Pegar un comando para ver el detalle">
      <span className={styles.itemName}>{name}</span>
      {badge && <span className={`${styles.badge} ${styles['st_' + badge] ?? ''}`}>{badge}</span>}
      {meta && <span className={styles.itemMeta}>{meta}</span>}
    </li>
  );
}

const nameTag = (x: Json) => x.Tags?.find((t: Json) => t.Key === 'Name')?.Value as string | undefined;

export function ResourcesPanel({ state, paste }: { state: PlaygroundState } & Pick<Actions, 'paste'>) {
  const session = describeSession(state);
  const regions = Object.keys(state.ec2);
  const [picked, setPicked] = useState<string | undefined>();
  const region = picked && state.ec2[picked] ? picked : session.region && state.ec2[session.region] ? session.region : regions[0];
  const r = region ? state.ec2[region] : undefined;
  const reg = region ? ` --region ${region}` : '';
  const instances = r ? r.reservations.flatMap((x) => x.Instances) : [];
  const envVars = Object.entries(state.env).filter(([k]) => k.startsWith('AWS_'));
  const iam = state.iam;
  const buckets = Object.values(state.s3);

  return (
    <div>
      <dl className={styles.identity}>
        <dt>identidad</dt>
        <dd>{session.who}</dd>
        <dt>región</dt>
        <dd>{session.region ?? '—'}</dd>
        <dt>perfiles</dt>
        <dd>{Object.keys(state.profiles).join(', ')}</dd>
        {envVars.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{/SECRET|TOKEN/.test(k) ? '****' + v.slice(-4) : v}</dd>
          </React.Fragment>
        ))}
      </dl>

      <Group title="IAM" count={Object.keys(iam.users).length + Object.keys(iam.groups).length + Object.keys(iam.roles).length + Object.keys(iam.policies).length}>
        <Items
          kind="Usuarios"
          items={Object.values(iam.users)}
          render={(u) => (
            <Item
              key={u.UserName}
              name={u.UserName}
              meta={[u.groups.length ? `grupos: ${u.groups.join(', ')}` : '', u.attached.length ? `${u.attached.length} políticas` : '', u.accessKeys.length ? `${u.accessKeys.length} claves` : ''].filter(Boolean).join(' · ')}
              onClick={() => paste(`aws iam list-attached-user-policies --user-name ${u.UserName}`)}
            />
          )}
        />
        <Items kind="Grupos" items={Object.values(iam.groups)} render={(g) => <Item key={g.GroupName} name={g.GroupName} meta={g.attached.map((a) => a.split('/').pop()).join(', ')} onClick={() => paste(`aws iam get-group --group-name ${g.GroupName}`)} />} />
        <Items
          kind="Roles"
          items={Object.values(iam.roles)}
          render={(ro) => (
            <Item key={ro.RoleName} name={ro.RoleName} meta={[...ro.attached.map((a) => a.split('/').pop()), ...Object.keys(ro.inline)].join(', ')} onClick={() => paste(`aws iam get-role --role-name ${ro.RoleName}`)} />
          )}
        />
        <Items kind="Políticas propias" items={Object.values(iam.policies)} render={(p) => <Item key={p.Arn} name={p.PolicyName} onClick={() => paste(`aws iam get-policy-version --policy-arn ${p.Arn} --version-id v1`)} />} />
      </Group>

      <Group title="S3" count={buckets.length}>
        <Items
          kind="Buckets"
          items={buckets}
          render={(b) => (
            <React.Fragment key={b.Name}>
              <Item name={b.Name} meta={`${Object.keys(b.objects).length} objetos · ${b.region}${b.website ? ' · web' : ''}`} onClick={() => paste(`aws s3 ls s3://${b.Name} --recursive --human-readable`)} />
              {b.website && (
                <Item name="  ↳ web" meta={websiteEndpoint(b)} onClick={() => paste(`aws s3api get-bucket-website --bucket ${b.Name}`)} />
              )}
            </React.Fragment>
          )}
        />
      </Group>

      <Group
        title="EC2"
        extra={
          regions.length > 1 ? (
            <select className={ui.select} value={region} onChange={(e) => setPicked(e.target.value)} aria-label="Región">
              {regions.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : (
            region && <span className={styles.itemMeta}>{region}</span>
          )
        }
      >
        {!r ? (
          <div className={styles.empty}>Aún no has usado EC2: prueba aws ec2 describe-vpcs</div>
        ) : (
          <>
            <Items
              kind="Instancias"
              items={instances}
              render={(i: Json) => (
                <Item
                  key={i.InstanceId}
                  name={nameTag(i) ?? i.InstanceId}
                  badge={i.State.Name}
                  meta={[nameTag(i) ? i.InstanceId : '', i.InstanceType, i.PublicIpAddress].filter(Boolean).join(' · ')}
                  onClick={() => paste(`aws ec2 describe-instances --instance-ids ${i.InstanceId}${reg}`)}
                />
              )}
            />
            <Items
              kind="VPC"
              items={r.vpcs}
              render={(v: Json) => (
                <Item key={v.VpcId} name={nameTag(v) ?? v.VpcId} meta={`${v.CidrBlock}${v.IsDefault ? ' · por defecto' : ''}${nameTag(v) ? ' · ' + v.VpcId : ''}`} onClick={() => paste(`aws ec2 describe-subnets --filters Name=vpc-id,Values=${v.VpcId}${reg} --output table`)} />
              )}
            />
            <Items
              kind="Subredes"
              items={r.subnets}
              render={(s: Json) => (
                <Item key={s.SubnetId} name={nameTag(s) ?? s.SubnetId} meta={`${s.CidrBlock} · ${s.AvailabilityZone}${s.MapPublicIpOnLaunch ? ' · pública' : ''}`} onClick={() => paste(`aws ec2 describe-subnets --subnet-ids ${s.SubnetId}${reg}`)} />
              )}
            />
            <Items
              kind="Security groups"
              items={r.securityGroups}
              render={(g: Json) => (
                <Item
                  key={g.GroupId}
                  name={g.GroupName}
                  meta={`${g.GroupId} · ${g.IpPermissions.map((p: Json) => (p.IpProtocol === '-1' ? 'todo' : `${p.FromPort}${p.ToPort !== p.FromPort ? '-' + p.ToPort : ''}/${p.IpProtocol}`)).join(', ') || 'sin reglas de entrada'}`}
                  onClick={() => paste(`aws ec2 describe-security-groups --group-ids ${g.GroupId}${reg}`)}
                />
              )}
            />
            <Items kind="Internet gateways" items={r.internetGateways} render={(g: Json) => <Item key={g.InternetGatewayId} name={g.InternetGatewayId} meta={g.Attachments[0]?.VpcId ?? 'sin conectar'} onClick={() => paste(`aws ec2 describe-internet-gateways --internet-gateway-ids ${g.InternetGatewayId}${reg}`)} />} />
            <Items
              kind="Tablas de rutas"
              items={r.routeTables}
              render={(t: Json) => (
                <Item key={t.RouteTableId} name={t.RouteTableId} meta={`${t.Associations.some((a: Json) => a.Main) ? 'principal · ' : ''}${t.Routes.map((x: Json) => `${x.DestinationCidrBlock}→${x.GatewayId}`).join(', ')}`} onClick={() => paste(`aws ec2 describe-route-tables --route-table-ids ${t.RouteTableId}${reg}`)} />
              )}
            />
            <Items kind="Pares de claves" items={r.keyPairs} render={(k: Json) => <Item key={k.KeyPairId} name={k.KeyName} meta={k.KeyType} onClick={() => paste(`aws ec2 describe-key-pairs --key-names ${k.KeyName}${reg}`)} />} />
            <Items kind="Volúmenes" items={r.volumes} render={(v: Json) => <Item key={v.VolumeId} name={v.VolumeId} badge={v.State === 'in-use' ? undefined : v.State} meta={`${v.Size} GiB ${v.VolumeType}${v.Attachments?.[0] ? ' · ' + v.Attachments[0].InstanceId : ''}`} onClick={() => paste(`aws ec2 describe-volumes --volume-ids ${v.VolumeId}${reg}`)} />} />
            <Items kind="IP elásticas" items={r.addresses} render={(a: Json) => <Item key={a.AllocationId} name={a.PublicIp} meta={a.InstanceId ?? 'sin asignar'} onClick={() => paste(`aws ec2 describe-addresses --allocation-ids ${a.AllocationId}${reg}`)} />} />
          </>
        )}
      </Group>
    </div>
  );
}

// ── files ────────────────────────────────────────────────────────────

export function FilesPanel({ state, paste }: { state: PlaygroundState } & Pick<Actions, 'paste'>) {
  const files = useMemo(
    () => [
      ...Object.keys(state.files).filter((f) => !f.endsWith('/.keep')).sort(),
      `${HOME}/.aws/config`,
      `${HOME}/.aws/credentials`,
    ],
    [state.files],
  );
  const [open, setOpen] = useState(`${HOME}/LEEME.txt`);
  const short = (f: string) => (f.startsWith(HOME + '/') ? '~/' + f.slice(HOME.length + 1) : f);
  const content = readFile(state, open);
  return (
    <div>
      <ul className={styles.fileList}>
        {files.map((f) => (
          <li
            key={f}
            className={styles.item}
            onClick={() => {
              setOpen(f);
              paste(`cat ${short(f)}`);
            }}
            style={f === open ? { background: 'var(--tp-border)' } : undefined}
          >
            <span className={styles.itemName}>{short(f)}</span>
            <span className={styles.itemMeta}>{(readFile(state, f) ?? '').length} B</span>
          </li>
        ))}
      </ul>
      {content !== undefined && <pre className={styles.fileContent}>{content || '(vacío)'}</pre>}
    </div>
  );
}

// ── help ─────────────────────────────────────────────────────────────

export function HelpPanel() {
  return (
    <div className={styles.help}>
      <p>
        Es una <b>simulación</b>: no hay ninguna cuenta de AWS detrás y nada sale de tu navegador. La cuenta{' '}
        <code>123456789012</code> empieza con el usuario <code>admin</code> (AdministratorAccess) configurado en el perfil{' '}
        <code>default</code>, en <code>eu-west-1</code>.
      </p>
      <h3>Qué se comporta como en AWS</h3>
      <ul>
        <li>
          La sintaxis de la CLI v2: opciones, <i>shorthand</i> (<code>Key=Name,Value=web</code>), JSON, <code>file://</code>,{' '}
          <code>--query</code> (JMESPath real), <code>--output json|table|text|yaml</code> y los mensajes de error.
        </li>
        <li>
          Credenciales: <code>--profile</code>, variables <code>AWS_*</code> con <code>export</code>, perfiles con{' '}
          <code>role_arn</code> + <code>source_profile</code> y <code>aws configure</code>.
        </li>
        <li>
          Permisos: cuando usas un <b>rol</b> (assume-role o un perfil con role_arn), cada llamada se evalúa contra sus
          políticas (Allow/Deny, comodines, ARNs) y verás <code>AccessDenied</code> o <code>UnauthorizedOperation</code>.
        </li>
        <li>
          Reglas de cada servicio: nombres de bucket globales, <i>Block Public Access</i>, dependencias al borrar
          (DeleteConflict, DependencyViolation), CIDRs, estados de las instancias, <code>--dry-run</code>…
        </li>
        <li>
          El terminal entiende <code>$(…)</code>, variables (<code>$SG</code>), <code>&gt;</code> y <code>&gt;&gt;</code>.
        </li>
      </ul>
      <h3>Qué no</h3>
      <ul>
        <li>Solo STS, IAM, S3 (s3 y s3api) y EC2, con las operaciones más habituales.</li>
        <li>Las políticas de usuarios de IAM no se evalúan (solo las de los roles); las Conditions se ignoran.</li>
        <li>No hay facturación, límites de API, paginación ni tuberías (<code>|</code>).</li>
        <li>Las instancias no ejecutan nada: no puedes hacer SSH ni visitar la web del bucket.</li>
      </ul>
      <p>
        Todo se guarda en tu navegador. <b>Reiniciar</b> vuelve a la cuenta inicial.
      </p>
    </div>
  );
}
