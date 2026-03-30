import React, { useState } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

const HCL_SEGMENTS = [
  {
    id: "block_type",
    label: "Tipo de bloque",
    color: "#c678dd",
    icon: "⬡",
    lines: [0],
    ranges: [[0, 8]],
    explanation: {
      title: "Tipo de Bloque",
      subtitle: "resource",
      body: "Define qué tipo de construcción HCL estamos declarando. Los tipos principales son:",
      items: [
        { code: "resource", desc: "Crea y gestiona un recurso de infraestructura" },
        { code: "data", desc: "Consulta un recurso existente (solo lectura)" },
        { code: "variable", desc: "Declara una variable de entrada" },
        { code: "output", desc: "Exporta un valor para otros módulos" },
        { code: "provider", desc: "Configura un proveedor de infraestructura" },
        { code: "locals", desc: "Define valores locales reutilizables" },
      ],
    },
  },
  {
    id: "resource_type",
    label: "Tipo de recurso",
    color: "#e5c07b",
    icon: "◈",
    lines: [0],
    ranges: [[10, 24]],
    explanation: {
      title: "Tipo de Recurso",
      subtitle: '"aws_instance"',
      body: "Identifica el recurso concreto del provider. Siempre sigue el formato:",
      format: "<provider>_<recurso>",
      examples: [
        { code: "aws_instance", desc: "Instancia EC2 en AWS" },
        { code: "aws_s3_bucket", desc: "Bucket S3 en AWS" },
        { code: "azurerm_virtual_network", desc: "VNet en Azure" },
        { code: "google_compute_instance", desc: "VM en GCP" },
      ],
      note: "El prefijo indica qué provider gestiona este recurso. Terraform lo usa para saber qué API llamar.",
    },
  },
  {
    id: "resource_name",
    label: "Nombre local",
    color: "#61afef",
    icon: "◇",
    lines: [0],
    ranges: [[26, 35]],
    explanation: {
      title: "Nombre Local",
      subtitle: '"web_server"',
      body: "Identificador interno dentro de tu configuración Terraform. Se usa para:",
      items: [
        { code: "Referenciar", desc: "Acceder a atributos: aws_instance.web_server.id" },
        { code: "Identificar", desc: "Terraform lo usa en el state para trackear el recurso" },
        { code: "Documentar", desc: "Indica la intención: web_server, database, cache..." },
      ],
      note: "No confundir con el nombre real del recurso en la nube. Es solo un nombre en tu código HCL.",
    },
  },
  {
    id: "argument_basic",
    label: "Argumento básico",
    color: "#98c379",
    icon: "●",
    lines: [1],
    ranges: [[2, 30]],
    explanation: {
      title: "Argumento (Atributo)",
      subtitle: 'ami = "ami-0c55b..."',
      body: "Configura una propiedad del recurso. Sintaxis: nombre = valor. Los tipos de valor incluyen:",
      items: [
        { code: "string", desc: '"ami-0c55..." — texto entre comillas dobles' },
        { code: "number", desc: "8, 3.14 — números sin comillas" },
        { code: "bool", desc: "true / false — booleanos sin comillas" },
        { code: "list", desc: '["a", "b"] — colección ordenada' },
        { code: "map", desc: "clave = valor — pares clave-valor" },
      ],
      note: "Cada recurso tiene argumentos obligatorios y opcionales. Consulta la documentación del provider.",
    },
  },
  {
    id: "reference",
    label: "Referencia",
    color: "#e06c75",
    icon: "◆",
    lines: [2],
    ranges: [[22, 60]],
    explanation: {
      title: "Referencia a Variable",
      subtitle: "var.instance_type",
      body: "En lugar de un valor fijo, referenciamos una variable de entrada. Tipos de referencia en HCL:",
      items: [
        { code: "var.nombre", desc: "Variable de entrada (input variable)" },
        { code: "local.nombre", desc: "Valor local definido en locals" },
        { code: "recurso.nombre.attr", desc: "Atributo de otro recurso (dependencia implícita)" },
        { code: "data.tipo.nombre.attr", desc: "Atributo de un data source" },
        { code: "module.nombre.output", desc: "Output de un módulo hijo" },
      ],
      note: "Las referencias crean dependencias implícitas — Terraform calcula el orden automáticamente.",
    },
  },
  {
    id: "nested_block",
    label: "Bloque anidado",
    color: "#56b6c2",
    icon: "▣",
    lines: [5, 6, 7, 8, 9],
    ranges: [
      [2, 18],
      [4, 36],
      [4, 22],
      [4, 45],
      [2, 3],
    ],
    explanation: {
      title: "Bloque Anidado",
      subtitle: "root_block_device { ... }",
      body: "Algunos argumentos se agrupan en sub-bloques con su propia estructura. Ejemplos comunes:",
      items: [
        { code: "root_block_device", desc: "Configuración de disco en EC2" },
        { code: "ingress / egress", desc: "Reglas de firewall en security groups" },
        { code: "lifecycle", desc: "Reglas de ciclo de vida del recurso" },
        { code: "provisioner", desc: "Acciones post-creación (usar con cautela)" },
      ],
      note: "Cuando un bloque se repite muchas veces, se puede refactorizar con 'dynamic blocks' (UD5).",
    },
  },
  {
    id: "tags",
    label: "Tags (map)",
    color: "#d19a66",
    icon: "▪",
    lines: [11, 12, 13, 14],
    ranges: [
      [2, 8],
      [4, 28],
      [4, 37],
      [2, 3],
    ],
    explanation: {
      title: "Tags (tipo map)",
      subtitle: "tags = clave-valor",
      body: "Los tags son metadatos clave-valor que se aplican al recurso en la nube. Son de tipo map(string).",
      items: [
        { code: "Name", desc: "Nombre visible en la consola del cloud provider" },
        { code: "Environment", desc: "Identificar entorno: dev, staging, prod" },
        { code: "Project", desc: "Agrupar recursos por proyecto" },
        { code: "Owner / Team", desc: "Responsable del recurso" },
      ],
      note: "Los tags son esenciales para organización, billing y governance. Muchas empresas los hacen obligatorios.",
    },
  },
];

