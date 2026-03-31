import React, { useState } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

interface SegmentExplanation {
  title: string;
  subtitle: string;
  body: string;
  format?: string;
  items?: { code: string; desc: string }[];
  examples?: { code: string; desc: string }[];
  note?: string;
}

interface Segment {
  id: string;
  label: string;
  color: string;
  icon: string;
  lines: number[];
  explanation: SegmentExplanation;
}

const SEGMENTS: Segment[] = [
  {
    id: "name",
    label: "Nombre",
    color: "#c678dd",
    icon: "⬡",
    lines: [0],
    explanation: {
      title: "Nombre del Workflow",
      subtitle: "name: CI Pipeline",
      body: "Nombre descriptivo que aparece en la pestaña Actions de GitHub. Es opcional pero muy recomendable.",
      items: [
        { code: "name:", desc: "Clave de nivel superior que identifica el workflow" },
        { code: "CI Pipeline", desc: "Texto libre — aparece en la UI y en los checks de PRs" },
      ],
      note: "Si omites el name, GitHub usa el nombre del fichero YAML como identificador.",
    },
  },
  {
    id: "on",
    label: "Eventos (on)",
    color: "#e5c07b",
    icon: "◈",
    lines: [1, 2, 3, 4, 5],
    explanation: {
      title: "Eventos / Triggers",
      subtitle: "on: push | pull_request",
      body: "Define cuándo se ejecuta el workflow. Puede ser un evento simple, una lista o un mapa con filtros.",
      examples: [
        { code: "push", desc: "Al hacer push de commits o tags" },
        { code: "pull_request", desc: "Al abrir, sincronizar o cerrar una PR" },
        { code: "workflow_dispatch", desc: "Ejecución manual desde la UI" },
        { code: "schedule", desc: "Cron programado (ej: tests nocturnos)" },
        { code: "repository_dispatch", desc: "Webhook externo vía API" },
      ],
      note: "branches: [main] filtra para que solo se ejecute en esa rama. También puedes filtrar por paths, tags, etc.",
    },
  },
  {
    id: "jobs",
    label: "Jobs",
    color: "#61afef",
    icon: "◇",
    lines: [6, 7],
    explanation: {
      title: "Jobs",
      subtitle: "jobs: → build:",
      body: "Mapa de unidades de ejecución. Cada job corre en su propio runner (máquina virtual). Por defecto se ejecutan en paralelo.",
      items: [
        { code: "jobs:", desc: "Clave que contiene todos los jobs del workflow" },
        { code: "build:", desc: "ID del job — nombre interno para referencias y dependencias" },
      ],
      examples: [
        { code: "needs: [build]", desc: "Crea dependencia secuencial entre jobs" },
        { code: "if: success()", desc: "Ejecución condicional basada en estado" },
      ],
      note: "Puedes tener múltiples jobs (build, test, deploy) y controlar el orden con 'needs'.",
    },
  },
  {
    id: "job_config",
    label: "Config del job",
    color: "#98c379",
    icon: "●",
    lines: [8, 9],
    explanation: {
      title: "Configuración del Job",
      subtitle: "name: / runs-on:",
      body: "Propiedades que configuran cómo y dónde se ejecuta el job.",
      items: [
        { code: "name:", desc: "Nombre descriptivo visible en la UI de GitHub Actions" },
        { code: "runs-on:", desc: "Sistema operativo del runner que ejecuta el job" },
      ],
      examples: [
        { code: "ubuntu-latest", desc: "Linux Ubuntu (el más común y barato)" },
        { code: "windows-latest", desc: "Windows Server" },
        { code: "macos-latest", desc: "macOS (más caro, para builds iOS/Mac)" },
        { code: "self-hosted", desc: "Tu propio runner (on-premise o cloud)" },
      ],
      note: "Los runners hosted de GitHub se destruyen después de cada job — cada ejecución empieza limpia.",
    },
  },
  {
    id: "steps",
    label: "Steps",
    color: "#e06c75",
    icon: "◆",
    lines: [10],
    explanation: {
      title: "Steps (Pasos)",
      subtitle: "steps:",
      body: "Lista ordenada de pasos que se ejecutan secuencialmente dentro del mismo runner. Cada step puede ser una Action o un comando shell.",
      items: [
        { code: "uses:", desc: "Ejecuta una Action reutilizable (de marketplace o propia)" },
        { code: "run:", desc: "Ejecuta un comando de shell directamente" },
        { code: "with:", desc: "Parámetros de entrada para una Action" },
        { code: "name:", desc: "Nombre descriptivo del step (aparece en logs)" },
        { code: "env:", desc: "Variables de entorno para el step" },
      ],
      note: "Todos los steps de un job comparten el mismo filesystem y workspace.",
    },
  },
  {
    id: "action_checkout",
    label: "Action (uses)",
    color: "#56b6c2",
    icon: "▣",
    lines: [11],
    explanation: {
      title: "Action Reutilizable",
      subtitle: "uses: actions/checkout@v5",
      body: "Referencia a una Action del marketplace o de un repositorio. Formato: owner/repo@version.",
      items: [
        { code: "actions/checkout", desc: "Clona el repositorio en el runner" },
        { code: "@v5", desc: "Versión fijada — nunca uses @main en producción" },
      ],
      examples: [
        { code: "actions/checkout@v5", desc: "Clonar el repo" },
        { code: "actions/setup-node@v4", desc: "Configurar Node.js" },
        { code: "actions/cache@v4", desc: "Caché de dependencias" },
        { code: "actions/upload-artifact@v4", desc: "Subir artefactos" },
      ],
      note: "Las Actions encapsulan lógica compleja en un step reutilizable. Piensa en ellas como funciones.",
    },
  },
  {
    id: "action_with",
    label: "Parámetros (with)",
    color: "#d19a66",
    icon: "▪",
    lines: [12, 13, 14, 15],
    explanation: {
      title: "Parámetros de Action",
      subtitle: "with: node-version / cache",
      body: "La clave 'with' pasa parámetros de entrada a una Action. Es el equivalente a los argumentos de una función.",
      items: [
        { code: "node-version: 20", desc: "Versión de Node.js a instalar" },
        { code: "cache: npm", desc: "Activa caché automática de dependencias npm" },
      ],
      examples: [
        { code: "node-version: 20", desc: "Versión exacta" },
        { code: "node-version: '>=18'", desc: "Rango de versiones" },
        { code: "registry-url:", desc: "Registry npm privado" },
      ],
      note: "Cada Action define sus propios inputs. Consulta la documentación de la Action para ver las opciones disponibles.",
    },
  },
  {
    id: "run_commands",
    label: "Comandos (run)",
    color: "#e8e8e8",
    icon: "▶",
    lines: [16, 17],
    explanation: {
      title: "Comandos Shell",
      subtitle: "run: npm ci / npm test",
      body: "Ejecuta comandos directamente en el shell del runner. Por defecto usa bash en Linux/macOS y pwsh en Windows.",
      items: [
        { code: "npm ci", desc: "Instala dependencias de forma reproducible (respeta package-lock)" },
        { code: "npm test", desc: "Ejecuta los tests definidos en package.json" },
      ],
      examples: [
        { code: "run: |", desc: "Multi-línea: ejecuta varios comandos seguidos" },
        { code: "shell: pwsh", desc: "Cambiar el shell (powershell, python, etc.)" },
        { code: "working-directory:", desc: "Ejecutar desde un directorio específico" },
      ],
      note: "Cada 'run' crea un nuevo proceso shell. Variables de entorno persisten con $GITHUB_ENV, no con export.",
    },
  },
];

