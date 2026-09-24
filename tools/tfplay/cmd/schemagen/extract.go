package main

// Static extraction of ForceNew / RequiresReplace and default values from the
// Go source of a terraform-plugin-sdk / terraform-plugin-framework provider.
//
// Resources are located through the `// @SDKResource("aws_x")` and
// `// @FrameworkResource("aws_x")` annotations used by terraform-provider-aws.
// From each annotated function we follow references to other functions of the
// same package (and, for the framework, the Schema method of the returned
// type) and walk every string-keyed composite literal, building the attribute
// path from the chain of keys ("root_block_device.volume_type").
//
// It is a heuristic: results are later filtered against the real schema.

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type attrInfo struct {
	ForceNew bool
	Computed bool
	Default  json.RawMessage
}

var annotationRe = regexp.MustCompile(`@(SDKResource|FrameworkResource)\("([a-z0-9_]+)"`)

// Keys whose values describe old schema versions or conditional logic.
var skipKeys = map[string]bool{
	"StateUpgraders": true, "MigrateState": true, "CustomizeDiff": true,
	"Importer": true, "Timeouts": true, "Identity": true,
}

type pkgInfo struct {
	consts  map[string]string
	funcs   map[string]*ast.FuncDecl
	methods map[string][]*ast.FuncDecl
}

type extractor struct {
	names map[string]string // constants of the shared `names` package
	pkg   *pkgInfo
}

func extractFromSource(root string) (map[string]map[string]attrInfo, error) {
	x := &extractor{names: map[string]string{}}
	fset := token.NewFileSet()

	if pkgs, err := parseDir(fset, filepath.Join(root, "names")); err == nil {
		for _, f := range pkgs {
			collectConsts(f, x.names, nil)
		}
	}

	result := map[string]map[string]attrInfo{}
	serviceRoot := filepath.Join(root, "internal", "service")
	dirs, err := os.ReadDir(serviceRoot)
	if err != nil {
		return nil, err
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, err := parseDir(fset, filepath.Join(serviceRoot, d.Name()))
		if err != nil {
			return nil, err
		}
		p := &pkgInfo{consts: map[string]string{}, funcs: map[string]*ast.FuncDecl{}, methods: map[string][]*ast.FuncDecl{}}
		for _, f := range files {
			collectConsts(f, p.consts, x.names)
			for _, decl := range f.Decls {
				fd, ok := decl.(*ast.FuncDecl)
				if !ok || fd.Body == nil {
					continue
				}
				if fd.Recv == nil {
					p.funcs[fd.Name.Name] = fd
				} else if tn := recvTypeName(fd); tn != "" {
					p.methods[tn] = append(p.methods[tn], fd)
				}
			}
		}
		x.pkg = p
		for _, fd := range p.funcs {
			if fd.Doc == nil {
				continue
			}
			matches := annotationRe.FindAllStringSubmatch(fd.Doc.Text(), -1)
			if matches == nil {
				continue
			}
			info := map[string]attrInfo{}
			for _, body := range x.reachable(fd) {
				x.walk(body, "", info)
			}
			// One function can register several aliases (aws_lb / aws_alb).
			for _, m := range matches {
				out := result[m[2]]
				if out == nil {
					out = map[string]attrInfo{}
					result[m[2]] = out
				}
				for k, v := range info {
					out[k] = v
				}
			}
		}
	}
	return result, nil
}

func parseDir(fset *token.FileSet, dir string) ([]*ast.File, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []*ast.File
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".go") || strings.HasSuffix(n, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, n), nil, parser.ParseComments)
		if err != nil {
			continue
		}
		files = append(files, f)
	}
	return files, nil
}

func collectConsts(f *ast.File, dst map[string]string, names map[string]string) {
	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.CONST {
			continue
		}
		for _, spec := range gd.Specs {
			vs := spec.(*ast.ValueSpec)
			for i, n := range vs.Names {
				if i >= len(vs.Values) {
					continue
				}
				switch v := vs.Values[i].(type) {
				case *ast.BasicLit:
					if v.Kind == token.STRING {
						if s, err := strconv.Unquote(v.Value); err == nil {
							dst[n.Name] = s
						}
					}
				case *ast.SelectorExpr:
					if id, ok := v.X.(*ast.Ident); ok && id.Name == "names" && names != nil {
						if s, ok := names[v.Sel.Name]; ok {
							dst[n.Name] = s
						}
					}
				}
			}
		}
	}
}

func recvTypeName(fd *ast.FuncDecl) string {
	if len(fd.Recv.List) == 0 {
		return ""
	}
	t := fd.Recv.List[0].Type
	if st, ok := t.(*ast.StarExpr); ok {
		t = st.X
	}
	if id, ok := t.(*ast.Ident); ok {
		return id.Name
	}
	return ""
}

