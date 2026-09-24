package engine

import (
	"fmt"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

// node ids inside a module: var.x, local.x, output.x, module.x,
// aws_instance.web, data.aws_ami.x, provider.aws, provider.aws.west

type graphNode struct {
	ID   string
	Kind string // variable, local, output, module, resource, data, provider
	Deps map[string]bool
}

type moduleGraph struct {
	Nodes map[string]*graphNode
	Order []string
}

// bodyTraversals collects every variable traversal in a native syntax body,
// including nested and dynamic blocks.
func bodyTraversals(body hcl.Body) []hcl.Traversal {
	var out []hcl.Traversal
	sb, ok := body.(*hclsyntax.Body)
	if !ok {
		attrs, _ := body.JustAttributes()
		for _, a := range attrs {
			out = append(out, a.Expr.Variables()...)
		}
		return out
	}
	for _, a := range sb.Attributes {
		out = append(out, a.Expr.Variables()...)
	}
	for _, b := range sb.Blocks {
		out = append(out, bodyTraversals(b.Body)...)
	}
	return out
}

// remainTraversals is like bodyTraversals but for bodies returned by
// PartialContent. Those are still *hclsyntax.Body values, but they keep the
// meta arguments that were already extracted, so we skip them by name.
func remainTraversals(body hcl.Body, hidden map[string]bool) []hcl.Traversal {
	sb := syntaxBody(body)
	if sb == nil {
		return bodyTraversals(body)
	}
	var out []hcl.Traversal
	for name, a := range sb.Attributes {
		if hidden[name] {
			continue
		}
		out = append(out, a.Expr.Variables()...)
	}
	for _, b := range sb.Blocks {
		if hidden[b.Type] {
			continue
		}
		out = append(out, bodyTraversals(b.Body)...)
	}
	return out
}

func syntaxBody(body hcl.Body) *hclsyntax.Body {
	if sb, ok := body.(*hclsyntax.Body); ok {
		return sb
	}
	return nil
}

var resourceMetaNames = map[string]bool{
	"count": true, "for_each": true, "provider": true, "depends_on": true,
	"lifecycle": true, "connection": true, "provisioner": true,
}

type ref struct {
	Node      string
	Traversal hcl.Traversal
}

// resolveRef maps a traversal to a node id of the module (or "" if it does
// not refer to a graph node, e.g. count.index, each.key, path.module).
func (m *Module) resolveRef(t hcl.Traversal) (string, *hcl.Diagnostic) {
	if len(t) == 0 {
		return "", nil
	}
	root := t.RootName()
	attr := func(i int) (string, bool) {
		if len(t) <= i {
			return "", false
		}
		a, ok := t[i].(hcl.TraverseAttr)
		return a.Name, ok
	}
	rng := t.SourceRange()
	switch root {
	case "count", "each", "self", "path", "terraform":
		return "", nil
	case "var":
		n, ok := attr(1)
		if !ok {
			return "", nil
		}
		if _, ok := m.Variables[n]; !ok {
			return "", &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Reference to undeclared input variable",
				Detail:   fmt.Sprintf("An input variable with the name %q has not been declared. This variable can be declared with a variable %q {} block.", n, n),
				Subject:  &rng,
			}
		}
		return "var." + n, nil
	case "local":
		n, ok := attr(1)
		if !ok {
			return "", nil
		}
		if _, ok := m.Locals[n]; !ok {
			return "", &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Reference to undeclared local value",
				Detail:   fmt.Sprintf("A local value with the name %q has not been declared.", n),
				Subject:  &rng,
			}
		}
		return "local." + n, nil
	case "module":
		n, ok := attr(1)
		if !ok {
			return "", nil
		}
		if _, ok := m.ModuleCalls[n]; !ok {
			return "", &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Reference to undeclared module",
				Detail:   fmt.Sprintf("No module call named %q is declared in %s.", n, m.describe()),
				Subject:  &rng,
			}
		}
		return "module." + n, nil
	case "data":
		typ, ok1 := attr(1)
		name, ok2 := attr(2)
		if !ok1 || !ok2 {
			return "", nil
		}
		key := "data." + typ + "." + name
		if _, ok := m.Resources[key]; !ok {
			return "", &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Reference to undeclared resource",
				Detail:   fmt.Sprintf("A data resource %q %q has not been declared in %s.", typ, name, m.describe()),
				Subject:  &rng,
			}
		}
		return key, nil
	default:
		name, ok := attr(1)
		if !ok {
			return "", nil
		}
		key := root + "." + name
		if _, ok := m.Resources[key]; ok {
			return key, nil
		}
		if !strings.Contains(root, "_") {
			// Not resource-shaped (e.g. a dynamic block iterator); let HCL
			// report unknown variables itself.
			return "", nil
		}
		for k := range m.Resources {
			if strings.HasPrefix(k, root+".") {
				return "", &hcl.Diagnostic{
					Severity: hcl.DiagError,
					Summary:  "Reference to undeclared resource",
					Detail:   fmt.Sprintf("A managed resource %q %q has not been declared in %s.", root, name, m.describe()),
					Subject:  &rng,
				}
			}
		}
		return "", &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Reference to undeclared resource",
			Detail:   fmt.Sprintf("A managed resource %q %q has not been declared in %s.", root, name, m.describe()),
			Subject:  &rng,
		}
	}
}

