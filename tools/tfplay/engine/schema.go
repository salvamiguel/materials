package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/ext/typeexpr"
	"github.com/hashicorp/hcl/v2/hcldec"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
	ctyjson "github.com/zclconf/go-cty/cty/json"
)

// ProviderSchema is the playground provider format produced by cmd/schemagen
// (or written by hand for custom providers, see docs in README.md).
type ProviderSchema struct {
	Name           string                     `json:"name"`
	Source         string                     `json:"source"`
	Version        string                     `json:"version"`
	Provider       *Block                     `json:"provider"`
	ResourcesRaw   map[string]json.RawMessage `json:"resources"`
	DataSourcesRaw map[string]json.RawMessage `json:"data_sources"`

	mu          sync.Mutex
	resources   map[string]*Block
	dataSources map[string]*Block
}

// Block describes the body of a resource, data source, provider or nested block.
type Block struct {
	SchemaVersion int `json:"schema_version,omitempty"`
	// ProviderDefaults lists attributes (project, region, zone) that take
	// the provider configuration's value when unset.
	ProviderDefaults []string                   `json:"provider_defaults,omitempty"`
	Description      string                     `json:"description,omitempty"`
	Attributes       map[string]*Attribute      `json:"attributes,omitempty"`
	Blocks           map[string]*NestedBlock    `json:"blocks,omitempty"`
	Mock             map[string]json.RawMessage `json:"mock,omitempty"`

	implied cty.Type
	spec    hcldec.Spec
}

type Attribute struct {
	Type        json.RawMessage `json:"type,omitempty"`
	Nested      *NestedBlock    `json:"nested,omitempty"`
	Description string          `json:"description,omitempty"`
	Required    bool            `json:"required,omitempty"`
	Optional    bool            `json:"optional,omitempty"`
	Computed    bool            `json:"computed,omitempty"`
	Sensitive   bool            `json:"sensitive,omitempty"`
	ForceNew    bool            `json:"force_new,omitempty"`
	Default     json.RawMessage `json:"default,omitempty"`

	ty         cty.Type
	defaultVal cty.Value
}

// NestedBlock is either a nested block type or the nested type of an attribute.
type NestedBlock struct {
	Nesting  string `json:"nesting"` // single, group, list, set, map
	MinItems int    `json:"min_items,omitempty"`
	MaxItems int    `json:"max_items,omitempty"`
	Computed bool   `json:"computed,omitempty"`
	Block
}

// ParseProviderSchema decodes a provider definition. Resource schemas are
// decoded lazily because the AWS provider has well over a thousand of them.
func ParseProviderSchema(data []byte) (*ProviderSchema, error) {
	p := &ProviderSchema{}
	if err := json.Unmarshal(data, p); err != nil {
		return nil, fmt.Errorf("invalid provider schema: %w", err)
	}
	if p.Name == "" {
		return nil, fmt.Errorf("invalid provider schema: missing \"name\"")
	}
	if p.Source == "" {
		p.Source = "hashicorp/" + p.Name
	}
	if p.Version == "" {
		p.Version = "0.0.1"
	}
	if p.Provider == nil {
		p.Provider = &Block{}
	}
	if err := p.Provider.prepare(); err != nil {
		return nil, fmt.Errorf("provider %s: %w", p.Name, err)
	}
	p.resources = map[string]*Block{}
	p.dataSources = map[string]*Block{}
	return p, nil
}

func (p *ProviderSchema) Resource(t string) (*Block, error) {
	return p.lookup(t, p.ResourcesRaw, p.resources)
}

func (p *ProviderSchema) DataSource(t string) (*Block, error) {
	return p.lookup(t, p.DataSourcesRaw, p.dataSources)
}

func (p *ProviderSchema) lookup(t string, raw map[string]json.RawMessage, cache map[string]*Block) (*Block, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if b, ok := cache[t]; ok {
		return b, nil
	}
	r, ok := raw[t]
	if !ok {
		return nil, nil
	}
	b := &Block{}
	if err := json.Unmarshal(r, b); err != nil {
		return nil, fmt.Errorf("schema for %s: %w", t, err)
	}
	if err := b.prepare(); err != nil {
		return nil, fmt.Errorf("schema for %s: %w", t, err)
	}
	cache[t] = b
	return b, nil
}

