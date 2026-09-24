package engine

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/ext/typeexpr"
	"github.com/hashicorp/hcl/v2/gohcl"
	"github.com/hashicorp/hcl/v2/hclparse"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

type Module struct {
	Dir               string
	Variables         map[string]*Variable
	Locals            map[string]*Local
	Outputs           map[string]*Output
	Resources         map[string]*Resource // "aws_instance.web", "data.aws_ami.x"
	ModuleCalls       map[string]*ModuleCall
	ProviderConfigs   map[string]*ProviderConfig // "aws", "aws.west"
	RequiredProviders map[string]*RequiredProvider
	Moved             []*Moved
	Backend           string
	Children          map[string]*Module
}

type Variable struct {
	Name        string
	Type        cty.Type
	Defaults    *typeexpr.Defaults
	Default     cty.Value
	HasDefault  bool
	Description string
	Sensitive   bool
	Nullable    bool
	Validations []*CheckRule
	DeclRange   hcl.Range
}

type CheckRule struct {
	Condition    hcl.Expression
	ErrorMessage hcl.Expression
	DeclRange    hcl.Range
}

type Local struct {
	Name      string
	Expr      hcl.Expression
	DeclRange hcl.Range
}

type Output struct {
	Name          string
	Expr          hcl.Expression
	Description   string
	Sensitive     bool
	DependsOn     []hcl.Traversal
	Preconditions []*CheckRule
	DeclRange     hcl.Range
}

type Resource struct {
	Mode                string // managed | data
	Type                string
	Name                string
	Count               hcl.Expression
	ForEach             hcl.Expression
	DependsOn           []hcl.Traversal
	ProviderRef         string
	Config              hcl.Body
	CreateBeforeDestroy bool
	PreventDestroy      bool
	IgnoreChanges       []hcl.Traversal
	IgnoreAll           bool
	ReplaceTriggeredBy  []hcl.Expression
	Preconditions       []*CheckRule
	Postconditions      []*CheckRule
	HasProvisioners     bool
	DeclRange           hcl.Range
	TypeRange           hcl.Range
}

func (r *Resource) Key() string {
	if r.Mode == "data" {
		return "data." + r.Type + "." + r.Name
	}
	return r.Type + "." + r.Name
}

type ModuleCall struct {
	Name        string
	Source      string
	SourceRange hcl.Range
	Count       hcl.Expression
	ForEach     hcl.Expression
	DependsOn   []hcl.Traversal
	Inputs      hcl.Attributes
	DeclRange   hcl.Range
}

type ProviderConfig struct {
	Name      string
	Alias     string
	Config    hcl.Body
	DeclRange hcl.Range
}

func (p *ProviderConfig) Key() string {
	if p.Alias != "" {
		return p.Name + "." + p.Alias
	}
	return p.Name
}

type RequiredProvider struct {
	Name    string
	Source  string
	Version string
	Range   hcl.Range
}

type Moved struct {
	From, To  string
	DeclRange hcl.Range
}

// Config is the whole configuration: root module plus local child modules.
type Config struct {
	Root   *Module
	Parser *hclparse.Parser
	Files  map[string]string
}

var fileSchema = &hcl.BodySchema{
	Blocks: []hcl.BlockHeaderSchema{
		{Type: "terraform"},
		{Type: "provider", LabelNames: []string{"name"}},
		{Type: "variable", LabelNames: []string{"name"}},
		{Type: "locals"},
		{Type: "output", LabelNames: []string{"name"}},
		{Type: "module", LabelNames: []string{"name"}},
		{Type: "resource", LabelNames: []string{"type", "name"}},
		{Type: "data", LabelNames: []string{"type", "name"}},
		{Type: "moved"},
		{Type: "import"},
		{Type: "removed"},
		{Type: "check", LabelNames: []string{"name"}},
	},
}

var terraformBlockSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{{Name: "required_version"}, {Name: "experiments"}},
	Blocks: []hcl.BlockHeaderSchema{
		{Type: "required_providers"},
		{Type: "backend", LabelNames: []string{"type"}},
		{Type: "cloud"},
		{Type: "provider_meta", LabelNames: []string{"provider"}},
	},
}

var variableBlockSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "description"}, {Name: "default"}, {Name: "type"},
		{Name: "sensitive"}, {Name: "nullable"}, {Name: "ephemeral"},
	},
	Blocks: []hcl.BlockHeaderSchema{{Type: "validation"}},
}

var checkRuleSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "condition", Required: true},
		{Name: "error_message", Required: true},
	},
}

var outputBlockSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "value", Required: true}, {Name: "description"},
		{Name: "sensitive"}, {Name: "depends_on"}, {Name: "ephemeral"},
	},
	Blocks: []hcl.BlockHeaderSchema{{Type: "precondition"}},
}

var resourceMetaSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "count"}, {Name: "for_each"}, {Name: "provider"}, {Name: "depends_on"},
	},
	Blocks: []hcl.BlockHeaderSchema{
		{Type: "lifecycle"},
		{Type: "connection"},
		{Type: "provisioner", LabelNames: []string{"type"}},
		{Type: "_"},
	},
}

var lifecycleSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "create_before_destroy"}, {Name: "prevent_destroy"},
		{Name: "ignore_changes"}, {Name: "replace_triggered_by"},
	},
	Blocks: []hcl.BlockHeaderSchema{{Type: "precondition"}, {Type: "postcondition"}},
}

var moduleMetaSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{
		{Name: "source", Required: true}, {Name: "version"}, {Name: "count"},
		{Name: "for_each"}, {Name: "depends_on"}, {Name: "providers"},
	},
}

var providerMetaSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{{Name: "alias"}, {Name: "version"}},
}

var movedSchema = &hcl.BodySchema{
	Attributes: []hcl.AttributeSchema{{Name: "from", Required: true}, {Name: "to", Required: true}},
}

// LoadConfig parses every .tf file of the root directory and, recursively,
// local modules referenced with a relative source ("./modules/x").
func LoadConfig(files map[string]string) (*Config, hcl.Diagnostics) {
	cfg := &Config{Parser: hclparse.NewParser(), Files: files}
	root, diags := cfg.loadModule("", nil)
	cfg.Root = root
	return cfg, diags
}

func (c *Config) moduleFiles(dir string) []string {
	var out []string
	for name := range c.Files {
		if !strings.HasSuffix(name, ".tf") {
			continue
		}
		d := path.Dir(name)
		if d == "." {
			d = ""
		}
		if d == dir {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func (c *Config) loadModule(dir string, stack []string) (*Module, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	m := &Module{
		Dir:               dir,
		Variables:         map[string]*Variable{},
		Locals:            map[string]*Local{},
		Outputs:           map[string]*Output{},
		Resources:         map[string]*Resource{},
		ModuleCalls:       map[string]*ModuleCall{},
		ProviderConfigs:   map[string]*ProviderConfig{},
		RequiredProviders: map[string]*RequiredProvider{},
		Children:          map[string]*Module{},
	}
	names := c.moduleFiles(dir)
	if len(names) == 0 && dir != "" {
		diags = append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Unreadable module directory",
			Detail:   fmt.Sprintf("The directory %s does not contain any .tf file.", dir),
		})
		return m, diags
	}
	for _, name := range names {
		f, fdiags := c.Parser.ParseHCL([]byte(c.Files[name]), name)
		diags = append(diags, fdiags...)
		if f == nil {
			continue
		}
		diags = append(diags, m.decodeFile(f)...)
	}
	for _, call := range sortedCalls(m.ModuleCalls) {
		src := call.Source
		if !strings.HasPrefix(src, "./") && !strings.HasPrefix(src, "../") {
			diags = append(diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Module source not supported in the playground",
				Detail:   fmt.Sprintf("Only local modules (source = \"./...\") can be used in the playground; %q would need to be downloaded.", src),
				Subject:  call.SourceRange.Ptr(),
			})
			continue
		}
		childDir := path.Clean(path.Join(dir, src))
		if childDir == "." {
			childDir = ""
		}
		for _, s := range stack {
			if s == childDir {
				diags = append(diags, &hcl.Diagnostic{
					Severity: hcl.DiagError,
					Summary:  "Module cycle",
					Detail:   fmt.Sprintf("Module %q calls itself.", childDir),
					Subject:  call.SourceRange.Ptr(),
				})
				return m, diags
			}
		}
		child, cdiags := c.loadModule(childDir, append(stack, dir))
		diags = append(diags, cdiags...)
		m.Children[call.Name] = child
	}
	return m, diags
}

