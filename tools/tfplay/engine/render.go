package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
	ctyjson "github.com/zclconf/go-cty/cty/json"
)

// The renderer reproduces the human-readable plan format of Terraform's
// structured renderer (command/jsonformat) closely enough for teaching.

type renderer struct {
	lines   []string
	replace []cty.Path
	sens    []cty.Path
}

func spaces(n int) string { return strings.Repeat(" ", n) }

// prefix builds the gutter for a line: action symbols live in a 4 column
// area ("  + ", "-/+ ", " <= ") before the content, shifted by indent.
func prefix(indent int, sym string) string {
	switch len(sym) {
	case 3:
		return spaces(indent) + sym + " "
	default:
		return spaces(indent+2) + sym + " "
	}
}

func (r *renderer) add(s string) { r.lines = append(r.lines, s) }

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func (r *renderer) forces(p cty.Path) bool {
	for _, rp := range r.replace {
		if rp.Equals(p) {
			return true
		}
	}
	return false
}

func (r *renderer) isSensitive(p cty.Path) bool {
	for _, sp := range r.sens {
		if pathHasPrefix(p, sp) {
			return true
		}
	}
	return false
}

// RenderChange renders one resource instance change.
func RenderChange(c *Change) string {
	r := &renderer{replace: c.ReplacePaths, sens: c.SensitivePaths}
	var sym, header string
	switch c.Action {
	case ActCreate:
		sym, header = "+", "will be created"
	case ActDelete:
		sym, header = "-", "will be destroyed"
	case ActUpdate:
		sym, header = "~", "will be updated in-place"
	case ActReplace:
		sym, header = "-/+", "must be replaced"
	case ActReplaceCBD:
		sym, header = "+/-", "must be replaced"
	case ActRead:
		sym, header = " <=", "will be read during apply"
	case ActNoOp:
		sym, header = " ", ""
	}
	if c.Action == ActNoOp && c.PrevAddr != "" {
		r.add(fmt.Sprintf("  # %s has moved to %s", c.PrevAddr, c.Addr))
	} else {
		if c.Action.isReplace() && strings.HasPrefix(c.Reason, "because of a change in") {
			r.add(fmt.Sprintf("  # %s will be replaced due to changes in replace_triggered_by", c.Addr))
		} else {
			r.add(fmt.Sprintf("  # %s %s", c.Addr, header))
		}
		if c.PrevAddr != "" {
			r.add(fmt.Sprintf("  # (moved from %s)", c.PrevAddr))
		}
		if c.Reason != "" && !strings.HasPrefix(c.Reason, "because of a change in") {
			r.add(fmt.Sprintf("  # (%s)", c.Reason))
		}
	}
	kind := "resource"
	if c.Mode == "data" {
		kind = "data"
	}
	r.add(fmt.Sprintf("%s%s %q %q {", prefix(0, sym), kind, c.Type, c.Name))
	mode := "update"
	switch c.Action {
	case ActCreate, ActRead:
		mode = "create"
	case ActDelete:
		mode = "delete"
	}
	before, after := c.Before, c.After
	if c.Action == ActDelete {
		after = cty.NullVal(c.Schema.ImpliedType())
	}
	if c.Action == ActCreate || c.Action == ActRead {
		before = cty.NullVal(c.Schema.ImpliedType())
	}
	r.body(c.Schema, before, after, 4, mode, nil)
	r.add("    }")
	return strings.Join(r.lines, "\n")
}

func isEmptyString(v cty.Value) bool {
	return v.IsKnown() && !v.IsNull() && v.Type() == cty.String && v.AsString() == ""
}

func objAttr(v cty.Value, name string, t cty.Type) cty.Value {
	if v == cty.NilVal || v.IsNull() {
		return cty.NullVal(t)
	}
	if !v.IsKnown() {
		return cty.UnknownVal(t)
	}
	return v.GetAttr(name)
}

func isIdentifying(name string) bool {
	return name == "id" || name == "name" || name == "tags"
}

