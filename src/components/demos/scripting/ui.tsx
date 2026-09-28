// Shared look for the Scripting demos (same palette as the Terraform demos).
import React from 'react';

export const FONT = "'JetBrains Mono', 'Fira Code', monospace";
export const C = {
  bg: '#1e2029',
  panel: '#2a2d37',
  border: '#3a3d47',
  text: '#abb2bf',
  dim: '#7f848e',
  green: '#98c379',
  red: '#e06c75',
  yellow: '#e5c07b',
  blue: '#61afef',
  purple: '#c678dd',
  cyan: '#56b6c2',
};

export const box: React.CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 12,
  color: C.text,
  fontFamily: FONT,
  fontSize: 13,
};

export const input: React.CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontFamily: FONT,
  fontSize: 13,
  padding: '6px 8px',
  width: '100%',
  boxSizing: 'border-box',
};

export const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  opacity: 0.8,
  marginBottom: 4,
  display: 'block',
};

export function Chip({ active, onClick, children, color = C.blue }: { active?: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? color : 'transparent',
        color: active ? '#1e2029' : color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        fontFamily: FONT,
        cursor: 'pointer',
        margin: '0 6px 6px 0',
      }}
    >
      {children}
    </button>
  );
}
