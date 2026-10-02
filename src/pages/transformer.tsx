import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function TransformerPage() {
  return (
    <Layout
      title="Transformer"
      description="Un Transformer de bolsillo, como en «Attention Is All You Need»: traduce del español al inglés, entrénalo en el navegador y mira a qué palabras atiende."
    >
      <main>
        <BrowserOnly fallback={<div style={{ padding: 32 }}>Cargando el Transformer…</div>}>
          {() => {
            const Transformer = require('@site/src/components/ai/transformer/Transformer').default;
            return <Transformer />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
