#!/usr/bin/env bash
# Builds the Kubernetes playground's kustomize/helm engine to WebAssembly into static/k8splay/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../static/k8splay"
mkdir -p "$out"
cd "$here"
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$out/k8splay.wasm" ./cmd/wasm
# Keep both: the worker downloads the .gz and falls back to the plain file
# when a network (e.g. a corporate proxy) blocks gzip archives.
gzip -9 -k -f "$out/k8splay.wasm"
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$out/wasm_exec.js"
ls -l "$out"/k8splay.wasm*