func sortedCalls(calls map[string]*ModuleCall) []*ModuleCall {
	out := make([]*ModuleCall, 0, len(calls))
	for _, c := range calls {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (m *Module) decodeFile(f *hcl.File) hcl.Diagnostics {
	content, diags := f.Body.Content(fileSchema)
	for _, block := range content.Blocks {
		switch block.Type {
		case "terraform":
			diags = append(diags, m.decodeTerraformBlock(block)...)
		case "provider":
			diags = append(diags, m.decodeProvider(block)...)
		case "variable":
			v, d := decodeVariable(block)
			diags = append(diags, d...)
			if v != nil {
				if prev, ok := m.Variables[v.Name]; ok {
					diags = append(diags, duplicate("variable", v.Name, prev.DeclRange, block.DefRange))
				} else {
					m.Variables[v.Name] = v
				}
			}
		case "locals":
			attrs, d := block.Body.JustAttributes()
			diags = append(diags, d...)
			for name, attr := range attrs {
				if prev, ok := m.Locals[name]; ok {
					diags = append(diags, duplicate("local value", name, prev.DeclRange, attr.Range))
					continue
				}
				m.Locals[name] = &Local{Name: name, Expr: attr.Expr, DeclRange: attr.Range}
			}
		case "output":
			o, d := decodeOutput(block)
			diags = append(diags, d...)
			if o != nil {
				if prev, ok := m.Outputs[o.Name]; ok {
					diags = append(diags, duplicate("output", o.Name, prev.DeclRange, block.DefRange))
				} else {
					m.Outputs[o.Name] = o
				}
			}
		case "module":
			mc, d := decodeModuleCall(block)
			diags = append(diags, d...)
			if mc != nil {
				if prev, ok := m.ModuleCalls[mc.Name]; ok {
					diags = append(diags, duplicate("module call", mc.Name, prev.DeclRange, block.DefRange))
				} else {
					m.ModuleCalls[mc.Name] = mc
				}
			}
		case "resource", "data":
			r, d := decodeResource(block)
			diags = append(diags, d...)
			if r != nil {
				if prev, ok := m.Resources[r.Key()]; ok {
					kind := "resource"
					if r.Mode == "data" {
						kind = "data"
					}
					diags = append(diags, &hcl.Diagnostic{
						Severity: hcl.DiagError,
						Summary:  fmt.Sprintf("Duplicate %s %q configuration", kind, r.Type),
						Detail:   fmt.Sprintf("A %s %s named %q was already declared at %s. Resource names must be unique per type in each module.", r.Type, kind, r.Name, prev.DeclRange),
						Subject:  block.DefRange.Ptr(),
					})
				} else {
					m.Resources[r.Key()] = r
				}
			}
		case "moved":
			mv, d := decodeMoved(block)
			diags = append(diags, d...)
			if mv != nil {
				m.Moved = append(m.Moved, mv)
			}
		case "import", "removed", "check":
			diags = append(diags, &hcl.Diagnostic{
				Severity: hcl.DiagWarning,
				Summary:  fmt.Sprintf("%q blocks are ignored by the playground", block.Type),
				Detail:   "This block is valid Terraform but the playground does not simulate it yet.",
				Subject:  block.DefRange.Ptr(),
			})
		}
	}
	return diags
}

func duplicate(kind, name string, prev, cur hcl.Range) *hcl.Diagnostic {
	return &hcl.Diagnostic{
		Severity: hcl.DiagError,
		Summary:  fmt.Sprintf("Duplicate %s definition", kind),
		Detail:   fmt.Sprintf("A %s named %q was already defined at %s. Names must be unique within a module.", kind, name, prev),
		Subject:  cur.Ptr(),
	}
}

func (m *Module) decodeTerraformBlock(block *hcl.Block) hcl.Diagnostics {
	content, diags := block.Body.Content(terraformBlockSchema)
	for _, b := range content.Blocks {
		switch b.Type {
		case "required_providers":
			attrs, d := b.Body.JustAttributes()
			diags = append(diags, d...)
			for name, attr := range attrs {
				rp := &RequiredProvider{Name: name, Source: "hashicorp/" + name, Range: attr.Range}
				if pairs, d := hcl.ExprMap(attr.Expr); !d.HasErrors() {
					for _, kv := range pairs {
						key := hcl.ExprAsKeyword(kv.Key)
						if key == "" {
							if v, d := kv.Key.Value(nil); !d.HasErrors() && v.Type() == cty.String {
								key = v.AsString()
							}
						}
						switch key {
						case "source", "version":
							v, d := kv.Value.Value(nil)
							diags = append(diags, d...)
							if !d.HasErrors() && v.Type() == cty.String && v.IsKnown() && !v.IsNull() {
								if key == "source" {
									rp.Source = normalizeSource(v.AsString())
								} else {
									rp.Version = v.AsString()
								}
							}
						}
					}
				} else if v, d := attr.Expr.Value(nil); !d.HasErrors() && v.Type() == cty.String {
					rp.Version = v.AsString()
				}
				m.RequiredProviders[name] = rp
			}
		case "backend":
			m.Backend = b.Labels[0]
		case "cloud":
			m.Backend = "cloud"
		}
	}
	return diags
}

func normalizeSource(s string) string {
	s = strings.TrimPrefix(s, "registry.terraform.io/")
	s = strings.TrimPrefix(s, "registry.opentofu.org/")
	if !strings.Contains(s, "/") {
		s = "hashicorp/" + s
	}
	return strings.ToLower(s)
}

func (m *Module) decodeProvider(block *hcl.Block) hcl.Diagnostics {
	content, remain, diags := block.Body.PartialContent(providerMetaSchema)
	pc := &ProviderConfig{Name: block.Labels[0], Config: remain, DeclRange: block.DefRange}
	if attr, ok := content.Attributes["alias"]; ok {
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &pc.Alias)...)
	}
	if prev, ok := m.ProviderConfigs[pc.Key()]; ok {
		diags = append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Duplicate provider configuration",
			Detail:   fmt.Sprintf("A default (non-aliased) provider configuration for %q was already given at %s. If multiple configurations are required, set the \"alias\" argument for alternative configurations.", pc.Name, prev.DeclRange),
			Subject:  block.DefRange.Ptr(),
		})
		return diags
	}
	m.ProviderConfigs[pc.Key()] = pc
	return diags
}