func symFor(mode string, bv, av cty.Value) string {
	switch mode {
	case "create":
		return "+"
	case "delete":
		return "-"
	}
	switch {
	case bv.IsNull() && av.IsNull():
		return " "
	case bv.IsNull():
		return "+"
	case av.IsNull():
		return "-"
	case valuesEqual(bv, av):
		return " "
	}
	return "~"
}

func (r *renderer) body(b *Block, before, after cty.Value, indent int, mode string, path cty.Path) {
	ty := b.ImpliedType()
	// Attributes.
	names := b.sortedAttributeNames()
	pad := 0
	type row struct {
		name   string
		bv, av cty.Value
	}
	var rows []row
	legacyHidden := 0
	for _, n := range names {
		at := b.Attributes[n].ty
		bv, av := objAttr(before, n, at), objAttr(after, n, at)
		// Legacy SDK providers store "" for unset strings; Terraform's
		// renderer treats that like null.
		if isEmptyString(bv) {
			if av.IsNull() || isEmptyString(av) {
				if mode != "create" {
					legacyHidden++
					if len(n) > pad {
						pad = len(n)
					}
				}
				continue
			}
			bv = cty.NullVal(at)
		}
		if mode == "create" && av.IsNull() {
			continue
		}
		if mode == "delete" && bv.IsNull() {
			continue
		}
		if bv.IsNull() && av.IsNull() {
			continue
		}
		rows = append(rows, row{n, bv, av})
		if len(n) > pad {
			pad = len(n)
		}
	}
	hiddenAttrs := legacyHidden
	wroteAttrs := false
	for _, rw := range rows {
		a := b.Attributes[rw.name]
		p := append(copyPath(path), cty.GetAttrStep{Name: rw.name})
		sym := symFor(mode, rw.bv, rw.av)
		if sym == " " && mode == "update" && !isIdentifying(rw.name) {
			hiddenAttrs++
			continue
		}
		sensitive := a.Sensitive || r.isSensitive(p)
		val := r.value(rw.bv, rw.av, indent+4, sym, sensitive, p, a.Nested != nil)
		line := prefix(indent, sym) + fmt.Sprintf("%-*s = ", pad, rw.name) + val
		if r.forces(p) {
			line += " # forces replacement"
		}
		r.add(line)
		wroteAttrs = true
	}
	if hiddenAttrs > 0 {
		r.add(spaces(indent+4) + "# (" + plural(hiddenAttrs, "unchanged attribute") + " hidden)")
		wroteAttrs = true
	}

	// Nested blocks.
	hiddenBlocks := 0
	var chunks [][]string
	for _, n := range b.sortedBlockNames() {
		nb := b.Blocks[n]
		et := ty.AttributeType(n)
		bv, av := objAttr(before, n, et), objAttr(after, n, et)
		p := append(copyPath(path), cty.GetAttrStep{Name: n})
		c, h := r.blockChunks(n, nb, bv, av, indent, mode, p)
		chunks = append(chunks, c...)
		hiddenBlocks += h
	}
	for i, c := range chunks {
		if i > 0 || wroteAttrs {
			r.add("")
		}
		r.lines = append(r.lines, c...)
	}
	if hiddenBlocks > 0 {
		if wroteAttrs || len(chunks) > 0 {
			r.add("")
		}
		r.add(spaces(indent+4) + "# (" + plural(hiddenBlocks, "unchanged block") + " hidden)")
	}
}

