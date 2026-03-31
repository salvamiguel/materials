import React, { useState, useEffect, useRef } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

// ─── Types ───────────────────────────────────────────────

type Phase =
  | "stable"       // Blue running, no update
  | "deploying"    // Green pods starting
  | "preview"      // Green ready for preview testing
  | "promoting"    // Traffic switching
  | "promoted"     // Green is active, Blue draining
  | "scaled-down"  // Blue removed, Green is the new stable
  | "rollback";    // Abort: traffic back to Blue

interface Pod {
  id: string;
  status: "running" | "creating" | "terminating" | "ready";
}

// ─── Constants ───────────────────────────────────────────

const BLUE = "#61afef";
const GREEN = "#98c379";
const BLUE_BG = "#61afef18";
const GREEN_BG = "#98c37918";
const POD_COUNT = 4;

function makePods(prefix: string, status: Pod["status"]): Pod[] {
  return Array.from({ length: POD_COUNT }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    status,
  }));
}

// ─── Terminal Log ────────────────────────────────────────

interface LogEntry {
  text: string;
  color: string;
}

const PHASE_LOGS: Record<Phase, LogEntry[]> = {
  stable: [
    { text: "$ kubectl argo rollouts get rollout mi-app", color: GREEN },
    { text: "Name:            mi-app", color: "#7e8590" },
    { text: "Status:          ✓ Healthy", color: "#4affa0" },
    { text: "Strategy:        BlueGreen", color: "#7e8590" },
    { text: "Images:          ghcr.io/org/app:v1.0.0 (active)", color: BLUE },
    { text: "", color: "transparent" },
    { text: "→ Producción estable con v1.0.0", color: "#4affa0" },
  ],
  deploying: [
    { text: "$ kubectl argo rollouts set image mi-app app=ghcr.io/org/app:v2.0.0", color: GREEN },
    { text: "rollout \"mi-app\" image updated", color: "#7e8590" },
    { text: "", color: "transparent" },
    { text: "→ Pod mi-app-green-01  ContainerCreating", color: "#e5c07b" },
    { text: "→ Pod mi-app-green-02  ContainerCreating", color: "#e5c07b" },
    { text: "→ Pod mi-app-green-03  ContainerCreating", color: "#e5c07b" },
    { text: "→ Pod mi-app-green-04  ContainerCreating", color: "#e5c07b" },
  ],
  preview: [
    { text: "→ Pod mi-app-green-01  Running ✓", color: "#4affa0" },
    { text: "→ Pod mi-app-green-02  Running ✓", color: "#4affa0" },
    { text: "→ Pod mi-app-green-03  Running ✓", color: "#4affa0" },
    { text: "→ Pod mi-app-green-04  Running ✓", color: "#4affa0" },
    { text: "", color: "transparent" },
    { text: "Status:          ⏸ Paused", color: "#e5c07b" },
    { text: "Message:         BlueGreenPause", color: "#e5c07b" },
    { text: "Preview:         mi-app-preview:80 → v2.0.0", color: GREEN },
    { text: "", color: "transparent" },
    { text: "→ Preview disponible. Valida antes de promover.", color: "#e5c07b" },
  ],
  promoting: [
    { text: "$ kubectl argo rollouts promote mi-app", color: GREEN },
    { text: "rollout \"mi-app\" promoted", color: "#7e8590" },
    { text: "", color: "transparent" },
    { text: "⟳ Switching active service selector...", color: "#e5c07b" },
    { text: "  mi-app-active: v1.0.0 → v2.0.0", color: "#abb2bf" },
  ],
  promoted: [
    { text: "Active:          mi-app-active:80 → v2.0.0 ✓", color: "#4affa0" },
    { text: "Status:          ✓ Healthy", color: "#4affa0" },
    { text: "", color: "transparent" },
    { text: "→ Tráfico de producción en v2.0.0", color: "#4affa0" },
    { text: "→ Pods v1.0.0 se mantendrán 30s por si hay rollback", color: "#7e8590" },
  ],
  "scaled-down": [
    { text: "→ Pod mi-app-blue-01  Terminating", color: "#e06c75" },
    { text: "→ Pod mi-app-blue-02  Terminating", color: "#e06c75" },
    { text: "→ Pod mi-app-blue-03  Terminating", color: "#e06c75" },
    { text: "→ Pod mi-app-blue-04  Terminating", color: "#e06c75" },
    { text: "", color: "transparent" },
    { text: "ScaleDown delay (30s) expirado.", color: "#7e8590" },
    { text: "Status:          ✓ Healthy", color: "#4affa0" },
    { text: "Images:          ghcr.io/org/app:v2.0.0 (active)", color: GREEN },
    { text: "", color: "transparent" },
    { text: "✓ Blue-Green completado. v2.0.0 es la nueva versión estable.", color: "#4affa0" },
  ],
  rollback: [
    { text: "$ kubectl argo rollouts abort mi-app", color: GREEN },
    { text: "rollout \"mi-app\" aborted", color: "#e06c75" },
    { text: "", color: "transparent" },
    { text: "⟳ Revirtiendo active service a v1.0.0...", color: "#e5c07b" },
    { text: "→ Pods Green terminados", color: "#e06c75" },
    { text: "Active:          mi-app-active:80 → v1.0.0", color: BLUE },
    { text: "Status:          ✓ Degraded → Healthy", color: "#4affa0" },
    { text: "", color: "transparent" },
    { text: "✓ Rollback instantáneo completado. Producción en v1.0.0.", color: "#4affa0" },
  ],
};