func decodeVariable(block *hcl.Block) (*Variable, hcl.Diagnostics) {
	v := &Variable{Name: block.Labels[0], Type: cty.DynamicPseudoType, Nullable: true, DeclRange: block.DefRange}
	if !hclsyntax.ValidIdentifier(v.Name) {
		return nil, hcl.Diagnostics{{Severity: hcl.DiagError, Summary: "Invalid variable name", Detail: "A name must start with a letter or underscore and may contain only letters, digits, underscores, and dashes.", Subject: block.LabelRanges[0].Ptr()}}
	}
	content, diags := block.Body.Content(variableBlockSchema)
	if attr, ok := content.Attributes["type"]; ok {
		t, defaults, d := typeexpr.TypeConstraintWithDefaults(attr.Expr)
		diags = append(diags, d...)
		if !d.HasErrors() {
			v.Type, v.Defaults = t, defaults
		}
	}
	if attr, ok := content.Attributes["description"]; ok {
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &v.Description)...)
	}
	if attr, ok := content.Attributes["sensitive"]; ok {
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &v.Sensitive)...)
	}
	if attr, ok := content.Attributes["nullable"]; ok {
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &v.Nullable)...)
	}
	if attr, ok := content.Attributes["default"]; ok {
		val, d := attr.Expr.Value(nil)
		diags = append(diags, d...)
		if !d.HasErrors() {
			if v.Defaults != nil {
				val = v.Defaults.Apply(val)
			}
			conv, err := convertTo(val, v.Type)
			if err != nil {
				diags = append(diags, &hcl.Diagnostic{
					Severity: hcl.DiagError,
					Summary:  "Invalid default value for variable",
					Detail:   fmt.Sprintf("This default value is not compatible with the variable's type constraint: %s.", err),
					Subject:  attr.Expr.Range().Ptr(),
				})
			} else {
				v.Default, v.HasDefault = conv, true
			}
		}
	}
	for _, b := range content.Blocks {
		cr, d := decodeCheckRule(b)
		diags = append(diags, d...)
		if cr != nil {
			v.Validations = append(v.Validations, cr)
		}
	}
	return v, diags
}

