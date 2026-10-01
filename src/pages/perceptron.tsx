import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function PerceptronPage() {
  return (
    <Layout
      title="Perceptrón"
      description="Una réplica interactiva del Perceptrón Mark I de Rosenblatt: gira los pesos a mano, mira el voltímetro y entrena la máquina para reconocer dígitos y letras."
    >
      <main>
        <BrowserOnly fallback={<div style={{ padding: 32 }}>Cargando el perceptrón…</div>}>
          {() => {
            const Perceptron = require('@site/src/components/ai/perceptron/Perceptron').default;
            return <Perceptron />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