const PHASE_EXPLANATIONS: Record<Phase, { title: string; text: string }> = {
  stable: {
    title: "Producción estable",
    text: "Solo los pods Blue (v1.0.0) están corriendo y recibiendo tráfico de producción a través del Service mi-app-active.",
  },
  deploying: {
    title: "Desplegando nueva versión",
    text: "Argo Rollouts crea los pods Green (v2.0.0) en paralelo. Los pods Blue siguen recibiendo todo el tráfico de producción — zero downtime.",
  },
  preview: {
    title: "Preview disponible",
    text: "Los pods Green están listos. El Service mi-app-preview apunta a ellos para que el equipo pueda validar con smoke tests. autoPromotionEnabled: false requiere promoción manual.",
  },
  promoting: {
    title: "Promoviendo a producción",
    text: "El selector del Service mi-app-active cambia de Blue a Green. El switch es instantáneo — no hay ventana de downtime.",
  },
  promoted: {
    title: "Green es producción",
    text: "Todo el tráfico va a los pods Green (v2.0.0). Los pods Blue se mantienen scaleDownDelaySeconds (30s) como red de seguridad para rollback inmediato.",
  },
  "scaled-down": {
    title: "Despliegue completado",
    text: "Los pods Blue han sido eliminados. Green es ahora la versión estable. En el próximo despliegue, Green será el nuevo Blue.",
  },
  rollback: {
    title: "Rollback ejecutado",
    text: "El tráfico ha vuelto instantáneamente a los pods Blue (v1.0.0). Los pods Green se eliminan. El rollback en Blue-Green es inmediato porque Blue nunca se apagó durante el preview.",
  },
};

// ─── Pod Component ───────────────────────────────────────

