package engine

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/ext/dynblock"
	"github.com/hashicorp/hcl/v2/hcldec"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
	"github.com/zclconf/go-cty/cty/convert"
	"github.com/zclconf/go-cty/cty/function"
	ctyjson "github.com/zclconf/go-cty/cty/json"
)

type Action string

const (
	ActNoOp       Action = "no-op"
	ActCreate     Action = "create"
	ActRead       Action = "read"
	ActUpdate     Action = "update"
	ActDelete     Action = "delete"
	ActReplace    Action = "delete-create"
	ActReplaceCBD Action = "create-delete"
)

func (a Action) isReplace() bool { return a == ActReplace || a == ActReplaceCBD }

// Change is the planned change for one resource instance.
type Change struct {
	Addr           string
	PrevAddr       string
	Module         string
	Mode           string
	Type           string
	Name           string
	Key            cty.Value
	Action         Action
	Before         cty.Value
	After          cty.Value
	Schema         *Block
	ReplacePaths   []cty.Path
	SensitivePaths []cty.Path
	Reason         string
	ProviderAddr   string
	ProviderSource string
	Deps           []string
	CBD            bool
}

type OutputChange struct {
	Name      string
	Action    Action
	Before    cty.Value
	After     cty.Value
	Sensitive bool
}

type providerCtx struct {
	Name   string // local name
	Source string // hashicorp/aws
	Alias  string
	Schema *ProviderSchema
	Config cty.Value
}

func (p *providerCtx) addr() string {
	return providerAddrString(p.Source, p.Alias)
}

type evaluator struct {
	cfg        *Config
	files      map[string]string
	providers  map[string]*ProviderSchema
	prior      *State
	next       *State
	applying   bool
	destroy    bool
	validating bool
	now        time.Time
	workspace  string
	varFlags   map[string]string

	rootInputs map[string]cty.Value

	changes       []*Change
	changeByAddr  map[string]*Change
	outputChanges []*OutputChange
	diags         hcl.Diagnostics
	visited       map[string]bool
	prevAddr      map[string]string // new -> old (moved blocks)
	log           []string
	funcCache     map[string]map[string]function.Function
	rootOutputs   map[string]cty.Value
	rootOutSens   map[string]bool
	warnedRegion  bool
}

type modInstance struct {
	e         *evaluator
	mod       *Module
	prefix    string // "" or "module.net." / "module.net[0]."
	inputs    map[string]cty.Value
	vars      map[string]cty.Value
	locals    map[string]cty.Value
	outputs   map[string]cty.Value
	calls     map[string]cty.Value
	resources map[string]cty.Value
	providers map[string]*providerCtx
	graph     *moduleGraph
	failed    map[string]bool
}

func (mi *modInstance) statePath() string {
	return strings.TrimSuffix(mi.prefix, ".")
}

func newModInstance(e *evaluator, mod *Module, prefix string, inputs map[string]cty.Value, parentProviders map[string]*providerCtx) *modInstance {
	mi := &modInstance{
		e: e, mod: mod, prefix: prefix, inputs: inputs,
		vars: map[string]cty.Value{}, locals: map[string]cty.Value{}, outputs: map[string]cty.Value{},
		calls: map[string]cty.Value{}, resources: map[string]cty.Value{},
		providers: map[string]*providerCtx{}, failed: map[string]bool{},
	}
	for k, v := range parentProviders {
		mi.providers[k] = v
	}
	return mi
}

func objectOf(m map[string]cty.Value) cty.Value {
	if len(m) == 0 {
		return cty.EmptyObjectVal
	}
	return cty.ObjectVal(m)
}

func (e *evaluator) funcs(dir string) map[string]function.Function {
	if e.funcCache == nil {
		e.funcCache = map[string]map[string]function.Function{}
	}
	if f, ok := e.funcCache[dir]; ok {
		return f
	}
	f := e.functions(dir)
	e.funcCache[dir] = f
	return f
}

func (mi *modInstance) ctx(extra map[string]cty.Value) *hcl.EvalContext {
	dir := mi.mod.Dir
	if dir == "" {
		dir = "."
	}
	vars := map[string]cty.Value{
		"var":    objectOf(mi.vars),
		"local":  objectOf(mi.locals),
		"module": objectOf(mi.calls),
		"path": cty.ObjectVal(map[string]cty.Value{
			"module": cty.StringVal(dir),
			"root":   cty.StringVal("."),
			"cwd":    cty.StringVal("."),
		}),
		"terraform": cty.ObjectVal(map[string]cty.Value{"workspace": cty.StringVal(mi.e.workspace)}),
	}
	managed := map[string]map[string]cty.Value{}
	data := map[string]map[string]cty.Value{}
	for key, v := range mi.resources {
		parts := strings.SplitN(key, ".", 3)
		if parts[0] == "data" {
			if data[parts[1]] == nil {
				data[parts[1]] = map[string]cty.Value{}
			}
			data[parts[1]][parts[2]] = v
		} else {
			if managed[parts[0]] == nil {
				managed[parts[0]] = map[string]cty.Value{}
			}
			managed[parts[0]][parts[1]] = v
		}
	}
	for t, m := range managed {
		vars[t] = cty.ObjectVal(m)
	}
	dataObj := map[string]cty.Value{}
	for t, m := range data {
		dataObj[t] = cty.ObjectVal(m)
	}
	vars["data"] = objectOf(dataObj)
	for k, v := range extra {
		vars[k] = v
	}
	return &hcl.EvalContext{Variables: vars, Functions: mi.e.funcs(mi.mod.Dir)}
}

