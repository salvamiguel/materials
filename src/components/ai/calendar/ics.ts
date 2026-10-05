import { CERTS, PROF_ONLINE_2, SESIONES, Sesion } from './data';

export type Grupo = 'online1' | 'online2' | 'presencial';

export const HORARIO = { inicio: '18:30', fin: '21:00' };

export interface GrupoInfo {
  archivo: string;
  /** Prefijo de los UID de los eventos; estable para no duplicar eventos en calendarios ya suscritos. */
  uid: string;
  nombre: string;
  /** Nombre corto del grupo, p. ej. «Online 1». */
  etiqueta: string;
  dia: string;
  /** LOCATION del .ics. */
  lugar: string;
  /** Líneas de dirección para mostrar en la tarjeta; sin ella se muestra `lugar`. */
  direccion?: [string, string];
  /** Búsqueda de Google Maps; incluye el nombre del sitio porque la dirección sola resuelve a otro lugar. */
  mapa?: string;
}

export const GRUPOS: Record<Grupo, GrupoInfo> = {
  online1: {
    archivo: 'ai-26-27-online.ics',
    uid: 'online',
    nombre: 'Máster IA 26/27 · Online 1',
    etiqueta: 'Online 1',
    dia: 'Martes',
    lugar: 'Online',
  },
  online2: {
    archivo: 'ai-26-27-online-2.ics',
    uid: 'online2',
    nombre: 'Máster IA 26/27 · Online 2',
    etiqueta: 'Online 2',
    dia: 'Martes',
    lugar: 'Online',
  },
  presencial: {
    archivo: 'ai-26-27-presencial.ics',
    uid: 'presencial',
    nombre: 'Máster IA 26/27 · Presencial',
    etiqueta: 'Presencial',
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

/** Fecha de la sesión para el grupo, o null si ese grupo no tiene clase esa semana. */
export function fechaGrupo(s: Sesion, grupo: Grupo): string | null {
  return grupo === 'presencial' ? s.p : s.o;
}

export function profesorGrupo(s: Sesion, grupo: Grupo): string {
  return grupo === 'online2' ? PROF_ONLINE_2 : s.prof;
}

const EVENT_PREFIX = 'Máster AI - Módulo Certificaciones - UEV - ';

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
    `X-WR-CALDESC:${escapeText(`Clases del grupo ${g.etiqueta.toLowerCase()} · ${g.dia} de ${HORARIO.inicio} a ${HORARIO.fin}`)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...VTIMEZONE_MADRID,
  ];

  SESIONES.forEach((s) => {
    const fecha = fechaGrupo(s, grupo);
    if (!fecha) return;
    const cert = CERTS[s.cert];
    const descripcion = [
      `Semana ${s.n} · Grupo ${g.etiqueta.toLowerCase()}`,
      `Profesor: ${profesorGrupo(s, grupo)}`,
      `Horario: ${HORARIO.inicio}–${HORARIO.fin}`,
      '',
      `Calendario completo: ${pageUrl}`,
    ].join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:ai-2627-${g.uid}-sem${String(s.n).padStart(2, '0')}@salvamiguel.com`,
      `DTSTAMP:${DTSTAMP}`,
      `DTSTART;TZID=Europe/Madrid:${fechaHora(fecha, HORARIO.inicio)}`,
      `DTEND;TZID=Europe/Madrid:${fechaHora(fecha, HORARIO.fin)}`,
      `SUMMARY:${escapeText(`${EVENT_PREFIX}${cert.label} · ${s.tema}`)}`,
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
