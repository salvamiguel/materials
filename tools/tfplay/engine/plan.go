package engine

import (
	"github.com/hashicorp/hcl/v2"
	"github.com/zclconf/go-cty/cty"
)

// planManaged computes the planned new value of a managed resource instance
// like a generic SDK provider would: configured values win, unset computed
// attributes keep their prior value (or become unknown on create), schema
// defaults are applied, and ForceNew attributes trigger a replacement.
func (e *evaluator) planManaged(p *providerCtx, r *Resource, schema *Block, prior, config cty.Value) (cty.Value, []cty.Path) {
	if !prior.IsNull() {
		config = applyIgnoreChanges(schema, r, prior, config)
	}
	planned := proposeBlock(schema, prior, config)
	planned = e.planHook(p, r.Type, schema, prior, config, planned, false)
	if prior.IsNull() {
		return planned, nil
	}
	replace := replacePaths(schema, prior, planned, nil)
	if forceNewProvider(p.Source) {
		replace = append(replace, allConfigChanges(schema, prior, planned)...)
	}
	if r.Type == "terraform_data" && p.Source == builtinTerraformSource &&
		!valuesEqual(prior.GetAttr("triggers_replace"), planned.GetAttr("triggers_replace")) {
		// terraform_data replaces itself without flagging the attribute.
		replace = append(replace, cty.Path{})
	}
	if len(replace) == 0 {
		return planned, nil
	}
	// A replacement is planned like a create.
	fresh := proposeBlock(schema, cty.NullVal(schema.ImpliedType()), config)
	fresh = e.planHook(p, r.Type, schema, cty.NullVal(schema.ImpliedType()), config, fresh, false)
	return fresh, replace
}

// forceNewProvider: every argument of these providers' resources forces a
// replacement (random_*, null_resource, time_*).
func forceNewProvider(source string) bool {
	switch source {
	case "hashicorp/random", "hashicorp/null", "hashicorp/time":
		return true
	}
	return false
}

func allConfigChanges(schema *Block, prior, planned cty.Value) []cty.Path {
	var out []cty.Path
	for _, name := range schema.sortedAttributeNames() {
		a := schema.Attributes[name]
		if a.Computed && !a.Optional && !a.Required {
			continue
		}
		if !valuesEqual(prior.GetAttr(name), planned.GetAttr(name)) {
			out = append(out, cty.GetAttrPath(name))
		}
	}
	return out
}

func proposeBlock(b *Block, prior, config cty.Value) cty.Value {
	ty := b.ImpliedType()
	if config.IsNull() {
		config = cty.NullVal(ty)
	}
	if !config.IsKnown() {
		return cty.UnknownVal(ty)
	}
	priorOK := !prior.IsNull() && prior.IsKnown()
	get := func(v cty.Value, ok bool, name string, t cty.Type) cty.Value {
		if !ok || v.IsNull() {
			return cty.NullVal(t)
		}
		return v.GetAttr(name)
	}
	attrs := map[string]cty.Value{}
	for name, a := range b.Attributes {
		cv := get(config, true, name, a.ty)
		pv := get(prior, priorOK, name, a.ty)
		switch {
		case cv.IsNull() && a.Computed:
			if priorOK {
				attrs[name] = pv
			} else if !a.defaultVal.IsNull() {
				attrs[name] = a.defaultVal
			} else {
				attrs[name] = cty.UnknownVal(a.ty)
			}
		case cv.IsNull():
			attrs[name] = a.defaultVal
		case a.Nested != nil && cv.IsKnown():
			attrs[name] = proposeNested(a.Nested, pv, cv, false)
		default:
			attrs[name] = cv
		}
	}
	for name, nb := range b.Blocks {
		et := ty.AttributeType(name)
		cv := get(config, true, name, et)
		pv := get(prior, priorOK, name, et)
		attrs[name] = proposeNested(nb, pv, cv, !priorOK && prior.IsNull())
	}
	return cty.ObjectVal(attrs)
}

func isEmptyCollection(v cty.Value) bool {
	return v.IsNull() || (v.IsKnown() && v.CanIterateElements() && v.LengthInt() == 0)
}

