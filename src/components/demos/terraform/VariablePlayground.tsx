// src/components/demos/terraform/VariablePlayground.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';
import { parse, validate, evaluate } from './hclParser';
import type { Diagnostic, EvalResult } from './hclParser';

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

// ── Presets ──
const PRESETS: Record<string, { label: string; code: string }> = {
  basic: {
    label: 'Tipos básicos',
    code: `variable "nombre" {
  type    = string
  default = "servidor-web"
}

variable "puerto" {
  type    = number
  default = 8080
}

variable "activo" {
  type    = bool
  default = true
}

resource "local_file" "config" {
  filename = "/tmp/config.txt"
  content  = var.nombre
}

output "resumen" {
  value = "Servidor: \${var.nombre}, puerto: \${var.puerto}"
}`,
  },
  lists: {
    label: 'Listas y maps',
    code: `variable "entornos" {
  type    = list(string)
  default = ["dev", "staging", "prod"]
}

variable "puertos" {
  type    = map(number)
  default = {
    http  = 80
    https = 443
    ssh   = 22
  }
}

resource "local_file" "lista" {
  filename = "/tmp/entornos.txt"
  content  = var.entornos
}

output "puertos_config" {
  value = var.puertos
}`,
  },
  object: {
    label: 'Object',
    code: `variable "app" {
  type = object({
    name = string,
    port = number,
    debug = bool
  })
  default = {
    name  = "mi-api"
    port  = 3000
    debug = false
  }
}

resource "local_file" "app_config" {
  filename = "/tmp/app.json"
  content  = var.app
}

output "app_name" {
  value = var.app
}`,
  },
  interpolation: {
    label: 'Interpolación',
    code: `variable "proyecto" {
  type    = string
  default = "terraform-lab"
}

variable "entorno" {
  type    = string
  default = "produccion"
}

locals {
  nombre_completo = "\${var.proyecto}-\${var.entorno}"
  bucket_name     = "s3-\${var.proyecto}-\${var.entorno}-assets"
}

resource "local_file" "readme" {
  filename = "/tmp/\${var.proyecto}/README.md"
  content  = "Proyecto: \${local.nombre_completo}"
}

output "bucket" {
  value = local.bucket_name
}`,
  },
  error: {
    label: 'Error de tipo',
    code: `variable "puerto" {
  type    = number
  default = "no-soy-un-numero"
}

variable "tags" {
  type = map(string)
  default = {
    Name = "web"
    Port = 8080
  }
}

resource "local_file" "broken" {
  filename = var.indefinida
  content  = "test"
}`,
  },
  empty: {
    label: 'Vacío',
    code: '',
  },
};

// ── Styles ──
const colors = {
  bg: '#282c34',
  bgLight: '#2c313a',
  text: '#abb2bf',
  green: '#98c379',
  red: '#e06c75',
  yellow: '#e5c07b',
  blue: '#61afef',
  purple: '#c678dd',
  cyan: '#56b6c2',
  gutter: '#4b5263',
  border: '#3e4451',
  selection: '#3e4451',
};

const panelStyle: React.CSSProperties = {
  background: colors.bg,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  overflow: 'hidden',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px',
  fontFamily: FONT,
  fontSize: '0.75rem',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  background: active ? colors.bg : 'transparent',
  color: active ? 'var(--ifm-color-primary)' : colors.gutter,
  borderBottom: active ? '2px solid var(--ifm-color-primary)' : '2px solid transparent',
  transition: 'all 0.15s ease',
});