// --- walk ---

func (e *evaluator) walkModule(mi *modInstance) {
	g, diags := mi.mod.buildGraph()
	e.diags = append(e.diags, diags...)
	mi.graph = g
	if g.Cyclic {
		return
	}
	for _, id := range g.Order {
		node := g.Nodes[id]
		skip := node.Invalid
		for d := range node.Deps {
			if mi.failed[d] {
				skip = true
				break
			}
		}
		before := len(e.diags)
		ok := true
		switch node.Kind {
		case "variable":
			if !skip {
				ok = e.evalVariable(mi, mi.mod.Variables[strings.TrimPrefix(id, "var.")])
			}
		case "local":
			if !skip {
				ok = e.evalLocal(mi, mi.mod.Locals[strings.TrimPrefix(id, "local.")])
			}
		case "provider":
			if !skip {
				ok = e.evalProvider(mi, strings.TrimPrefix(id, "provider."))
			}
		case "resource", "data":
			if !skip {
				ok = e.evalResource(mi, mi.mod.Resources[id])
			}
		case "module":
			if !skip {
				ok = e.evalModuleCall(mi, mi.mod.ModuleCalls[strings.TrimPrefix(id, "module.")])
			}
		case "output":
			if !skip {
				ok = e.evalOutput(mi, mi.mod.Outputs[strings.TrimPrefix(id, "output.")])
			}
		}
		if skip || !ok || hasErrorsSince(e.diags, before) {
			mi.failed[id] = true
			mi.setUnknown(id, node.Kind)
		}
	}
}

func hasErrorsSince(d hcl.Diagnostics, i int) bool {
	for _, x := range d[i:] {
		if x.Severity == hcl.DiagError {
			return true
		}
	}
	return false
}

func (mi *modInstance) setUnknown(id, kind string) {
	switch kind {
	case "variable":
		mi.vars[strings.TrimPrefix(id, "var.")] = cty.DynamicVal
	case "local":
		mi.locals[strings.TrimPrefix(id, "local.")] = cty.DynamicVal
	case "resource", "data":
		mi.resources[id] = cty.DynamicVal
	case "module":
		mi.calls[strings.TrimPrefix(id, "module.")] = cty.DynamicVal
	case "output":
		mi.outputs[strings.TrimPrefix(id, "output.")] = cty.DynamicVal
	}
}

// --- variables, locals, outputs ---

func (e *evaluator) evalVariable(mi *modInstance, v *Variable) bool {
	val, given := mi.inputs[v.Name]
	if raw, ok := e.varFlags[v.Name]; ok && mi.prefix == "" {
		parsed, diags := parseVarFlag(v, raw)
		if diags.HasErrors() {
			e.diags = append(e.diags, diags...)
			return false
		}
		val, given = parsed, true
	}
	if !given || (val.IsNull() && !v.Nullable) {
		switch {
		case v.HasDefault:
			val = v.Default
		case !given && mi.prefix == "":
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "No value for required variable",
				Detail:   fmt.Sprintf("The root module input variable %q is not set, and has no default value. Use a -var or -var-file command line argument (or a terraform.tfvars file) to provide a value for this variable.", v.Name),
				Subject:  v.DeclRange.Ptr(),
			})
			return false
		case !given:
			// reported by the module call
			return false
		default:
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Required variable not set",
				Detail:   fmt.Sprintf("The variable %q is required and may not be set to null.", v.Name),
				Subject:  v.DeclRange.Ptr(),
			})
			return false
		}
	}
	if v.Defaults != nil {
		val = v.Defaults.Apply(val)
	}
	conv, err := convertTo(val, v.Type)
	if err != nil {
		e.diags = append(e.diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Invalid value for input variable",
			Detail:   fmt.Sprintf("The given value is not suitable for var.%s declared at %s: %s.", v.Name, rangeShort(v.DeclRange), err),
			Subject:  v.DeclRange.Ptr(),
		})
		return false
	}
	if v.Sensitive {
		conv = conv.Mark(markSensitive)
	}
	mi.vars[v.Name] = conv
	for _, cr := range v.Validations {
		if !e.checkRule(mi, cr, nil, "Invalid value for variable", v.DeclRange.Ptr(), true) {
			return false
		}
	}
	return true
}

func parseVarFlag(v *Variable, raw string) (cty.Value, hcl.Diagnostics) {
	if v.Type.IsPrimitiveType() || v.Type == cty.DynamicPseudoType && !strings.ContainsAny(raw, "[{\"") {
		return cty.StringVal(raw), nil
	}
	expr, diags := hclsyntax.ParseExpression([]byte(raw), "<value for var."+v.Name+">", hcl.InitialPos)
	if diags.HasErrors() {
		return cty.NilVal, diags
	}
	val, diags := expr.Value(nil)
	return val, diags
}