func proposeNested(nb *NestedBlock, prior, config cty.Value, creating bool) cty.Value {
	elemTy := nb.Block.ImpliedType()
	fullTy := wrapNesting(nb.Nesting, elemTy)
	if nb.Nesting == "group" {
		fullTy = elemTy
	}
	if !config.IsKnown() {
		return cty.UnknownVal(fullTy)
	}
	priorOK := !prior.IsNull() && prior.IsKnown()
	if nb.Computed && isEmptyCollection(config) {
		if priorOK {
			return prior
		}
		if creating || prior.IsNull() {
			return cty.UnknownVal(fullTy)
		}
	}
	switch nb.Nesting {
	case "single", "group":
		if config.IsNull() {
			return config
		}
		return proposeBlock(&nb.Block, prior, config)
	case "list":
		if config.IsNull() {
			return config
		}
		var priorElems []cty.Value
		if priorOK && prior.CanIterateElements() {
			priorElems = prior.AsValueSlice()
		}
		var out []cty.Value
		i := 0
		for it := config.ElementIterator(); it.Next(); i++ {
			_, ce := it.Element()
			pe := cty.NullVal(elemTy)
			if i < len(priorElems) {
				pe = priorElems[i]
			}
			out = append(out, proposeBlock(&nb.Block, pe, ce))
		}
		if len(out) == 0 {
			return cty.ListValEmpty(elemTy)
		}
		return cty.ListVal(out)
	case "set":
		if config.IsNull() {
			return config
		}
		var priorElems []cty.Value
		if priorOK && prior.CanIterateElements() {
			priorElems = prior.AsValueSlice()
		}
		var out []cty.Value
		for it := config.ElementIterator(); it.Next(); {
			_, ce := it.Element()
			pe := cty.NullVal(elemTy)
			for _, cand := range priorElems {
				if configMatches(&nb.Block, cand, ce) {
					pe = cand
					break
				}
			}
			out = append(out, proposeBlock(&nb.Block, pe, ce))
		}
		if len(out) == 0 {
			return cty.SetValEmpty(elemTy)
		}
		return cty.SetVal(out)
	case "map":
		if config.IsNull() {
			return config
		}
		out := map[string]cty.Value{}
		for it := config.ElementIterator(); it.Next(); {
			k, ce := it.Element()
			pe := cty.NullVal(elemTy)
			if priorOK && prior.Type().IsMapType() && prior.HasIndex(k).True() {
				pe = prior.Index(k)
			}
			out[k.AsString()] = proposeBlock(&nb.Block, pe, ce)
		}
		if len(out) == 0 {
			return cty.MapValEmpty(elemTy)
		}
		return cty.MapVal(out)
	}
	return config
}

// configMatches reports whether a prior set element corresponds to a config
// element: every attribute set in config has the same value in prior.
func configMatches(b *Block, prior, config cty.Value) bool {
	if prior.IsNull() || !prior.IsKnown() {
		return false
	}
	for name := range b.Attributes {
		cv := config.GetAttr(name)
		if cv.IsNull() {
			continue
		}
		if !valuesEqual(cv, prior.GetAttr(name)) {
			return false
		}
	}
	return true
}

// replacePaths finds ForceNew attributes whose value changes.
func replacePaths(b *Block, prior, planned cty.Value, base cty.Path) []cty.Path {
	var out []cty.Path
	if prior.IsNull() && planned.IsNull() {
		return nil
	}
	for _, name := range b.sortedAttributeNames() {
		a := b.Attributes[name]
		pv := attrOrNull(prior, name, a.ty)
		nv := attrOrNull(planned, name, a.ty)
		p := append(copyPath(base), cty.GetAttrStep{Name: name})
		if a.ForceNew && !valuesEqual(pv, nv) {
			out = append(out, p)
			continue
		}
		if a.Nested != nil && hasForceNew(&a.Nested.Block) {
			out = append(out, nestedReplacePaths(a.Nested, pv, nv, p)...)
		}
	}
	for _, name := range b.sortedBlockNames() {
		nb := b.Blocks[name]
		if !hasForceNew(&nb.Block) {
			continue
		}
		et := b.ImpliedType().AttributeType(name)
		pv := attrOrNull(prior, name, et)
		nv := attrOrNull(planned, name, et)
		out = append(out, nestedReplacePaths(nb, pv, nv, append(copyPath(base), cty.GetAttrStep{Name: name}))...)
	}
	return out
}

func nestedReplacePaths(nb *NestedBlock, pv, nv cty.Value, p cty.Path) []cty.Path {
	elemTy := nb.Block.ImpliedType()
	switch nb.Nesting {
	case "single", "group":
		return replacePaths(&nb.Block, nullIfUnknown(pv, elemTy), nullIfUnknown(nv, elemTy), p)
	case "list":
		if !nv.IsKnown() || !pv.IsKnown() {
			if isEmptyCollection(pv) {
				return nil
			}
			return []cty.Path{p}
		}
		pe, ne := sliceOf(pv), sliceOf(nv)
		n := max(len(pe), len(ne))
		var out []cty.Path
		for i := 0; i < n; i++ {
			a, b := cty.NullVal(elemTy), cty.NullVal(elemTy)
			if i < len(pe) {
				a = pe[i]
			}
			if i < len(ne) {
				b = ne[i]
			}
			out = append(out, replacePaths(&nb.Block, a, b, append(copyPath(p), cty.IndexStep{Key: cty.NumberIntVal(int64(i))}))...)
		}
		return out
	default:
		if !valuesEqual(projectForceNew(&nb.Block, pv), projectForceNew(&nb.Block, nv)) {
			return []cty.Path{p}
		}
	}
	return nil
}