func decodeCheckRule(block *hcl.Block) (*CheckRule, hcl.Diagnostics) {
	content, diags := block.Body.Content(checkRuleSchema)
	if diags.HasErrors() {
		return nil, diags
	}
	return &CheckRule{
		Condition:    content.Attributes["condition"].Expr,
		ErrorMessage: content.Attributes["error_message"].Expr,
		DeclRange:    block.DefRange,
	}, diags
}

func decodeOutput(block *hcl.Block) (*Output, hcl.Diagnostics) {
	o := &Output{Name: block.Labels[0], DeclRange: block.DefRange}
	content, diags := block.Body.Content(outputBlockSchema)
	if attr, ok := content.Attributes["value"]; ok {
		o.Expr = attr.Expr
	} else {
		return nil, diags
	}
	if attr, ok := content.Attributes["description"]; ok {
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &o.Description)...)
	}
	if attr, ok := content.Attributes["sensitive"]; ok {
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &o.Sensitive)...)
	}
	if attr, ok := content.Attributes["depends_on"]; ok {
		t, d := decodeDependsOn(attr)
		diags = append(diags, d...)
		o.DependsOn = t
	}
	for _, b := range content.Blocks {
		cr, d := decodeCheckRule(b)
		diags = append(diags, d...)
		if cr != nil {
			o.Preconditions = append(o.Preconditions, cr)
		}
	}
	return o, diags
}

func decodeDependsOn(attr *hcl.Attribute) ([]hcl.Traversal, hcl.Diagnostics) {
	exprs, diags := hcl.ExprList(attr.Expr)
	var out []hcl.Traversal
	for _, e := range exprs {
		t, d := hcl.AbsTraversalForExpr(e)
		diags = append(diags, d...)
		if !d.HasErrors() {
			out = append(out, t)
		}
	}
	return out, diags
}

func decodeResource(block *hcl.Block) (*Resource, hcl.Diagnostics) {
	r := &Resource{Mode: "managed", Type: block.Labels[0], Name: block.Labels[1], DeclRange: block.DefRange, TypeRange: block.LabelRanges[0]}
	if block.Type == "data" {
		r.Mode = "data"
	}
	var diags hcl.Diagnostics
	if !hclsyntax.ValidIdentifier(r.Name) {
		diags = append(diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Invalid resource name", Detail: "A name must start with a letter or underscore and may contain only letters, digits, underscores, and dashes.", Subject: block.LabelRanges[1].Ptr()})
	}
	content, remain, d := block.Body.PartialContent(resourceMetaSchema)
	diags = append(diags, d...)
	r.Config = remain
	if attr, ok := content.Attributes["count"]; ok {
		r.Count = attr.Expr
	}
	if attr, ok := content.Attributes["for_each"]; ok {
		r.ForEach = attr.Expr
	}
	if r.Count != nil && r.ForEach != nil {
		diags = append(diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: `Invalid combination of "count" and "for_each"`, Detail: `The "count" and "for_each" meta-arguments are mutually-exclusive, only one should be used to be explicit about the number of resources to be created.`, Subject: content.Attributes["for_each"].NameRange.Ptr()})
	}
	if attr, ok := content.Attributes["provider"]; ok {
		t, d := hcl.AbsTraversalForExpr(attr.Expr)
		diags = append(diags, d...)
		if !d.HasErrors() {
			r.ProviderRef = traversalString(t)
		}
	}
	if attr, ok := content.Attributes["depends_on"]; ok {
		t, d := decodeDependsOn(attr)
		diags = append(diags, d...)
		r.DependsOn = t
	}
	for _, b := range content.Blocks {
		switch b.Type {
		case "lifecycle":
			lc, d := b.Body.Content(lifecycleSchema)
			diags = append(diags, d...)
			if attr, ok := lc.Attributes["create_before_destroy"]; ok {
				diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &r.CreateBeforeDestroy)...)
			}
			if attr, ok := lc.Attributes["prevent_destroy"]; ok {
				diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &r.PreventDestroy)...)
			}
			if attr, ok := lc.Attributes["ignore_changes"]; ok {
				if hcl.ExprAsKeyword(attr.Expr) == "all" {
					r.IgnoreAll = true
				} else {
					exprs, d := hcl.ExprList(attr.Expr)
					diags = append(diags, d...)
					for _, e := range exprs {
						t, d := hcl.RelTraversalForExpr(e)
						diags = append(diags, d...)
						if !d.HasErrors() {
							r.IgnoreChanges = append(r.IgnoreChanges, t)
						}
					}
				}
			}
			if attr, ok := lc.Attributes["replace_triggered_by"]; ok {
				exprs, d := hcl.ExprList(attr.Expr)
				diags = append(diags, d...)
				r.ReplaceTriggeredBy = exprs
			}
			for _, cb := range lc.Blocks {
				cr, d := decodeCheckRule(cb)
				diags = append(diags, d...)
				if cr == nil {
					continue
				}
				if cb.Type == "precondition" {
					r.Preconditions = append(r.Preconditions, cr)
				} else {
					r.Postconditions = append(r.Postconditions, cr)
				}
			}
		case "provisioner", "connection":
			r.HasProvisioners = true
		}
	}
	return r, diags
}