func (r *renderer) blockChunks(name string, nb *NestedBlock, bv, av cty.Value, indent int, mode string, path cty.Path) ([][]string, int) {
	elemTy := nb.Block.ImpliedType()
	var chunks [][]string
	hidden := 0
	one := func(label string, sym string, eb, ea cty.Value, childMode string, p cty.Path) {
		sub := &renderer{replace: r.replace, sens: r.sens}
		head := prefix(indent, sym) + name + label + " {"
		if r.forces(p) {
			head += " # forces replacement"
		}
		sub.add(head)
		sub.body(&nb.Block, eb, ea, indent+4, childMode, p)
		sub.add(spaces(indent+4) + "}")
		chunks = append(chunks, sub.lines)
	}
	modeFor := func(sym string) string {
		switch sym {
		case "+":
			return "create"
		case "-":
			return "delete"
		}
		return "update"
	}
	if mode == "create" && !av.IsKnown() {
		chunks = append(chunks, []string{prefix(indent, "+") + name + " (known after apply)"})
		return chunks, 0
	}
	if mode == "update" && !av.IsKnown() {
		sym := "~"
		if bv.IsNull() {
			sym = "+"
		}
		line := prefix(indent, sym) + name + " (known after apply)"
		if r.forces(path) {
			line += " # forces replacement"
		}
		if sym == "~" {
			// Show what is going away, like Terraform does for replaced blocks.
			for _, eb := range sliceOrSingle(nb, bv) {
				one("", "-", eb, cty.NullVal(elemTy), "delete", path)
			}
		}
		chunks = append(chunks, []string{line})
		return chunks, 0
	}
	switch nb.Nesting {
	case "single", "group":
		sym := symFor(mode, bv, av)
		if bv.IsNull() && av.IsNull() {
			return nil, 0
		}
		if sym == " " {
			return nil, 1
		}
		one("", sym, bv, av, modeFor(sym), path)
	case "list":
		be, ae := sliceOf(bv), sliceOf(av)
		n := max(len(be), len(ae))
		for i := 0; i < n; i++ {
			eb, ea := cty.NullVal(elemTy), cty.NullVal(elemTy)
			if i < len(be) {
				eb = be[i]
			}
			if i < len(ae) {
				ea = ae[i]
			}
			sym := symFor(mode, eb, ea)
			if sym == " " {
				hidden++
				continue
			}
			one("", sym, eb, ea, modeFor(sym), append(copyPath(path), cty.IndexStep{Key: cty.NumberIntVal(int64(i))}))
		}
	case "set":
		be, ae := sliceOf(bv), sliceOf(av)
		if mode == "create" {
			for _, ea := range ae {
				one("", "+", cty.NullVal(elemTy), ea, "create", path)
			}
			return chunks, 0
		}
		if mode == "delete" {
			for _, eb := range be {
				one("", "-", eb, cty.NullVal(elemTy), "delete", path)
			}
			return chunks, 0
		}
		used := make([]bool, len(ae))
		var removed []cty.Value
		for _, eb := range be {
			found := false
			for j, ea := range ae {
				if !used[j] && valuesEqual(eb, ea) {
					used[j], found = true, true
					break
				}
			}
			if found {
				hidden++
			} else {
				removed = append(removed, eb)
			}
		}
		for _, eb := range removed {
			one("", "-", eb, cty.NullVal(elemTy), "delete", path)
		}
		for j, ea := range ae {
			if !used[j] {
				one("", "+", cty.NullVal(elemTy), ea, "create", path)
			}
		}
	case "map":
		keys := map[string]bool{}
		bm, am := mapOf(bv), mapOf(av)
		for k := range bm {
			keys[k] = true
		}
		for k := range am {
			keys[k] = true
		}
		for _, k := range sortedKeys(keys) {
			eb, ok := bm[k]
			if !ok {
				eb = cty.NullVal(elemTy)
			}
			ea, ok := am[k]
			if !ok {
				ea = cty.NullVal(elemTy)
			}
			sym := symFor(mode, eb, ea)
			if sym == " " {
				hidden++
				continue
			}
			one(fmt.Sprintf(" %q", k), sym, eb, ea, modeFor(sym), append(copyPath(path), cty.IndexStep{Key: cty.StringVal(k)}))
		}
	}
	return chunks, hidden
}

func sliceOrSingle(nb *NestedBlock, v cty.Value) []cty.Value {
	if v.IsNull() || !v.IsKnown() {
		return nil
	}
	if nb.Nesting == "single" || nb.Nesting == "group" {
		return []cty.Value{v}
	}
	return sliceOf(v)
}