const CODE_LINES = [
  'resource "aws_instance" "web_server" {',
  '  ami           = "ami-0c55b159cbfafe1f0"',
  "  instance_type = var.instance_type",
  "",
  "  subnet_id     = aws_subnet.main.id",
  "  root_block_device {",
  "    volume_size = 20",
  '    volume_type = "gp3"',
  "    encrypted   = true",
  "  }",
  "",
  "  tags = {",
  '    Name        = "web-$\\{var.environment}"',
  "    Environment = var.environment",
  "  }",
  "}",
];

function getSegmentsForLine(lineIdx: number) {
  return HCL_SEGMENTS.filter((s) => s.lines.includes(lineIdx)).map((s) => s.id);
}

interface Segment {
  id: string;
  label: string;
  color: string;
  icon: string;
  lines: number[];
  ranges: number[][];
  explanation: {
    title: string;
    subtitle: string;
    body: string;
    format?: string;
    items?: { code: string; desc: string }[];
    examples?: { code: string; desc: string }[];
    note?: string;
  };
}

function colorize(text: string) {
  if (!text.trim()) return <>{" "}</>;

  const keywords = [
    { match: /^(resource|data|variable|output|provider|locals)\b/, color: "#c678dd" },
    { match: /"[^"]*"/, color: "#98c379" },
    { match: /\b(true|false)\b/, color: "#d19a66" },
    { match: /\b(var|local|module|data)\.[a-zA-Z_.[\]0-9]+/, color: "#e06c75" },
    { match: /\b(aws_[a-z_]+)\.[a-zA-Z_.]+/, color: "#e06c75" },
    { match: /\b\d+\b/, color: "#d19a66" },
    { match: /\$\\\{[^}]+\}/, color: "#e06c75" },
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
  const seg = isActive ? HCL_SEGMENTS.find((s) => s.id === activeSegment) : null;
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
        position: "relative",
      }}
    >
      <span
        style={{
          width: 32,
          textAlign: "right",
          paddingRight: 12,
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
        animation: "hclPanelIn 0.3s ease",
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

export default function HCLAnatomy() {
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const current = active || hovered;
  const activeSeg = current ? HCL_SEGMENTS.find((s) => s.id === current) || null : null;

  return (
    <DemoWrapper
      title="Anatomía de un Bloque HCL"
      description="Haz clic en cualquier parte del código para explorar su significado"
    >
      <style>{`
        @keyframes hclPanelIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hclPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Legend
          segments={HCL_SEGMENTS}
          activeSegment={current}
          onClick={(id) => setActive((prev) => (prev === id ? null : id))}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: activeSeg ? "1fr 1fr" : "1fr",
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
                main.tf
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
              <div style={{ fontSize: 32, animation: "hclPulse 2s ease-in-out infinite" }}>
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
