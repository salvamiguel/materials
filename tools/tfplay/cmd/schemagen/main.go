// Command schemagen converts the output of `terraform providers schema -json`
// into the compact provider format understood by the playground engine.
//
// The Terraform schema JSON does not expose ForceNew (RequiresReplace) nor
// default values, so optionally the provider Go source is scanned (see
// extract.go) to recover them. Mock templates from -meta are merged in.
//
//	go run ./cmd/schemagen -schema schema.json -src <terraform-provider-aws dir> \
//	   -provider registry.terraform.io/hashicorp/aws -name aws -version 6.66.0 \
//	   -meta meta/aws.json -out ../../static/tfplay/providers/aws.json.gz
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
)

// --- terraform providers schema -json ---

type tfSchemas struct {
	ProviderSchemas map[string]*tfProvider `json:"provider_schemas"`
}

type tfProvider struct {
	Provider          *tfSchema            `json:"provider"`
	ResourceSchemas   map[string]*tfSchema `json:"resource_schemas"`
	DataSourceSchemas map[string]*tfSchema `json:"data_source_schemas"`
}

type tfSchema struct {
	Version int      `json:"version"`
	Block   *tfBlock `json:"block"`
}

type tfBlock struct {
	Attributes map[string]*tfAttribute `json:"attributes"`
	BlockTypes map[string]*tfBlockType `json:"block_types"`
}

type tfAttribute struct {
	Type       json.RawMessage `json:"type"`
	NestedType *tfNestedType   `json:"nested_type"`
	Required   bool            `json:"required"`
	Optional   bool            `json:"optional"`
	Computed   bool            `json:"computed"`
	Sensitive  bool            `json:"sensitive"`
	WriteOnly  bool            `json:"write_only"`
}

type tfNestedType struct {
	Attributes  map[string]*tfAttribute `json:"attributes"`
	NestingMode string                  `json:"nesting_mode"`
}

type tfBlockType struct {
	NestingMode string   `json:"nesting_mode"`
	Block       *tfBlock `json:"block"`
	MinItems    int      `json:"min_items"`
	MaxItems    int      `json:"max_items"`
}

// --- playground format (mirrors engine/schema.go) ---

type pgProvider struct {
	Name        string              `json:"name"`
	Source      string              `json:"source"`
	Version     string              `json:"version"`
	Provider    *pgBlock            `json:"provider"`
	Resources   map[string]*pgBlock `json:"resources"`
	DataSources map[string]*pgBlock `json:"data_sources"`
}

type pgBlock struct {
	SchemaVersion    int                        `json:"schema_version,omitempty"`
	ProviderDefaults []string                   `json:"provider_defaults,omitempty"`
	Attributes       map[string]*pgAttribute    `json:"attributes,omitempty"`
	Blocks           map[string]*pgNestedBlock  `json:"blocks,omitempty"`
	Mock             map[string]json.RawMessage `json:"mock,omitempty"`
}

type pgAttribute struct {
	Type      json.RawMessage `json:"type,omitempty"`
	Nested    *pgNestedBlock  `json:"nested,omitempty"`
	Required  bool            `json:"required,omitempty"`
	Optional  bool            `json:"optional,omitempty"`
	Computed  bool            `json:"computed,omitempty"`
	Sensitive bool            `json:"sensitive,omitempty"`
	ForceNew  bool            `json:"force_new,omitempty"`
	Default   json.RawMessage `json:"default,omitempty"`
}

type pgNestedBlock struct {
	Nesting  string `json:"nesting"`
	Computed bool   `json:"computed,omitempty"`
	MinItems int    `json:"min_items,omitempty"`
	MaxItems int    `json:"max_items,omitempty"`
	pgBlock
}

