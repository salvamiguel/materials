//go:build js && wasm

// Command wasm exposes the playground engine to JavaScript as
// globalThis.tfplay. Every call takes and returns JSON strings.
package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/salvamiguel/materials/tools/tfplay/engine"
)

func jsonResult(v any, err error) any {
	if err != nil {
		b, _ := json.Marshal(map[string]string{"error": err.Error()})
		return string(b)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func main() {
	en := engine.New()
	api := js.Global().Get("Object").New()

	// registerProvider(json) -> {"name","source","version"} | {"error"}
	api.Set("registerProvider", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) < 1 {
			return jsonResult(nil, errMissingArg)
		}
		info, err := en.RegisterProvider([]byte(args[0].String()))
		return jsonResult(info, err)
	}))

	// hasProvider("hashicorp/aws") -> bool
	api.Set("hasProvider", js.FuncOf(func(this js.Value, args []js.Value) any {
		return len(args) > 0 && en.HasProvider(args[0].String())
	}))

	// requiredProviders(filesJSON) -> [{"name","source","version"}]
	api.Set("requiredProviders", js.FuncOf(func(this js.Value, args []js.Value) any {
		files := map[string]string{}
		if len(args) > 0 {
			json.Unmarshal([]byte(args[0].String()), &files)
		}
		return jsonResult(en.RequiredProviders(files), nil)
	}))

	// schema(requestJSON) -> provider index | type schema | null (see engine.Schema)
	api.Set("schema", js.FuncOf(func(this js.Value, args []js.Value) any {
		var req engine.SchemaRequest
		if len(args) < 1 {
			return jsonResult(nil, errMissingArg)
		}
		if err := json.Unmarshal([]byte(args[0].String()), &req); err != nil {
			return jsonResult(nil, err)
		}
		return jsonResult(en.Schema(req))
	}))

	// run(requestJSON) -> responseJSON (see engine.Request / engine.Response)
	api.Set("run", js.FuncOf(func(this js.Value, args []js.Value) any {
		var req engine.Request
		if len(args) < 1 {
			return jsonResult(nil, errMissingArg)
		}
		if err := json.Unmarshal([]byte(args[0].String()), &req); err != nil {
			return jsonResult(nil, err)
		}
		return jsonResult(en.Run(req), nil)
	}))

	js.Global().Set("tfplay", api)
	if ready := js.Global().Get("__tfplayReady"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {}
}

type argError string

func (e argError) Error() string { return string(e) }

const errMissingArg = argError("missing argument")
