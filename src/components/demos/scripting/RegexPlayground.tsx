import React, { useMemo, useState } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';
import { C, Chip, FONT, box, input, label } from './ui';

const SAMPLE = `192.168.1.10 - - [12/Mar/2026:10:01:02 +0100] "GET /index.html HTTP/1.1" 200 5123
10.0.0.7 - - [12/Mar/2026:10:01:05 +0100] "POST /api/login HTTP/1.1" 401 312
192.168.1.10 - - [12/Mar/2026:10:02:11 +0100] "GET /api/users HTTP/1.1" 500 87
172.16.4.2 - - [12/Mar/2026:10:03:40 +0100] "GET /health HTTP/1.1" 200 2
10.0.0.7 - - [12/Mar/2026:10:04:12 +0100] "GET /api/orders HTTP/1.1" 503 91
2026-03-12 10:05:00 ERROR payment-service: timeout after 30s
2026-03-12 10:05:02 WARN  payment-service: retrying (1/3)
2026-03-12 10:05:09 INFO  payment-service: OK
contacto: soporte@ejemplo.com, ventas@ejemplo.es`;

const PRESETS: { name: string; pattern: string; hint: string }[] = [
  { name: 'Direcciones IP', pattern: '^([0-9]{1,3}\\.){3}[0-9]{1,3}', hint: 'grupo repetido 3 veces con {3}' },
  { name: 'Errores 5xx', pattern: '" 5[0-9]{2} ', hint: 'código HTTP de 500 a 599' },
  { name: 'ERROR o WARN', pattern: '(ERROR|WARN)', hint: 'alternativa con |' },
  { name: 'Fechas ISO', pattern: '[0-9]{4}-[0-9]{2}-[0-9]{2}', hint: 'AAAA-MM-DD' },
  { name: 'Emails', pattern: '[[:alnum:]._-]+@[[:alnum:].-]+\\.[a-z]{2,}', hint: 'clases POSIX como en grep' },
  { name: 'Rutas de la API', pattern: '/api/[a-z]+', hint: 'literal + clase de caracteres' },
];

// grep -E understands POSIX classes; JavaScript does not, so translate the common ones.
const POSIX: Record<string, string> = {
  '[:alnum:]': 'A-Za-z0-9',
  '[:alpha:]': 'A-Za-z',
  '[:digit:]': '0-9',
  '[:space:]': '\\s',
  '[:upper:]': 'A-Z',
  '[:lower:]': 'a-z',
  '[:punct:]': '!-\\/:-@\\[-`{-~',
};
function toJs(pattern: string): string {
  return pattern.replace(/\[:(alnum|alpha|digit|space|upper|lower|punct):\]/g, (m) => POSIX[m]);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export default function RegexPlayground() {
  const [pattern, setPattern] = useState(PRESETS[0].pattern);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [onlyMatching, setOnlyMatching] = useState(false);
  const [text, setText] = useState(SAMPLE);

  const result = useMemo(() => {
    if (!pattern) return { error: '', lines: [] as { line: string; parts: { t: string; m: boolean }[]; hit: boolean }[] };
    let re: RegExp;
    try {
      re = new RegExp(toJs(pattern), ignoreCase ? 'gi' : 'g');
    } catch (e) {
      return { error: (e as Error).message, lines: [] };
    }
    const lines = text.split('\n').map((line) => {
      const parts: { t: string; m: boolean }[] = [];
      let last = 0;
      let hit = false;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        hit = true;
        if (m.index > last) parts.push({ t: line.slice(last, m.index), m: false });
        parts.push({ t: m[0], m: true });
        last = m.index + m[0].length;
      }
      if (last < line.length) parts.push({ t: line.slice(last), m: false });
      return { line, parts, hit };
    });
    return { error: '', lines };
  }, [pattern, ignoreCase, text]);

  const hits = result.lines.filter((l) => l.hit);
  const cmd = `grep -E${ignoreCase ? 'i' : ''}${onlyMatching ? 'o' : ''} ${shellQuote(pattern)} access.log`;

  return (
    <DemoWrapper title="Regex Playground" description="Escribe una expresión regular extendida (como grep -E) y mira qué líneas coinciden">
      <div style={{ marginBottom: 10 }}>
        {PRESETS.map((p) => (
          <Chip key={p.name} active={p.pattern === pattern} onClick={() => setPattern(p.pattern)}>
            {p.name}
          </Chip>
        ))}
      </div>

      <label style={label}>Patrón</label>
      <input style={{ ...input, color: result.error ? C.red : C.yellow }} value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} />
      {PRESETS.find((p) => p.pattern === pattern) && (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Pista: {PRESETS.find((p) => p.pattern === pattern)!.hint}</div>
      )}

      <div style={{ display: 'flex', gap: 16, margin: '10px 0', fontSize: 13, flexWrap: 'wrap' }}>
        <label style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} /> -i (ignorar mayúsculas)
        </label>
        <label style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyMatching} onChange={(e) => setOnlyMatching(e.target.checked)} /> -o (solo lo que coincide)
        </label>
      </div>

      <div style={{ ...box, marginBottom: 10 }}>
        <span style={{ color: C.dim }}>$ </span>
        <span style={{ color: C.green }}>{cmd}</span>
      </div>

      {result.error ? (
        <div style={{ ...box, color: C.red }}>Expresión no válida: {result.error}</div>
      ) : (
        <div style={{ ...box, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre' }}>
          {onlyMatching
            ? hits.flatMap((l, i) =>
                l.parts
                  .filter((p) => p.m)
                  .map((p, j) => (
                    <div key={`${i}-${j}`} style={{ color: C.yellow }}>
                      {p.t}
                    </div>
                  )),
              )
            : result.lines.map((l, i) => (
                <div key={i} style={{ opacity: l.hit ? 1 : 0.35 }}>
                  {l.parts.length === 0 ? ' ' : l.parts.map((p, j) => (
                    <span key={j} style={p.m ? { background: 'rgba(229,192,123,0.25)', color: C.yellow, borderRadius: 3 } : undefined}>
                      {p.t}
                    </span>
                  ))}
                </div>
              ))}
        </div>
      )}
      <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
        {result.error ? '' : `${hits.length} de ${result.lines.length} líneas coinciden (grep -c devolvería ${hits.length}; exit code ${hits.length ? 0 : 1}).`}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>Editar el texto de prueba</summary>
        <textarea
          style={{ ...input, height: 180, marginTop: 8, fontFamily: FONT }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </details>

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10, marginBottom: 0 }}>
        El navegador usa el motor de JavaScript. Para ERE (grep -E) coincide en lo básico: clases, cuantificadores, grupos y alternativas; las
        clases POSIX como <code>[[:alnum:]]</code> se traducen aquí. Atajos como <code>\d</code> funcionan en el navegador pero no en grep -E:
        usa <code>[0-9]</code>.
      </p>
    </DemoWrapper>
  );
}
