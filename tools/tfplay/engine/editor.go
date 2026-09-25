package engine

import (
	"encoding/json"
	"fmt"
)

// Schema queries feed the playground editor's autocompletion: the editor
// works out the context from the text and asks for the provider data it needs.

// SchemaRequest names a loaded provider by source and, optionally, one of its
// resource ("resource") or data source ("data") types.
type SchemaRequest struct {
	Source string `json:"source"`
	Kind   string `json:"kind,omitempty"`
	Type   string `json:"type,omitempty"`
}

// ProviderIndex is what a provider offers: its configuration schema and the
// names of its resource and data source types.
type ProviderIndex struct {
	ProviderInfo
	Provider    *Block   `json:"provider"`
	Resources   []string `json:"resources"`
	DataSources []string `json:"data_sources"`
}

// Schema returns the provider's index when the request has no type, or the
// schema of that type. It returns nil for providers that are not loaded and
// types they don't have.
func (en *Engine) Schema(req SchemaRequest) (any, error) {
	p := en.providers[req.Source]
	if p == nil {
		return nil, nil
	}
	var raw map[string]json.RawMessage
	switch req.Kind {
	case "":
		return &ProviderIndex{
			ProviderInfo: ProviderInfo{Name: p.Name, Source: p.Source, Version: p.Version},
			Provider:     p.Provider,
			Resources:    p.ResourceTypes(),
			DataSources:  p.DataSourceTypes(),
		}, nil
	case "resource":
		raw = p.ResourcesRaw
	case "data":
		raw = p.DataSourcesRaw
	default:
		return nil, fmt.Errorf("unknown schema kind %q", req.Kind)
	}
	// The raw definition: no need to decode what the editor only reads.
	if b, ok := raw[req.Type]; ok {
		return b, nil
	}
	return nil, nil
}
