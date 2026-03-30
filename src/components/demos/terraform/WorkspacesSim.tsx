import React, { useState } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

type WorkspaceName = string;

interface WorkspaceConfig {
  instance_type: string;
  replicas: number;
  monitoring: boolean;
}

const CONFIGS: Record<string, WorkspaceConfig> = {
  dev: { instance_type: "t3.micro", replicas: 1, monitoring: false },
  staging: { instance_type: "t3.small", replicas: 2, monitoring: true },
  prod: { instance_type: "t3.medium", replicas: 3, monitoring: true },
};

const WORKSPACE_COLORS: Record<string, string> = {
  default: "#6b7280",
  dev: "#22c55e",
  staging: "#eab308",
  prod: "#ef4444",
};

function getConfig(workspace: WorkspaceName): WorkspaceConfig {
  if (workspace === "default") return CONFIGS.dev;
  return CONFIGS[workspace] || CONFIGS.dev;
}

function getWorkspaceColor(name: string): string {
  return WORKSPACE_COLORS[name] || "#8b5cf6";
}

function generateInstances(workspace: WorkspaceName) {
  const config = getConfig(workspace);
  const envName = workspace === "default" ? "dev" : workspace;
  return Array.from({ length: config.replicas }, (_, i) => ({
    name: `app-${envName}-${i}`,
    instance_type: config.instance_type,
    monitoring: config.monitoring,
  }));
}

const HCL_CODE = `locals {
  environment = terraform.workspace

  config = {
    dev     = { instance_type = "t3.micro",  replicas = 1, monitoring = false }
    staging = { instance_type = "t3.small",  replicas = 2, monitoring = true  }
    prod    = { instance_type = "t3.medium", replicas = 3, monitoring = true  }
  }
}

resource "aws_instance" "app" {
  count         = local.config[local.environment].replicas
  instance_type = local.config[local.environment].instance_type
  monitoring    = local.config[local.environment].monitoring

  tags = {
    Name        = "app-\${local.environment}-\${count.index}"
    Environment = local.environment
  }
}`;

interface HighlightSpan {
  start: number;
  end: number;
  color: string;
}

function HclHighlighted({ workspace }: { workspace: string }) {
  const config = getConfig(workspace);
  const envName = workspace === "default" ? "dev" : workspace;
  const resolvedColor = "#60a5fa";
  const commentColor = "#6b7280";

  const lines = HCL_CODE.split("\n");

  return (
    <pre
      style={{
        fontFamily: FONT,
        fontSize: "0.78rem",
        lineHeight: 1.6,
        margin: 0,
        padding: "1rem",
        background: "#16181d",
        borderRadius: 0,
        overflowX: "auto",
        color: "#c9d1d9",
      }}
    >
      {lines.map((line, i) => {
        const isResolvedLine =
          line.includes("terraform.workspace") ||
          line.includes("local.config[local.environment]") ||
          (line.includes("local.environment") &&
            !line.includes("config = {") &&
            line.trim() !== "");

        const resolvedAnnotations: Record<string, string> = {
          "terraform.workspace": `"${envName}"`,
          "local.config[local.environment].replicas": `${config.replicas}`,
          "local.config[local.environment].instance_type": `"${config.instance_type}"`,
          "local.config[local.environment].monitoring": `${config.monitoring}`,
        };

        let annotation: string | null = null;

        for (const [pattern, value] of Object.entries(resolvedAnnotations)) {
          if (line.includes(pattern)) {
            annotation = value;
            break;
          }
        }

        if (
          line.includes("${local.environment}") &&
          line.includes("count.index")
        ) {
          annotation = `"app-${envName}-0..${config.replicas - 1}"`;
        } else if (
          line.includes("local.environment") &&
          line.includes("Environment")
        ) {
          annotation = `"${envName}"`;
        }

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              background: isResolvedLine
                ? "rgba(96, 165, 250, 0.06)"
                : "transparent",
              margin: "0 -1rem",
              padding: "0 1rem",
              borderLeft: isResolvedLine
                ? `2px solid ${resolvedColor}`
                : "2px solid transparent",
              minHeight: "1.5em",
            }}
          >
            <span
              style={{
                width: "2.5ch",
                color: "#4b5563",
                userSelect: "none",
                marginRight: "1ch",
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ flex: 1 }}>{renderHclLine(line)}</span>
            {annotation && (
              <span
                style={{
                  color: commentColor,
                  fontSize: "0.72rem",
                  marginLeft: "2ch",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {"// "}
                <span style={{ color: resolvedColor, fontWeight: 600 }}>
                  {annotation}
                </span>
              </span>
            )}
          </div>
        );
      })}
    </pre>
  );
}

