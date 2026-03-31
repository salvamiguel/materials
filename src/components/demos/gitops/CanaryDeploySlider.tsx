import React, { useState, useEffect, useRef } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

// ─── Types ───────────────────────────────────────────────

interface CanaryStep {
  weight: number;
  duration: string;
  description: string;
}

type Phase =
  | "stable"
  | "step-0"
  | "step-1"
  | "step-2"
  | "step-3"
  | "complete"
  | "rollback";

interface LogEntry {
  text: string;
  color: string;
}

// ─── Constants ───────────────────────────────────────────

const STABLE_COLOR = "#61afef";
const CANARY_COLOR = "#e5c07b";
const TOTAL_PODS = 10;

const CANARY_STEPS: CanaryStep[] = [
  { weight: 10, duration: "5 min", description: "Monitorizar error rate y latencia" },
  { weight: 25, duration: "10 min", description: "Verificar métricas de negocio" },
  { weight: 50, duration: "10 min", description: "Confirmar comportamiento con carga real" },
  { weight: 100, duration: "—", description: "Rollout completado" },
];

function stepIndex(phase: Phase): number {
  if (phase.startsWith("step-")) return parseInt(phase.split("-")[1]);
  return -1;
}

function canaryWeight(phase: Phase): number {
  const idx = stepIndex(phase);
  if (idx >= 0) return CANARY_STEPS[idx].weight;
  if (phase === "complete") return 100;
  return 0;
}

function canaryPodCount(phase: Phase): number {
  const w = canaryWeight(phase);
  if (w === 0) return 0;
  return Math.max(1, Math.round((w / 100) * TOTAL_PODS));
}

// ─── Logs ────────────────────────────────────────────────

function getLogs(phase: Phase): LogEntry[] {
  const idx = stepIndex(phase);
  switch (phase) {
    case "stable":
      return [
        { text: "$ kubectl argo rollouts get rollout mi-app", color: "#98c379" },
        { text: "Name:            mi-app", color: "#7e8590" },
        { text: "Status:          ✓ Healthy", color: "#4affa0" },
        { text: "Strategy:        Canary", color: "#7e8590" },
        { text: "Images:          ghcr.io/org/app:v1.0.0 (stable)", color: STABLE_COLOR },
        { text: "Replicas:        10/10", color: "#7e8590" },
        { text: "", color: "transparent" },
        { text: "→ Producción estable con v1.0.0", color: "#4affa0" },
      ];
    case "step-0":
    case "step-1":
    case "step-2":
      return [
        ...(idx === 0
          ? [
              { text: "$ kubectl argo rollouts set image mi-app app=ghcr.io/org/app:v2.0.0", color: "#98c379" },
              { text: 'rollout "mi-app" image updated', color: "#7e8590" },
              { text: "", color: "transparent" },
            ]
          : [
              { text: "$ kubectl argo rollouts promote mi-app", color: "#98c379" },
              { text: 'rollout "mi-app" promoted', color: "#7e8590" },
              { text: "", color: "transparent" },
            ]),
        { text: `Step ${idx + 1}/4: setWeight: ${CANARY_STEPS[idx].weight}`, color: CANARY_COLOR },
        { text: `  Canary:  ${canaryPodCount(phase)} pods  (${CANARY_STEPS[idx].weight}% tráfico)`, color: CANARY_COLOR },
        { text: `  Stable:  ${TOTAL_PODS - canaryPodCount(phase)} pods  (${100 - CANARY_STEPS[idx].weight}% tráfico)`, color: STABLE_COLOR },
        { text: "", color: "transparent" },
        { text: `⏸ Pausa: ${CANARY_STEPS[idx].duration}`, color: "#e5c07b" },
        { text: `  → ${CANARY_STEPS[idx].description}`, color: "#7e8590" },
        { text: "", color: "transparent" },
        { text: "AnalysisRun: success-rate  Running ⟳", color: "#56b6c2" },
        { text: "  error_rate:   0.12%  (threshold: < 1%)", color: "#4affa0" },
        { text: "  p99_latency:  89ms   (threshold: < 200ms)", color: "#4affa0" },
      ];
    case "step-3":
      return [
        { text: "$ kubectl argo rollouts promote mi-app", color: "#98c379" },
        { text: 'rollout "mi-app" promoted', color: "#7e8590" },
        { text: "", color: "transparent" },
        { text: "Step 4/4: setWeight: 100", color: CANARY_COLOR },
        { text: `  Canary:  ${TOTAL_PODS} pods  (100% tráfico)`, color: CANARY_COLOR },
        { text: "  Stable:  0 pods  (0% tráfico)", color: "#636a76" },
        { text: "", color: "transparent" },
        { text: "⟳ Finalizando rollout...", color: "#e5c07b" },
      ];
    case "complete":
      return [
        { text: "AnalysisRun: success-rate  ✓ Successful", color: "#4affa0" },
        { text: "", color: "transparent" },
        { text: "Status:          ✓ Healthy", color: "#4affa0" },
        { text: "Images:          ghcr.io/org/app:v2.0.0 (stable)", color: "#98c379" },
        { text: "Replicas:        10/10", color: "#7e8590" },
        { text: "", color: "transparent" },
        { text: "✓ Canary completado. v2.0.0 es la nueva versión estable.", color: "#4affa0" },
      ];
    case "rollback":
      return [
        { text: "$ kubectl argo rollouts abort mi-app", color: "#98c379" },
        { text: 'rollout "mi-app" aborted', color: "#e06c75" },
        { text: "", color: "transparent" },
        { text: "AnalysisRun: success-rate  ✗ Failed", color: "#e06c75" },
        { text: "  error_rate:   4.7%  (threshold: < 1%)  ← EXCEEDED", color: "#e06c75" },
        { text: "", color: "transparent" },
        { text: "⟳ Scaling down canary pods...", color: "#e5c07b" },
        { text: "  Canary: 0 pods  (0% tráfico)", color: "#636a76" },
        { text: "  Stable: 10 pods (100% tráfico)", color: STABLE_COLOR },
        { text: "", color: "transparent" },
        { text: "Status:          ✓ Degraded → Healthy", color: "#4affa0" },
        { text: "Images:          ghcr.io/org/app:v1.0.0 (stable)", color: STABLE_COLOR },
        { text: "", color: "transparent" },
        { text: "✓ Rollback automático completado. Solo v1.0.0 en producción.", color: "#4affa0" },
      ];
  }
}

