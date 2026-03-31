import React, { useState, useEffect, useRef, useCallback } from "react";
import DemoWrapper from "../../shared/DemoWrapper";

// ─── Types ───────────────────────────────────────────────

interface TerminalLine {
  text: string;
  type: "command" | "output" | "success" | "diff-add" | "diff-del" | "header" | "blank";
}

interface Callout {
  text: string;
}

interface Step {
  id: string;
  label: string;
  color: string;
  icon: string;
  terminalTitle: string;
  lines: TerminalLine[];
  explanation: string;
  callout: Callout;
}

// ─── Data ────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    id: "developer",
    label: "Developer",
    color: "#61afef",
    icon: "👨‍💻",
    terminalTitle: "terminal",
    lines: [
      { text: "$ git add .", type: "command" },
      { text: '$ git commit -m "feat: add user auth"', type: "command" },
      { text: "[main a1b2c3d] feat: add user auth", type: "output" },
      { text: " 3 files changed, 42 insertions(+)", type: "output" },
      { text: "$ git push origin main", type: "command" },
      { text: "Enumerating objects: 8, done.", type: "output" },
      { text: "Compressing objects: 100% (5/5)", type: "output" },
      { text: "Writing objects: 100% (5/5), 1.2 KiB", type: "output" },
      { text: "To github.com:org/app.git", type: "output" },
      { text: "   f4e5d6a..a1b2c3d  main → main", type: "output" },
      { text: "", type: "blank" },
      { text: "✓ Push completado", type: "success" },
    ],
    explanation:
      "El desarrollador hace push de su código a la rama main. Este es el único punto de entrada al sistema GitOps. Todo cambio en producción empieza con un commit en Git.",
    callout: {
      text: 'El SHA del commit (a1b2c3d) será la etiqueta de la imagen Docker en pasos posteriores — trazabilidad completa desde código hasta producción.',
    },
  },
  {
    id: "git",
    label: "Git Repository",
    color: "#98c379",
    icon: "📦",
    terminalTitle: "github webhook",
    lines: [
      { text: "→ Webhook POST github.com/hooks", type: "header" },
      { text: "{", type: "output" },
      { text: '  "ref": "refs/heads/main",', type: "output" },
      { text: '  "after": "a1b2c3d",', type: "output" },
      { text: '  "repository": "org/app",', type: "output" },
      { text: '  "pusher": "developer"', type: "output" },
      { text: "}", type: "output" },
      { text: "", type: "blank" },
      { text: "✓ Webhook entregado → GitHub Actions", type: "success" },
    ],
    explanation:
      "GitHub detecta el push y envía un webhook al sistema de CI. El repositorio Git es la fuente única de verdad: si no está en Git, no existe en el sistema.",
    callout: {
      text: 'El campo "after" contiene el SHA del commit — GitHub Actions lo recibe como github.sha en el contexto del workflow.',
    },
  },
  {
    id: "ci",
    label: "CI Pipeline",
    color: "#e5c07b",
    icon: "⚙️",
    terminalTitle: "github-actions",
    lines: [
      { text: "⚙ GitHub Actions — CI Pipeline", type: "header" },
      { text: "✓ actions/checkout@v5", type: "success" },
      { text: "✓ actions/setup-node@v4 (v20.11.0)", type: "success" },
      { text: "$ npm ci", type: "command" },
      { text: "added 847 packages in 12s", type: "output" },
      { text: "$ npm test", type: "command" },
      { text: "PASS  src/auth.test.ts (23 tests)", type: "output" },
      { text: "PASS  src/api.test.ts  (19 tests)", type: "output" },
      { text: "Tests: 42 passed, 0 failed", type: "output" },
      { text: "", type: "blank" },
      { text: "✓ CI completado — todos los tests pasaron", type: "success" },
    ],
    explanation:
      "GitHub Actions ejecuta el pipeline CI: checkout del código, instalación de dependencias y ejecución de tests. Si algún test falla, el pipeline se detiene y no se despliega nada.",
    callout: {
      text: "Los tests son el gate de calidad. En GitOps, el CI nunca toca el clúster directamente — solo valida y construye artefactos.",
    },
  },
  {
    id: "registry",
    label: "Container Registry",
    color: "#c678dd",
    icon: "🐳",
    terminalTitle: "docker",
    lines: [
      { text: "$ docker build -t ghcr.io/org/app:a1b2c3d .", type: "command" },
      { text: "Step 1/5 : FROM node:20-alpine", type: "output" },
      { text: "Step 2/5 : COPY package*.json ./", type: "output" },
      { text: "Step 3/5 : RUN npm ci --production", type: "output" },
      { text: "Step 4/5 : COPY . .", type: "output" },
      { text: 'Step 5/5 : CMD ["node", "server.js"]', type: "output" },
      { text: "Successfully built 8f3a2b1c", type: "output" },
      { text: "", type: "blank" },
      { text: "$ docker push ghcr.io/org/app:a1b2c3d", type: "command" },
      { text: "a1b2c3d: digest: sha256:9e4f... size: 1789", type: "output" },
      { text: "", type: "blank" },
      { text: "✓ Imagen publicada en GitHub Container Registry", type: "success" },
    ],
    explanation:
      "Se construye la imagen Docker y se publica en el Container Registry con el SHA del commit como tag. Cada imagen es inmutable y trazable a un commit exacto.",
    callout: {
      text: "Nunca uses tags mutables como latest en producción. El tag SHA garantiza que puedas saber exactamente qué código corre en cada pod.",
    },
  },
  {
    id: "config",
    label: "Config Repo",
    color: "#d19a66",
    icon: "📄",
    terminalTitle: "terminal",
    lines: [
      { text: "$ git clone github.com:org/app-config.git", type: "command" },
      { text: "$ cd app-config/envs/production", type: "command" },
      {
        text: '$ yq -i \'.spec.template.spec.containers[0].image = "ghcr.io/org/app:a1b2c3d"\' deployment.yaml',
        type: "command",
      },
      { text: "", type: "blank" },
      { text: "$ git diff", type: "command" },
      { text: "-  image: ghcr.io/org/app:f4e5d6a", type: "diff-del" },
      { text: "+  image: ghcr.io/org/app:a1b2c3d", type: "diff-add" },
      { text: "", type: "blank" },
      { text: '$ git commit -m "deploy: app a1b2c3d"', type: "command" },
      { text: "$ git push origin main", type: "command" },
      { text: "", type: "blank" },
      { text: "✓ Manifiesto actualizado en config repo", type: "success" },
    ],
    explanation:
      "El CI actualiza el manifiesto de Kubernetes en el repositorio de configuración con el nuevo tag de imagen. Este es el único cambio que hace el CI en Git — no toca el clúster.",
    callout: {
      text: "La separación en dos repos (app repo + config repo) permite auditar cambios de infraestructura sin ruido de cambios de código, y dar permisos independientes a cada equipo.",
    },
  },
  {
    id: "argocd",
    label: "ArgoCD",
    color: "#56b6c2",
    icon: "🔄",
    terminalTitle: "argocd",
    lines: [
      { text: "⟳ ArgoCD polling config repo...", type: "header" },
      { text: '→ Nuevo commit detectado: "deploy: app a1b2c3d"', type: "output" },
      { text: "", type: "blank" },
      { text: "Comparando estado deseado vs estado actual...", type: "output" },
      { text: "", type: "blank" },
      { text: "DIFF encontrado:", type: "header" },
      { text: "  Deployment/app-server:", type: "output" },
      { text: "-   image: ghcr.io/org/app:f4e5d6a", type: "diff-del" },
      { text: "+   image: ghcr.io/org/app:a1b2c3d", type: "diff-add" },
      { text: "", type: "blank" },
      { text: "⟳ Sincronizando...", type: "header" },
      { text: "✓ Sync completado — estado: Healthy", type: "success" },
    ],
    explanation:
      "ArgoCD observa continuamente el config repo. Cuando detecta un nuevo commit, calcula el diff entre el estado deseado (Git) y el estado actual (clúster). Este modelo pull es clave: el clúster nunca expone endpoints al exterior.",
    callout: {
      text: "Si alguien modifica un recurso manualmente en el clúster (drift), ArgoCD lo detecta y lo corrige automáticamente en el siguiente ciclo de reconciliación.",
    },
  },
  {
    id: "k8s",
    label: "Kubernetes",
    color: "#e06c75",
    icon: "☸️",
    terminalTitle: "kubectl",
    lines: [
      { text: "$ kubectl rollout status deployment/app-server", type: "command" },
      { text: "Waiting for deployment rollout...", type: "output" },
      { text: "", type: "blank" },
      { text: "→ Pod app-server-7f8d9 (old) Terminating", type: "diff-del" },
      { text: "→ Pod app-server-a1b2c (new) ContainerCreating", type: "output" },
      { text: "→ Pod app-server-a1b2c (new) Running", type: "output" },
      { text: "→ Pod app-server-a1b2c (new) Ready 1/1", type: "diff-add" },
      { text: "", type: "blank" },
      { text: 'deployment "app-server" successfully rolled out', type: "output" },
      { text: "", type: "blank" },
      { text: "✓ Despliegue completado — 0 downtime", type: "success" },
    ],
    explanation:
      "Kubernetes ejecuta un rolling update: crea los nuevos pods con la imagen actualizada, espera a que estén healthy y termina los antiguos. Zero downtime garantizado.",
    callout: {
      text: "El rolling update es la estrategia por defecto de Kubernetes. Otras estrategias como Blue/Green o Canary se verán más adelante en este módulo.",
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────

function lineColor(type: TerminalLine["type"]): string {
  switch (type) {
    case "command":
      return "#98c379";
    case "output":
      return "#7e8590";
    case "success":
      return "#4affa0";
    case "diff-add":
      return "#98c379";
    case "diff-del":
      return "#e06c75";
    case "header":
      return "#abb2bf";
    case "blank":
      return "transparent";
  }
}

// ─── Pipeline Node ───────────────────────────────────────

function PipelineNode({
  step,
  index,
  activeStep,
  onClick,
}: {
  step: Step;
  index: number;
  activeStep: number;
  onClick: () => void;
}) {
  const isCompleted = index < activeStep;
  const isActive = index === activeStep;
  const isPending = index > activeStep;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderLeft: `3px solid ${isActive ? step.color : isCompleted ? step.color + "88" : "#2a2d37"}`,
        borderRadius: "0 8px 8px 0",
        background: isActive ? `${step.color}18` : "transparent",
        boxShadow: isActive ? `0 0 12px ${step.color}22` : "none",
        cursor: "pointer",
        transition: "all 0.3s ease",
        opacity: isPending ? 0.5 : 1,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: isCompleted ? "#4affa0" : isActive ? step.color : "#636a76",
          width: 16,
          textAlign: "center",
          fontFamily: "monospace",
          animation: isActive ? "gofPulse 1.5s ease-in-out infinite" : "none",
        }}
      >
        {isCompleted ? "✓" : isActive ? "●" : "○"}
      </span>
      <span
        style={{
          fontSize: 20,
          filter: isPending ? "grayscale(1) opacity(0.5)" : "none",
          transition: "filter 0.3s",
        }}
      >
        {step.icon}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5,
          color: isActive ? step.color : isCompleted ? "#abb2bf" : "#636a76",
          fontWeight: isActive ? 600 : 400,
          transition: "color 0.3s",
        }}
      >
        {step.label}
      </span>
    </div>
  );
}