func projectForceNew(b *Block, v cty.Value) cty.Value {
	if v.IsNull() || !v.IsKnown() {
		return v
	}
	var out []cty.Value
	for it := v.ElementIterator(); it.Next(); {
		_, ev := it.Element()
		attrs := map[string]cty.Value{}
		for name, a := range b.Attributes {
			if a.ForceNew {
				attrs[name] = ev.GetAttr(name)
			}
		}
		out = append(out, cty.ObjectVal(attrs))
	}
	if len(out) == 0 {
		return cty.EmptyTupleVal
	}
	return cty.TupleVal(out)
}

func hasForceNew(b *Block) bool {
	for _, a := range b.Attributes {
		if a.ForceNew || (a.Nested != nil && hasForceNew(&a.Nested.Block)) {
			return true
		}
	}
	for _, nb := range b.Blocks {
		if hasForceNew(&nb.Block) {
			return true
		}
	}
	return false
}

func attrOrNull(v cty.Value, name string, t cty.Type) cty.Value {
	if v.IsNull() {
		return cty.NullVal(t)
	}
	if !v.IsKnown() {
		return cty.UnknownVal(t)
	}
	return v.GetAttr(name)
}

func nullIfUnknown(v cty.Value, t cty.Type) cty.Value {
	if !v.IsKnown() {
		return cty.UnknownVal(t)
	}
	return v
}

func sliceOf(v cty.Value) []cty.Value {
	if v.IsNull() || !v.IsKnown() || !v.CanIterateElements() {
		return nil
	}
	return v.AsValueSlice()
}

func copyPath(p cty.Path) cty.Path {
	out := make(cty.Path, len(p), len(p)+2)
	copy(out, p)
	return out
}

// applyIgnoreChanges replaces ignored parts of the configuration by their
// prior values, like Terraform's processIgnoreChanges.
func applyIgnoreChanges(schema *Block, r *Resource, prior, config cty.Value) cty.Value {
	if r.IgnoreAll {
		attrs := map[string]cty.Value{}
		for name := range config.Type().AttributeTypes() {
			a := schema.Attributes[name]
			if a != nil && a.Computed && !a.Optional && !a.Required {
				attrs[name] = config.GetAttr(name)
				continue
			}
			attrs[name] = prior.GetAttr(name)
		}
		return cty.ObjectVal(attrs)
	}
	for _, t := range r.IgnoreChanges {
		path := traversalToPath(t)
		if len(path) == 0 {
			continue
		}
		pv, err := path.Apply(prior)
		if err != nil {
			pv = cty.NilVal
		}
		config = setPath(config, path, pv)
	}
	return config
}

func traversalToPath(t hcl.Traversal) cty.Path {
	var p cty.Path
	for _, step := range t {
		switch s := step.(type) {
		case hcl.TraverseRoot:
			p = append(p, cty.GetAttrStep{Name: s.Name})
		case hcl.TraverseAttr:
			p = append(p, cty.GetAttrStep{Name: s.Name})
		case hcl.TraverseIndex:
			p = append(p, cty.IndexStep{Key: s.Key})
		}
	}
	return p
}

// setPath returns v with the value at path replaced by nv. A cty.NilVal
// removes a map key.
func setPath(v cty.Value, path cty.Path, nv cty.Value) cty.Value {
	if len(path) == 0 {
		if nv == cty.NilVal {
			return v
		}
		return nv
	}
	if v.IsNull() || !v.IsKnown() {
		return v
	}
	switch step := path[0].(type) {
	case cty.GetAttrStep:
		if !v.Type().IsObjectType() || !v.Type().HasAttribute(step.Name) {
			return v
		}
		attrs := v.AsValueMap()
		cur := attrs[step.Name]
		next := setPath(cur, path[1:], nv)
		if len(path) == 1 && nv == cty.NilVal {
			next = cty.NullVal(cur.Type())
		}
		if !next.Type().Equals(cur.Type()) && next != cty.NilVal {
			if c, err := convertTo(next, cur.Type()); err == nil {
				next = c
			} else {
				return v
			}
		}
		attrs[step.Name] = next
		return cty.ObjectVal(attrs)
	case cty.IndexStep:
		ty := v.Type()
		switch {
		case ty.IsMapType():
			m := v.AsValueMap()
			if m == nil {
				m = map[string]cty.Value{}
			}
			k := step.Key.AsString()
			if len(path) == 1 {
				if nv == cty.NilVal || nv.IsNull() {
					delete(m, k)
				} else {
					m[k] = nv
				}
			} else if cur, ok := m[k]; ok {
				m[k] = setPath(cur, path[1:], nv)
			}
			if len(m) == 0 {
				return cty.MapValEmpty(ty.ElementType())
			}
			return cty.MapVal(m)
		case ty.IsListType():
			elems := v.AsValueSlice()
			var i int
			if gocty(step.Key, &i) != nil || i < 0 || i >= len(elems) {
				return v
			}
			if nv == cty.NilVal {
				return v
			}
			elems[i] = setPath(elems[i], path[1:], nv)
			return cty.ListVal(elems)
		}
	}
	return v
}