function getExplanation(phase: Phase): { title: string; text: string } {
  const idx = stepIndex(phase);
  switch (phase) {
    case "stable":
      return {
        title: "Producción estable",
        text: "Los 10 pods ejecutan v1.0.0. Todo el tráfico va a la versión estable a través del Service mi-app-stable.",
      };
    case "step-0":
      return {
        title: `Canary: ${CANARY_STEPS[0].weight}% tráfico`,
        text: "Argo Rollouts crea los primeros pods canary con v2.0.0 y les redirige el 10% del tráfico. El AnalysisRun monitoriza error rate y latencia en tiempo real.",
      };
    case "step-1":
      return {
        title: `Canary: ${CANARY_STEPS[1].weight}% tráfico`,
        text: "Las métricas del paso anterior fueron correctas. Se incrementa al 25% del tráfico. Se verifican métricas de negocio (conversiones, latencia p99).",
      };
    case "step-2":
      return {
        title: `Canary: ${CANARY_STEPS[2].weight}% tráfico`,
        text: "Mitad del tráfico va a v2.0.0. Este es el punto crítico: si las métricas se mantienen sanas con 50% de carga real, el rollout es seguro.",
      };
    case "step-3":
      return {
        title: "Canary: 100% tráfico",
        text: "Todo el tráfico va a v2.0.0. Los pods de v1.0.0 se eliminan. El rollout está a punto de completarse.",
      };
    case "complete":
      return {
        title: "Despliegue completado",
        text: "Todos los pods ejecutan v2.0.0. La versión canary se ha convertido en la nueva estable. El AnalysisRun confirma que las métricas estuvieron dentro de los umbrales en cada paso.",
      };
    case "rollback":
      return {
        title: "Rollback automático",
        text: "El AnalysisRun detectó que el error rate superó el umbral (4.7% > 1%). Argo Rollouts abortó automáticamente el canary, eliminó los pods v2.0.0 y devolvió el 100% del tráfico a v1.0.0. Sin intervención humana.",
      };
  }
}

// ─── Traffic Bar ─────────────────────────────────────────

function TrafficBar({ weight }: { weight: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: STABLE_COLOR }}>
          Stable {100 - weight}%
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: CANARY_COLOR }}>
          Canary {weight}%
        </span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: STABLE_COLOR + "33",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            height: "100%",
            width: `${weight}%`,
            background: CANARY_COLOR,
            borderRadius: 4,
            transition: "width 0.8s ease",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${100 - weight}%`,
            background: STABLE_COLOR,
            borderRadius: 4,
            transition: "width 0.8s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── Pod Grid ────────────────────────────────────────────

function PodGrid({ phase }: { phase: Phase }) {
  const cCount = canaryPodCount(phase);
  const sCount = TOTAL_PODS - cCount;

  const pods: { color: string; label: string; active: boolean }[] = [];
  for (let i = 0; i < sCount; i++) {
    pods.push({
      color: STABLE_COLOR,
      label: `s${i + 1}`,
      active: phase !== "rollback" || true,
    });
  }
  for (let i = 0; i < cCount; i++) {
    pods.push({
      color: CANARY_COLOR,
      label: `c${i + 1}`,
      active: phase !== "rollback",
    });
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
      {pods.map((pod, i) => (
        <div
          key={i}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            background: pod.active ? `${pod.color}20` : "transparent",
            border: `2px solid ${pod.active ? pod.color : "#2a2d37"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: pod.active ? pod.color : "#636a76",
            transition: "all 0.5s ease",
            opacity: pod.active ? 1 : 0.3,
          }}
        >
          {pod.label}
        </div>
      ))}
    </div>
  );
}

