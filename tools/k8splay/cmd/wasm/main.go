//go:build js && wasm

// Command wasm exposes kustomize and Helm's template engine to JavaScript as
// globalThis.k8splay. Every call takes and returns JSON strings.
package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/salvamiguel/materials/tools/k8splay/engine"
)

func result(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		b, _ = json.Marshal(map[string]string{"error": err.Error()})
	}
	return string(b)
}

func errorResult(msg string) any {
	b, _ := json.Marshal(map[string]string{"error": msg})
	return string(b)
}

func main() {
	api := js.Global().Get("Object").New()

	// kustomize(requestJSON) -> engine.KustomizeResponse
	api.Set("kustomize", js.FuncOf(func(this js.Value, args []js.Value) any {
		var req engine.KustomizeRequest
		if len(args) < 1 {
			return errorResult("missing argument")
		}
		if err := json.Unmarshal([]byte(args[0].String()), &req); err != nil {
			return errorResult(err.Error())
		}
		return result(engine.Kustomize(req))
	}))

	// helm(requestJSON) -> engine.HelmResponse
	api.Set("helm", js.FuncOf(func(this js.Value, args []js.Value) any {
		var req engine.HelmRequest
		if len(args) < 1 {
			return errorResult("missing argument")
		}
		if err := json.Unmarshal([]byte(args[0].String()), &req); err != nil {
			return errorResult(err.Error())
		}
		return result(engine.Helm(req))
	}))

	js.Global().Set("k8splay", api)
	if ready := js.Global().Get("__k8splayReady"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {}
}
