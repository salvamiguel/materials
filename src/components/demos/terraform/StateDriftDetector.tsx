import React, { useState, useEffect, useRef } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

interface Resource {
  instance_type: string;
  ami: string;
  tags: Record<string, string>;
  monitoring: boolean;
  root_volume_size: number;
}

const DESIRED_STATE: Resource = {
  instance_type: "t3.micro",
  ami: "ami-0c55b159cbfafe1f0",
  tags: { Name: "web-prod", Environment: "prod", ManagedBy: "terraform" },
  monitoring: true,
  root_volume_size: 20,
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function diffResources(desired: Resource, actual: Resource) {
  const changes: { key: string; from: string; to: string; action: "update" | "add" | "remove" }[] = [];

  const allKeys = new Set([
    ...Object.keys(desired),
    ...Object.keys(actual),
  ]) as Set<keyof Resource>;

  for (const key of allKeys) {
    if (key === "tags") {
      const dTags = desired.tags;
      const aTags = actual.tags;
      const allTagKeys = new Set([...Object.keys(dTags), ...Object.keys(aTags)]);
      for (const tk of allTagKeys) {
        if (!(tk in aTags)) {
          changes.push({ key: `tags.${tk}`, from: `"${dTags[tk]}"`, to: "(removed)", action: "remove" });
        } else if (!(tk in dTags)) {
          changes.push({ key: `tags.${tk}`, from: "(not in config)", to: `"${aTags[tk]}"`, action: "add" });
        } else if (dTags[tk] !== aTags[tk]) {
          changes.push({ key: `tags.${tk}`, from: `"${dTags[tk]}"`, to: `"${aTags[tk]}"`, action: "update" });
        }
      }
    } else {
      const dVal = JSON.stringify(desired[key]);
      const aVal = JSON.stringify(actual[key]);
      if (dVal !== aVal) {
        changes.push({ key, from: dVal, to: aVal, action: "update" });
      }
    }
  }
  return changes;
}

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

function ResourcePanel({
  title,
  resource,
  editable,
  onChange,
  highlight,
}: {
  title: string;
  resource: Resource;
  editable: boolean;
  onChange?: (r: Resource) => void;
  highlight?: Set<string>;
}) {
  const isHighlighted = (key: string) => highlight?.has(key);

  const inputStyle = (key: string): React.CSSProperties => ({
    background: editable ? "#2a2d37" : "transparent",
    border: editable ? "1px solid #3a3d47" : "1px solid transparent",
    borderRadius: 4,
    color: isHighlighted(key) ? "#e06c75" : "#abb2bf",
    fontFamily: FONT,
    fontSize: 12,
    padding: "2px 6px",
    width: "100%",
    outline: "none",
    cursor: editable ? "text" : "default",
    textDecoration: isHighlighted(key) ? "line-through" : "none",
  });

  const labelStyle = (key: string): React.CSSProperties => ({
    color: isHighlighted(key) ? "#e5c07b" : "#636a76",
    fontSize: 11,
    fontFamily: FONT,
    minWidth: 110,
    flexShrink: 0,
  });

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "3px 0",
  };

  const update = (key: keyof Resource, value: string | boolean | number) => {
    if (!onChange) return;
    const next = deepClone(resource);
    (next as any)[key] = value;
    onChange(next);
  };

  const updateTag = (tagKey: string, value: string) => {
    if (!onChange) return;
    const next = deepClone(resource);
    next.tags[tagKey] = value;
    onChange(next);
  };

  const removeTag = (tagKey: string) => {
    if (!onChange) return;
    const next = deepClone(resource);
    delete next.tags[tagKey];
    onChange(next);
  };

  const addTag = () => {
    if (!onChange) return;
    const next = deepClone(resource);
    const key = `NewTag${Object.keys(next.tags).length}`;
    next.tags[key] = "value";
    onChange(next);
  };

  return (
    <div
      style={{
        background: "#1e2028",
        borderRadius: 10,
        border: `1px solid ${editable ? "#e5c07b40" : "#2a2d37"}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid #2a2d37",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: editable ? "#e5c07b" : "#61afef" }}>
          {editable ? "Cloud Console" : "Terraform State"}
        </span>
        <span style={{ fontSize: 11, color: "#636a76", fontFamily: FONT }}>{title}</span>
      </div>

      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={rowStyle}>
          <span style={labelStyle("instance_type")}>instance_type</span>
          {editable ? (
            <select
              value={resource.instance_type}
              onChange={(e) => update("instance_type", e.target.value)}
              style={{
                ...inputStyle("instance_type"),
                cursor: "pointer",
                appearance: "auto" as any,
              }}
            >
              <option value="t3.micro">t3.micro</option>
              <option value="t3.small">t3.small</option>
              <option value="t3.medium">t3.medium</option>
              <option value="m5.large">m5.large</option>
              <option value="c5.xlarge">c5.xlarge</option>
            </select>
          ) : (
            <span style={inputStyle("instance_type")}>{resource.instance_type}</span>
          )}
        </div>

        <div style={rowStyle}>
          <span style={labelStyle("ami")}>ami</span>
          <span style={inputStyle("ami")}>{resource.ami}</span>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle("monitoring")}>monitoring</span>
          {editable ? (
            <button
              onClick={() => update("monitoring", !resource.monitoring)}
              style={{
                ...inputStyle("monitoring"),
                cursor: "pointer",
                textAlign: "left",
                width: "auto",
                textDecoration: isHighlighted("monitoring") ? "line-through" : "none",
              }}
            >
              {resource.monitoring ? "true" : "false"}
            </button>
          ) : (
            <span style={inputStyle("monitoring")}>{resource.monitoring ? "true" : "false"}</span>
          )}
        </div>

        <div style={rowStyle}>
          <span style={labelStyle("root_volume_size")}>root_volume_size</span>
          {editable ? (
            <select
              value={resource.root_volume_size}
              onChange={(e) => update("root_volume_size", parseInt(e.target.value))}
              style={{
                ...inputStyle("root_volume_size"),
                cursor: "pointer",
                appearance: "auto" as any,
              }}
            >
              {[8, 16, 20, 30, 50, 100].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <span style={inputStyle("root_volume_size")}>{resource.root_volume_size}</span>
          )}
        </div>

        <div style={{ marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ ...labelStyle("tags"), color: "#636a76" }}>tags</span>
            {editable && (
              <button
                onClick={addTag}
                style={{
                  background: "#2a2d37",
                  border: "1px solid #3a3d47",
                  borderRadius: 4,
                  color: "#98c379",
                  fontFamily: FONT,
                  fontSize: 10,
                  padding: "1px 8px",
                  cursor: "pointer",
                }}
              >
                + add
              </button>
            )}
          </div>
          {Object.entries(resource.tags).map(([k, v]) => (
            <div key={k} style={{ ...rowStyle, paddingLeft: 16 }}>
              <span style={{ ...labelStyle(`tags.${k}`), minWidth: 90 }}>{k}</span>
              {editable ? (
                <>
                  <input
                    value={v}
                    onChange={(e) => updateTag(k, e.target.value)}
                    style={inputStyle(`tags.${k}`)}
                  />
                  <button
                    onClick={() => removeTag(k)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#e06c75",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: "0 4px",
                      fontFamily: FONT,
                    }}
                  >
                    x
                  </button>
                </>
              ) : (
                <span style={inputStyle(`tags.${k}`)}>{v}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildPlanLines(changes: ReturnType<typeof diffResources>): string[] {
  const allLines: string[] = [];

  allLines.push("aws_instance.web: Refreshing state... [id=i-0a1b2c3d4e5f67890]");
  allLines.push("");

  if (changes.length === 0) {
    allLines.push("No changes. Your infrastructure matches the configuration.");
    allLines.push("");
    allLines.push("Apply complete! Resources: 0 added, 0 changed, 0 destroyed.");
  } else {
    allLines.push("Terraform detected the following drift for aws_instance.web:");
    allLines.push("");
    allLines.push("  # aws_instance.web has changed");
    allLines.push("  ~ resource \"aws_instance\" \"web\" {");

    const forceReplace = changes.some((c) => c.key === "ami");

    for (const change of changes) {
      if (change.action === "remove") {
        allLines.push(`      - ${change.key} = ${change.from} -> null`);
      } else if (change.action === "add") {
        allLines.push(`      + ${change.key} = ${change.to}`);
      } else {
        const marker = change.key === "ami" ? "-/+" : "~";
        allLines.push(`      ${marker} ${change.key} = ${change.from} -> ${change.to}`);
      }
    }

    allLines.push("    }");
    allLines.push("");

    if (forceReplace) {
      allLines.push(
        "Plan: 1 to add, 0 to change, 1 to destroy.  # forces replacement"
      );
    } else {
      allLines.push(
        `Plan: 0 to add, ${changes.length} to change, 0 to destroy.`
      );
    }
    allLines.push("");
    allLines.push("Note: Terraform will revert the manual changes to match your configuration.");
  }

  return allLines;
}

function PlanOutput({ changes, running }: { changes: ReturnType<typeof diffResources>; running: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const changesKey = JSON.stringify(changes);

  useEffect(() => {
    if (!running) {
      setLines([]);
      setDone(false);
      return;
    }

    const allLines = buildPlanLines(changes);
    let i = 0;
    setLines([]);
    setDone(false);

    const interval = setInterval(() => {
      if (i < allLines.length) {
        const line = allLines[i];
        setLines((prev) => [...prev, line]);
        i++;
      } else {
        setDone(true);
        clearInterval(interval);
      }
    }, 80);

    return () => clearInterval(interval);
  }, [running, changesKey]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const colorLine = (line: string) => {
    if (line.startsWith("      - ")) return "#e06c75";
    if (line.startsWith("      + ")) return "#98c379";
    if (line.startsWith("      ~ ") || line.startsWith("      -/+ ")) return "#e5c07b";
    if (line.startsWith("  ~ ") || line.startsWith("  # ")) return "#e5c07b";
    if (line.startsWith("Plan:")) return "#61afef";
    if (line.startsWith("Note:")) return "#636a76";
    if (line.includes("No changes")) return "#98c379";
    if (line.includes("Refreshing")) return "#636a76";
    return "#abb2bf";
  };

  return (
    <div
      ref={containerRef}
      style={{
        background: "#16181d",
        borderRadius: 10,
        border: "1px solid #2a2d37",
        padding: "10px 14px",
        minHeight: 120,
        maxHeight: 280,
        overflow: "auto",
        fontFamily: FONT,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {!running && lines.length === 0 && (
        <span style={{ color: "#636a76", fontStyle: "italic" }}>
          Modifica atributos en el Cloud Console y ejecuta terraform plan...
        </span>
      )}
      {lines.map((line, i) => (
        <div key={i} style={{ color: colorLine(line), whiteSpace: "pre" }}>
          {line || "\u00A0"}
        </div>
      ))}
      {running && !done && (
        <span style={{ color: "#636a76", animation: "hclPulse 1s ease-in-out infinite" }}>_</span>
      )}
    </div>
  );
}

export default function StateDriftDetector() {
  const [actual, setActual] = useState<Resource>(deepClone(DESIRED_STATE));
  const [running, setRunning] = useState(false);
  const [planChanges, setPlanChanges] = useState<ReturnType<typeof diffResources>>([]);

  const changes = diffResources(DESIRED_STATE, actual);
  const hasDrift = changes.length > 0;

  const runPlan = () => {
    setPlanChanges(changes);
    setRunning(true);
  };

  const resetAll = () => {
    setActual(deepClone(DESIRED_STATE));
    setRunning(false);
    setPlanChanges([]);
  };

  const applyFix = () => {
    setActual(deepClone(DESIRED_STATE));
    setRunning(false);
    setPlanChanges([]);
  };

  return (
    <DemoWrapper
      title="Detector de Drift"
      description="Simula cambios manuales en la nube y observa cómo Terraform detecta y corrige la diferencia"
    >
      <style>{`
        @keyframes hclPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Status bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            background: hasDrift ? "#e06c7515" : "#98c37915",
            border: `1px solid ${hasDrift ? "#e06c7530" : "#98c37930"}`,
            borderRadius: 8,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: 12,
              color: hasDrift ? "#e06c75" : "#98c379",
              fontWeight: 600,
            }}
          >
            {hasDrift
              ? `Drift detectado: ${changes.length} atributo${changes.length > 1 ? "s" : ""} modificado${changes.length > 1 ? "s" : ""}`
              : "Sin drift: infraestructura y configuración sincronizadas"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={runPlan}
              disabled={!hasDrift || running}
              style={{
                fontFamily: FONT,
                fontSize: 11,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                background: hasDrift && !running ? "#61afef" : "#2a2d37",
                color: hasDrift && !running ? "#16181d" : "#636a76",
                cursor: hasDrift && !running ? "pointer" : "default",
                fontWeight: 600,
              }}
            >
              terraform plan
            </button>
            {running && planChanges.length > 0 && (
              <button
                onClick={applyFix}
                style={{
                  fontFamily: FONT,
                  fontSize: 11,
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "#98c379",
                  color: "#16181d",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                terraform apply
              </button>
            )}
            <button
              onClick={resetAll}
              style={{
                fontFamily: FONT,
                fontSize: 11,
                padding: "4px 12px",
                borderRadius: 6,
                border: "1px solid #3a3d47",
                background: "transparent",
                color: "#636a76",
                cursor: "pointer",
              }}
            >
              reset
            </button>
          </div>
        </div>

        {/* Two panels */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ResourcePanel
            title="aws_instance.web"
            resource={DESIRED_STATE}
            editable={false}
            highlight={new Set(changes.map((c) => c.key))}
          />
          <ResourcePanel
            title="aws_instance.web"
            resource={actual}
            editable={!running}
            onChange={setActual}
            highlight={new Set(changes.map((c) => c.key))}
          />
        </div>

        {/* Plan output */}
        <PlanOutput changes={planChanges} running={running} />
      </div>
    </DemoWrapper>
  );
}
