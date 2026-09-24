import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function AwsPlaygroundPage() {
  return (
    <Layout
      title="AWS CLI playground"
      description="Practica la CLI de AWS (STS, IAM, S3 y EC2) en una cuenta simulada que vive en tu navegador: sin credenciales y sin costes."
    >
      <main>
        <BrowserOnly fallback={<div style={{ padding: 32 }}>Cargando el playground…</div>}>
          {() => {
            const AwsPlayground = require('@site/src/components/playground/aws/AwsPlayground').default;
            return <AwsPlayground />;
          }}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
