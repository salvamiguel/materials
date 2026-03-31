import React, { useState, useEffect, useRef } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

// ─── Types ───────────────────────────────────────────────

type Model = "push" | "pull";
type Scenario = "deploy" | "drift" | "credentials" | "rollback";

interface LogEntry {
  text: string;
  color: string;
}

interface ScenarioData {
  label: string;
  icon: string;
  push: { logs: LogEntry[]; outcome: string; outcomeColor: string };
  pull: { logs: LogEntry[]; outcome: string; outcomeColor: string };
}

// ─── Colors ──────────────────────────────────────────────

const PUSH_COLOR = "#e5c07b";
const PULL_COLOR = "#56b6c2";
const DANGER = "#e06c75";
const SUCCESS = "#4affa0";

// ─── Scenarios ───────────────────────────────────────────

const SCENARIOS: Record<Scenario, ScenarioData> = {
  deploy: {
    label: "Despliegue",
    icon: "🚀",
    push: {
      logs: [
        { text: "$ git push origin main", color: "#98c379" },
        { text: "→ CI pipeline triggered", color: "#7e8590" },
        { text: "✓ docker build + push", color: SUCCESS },
        { text: "", color: "transparent" },
        { text: "$ kubectl set image deployment/app ...", color: "#98c379" },
        { text: "→ CI conecta al clúster con KUBECONFIG", color: PUSH_COLOR },
        { text: "→ kubectl apply ejecutado desde fuera", color: PUSH_COLOR },
        { text: "✓ deployment rolled out", color: SUCCESS },
      ],
      outcome: "El CI ejecuta kubectl directamente en el clúster usando credenciales externas. Funciona, pero las credenciales viven fuera del clúster.",
      outcomeColor: PUSH_COLOR,
    },
    pull: {
      logs: [
        { text: "$ git push origin main", color: "#98c379" },
        { text: "→ CI pipeline triggered", color: "#7e8590" },
        { text: "✓ docker build + push", color: SUCCESS },
        { text: "→ CI actualiza image tag en config repo", color: "#7e8590" },
        { text: "", color: "transparent" },
        { text: "⟳ ArgoCD polling config repo...", color: PULL_COLOR },
        { text: "→ Diff detectado: nueva imagen", color: PULL_COLOR },
        { text: "→ kubectl apply desde dentro del clúster", color: PULL_COLOR },
        { text: "✓ Sync completado — Healthy", color: SUCCESS },
      ],
      outcome: "ArgoCD detecta el cambio en Git y aplica desde dentro del clúster. El CI nunca toca Kubernetes. Las credenciales nunca salen del clúster.",
      outcomeColor: PULL_COLOR,
    },
  },
  drift: {
    label: "Drift",
    icon: "⚠️",
    push: {
      logs: [
        { text: "# Un operador modifica producción manualmente:", color: "#636a76" },
        { text: "$ kubectl edit deployment/app", color: "#98c379" },
        { text: "→ replicas: 3 → 1", color: PUSH_COLOR },
        { text: "→ Cambio aplicado directamente en el clúster", color: PUSH_COLOR },
        { text: "", color: "transparent" },
        { text: "# Pasan los días...", color: "#636a76" },
        { text: "", color: "transparent" },
        { text: "⚠ Git dice replicas: 3", color: DANGER },
        { text: "⚠ Clúster tiene replicas: 1", color: DANGER },
        { text: "⚠ Nadie lo sabe — no hay detección", color: DANGER },
      ],
      outcome: "El clúster diverge de Git sin que nadie lo detecte. El próximo despliegue puede sobrescribir cambios manuales o producir comportamiento inesperado.",
      outcomeColor: DANGER,
    },
    pull: {
      logs: [
        { text: "# Un operador modifica producción manualmente:", color: "#636a76" },
        { text: "$ kubectl edit deployment/app", color: "#98c379" },
        { text: "→ replicas: 3 → 1", color: PUSH_COLOR },
        { text: "", color: "transparent" },
        { text: "⟳ ArgoCD reconciliation cycle (3 min)...", color: PULL_COLOR },
        { text: "→ Drift detectado:", color: DANGER },
        { text: "  Git:     replicas: 3", color: PULL_COLOR },
        { text: "  Clúster: replicas: 1", color: DANGER },
        { text: "", color: "transparent" },
        { text: "→ selfHeal: true — corrigiendo...", color: PULL_COLOR },
        { text: "→ replicas: 1 → 3", color: SUCCESS },
        { text: "✓ Estado reconciliado con Git", color: SUCCESS },
      ],
      outcome: "ArgoCD detecta la divergencia en el siguiente ciclo de reconciliación y la corrige automáticamente. Git siempre gana.",
      outcomeColor: SUCCESS,
    },
  },
  credentials: {
    label: "Seguridad",
    icon: "🔐",
    push: {
      logs: [
        { text: "# Configuración de credenciales en CI:", color: "#636a76" },
        { text: "secrets.KUBECONFIG → almacenado en GitHub", color: PUSH_COLOR },
        { text: "", color: "transparent" },
        { text: "# Si el CI se ve comprometido:", color: "#636a76" },
        { text: "→ Atacante obtiene KUBECONFIG", color: DANGER },
        { text: "→ Acceso completo al clúster", color: DANGER },
        { text: "→ kubectl exec, delete, create...", color: DANGER },
        { text: "", color: "transparent" },
        { text: "⚠ Superficie de ataque: CI + clúster", color: DANGER },
      ],
      outcome: "Las credenciales de Kubernetes viven fuera del clúster, en el sistema de CI. Si un atacante compromete GitHub Actions, obtiene acceso directo a producción.",
      outcomeColor: DANGER,
    },
    pull: {
      logs: [
        { text: "# Configuración de credenciales:", color: "#636a76" },
        { text: "→ ArgoCD vive dentro del clúster", color: PULL_COLOR },
        { text: "→ Solo necesita token de lectura a Git", color: PULL_COLOR },
        { text: "", color: "transparent" },
        { text: "# Si el CI se ve comprometido:", color: "#636a76" },
        { text: "→ Atacante no tiene KUBECONFIG", color: SUCCESS },
        { text: "→ No puede ejecutar kubectl", color: SUCCESS },
        { text: "→ Solo puede modificar código (requiere PR)", color: "#7e8590" },
        { text: "", color: "transparent" },
        { text: "✓ Superficie de ataque: solo Git (con PR review)", color: SUCCESS },
      ],
      outcome: "Las credenciales de Kubernetes nunca salen del clúster. El agente solo necesita acceso de lectura a Git. Un CI comprometido no da acceso al clúster.",
      outcomeColor: SUCCESS,
    },
  },
  rollback: {
    label: "Rollback",
    icon: "⏪",
    push: {
      logs: [
        { text: "# Producción está rota, hay que volver atrás:", color: "#636a76" },
        { text: "", color: "transparent" },
        { text: "$ kubectl rollout undo deployment/app", color: "#98c379" },
        { text: "→ ¿A qué versión vuelve? No está claro", color: PUSH_COLOR },
        { text: "→ ¿El cambio queda reflejado en Git? No", color: DANGER },
        { text: "", color: "transparent" },
        { text: "# Alternativa: buscar en logs del CI...", color: "#636a76" },
        { text: "→ Encontrar el commit anterior", color: "#7e8590" },
        { text: "→ Re-ejecutar el pipeline manualmente", color: "#7e8590" },
        { text: "→ Esperar a que termine", color: "#7e8590" },
      ],
      outcome: "El rollback es manual, lento y no queda registrado en Git. El operador necesita saber qué versión estaba antes y ejecutar comandos manuales bajo presión.",
      outcomeColor: DANGER,
    },
    pull: {
      logs: [
        { text: "# Producción está rota, hay que volver atrás:", color: "#636a76" },
        { text: "", color: "transparent" },
        { text: "$ git revert HEAD", color: "#98c379" },
        { text: "$ git push origin main", color: "#98c379" },
        { text: "", color: "transparent" },
        { text: "⟳ ArgoCD detecta nuevo commit...", color: PULL_COLOR },
        { text: "→ Aplicando estado anterior", color: PULL_COLOR },
        { text: "✓ Rollback completado", color: SUCCESS },
        { text: "", color: "transparent" },
        { text: "→ El revert queda en el historial de Git", color: SUCCESS },
        { text: "→ Auditable: quién, cuándo, por qué", color: SUCCESS },
      ],
      outcome: "git revert + git push. ArgoCD aplica el estado anterior automáticamente. El rollback queda como un commit más en el historial — completamente auditable.",
      outcomeColor: SUCCESS,
    },
  },
};

