import React, { useState } from 'react';

interface DemoWrapperProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function DemoWrapper({ title, description, children, defaultOpen = false }: DemoWrapperProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="demo-wrapper">
      <div className="demo-header" onClick={() => setOpen(!open)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <span className="demo-badge">▶ Demo interactiva</span>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {open && (
        <div className="demo-body">
          {children}
        </div>
      )}
    </div>
  );
}