func decodeModuleCall(block *hcl.Block) (*ModuleCall, hcl.Diagnostics) {
	mc := &ModuleCall{Name: block.Labels[0], DeclRange: block.DefRange}
	content, remain, diags := block.Body.PartialContent(moduleMetaSchema)
	if attr, ok := content.Attributes["source"]; ok {
		mc.SourceRange = attr.Expr.Range()
		diags = append(diags, gohcl.DecodeExpression(attr.Expr, nil, &mc.Source)...)
	}
	if attr, ok := content.Attributes["count"]; ok {
		mc.Count = attr.Expr
	}
	if attr, ok := content.Attributes["for_each"]; ok {
		mc.ForEach = attr.Expr
	}
	if attr, ok := content.Attributes["depends_on"]; ok {
		t, d := decodeDependsOn(attr)
		diags = append(diags, d...)
		mc.DependsOn = t
	}
	attrs, d := remain.JustAttributes()
	diags = append(diags, d...)
	mc.Inputs = attrs
	if diags.HasErrors() && mc.Source == "" {
		return nil, diags
	}
	return mc, diags
}

func decodeMoved(block *hcl.Block) (*Moved, hcl.Diagnostics) {
	content, diags := block.Body.Content(movedSchema)
	if diags.HasErrors() {
		return nil, diags
	}
	from, d := hcl.AbsTraversalForExpr(content.Attributes["from"].Expr)
	diags = append(diags, d...)
	to, d := hcl.AbsTraversalForExpr(content.Attributes["to"].Expr)
	diags = append(diags, d...)
	if diags.HasErrors() {
		return nil, diags
	}
	return &Moved{From: traversalString(from), To: traversalString(to), DeclRange: block.DefRange}, diags
}

// traversalString renders a traversal as an address: aws_instance.web[0].
func traversalString(t hcl.Traversal) string {
	var sb strings.Builder
	for i, step := range t {
		switch s := step.(type) {
		case hcl.TraverseRoot:
			sb.WriteString(s.Name)
		case hcl.TraverseAttr:
			if i > 0 {
				sb.WriteByte('.')
			}
			sb.WriteString(s.Name)
		case hcl.TraverseIndex:
			sb.WriteString(indexString(s.Key))
		}
	}
	return sb.String()
}

func indexString(k cty.Value) string {
	if k.Type() == cty.String {
		return fmt.Sprintf("[%q]", k.AsString())
	}
	if k.Type() == cty.Number {
		bf := k.AsBigFloat()
		return "[" + bf.Text('f', -1) + "]"
	}
	return "[?]"
}