const CODE_LINES = [
  "name: CI Pipeline",
  "on:",
  "  push:",
  "    branches: [main]",
  "  pull_request:",
  "    branches: [main]",
  "jobs:",
  "  build:",
  '    name: Build and Test',
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v5",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 20",
  "          cache: npm",
  "      - run: npm ci",
  "      - run: npm test",
];

function getSegmentsForLine(lineIdx: number) {
  return SEGMENTS.filter((s) => s.lines.includes(lineIdx)).map((s) => s.id);
}

function colorize(text: string) {
  if (!text.trim()) return <>{" "}</>;

  const keywords = [
    { match: /^(name|on|jobs|steps|runs-on|uses|with|run|push|pull_request|branches|node-version|cache):/, color: "#e06c75" },
    { match: /"[^"]*"/, color: "#98c379" },
    { match: /\b(true|false)\b/, color: "#d19a66" },
    { match: /\b\d+\b/, color: "#d19a66" },
    { match: /\[.*?\]/, color: "#61afef" },
    { match: /actions\/[a-zA-Z-]+@v\d+/, color: "#56b6c2" },
    { match: /npm\s+\S+/, color: "#c678dd" },
  ];

  let idx = 0;
  const tokens: { text: string; color: string | null }[] = [];

  while (idx < text.length) {
    let matched = false;
    const sub = text.slice(idx);

    for (const kw of keywords) {
      const m = sub.match(kw.match);
      if (m && m.index === 0) {
        tokens.push({ text: m[0], color: kw.color });
        idx += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (tokens.length > 0 && tokens[tokens.length - 1].color === null) {
        tokens[tokens.length - 1].text += text[idx];
      } else {
        tokens.push({ text: text[idx], color: null });
      }
      idx++;
    }
  }

  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} style={t.color ? { color: t.color } : undefined}>
          {t.text}
        </span>
      ))}
    </>
  );
}

