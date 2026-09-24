#!/usr/bin/env bash
# Builds the playground engine to WebAssembly into static/tfplay/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../static/tfplay"
mkdir -p "$out"
cd "$here"
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$out/tfplay.wasm" ./cmd/wasm
gzip -9 -f "$out/tfplay.wasm"
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$out/wasm_exec.js"
ls -l "$out/tfplay.wasm.gz"
