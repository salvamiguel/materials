package engine

import "github.com/zclconf/go-cty/cty"

type valueMark string

const markSensitive = valueMark("sensitive")

func containsSensitive(v cty.Value) bool {
	_, pvm := v.UnmarkDeepWithPaths()
	for _, pv := range pvm {
		if _, ok := pv.Marks[markSensitive]; ok {
			return true
		}
	}
	return false
}

// markSensitivePaths re-applies sensitivity marks: those that came from the
// configuration and those declared by the provider schema.
func markSensitivePaths(schema *Block, v cty.Value, paths []cty.Path) cty.Value {
	var pvm []cty.PathValueMarks
	for _, p := range paths {
		pvm = append(pvm, cty.PathValueMarks{Path: p, Marks: cty.NewValueMarks(markSensitive)})
	}
	if v.IsKnown() && !v.IsNull() {
		for name, a := range schema.Attributes {
			if a.Sensitive {
				pvm = append(pvm, cty.PathValueMarks{Path: cty.GetAttrPath(name), Marks: cty.NewValueMarks(markSensitive)})
			}
		}
	}
	if len(pvm) == 0 {
		return v
	}
	return v.MarkWithPaths(pvm)
}

func pathHasPrefix(p, prefix cty.Path) bool {
	if len(prefix) > len(p) {
		return false
	}
	return p[:len(prefix)].Equals(prefix)
}