// checkRule evaluates a validation / precondition / postcondition. subject
// is where the error points; validation adds the "checked by" note.
func (e *evaluator) checkRule(mi *modInstance, cr *CheckRule, extra map[string]cty.Value, summary string, subject *hcl.Range, validation bool) bool {
	ctx := mi.ctx(extra)
	cond, diags := cr.Condition.Value(ctx)
	e.diags = append(e.diags, diags...)
	if diags.HasErrors() {
		return false
	}
	cond, _ = cond.UnmarkDeep()
	if !cond.IsKnown() {
		return true
	}
	cond, err := convert.Convert(cond, cty.Bool)
	if err != nil || cond.IsNull() {
		e.diags = append(e.diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Invalid condition result",
			Detail:   "The condition expression must return either true or false.",
			Subject:  cr.Condition.Range().Ptr(),
		})
		return false
	}
	if cond.True() {
		return true
	}
	msg := "(error message could not be evaluated)"
	if mv, d := cr.ErrorMessage.Value(ctx); !d.HasErrors() {
		mv, _ = mv.UnmarkDeep()
		if mv.Type() == cty.String && mv.IsKnown() && !mv.IsNull() {
			msg = mv.AsString()
		}
	}
	if validation {
		msg += fmt.Sprintf("\n\nThis was checked by the validation rule at %s.", cr.DeclRange.String())
	}
	if subject == nil {
		subject = cr.Condition.Range().Ptr()
	}
	e.diags = append(e.diags, &hcl.Diagnostic{
		Severity:    hcl.DiagError,
		Summary:     summary,
		Detail:      msg,
		Subject:     subject,
		Expression:  cr.Condition,
		EvalContext: ctx,
	})
	return false
}

func (e *evaluator) evalLocal(mi *modInstance, l *Local) bool {
	v, diags := l.Expr.Value(mi.ctx(nil))
	e.diags = append(e.diags, diags...)
	if diags.HasErrors() {
		return false
	}
	mi.locals[l.Name] = v
	return true
}

func (e *evaluator) evalOutput(mi *modInstance, o *Output) bool {
	for _, cr := range o.Preconditions {
		if !e.checkRule(mi, cr, nil, "Module output value precondition failed", nil, false) {
			return false
		}
	}
	v, diags := o.Expr.Value(mi.ctx(nil))
	e.diags = append(e.diags, diags...)
	if diags.HasErrors() {
		return false
	}
	if mi.prefix == "" && !o.Sensitive && containsSensitive(v) {
		e.diags = append(e.diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Output refers to sensitive values",
			Detail: "To reduce the risk of accidentally exporting sensitive data that was intended to be only internal, Terraform requires that any root module output containing sensitive data be explicitly marked as sensitive, to confirm your intent.\n\n" +
				"If you do intend to export this data, annotate the output value as sensitive by adding the following argument:\n    sensitive = true",
			Subject: o.DeclRange.Ptr(),
		})
		return false
	}
	if o.Sensitive {
		v = v.Mark(markSensitive)
	}
	mi.outputs[o.Name] = v
	if mi.prefix == "" {
		e.rootOutputs[o.Name] = v
		e.rootOutSens[o.Name] = o.Sensitive
	}
	return true
}

// --- providers ---

func (e *evaluator) providerSourceFor(mod *Module, name string) string {
	if name == "terraform" {
		return builtinTerraformSource
	}
	if rp, ok := mod.RequiredProviders[name]; ok {
		return rp.Source
	}
	return "hashicorp/" + name
}

func (e *evaluator) evalProvider(mi *modInstance, key string) bool {
	pc := mi.mod.ProviderConfigs[key]
	source := e.providerSourceFor(mi.mod, pc.Name)
	ps := e.providers[source]
	if ps == nil {
		// reported globally by checkProvidersInstalled
		return false
	}
	body := dynblock.Expand(pc.Config, mi.ctx(nil))
	val, diags := hcldec.Decode(body, ps.Provider.DecoderSpec(), mi.ctx(nil))
	e.diags = append(e.diags, diags...)
	if diags.HasErrors() {
		return false
	}
	val, _ = val.UnmarkDeep()
	mi.providers[key] = &providerCtx{Name: pc.Name, Source: source, Alias: pc.Alias, Schema: ps, Config: completeObject(ps.Provider, val)}
	return true
}

func (e *evaluator) providerFor(mi *modInstance, r *Resource) (*providerCtx, *hcl.Diagnostic) {
	key := r.providerKey()
	if p, ok := mi.providers[key]; ok {
		return p, nil
	}
	name := key
	alias := ""
	if i := strings.IndexByte(key, '.'); i >= 0 {
		name, alias = key[:i], key[i+1:]
	}
	if alias != "" {
		return nil, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Provider configuration not present",
			Detail:   fmt.Sprintf("To work with %s its original provider configuration at provider[%q].%s is required, but it has been removed or was never declared.", r.Key(), "registry.terraform.io/"+e.providerSourceFor(mi.mod, name), alias),
			Subject:  r.DeclRange.Ptr(),
		}
	}
	source := e.providerSourceFor(mi.mod, name)
	ps := e.providers[source]
	if ps == nil {
		return nil, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Missing required provider",
			Detail:   fmt.Sprintf("This configuration requires provider %s, but that provider isn't available. Run \"terraform init\" to install it.", registryAddr(source)),
			Subject:  r.DeclRange.Ptr(),
		}
	}
	// Implicit empty provider configuration.
	p := &providerCtx{Name: name, Source: source, Schema: ps, Config: completeObject(ps.Provider, cty.NullVal(ps.Provider.ImpliedType()))}
	mi.providers[key] = p
	return p, nil
}