func mapOf(v cty.Value) map[string]cty.Value {
	if v.IsNull() || !v.IsKnown() {
		return nil
	}
	out := map[string]cty.Value{}
	for it := v.ElementIterator(); it.Next(); {
		k, e := it.Element()
		out[k.AsString()] = e
	}
	return out
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// value renders the right-hand side of an attribute line. indent is the
// indentation used for nested lines (elements / closing brackets).
func (r *renderer) value(bv, av cty.Value, indent int, sym string, sensitive bool, path cty.Path, nested bool) string {
	if sensitive {
		switch sym {
		case "-":
			return "(sensitive value) -> null"
		default:
			return "(sensitive value)"
		}
	}
	switch sym {
	case "+":
		return r.one(av, indent, "+", path)
	case "-":
		ty := bv.Type()
		if ty.IsPrimitiveType() && !isMultiline(bv) {
			return r.one(bv, indent, "-", path) + " -> null"
		}
		return r.one(bv, indent, "-", path) + " -> null"
	case " ":
		return r.one(av, indent, " ", path)
	}
	// update
	if !av.IsKnown() {
		return r.one(bv, indent, "-", path) + " -> (known after apply)"
	}
	ty := av.Type()
	switch {
	case ty.IsPrimitiveType() || ty == cty.DynamicPseudoType:
		if s, ok := r.jsonDiff(bv, av, indent, path); ok {
			return s
		}
		if isMultiline(bv) || isMultiline(av) {
			return r.heredocDiff(bv, av, indent)
		}
		return r.one(bv, indent, " ", path) + " -> " + r.one(av, indent, " ", path)
	case ty.IsMapType() || ty.IsObjectType():
		return r.mapDiff(bv, av, indent, path, ty.IsObjectType())
	case ty.IsListType() || ty.IsTupleType() || ty.IsSetType():
		return r.listDiff(bv, av, indent, path, ty.IsSetType())
	}
	return r.one(bv, indent, " ", path) + " -> " + r.one(av, indent, " ", path)
}

func isMultiline(v cty.Value) bool {
	return v.IsKnown() && !v.IsNull() && v.Type() == cty.String && strings.Contains(strings.TrimSuffix(v.AsString(), "\n"), "\n")
}

// one renders a whole value where every nested element carries sym.
func (r *renderer) one(v cty.Value, indent int, sym string, path cty.Path) string {
	if !v.IsKnown() {
		return "(known after apply)"
	}
	if v.IsNull() {
		return "null"
	}
	if r.isSensitive(path) {
		return "(sensitive value)"
	}
	ty := v.Type()
	switch {
	case ty == cty.String:
		s := v.AsString()
		if j, ok := r.jsonOne(s, indent, sym, path); ok {
			return j
		}
		if isMultiline(v) {
			return r.heredoc(s, indent)
		}
		return quote(s)
	case ty == cty.Number:
		return v.AsBigFloat().Text('f', -1)
	case ty == cty.Bool:
		if v.True() {
			return "true"
		}
		return "false"
	case ty.IsListType() || ty.IsSetType() || ty.IsTupleType():
		elems := sliceOf(v)
		if len(elems) == 0 {
			return "[]"
		}
		var sb strings.Builder
		sb.WriteString("[")
		for i, e := range elems {
			sb.WriteString("\n" + prefix(indent, sym) + r.one(e, indent+4, sym, append(copyPath(path), cty.IndexStep{Key: cty.NumberIntVal(int64(i))})) + ",")
		}
		sb.WriteString("\n" + spaces(indent) + "]")
		return sb.String()
	case ty.IsMapType() || ty.IsObjectType():
		m := mapOf(v)
		keys := map[string]bool{}
		pad := 0
		hidden := 0
		for k, e := range m {
			if ty.IsObjectType() && e.IsNull() {
				continue
			}
			if l := len(fmtKey(k, ty.IsObjectType())); l > pad {
				pad = l
			}
			// legacy SDK zero value "" renders as an unchanged attribute
			if ty.IsObjectType() && (sym == "+" || sym == "-") && isEmptyString(e) {
				hidden++
				continue
			}
			keys[k] = true
		}
		if len(keys) == 0 && hidden == 0 {
			return "{}"
		}
		var sb strings.Builder
		sb.WriteString("{")
		for _, k := range sortedKeys(keys) {
			p := append(copyPath(path), keyStep(k, ty.IsObjectType()))
			sb.WriteString("\n" + prefix(indent, sym) + fmt.Sprintf("%-*s = ", pad, fmtKey(k, ty.IsObjectType())) + r.one(m[k], indent+4, sym, p))
		}
		if hidden > 0 {
			sb.WriteString("\n" + spaces(indent+4) + "# (" + plural(hidden, "unchanged attribute") + " hidden)")
		}
		sb.WriteString("\n" + spaces(indent) + "}")
		return sb.String()
	}
	return "?"
}

func keyStep(k string, object bool) cty.PathStep {
	if object {
		return cty.GetAttrStep{Name: k}
	}
	return cty.IndexStep{Key: cty.StringVal(k)}
}

func fmtKey(k string, object bool) string {
	if object && hclsyntax.ValidIdentifier(k) {
		return k
	}
	return quote(k)
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	out := string(b)
	out = strings.ReplaceAll(out, `<`, "<")
	out = strings.ReplaceAll(out, `>`, ">")
	out = strings.ReplaceAll(out, `&`, "&")
	out = strings.ReplaceAll(out, "${", "$${")
	return out
}

func (r *renderer) heredoc(s string, indent int) string {
	var sb strings.Builder
	sb.WriteString("<<-EOT")
	for _, l := range strings.Split(strings.TrimSuffix(s, "\n"), "\n") {
		if l == "" {
			sb.WriteString("\n")
			continue
		}
		sb.WriteString("\n" + spaces(indent+4) + l)
	}
	sb.WriteString("\n" + spaces(indent) + "EOT")
	return sb.String()
}

func (r *renderer) heredocDiff(bv, av cty.Value, indent int) string {
	var sb strings.Builder
	sb.WriteString("<<-EOT")
	bl := strings.Split(strings.TrimSuffix(bv.AsString(), "\n"), "\n")
	al := strings.Split(strings.TrimSuffix(av.AsString(), "\n"), "\n")
	for _, op := range lcsDiff(len(bl), len(al), func(i, j int) bool { return bl[i] == al[j] }) {
		switch op.kind {
		case ' ':
			sb.WriteString("\n" + prefix(indent+2, " ") + bl[op.i])
		case '-':
			sb.WriteString("\n" + prefix(indent+2, "-") + bl[op.i])
		case '+':
			sb.WriteString("\n" + prefix(indent+2, "+") + al[op.j])
		}
	}
	sb.WriteString("\n" + spaces(indent) + "EOT")
	return sb.String()
}

// jsonOne renders a string holding a JSON object/array as jsonencode(...).
func (r *renderer) jsonOne(s string, indent int, sym string, path cty.Path) (string, bool) {
	v, ok := parseJSONValue(s)
	if !ok {
		return "", false
	}
	return "jsonencode(\n" + spaces(indent+4) + r.one(v, indent+4, sym, path) + "\n" + spaces(indent) + ")", true
}

func (r *renderer) jsonDiff(bv, av cty.Value, indent int, path cty.Path) (string, bool) {
	if bv.Type() != cty.String || av.Type() != cty.String || bv.IsNull() || av.IsNull() {
		return "", false
	}
	b, ok1 := parseJSONValue(bv.AsString())
	a, ok2 := parseJSONValue(av.AsString())
	if !ok1 || !ok2 {
		return "", false
	}
	var inner string
	sym := "~"
	if valuesEqual(b, a) {
		sym = " "
		inner = r.one(a, indent+4, " ", path)
	} else if b.Type().IsObjectType() && a.Type().IsObjectType() {
		inner = r.mapDiff(b, a, indent+4, path, true)
	} else if (b.Type().IsTupleType() || b.Type().IsListType()) && (a.Type().IsTupleType() || a.Type().IsListType()) {
		inner = r.listDiff(b, a, indent+4, path, false)
	} else {
		return "", false
	}
	return "jsonencode(\n" + prefix(indent+2, sym) + inner + "\n" + spaces(indent) + ")", true
}

func parseJSONValue(s string) (cty.Value, bool) {
	t := strings.TrimSpace(s)
	if len(t) < 2 || !((t[0] == '{' && t[len(t)-1] == '}') || (t[0] == '[' && t[len(t)-1] == ']')) {
		return cty.NilVal, false
	}
	ty, err := ctyjson.ImpliedType([]byte(t))
	if err != nil {
		return cty.NilVal, false
	}
	v, err := ctyjson.Unmarshal([]byte(t), ty)
	if err != nil {
		return cty.NilVal, false
	}
	return v, true
}

func (r *renderer) mapDiff(bv, av cty.Value, indent int, path cty.Path, object bool) string {
	bm, am := mapOf(bv), mapOf(av)
	keys := map[string]bool{}
	for k, v := range bm {
		if !(object && v.IsNull()) {
			keys[k] = true
		}
	}
	for k, v := range am {
		if !(object && v.IsNull()) {
			keys[k] = true
		}
	}
	pad := 0
	for k := range keys {
		if l := len(fmtKey(k, object)); l > pad {
			pad = l
		}
	}
	var sb strings.Builder
	sb.WriteString("{")
	hidden := 0
	for _, k := range sortedKeys(keys) {
		eb, okb := bm[k]
		ea, oka := am[k]
		if !okb {
			eb = cty.NullVal(ea.Type())
		}
		if !oka {
			ea = cty.NullVal(eb.Type())
		}
		sym := symFor("update", eb, ea)
		if sym == " " {
			hidden++
			continue
		}
		p := append(copyPath(path), keyStep(k, object))
		line := "\n" + prefix(indent, sym) + fmt.Sprintf("%-*s = ", pad, fmtKey(k, object))
		switch sym {
		case "+":
			line += r.one(ea, indent+4, "+", p)
		case "-":
			line += r.one(eb, indent+4, "-", p) + " -> null"
		default:
			line += r.value(eb, ea, indent+4, "~", r.isSensitive(p), p, false)
		}
		if r.forces(p) {
			line += " # forces replacement"
		}
		sb.WriteString(line)
	}
	if hidden > 0 {
		word := "unchanged element"
		if object {
			word = "unchanged attribute"
		}
		sb.WriteString("\n" + spaces(indent+4) + "# (" + plural(hidden, word) + " hidden)")
	}
	sb.WriteString("\n" + spaces(indent) + "}")
	return sb.String()
}

type diffOp struct {
	kind byte
	i, j int
}

// lcsDiff returns an edit script between two sequences.
func lcsDiff(n, m int, eq func(i, j int) bool) []diffOp {
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if eq(i, j) {
				dp[i][j] = dp[i+1][j+1] + 1
			} else {
				dp[i][j] = max(dp[i+1][j], dp[i][j+1])
			}
		}
	}
	var ops []diffOp
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case eq(i, j):
			ops = append(ops, diffOp{' ', i, j})
			i++
			j++
		case dp[i+1][j] >= dp[i][j+1]:
			ops = append(ops, diffOp{'-', i, j})
			i++
		default:
			ops = append(ops, diffOp{'+', i, j})
			j++
		}
	}
	for ; i < n; i++ {
		ops = append(ops, diffOp{'-', i, j})
	}
	for ; j < m; j++ {
		ops = append(ops, diffOp{'+', i, j})
	}
	return ops
}