// ─── Pipeline Connector ──────────────────────────────────

function Connector({ completed, color }: { completed: boolean; color: string }) {
  return (
    <div
      style={{
        width: 3,
        height: 12,
        marginLeft: 22,
        background: completed ? color + "66" : "#2a2d37",
        transition: "background 0.3s",
      }}
    />
  );
}

// ─── Terminal ────────────────────────────────────────────

function Terminal({
  step,
  visibleLines,
  visibleChars,
}: {
  step: Step;
  visibleLines: number;
  visibleChars: number;
}) {
  return (
    <div
      style={{
        background: "#252830",
        borderRadius: 10,
        overflow: "hidden",
        flex: 1,
        minHeight: 200,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 14px",
          borderBottom: "1px solid #1e2028",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", gap: 5 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#e06c75" }} />
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#e5c07b" }} />
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#98c379" }} />
        </div>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            color: "#636a76",
            marginLeft: 6,
          }}
        >
          {step.terminalTitle}
        </span>
      </div>

      {/* Lines */}
      <div style={{ padding: "12px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.7 }}>
        {step.lines.map((line, i) => {
          if (i > visibleLines) return null;
          if (i === visibleLines && line.type === "blank") return null;

          const isCurrentLine = i === visibleLines;
          const text =
            isCurrentLine && line.type === "command"
              ? line.text.slice(0, visibleChars)
              : isCurrentLine
                ? visibleChars > 0
                  ? line.text
                  : ""
                : line.text;

          if (!text && line.type === "blank" && i < visibleLines) {
            return <div key={i} style={{ height: 8 }} />;
          }
          if (!text) return null;

          const showCursor = isCurrentLine && line.type === "command" && visibleChars < line.text.length;

          return (
            <div
              key={i}
              style={{
                color: lineColor(line.type),
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                animation: i === visibleLines && line.type !== "command" ? "gofLineIn 0.15s ease" : "none",
              }}
            >
              {text}
              {showCursor && (
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 14,
                    background: "#4affa0",
                    marginLeft: 1,
                    verticalAlign: "text-bottom",
                    animation: "gofBlink 0.8s step-end infinite",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Explanation Panel ───────────────────────────────────

function ExplanationPanel({ step, visible }: { step: Step; visible: boolean }) {
  if (!visible) return null;
  return (
    <div style={{ animation: "gofPanelIn 0.4s ease" }}>
      <p style={{ color: "#9da5b4", fontSize: 13, lineHeight: 1.7, margin: "0 0 12px" }}>{step.explanation}</p>
      <div
        style={{
          padding: "10px 14px",
          background: "#1e2028",
          borderRadius: 8,
          borderLeft: `3px solid ${step.color}`,
          fontSize: 12,
          color: "#7e8590",
          lineHeight: 1.6,
          fontStyle: "italic",
        }}
      >
        {step.callout.text}
      </div>
    </div>
  );
}

// ─── Controls ────────────────────────────────────────────

function Controls({
  activeStep,
  isPlaying,
  onPrev,
  onNext,
  onTogglePlay,
}: {
  activeStep: number;
  isPlaying: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14 }}>
      <button
        type="button"
        onClick={onPrev}
        disabled={activeStep === 0}
        style={{
          background: "#2a2d37",
          color: activeStep === 0 ? "#444" : "#abb2bf",
          border: "none",
          padding: "6px 16px",
          borderRadius: 6,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          cursor: activeStep === 0 ? "default" : "pointer",
          transition: "all 0.15s",
        }}
      >
        ← Anterior
      </button>
      <button
        type="button"
        onClick={onTogglePlay}
        style={{
          background: isPlaying ? "#e06c7522" : "#4affa022",
          color: isPlaying ? "#e06c75" : "#4affa0",
          border: `1px solid ${isPlaying ? "#e06c7544" : "#4affa044"}`,
          padding: "6px 20px",
          borderRadius: 6,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          cursor: "pointer",
          fontWeight: 600,
          transition: "all 0.15s",
        }}
      >
        {isPlaying ? "⏸ Pausa" : "▶ Auto"}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={activeStep === STEPS.length - 1}
        style={{
          background: activeStep === STEPS.length - 1 ? "#2a2d37" : "#4affa0",
          color: activeStep === STEPS.length - 1 ? "#444" : "#0d0d0d",
          border: "none",
          padding: "6px 16px",
          borderRadius: 6,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          fontWeight: 600,
          cursor: activeStep === STEPS.length - 1 ? "default" : "pointer",
          transition: "all 0.15s",
        }}
      >
        Siguiente →
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

const TYPING_SPEED_CMD = 35;
const TYPING_SPEED_OUTPUT = 80;
const PAUSE_AFTER_LINE = 200;
const PAUSE_AFTER_STEP = 5000;

export default function GitOpsFlow() {
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [visibleChars, setVisibleChars] = useState(0);
  const [typingDone, setTypingDone] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);

  const step = STEPS[activeStep];

  // Keep ref in sync
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Typing engine
  const tick = useCallback(() => {
    setVisibleLines((prevLine) => {
      setVisibleChars((prevChar) => {
        const currentStep = STEPS[activeStep];
        const line = currentStep.lines[prevLine];

        if (!line) {
          // All lines done
          setTypingDone(true);
          return prevChar;
        }

        if (line.type === "blank") {
          // Skip blank lines instantly
          timerRef.current = setTimeout(tick, 50);
          setVisibleLines(prevLine + 1);
          return 0;
        }

        if (line.type === "command") {
          // Type character by character
          if (prevChar < line.text.length) {
            timerRef.current = setTimeout(tick, TYPING_SPEED_CMD);
            return prevChar + 1;
          }
          // Line complete
          if (prevLine + 1 < currentStep.lines.length) {
            timerRef.current = setTimeout(tick, PAUSE_AFTER_LINE);
            setVisibleLines(prevLine + 1);
            return 0;
          }
          setTypingDone(true);
          return prevChar;
        }

        // Non-command lines: show whole line at once
        if (prevChar === 0) {
          if (prevLine + 1 < currentStep.lines.length) {
            timerRef.current = setTimeout(tick, TYPING_SPEED_OUTPUT);
            setVisibleLines(prevLine + 1);
            return 0;
          }
          setTypingDone(true);
          return 1;
        }
        return prevChar;
      });
      return prevLine;
    });
  }, [activeStep]);

  // Start typing when step changes or play starts
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisibleLines(0);
    setVisibleChars(0);
    setTypingDone(false);
    timerRef.current = setTimeout(tick, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeStep, tick]);

  // Auto-advance when typing finishes and playing
  useEffect(() => {
    if (typingDone && playingRef.current) {
      if (activeStep < STEPS.length - 1) {
        const t = setTimeout(() => {
          if (playingRef.current) {
            setActiveStep((s) => s + 1);
          }
        }, PAUSE_AFTER_STEP);
        return () => clearTimeout(t);
      } else {
        setIsPlaying(false);
      }
    }
  }, [typingDone, activeStep]);

  const goTo = (idx: number) => {
    setIsPlaying(false);
    setActiveStep(idx);
  };

  const handlePrev = () => {
    if (activeStep > 0) goTo(activeStep - 1);
  };

  const handleNext = () => {
    if (activeStep < STEPS.length - 1) goTo(activeStep + 1);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      // If at the end, restart
      if (activeStep === STEPS.length - 1 && typingDone) {
        setActiveStep(0);
      } else if (typingDone) {
        // Advance to next step to start fresh
        setActiveStep((s) => Math.min(s + 1, STEPS.length - 1));
      }
    }
  };

  return (
    <DemoWrapper
      title="Flujo GitOps End-to-End"
      description="Simula el despliegue completo: desde git push hasta Kubernetes"
    >
      <style>{`
        @keyframes gofPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes gofPanelIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes gofLineIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes gofBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      <div style={{ display: "flex", gap: 16, alignItems: "stretch", minHeight: 340 }}>
        {/* Pipeline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            minWidth: 180,
            paddingTop: 4,
          }}
        >
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              <PipelineNode step={s} index={i} activeStep={activeStep} onClick={() => goTo(i)} />
              {i < STEPS.length - 1 && <Connector completed={i < activeStep} color={s.color} />}
            </React.Fragment>
          ))}
        </div>

        {/* Detail Panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Step title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>{step.icon}</span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                color: step.color,
                fontWeight: 600,
              }}
            >
              {step.label}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: "#636a76",
                marginLeft: "auto",
              }}
            >
              Paso {activeStep + 1} / {STEPS.length}
            </span>
          </div>

          {/* Terminal */}
          <Terminal step={step} visibleLines={visibleLines} visibleChars={visibleChars} />

          {/* Explanation */}
          <ExplanationPanel step={step} visible={typingDone} />
        </div>
      </div>

      {/* Controls */}
      <Controls
        activeStep={activeStep}
        isPlaying={isPlaying}
        onPrev={handlePrev}
        onNext={handleNext}
        onTogglePlay={handleTogglePlay}
      />
    </DemoWrapper>
  );
}