func main() {
	schemaPath := flag.String("schema", "", "output of `terraform providers schema -json`")
	providerAddr := flag.String("provider", "", "provider address, e.g. registry.terraform.io/hashicorp/aws")
	name := flag.String("name", "", "provider local name, e.g. aws")
	version := flag.String("version", "", "provider version")
	srcDir := flag.String("src", "", "optional provider source dir to extract ForceNew/Default")
	metaPath := flag.String("meta", "", "optional JSON with mock templates: {resources:{type:{attr:tpl}}, data_sources:{...}}")
	include := flag.String("include", "", "optional comma-separated list of resource/data source type prefixes to keep")
	iamRules := flag.Bool("google-iam", false, "apply the ForceNew rules of terraform-provider-google's generated IAM resources")
	out := flag.String("out", "", "output file (.json or .json.gz)")
	flag.Parse()

	raw, err := os.ReadFile(*schemaPath)
	check(err)
	var all tfSchemas
	check(json.Unmarshal(raw, &all))
	p := all.ProviderSchemas[*providerAddr]
	if p == nil {
		log.Fatalf("provider %s not found in schema", *providerAddr)
	}

	var extracted map[string]map[string]attrInfo
	if *srcDir != "" {
		extracted, err = extractFromSource(*srcDir)
		check(err)
		log.Printf("extracted ForceNew/Default info for %d types from source", len(extracted))
	}

	keep := func(t string) bool {
		if *include == "" {
			return true
		}
		for _, pre := range strings.Split(*include, ",") {
			if strings.HasPrefix(t, strings.TrimSpace(pre)) {
				return true
			}
		}
		return false
	}

	src := strings.TrimPrefix(*providerAddr, "registry.terraform.io/")
	res := &pgProvider{
		Name:        *name,
		Source:      src,
		Version:     *version,
		Provider:    convertBlock(p.Provider.Block, nil, ""),
		Resources:   map[string]*pgBlock{},
		DataSources: map[string]*pgBlock{},
	}
	stats := struct{ forceNew, defaults int }{}
	for t, s := range p.ResourceSchemas {
		if !keep(t) {
			continue
		}
		info := extracted[t]
		b := convertBlock(s.Block, info, "")
		b.SchemaVersion = s.Version
		if ri, ok := info[""]; ok {
			b.ProviderDefaults = ri.ProviderDefaults
			if a := b.Attributes["deletion_policy"]; a != nil && ri.DeletionPolicy != "" {
				a.Default, _ = json.Marshal(ri.DeletionPolicy)
			}
		}
		res.Resources[t] = b
		for _, i := range info {
			if i.ForceNew {
				stats.forceNew++
			}
			if i.Default != nil {
				stats.defaults++
			}
		}
	}
	if *iamRules {
		n := 0
		for t, b := range res.Resources {
			if googleIAM(t, b) {
				n++
			}
		}
		log.Printf("applied IAM ForceNew rules to %d resources", n)
	}
	for t, s := range p.DataSourceSchemas {
		if !keep(t) {
			continue
		}
		res.DataSources[t] = convertBlock(s.Block, nil, "")
	}

	if *metaPath != "" {
		mraw, err := os.ReadFile(*metaPath)
		check(err)
		var meta struct {
			Resources   map[string]map[string]json.RawMessage `json:"resources"`
			DataSources map[string]map[string]json.RawMessage `json:"data_sources"`
			// Defaults the source extraction cannot resolve (typed constants).
			Defaults map[string]map[string]json.RawMessage `json:"defaults"`
		}
		check(json.Unmarshal(mraw, &meta))
		for t, attrs := range meta.Defaults {
			b := res.Resources[t]
			if b == nil {
				log.Printf("warning: default for unknown resource %s", t)
				continue
			}
			for n, v := range attrs {
				if a := b.Attributes[n]; a != nil {
					a.Default = v
				} else {
					log.Printf("warning: default for unknown attribute %s.%s", t, n)
				}
			}
		}
		apply := func(kind string, dst map[string]*pgBlock, src map[string]map[string]json.RawMessage) {
			for t, m := range src {
				if strings.HasPrefix(t, "_") {
					continue
				}
				b := dst[t]
				if b == nil {
					log.Printf("warning: meta for unknown %s %s", kind, t)
					continue
				}
				b.Mock = m
			}
		}
		apply("resource", res.Resources, meta.Resources)
		apply("data source", res.DataSources, meta.DataSources)
	}

	log.Printf("%s: %d resources, %d data sources (force_new attrs: %d, defaults: %d)",
		*name, len(res.Resources), len(res.DataSources), stats.forceNew, stats.defaults)

	buf, err := json.Marshal(res)
	check(err)
	if strings.HasSuffix(*out, ".gz") {
		var gz bytes.Buffer
		w, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
		_, err = w.Write(buf)
		check(err)
		check(w.Close())
		buf = gz.Bytes()
	}
	check(os.WriteFile(*out, buf, 0o644))
	log.Printf("wrote %s (%d bytes)", *out, len(buf))
}

