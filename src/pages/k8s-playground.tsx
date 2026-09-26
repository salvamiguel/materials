import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function K8sPlaygroundPage() {
  return (
    <Layout
      title="Kubernetes playground"
      description="Un clúster de Kubernetes simulado en tu navegador: kubectl, Helm y Kustomize con un diagrama en vivo de los recursos, sin instalar nada."
    >
      <main>
        <BrowserOnly fallback={<div style={{ padding: 32 }}>Cargando el playground…</div>}>
          {() => {
            const K8sPlayground = require('@site/src/components/playground/k8s/K8sPlayground').default;
            return <K8sPlayground />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
