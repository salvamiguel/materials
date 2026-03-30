import React, { useState, useEffect, useRef } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// AWS Console colors
const AWS = {
  headerBg: "#232f3e",
  headerBorder: "#3b4a5a",
  orange: "#ff9900",
  orangeHover: "#ec7211",
  bg: "#0f1b2d",
  surface: "#1a2638",
  surfaceBorder: "#2a3f55",
  text: "#d5dbdb",
  textMuted: "#8c9bab",
  inputBg: "#0a1628",
  inputBorder: "#3b5069",
  success: "#1d8102",
  link: "#539fe5",
};

interface ConsoleStep {
  title: string;
  fields: { label: string; type: "select" | "text" | "checkbox" | "info"; value: string; options?: string[] }[];
  duration: number;
}

const CONSOLE_STEPS: ConsoleStep[] = [
  {
    title: "Step 1: Choose AMI",
    fields: [
      { label: "AMI", type: "select", value: "Ubuntu Server 22.04 LTS (ami-0c55b...)", options: ["Ubuntu Server 22.04 LTS (ami-0c55b...)", "Amazon Linux 2023", "Windows Server 2022"] },
    ],
    duration: 1200,
  },
  {
    title: "Step 2: Instance Type",
    fields: [
      { label: "Instance type", type: "select", value: "t3.micro", options: ["t3.micro", "t3.small", "t3.medium", "m5.large"] },
    ],
    duration: 800,
  },
  {
    title: "Step 3: Network",
    fields: [
      { label: "VPC", type: "select", value: "vpc-0a1b2c3d (main)", options: ["vpc-0a1b2c3d (main)"] },
      { label: "Subnet", type: "select", value: "subnet-public-eu-west-1a", options: ["subnet-public-eu-west-1a", "subnet-private-eu-west-1a"] },
      { label: "Auto-assign Public IP", type: "select", value: "Enable", options: ["Enable", "Disable"] },
    ],
    duration: 1400,
  },
  {
    title: "Step 4: Security Group",
    fields: [
      { label: "Security group name", type: "text", value: "web-sg" },
      { label: "Port 80 (HTTP)", type: "checkbox", value: "true" },
      { label: "Port 443 (HTTPS)", type: "checkbox", value: "true" },
    ],
    duration: 1000,
  },
  {
    title: "Step 5: Storage",
    fields: [
      { label: "Volume size (GiB)", type: "select", value: "20", options: ["8", "16", "20", "30", "50"] },
      { label: "Volume type", type: "select", value: "gp3", options: ["gp2", "gp3", "io1", "io2"] },
      { label: "Encryption", type: "checkbox", value: "true" },
    ],
    duration: 900,
  },
  {
    title: "Step 6: Tags",
    fields: [
      { label: "Name", type: "text", value: "web-prod" },
      { label: "Environment", type: "text", value: "prod" },
    ],
    duration: 1000,
  },
  {
    title: "Step 7: Review & Launch",
    fields: [
      { label: "Status", type: "info", value: "Launching instance..." },
    ],
    duration: 1800,
  },
];

interface Step {
  label: string;
  duration: number;
}

const IAC_STEPS: Step[] = [
  { label: "$ terraform init", duration: 600 },
  { label: "  Initializing providers...", duration: 400 },
  { label: "$ terraform plan", duration: 500 },
  { label: "  + aws_instance.web will be created", duration: 300 },
  { label: "  Plan: 1 to add, 0 to change, 0 to destroy.", duration: 300 },
  { label: "$ terraform apply -auto-approve", duration: 400 },
  { label: "  aws_instance.web: Creating...", duration: 800 },
  { label: "  aws_instance.web: Creation complete [id=i-0a1b2c3d]", duration: 400 },
  { label: "  Apply complete! Resources: 1 added.", duration: 0 },
];

interface ScoreCard {
  label: string;
  clickops: string;
  iac: string;
  winner: "clickops" | "iac" | "tie";
}