func (r *renderer) listDiff(bv, av cty.Value, indent int, path cty.Path, set bool) string {
	be, ae := sliceOf(bv), sliceOf(av)
	var sb strings.Builder
	sb.WriteString("[")
	hidden := 0
	elemPath := func(i int) cty.Path {
		return append(copyPath(path), cty.IndexStep{Key: cty.NumberIntVal(int64(i))})
	}
	// Same-length lists of objects are compared element by element so that a
	// changed attribute shows as "~ { ... }" instead of remove + add.
	if !set && len(be) == len(ae) && len(be) > 0 && (be[0].Type().IsObjectType() || be[0].Type().IsMapType()) {
		for i := range be {
			if valuesEqual(be[i], ae[i]) {
				hidden++
				continue
			}
			sb.WriteString("\n" + prefix(indent, "~") + r.mapDiff(be[i], ae[i], indent+4, elemPath(i), be[i].Type().IsObjectType()) + ",")
		}
	} else {
		ops := lcsDiff(len(be), len(ae), func(i, j int) bool { return valuesEqual(be[i], ae[j]) })
		if set {
			// sets have no order: removed first, then added
			sort.SliceStable(ops, func(a, b int) bool { return ops[a].kind == '-' && ops[b].kind != '-' })
		}
		for _, op := range ops {
			switch op.kind {
			case ' ':
				hidden++
			case '-':
				sb.WriteString("\n" + prefix(indent, "-") + r.one(be[op.i], indent+4, "-", elemPath(op.i)) + ",")
			case '+':
				sb.WriteString("\n" + prefix(indent, "+") + r.one(ae[op.j], indent+4, "+", elemPath(op.j)) + ",")
			}
		}
	}
	if hidden > 0 {
		sb.WriteString("\n" + spaces(indent+4) + "# (" + plural(hidden, "unchanged element") + " hidden)")
	}
	sb.WriteString("\n" + spaces(indent) + "]")
	return sb.String()
}