// reachable returns the bodies of fd and every same-package function it
// references (transitively, limited depth), plus Schema methods of types it
// instantiates (framework resources).
func (x *extractor) reachable(fd *ast.FuncDecl) []ast.Node {
	seen := map[*ast.FuncDecl]bool{fd: true}
	queue := []*ast.FuncDecl{fd}
	var bodies []ast.Node
	for depth := 0; len(queue) > 0 && depth < 5; depth++ {
		var next []*ast.FuncDecl
		for _, f := range queue {
			bodies = append(bodies, f.Body)
			ast.Inspect(f.Body, func(n ast.Node) bool {
				if kv, ok := n.(*ast.KeyValueExpr); ok {
					if id, ok := kv.Key.(*ast.Ident); ok && skipKeys[id.Name] {
						return false
					}
				}
				switch v := n.(type) {
				case *ast.Ident:
					if g, ok := x.pkg.funcs[v.Name]; ok && !seen[g] {
						seen[g] = true
						next = append(next, g)
					}
				case *ast.CompositeLit:
					if id, ok := v.Type.(*ast.Ident); ok {
						for _, m := range x.pkg.methods[id.Name] {
							if m.Name.Name == "Schema" && !seen[m] {
								seen[m] = true
								next = append(next, m)
							}
						}
					}
				}
				return true
			})
		}
		queue = next
	}
	return bodies
}

func (x *extractor) keyName(e ast.Expr) string {
	switch k := e.(type) {
	case *ast.BasicLit:
		if k.Kind == token.STRING {
			s, _ := strconv.Unquote(k.Value)
			return s
		}
	case *ast.Ident:
		return x.pkg.consts[k.Name]
	case *ast.SelectorExpr:
		if id, ok := k.X.(*ast.Ident); ok && id.Name == "names" {
			return x.names[k.Sel.Name]
		}
	}
	return ""
}

func (x *extractor) walk(n ast.Node, path string, out map[string]attrInfo) {
	ast.Inspect(n, func(c ast.Node) bool {
		kv, ok := c.(*ast.KeyValueExpr)
		if !ok {
			return true
		}
		if id, ok := kv.Key.(*ast.Ident); ok && skipKeys[id.Name] {
			return false
		}
		name := x.keyName(kv.Key)
		if name == "" || strings.ContainsAny(name, " .") {
			x.walk(kv.Value, path, out)
			return false
		}
		p := name
		if path != "" {
			p = path + "." + name
		}
		x.inspectAttr(kv.Value, p, out)
		x.walk(kv.Value, p, out)
		return false
	})
}

func (x *extractor) inspectAttr(v ast.Expr, path string, out map[string]attrInfo) {
	if u, ok := v.(*ast.UnaryExpr); ok && u.Op == token.AND {
		v = u.X
	}
	cl, ok := v.(*ast.CompositeLit)
	if !ok {
		return
	}
	info := out[path]
	found := false
	for _, elt := range cl.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		id, ok := kv.Key.(*ast.Ident)
		if !ok {
			continue
		}
		switch id.Name {
		case "ForceNew":
			if b, ok := kv.Value.(*ast.Ident); ok && b.Name == "true" {
				info.ForceNew, found = true, true
			}
		case "Computed":
			if b, ok := kv.Value.(*ast.Ident); ok && b.Name == "true" {
				info.Computed, found = true, true
			}
		case "PlanModifiers":
			ast.Inspect(kv.Value, func(n ast.Node) bool {
				if call, ok := n.(*ast.CallExpr); ok {
					if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
						if sel.Sel.Name == "RequiresReplace" || sel.Sel.Name == "RequiresReplaceIfConfigured" {
							info.ForceNew, found = true, true
						}
					}
				}
				return true
			})
		case "Default":
			d := kv.Value
			if call, ok := d.(*ast.CallExpr); ok {
				if sel, ok := call.Fun.(*ast.SelectorExpr); ok && strings.HasPrefix(sel.Sel.Name, "Static") && len(call.Args) == 1 {
					d = call.Args[0]
				}
			}
			if j := x.literal(d); j != nil {
				info.Default, found = j, true
			}
		}
	}
	if found {
		out[path] = info
	}
}

func (x *extractor) literal(e ast.Expr) json.RawMessage {
	switch v := e.(type) {
	case *ast.BasicLit:
		switch v.Kind {
		case token.STRING:
			s, err := strconv.Unquote(v.Value)
			if err != nil {
				return nil
			}
			b, _ := json.Marshal(s)
			return b
		case token.INT, token.FLOAT:
			if _, err := strconv.ParseFloat(v.Value, 64); err == nil {
				return json.RawMessage(v.Value)
			}
		}
	case *ast.Ident:
		switch v.Name {
		case "true", "false":
			return json.RawMessage(v.Name)
		}
		if s, ok := x.pkg.consts[v.Name]; ok {
			b, _ := json.Marshal(s)
			return b
		}
	case *ast.SelectorExpr:
		if id, ok := v.X.(*ast.Ident); ok && id.Name == "names" {
			if s, ok := x.names[v.Sel.Name]; ok {
				b, _ := json.Marshal(s)
				return b
			}
		}
	case *ast.UnaryExpr:
		if v.Op == token.SUB {
			if inner := x.literal(v.X); inner != nil && !strings.HasPrefix(string(inner), "\"") {
				return json.RawMessage("-" + string(inner))
			}
		}
	}
	return nil
}