function findMatches(regex: RegExp, line: string, color: string, existing: HighlightSpan[]): HighlightSpan[] {
  const result: HighlightSpan[] = [];
  let m: RegExpMatchArray | null;
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = global.exec(line)) !== null) {
    const s = m.index;
    const e = s + m[0].length;
    const overlaps = existing.some((p) => s < p.end && e > p.start);
    if (!overlaps) {
      result.push({ start: s, end: e, color });
    }
  }
  return result;
}

function renderHclLine(line: string): React.ReactNode {
  let parts: HighlightSpan[] = [];

  // Strings (highest priority)
  parts = parts.concat(findMatches(/"[^"]*"/g, line, "#a5d6ff", parts));

  // terraform.workspace / local references (override strings if needed)
  const refRegex = /terraform\.workspace|local\.config\[local\.environment\]\.\w+|local\.environment/g;
  let refMatch: RegExpMatchArray | null;
  const refGlobal = new RegExp(refRegex.source, "g");
  while ((refMatch = refGlobal.exec(line)) !== null) {
    const s = refMatch.index;
    const e = s + refMatch[0].length;
    // Remove overlapping parts for references (they take priority)
    parts = parts.filter((p) => !(p.start >= s && p.end <= e));
    parts.push({ start: s, end: e, color: "#fbbf24" });
  }

  // Booleans
  parts = parts.concat(findMatches(/\b(true|false)\b/g, line, "#ff7b72", parts));

  // Numbers
  parts = parts.concat(findMatches(/\b(\d+)\b/g, line, "#79c0ff", parts));

  // Block keywords
  parts = parts.concat(findMatches(/\b(locals|resource|tags)\b/g, line, "#d2a8ff", parts));

  // Attribute keywords
  parts = parts.concat(
    findMatches(
      /\b(count|instance_type|monitoring|environment|config|Name|Environment)\b/g,
      line,
      "#7ee787",
      parts
    )
  );

  if (parts.length === 0) {
    return <span>{line}</span>;
  }

  parts.sort((a, b) => a.start - b.start);

  const elements: React.ReactNode[] = [];
  let cursor = 0;

  for (const part of parts) {
    if (part.start > cursor) {
      elements.push(
        <span key={`t-${cursor}`}>{line.slice(cursor, part.start)}</span>
      );
    }
    elements.push(
      <span key={`c-${part.start}`} style={{ color: part.color }}>
        {line.slice(part.start, part.end)}
      </span>
    );
    cursor = part.end;
  }

  if (cursor < line.length) {
    elements.push(<span key={`t-${cursor}`}>{line.slice(cursor)}</span>);
  }

  return <>{elements}</>;
}

export default function WorkspacesSim() {
  const [workspaces, setWorkspaces] = useState<WorkspaceName[]>([
    "default",
    "dev",
    "staging",
    "prod",
  ]);
  const [active, setActive] = useState<WorkspaceName>("dev");
  const [appliedStates, setAppliedStates] = useState<
    Record<string, number>
  >({});
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState("");
  const [switchHighlight, setSwitchHighlight] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    "$ terraform workspace list",
    "  default",
    "* dev",
    "  staging",
    "  prod",
  ]);

  const handleSwitch = (ws: WorkspaceName) => {
    if (ws === active) return;
    setActive(ws);
    setSwitchHighlight(true);
    setTimeout(() => setSwitchHighlight(false), 600);

    setTerminalHistory((h) => [
      ...h,
      `$ terraform workspace select ${ws}`,
      `Switched to workspace "${ws}".`,
    ]);
  };

  const handleApply = () => {
    const cfg = getConfig(active);
    setAppliedStates((prev) => ({
      ...prev,
      [active]: cfg.replicas,
    }));
    setTerminalHistory((h) => [
      ...h,
      "$ terraform apply -auto-approve",
      `Apply complete! Resources: ${cfg.replicas} added, 0 changed, 0 destroyed.`,
    ]);
  };

  const handleCreateWorkspace = () => {
    const name = newName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!name || workspaces.includes(name)) {
      setShowNewInput(false);
      setNewName("");
      return;
    }
    setWorkspaces((prev) => [...prev, name]);
    setActive(name);
    setShowNewInput(false);
    setNewName("");
    setSwitchHighlight(true);
    setTimeout(() => setSwitchHighlight(false), 600);
    setTerminalHistory((h) => [
      ...h,
      `$ terraform workspace new ${name}`,
      `Created and switched to workspace "${name}"!`,
    ]);
  };

  const config = getConfig(active);
  const instances = generateInstances(active);
  const envName = active === "default" ? "dev" : active;

  return (
    <DemoWrapper
      title="Simulador de Workspaces"
      description="Observa como los workspaces parametrizan la misma configuracion para distintos entornos"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Terminal Section */}
        <div
          style={{
            background: "#16181d",
            borderRadius: 10,
            border: "1px solid #2a2d37",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0.5rem 1rem",
              background: "#1e2028",
              borderBottom: "1px solid #2a2d37",
              gap: "0.5rem",
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#ef4444",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#eab308",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#22c55e",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontFamily: FONT,
                fontSize: "0.75rem",
                color: "#6b7280",
                marginLeft: "0.5rem",
              }}
            >
              terminal - terraform workspace
            </span>
          </div>

          {/* Terminal output */}
          <div
            style={{
              padding: "0.75rem 1rem",
              maxHeight: 140,
              overflowY: "auto",
              fontFamily: FONT,
              fontSize: "0.75rem",
              lineHeight: 1.5,
            }}
          >
            {terminalHistory.map((line, i) => (
              <div
                key={i}
                style={{
                  color: line.startsWith("$")
                    ? "#22c55e"
                    : line.startsWith("*")
                    ? "#60a5fa"
                    : "#9ca3af",
                  whiteSpace: "pre",
                }}
              >
                {line}
              </div>
            ))}
          </div>

          {/* Workspace buttons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
              padding: "0.75rem 1rem",
              borderTop: "1px solid #2a2d37",
              background: "#1a1c23",
            }}
          >
            <span
              style={{
                fontFamily: FONT,
                fontSize: "0.72rem",
                color: "#6b7280",
                marginRight: "0.25rem",
              }}
            >
              workspace select:
            </span>
            {workspaces.map((ws) => {
              const isActive = ws === active;
              const color = getWorkspaceColor(ws);
              const stateLabel =
                ws in appliedStates
                  ? `${appliedStates[ws]} resources`
                  : "No state";

              return (
                <button
                  key={ws}
                  onClick={() => handleSwitch(ws)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.3rem 0.7rem",
                    fontFamily: FONT,
                    fontSize: "0.72rem",
                    background: isActive ? `${color}18` : "transparent",
                    border: isActive
                      ? `1px solid ${color}`
                      : "1px solid #2a2d37",
                    borderRadius: 6,
                    color: isActive ? color : "#9ca3af",
                    cursor: isActive ? "default" : "pointer",
                    transition: "all 0.2s ease",
                  }}
                  title={stateLabel}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: color,
                      display: "inline-block",
                      opacity: isActive ? 1 : 0.5,
                    }}
                  />
                  {isActive && (
                    <span style={{ fontSize: "0.65rem", marginRight: -2 }}>
                      *
                    </span>
                  )}
                  {ws}
                  <span
                    style={{
                      fontSize: "0.6rem",
                      color: ws in appliedStates ? "#22c55e" : "#4b5563",
                      marginLeft: "0.2rem",
                    }}
                  >
                    ({stateLabel})
                  </span>
                </button>
              );
            })}

            {/* New workspace button/input */}
            {showNewInput ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateWorkspace();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3rem",
                }}
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="nombre..."
                  style={{
                    fontFamily: FONT,
                    fontSize: "0.72rem",
                    padding: "0.25rem 0.5rem",
                    background: "#16181d",
                    border: "1px solid #3b82f6",
                    borderRadius: 4,
                    color: "#e5e7eb",
                    width: 100,
                    outline: "none",
                  }}
                  onBlur={() => {
                    if (!newName.trim()) {
                      setShowNewInput(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowNewInput(false);
                      setNewName("");
                    }
                  }}
                />
                <button
                  type="submit"
                  style={{
                    fontFamily: FONT,
                    fontSize: "0.68rem",
                    padding: "0.25rem 0.5rem",
                    background: "#3b82f6",
                    border: "none",
                    borderRadius: 4,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  crear
                </button>
              </form>
            ) : (
              <button
                onClick={() => setShowNewInput(true)}
                style={{
                  fontFamily: FONT,
                  fontSize: "0.72rem",
                  padding: "0.3rem 0.7rem",
                  background: "transparent",
                  border: "1px dashed #4b5563",
                  borderRadius: 6,
                  color: "#6b7280",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                + workspace new
              </button>
            )}
          </div>
        </div>

        {/* Two column layout: HCL + Resolved */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
          }}
        >
          {/* HCL Configuration Panel */}
          <div
            style={{
              background: "#1e2028",
              borderRadius: 10,
              border: "1px solid #2a2d37",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.5rem 1rem",
                borderBottom: "1px solid #2a2d37",
                background: "#16181d",
              }}
            >
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: "0.72rem",
                  color: "#9ca3af",
                }}
              >
                main.tf
              </span>
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: "0.65rem",
                  color: "#4b5563",
                  background: "#2a2d37",
                  padding: "0.15rem 0.5rem",
                  borderRadius: 4,
                }}
              >
                solo lectura
              </span>
            </div>
            <HclHighlighted workspace={active} />
          </div>

          {/* Resolved Infrastructure Panel */}
          <div
            style={{
              background: "#1e2028",
              borderRadius: 10,
              border: "1px solid #2a2d37",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.5rem 1rem",
                borderBottom: "1px solid #2a2d37",
                background: "#16181d",
              }}
            >
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: "0.72rem",
                  color: "#9ca3af",
                }}
              >
                Infraestructura resuelta
              </span>
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: "0.65rem",
                  color: getWorkspaceColor(active),
                  background: `${getWorkspaceColor(active)}15`,
                  padding: "0.15rem 0.5rem",
                  borderRadius: 4,
                  border: `1px solid ${getWorkspaceColor(active)}40`,
                }}
              >
                {active}
              </span>
            </div>

            <div
              style={{
                padding: "1rem",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {/* Config summary */}
              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  fontFamily: FONT,
                  fontSize: "0.7rem",
                  color: "#6b7280",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  replicas:{" "}
                  <span style={{ color: "#60a5fa" }}>{config.replicas}</span>
                </span>
                <span>
                  type:{" "}
                  <span style={{ color: "#60a5fa" }}>
                    {config.instance_type}
                  </span>
                </span>
                <span>
                  monitoring:{" "}
                  <span
                    style={{
                      color: config.monitoring ? "#22c55e" : "#ef4444",
                    }}
                  >
                    {config.monitoring ? "on" : "off"}
                  </span>
                </span>
              </div>

              {active === "default" && (
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: "0.65rem",
                    color: "#eab308",
                    background: "#eab30810",
                    border: "1px solid #eab30830",
                    borderRadius: 6,
                    padding: "0.4rem 0.6rem",
                  }}
                >
                  Nota: el workspace "default" usa la config de "dev"
                </div>
              )}

              {/* Instance cards */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {instances.map((inst, i) => (
                  <div
                    key={`${active}-${i}`}
                    style={{
                      background: "#16181d",
                      border: `1px solid ${
                        switchHighlight ? "#3b82f680" : "#2a2d37"
                      }`,
                      borderRadius: 8,
                      padding: "0.6rem 0.8rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      transition: "all 0.4s ease",
                      boxShadow: switchHighlight
                        ? "0 0 12px rgba(59, 130, 246, 0.15)"
                        : "none",
                    }}
                  >
                    {/* Instance icon */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: `${getWorkspaceColor(active)}18`,
                        border: `1px solid ${getWorkspaceColor(active)}40`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: FONT,
                        fontSize: "0.65rem",
                        color: getWorkspaceColor(active),
                        flexShrink: 0,
                      }}
                    >
                      EC2
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.15rem",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: FONT,
                          fontSize: "0.72rem",
                          color: "#e5e7eb",
                          fontWeight: 600,
                        }}
                      >
                        {inst.name}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          gap: "0.75rem",
                          fontFamily: FONT,
                          fontSize: "0.62rem",
                          color: "#6b7280",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>{inst.instance_type}</span>
                        <span
                          style={{
                            color: inst.monitoring ? "#22c55e" : "#ef4444",
                          }}
                        >
                          monitoring: {inst.monitoring ? "on" : "off"}
                        </span>
                        <span style={{ color: "#4b5563" }}>env: {envName}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Apply button and state */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: "auto",
                  paddingTop: "0.5rem",
                  borderTop: "1px solid #2a2d37",
                }}
              >
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: "0.65rem",
                    color: "#4b5563",
                  }}
                >
                  {active in appliedStates ? (
                    <span style={{ color: "#22c55e" }}>
                      State: {appliedStates[active]} resource
                      {appliedStates[active] !== 1 ? "s" : ""} en
                      terraform.tfstate.d/{active}
                    </span>
                  ) : (
                    <span>State: vacio (no aplicado)</span>
                  )}
                </div>
                <button
                  onClick={handleApply}
                  style={{
                    fontFamily: FONT,
                    fontSize: "0.7rem",
                    padding: "0.35rem 0.8rem",
                    background:
                      active === "prod"
                        ? "linear-gradient(135deg, #ef4444, #dc2626)"
                        : "linear-gradient(135deg, #3b82f6, #2563eb)",
                    border: "none",
                    borderRadius: 6,
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                    transition: "all 0.2s ease",
                  }}
                >
                  terraform apply
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DemoWrapper>
  );
}
