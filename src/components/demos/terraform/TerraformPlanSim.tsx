import React, { useState, useEffect, useRef } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const INITIAL_CONFIG = `resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  monitoring    = true

  tags = {
    Name        = "web-prod"
    Environment = "prod"
  }
}`;

interface DiffLine {
  text: string;
  type: "unchanged" | "added" | "removed" | "changed" | "header" | "info";
}

interface PlanResult {
  lines: DiffLine[];
  summary: string;
  toAdd: number;
  toChange: number;
  toDestroy: number;
  forcesReplacement: boolean;
}

type PresetKey = "instance_type" | "add_tag" | "remove_monitoring" | "change_ami";

interface Preset {
  label: string;
  apply: (config: string) => string;
}

const PRESETS: Record<PresetKey, Preset> = {
  instance_type: {
    label: "Cambiar instance type",
    apply: (config) =>
      config.replace('instance_type = "t3.micro"', 'instance_type = "t3.large"'),
  },
  add_tag: {
    label: "Añadir tag",
    apply: (config) =>
      config.replace(
        '    Environment = "prod"\n  }',
        '    Environment = "prod"\n    Team        = "platform"\n  }'
      ),
  },
  remove_monitoring: {
    label: "Eliminar monitoring",
    apply: (config) =>
      config.replace("  monitoring    = true\n\n", "\n"),
  },
  change_ami: {
    label: "Cambiar AMI",
    apply: (config) =>
      config.replace(
        'ami           = "ami-0c55b159cbfafe1f0"',
        'ami           = "ami-0abcdef1234567890"'
      ),
  },
};

function computeDiff(oldText: string, newText: string): PlanResult {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const diffLines: DiffLine[] = [];
  let toAdd = 0;
  let toChange = 0;
  let toDestroy = 0;
  let forcesReplacement = false;

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Check for AMI change (forces replacement)
  const oldAmi = oldLines.find((l) => l.trim().startsWith("ami"));
  const newAmi = newLines.find((l) => l.trim().startsWith("ami"));
  if (oldAmi && newAmi && oldAmi !== newAmi) {
    forcesReplacement = true;
  }

  // Build diff using simple line comparison
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    const oldLine = oi < oldLines.length ? oldLines[oi] : undefined;
    const newLine = ni < newLines.length ? newLines[ni] : undefined;

    if (oldLine !== undefined && newLine !== undefined) {
      if (oldLine === newLine) {
        diffLines.push({ text: `    ${oldLine}`, type: "unchanged" });
        oi++;
        ni++;
      } else if (!newSet.has(oldLine) && !oldSet.has(newLine)) {
        // Both lines differ at this position and neither exists elsewhere — it's a change
        diffLines.push({ text: `  ~ ${oldLine}`, type: "changed" });
        diffLines.push({ text: `  ~ ${newLine}`, type: "added" });
        toChange++;
        oi++;
        ni++;
      } else if (!newSet.has(oldLine)) {
        // Old line was removed
        diffLines.push({ text: `  - ${oldLine}`, type: "removed" });
        toDestroy++;
        oi++;
      } else {
        // New line was added
        diffLines.push({ text: `  + ${newLine}`, type: "added" });
        toAdd++;
        ni++;
      }
    } else if (oldLine !== undefined) {
      diffLines.push({ text: `  - ${oldLine}`, type: "removed" });
      toDestroy++;
      oi++;
    } else if (newLine !== undefined) {
      diffLines.push({ text: `  + ${newLine}`, type: "added" });
      toAdd++;
      ni++;
    }
  }

  const summary = `Plan: ${toAdd} to add, ${toChange} to change, ${toDestroy} to destroy.`;

  return { lines: diffLines, summary, toAdd, toChange, toDestroy, forcesReplacement };
}

function colorForType(type: DiffLine["type"]): string {
  switch (type) {
    case "removed":
      return "#e06c75";
    case "added":
      return "#98c379";
    case "changed":
      return "#e5c07b";
    case "header":
      return "#e5c07b";
    case "info":
      return "#636a76";
    default:
      return "#636a76";
  }
}