function CodeLine({
  lineIdx,
  text,
  activeSegment,
  onHover,
  onClick,
}: {
  lineIdx: number;
  text: string;
  activeSegment: string | null;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const segments = getSegmentsForLine(lineIdx);
  const isActive = segments.includes(activeSegment || "");
  const seg = isActive ? SEGMENTS.find((s) => s.id === activeSegment) : null;
  const hasSegment = segments.length > 0;

  return (
    <div
      onClick={() => {
        if (segments.length > 0) onClick(segments[0]);
      }}
      onMouseEnter={() => {
        if (segments.length > 0) onHover(segments[0]);
      }}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "1px 0",
        cursor: hasSegment ? "pointer" : "default",
        borderRadius: 4,
        background: isActive && seg ? `${seg.color}12` : "transparent",
        borderLeft: isActive && seg ? `3px solid ${seg.color}` : "3px solid transparent",
        transition: "all 0.2s ease",
      }}
    >
      <span
        style={{
          width: 28,
          textAlign: "right",
          paddingRight: 10,
          fontSize: 11,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          color: isActive && seg ? seg.color : "#555",
          userSelect: "none",
          transition: "color 0.2s",
        }}
      >
        {lineIdx + 1}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 13.5,
          letterSpacing: 0.3,
          color: isActive && seg ? seg.color : hasSegment ? "#abb2bf" : "#636a76",
          transition: "color 0.2s",
          whiteSpace: "pre",
        }}
      >
        {colorize(text)}
      </span>
    </div>
  );
}