function PodIcon({ pod, color }: { pod: Pod; color: string }) {
  const isActive = pod.status === "running" || pod.status === "ready";
  const isCreating = pod.status === "creating";
  const isTerminating = pod.status === "terminating";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        opacity: isTerminating ? 0.3 : 1,
        transition: "all 0.5s ease",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: isActive ? `${color}25` : isCreating ? `${color}10` : "transparent",
          border: `2px solid ${isActive ? color : isCreating ? color + "66" : "#2a2d37"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          transition: "all 0.5s ease",
          animation: isCreating ? "bgPulse 1.2s ease-in-out infinite" : "none",
        }}
      >
        {isTerminating ? "💀" : "📦"}
      </div>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 8.5,
          color: isActive ? color : "#636a76",
          transition: "color 0.3s",
        }}
      >
        {pod.id.split("-").slice(-1)}
      </span>
    </div>
  );
}

// ─── Environment Panel ───────────────────────────────────

function EnvPanel({
  label,
  version,
  color,
  bg,
  pods,
  trafficLabel,
  hasTraffic,
  visible,
}: {
  label: string;
  version: string;
  color: string;
  bg: string;
  pods: Pod[];
  trafficLabel: string;
  hasTraffic: boolean;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <div
      style={{
        flex: 1,
        background: bg,
        borderRadius: 10,
        border: `1.5px solid ${color}44`,
        padding: "14px 16px",
        transition: "all 0.5s ease",
        animation: "bgFadeIn 0.4s ease",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: color,
              boxShadow: hasTraffic ? `0 0 8px ${color}` : "none",
              animation: hasTraffic ? "bgTrafficPulse 1.5s ease-in-out infinite" : "none",
            }}
          />
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              color,
            }}
          >
            {label}
          </span>
        </div>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: "#7e8590",
          }}
        >
          {version}
        </span>
      </div>

      {/* Pods */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 10 }}>
        {pods.map((pod) => (
          <PodIcon key={pod.id} pod={pod} color={color} />
        ))}
      </div>

      {/* Traffic indicator */}
      <div
        style={{
          textAlign: "center",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: hasTraffic ? "#4affa0" : "#636a76",
          padding: "4px 8px",
          background: hasTraffic ? "#4affa010" : "transparent",
          borderRadius: 6,
          transition: "all 0.3s",
        }}
      >
        {trafficLabel}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export default function BlueGreenSwitcher() {
  const [phase, setPhase] = useState<Phase>("stable");
  const [logLines, setLogLines] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logs = PHASE_LOGS[phase];
  const explanation = PHASE_EXPLANATIONS[phase];

  // Animate log lines on phase change
  useEffect(() => {
    setLogLines(0);
    let line = 0;
    const tick = () => {
      line++;
      setLogLines(line);
      if (line < logs.length) {
        timerRef.current = setTimeout(tick, logs[line]?.color === "transparent" ? 50 : 120);
      }
    };
    timerRef.current = setTimeout(tick, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase]);

  // Derive pod states from phase
  const bluePods: Pod[] = (() => {
    switch (phase) {
      case "stable":
      case "deploying":
      case "preview":
      case "promoting":
        return makePods("mi-app-blue", "running");
      case "promoted":
        return makePods("mi-app-blue", "running"); // still alive, draining
      case "scaled-down":
        return makePods("mi-app-blue", "terminating");
      case "rollback":
        return makePods("mi-app-blue", "running");
    }
  })();

  const greenPods: Pod[] = (() => {
    switch (phase) {
      case "stable":
        return [];
      case "deploying":
        return makePods("mi-app-green", "creating");
      case "preview":
      case "promoting":
      case "promoted":
      case "scaled-down":
        return makePods("mi-app-green", "running");
      case "rollback":
        return makePods("mi-app-green", "terminating");
    }
  })();

  const blueHasTraffic = ["stable", "deploying", "preview", "rollback"].includes(phase);
  const greenHasTraffic = ["promoted", "scaled-down"].includes(phase);
  const blueTrafficLabel = blueHasTraffic
    ? "← mi-app-active (tráfico prod)"
    : phase === "promoted"
      ? "draining... (30s)"
      : phase === "scaled-down"
        ? "terminado"
        : "";
  const greenTrafficLabel = phase === "preview"
    ? "← mi-app-preview (testing)"
    : greenHasTraffic
      ? "← mi-app-active (tráfico prod)"
      : phase === "promoting"
        ? "⟳ switching..."
        : phase === "rollback"
          ? "terminado"
          : "";

  // Actions available per phase
  const actions: { label: string; color: string; onClick: () => void }[] = (() => {
    switch (phase) {
      case "stable":
        return [{ label: "Desplegar v2.0.0", color: GREEN, onClick: () => setPhase("deploying") }];
      case "deploying":
        return [{ label: "⟳ Pods creándose...", color: "#e5c07b", onClick: () => setPhase("preview") }];
      case "preview":
        return [
          { label: "Promote (enviar a prod)", color: GREEN, onClick: () => setPhase("promoting") },
          { label: "Abort (rollback)", color: "#e06c75", onClick: () => setPhase("rollback") },
        ];
      case "promoting":
        return [{ label: "⟳ Switching tráfico...", color: "#e5c07b", onClick: () => setPhase("promoted") }];
      case "promoted":
        return [{ label: "Scale down Blue", color: "#7e8590", onClick: () => setPhase("scaled-down") }];
      case "scaled-down":
        return [{ label: "Reiniciar demo", color: BLUE, onClick: () => setPhase("stable") }];
      case "rollback":
        return [{ label: "Reiniciar demo", color: BLUE, onClick: () => setPhase("stable") }];
    }
  })();

  return (
    <DemoWrapper
      title="Blue-Green Deployment"
      description="Simula un despliegue Blue-Green con Argo Rollouts paso a paso"
    >
      <style>{`
        @keyframes bgPulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes bgFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes bgTrafficPulse {
          0%, 100% { box-shadow: 0 0 4px currentColor; }
          50% { box-shadow: 0 0 12px currentColor; }
        }
        @keyframes bgLineIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Environments */}
        <div style={{ display: "flex", gap: 12 }}>
          <EnvPanel
            label="Blue (v1.0.0)"
            version="ghcr.io/org/app:v1.0.0"
            color={BLUE}
            bg={BLUE_BG}
            pods={bluePods}
            trafficLabel={blueTrafficLabel}
            hasTraffic={blueHasTraffic}
            visible={phase !== "scaled-down" || logLines < 5}
          />
          <EnvPanel
            label="Green (v2.0.0)"
            version="ghcr.io/org/app:v2.0.0"
            color={GREEN}
            bg={GREEN_BG}
            pods={greenPods}
            trafficLabel={greenTrafficLabel}
            hasTraffic={greenHasTraffic}
            visible={greenPods.length > 0}
          />
        </div>

        {/* Terminal + Explanation */}
        <div style={{ display: "flex", gap: 12 }}>
          {/* Terminal */}
          <div
            style={{
              flex: 1,
              background: "#252830",
              borderRadius: 10,
              overflow: "hidden",
              minHeight: 180,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 14px",
                borderBottom: "1px solid #1e2028",
                gap: 5,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e06c75" }} />
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e5c07b" }} />
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#98c379" }} />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: "#636a76",
                  marginLeft: 6,
                }}
              >
                argo-rollouts
              </span>
            </div>
            <div style={{ padding: "10px 14px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.7 }}>
              {logs.map((log, i) => {
                if (i >= logLines) return null;
                if (log.color === "transparent") return <div key={i} style={{ height: 6 }} />;
                return (
                  <div key={i} style={{ color: log.color, animation: "bgLineIn 0.15s ease" }}>
                    {log.text}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Explanation */}
          <div
            style={{
              flex: 1,
              background: "#1e2028",
              borderRadius: 10,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                fontWeight: 600,
                color:
                  phase === "rollback"
                    ? "#e06c75"
                    : greenHasTraffic || phase === "scaled-down"
                      ? GREEN
                      : BLUE,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {explanation.title}
            </span>
            <p style={{ color: "#9da5b4", fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
              {explanation.text}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          {actions.map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={action.onClick}
              style={{
                background: `${action.color}20`,
                color: action.color,
                border: `1px solid ${action.color}44`,
                padding: "7px 20px",
                borderRadius: 6,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </DemoWrapper>
  );
}
