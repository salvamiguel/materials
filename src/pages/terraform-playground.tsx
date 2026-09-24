import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function TerraformPlaygroundPage() {
  return (
    <Layout
      title="Terraform playground"
      description="Escribe HCL y ejecuta init, plan, apply y destroy en tu navegador, con el esquema real del proveedor AWS y sin credenciales."
    >
      <main>
        <BrowserOnly fallback={<div style={{ padding: 32 }}>Cargando el playground…</div>}>
          {() => {
            const TerraformPlayground = require('@site/src/components/playground/terraform/TerraformPlayground').default;
            return <TerraformPlayground />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