function ExplanationPanel({ segment }: { segment: Segment }) {
  const exp = segment.explanation;

  return (
    <div
      style={{
        background: "#1e2028",
        borderRadius: 12,
        border: `1px solid ${segment.color}30`,
        padding: "20px 24px",
        animation: "ghaPanelIn 0.3s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 18, color: segment.color }}>{segment.icon}</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: segment.color,
            fontWeight: 600,
          }}
        >
          {exp.title}
        </span>
      </div>

      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 15,
          color: "#e8e8e8",
          marginBottom: 12,
          padding: "6px 10px",
          background: `${segment.color}15`,
          borderRadius: 6,
          display: "inline-block",
        }}
      >
        {exp.subtitle}
      </div>

      <p style={{ color: "#9da5b4", fontSize: 13.5, lineHeight: 1.6, margin: "8px 0 12px" }}>
        {exp.body}
      </p>

      {exp.format && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "#e5c07b",
            background: "#2a2d37",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 12,
            letterSpacing: 0.5,
          }}
        >
          {exp.format}
        </div>
      )}

      {exp.items && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {exp.items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "6px 10px",
                background: "#252830",
                borderRadius: 6,
              }}
            >
              <code
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: segment.color,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {item.code}
              </code>
              <span style={{ color: "#7e8590", fontSize: 12.5 }}>{item.desc}</span>
            </div>
          ))}
        </div>
      )}

      {exp.examples && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {exp.examples.map((ex, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 10px",
                background: "#252830",
                borderRadius: 6,
              }}
            >
              <code
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: segment.color,
                  whiteSpace: "nowrap",
                }}
              >
                {ex.code}
              </code>
              <span style={{ color: "#7e8590", fontSize: 12.5 }}>{ex.desc}</span>
            </div>
          ))}
        </div>
      )}

      {exp.note && (
        <div
          style={{
            fontSize: 12.5,
            color: "#7e8590",
            borderTop: "1px solid #2f3340",
            paddingTop: 10,
            marginTop: 6,
            lineHeight: 1.5,
            fontStyle: "italic",
          }}
        >
          {exp.note}
        </div>
      )}
    </div>
  );
}

function Legend({
  segments,
  activeSegment,
  onClick,
}: {
  segments: Segment[];
  activeSegment: string | null;
  onClick: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {segments.map((seg) => {
        const isActive = activeSegment === seg.id;
        return (
          <button
            key={seg.id}
            onClick={() => onClick(seg.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 20,
              border: `1.5px solid ${isActive ? seg.color : seg.color + "40"}`,
              background: isActive ? `${seg.color}20` : "transparent",
              color: isActive ? seg.color : "#7e8590",
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
              transition: "all 0.2s ease",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <span style={{ fontSize: 10 }}>{seg.icon}</span>
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

export default function GHActionsAnatomy() {
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const current = active || hovered;
  const activeSeg = current ? SEGMENTS.find((s) => s.id === current) || null : null;

  return (
    <DemoWrapper
      title="Anatom&iacute;a de un Workflow"
      description="Haz clic en cualquier parte del c&oacute;digo para explorar su significado"
    >
      <style>{`
        @keyframes ghaPanelIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ghaPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Legend
          segments={SEGMENTS}
          activeSegment={current}
          onClick={(id) => setActive((prev) => (prev === id ? null : id))}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: activeSeg ? "45fr 55fr" : "1fr",
            gap: 16,
            transition: "all 0.3s ease",
          }}
        >
          <div
            style={{
              background: "#1e2028",
              borderRadius: 12,
              border: "1px solid #2a2d37",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 16px",
                borderBottom: "1px solid #2a2d37",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e06c75" }} />
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e5c07b" }} />
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#98c379" }} />
              </div>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  color: "#636a76",
                  marginLeft: 8,
                }}
              >
                .github/workflows/ci.yml
              </span>
            </div>

            <div style={{ padding: "12px 14px" }}>
              {CODE_LINES.map((line, i) => (
                <CodeLine
                  key={i}
                  lineIdx={i}
                  text={line}
                  activeSegment={current}
                  onHover={setHovered}
                  onClick={(id) => setActive((prev) => (prev === id ? null : id))}
                />
              ))}
            </div>
          </div>

          {activeSeg ? (
            <ExplanationPanel segment={activeSeg} />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 32,
                background: "#1e2028",
                borderRadius: 12,
                border: "1px dashed #2a2d37",
                textAlign: "center",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 32, animation: "ghaPulse 2s ease-in-out infinite" }}>
                {"👆"}
              </div>
              <p style={{ color: "#636a76", fontSize: 13.5, lineHeight: 1.5 }}>
                Selecciona cualquier parte del c&oacute;digo
                <br />
                para ver su explicaci&oacute;n detallada
              </p>
            </div>
          )}
        </div>
      </div>
    </DemoWrapper>
  );
}
