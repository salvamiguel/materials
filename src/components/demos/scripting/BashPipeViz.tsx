import React, { useState } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';
import { C, Chip, FONT, box } from './ui';

const LOG = [
  '192.168.1.10 - - [12/Mar/2026:10:01:02 +0100] "GET /index.html HTTP/1.1" 200 5123',
  '10.0.0.7 - - [12/Mar/2026:10:01:05 +0100] "POST /api/login HTTP/1.1" 401 312',
  '192.168.1.10 - - [12/Mar/2026:10:02:11 +0100] "GET /api/users HTTP/1.1" 500 87',
  '172.16.4.2 - - [12/Mar/2026:10:03:40 +0100] "GET /health HTTP/1.1" 200 2',
  '10.0.0.7 - - [12/Mar/2026:10:04:12 +0100] "GET /api/orders HTTP/1.1" 503 91',
  '192.168.1.10 - - [12/Mar/2026:10:04:30 +0100] "GET /api/users HTTP/1.1" 200 1840',
  '10.0.0.9 - - [12/Mar/2026:10:05:01 +0100] "GET /index.html HTTP/1.1" 200 5123',
  '192.168.1.10 - - [12/Mar/2026:10:05:44 +0100] "GET /api/orders HTTP/1.1" 500 87',
  '172.16.4.2 - - [12/Mar/2026:10:06:40 +0100] "GET /health HTTP/1.1" 200 2',
  '10.0.0.7 - - [12/Mar/2026:10:07:02 +0100] "POST /api/login HTTP/1.1" 200 640',
];

type Stage = { cmd: string; explain: string; run: (lines: string[]) => string[] };

// awk splits on runs of blanks, like the default FS.
const fields = (l: string) => l.trim().split(/\s+/);
const sortLex = (ls: string[]) => [...ls].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const uniqC = (ls: string[]) => {
  const out: string[] = [];
  let prev: string | null = null;
  let n = 0;
  for (const l of [...ls, '\u0000']) {
    if (l === prev) n++;
    else {
      if (prev !== null) out.push(`${String(n).padStart(7)} ${prev}`);
      prev = l;
      n = 1;
    }
  }
  return out;
};
const sortRn = (ls: string[]) => [...ls].sort((a, b) => parseFloat(b) - parseFloat(a));