// --- whole plan ---

type planSummary struct {
	Add, Change, Destroy, Read int
}

func summarize(changes []*Change) planSummary {
	var s planSummary
	for _, c := range changes {
		switch c.Action {
		case ActCreate:
			s.Add++
		case ActUpdate:
			s.Change++
		case ActDelete:
			s.Destroy++
		case ActReplace, ActReplaceCBD:
			s.Add++
			s.Destroy++
		case ActRead:
			s.Read++
		}
	}
	return s
}

func visibleChanges(changes []*Change) []*Change {
	var out []*Change
	for _, c := range changes {
		if c.Action == ActNoOp && c.PrevAddr == "" {
			continue
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return addrLess(out[i], out[j]) })
	return out
}

func addrLess(a, b *Change) bool {
	if a.Module != b.Module {
		return a.Module < b.Module
	}
	if a.Mode != b.Mode {
		return a.Mode == "data"
	}
	if a.Type != b.Type {
		return a.Type < b.Type
	}
	if a.Name != b.Name {
		return a.Name < b.Name
	}
	return keyLess(a.Key, b.Key)
}

// RenderPlan renders the full plan body (without the refresh log).
func RenderPlan(changes []*Change, outputs []*OutputChange, destroy bool) string {
	var sb strings.Builder
	vis := visibleChanges(changes)
	sum := summarize(changes)
	var outs []*OutputChange
	outPad := 0
	for _, o := range outputs {
		if len(o.Name) > outPad {
			outPad = len(o.Name)
		}
		if o.Action != ActNoOp {
			outs = append(outs, o)
		}
	}
	if len(vis) == 0 && len(outs) == 0 {
		sb.WriteString("No changes. Your infrastructure matches the configuration.\n\n")
		sb.WriteString("Terraform has compared your real infrastructure against your configuration\nand found no differences, so no changes are needed.\n")
		return sb.String()
	}
	if len(vis) > 0 {
		used := map[Action]bool{}
		for _, c := range vis {
			used[c.Action] = true
		}
		sb.WriteString("Terraform used the selected providers to generate the following execution\nplan. Resource actions are indicated with the following symbols:\n")
		legend := []struct {
			a    Action
			text string
		}{
			{ActCreate, "  + create"},
			{ActUpdate, "  ~ update in-place"},
			{ActDelete, "  - destroy"},
			{ActReplace, "-/+ destroy and then create replacement"},
			{ActReplaceCBD, "+/- create replacement and then destroy"},
			{ActRead, " <= read (data resources)"},
		}
		for _, l := range legend {
			if used[l.a] {
				sb.WriteString(l.text + "\n")
			}
		}
		sb.WriteString("\nTerraform will perform the following actions:\n\n")
		for _, c := range vis {
			sb.WriteString(RenderChange(c))
			sb.WriteString("\n\n")
		}
		sb.WriteString(fmt.Sprintf("Plan: %d to add, %d to change, %d to destroy.\n", sum.Add, sum.Change, sum.Destroy))
	} else {
		sb.WriteString("Changes to Outputs:\n")
		sb.WriteString(renderOutputChanges(outs, outPad))
		sb.WriteString("\nYou can apply this plan to save these new output values to the Terraform\nstate, without changing any real infrastructure.\n")
		return sb.String()
	}
	if len(outs) > 0 {
		sb.WriteString("\nChanges to Outputs:\n")
		sb.WriteString(renderOutputChanges(outs, outPad))
	}
	return sb.String()
}

