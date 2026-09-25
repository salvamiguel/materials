import React, { type ReactNode } from 'react';
import PresentationController from '@site/src/components/presentation/PresentationController';
import '@site/src/components/presentation/presentation.css';

// Wraps the whole app (never unmounts): hosts the presentation-mode keys and controls.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PresentationController />
    </>
  );
}
