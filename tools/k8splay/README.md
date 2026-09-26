# k8splay: kustomize y Helm para el playground de Kubernetes

El playground de Kubernetes (`/k8s-playground`) simula el clúster en TypeScript
(`src/components/playground/k8s/engine`). Lo único que no reimplementa es el
renderizado de manifiestos: `kubectl kustomize`/`apply -k` y `helm template`/
`install`/`upgrade` usan este motor en Go compilado a WebAssembly, que el
navegador descarga la primera vez que se necesita.

- `engine/kustomize.go`: la API real de kustomize (`sigs.k8s.io/kustomize/api/krusty`)
  sobre un sistema de ficheros en memoria. Activa `buildMetadata: [originAnnotations]`
  para saber de qué fichero sale cada objeto (el diagrama abre ese fichero al
  seleccionarlo) y ordena como `kubectl apply -k` (namespaces primero).
- `engine/helm.go`: carga el chart con `helm.sh/helm/v3/pkg/chart/loader`, combina
  valores (`-f`, `--set`, `--set-string`, `--reuse-values`) con `pkg/strvals` y
  renderiza con `helmlite`.
- `helmlite/`: el motor de plantillas de Helm (`pkg/engine`) y la combinación de
  valores (`pkg/chartutil`) copiados de Helm v3.18 (Apache License 2.0, © The Helm
  Authors) sin las partes que hablan con un clúster (`lookup` vía client-go,
  validación con JSON Schema). Con ellas el WASM pasaría de ~7 MB a ~15 MB
  comprimido.

```sh
bun run test:wasm    # go test (tfplay y k8splay)
bun run build:wasm   # static/k8splay/k8splay.wasm(.gz) + wasm_exec.js
```

Los iconos de `static/k8splay/icons` son del
[Kubernetes Icons Set](https://github.com/kubernetes/community/tree/master/icons)
(The Kubernetes Authors, Apache-2.0 o CC-BY-4.0).