const PIPELINES: { name: string; stages: Stage[] }[] = [
  {
    name: 'Top IPs',
    stages: [
      { cmd: 'cat access.log', explain: 'Lee el fichero y lo envía por stdout.', run: (l) => l },
      { cmd: "awk '{print $1}'", explain: 'Se queda con el primer campo de cada línea: la IP.', run: (l) => l.map((x) => fields(x)[0]) },
      { cmd: 'sort', explain: 'Ordena para que las IPs iguales queden juntas (uniq solo compara líneas consecutivas).', run: sortLex },
      { cmd: 'uniq -c', explain: 'Colapsa las repetidas y antepone cuántas veces aparece cada una.', run: uniqC },
      { cmd: 'sort -rn', explain: 'Ordena por ese número, de mayor a menor.', run: sortRn },
      { cmd: 'head -3', explain: 'Se queda con las tres primeras.', run: (l) => l.slice(0, 3) },
    ],
  },
  {
    name: 'Errores 5xx por ruta',
    stages: [
      { cmd: 'cat access.log', explain: 'Lee el fichero.', run: (l) => l },
      { cmd: "grep -E '\" 5[0-9]{2} '", explain: 'Filtra las líneas con código de estado 500–599.', run: (l) => l.filter((x) => /" 5[0-9]{2} /.test(x)) },
      { cmd: "awk '{print $7}'", explain: 'Extrae el séptimo campo: la ruta pedida.', run: (l) => l.map((x) => fields(x)[6] ?? '') },
      { cmd: 'sort', explain: 'Agrupa las rutas iguales.', run: sortLex },
      { cmd: 'uniq -c', explain: 'Cuenta cada ruta.', run: uniqC },
      { cmd: 'sort -rn', explain: 'Primero las que más fallan.', run: sortRn },
    ],
  },
  {
    name: 'Bytes servidos',
    stages: [
      { cmd: 'cat access.log', explain: 'Lee el fichero.', run: (l) => l },
      { cmd: "grep ' 200 '", explain: 'Solo las respuestas correctas.', run: (l) => l.filter((x) => x.includes(' 200 ')) },
      { cmd: "awk '{s += $NF} END {print s}'", explain: '$NF es el último campo (bytes). END imprime la suma al terminar.', run: (l) => [String(l.reduce((s, x) => s + (parseInt(fields(x).slice(-1)[0], 10) || 0), 0))] },
    ],
  },
  {
    name: 'Líneas por método',
    stages: [
      { cmd: 'cat access.log', explain: 'Lee el fichero.', run: (l) => l },
      { cmd: "cut -d'\"' -f2", explain: 'Corta por comillas y se queda con el segundo trozo: la petición.', run: (l) => l.map((x) => x.split('"')[1] ?? '') },
      { cmd: "cut -d' ' -f1", explain: 'De la petición, la primera palabra: el método HTTP.', run: (l) => l.map((x) => x.split(' ')[0]) },
      { cmd: 'sort', explain: 'Agrupa los métodos.', run: sortLex },
      { cmd: 'uniq -c', explain: 'Cuenta cuántas peticiones hay de cada método.', run: uniqC },
    ],
  },
];

export default function BashPipeViz() {
  const [pi, setPi] = useState(0);
  const [step, setStep] = useState(1);
  const pipe = PIPELINES[pi];

  const outputs: string[][] = [];
  let cur = LOG;
  for (const s of pipe.stages) {
    cur = s.run(cur);
    outputs.push(cur);
  }
  const shown = Math.min(step, pipe.stages.length);
  const out = outputs[shown - 1];
  const choose = (i: number) => {
    setPi(i);
    setStep(1);
  };

  return (
    <DemoWrapper title="Pipes paso a paso" description="Añade un comando cada vez y mira qué sale por cada tubería">
      <div style={{ marginBottom: 10 }}>
        {PIPELINES.map((p, i) => (
          <Chip key={p.name} active={i === pi} onClick={() => choose(i)}>
            {p.name}
          </Chip>
        ))}
      </div>

      <div style={{ ...box, fontSize: 14, lineHeight: 1.8 }}>
        <span style={{ color: C.dim }}>$ </span>
        {pipe.stages.map((s, i) => (
          <span key={i} onClick={() => setStep(i + 1)} style={{ cursor: 'pointer' }}>
            {i > 0 && <span style={{ color: C.purple }}> | </span>}
            <span
              style={{
                color: i < shown ? C.green : C.dim,
                background: i === shown - 1 ? 'rgba(152,195,121,0.15)' : undefined,
                borderRadius: 4,
                padding: '1px 3px',
              }}
            >
              {s.cmd}
            </span>
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button type="button" className="button button--sm button--secondary" disabled={shown <= 1} onClick={() => setStep(shown - 1)}>
          ← Quitar comando
        </button>
        <button type="button" className="button button--sm button--primary" disabled={shown >= pipe.stages.length} onClick={() => setStep(shown + 1)}>
          Añadir el siguiente →
        </button>
      </div>

      <div style={{ fontSize: 14, marginBottom: 6 }}>
        <strong style={{ fontFamily: FONT }}>{pipe.stages[shown - 1].cmd}</strong>: {pipe.stages[shown - 1].explain}
      </div>
      <div style={{ ...box, whiteSpace: 'pre', overflowX: 'auto', minHeight: 60 }}>
        {out.map((l, i) => (
          <div key={i} style={{ color: shown === 1 ? C.text : C.yellow }}>
            {l || ' '}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
        {out.length} línea{out.length === 1 ? '' : 's'} salen de este paso{shown < pipe.stages.length ? ' y entran por stdin al siguiente' : ''}.
      </div>
    </DemoWrapper>
  );
}
