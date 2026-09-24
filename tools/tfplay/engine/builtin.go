package engine

// builtinTerraformProvider is the schema of Terraform's built-in provider
// (terraform.io/builtin/terraform), which offers terraform_data.
const builtinTerraformProvider = `{
  "name": "terraform",
  "source": "terraform.io/builtin/terraform",
  "version": "1.16.4",
  "provider": {},
  "resources": {
    "terraform_data": {
      "attributes": {
        "id": {"type": "string", "computed": true},
        "input": {"type": "dynamic", "optional": true},
        "output": {"type": "dynamic", "computed": true},
        "triggers_replace": {"type": "dynamic", "optional": true}
      }
    }
  },
  "data_sources": {}
}`