// ─── Step Progress ───────────────────────────────────────

function StepProgress({ phase }: { phase: Phase }) {
  const currentIdx = stepIndex(phase);
  const isComplete = phase === "complete";
  const isRollback = phase === "rollback";

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {CANARY_STEPS.map((step, i) => {
        const done = isComplete || currentIdx > i;
        const active = currentIdx === i;
        const failed = isRollback;

        return (
          <React.Fragment key={i}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                flex: 1,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: 4,
                  borderRadius: 2,
                  background: done
                    ? "#4affa0"
                    : active
                      ? failed
                        ? "#e06c75"
                        : CANARY_COLOR
                      : "#2a2d37",
                  transition: "background 0.5s ease",
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  color: done ? "#4affa0" : active ? (failed ? "#e06c75" : CANARY_COLOR) : "#636a76",
                  transition: "color 0.3s",
                }}
              >
                {step.weight}%
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export default function CanaryDeploySlider() {
  const [phase, setPhase] = useState<Phase>("stable");
  const [logLines, setLogLines] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logs = getLogs(phase);
  const explanation = getExplanation(phase);
  const weight = canaryWeight(phase);

  // Animate log lines
  useEffect(() => {
    setLogLines(0);
    let line = 0;
    const tick = () => {
      line++;
      setLogLines(line);
      if (line < logs.length) {
        timerRef.current = setTimeout(tick, logs[line]?.color === "transparent" ? 50 : 100);
      }
    };
    timerRef.current = setTimeout(tick, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase]);

  // Actions
  const actions: { label: string; color: string; onClick: () => void }[] = (() => {
    switch (phase) {
      case "stable":
        return [{ label: "Desplegar v2.0.0 (Canary)", color: CANARY_COLOR, onClick: () => setPhase("step-0") }];
      case "step-0":
        return [
          { label: "Promote → 25%", color: CANARY_COLOR, onClick: () => setPhase("step-1") },
          { label: "Abort (rollback)", color: "#e06c75", onClick: () => setPhase("rollback") },
        ];
      case "step-1":
        return [
          { label: "Promote → 50%", color: CANARY_COLOR, onClick: () => setPhase("step-2") },
          { label: "Abort (rollback)", color: "#e06c75", onClick: () => setPhase("rollback") },
        ];
      case "step-2":
        return [
          { label: "Promote → 100%", color: CANARY_COLOR, onClick: () => setPhase("step-3") },
          { label: "Abort (rollback)", color: "#e06c75", onClick: () => setPhase("rollback") },
        ];
      case "step-3":
        return [{ label: "⟳ Finalizando...", color: "#e5c07b", onClick: () => setPhase("complete") }];
      case "complete":
        return [{ label: "Reiniciar demo", color: STABLE_COLOR, onClick: () => setPhase("stable") }];
      case "rollback":
        return [{ label: "Reiniciar demo", color: STABLE_COLOR, onClick: () => setPhase("stable") }];
    }
  })();

  return (
    <DemoWrapper
      title="Canary Deployment"
      description="Simula un despliegue canary progresivo con Argo Rollouts"
    >
      <style>{`
        @keyframes canaryFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Step Progress */}
        <StepProgress phase={phase} />

        {/* Traffic Bar */}
        <TrafficBar weight={weight} />

        {/* Pod Grid */}
        <div
          style={{
            background: "#1e2028",
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#636a76", textTransform: "uppercase", letterSpacing: 1 }}>
              Pods ({TOTAL_PODS} réplicas)
            </span>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: STABLE_COLOR }}>
                ■ v1.0.0
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: CANARY_COLOR }}>
                ■ v2.0.0
              </span>
            </div>
          </div>
          <PodGrid phase={phase} />
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
              minHeight: 200,
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
                  <div key={i} style={{ color: log.color, animation: "canaryFadeIn 0.15s ease" }}>
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
                color: phase === "rollback" ? "#e06c75" : phase === "complete" ? "#4affa0" : CANARY_COLOR,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {explanation.title}
            </span>
            <p style={{ color: "#9da5b4", fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
              {explanation.text}
            </p>
            {phase !== "stable" && phase !== "complete" && phase !== "rollback" && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "#252830",
                  borderRadius: 6,
                  borderLeft: `3px solid #56b6c2`,
                  fontSize: 11,
                  color: "#7e8590",
                  lineHeight: 1.5,
                  fontStyle: "italic",
                  marginTop: 4,
                }}
              >
                AnalysisRun monitoriza métricas en tiempo real. Si el error rate supera el 1% o la latencia p99 supera 200ms, Argo Rollouts ejecuta rollback automático.
              </div>
            )}
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