func convertBlock(b *tfBlock, info map[string]attrInfo, prefix string) *pgBlock {
	out := &pgBlock{}
	if b == nil {
		return out
	}
	if len(b.Attributes) > 0 {
		out.Attributes = map[string]*pgAttribute{}
	}
	for n, a := range b.Attributes {
		if a.WriteOnly {
			continue
		}
		out.Attributes[n] = convertAttr(a, info, prefix+n)
	}
	if len(b.BlockTypes) > 0 {
		out.Blocks = map[string]*pgNestedBlock{}
	}
	for n, bt := range b.BlockTypes {
		nb := &pgNestedBlock{
			Nesting:  bt.NestingMode,
			MinItems: bt.MinItems,
			MaxItems: bt.MaxItems,
			Computed: info[prefix+n].Computed && !info[prefix+n].Suppressed,
		}
		nb.pgBlock = *convertBlock(bt.Block, info, prefix+n+".")
		out.Blocks[n] = nb
	}
	return out
}

func convertAttr(a *tfAttribute, info map[string]attrInfo, path string) *pgAttribute {
	pa := &pgAttribute{
		Type:      a.Type,
		Required:  a.Required,
		Optional:  a.Optional,
		Computed:  a.Computed,
		Sensitive: a.Sensitive,
	}
	if i, ok := info[path]; ok && !(a.Computed && !a.Optional) {
		pa.ForceNew = i.ForceNew
		// A nested default behind a DiffSuppressFunc is not planned on create
		// (e.g. google_compute_instance boot_disk.force_attach).
		if i.Default != nil && !a.Required && !(i.Suppressed && strings.Contains(path, ".")) {
			pa.Default = i.Default
		}
	}
	if a.NestedType != nil {
		nb := &pgNestedBlock{Nesting: a.NestedType.NestingMode}
		nb.Attributes = map[string]*pgAttribute{}
		names := make([]string, 0, len(a.NestedType.Attributes))
		for n := range a.NestedType.Attributes {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			nb.Attributes[n] = convertAttr(a.NestedType.Attributes[n], info, path+"."+n)
		}
		pa.Nested = nb
	}
	return pa
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// googleIAM mirrors tpgiamresource: in *_iam_member / *_iam_binding /
// *_iam_policy / *_iam_audit_config the role, the member, the condition and
// every identifier of the parent resource force a replacement. Only the
// member list of a binding, the policy document and audit configs update in
// place.
func googleIAM(t string, b *pgBlock) bool {
	kinds := []string{"_iam_member", "_iam_binding", "_iam_policy", "_iam_audit_config"}
	match := false
	for _, k := range kinds {
		if strings.HasSuffix(t, k) {
			match = true
		}
	}
	if !match {
		return false
	}
	inPlace := map[string]bool{"members": true, "policy_data": true, "etag": true, "id": true}
	for name, a := range b.Attributes {
		if inPlace[name] || (a.Computed && !a.Optional) {
			continue
		}
		a.ForceNew = true
	}
	if c, ok := b.Blocks["condition"]; ok {
		for _, a := range c.Attributes {
			a.ForceNew = true
		}
	}
	return true
}
