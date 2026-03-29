import React from 'react';

interface DemoWrapperProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export default function DemoWrapper({ title, description, children }: DemoWrapperProps) {
  return (
    <div className="demo-wrapper">
      <div className="demo-header">
        <span className="demo-badge">▶ Demo interactiva</span>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="demo-body">
        {children}
      </div>
    </div>
  );
}
