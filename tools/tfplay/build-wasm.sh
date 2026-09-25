#!/usr/bin/env bash
# Builds the playground engine to WebAssembly into static/tfplay/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../static/tfplay"
mkdir -p "$out"
cd "$here"
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$out/tfplay.wasm" ./cmd/wasm
# Keep both: the worker downloads the .gz and falls back to the plain file
# when a network (e.g. a corporate proxy) blocks gzip archives.
gzip -9 -k -f "$out/tfplay.wasm"
for gz in "$out"/providers/*.json.gz; do
  gzip -dc "$gz" > "${gz%.gz}"
done
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$out/wasm_exec.js"
ls -l "$out"/tfplay.wasm*
