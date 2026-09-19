// Datos del cronograma del Máster en IA: dos cohortes (online los martes,
// presencial los miércoles) que comparten el mismo temario de certificación.

export type CertKey = 'arranque' | 'aws' | 'dp900' | 'ai901' | 'cierre';
export type Profesor = 'Salva' | 'Javier';

export interface CertInfo {
  label: string;
  color: string;
  soft: string;
}

export const CERTS: Record<CertKey, CertInfo> = {
  arranque: { label: 'Arranque', color: 'var(--cal-arranque)', soft: 'var(--cal-arranque-soft)' },
  aws: { label: 'AWS AIP', color: 'var(--cal-aws)', soft: 'var(--cal-aws-soft)' },
  dp900: { label: 'DP-900', color: 'var(--cal-dp900)', soft: 'var(--cal-dp900-soft)' },
  ai901: { label: 'AI-901', color: 'var(--cal-ai901)', soft: 'var(--cal-ai901-soft)' },
  cierre: { label: 'Cierre', color: 'var(--cal-cierre)', soft: 'var(--cal-cierre-soft)' },
};

export interface Sesion {
  n: number;
  /** Fecha de la sesión online (martes), o null si la cohorte aún no ha empezado. */
  o: string | null;
  /** Fecha de la sesión presencial (miércoles). */
  p: string;
  cert: CertKey;
  tema: string;
  prof: Profesor;
  /** Nota de parón que precede a esta semana, si aplica. */
  brk?: string;
}

export const SESIONES: Sesion[] = [
  { n: 1, o: null, p: '21/10/2026', cert: 'arranque', tema: 'Presentación del módulo, mapa de las tres certificaciones y alta de cuentas AWS/Azure', prof: 'Salva' },
  { n: 2, o: null, p: '28/10/2026', cert: 'arranque', tema: 'Nivelación técnica: datos, Python/notebooks y consolas cloud para las prácticas', prof: 'Javier' },
  { n: 3, o: '03/11/2026', p: '04/11/2026', cert: 'aws', tema: 'Dominio 1 · Fundamentos de IA y machine learning (20 %)', prof: 'Salva' },
  { n: 4, o: '10/11/2026', p: '11/11/2026', cert: 'aws', tema: 'Dominio 2 · Fundamentos de IA generativa (24 %)', prof: 'Salva' },
  { n: 5, o: '17/11/2026', p: '18/11/2026', cert: 'aws', tema: 'Dominio 3 (I) · Aplicaciones de foundation models: prompting y RAG (28 %)', prof: 'Javier' },
  { n: 6, o: '24/11/2026', p: '25/11/2026', cert: 'aws', tema: 'Dominio 3 (II) · Evaluación, personalización y Amazon Bedrock (28 %)', prof: 'Javier' },
  { n: 7, o: '01/12/2026', p: '02/12/2026', cert: 'aws', tema: 'Dominios 4 y 5 · IA responsable, seguridad, cumplimiento y gobernanza (28 %)', prof: 'Salva' },
  { n: 8, o: '08/12/2026', p: '09/12/2026', cert: 'aws', tema: 'Repaso general AWS AI Practitioner + simulacro de examen', prof: 'Salva' },
  { n: 9, o: '15/12/2026', p: '16/12/2026', cert: 'dp900', tema: 'Fundamentos de datos: estructurados, semiestructurados y no estructurados; roles', prof: 'Javier' },
  { n: 10, o: '12/01/2027', p: '13/01/2027', cert: 'dp900', tema: 'Datos relacionales en Azure: SQL, normalización, Azure SQL Database/Managed Instance', prof: 'Javier', brk: 'Parón de Navidad' },
  { n: 11, o: '19/01/2027', p: '20/01/2027', cert: 'dp900', tema: 'Datos no relacionales en Azure: Blob/Files/Tables, Azure Cosmos DB', prof: 'Salva' },
  { n: 12, o: '26/01/2027', p: '27/01/2027', cert: 'dp900', tema: 'Cargas de trabajo analíticas: ingesta, batch/streaming, Power BI', prof: 'Salva' },
  { n: 13, o: '02/02/2027', p: '03/02/2027', cert: 'dp900', tema: 'Repaso general DP-900 + simulacro de examen', prof: 'Javier' },
  { n: 14, o: '09/02/2027', p: '10/02/2027', cert: 'ai901', tema: 'Conceptos de IA: IA responsable, cargas de trabajo, análisis de texto, voz y visión', prof: 'Javier' },
  { n: 15, o: '16/02/2027', p: '17/02/2027', cert: 'ai901', tema: 'Microsoft Foundry (I): apps y agentes generativos, despliegue de modelos, SDKs', prof: 'Salva' },
  { n: 16, o: '23/02/2027', p: '24/02/2027', cert: 'ai901', tema: 'Microsoft Foundry (II): texto y voz, modelos multimodales', prof: 'Salva' },
  { n: 17, o: '02/03/2027', p: '03/03/2027', cert: 'ai901', tema: 'Microsoft Foundry (III): visión, generación de imágenes, extracción de información', prof: 'Javier' },
  { n: 18, o: '09/03/2027', p: '10/03/2027', cert: 'ai901', tema: 'Repaso general AI-901 + simulacro práctico (Python/REST/SDK)', prof: 'Javier' },
  { n: 19, o: '06/04/2027', p: '07/04/2027', cert: 'cierre', tema: 'Simulacros combinados de las tres certificaciones + resolución de dudas', prof: 'Salva', brk: 'Parón de marzo · ventana de exámenes oficiales' },
  { n: 20, o: '13/04/2027', p: '14/04/2027', cert: 'cierre', tema: 'Estrategia de examen, dudas finales y cierre del módulo', prof: 'Javier' },
];

export interface Bloque {
  cert: CertKey;
  from: number;
  to: number;
  label: string;
}

export const BLOQUES: Bloque[] = [
  { cert: 'arranque', from: 1, to: 2, label: 'Arranque' },
  { cert: 'aws', from: 3, to: 8, label: 'AWS AI Practitioner' },
  { cert: 'dp900', from: 9, to: 13, label: 'DP-900' },
  { cert: 'ai901', from: 14, to: 18, label: 'AI-901' },
  { cert: 'cierre', from: 19, to: 20, label: 'Cierre' },
];

/** Meses (año, índice 0-based) que cubre el cronograma, de oct-2026 a abr-2027. */
export const MESES_CALENDARIO: Array<[number, number]> = [
  [2026, 9], [2026, 10], [2026, 11],
  [2027, 0], [2027, 1], [2027, 2], [2027, 3],
];

export function parseFecha(d: string): Date {
  const [dd, mm, yy] = d.split('/').map(Number);
  return new Date(yy, mm - 1, dd);
}

export function inicial(p: Profesor): string {
  return p === 'Salva' ? 'S' : 'J';
}