export default function VariablePlayground() {
  const [code, setCode] = useState(PRESETS.basic.code);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [activeTab, setActiveTab] = useState<'resolved' | 'plan'>('plan');
  const [visiblePlanLines, setVisiblePlanLines] = useState<string[]>([]);
  const [planAnimating, setPlanAnimating] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced parse + validate + evaluate
  const processCode = useCallback((source: string) => {
    const { blocks, errors: parseErrors } = parse(source);
    const validationErrors = parseErrors.length === 0 ? validate(blocks) : [];
    const allDiagnostics = [...parseErrors, ...validationErrors];
    setDiagnostics(allDiagnostics);

    const hasErrors = allDiagnostics.some(d => d.severity === 'error');
    if (!hasErrors && blocks.length > 0) {
      const result = evaluate(blocks);
      setEvalResult(result);
      // Trigger plan animation
      setPlanAnimating(true);
      setVisiblePlanLines([]);
    } else {
      setEvalResult(null);
      setVisiblePlanLines([]);
      setPlanAnimating(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => processCode(code), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, processCode]);

  // Plan line-by-line animation
  useEffect(() => {
    if (!planAnimating || !evalResult) return;
    const allLines = evalResult.planText.split('\n');
    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= allLines.length) {
        clearInterval(interval);
        setPlanAnimating(false);
        return;
      }
      const line = allLines[idx] ?? '';
      idx++;
      setVisiblePlanLines(prev => [...prev, line]);
      if (planRef.current) planRef.current.scrollTop = planRef.current.scrollHeight;
    }, 60);
    return () => clearInterval(interval);
  }, [planAnimating, evalResult]);

  const handlePresetChange = (key: string) => {
    setCode(PRESETS[key].code);
  };

  const errorLines = new Set(diagnostics.map(d => d.line));
  const codeLines = code.split('\n');

  // Format resolved resources for display
  const resolvedText = evalResult ? evalResult.resolvedResources.map(res => {
    const attrs = Object.entries(res.attributes).map(([k, v]) => {
      const formatted = typeof v === 'string' ? `"${v}"` :
        typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      return `  ${k} = ${formatted}`;
    }).join('\n');
    return `resource "${res.type}" "${res.name}" {\n${attrs}\n}`;
  }).join('\n\n') + (Object.keys(evalResult.outputs).length > 0 ? '\n\n' + Object.entries(evalResult.outputs).map(([k, v]) => {
    const formatted = typeof v === 'string' ? `"${v}"` : JSON.stringify(v, null, 2);
    return `output "${k}" = ${formatted}`;
  }).join('\n') : '') : '';

  return (
    <DemoWrapper title="Playground de Variables" description="Define variables HCL y observa cómo se resuelven en recursos y plan">
      {/* Preset selector */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontFamily: FONT, fontSize: '0.72rem', color: colors.gutter, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Ejemplo:
        </span>
        <select
          onChange={e => handlePresetChange(e.target.value)}
          style={{
            fontFamily: FONT, fontSize: '0.8rem', padding: '4px 8px', borderRadius: 4,
            border: `1px solid ${colors.border}`, background: colors.bgLight, color: colors.text,
            cursor: 'pointer',
          }}
        >
          {Object.entries(PRESETS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Two-panel layout */}
      <div className="variable-playground-panels" style={{ display: 'flex', gap: '0.75rem', minHeight: 400 }}>
        {/* Left panel: Editor */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ ...panelStyle, flex: 1, display: 'flex', overflow: 'auto' }}>
            {/* Line numbers */}
            <div style={{
              padding: '12px 8px 12px 12px', fontFamily: FONT, fontSize: '0.8rem', lineHeight: '1.5',
              color: colors.gutter, textAlign: 'right', userSelect: 'none', minWidth: 36, flexShrink: 0,
              background: colors.bg, borderRight: `1px solid ${colors.border}`,
            }}>
              {codeLines.map((_, i) => (
                <div key={i} style={{ color: errorLines.has(i + 1) ? colors.red : colors.gutter }}>
                  {i + 1}
                </div>
              ))}
            </div>
            {/* Textarea */}
            <textarea
              ref={editorRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1, padding: '12px', fontFamily: FONT, fontSize: '0.8rem', lineHeight: '1.5',
                color: colors.text, background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', minHeight: 300, whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto',
              }}
            />
          </div>

          {/* Diagnostics panel */}
          {diagnostics.length > 0 && (
            <div style={{ ...panelStyle, padding: '8px 12px', maxHeight: 120, overflowY: 'auto' }}>
              {diagnostics.map((d, i) => (
                <div key={i} style={{
                  fontFamily: FONT, fontSize: '0.75rem', lineHeight: '1.6',
                  color: d.severity === 'error' ? colors.red : colors.yellow,
                  cursor: 'pointer',
                }} onClick={() => {
                  if (editorRef.current) {
                    const lines = code.split('\n');
                    let charIndex = 0;
                    for (let l = 0; l < d.line - 1 && l < lines.length; l++) charIndex += lines[l].length + 1;
                    editorRef.current.focus();
                    editorRef.current.setSelectionRange(charIndex, charIndex);
                  }
                }}>
                  {d.severity === 'error' ? '✗' : '⚠'} Línea {d.line}: {d.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: Output */}
        <div style={{ flex: 1, ...panelStyle, display: 'flex', flexDirection: 'column' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}` }}>
            <button style={tabStyle(activeTab === 'resolved')} onClick={() => setActiveTab('resolved')}>Resuelto</button>
            <button style={tabStyle(activeTab === 'plan')} onClick={() => setActiveTab('plan')}>Plan</button>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px', fontFamily: FONT, fontSize: '0.78rem', lineHeight: '1.6' }}>
            {activeTab === 'resolved' && (
              <pre style={{ margin: 0, color: colors.text, whiteSpace: 'pre-wrap' }}>
                {evalResult ? resolvedText : (
                  <span style={{ color: colors.gutter, fontStyle: 'italic' }}>
                    {diagnostics.some(d => d.severity === 'error')
                      ? 'Corrige los errores para ver el resultado'
                      : 'Escribe código HCL para comenzar'}
                  </span>
                )}
              </pre>
            )}

            {activeTab === 'plan' && (
              <div ref={planRef} style={{ margin: 0 }}>
                {visiblePlanLines.length > 0 ? visiblePlanLines.map((line, i) => {
                  const l = (line ?? '');
                  return (<div key={i} style={{
                    color: l.trim().startsWith('+') ? colors.green :
                           l.trim().startsWith('#') ? colors.gutter :
                           l.startsWith('Plan:') ? colors.cyan :
                           l.startsWith('Outputs:') ? colors.blue :
                           colors.text,
                    whiteSpace: 'pre',
                  }}>
                    {l || '\u00A0'}
                  </div>);
                }) : (
                  <span style={{ color: colors.gutter, fontStyle: 'italic' }}>
                    {diagnostics.some(d => d.severity === 'error')
                      ? 'Corrige los errores para ver el plan'
                      : 'Escribe código HCL para comenzar'}
                  </span>
                )}
                {planAnimating && (
                  <span style={{ color: 'var(--ifm-color-primary)', animation: 'planPulse 0.8s infinite' }}>▋</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes planPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @media (max-width: 768px) {
          .variable-playground-panels {
            flex-direction: column !important;
          }
          .variable-playground-panels > div:first-child {
            flex: 1 !important;
          }
        }
      `}</style>
    </DemoWrapper>
  );
}