// ResourceTypes returns the sorted list of managed resource types.
func (p *ProviderSchema) ResourceTypes() []string {
	out := make([]string, 0, len(p.ResourcesRaw))
	for k := range p.ResourcesRaw {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (p *ProviderSchema) DataSourceTypes() []string {
	out := make([]string, 0, len(p.DataSourcesRaw))
	for k := range p.DataSourcesRaw {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// parseType accepts either the cty JSON type encoding used by Terraform
// ("string", ["list","string"], ...) or a Terraform type expression written
// as a string ("list(string)", "map(object({a=string}))").
func parseType(raw json.RawMessage) (cty.Type, error) {
	if len(raw) == 0 {
		return cty.DynamicPseudoType, nil
	}
	if t, err := ctyjson.UnmarshalType(raw); err == nil {
		return t, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return cty.NilType, fmt.Errorf("invalid type %s", string(raw))
	}
	expr, diags := hclsyntax.ParseExpression([]byte(s), "type", hcl.InitialPos)
	if diags.HasErrors() {
		return cty.NilType, fmt.Errorf("invalid type %q: %s", s, diags.Error())
	}
	t, diags := typeexpr.TypeConstraint(expr)
	if diags.HasErrors() {
		return cty.NilType, fmt.Errorf("invalid type %q: %s", s, diags.Error())
	}
	return t, nil
}

func (b *Block) prepare() error {
	for name, a := range b.Attributes {
		if a.Nested != nil {
			if err := a.Nested.Block.prepare(); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			a.ty = wrapNesting(a.Nested.Nesting, a.Nested.Block.ImpliedType())
		} else {
			t, err := parseType(a.Type)
			if err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
			a.ty = t
		}
		if !a.Required && !a.Optional && !a.Computed {
			a.Optional = true
		}
		a.defaultVal = cty.NullVal(a.ty)
		if len(a.Default) > 0 && string(a.Default) != "null" {
			v, err := ctyjson.Unmarshal(a.Default, a.ty)
			if err != nil {
				// Defaults are extracted heuristically; ignore mismatches.
				a.defaultVal = cty.NullVal(a.ty)
			} else {
				a.defaultVal = v
			}
		}
	}
	for name, nb := range b.Blocks {
		if nb.Nesting == "" {
			nb.Nesting = "list"
		}
		if err := nb.Block.prepare(); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	b.implied = b.computeImpliedType()
	return nil
}

func wrapNesting(nesting string, t cty.Type) cty.Type {
	switch nesting {
	case "list":
		return cty.List(t)
	case "set":
		return cty.Set(t)
	case "map":
		return cty.Map(t)
	default:
		return t
	}
}

// ImpliedType is the object type of a whole resource instance value.
func (b *Block) ImpliedType() cty.Type {
	if b.implied == cty.NilType {
		b.implied = b.computeImpliedType()
	}
	return b.implied
}

func (b *Block) computeImpliedType() cty.Type {
	attrs := map[string]cty.Type{}
	for n, a := range b.Attributes {
		attrs[n] = a.ty
	}
	for n, nb := range b.Blocks {
		et := nb.Block.ImpliedType()
		switch nb.Nesting {
		case "single", "group":
			attrs[n] = et
		case "set":
			attrs[n] = cty.Set(et)
		case "map":
			if et.HasDynamicTypes() {
				attrs[n] = cty.DynamicPseudoType
			} else {
				attrs[n] = cty.Map(et)
			}
		default:
			if et.HasDynamicTypes() {
				attrs[n] = cty.DynamicPseudoType
			} else {
				attrs[n] = cty.List(et)
			}
		}
	}
	return cty.Object(attrs)
}

// DecoderSpec builds the hcldec spec used to decode configuration. Computed
// only attributes are excluded so that setting them is an error, like in
// Terraform ("Unsupported argument").
func (b *Block) DecoderSpec() hcldec.Spec {
	if b.spec != nil {
		return b.spec
	}
	spec := hcldec.ObjectSpec{}
	for n, a := range b.Attributes {
		if a.Computed && !a.Optional && !a.Required {
			continue
		}
		t := a.ty
		if a.Nested != nil {
			t = wrapNesting(a.Nested.Nesting, a.Nested.Block.configObjectType())
		}
		spec[n] = &hcldec.AttrSpec{Name: n, Type: t, Required: a.Required}
	}
	for n, nb := range b.Blocks {
		child := nb.Block.DecoderSpec()
		dynamic := nb.Block.ImpliedType().HasDynamicTypes()
		switch nb.Nesting {
		case "single", "group":
			spec[n] = &hcldec.BlockSpec{TypeName: n, Nested: child, Required: nb.MinItems > 0}
		case "set":
			if dynamic {
				spec[n] = &hcldec.BlockTupleSpec{TypeName: n, Nested: child, MinItems: nb.MinItems, MaxItems: nb.MaxItems}
			} else {
				spec[n] = &hcldec.BlockSetSpec{TypeName: n, Nested: child, MinItems: nb.MinItems, MaxItems: nb.MaxItems}
			}
		case "map":
			if dynamic {
				spec[n] = &hcldec.BlockObjectSpec{TypeName: n, Nested: child, LabelNames: []string{"key"}}
			} else {
				spec[n] = &hcldec.BlockMapSpec{TypeName: n, Nested: child, LabelNames: []string{"key"}}
			}
		default:
			if dynamic {
				spec[n] = &hcldec.BlockTupleSpec{TypeName: n, Nested: child, MinItems: nb.MinItems, MaxItems: nb.MaxItems}
			} else {
				spec[n] = &hcldec.BlockListSpec{TypeName: n, Nested: child, MinItems: nb.MinItems, MaxItems: nb.MaxItems}
			}
		}
	}
	b.spec = spec
	return spec
}

// isObjectCollection reports list(object) / set(object) attribute types:
// in SDKv2 providers these are "attributes as blocks" (ConfigModeAttr).
func isObjectCollection(t cty.Type) bool {
	return (t.IsListType() || t.IsSetType()) && t.ElementType().IsObjectType()
}

// SpecFor returns the decoder spec for a particular body. Attributes of type
// list/set of objects that are written as (possibly dynamic) blocks are
// decoded as blocks, like Terraform's blocktoattr fixup does.
func (b *Block) SpecFor(body hcl.Body) hcldec.Spec {
	base := b.DecoderSpec().(hcldec.ObjectSpec)
	names := blockNamesIn(body)
	var spec hcldec.ObjectSpec
	for name := range names {
		a := b.Attributes[name]
		if a == nil || a.Nested != nil || !isObjectCollection(a.ty) || (a.Computed && !a.Optional) {
			continue
		}
		if spec == nil {
			spec = hcldec.ObjectSpec{}
			for k, v := range base {
				spec[k] = v
			}
		}
		nested := hcldec.ObjectSpec{}
		for an, at := range a.ty.ElementType().AttributeTypes() {
			nested[an] = &hcldec.AttrSpec{Name: an, Type: at}
		}
		if a.ty.IsSetType() {
			spec[name] = &hcldec.BlockSetSpec{TypeName: name, Nested: nested}
		} else {
			spec[name] = &hcldec.BlockListSpec{TypeName: name, Nested: nested}
		}
	}
	if spec == nil {
		return base
	}
	return spec
}

func blockNamesIn(body hcl.Body) map[string]bool {
	out := map[string]bool{}
	sb, ok := body.(*hclsyntax.Body)
	if !ok {
		return out
	}
	for _, blk := range sb.Blocks {
		if blk.Type == "dynamic" && len(blk.Labels) == 1 {
			out[blk.Labels[0]] = true
		} else {
			out[blk.Type] = true
		}
	}
	return out
}

// zeroFill replaces nulls inside the elements of an object collection by
// zero values, which is what the legacy SDK does for ConfigModeAttr blocks.
func zeroFill(v cty.Value) cty.Value {
	if v.IsNull() || !v.IsKnown() {
		return v
	}
	out, err := cty.Transform(v, func(p cty.Path, x cty.Value) (cty.Value, error) {
		if len(p) < 2 || !x.IsNull() {
			return x, nil
		}
		return zeroValue(x.Type()), nil
	})
	if err != nil {
		return v
	}
	return out
}

func zeroValue(t cty.Type) cty.Value {
	switch {
	case t == cty.String:
		return cty.StringVal("")
	case t == cty.Number:
		return cty.Zero
	case t == cty.Bool:
		return cty.False
	case t.IsListType():
		return cty.ListValEmpty(t.ElementType())
	case t.IsSetType():
		return cty.SetValEmpty(t.ElementType())
	case t.IsMapType():
		return cty.MapValEmpty(t.ElementType())
	}
	return cty.NullVal(t)
}

// configObjectType is the object type used when decoding a nested attribute
// type from configuration: everything but required attributes is optional.
func (b *Block) configObjectType() cty.Type {
	attrs := map[string]cty.Type{}
	var optional []string
	for n, a := range b.Attributes {
		t := a.ty
		if a.Nested != nil {
			t = wrapNesting(a.Nested.Nesting, a.Nested.Block.configObjectType())
		}
		attrs[n] = t
		if !a.Required {
			optional = append(optional, n)
		}
	}
	return cty.ObjectWithOptionalAttrs(attrs, optional)
}

func (b *Block) sortedAttributeNames() []string {
	out := make([]string, 0, len(b.Attributes))
	for n := range b.Attributes {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func (b *Block) sortedBlockNames() []string {
	out := make([]string, 0, len(b.Blocks))
	for n := range b.Blocks {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// providerForType returns the implied provider local name for a resource
// type: "aws_instance" -> "aws".
func providerForType(t string) string {
	if i := strings.IndexByte(t, '_'); i > 0 {
		return t[:i]
	}
	return t
}