const SCORES: ScoreCard[] = [
  { label: "Reproducible", clickops: "No", iac: "Si", winner: "iac" },
  { label: "Auditable", clickops: "No", iac: "Git log", winner: "iac" },
  { label: "Code review", clickops: "No", iac: "Pull request", winner: "iac" },
  { label: "Rollback", clickops: "Manual", iac: "git revert", winner: "iac" },
  { label: "Multi-entorno", clickops: "Repetir todo", iac: "terraform workspace", winner: "iac" },
  { label: "Documentacion", clickops: "Inexistente", iac: "El codigo es la doc", winner: "iac" },
  { label: "Velocidad (1 vez)", clickops: "Similar", iac: "Similar", winner: "tie" },
  { label: "Velocidad (x10)", clickops: "10x esfuerzo", iac: "Mismo comando", winner: "iac" },
];

function AwsFormField({ field }: { field: ConsoleStep["fields"][0] }) {
  const labelStyle: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 11,
    color: AWS.text,
    marginBottom: 3,
    display: "block",
  };
  const inputBase: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 11,
    background: AWS.inputBg,
    border: `1px solid ${AWS.inputBorder}`,
    borderRadius: 3,
    color: AWS.text,
    padding: "4px 8px",
    width: "100%",
    outline: "none",
  };

  if (field.type === "checkbox") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 2,
            border: `1px solid ${AWS.inputBorder}`,
            background: field.value === "true" ? AWS.orange : AWS.inputBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {field.value === "true" ? "\u2713" : ""}
        </div>
        <span style={{ fontFamily: SANS, fontSize: 11, color: AWS.text }}>{field.label}</span>
      </div>
    );
  }

  if (field.type === "info") {
    return (
      <div style={{ padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: `2px solid ${AWS.orange}`,
            borderTopColor: "transparent",
            animation: "awsSpin 0.8s linear infinite",
          }}
        />
        <span style={{ fontFamily: SANS, fontSize: 11, color: AWS.orange }}>{field.value}</span>
      </div>
    );
  }

  return (
    <div style={{ padding: "2px 0" }}>
      <label style={labelStyle}>{field.label}</label>
      {field.type === "select" ? (
        <div style={{ ...inputBase, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "default" }}>
          <span>{field.value}</span>
          <span style={{ color: AWS.textMuted, fontSize: 9 }}>{"\u25BC"}</span>
        </div>
      ) : (
        <div style={inputBase}>{field.value}</div>
      )}
    </div>
  );
}