const SCENARIO_ORDER: Scenario[] = ["deploy", "drift", "credentials", "rollback"];

// ─── Flow Diagram ────────────────────────────────────────

function FlowDiagram({ model }: { model: Model }) {
  const isPush = model === "push";
  const color = isPush ? PUSH_COLOR : PULL_COLOR;

  const nodes = isPush
    ? [
        { label: "Developer", icon: "👨‍💻", x: 0 },
        { label: "Git Repo", icon: "📦", x: 1 },
        { label: "CI System", icon: "⚙️", x: 2 },
        { label: "K8s Cluster", icon: "☸️", x: 3 },
      ]
    : [
        { label: "Developer", icon: "👨‍💻", x: 0 },
        { label: "Git Repo", icon: "📦", x: 1 },
        { label: "ArgoCD", icon: "🔄", x: 2 },
        { label: "K8s Cluster", icon: "☸️", x: 3 },
      ];

  const arrows = isPush
    ? [
        { from: 0, to: 1, label: "push", direction: "right" as const },
        { from: 1, to: 2, label: "webhook", direction: "right" as const },
        { from: 2, to: 3, label: "kubectl", direction: "right" as const, highlight: true },
      ]
    : [
        { from: 0, to: 1, label: "push", direction: "right" as const },
        { from: 2, to: 1, label: "polls", direction: "left" as const, highlight: true },
        { from: 2, to: 3, label: "apply", direction: "right" as const },
      ];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", flexWrap: "wrap" }}>
      {nodes.map((node, i) => (
        <React.Fragment key={i}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              minWidth: 64,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: `${color}15`,
                border: `2px solid ${color}55`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
              }}
            >
              {node.icon}
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#7e8590" }}>
              {node.label}
            </span>
          </div>
          {i < nodes.length - 1 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 50 }}>
              <span
                style={{
                  fontSize: 14,
                  color: arrows[i]?.highlight ? color : "#636a76",
                  fontWeight: arrows[i]?.highlight ? 700 : 400,
                }}
              >
                {arrows[i]?.direction === "left" ? "←" : "→"}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: "#636a76" }}>
                {arrows[i]?.label}
              </span>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export default function PullVsPushDiagram() {
  const [scenario, setScenario] = useState<Scenario>("deploy");
  const [model, setModel] = useState<Model>("push");
  const [logLines, setLogLines] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const data = SCENARIOS[scenario];
  const side = data[model];

  // Animate logs
  useEffect(() => {
    setLogLines(0);
    let line = 0;
    const tick = () => {
      line++;
      setLogLines(line);
      if (line < side.logs.length) {
        timerRef.current = setTimeout(tick, side.logs[line]?.color === "transparent" ? 50 : 100);
      }
    };
    timerRef.current = setTimeout(tick, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scenario, model]);

  return (
    <DemoWrapper
      title="Push vs Pull"
      description="Compara los dos modelos de despliegue en escenarios reales"
    >
      <style>{`
        @keyframes pvpFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Scenario selector */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SCENARIO_ORDER.map((s) => {
            const sc = SCENARIOS[s];
            const isActive = scenario === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScenario(s)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: `1.5px solid ${isActive ? "#4affa0" : "#2a2d37"}`,
                  background: isActive ? "#4affa015" : "transparent",
                  color: isActive ? "#4affa0" : "#7e8590",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: 13 }}>{sc.icon}</span>
                {sc.label}
              </button>
            );
          })}
        </div>

        {/* Model toggle */}
        <div
          style={{
            display: "flex",
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid #2a2d37",
            alignSelf: "center",
          }}
        >
          {(["push", "pull"] as Model[]).map((m) => {
            const isActive = model === m;
            const col = m === "push" ? PUSH_COLOR : PULL_COLOR;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                style={{
                  padding: "8px 24px",
                  border: "none",
                  background: isActive ? `${col}20` : "#1e2028",
                  color: isActive ? col : "#636a76",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 400,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  borderBottom: isActive ? `2px solid ${col}` : "2px solid transparent",
                }}
              >
                {m === "push" ? "Push (CI/CD)" : "Pull (GitOps)"}
              </button>
            );
          })}
        </div>

        {/* Flow diagram */}
        <div style={{ background: "#1e2028", borderRadius: 10, padding: "10px 12px" }}>
          <FlowDiagram model={model} />
        </div>

        {/* Terminal + Outcome */}
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
                {model === "push" ? "ci-pipeline" : "argocd"}
              </span>
            </div>
            <div style={{ padding: "10px 14px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.7 }}>
              {side.logs.map((log, i) => {
                if (i >= logLines) return null;
                if (log.color === "transparent") return <div key={i} style={{ height: 6 }} />;
                return (
                  <div key={i} style={{ color: log.color, animation: "pvpFadeIn 0.15s ease" }}>
                    {log.text}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Outcome */}
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
                color: model === "push" ? PUSH_COLOR : PULL_COLOR,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {data.icon} {data.label} — {model === "push" ? "Push" : "Pull"}
            </span>
            <p style={{ color: "#9da5b4", fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
              {side.outcome}
            </p>
            <div
              style={{
                marginTop: "auto",
                padding: "8px 12px",
                background: `${side.outcomeColor}10`,
                borderLeft: `3px solid ${side.outcomeColor}`,
                borderRadius: 6,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: side.outcomeColor,
                fontWeight: 600,
              }}
            >
              {side.outcomeColor === SUCCESS
                ? "✓ Resultado positivo"
                : side.outcomeColor === DANGER
                  ? "⚠ Resultado problemático"
                  : "→ Funcional, con limitaciones"}
            </div>
          </div>
        </div>
      </div>
    </DemoWrapper>
  );
}