// --- provider specific plan behaviour ---

const builtinTerraformSource = "terraform.io/builtin/terraform"

func (p *providerCtx) awsRegion() string {
	if p.Config.IsNull() || !p.Config.Type().HasAttribute("region") {
		return "us-east-1"
	}
	r := p.Config.GetAttr("region")
	if r.IsNull() || !r.IsKnown() || r.Type() != cty.String {
		return "us-east-1"
	}
	return r.AsString()
}

func (p *providerCtx) awsDefaultTags() map[string]cty.Value {
	out := map[string]cty.Value{}
	if p.Config.IsNull() || !p.Config.Type().HasAttribute("default_tags") {
		return out
	}
	dt := p.Config.GetAttr("default_tags")
	if dt.IsNull() || !dt.IsKnown() {
		return out
	}
	for it := dt.ElementIterator(); it.Next(); {
		_, blk := it.Element()
		if blk.IsNull() || !blk.Type().HasAttribute("tags") {
			continue
		}
		tags := blk.GetAttr("tags")
		if tags.IsNull() || !tags.IsKnown() {
			continue
		}
		for tit := tags.ElementIterator(); tit.Next(); {
			k, v := tit.Element()
			out[k.AsString()] = v
		}
	}
	return out
}

func (e *evaluator) planHook(p *providerCtx, rtype string, schema *Block, prior, config, planned cty.Value, isData bool) cty.Value {
	if !planned.IsKnown() || planned.IsNull() {
		return planned
	}
	attrs := planned.AsValueMap()
	set := func(name string, v cty.Value) {
		if _, ok := attrs[name]; ok {
			if c, err := convertTo(v, schema.Attributes[name].ty); err == nil {
				attrs[name] = c
			}
		}
	}
	switch p.Source {
	case "hashicorp/aws":
		if a, ok := schema.Attributes["region"]; ok && a.Optional && config.GetAttr("region").IsNull() {
			set("region", cty.StringVal(p.awsRegion()))
		}
		if _, ok := schema.Attributes["tags_all"]; ok && !isData {
			tags := attrs["tags"]
			if tags.IsKnown() {
				merged := p.awsDefaultTags()
				if !tags.IsNull() {
					for it := tags.ElementIterator(); it.Next(); {
						k, v := it.Element()
						merged[k.AsString()] = v
					}
				}
				if len(merged) == 0 {
					if prior.IsNull() {
						set("tags_all", cty.UnknownVal(cty.Map(cty.String)))
					} else {
						set("tags_all", cty.MapValEmpty(cty.String))
					}
				} else {
					set("tags_all", cty.MapVal(merged))
				}
			} else {
				set("tags_all", cty.UnknownVal(cty.Map(cty.String)))
			}
		}
		// CustomizeDiff: stopping/starting an instance to resize it changes
		// its public IP.
		if rtype == "aws_instance" && !prior.IsNull() && !valuesEqual(prior.GetAttr("instance_type"), attrs["instance_type"]) {
			for _, n := range []string{"public_ip", "public_dns"} {
				if config.GetAttr(n).IsNull() {
					attrs[n] = cty.UnknownVal(cty.String)
				}
			}
		}
	case builtinTerraformSource:
		if rtype == "terraform_data" {
			// output mirrors input, but only becomes known after apply.
			in := config.GetAttr("input")
			if prior.IsNull() || !valuesEqual(prior.GetAttr("input"), in) {
				if in.IsNull() {
					attrs["output"] = cty.NullVal(cty.DynamicPseudoType)
				} else {
					attrs["output"] = cty.DynamicVal
				}
			}
		}
	}
	return cty.ObjectVal(attrs)
}