func (m *Module) describe() string {
	if m.Dir == "" {
		return "the root module"
	}
	return "module " + m.Dir
}

// buildGraph computes the dependency graph of a module and a topological
// order of its nodes.
func (m *Module) buildGraph() (*moduleGraph, hcl.Diagnostics) {
	var diags hcl.Diagnostics
	g := &moduleGraph{Nodes: map[string]*graphNode{}}
	add := func(id, kind string, travs []hcl.Traversal) {
		n := &graphNode{ID: id, Kind: kind, Deps: map[string]bool{}}
		for _, t := range travs {
			dep, d := m.resolveRef(t)
			if d != nil {
				diags = append(diags, d)
				continue
			}
			if dep != "" && dep != id {
				n.Deps[dep] = true
			}
		}
		g.Nodes[id] = n
	}

	for name, v := range m.Variables {
		var travs []hcl.Traversal
		for _, cr := range v.Validations {
			travs = append(travs, cr.Condition.Variables()...)
			travs = append(travs, cr.ErrorMessage.Variables()...)
		}
		add("var."+name, "variable", travs)
	}
	for name, l := range m.Locals {
		add("local."+name, "local", l.Expr.Variables())
	}
	for key, pc := range m.ProviderConfigs {
		add("provider."+key, "provider", remainTraversals(pc.Config, map[string]bool{"alias": true, "version": true}))
	}
	for key, r := range m.Resources {
		var travs []hcl.Traversal
		if r.Count != nil {
			travs = append(travs, r.Count.Variables()...)
		}
		if r.ForEach != nil {
			travs = append(travs, r.ForEach.Variables()...)
		}
		travs = append(travs, remainTraversals(r.Config, resourceMetaNames)...)
		travs = append(travs, r.DependsOn...)
		for _, cr := range append(append([]*CheckRule{}, r.Preconditions...), r.Postconditions...) {
			travs = append(travs, cr.Condition.Variables()...)
			travs = append(travs, cr.ErrorMessage.Variables()...)
		}
		for _, e := range r.ReplaceTriggeredBy {
			travs = append(travs, e.Variables()...)
		}
		kind := "resource"
		if r.Mode == "data" {
			kind = "data"
		}
		add(key, kind, travs)
		if pk := r.providerKey(); m.ProviderConfigs[pk] != nil {
			g.Nodes[key].Deps["provider."+pk] = true
		}
	}
	for name, mc := range m.ModuleCalls {
		var travs []hcl.Traversal
		if mc.Count != nil {
			travs = append(travs, mc.Count.Variables()...)
		}
		if mc.ForEach != nil {
			travs = append(travs, mc.ForEach.Variables()...)
		}
		for _, a := range mc.Inputs {
			travs = append(travs, a.Expr.Variables()...)
		}
		travs = append(travs, mc.DependsOn...)
		add("module."+name, "module", travs)
		// Child modules inherit the provider configurations of their parent.
		for key := range m.ProviderConfigs {
			g.Nodes["module."+name].Deps["provider."+key] = true
		}
	}
	for name, o := range m.Outputs {
		travs := append([]hcl.Traversal{}, o.Expr.Variables()...)
		travs = append(travs, o.DependsOn...)
		for _, cr := range o.Preconditions {
			travs = append(travs, cr.Condition.Variables()...)
		}
		add("output."+name, "output", travs)
	}

	// Kahn's algorithm with sorted ready queue for deterministic order.
	indeg := map[string]int{}
	rev := map[string][]string{}
	for id, n := range g.Nodes {
		if _, ok := indeg[id]; !ok {
			indeg[id] = 0
		}
		for d := range n.Deps {
			if _, ok := g.Nodes[d]; !ok {
				continue
			}
			indeg[id]++
			rev[d] = append(rev[d], id)
		}
	}
	var ready []string
	for id, d := range indeg {
		if d == 0 {
			ready = append(ready, id)
		}
	}
	sort.Strings(ready)
	for len(ready) > 0 {
		id := ready[0]
		ready = ready[1:]
		g.Order = append(g.Order, id)
		next := rev[id]
		sort.Strings(next)
		for _, n := range next {
			indeg[n]--
			if indeg[n] == 0 {
				ready = append(ready, n)
				sort.Strings(ready)
			}
		}
	}
	if len(g.Order) != len(g.Nodes) {
		var cyc []string
		for id, d := range indeg {
			if d > 0 {
				cyc = append(cyc, id)
			}
		}
		sort.Strings(cyc)
		diags = append(diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Cycle: " + strings.Join(cyc, ", "),
			Detail:   "The configuration contains a dependency cycle: these objects refer to each other, so Terraform cannot decide which one to create first.",
		})
	}
	return g, diags
}

func (r *Resource) providerKey() string {
	if r.ProviderRef != "" {
		return r.ProviderRef
	}
	return providerForType(r.Type)
}
