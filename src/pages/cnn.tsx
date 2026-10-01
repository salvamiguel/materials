import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function CnnPage() {
  return (
    <Layout
      title="Red convolucional"
      description="Una red convolucional interactiva tipo LeNet: diseña filtros con mandos, mira los mapas de activación, recorre la convolución paso a paso y entrénala con retropropagación."
    >
      <main>
        <BrowserOnly fallback={<div style={{ padding: 32 }}>Cargando la red convolucional…</div>}>
          {() => {
            const Cnn = require('@site/src/components/ai/cnn/Cnn').default;
            return <Cnn />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