func renderOutputChanges(outs []*OutputChange, pad int) string {
	sort.Slice(outs, func(i, j int) bool { return outs[i].Name < outs[j].Name })
	var sb strings.Builder
	for _, o := range outs {
		r := &renderer{}
		sym := map[Action]string{ActCreate: "+", ActDelete: "-", ActUpdate: "~"}[o.Action]
		val := r.value(o.Before, o.After, 4, sym, o.Sensitive, nil, false)
		sb.WriteString(prefix(0, sym) + fmt.Sprintf("%-*s = ", pad, o.Name) + val + "\n")
	}
	return sb.String()
}

// FormatValue renders a value the way `terraform output` / console do.
func FormatValue(v cty.Value, indent int) string {
	if v.HasMark(markSensitive) {
		return "(sensitive value)"
	}
	v, _ = v.UnmarkDeep()
	if !v.IsKnown() {
		return "(known after apply)"
	}
	if v.IsNull() {
		return "null"
	}
	ty := v.Type()
	switch {
	case ty == cty.String:
		s := v.AsString()
		if isMultiline(v) {
			var sb strings.Builder
			sb.WriteString("<<EOT")
			for _, l := range strings.Split(strings.TrimSuffix(s, "\n"), "\n") {
				sb.WriteString("\n" + l)
			}
			sb.WriteString("\nEOT")
			return sb.String()
		}
		return quote(s)
	case ty == cty.Number:
		return v.AsBigFloat().Text('f', -1)
	case ty == cty.Bool:
		return fmt.Sprint(v.True())
	case ty.IsListType() || ty.IsSetType() || ty.IsTupleType():
		open, close := "[", "]"
		if ty.IsListType() {
			open, close = "tolist([", "])"
		} else if ty.IsSetType() {
			open, close = "toset([", "])"
		}
		elems := sliceOf(v)
		if len(elems) == 0 {
			return open + close
		}
		var sb strings.Builder
		sb.WriteString(open)
		for _, e := range elems {
			sb.WriteString("\n" + spaces(indent+2) + FormatValue(e, indent+2) + ",")
		}
		sb.WriteString("\n" + spaces(indent) + close)
		return sb.String()
	case ty.IsMapType() || ty.IsObjectType():
		open, close := "{", "}"
		if ty.IsMapType() {
			open, close = "tomap({", "})"
		}
		m := mapOf(v)
		if len(m) == 0 {
			return open + close
		}
		keys := map[string]bool{}
		pad := 0
		for k := range m {
			keys[k] = true
			if l := len(quote(k)); l > pad {
				pad = l
			}
		}
		var sb strings.Builder
		sb.WriteString(open)
		for _, k := range sortedKeys(keys) {
			sb.WriteString("\n" + spaces(indent+2) + fmt.Sprintf("%-*s = ", pad, quote(k)) + FormatValue(m[k], indent+2))
		}
		sb.WriteString("\n" + spaces(indent) + close)
		return sb.String()
	}
	return "?"
}
