import { CERTS, SESIONES } from './data';

export type Grupo = 'online' | 'presencial';

export const HORARIO = { inicio: '18:30', fin: '21:00' };

export interface GrupoInfo {
  archivo: string;
  nombre: string;
  dia: string;
  /** LOCATION del .ics. */
  lugar: string;
  /** Líneas de dirección para mostrar en la tarjeta; sin ella se muestra `lugar`. */
  direccion?: [string, string];
  /** Búsqueda de Google Maps; incluye el nombre del sitio porque la dirección sola resuelve a otro lugar. */
  mapa?: string;
}

export const GRUPOS: Record<Grupo, GrupoInfo> = {
  online: {
    archivo: 'ai-26-27-online.ics',
    nombre: 'Máster IA 26/27 · Online',
    dia: 'Martes',
    lugar: 'Online',
  },
  presencial: {
    archivo: 'ai-26-27-presencial.ics',
    nombre: 'Máster IA 26/27 · Presencial',
    dia: 'Miércoles',
    lugar: 'Universidad Europea de Valencia, Campus Turia, C/ de Guillem de Castro, 175, Extramurs, 46008 València, Valencia',
    direccion: ['UEV · Campus Turia', 'C/ de Guillem de Castro, 175, 46008 València'],
    mapa: 'Universidad Europea de Valencia Campus Turia, C/ de Guillem de Castro, 175, 46008 València',
  },
};

/** Ruta pública (relativa al baseUrl) donde se sirven los .ics. */
export const ICS_DIR = 'calendario';

/** Host público para las URLs de suscripción y los enlaces dentro del .ics (en lugar de `siteConfig.url`). */
export const ICS_HOST = 'https://salvamiguel.com';

// Fijo para que el fichero generado sea idéntico entre builds si no cambian los datos.
const DTSTAMP = '20260901T000000Z';

const VTIMEZONE_MADRID = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'X-LIC-LOCATION:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1: líneas de máx. 75 octetos, sin partir caracteres UTF-8.
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const len = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + len > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function fechaHora(fecha: string, hora: string): string {
  const [dd, mm, yyyy] = fecha.split('/');
  return `${yyyy}${mm}${dd}T${hora.replace(':', '')}00`;
}

export function buildIcs(grupo: Grupo, pageUrl: string): string {
  const g = GRUPOS[grupo];
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//salvamiguel//Materials Calendario 26-27//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(g.nombre)}`,
    `X-WR-CALDESC:${escapeText(`Clases del grupo ${grupo} · ${g.dia} de ${HORARIO.inicio} a ${HORARIO.fin}`)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...VTIMEZONE_MADRID,
  ];

  SESIONES.forEach((s) => {
    const fecha = grupo === 'online' ? s.o : s.p;
    if (!fecha) return;
    const cert = CERTS[s.cert];
    const descripcion = [
      `Semana ${s.n} · Grupo ${grupo}`,
      `Profesor: ${s.prof}`,
      `Horario: ${HORARIO.inicio}–${HORARIO.fin}`,
      '',
      `Calendario completo: ${pageUrl}`,
    ].join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:ai-2627-${grupo}-sem${String(s.n).padStart(2, '0')}@salvamiguel.com`,
      `DTSTAMP:${DTSTAMP}`,
      `DTSTART;TZID=Europe/Madrid:${fechaHora(fecha, HORARIO.inicio)}`,
      `DTEND;TZID=Europe/Madrid:${fechaHora(fecha, HORARIO.fin)}`,
      `SUMMARY:${escapeText(`${cert.label} · ${s.tema}`)}`,
      `DESCRIPTION:${escapeText(descripcion)}`,
      `LOCATION:${escapeText(g.lugar)}`,
      `CATEGORIES:${escapeText(cert.label)}`,
      `URL:${pageUrl}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'SEQUENCE:0',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:La clase empieza en 30 minutos',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