// --- module calls ---

type instKey struct {
	Key  cty.Value // NilVal, number or string
	Each cty.Value // each.value
}

func (k instKey) extra() map[string]cty.Value {
	if k.Key == cty.NilVal {
		return nil
	}
	if k.Key.Type() == cty.Number {
		return map[string]cty.Value{"count": cty.ObjectVal(map[string]cty.Value{"index": k.Key})}
	}
	return map[string]cty.Value{"each": cty.ObjectVal(map[string]cty.Value{"key": k.Key, "value": k.Each})}
}

func (k instKey) String() string {
	if k.Key == cty.NilVal || !k.Key.IsKnown() {
		return ""
	}
	return indexString(k.Key)
}

// expand evaluates count / for_each. mode is "", "count" or "for_each".
func (e *evaluator) expand(mi *modInstance, count, forEach hcl.Expression, what string) ([]instKey, string, bool) {
	ctx := mi.ctx(nil)
	switch {
	case count != nil:
		v, diags := count.Value(ctx)
		e.diags = append(e.diags, diags...)
		if diags.HasErrors() {
			return nil, "count", false
		}
		v, _ = v.UnmarkDeep()
		if !v.IsKnown() && e.validating {
			return []instKey{{Key: cty.UnknownVal(cty.Number)}}, "unknown", true
		}
		if !v.IsKnown() {
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Invalid count argument",
				Detail:   "The \"count\" value depends on resource attributes that cannot be determined until apply, so Terraform cannot predict how many instances will be created. To work around this, use the -target argument to first apply only the resources that the count depends on.",
				Subject:  count.Range().Ptr(),
			})
			return nil, "count", false
		}
		nv, err := convert.Convert(v, cty.Number)
		var n int
		if err == nil && !nv.IsNull() {
			err = gocty(nv, &n)
		}
		if err != nil || nv.IsNull() || n < 0 {
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Invalid count argument",
				Detail:   "The given \"count\" argument value is unsuitable: must be a whole number greater than or equal to zero.",
				Subject:  count.Range().Ptr(),
			})
			return nil, "count", false
		}
		keys := make([]instKey, n)
		for i := range keys {
			keys[i] = instKey{Key: cty.NumberIntVal(int64(i))}
		}
		return keys, "count", true
	case forEach != nil:
		v, diags := forEach.Value(ctx)
		e.diags = append(e.diags, diags...)
		if diags.HasErrors() {
			return nil, "for_each", false
		}
		if v.HasMark(markSensitive) {
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Invalid for_each argument",
				Detail:   "Sensitive values, or values derived from sensitive values, cannot be used as for_each arguments. If used, the sensitive value could be exposed as a resource instance key.",
				Subject:  forEach.Range().Ptr(),
			})
			return nil, "for_each", false
		}
		v, _ = v.UnmarkDeep()
		if e.validating && !v.IsWhollyKnown() {
			return []instKey{{Key: cty.UnknownVal(cty.String), Each: cty.DynamicVal}}, "unknown", true
		}
		ty := v.Type()
		if v.IsNull() {
			e.diags = append(e.diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Invalid for_each argument", Detail: "The given \"for_each\" argument value is unsuitable: the given \"for_each\" argument value is null. A map, or set of strings is allowed.", Subject: forEach.Range().Ptr()})
			return nil, "for_each", false
		}
		if !(ty.IsMapType() || ty.IsObjectType() || ty.IsSetType()) {
			e.diags = append(e.diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Invalid for_each argument", Detail: fmt.Sprintf("The given \"for_each\" argument value is unsuitable: the \"for_each\" argument must be a map, or set of strings, and you have provided a value of type %s.", ty.FriendlyName()), Subject: forEach.Range().Ptr()})
			return nil, "for_each", false
		}
		if !v.IsKnown() || (ty.IsSetType() && !v.IsWhollyKnown()) {
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Invalid for_each argument",
				Detail:   "The \"for_each\" map includes keys or set values that cannot be determined until apply, and so Terraform cannot determine the full set of keys that will identify the instances of this resource.\n\nWhen working with unknown values in for_each, it's better to define the map keys statically in your configuration and place apply-time results only in the map values.",
				Subject:  forEach.Range().Ptr(),
			})
			return nil, "for_each", false
		}
		var keys []instKey
		if ty.IsSetType() {
			if !ty.ElementType().Equals(cty.String) {
				if conv, err := convert.Convert(v, cty.Set(cty.String)); err == nil {
					v = conv
				} else {
					e.diags = append(e.diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Invalid for_each set argument", Detail: fmt.Sprintf("The given \"for_each\" argument value is unsuitable: \"for_each\" supports maps and sets of strings, but you have provided a set containing type %s.", ty.ElementType().FriendlyName()), Subject: forEach.Range().Ptr()})
					return nil, "for_each", false
				}
			}
			for it := v.ElementIterator(); it.Next(); {
				_, ev := it.Element()
				if ev.IsNull() {
					e.diags = append(e.diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Invalid for_each set argument", Detail: "The given \"for_each\" argument value is unsuitable: \"for_each\" sets must not contain null values.", Subject: forEach.Range().Ptr()})
					return nil, "for_each", false
				}
				keys = append(keys, instKey{Key: ev, Each: ev})
			}
		} else {
			for it := v.ElementIterator(); it.Next(); {
				k, ev := it.Element()
				keys = append(keys, instKey{Key: k, Each: ev})
			}
		}
		sort.Slice(keys, func(i, j int) bool { return keys[i].Key.AsString() < keys[j].Key.AsString() })
		return keys, "for_each", true
	}
	return []instKey{{Key: cty.NilVal}}, "", true
}

