package engine

import (
	"encoding/json"
	"slices"
	"testing"
)

// schemaJSON runs a schema query and decodes it the way the browser does.
func schemaJSON(t *testing.T, en *Engine, req SchemaRequest) map[string]any {
	t.Helper()
	v, err := en.Schema(req)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestSchemaIndex(t *testing.T) {
	en, _ := loadEngine(t)
	idx := schemaJSON(t, en, SchemaRequest{Source: "hashicorp/aws"})
	if idx["name"] != "aws" || idx["source"] != "hashicorp/aws" || idx["version"] == "" {
		t.Errorf("unexpected provider info: %v %v %v", idx["name"], idx["source"], idx["version"])
	}
	has := func(key, name string) bool {
		list, _ := idx[key].([]any)
		return slices.Contains(list, any(name))
	}
	if !has("resources", "aws_instance") || !has("data_sources", "aws_ami") {
		t.Error("the index lacks aws_instance or data.aws_ami")
	}
	if has("resources", "aws_ami") && !has("data_sources", "aws_ami") {
		t.Error("data sources are listed as resources")
	}
	if _, ok := idx["provider"].(map[string]any)["attributes"].(map[string]any)["region"]; !ok {
		t.Error("the provider configuration schema lacks region")
	}

	builtin := schemaJSON(t, en, SchemaRequest{Source: builtinTerraformSource})
	if list, _ := builtin["resources"].([]any); !slices.Contains(list, any("terraform_data")) {
		t.Errorf("builtin provider lacks terraform_data: %v", builtin["resources"])
	}
}

func TestSchemaBlock(t *testing.T) {
	en, _ := loadEngine(t)
	b := schemaJSON(t, en, SchemaRequest{Source: "hashicorp/aws", Kind: "resource", Type: "aws_instance"})
	attrs, _ := b["attributes"].(map[string]any)
	if ami, _ := attrs["ami"].(map[string]any); ami["type"] != "string" {
		t.Errorf("aws_instance.ami: %v", attrs["ami"])
	}
	if _, ok := b["blocks"].(map[string]any)["root_block_device"]; !ok {
		t.Error("aws_instance lacks the root_block_device block")
	}

	d := schemaJSON(t, en, SchemaRequest{Source: "hashicorp/aws", Kind: "data", Type: "aws_ami"})
	if _, ok := d["attributes"].(map[string]any)["most_recent"]; !ok {
		t.Error("data.aws_ami lacks most_recent")
	}
}

func TestSchemaMissing(t *testing.T) {
	en, _ := loadEngine(t)
	for _, req := range []SchemaRequest{
		{Source: "hashicorp/nope"},
		{Source: "hashicorp/aws", Kind: "resource", Type: "aws_nope"},
		{Source: "hashicorp/aws", Kind: "data", Type: "aws_instance_nope"},
	} {
		if v := schemaJSON(t, en, req); v != nil {
			t.Errorf("%+v: want null, got %v", req, v)
		}
	}
	if _, err := en.Schema(SchemaRequest{Source: "hashicorp/aws", Kind: "module", Type: "x"}); err == nil {
		t.Error("an unknown kind should be an error")
	}
}