function AwsConsolePanel({
  running,
  onDone,
  resetFlag,
}: {
  running: boolean;
  onDone: () => void;
  resetFlag: number;
}) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentStep(-1);
    setDone(false);
  }, [resetFlag]);

  useEffect(() => {
    if (!running) return;

    let step = 0;
    setCurrentStep(0);
    setDone(false);

    let timeout: ReturnType<typeof setTimeout>;

    const advance = () => {
      step++;
      if (step < CONSOLE_STEPS.length) {
        setCurrentStep(step);
        timeout = setTimeout(advance, CONSOLE_STEPS[step].duration);
      } else {
        setDone(true);
        onDone();
      }
    };

    timeout = setTimeout(advance, CONSOLE_STEPS[0].duration);

    return () => clearTimeout(timeout);
  }, [running]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [currentStep]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* AWS navbar */}
      <div
        style={{
          background: AWS.headerBg,
          borderBottom: `1px solid ${AWS.headerBorder}`,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: AWS.orange, fontFamily: SANS, fontWeight: 700, fontSize: 13 }}>aws</span>
          <span style={{ color: AWS.textMuted, fontSize: 10, fontFamily: SANS }}>{">"}</span>
          <span style={{ color: AWS.text, fontSize: 11, fontFamily: SANS }}>EC2</span>
          <span style={{ color: AWS.textMuted, fontSize: 10, fontFamily: SANS }}>{">"}</span>
          <span style={{ color: AWS.text, fontSize: 11, fontFamily: SANS }}>Launch Instance</span>
        </div>
        <span style={{ fontFamily: SANS, fontSize: 9, color: AWS.textMuted }}>eu-west-1</span>
      </div>

      {/* Progress bar */}
      <div style={{ background: AWS.headerBg, padding: "0 12px 6px", display: "flex", gap: 2 }}>
        {CONSOLE_STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 1,
              background: i <= currentStep ? AWS.orange : AWS.headerBorder,
              transition: "background 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Form content */}
      <div
        ref={containerRef}
        style={{
          background: AWS.bg,
          flex: 1,
          padding: "10px 12px",
          minHeight: 200,
          maxHeight: 260,
          overflow: "auto",
          borderRadius: "0 0 8px 8px",
        }}
      >
        {currentStep < 0 && !done && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 180 }}>
            <span style={{ fontFamily: SANS, fontSize: 12, color: AWS.textMuted, fontStyle: "italic" }}>
              Pulsa el boton para comenzar...
            </span>
          </div>
        )}

        {CONSOLE_STEPS.slice(0, currentStep + 1).map((step, i) => {
          const isActive = i === currentStep && !done;
          return (
            <div
              key={i}
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                background: isActive ? AWS.surface : "transparent",
                border: isActive ? `1px solid ${AWS.surfaceBorder}` : "1px solid transparent",
                borderRadius: 6,
                opacity: isActive || done ? 1 : 0.4,
                transition: "all 0.3s ease",
              }}
            >
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 11,
                  fontWeight: 600,
                  color: i < currentStep || done ? AWS.success : AWS.orange,
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {i < currentStep || done ? (
                  <span style={{ fontSize: 12 }}>{"\u2713"}</span>
                ) : (
                  <span style={{ fontSize: 8 }}>{"\u25CF"}</span>
                )}
                {step.title}
              </div>
              {(isActive || (i < currentStep)) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 18 }}>
                  {step.fields.map((field, fi) => (
                    <AwsFormField key={fi} field={field} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {done && (
          <div
            style={{
              padding: "10px 12px",
              background: "#0a2010",
              border: `1px solid ${AWS.success}`,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: AWS.success, fontSize: 14 }}>{"\u2713"}</span>
            <div>
              <div style={{ fontFamily: SANS, fontSize: 11, color: AWS.success, fontWeight: 600 }}>
                Instance launched successfully
              </div>
              <div style={{ fontFamily: SANS, fontSize: 10, color: AWS.textMuted, marginTop: 2 }}>
                i-0a1b2c3d4e5f67890 | No audit trail, no code review, no rollback
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IaCTerminal({
  running,
  onDone,
  resetFlag,
}: {
  running: boolean;
  onDone: () => void;
  resetFlag: number;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(0);
  }, [resetFlag]);

  useEffect(() => {
    if (!running) return;

    let currentStep = 0;
    let timeout: ReturnType<typeof setTimeout>;

    const showNext = () => {
      currentStep++;
      setVisibleCount(currentStep);
      if (currentStep < IAC_STEPS.length) {
        timeout = setTimeout(showNext, IAC_STEPS[currentStep - 1].duration);
      } else {
        onDone();
      }
    };

    timeout = setTimeout(showNext, 300);
    return () => clearTimeout(timeout);
  }, [running]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleCount]);

  const colorLine = (line: string) => {
    if (line.startsWith("$")) return "#98c379";
    if (line.includes("complete") || line.includes("Apply")) return "#98c379";
    if (line.includes("+")) return "#61afef";
    return "#636a76";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Terminal header */}
      <div
        style={{
          background: "#2a2d37",
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div style={{ display: "flex", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e06c75" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e5c07b" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#98c379" }} />
        </div>
        <span style={{ fontFamily: FONT, fontSize: 11, color: "#636a76" }}>terminal &mdash; terraform</span>
      </div>

      {/* Terminal body */}
      <div
        ref={containerRef}
        style={{
          background: "#16181d",
          flex: 1,
          padding: "10px 14px",
          minHeight: 200,
          maxHeight: 260,
          overflow: "auto",
          fontFamily: FONT,
          fontSize: 11.5,
          lineHeight: 1.7,
          borderRadius: "0 0 8px 8px",
        }}
      >
        {!running && visibleCount === 0 && (
          <span style={{ color: "#636a76", fontStyle: "italic" }}>
            Pulsa el boton para comenzar...
          </span>
        )}
        {IAC_STEPS.slice(0, visibleCount).map((step, i) => {
          const isLast = i === IAC_STEPS.length - 1 && visibleCount === IAC_STEPS.length;
          return (
            <div
              key={i}
              style={{
                color: isLast ? "#98c379" : colorLine(step.label),
                fontWeight: isLast || step.label.startsWith("$") ? 600 : 400,
                whiteSpace: "pre",
              }}
            >
              {step.label}
            </div>
          );
        })}
        {running && visibleCount < IAC_STEPS.length && (
          <span style={{ color: "#636a76", animation: "clickopsPulse 1s ease-in-out infinite" }}>_</span>
        )}
      </div>
    </div>
  );
}

function Timer({ elapsed, running, done, color }: { elapsed: number; running: boolean; done: boolean; color: string }) {
  if (!running && !done && elapsed === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        marginTop: 10,
        padding: "8px 0",
        background: done ? `${color}10` : "transparent",
        borderRadius: 6,
        transition: "background 0.3s",
      }}
    >
      <span
        style={{
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 700,
          color: done ? color : "#abb2bf",
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.3s",
          minWidth: 70,
          textAlign: "center",
        }}
      >
        {(elapsed / 1000).toFixed(1)}s
      </span>
      {done && (
        <span
          style={{
            fontFamily: FONT,
            fontSize: 11,
            color,
            textTransform: "uppercase",
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          completado
        </span>
      )}
    </div>
  );
}

export default function ClickOpsVsIaC() {
  const [clickopsRunning, setClickopsRunning] = useState(false);
  const [iacRunning, setIacRunning] = useState(false);
  const [clickopsDone, setClickopsDone] = useState(false);
  const [iacDone, setIacDone] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [clickopsElapsed, setClickopsElapsed] = useState(0);
  const [iacElapsed, setIacElapsed] = useState(0);
  const [resetFlag, setResetFlag] = useState(0);
  const clickopsTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const iacTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const startBoth = () => {
    reset();
    setTimeout(() => {
      setClickopsRunning(true);
      setClickopsDone(false);
      setClickopsElapsed(0);
      clickopsTimerRef.current = setInterval(() => setClickopsElapsed((p) => p + 100), 100);

      setIacRunning(true);
      setIacDone(false);
      setIacElapsed(0);
      iacTimerRef.current = setInterval(() => setIacElapsed((p) => p + 100), 100);
    }, 50);
  };

  const onClickopsDone = () => {
    setClickopsRunning(false);
    setClickopsDone(true);
    if (clickopsTimerRef.current) clearInterval(clickopsTimerRef.current);
  };

  const onIacDone = () => {
    setIacRunning(false);
    setIacDone(true);
    if (iacTimerRef.current) clearInterval(iacTimerRef.current);
  };

  useEffect(() => {
    if (clickopsDone && iacDone) {
      setTimeout(() => setShowScores(true), 500);
    }
  }, [clickopsDone, iacDone]);

  const reset = () => {
    setClickopsRunning(false);
    setIacRunning(false);
    setClickopsDone(false);
    setIacDone(false);
    setShowScores(false);
    setClickopsElapsed(0);
    setIacElapsed(0);
    setResetFlag((f) => f + 1);
    if (clickopsTimerRef.current) clearInterval(clickopsTimerRef.current);
    if (iacTimerRef.current) clearInterval(iacTimerRef.current);
  };

  useEffect(() => {
    return () => {
      if (clickopsTimerRef.current) clearInterval(clickopsTimerRef.current);
      if (iacTimerRef.current) clearInterval(iacTimerRef.current);
    };
  }, []);

  const busy = clickopsRunning || iacRunning;

  return (
    <DemoWrapper
      title="ClickOps vs Infrastructure as Code"
      description="Compara crear la misma infraestructura de forma manual vs con Terraform"
    >
      <style>{`
        @keyframes clickopsPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes awsSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Start button */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button
            type="button"
            onClick={startBoth}
            disabled={busy}
            style={{
              fontFamily: FONT,
              fontSize: 12,
              padding: "6px 20px",
              borderRadius: 6,
              border: "none",
              background: busy ? "#2a2d37" : "var(--ifm-color-primary)",
              color: busy ? "#636a76" : "#16181d",
              cursor: busy ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            Crear instancia EC2 con ambos metodos
          </button>
          {(clickopsDone || iacDone) && (
            <button
              type="button"
              onClick={reset}
              style={{
                fontFamily: FONT,
                fontSize: 11,
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #3a3d47",
                background: "transparent",
                color: "#636a76",
                cursor: "pointer",
              }}
            >
              reset
            </button>
          )}
        </div>

        {/* Two columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* ClickOps: AWS Console */}
          <div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: AWS.orange,
                marginBottom: 6,
                textAlign: "center",
              }}
            >
              ClickOps — Consola AWS
            </div>
            <AwsConsolePanel running={clickopsRunning} onDone={onClickopsDone} resetFlag={resetFlag} />
            <Timer elapsed={clickopsElapsed} running={clickopsRunning} done={clickopsDone} color={AWS.orange} />
          </div>

          {/* IaC: Terminal */}
          <div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "#98c379",
                marginBottom: 6,
                textAlign: "center",
              }}
            >
              IaC — Terraform
            </div>
            <IaCTerminal running={iacRunning} onDone={onIacDone} resetFlag={resetFlag} />
            <Timer elapsed={iacElapsed} running={iacRunning} done={iacDone} color="#98c379" />
          </div>
        </div>

        {/* Scorecard */}
        {showScores && (
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
                padding: "8px 14px",
                borderBottom: "1px solid #2a2d37",
                fontFamily: FONT,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--ifm-color-primary)",
              }}
            >
              Comparativa: y si hay que hacerlo otra vez?
            </div>
            <table
              style={{
                width: "100%",
                tableLayout: "fixed",
                borderCollapse: "collapse",
                fontFamily: FONT,
                fontSize: 11.5,
                display: "table",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #2a2d37" }}>
                  <th style={{ textAlign: "left", padding: "6px 14px", color: "#636a76", fontWeight: 500 }}>Criterio</th>
                  <th style={{ textAlign: "center", padding: "6px 14px", color: AWS.orange, fontWeight: 500 }}>ClickOps</th>
                  <th style={{ textAlign: "center", padding: "6px 14px", color: "#98c379", fontWeight: 500 }}>IaC</th>
                </tr>
              </thead>
              <tbody>
                {SCORES.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #2a2d3740" }}>
                    <td style={{ padding: "5px 14px", color: "#abb2bf" }}>{s.label}</td>
                    <td
                      style={{
                        padding: "5px 14px",
                        textAlign: "center",
                        color: s.winner === "iac" ? "#e06c75" : s.winner === "tie" ? "#636a76" : "#98c379",
                      }}
                    >
                      {s.clickops}
                    </td>
                    <td
                      style={{
                        padding: "5px 14px",
                        textAlign: "center",
                        color: s.winner === "iac" ? "#98c379" : s.winner === "tie" ? "#636a76" : "#e06c75",
                      }}
                    >
                      {s.iac}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DemoWrapper>
  );
}