func assemble(mode string, keys []instKey, vals []cty.Value) cty.Value {
	switch mode {
	case "unknown":
		// validate with an unknown count / for_each: the shape is unknown too
		return cty.DynamicVal
	case "count":
		if len(vals) == 0 {
			return cty.EmptyTupleVal
		}
		return cty.TupleVal(vals)
	case "for_each":
		if len(vals) == 0 {
			return cty.EmptyObjectVal
		}
		m := map[string]cty.Value{}
		for i, k := range keys {
			m[k.Key.AsString()] = vals[i]
		}
		return cty.ObjectVal(m)
	}
	if len(vals) == 1 {
		return vals[0]
	}
	return cty.DynamicVal
}

func (e *evaluator) evalModuleCall(mi *modInstance, mc *ModuleCall) bool {
	child := mi.mod.Children[mc.Name]
	if child == nil {
		return false
	}
	keys, mode, ok := e.expand(mi, mc.Count, mc.ForEach, "module")
	if !ok {
		return false
	}
	var vals []cty.Value
	good := true
	for _, k := range keys {
		ctx := mi.ctx(k.extra())
		inputs := map[string]cty.Value{}
		names := make([]string, 0, len(mc.Inputs))
		for n := range mc.Inputs {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, name := range names {
			attr := mc.Inputs[name]
			if _, ok := child.Variables[name]; !ok {
				e.diags = append(e.diags, &hcl.Diagnostic{
					Severity: hcl.DiagError,
					Summary:  "Unsupported argument",
					Detail:   fmt.Sprintf("An argument named %q is not expected here.", name),
					Subject:  attr.NameRange.Ptr(),
				})
				good = false
				continue
			}
			v, diags := attr.Expr.Value(ctx)
			e.diags = append(e.diags, diags...)
			if diags.HasErrors() {
				good = false
				continue
			}
			inputs[name] = v
		}
		for name, v := range child.Variables {
			if _, ok := inputs[name]; !ok && !v.HasDefault {
				e.diags = append(e.diags, &hcl.Diagnostic{
					Severity: hcl.DiagError,
					Summary:  "Missing required argument",
					Detail:   fmt.Sprintf("The argument %q is required, but no definition was found.", name),
					Subject:  mc.DeclRange.Ptr(),
				})
				good = false
			}
		}
		if !good {
			return false
		}
		cmi := newModInstance(e, child, mi.prefix+"module."+mc.Name+k.String()+".", inputs, mi.providers)
		e.walkModule(cmi)
		vals = append(vals, objectOf(cmi.outputs))
	}
	mi.calls[mc.Name] = assemble(mode, keys, vals)
	return true
}

// --- resources ---

func (e *evaluator) evalResource(mi *modInstance, r *Resource) bool {
	p, d := e.providerFor(mi, r)
	if d != nil {
		e.diags = append(e.diags, d)
		return false
	}
	var schema *Block
	var err error
	if r.Mode == "data" {
		schema, err = p.Schema.DataSource(r.Type)
	} else {
		schema, err = p.Schema.Resource(r.Type)
	}
	if err != nil {
		e.diags = append(e.diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Invalid provider schema", Detail: err.Error(), Subject: r.TypeRange.Ptr()})
		return false
	}
	if schema == nil {
		e.diags = append(e.diags, e.unknownTypeDiag(p, r))
		return false
	}
	keys, mode, ok := e.expand(mi, r.Count, r.ForEach, "resource")
	if !ok {
		return false
	}
	if r.HasProvisioners && !e.applying {
		e.diags = append(e.diags, &hcl.Diagnostic{
			Severity: hcl.DiagWarning,
			Summary:  "Provisioners are not executed",
			Detail:   "The playground does not run provisioners (local-exec, remote-exec, file); they are ignored.",
			Subject:  r.DeclRange.Ptr(),
		})
	}
	vals := make([]cty.Value, 0, len(keys))
	good := true
	for _, k := range keys {
		var v cty.Value
		var ok bool
		if r.Mode == "data" {
			v, ok = e.evalDataInstance(mi, r, p, schema, k)
		} else {
			v, ok = e.evalManagedInstance(mi, r, p, schema, k, mode)
		}
		if !ok {
			good = false
			v = cty.DynamicVal
		}
		vals = append(vals, v)
	}
	mi.resources[r.Key()] = assemble(mode, keys, vals)
	return good
}

func (e *evaluator) unknownTypeDiag(p *providerCtx, r *Resource) *hcl.Diagnostic {
	kind, list := "resource", p.Schema.ResourceTypes()
	if r.Mode == "data" {
		kind, list = "data source", p.Schema.DataSourceTypes()
	}
	detail := fmt.Sprintf("The provider %s does not support %s type %q.", registryAddr(p.Source), kind, r.Type)
	if s := suggest(r.Type, list); s != "" {
		detail += fmt.Sprintf(" Did you mean %q?", s)
	}
	return &hcl.Diagnostic{
		Severity: hcl.DiagError,
		Summary:  fmt.Sprintf("Invalid %s type", kind),
		Detail:   detail,
		Subject:  r.TypeRange.Ptr(),
	}
}

// decodeConfig evaluates a resource body against its schema.
func (e *evaluator) decodeConfig(mi *modInstance, r *Resource, schema *Block, k instKey) (cty.Value, []cty.Path, bool) {
	ctx := mi.ctx(k.extra())
	body := dynblock.Expand(r.Config, ctx)
	val, diags := hcldec.Decode(body, schema.SpecFor(r.Config), ctx)
	e.diags = append(e.diags, diags...)
	if diags.HasErrors() {
		return cty.NilVal, nil, false
	}
	val, pvm := val.UnmarkDeepWithPaths()
	var sens []cty.Path
	for _, pv := range pvm {
		if _, ok := pv.Marks[markSensitive]; ok {
			sens = append(sens, pv.Path)
		}
	}
	return completeObject(schema, val), sens, true
}

func (e *evaluator) evalManagedInstance(mi *modInstance, r *Resource, p *providerCtx, schema *Block, k instKey, mode string) (cty.Value, bool) {
	addr := mi.prefix + r.Key() + k.String()
	e.visited[addr] = true
	for _, cr := range r.Preconditions {
		if !e.checkRule(mi, cr, k.extra(), "Resource precondition failed", nil, false) {
			return cty.NilVal, false
		}
	}
	config, sens, ok := e.decodeConfig(mi, r, schema, k)
	if !ok {
		return cty.NilVal, false
	}

	implied := schema.ImpliedType()
	prior := cty.NullVal(implied)
	priorInst := e.prior.Instances[addr]
	if priorInst != nil {
		pv, err := decodeAttrs(priorInst.RawAttrs, implied)
		if err != nil {
			e.diags = append(e.diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Invalid resource instance data in state",
				Detail:   fmt.Sprintf("Instance %s data could not be decoded from the state: %s.", addr, err),
			})
			return cty.NilVal, false
		}
		prior = pv
		if !e.applying && !e.destroy {
			e.log = append(e.log, fmt.Sprintf("%s: Refreshing state... [id=%s]", addr, idOf(prior)))
		}
	}

	planned, replace := e.planManaged(p, r, schema, prior, config)

	action := ActNoOp
	switch {
	case prior.IsNull():
		action = ActCreate
	case len(replace) > 0:
		action = ActReplace
		if r.CreateBeforeDestroy {
			action = ActReplaceCBD
		}
	case !valuesEqual(prior, planned):
		action = ActUpdate
	}

	if !prior.IsNull() && action != ActCreate && len(r.ReplaceTriggeredBy) > 0 && !action.isReplace() {
		if trig := e.replaceTriggered(mi, r, k); trig != "" {
			planned, _ = e.planManaged(p, r, schema, cty.NullVal(implied), config)
			action = ActReplace
			if r.CreateBeforeDestroy {
				action = ActReplaceCBD
			}
			replace = nil
			defer func() {
				if c := e.changeByAddr[addr]; c != nil {
					c.Reason = "because of a change in " + trig
				}
			}()
		}
	}

	if r.PreventDestroy && action.isReplace() {
		e.diags = append(e.diags, preventDestroyDiag(addr, r.DeclRange))
		return cty.NilVal, false
	}

	for _, cr := range r.Postconditions {
		self := planned
		if !e.checkRule(mi, cr, mergeExtra(k.extra(), map[string]cty.Value{"self": self}), "Resource postcondition failed", nil, false) {
			return cty.NilVal, false
		}
	}

	change := &Change{
		Addr: addr, PrevAddr: e.prevAddr[addr], Module: mi.statePath(), Mode: "managed", Type: r.Type, Name: r.Name, Key: k.Key,
		Action: action, Before: prior, After: planned, Schema: schema, ReplacePaths: replace,
		SensitivePaths: sens, ProviderAddr: p.addr(), ProviderSource: p.Source, CBD: r.CreateBeforeDestroy,
		Deps: e.resourceDeps(mi, r.Key()),
	}
	e.recordChange(change)

	result := planned
	if e.applying {
		switch action {
		case ActNoOp:
			result = prior
		default:
			result = e.finalize(p, r.Type, addr, r.Name, schema, planned, false)
			e.logApply(change, result)
		}
		raw, err := ctyjson.Marshal(result, implied)
		if err != nil {
			e.diags = append(e.diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Failed to encode state", Detail: err.Error()})
			return cty.NilVal, false
		}
		e.next.Instances[addr] = &InstanceState{
			Module: mi.statePath(), Mode: "managed", Type: r.Type, Name: r.Name, Key: k.Key,
			Provider: p.addr(), SchemaVersion: schema.SchemaVersion, RawAttrs: raw, Value: result,
			Deps: change.Deps, CreateBeforeDestroy: r.CreateBeforeDestroy,
		}
	}
	return markSensitivePaths(schema, result, sens), true
}

func mergeExtra(a, b map[string]cty.Value) map[string]cty.Value {
	out := map[string]cty.Value{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func preventDestroyDiag(addr string, rng hcl.Range) *hcl.Diagnostic {
	return &hcl.Diagnostic{
		Severity: hcl.DiagError,
		Summary:  "Instance cannot be destroyed",
		Detail:   fmt.Sprintf("Resource %s has lifecycle.prevent_destroy set, but the plan calls for this resource to be destroyed. To avoid this error and continue with the plan, either disable lifecycle.prevent_destroy or reduce the scope of the plan using the -target option.", addr),
		Subject:  rng.Ptr(),
	}
}

func (e *evaluator) recordChange(c *Change) {
	e.changes = append(e.changes, c)
	e.changeByAddr[c.Addr] = c
}

// replaceTriggered checks lifecycle.replace_triggered_by.
func (e *evaluator) replaceTriggered(mi *modInstance, r *Resource, k instKey) string {
	for _, expr := range r.ReplaceTriggeredBy {
		for _, t := range expr.Variables() {
			node, _ := mi.mod.resolveRef(t)
			if node == "" || strings.HasPrefix(node, "var.") || strings.HasPrefix(node, "local.") || strings.HasPrefix(node, "module.") {
				continue
			}
			prefix := mi.prefix + node
			// Resolve a literal index if present: aws_x.y[0] or aws_x.y[each.key]
			if len(t) > 2 {
				if idx, ok := t[2].(hcl.TraverseIndex); ok {
					prefix += indexString(idx.Key)
				}
			}
			if _, ok := expr.(*hclsyntax.ScopeTraversalExpr); !ok {
				if v, d := expr.Value(mi.ctx(k.extra())); !d.HasErrors() && !v.IsKnown() {
					return strings.TrimPrefix(prefix, mi.prefix)
				}
			}
			for addr, c := range e.changeByAddr {
				if (addr == prefix || strings.HasPrefix(addr, prefix+"[")) && c.Action != ActNoOp && c.Action != ActRead {
					return c.Addr
				}
			}
		}
	}
	return ""
}

func (e *evaluator) resourceDeps(mi *modInstance, node string) []string {
	if mi.graph == nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	var visit func(id string)
	visit = func(id string) {
		n := mi.graph.Nodes[id]
		if n == nil {
			return
		}
		for d := range n.Deps {
			if seen[d] {
				continue
			}
			seen[d] = true
			if dn := mi.graph.Nodes[d]; dn != nil && dn.Kind == "resource" {
				out = append(out, mi.prefix+d)
			}
			visit(d)
		}
	}
	visit(node)
	sort.Strings(out)
	return out
}

func (e *evaluator) evalDataInstance(mi *modInstance, r *Resource, p *providerCtx, schema *Block, k instKey) (cty.Value, bool) {
	addr := mi.prefix + r.Key() + k.String()
	e.visited[addr] = true
	for _, cr := range r.Preconditions {
		if !e.checkRule(mi, cr, k.extra(), "Resource precondition failed", nil, false) {
			return cty.NilVal, false
		}
	}
	config, sens, ok := e.decodeConfig(mi, r, schema, k)
	if !ok {
		return cty.NilVal, false
	}
	reason := ""
	if !config.IsWhollyKnown() {
		reason = "config refers to values not yet known"
	} else if e.dependsOnPending(mi, r) {
		reason = "depends on a resource or a module with changes pending"
	}
	var result cty.Value
	if reason == "" || e.applying {
		if !e.applying || reason != "" {
			e.log = append(e.log, fmt.Sprintf("%s: Reading...", addr))
		}
		result = e.finalize(p, r.Type, addr, r.Name, schema, proposeBlock(schema, cty.NullVal(schema.ImpliedType()), config), true)
		if !e.applying || reason != "" {
			e.log = append(e.log, fmt.Sprintf("%s: Read complete after 0s [id=%s]", addr, idOf(result)))
		}
		if e.applying && reason != "" {
			e.recordChange(&Change{Addr: addr, Module: mi.statePath(), Mode: "data", Type: r.Type, Name: r.Name, Key: k.Key, Action: ActRead, Schema: schema, After: result, ProviderAddr: p.addr(), ProviderSource: p.Source})
		}
	} else {
		planned := proposeBlock(schema, cty.NullVal(schema.ImpliedType()), config)
		planned = e.planHook(p, r.Type, schema, cty.NullVal(schema.ImpliedType()), config, planned, true)
		e.recordChange(&Change{
			Addr: addr, Module: mi.statePath(), Mode: "data", Type: r.Type, Name: r.Name, Key: k.Key,
			Action: ActRead, Before: cty.NullVal(schema.ImpliedType()), After: planned, Schema: schema,
			SensitivePaths: sens, Reason: reason, ProviderAddr: p.addr(), ProviderSource: p.Source,
		})
		result = planned
	}
	if e.applying {
		raw, err := ctyjson.Marshal(result, schema.ImpliedType())
		if err == nil {
			e.next.Instances[addr] = &InstanceState{
				Module: mi.statePath(), Mode: "data", Type: r.Type, Name: r.Name, Key: k.Key,
				Provider: p.addr(), SchemaVersion: schema.SchemaVersion, RawAttrs: raw, Value: result,
			}
		}
	}
	return markSensitivePaths(schema, result, sens), true
}

func (e *evaluator) dependsOnPending(mi *modInstance, r *Resource) bool {
	for _, dep := range e.resourceDeps(mi, r.Key()) {
		for addr, c := range e.changeByAddr {
			if (addr == dep || strings.HasPrefix(addr, dep+"[")) && c.Action != ActNoOp && c.Mode == "managed" {
				return true
			}
		}
	}
	return false
}

// --- helpers ---

func valuesEqual(a, b cty.Value) bool {
	if a.IsNull() && b.IsNull() {
		return true
	}
	if !a.IsWhollyKnown() || !b.IsWhollyKnown() {
		return false
	}
	eq := a.Equals(b)
	return eq.IsKnown() && eq.True()
}

func idOf(v cty.Value) string {
	if v.IsNull() || !v.IsKnown() || !v.Type().IsObjectType() || !v.Type().HasAttribute("id") {
		return ""
	}
	id := v.GetAttr("id")
	if id.IsNull() || !id.IsKnown() || id.Type() != cty.String {
		return ""
	}
	return id.AsString()
}

func convertTo(v cty.Value, t cty.Type) (cty.Value, error) {
	out, err := convert.Convert(v, t)
	if err != nil {
		if pe, ok := err.(cty.PathError); ok && len(pe.Path) > 0 {
			return cty.NilVal, fmt.Errorf("%s: %s", pathString(pe.Path), pe.Error())
		}
		return cty.NilVal, err
	}
	return out, nil
}

func pathString(p cty.Path) string {
	var sb strings.Builder
	for _, s := range p {
		switch st := s.(type) {
		case cty.GetAttrStep:
			if sb.Len() > 0 {
				sb.WriteByte('.')
			}
			sb.WriteString(st.Name)
		case cty.IndexStep:
			sb.WriteString(indexString(st.Key))
		}
	}
	return sb.String()
}

func rangeShort(r hcl.Range) string {
	return fmt.Sprintf("%s:%d,%d", r.Filename, r.Start.Line, r.Start.Column)
}

func registryAddr(source string) string {
	if strings.Count(source, "/") >= 2 {
		return source
	}
	return "registry.terraform.io/" + source
}

// completeObject fills in every attribute of the schema that is missing from
// a decoded configuration value (computed-only attributes) with null, and
// converts the value to the schema's implied type.
func completeObject(b *Block, v cty.Value) cty.Value {
	ty := b.ImpliedType()
	if v.IsNull() {
		return cty.NullVal(ty)
	}
	if !v.IsKnown() {
		return cty.UnknownVal(ty)
	}
	attrs := map[string]cty.Value{}
	for name, a := range b.Attributes {
		if v.Type().HasAttribute(name) {
			av := v.GetAttr(name)
			if a.Nested != nil {
				av = completeNested(a.Nested, av)
			}
			if c, err := convert.Convert(av, a.ty); err == nil {
				av = c
			}
			if a.Nested == nil && isObjectCollection(a.ty) {
				av = zeroFill(av)
			}
			attrs[name] = av
		} else {
			attrs[name] = cty.NullVal(a.ty)
		}
	}
	for name, nb := range b.Blocks {
		et := ty.AttributeType(name)
		if !v.Type().HasAttribute(name) {
			switch nb.Nesting {
			case "single", "group":
				attrs[name] = cty.NullVal(et)
			case "list":
				attrs[name] = cty.ListValEmpty(et.ElementType())
			case "set":
				attrs[name] = cty.SetValEmpty(et.ElementType())
			case "map":
				attrs[name] = cty.MapValEmpty(et.ElementType())
			default:
				attrs[name] = cty.NullVal(et)
			}
			continue
		}
		attrs[name] = completeNested(nb, v.GetAttr(name))
	}
	out := cty.ObjectVal(attrs)
	if c, err := convert.Convert(out, ty); err == nil {
		return c
	}
	return out
}

func completeNested(nb *NestedBlock, v cty.Value) cty.Value {
	elemTy := nb.Block.ImpliedType()
	if !v.IsKnown() {
		return cty.UnknownVal(wrapNesting(nb.Nesting, elemTy))
	}
	switch nb.Nesting {
	case "single", "group":
		return completeObject(&nb.Block, v)
	case "list", "set":
		if v.IsNull() {
			if nb.Nesting == "set" {
				return cty.NullVal(cty.Set(elemTy))
			}
			return cty.NullVal(cty.List(elemTy))
		}
		var elems []cty.Value
		for it := v.ElementIterator(); it.Next(); {
			_, ev := it.Element()
			elems = append(elems, completeObject(&nb.Block, ev))
		}
		if nb.Nesting == "set" {
			if len(elems) == 0 {
				return cty.SetValEmpty(elemTy)
			}
			return cty.SetVal(elems)
		}
		if len(elems) == 0 {
			return cty.ListValEmpty(elemTy)
		}
		return cty.ListVal(elems)
	case "map":
		if v.IsNull() {
			return cty.NullVal(cty.Map(elemTy))
		}
		m := map[string]cty.Value{}
		for it := v.ElementIterator(); it.Next(); {
			k, ev := it.Element()
			m[k.AsString()] = completeObject(&nb.Block, ev)
		}
		if len(m) == 0 {
			return cty.MapValEmpty(elemTy)
		}
		return cty.MapVal(m)
	}
	return v
}

// suggest returns the closest name by edit distance (for "did you mean").
func suggest(given string, options []string) string {
	best, bestD := "", 4
	for _, o := range options {
		if d := levenshtein(given, o); d < bestD {
			best, bestD = o, d
		}
	}
	return best
}

func levenshtein(a, b string) int {
	if a == b {
		return 0
	}
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(b)]
}
