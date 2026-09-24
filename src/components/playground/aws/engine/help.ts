import type { Op, Service } from './spec';
import { GLOBAL_OPTS, SERVICES, opOptions } from './registry';

const col = (rows: [string, string][], width: number) => rows.map(([a, b]) => `  ${a.padEnd(width)}  ${b}`).join('\n');

export const SHELL_HELP = `Playground de AWS CLI · todo es simulado y vive en tu navegador

Comandos del terminal:
  aws …                 la CLI de AWS (escribe "aws help")
  ls, cd, pwd, cat      moverse por tus ficheros (~/web, ~/datos, ~/politicas)
  echo "texto" > f.txt  crear ficheros; "cmd > fichero" guarda la salida
  touch, mkdir, rm      crear y borrar ficheros locales
  export VAR=valor      variables de entorno (AWS_PROFILE, AWS_ACCESS_KEY_ID…)
  unset VAR, env        quitar y ver variables
  history, clear        historial y limpiar (también Ctrl+L)

Teclas: ↑/↓ historial · Tab autocompleta servicios, operaciones, opciones,
buckets y ficheros.
`;

export function awsHelp(): string {
  const services: [string, string][] = SERVICES.map((s) => [s.name, s.help]);
  services.push(['configure', 'Credenciales, región y formato de salida (perfiles)']);
  const globals: [string, string][] = Object.entries(GLOBAL_OPTS)
    .filter(([, v]) => !v.help.startsWith('Aceptada'))
    .map(([k, v]) => [`--${k}${v.type === 'string' ? ' <valor>' : ''}`, v.help]);
  return `AWS CLI · playground (cuenta 123456789012 simulada, nada sale de tu navegador)

Uso:  aws [opciones] <servicio> <operación> [parámetros]

Servicios:
${col(services, 10)}

Opciones globales:
${col(globals, 18)}

Más ayuda:  aws <servicio> help  ·  aws <servicio> <operación> help
Ejemplos:   aws sts get-caller-identity
            aws s3 ls
            aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId' --output text
`;
}

export function serviceHelp(s: Service): string {
  const width = Math.max(...s.ops.map((o) => o.name.length));
  return `${s.name} — ${s.help}

Operaciones:
${col(s.ops.map((o) => [o.name, o.help]), width)}

Detalle de una operación:  aws ${s.name} <operación> help
`;
}

export function opHelp(s: Service, op: Op): string {
  const opts = opOptions(s, op.opts);
  const syn = [
    ...(op.positional || []).map((p) => (p.required ? `<${p.name}>` : `[<${p.name}>]`)),
    ...opts.map((o) => {
      const v = o.type === 'bool' ? '' : ' <valor>';
      return o.required ? `--${o.name}${v}` : `[--${o.name}${v}]`;
    }),
  ];
  const desc = opts.map((o) => {
    const kind = o.type === 'bool' ? 'flag' : o.type;
    const extra = [o.required ? 'obligatoria' : '', o.choices ? `valores: ${o.choices.join(' | ')}` : '', o.help ?? ''].filter(Boolean).join(' · ');
    return `       --${o.name} (${kind})${extra ? `  ${extra}` : ''}`;
  });
  return `NOMBRE
       aws ${s.name} ${op.name}

DESCRIPCIÓN
       ${op.help}

SINOPSIS
       aws ${s.name} ${op.name}
${syn.map((x) => `          ${x}`).join('\n')}
${desc.length ? `\nOPCIONES\n${desc.join('\n')}\n` : ''}${op.example ? `\nEJEMPLO\n       ${op.example}\n` : ''}`;
}