export default function TerraformPlanSim() {
  const [currentConfig, setCurrentConfig] = useState(INITIAL_CONFIG);
  const [editedConfig, setEditedConfig] = useState(INITIAL_CONFIG);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [visibleLines, setVisibleLines] = useState<DiffLine[]>([]);
  const [planRunning, setPlanRunning] = useState(false);
  const [planDone, setPlanDone] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const hasChanges = currentConfig !== editedConfig;

  const runPlan = () => {
    if (!hasChanges) return;
    const result = computeDiff(currentConfig, editedConfig);
    setPlanResult(result);
    setVisibleLines([]);
    setPlanRunning(true);
    setPlanDone(false);
    setApplyMessage(null);
  };

  const runApply = () => {
    setCurrentConfig(editedConfig);
    setPlanRunning(false);
    setPlanDone(false);
    setPlanResult(null);
    setVisibleLines([]);
    setApplyMessage("Apply complete! Resources: changes applied successfully.");
    setTimeout(() => setApplyMessage(null), 4000);
  };

  const resetAll = () => {
    setCurrentConfig(INITIAL_CONFIG);
    setEditedConfig(INITIAL_CONFIG);
    setPlanResult(null);
    setVisibleLines([]);
    setPlanRunning(false);
    setPlanDone(false);
    setApplyMessage(null);
  };

  const applyPreset = (key: PresetKey) => {
    const preset = PRESETS[key];
    setEditedConfig(preset.apply(currentConfig));
    setPlanResult(null);
    setVisibleLines([]);
    setPlanRunning(false);
    setPlanDone(false);
    setApplyMessage(null);
  };

  // Animate plan output line by line
  useEffect(() => {
    if (!planRunning || !planResult) return;

    const allLines: DiffLine[] = [
      { text: "aws_instance.web: Refreshing state... [id=i-0a1b2c3d4e5f67890]", type: "info" },
      { text: "", type: "unchanged" },
      { text: "Terraform will perform the following actions:", type: "info" },
      { text: "", type: "unchanged" },
    ];

    if (planResult.forcesReplacement) {
      allLines.push({
        text: "  # aws_instance.web must be replaced  # forces replacement",
        type: "header",
      });
    } else {
      allLines.push({
        text: "  # aws_instance.web will be updated in-place",
        type: "header",
      });
    }

    allLines.push(
      { text: `  ~ resource "aws_instance" "web" {`, type: "header" },
      ...planResult.lines,
      { text: "    }", type: "unchanged" },
      { text: "", type: "unchanged" },
    );

    if (planResult.forcesReplacement) {
      allLines.push({
        text: `Plan: 1 to add, ${planResult.toChange} to change, 1 to destroy.  # forces replacement`,
        type: "info",
      });
    } else {
      allLines.push({
        text: planResult.summary,
        type: "info",
      });
    }

    let i = 0;
    setVisibleLines([]);

    const interval = setInterval(() => {
      if (i < allLines.length) {
        const line = allLines[i];
        setVisibleLines((prev) => [...prev, line]);
        i++;
      } else {
        setPlanDone(true);
        clearInterval(interval);
      }
    }, 80);

    return () => clearInterval(interval);
  }, [planRunning, planResult]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [visibleLines]);

  const panelStyle: React.CSSProperties = {
    background: "#1e2028",
    borderRadius: 10,
    border: "1px solid #2a2d37",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  const panelHeaderStyle: React.CSSProperties = {
    padding: "8px 14px",
    borderBottom: "1px solid #2a2d37",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };

  const buttonBase: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 11,
    padding: "4px 12px",
    borderRadius: 6,
    border: "none",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <DemoWrapper
      title="Simulador de Plan/Apply"
      description="Edita la configuración y observa el plan de cambios"
    >
      <style>{`
        @keyframes planPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Controls bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            background: "#1e2028",
            border: "1px solid #2a2d37",
            borderRadius: 8,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              title="Cambios predefinidos"
              onChange={(e) => {
                if (e.target.value) {
                  applyPreset(e.target.value as PresetKey);
                  e.target.value = "";
                }
              }}
              defaultValue=""
              style={{
                fontFamily: FONT,
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #3a3d47",
                background: "#2a2d37",
                color: "#abb2bf",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="" disabled>
                Cambios predefinidos...
              </option>
              {Object.entries(PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={runPlan}
              disabled={!hasChanges || planRunning}
              style={{
                ...buttonBase,
                background: hasChanges && !planRunning ? "#61afef" : "#2a2d37",
                color: hasChanges && !planRunning ? "#16181d" : "#636a76",
                cursor: hasChanges && !planRunning ? "pointer" : "default",
              }}
            >
              terraform plan
            </button>
            {planDone && planResult && (
              <button
                type="button"
                onClick={runApply}
                style={{
                  ...buttonBase,
                  background: "#98c379",
                  color: "#16181d",
                }}
              >
                terraform apply
              </button>
            )}
            <button
              type="button"
              onClick={resetAll}
              style={{
                ...buttonBase,
                border: "1px solid #3a3d47",
                background: "transparent",
                color: "#636a76",
              }}
            >
              reset
            </button>
          </div>
        </div>

        {/* Apply success message */}
        {applyMessage && (
          <div
            style={{
              padding: "8px 14px",
              background: "#98c37915",
              border: "1px solid #98c37930",
              borderRadius: 8,
              fontFamily: FONT,
              fontSize: 12,
              color: "#98c379",
              fontWeight: 600,
            }}
          >
            {applyMessage}
          </div>
        )}

        {/* Two panels */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Left panel: current state (read-only) */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <span style={{ fontSize: 12, color: "#61afef" }}>Configuración actual</span>
              <span style={{ fontSize: 11, color: "#636a76", fontFamily: FONT }}>
                (estado aplicado)
              </span>
            </div>
            <div style={{ padding: "10px 14px", flex: 1 }}>
              <pre
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "#abb2bf",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {currentConfig}
              </pre>
            </div>
          </div>

          {/* Right panel: editable */}
          <div style={{ ...panelStyle, border: "1px solid #e5c07b40" }}>
            <div style={panelHeaderStyle}>
              <span style={{ fontSize: 12, color: "#e5c07b" }}>Nueva configuración</span>
              <span style={{ fontSize: 11, color: "#636a76", fontFamily: FONT }}>
                (editable)
              </span>
            </div>
            <div style={{ padding: "10px 14px", flex: 1 }}>
              <textarea
                title="Editar configuración HCL"
                value={editedConfig}
                onChange={(e) => {
                  setEditedConfig(e.target.value);
                  setPlanResult(null);
                  setVisibleLines([]);
                  setPlanRunning(false);
                  setPlanDone(false);
                }}
                spellCheck={false}
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "#abb2bf",
                  background: "#16181d",
                  border: "1px solid #2a2d37",
                  borderRadius: 6,
                  padding: "10px 12px",
                  width: "100%",
                  minHeight: 220,
                  resize: "none",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        </div>

        {/* Plan output */}
        <div
          ref={outputRef}
          style={{
            background: "#16181d",
            borderRadius: 10,
            border: "1px solid #2a2d37",
            padding: "10px 14px",
            minHeight: 120,
            maxHeight: 300,
            overflow: "auto",
            fontFamily: FONT,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {!planRunning && visibleLines.length === 0 && !applyMessage && (
            <span style={{ color: "#636a76", fontStyle: "italic" }}>
              Edita la configuración y ejecuta terraform plan para ver los cambios...
            </span>
          )}
          {visibleLines.map((line, i) => {
            let color = colorForType(line.type);
            const text = line.text;

            // Special coloring for plan summary and replacement lines
            if (text.startsWith("Plan:")) color = "#61afef";
            if (text.includes("forces replacement")) color = "#e5c07b";
            if (text.includes("Refreshing")) color = "#636a76";
            if (text.includes("will perform")) color = "#abb2bf";

            return (
              <div key={i} style={{ color, whiteSpace: "pre" }}>
                {text || "\u00A0"}
              </div>
            );
          })}
          {planRunning && !planDone && (
            <span style={{ color: "#636a76", animation: "planPulse 1s ease-in-out infinite" }}>
              _
            </span>
          )}
        </div>
      </div>
    </DemoWrapper>
  );
}
