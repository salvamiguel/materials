package engine

import (
	"bytes"
	"compress/gzip"
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"hash"
	"math/big"
	"net"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/ext/tryfunc"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	yaml "github.com/zclconf/go-cty-yaml"
	"github.com/zclconf/go-cty/cty"
	"github.com/zclconf/go-cty/cty/convert"
	"github.com/zclconf/go-cty/cty/function"
	"github.com/zclconf/go-cty/cty/function/stdlib"
)

// Functions returns the Terraform function table. baseDir is the module
// directory, used by the file functions which read from the virtual FS.
func (e *evaluator) functions(baseDir string) map[string]function.Function {
	fs := e.files
	resolve := func(p string) string {
		if strings.HasPrefix(p, "/") {
			return strings.TrimPrefix(path.Clean(p), "/")
		}
		return strings.TrimPrefix(path.Clean(path.Join(baseDir, p)), "./")
	}
	readFile := func(p string) (string, error) {
		clean := resolve(p)
		s, ok := fs[clean]
		if !ok {
			return "", fmt.Errorf("no file exists at %q; the playground only knows the files open in the editor", p)
		}
		return s, nil
	}

	fns := map[string]function.Function{
		"abs":             stdlib.AbsoluteFunc,
		"ceil":            stdlib.CeilFunc,
		"floor":           stdlib.FloorFunc,
		"log":             stdlib.LogFunc,
		"max":             stdlib.MaxFunc,
		"min":             stdlib.MinFunc,
		"parseint":        stdlib.ParseIntFunc,
		"pow":             stdlib.PowFunc,
		"signum":          stdlib.SignumFunc,
		"chomp":           stdlib.ChompFunc,
		"format":          stdlib.FormatFunc,
		"formatlist":      stdlib.FormatListFunc,
		"indent":          stdlib.IndentFunc,
		"join":            stdlib.JoinFunc,
		"lower":           stdlib.LowerFunc,
		"regex":           stdlib.RegexFunc,
		"regexall":        stdlib.RegexAllFunc,
		"split":           stdlib.SplitFunc,
		"strrev":          stdlib.ReverseFunc,
		"substr":          stdlib.SubstrFunc,
		"title":           stdlib.TitleFunc,
		"trim":            stdlib.TrimFunc,
		"trimprefix":      stdlib.TrimPrefixFunc,
		"trimsuffix":      stdlib.TrimSuffixFunc,
		"trimspace":       stdlib.TrimSpaceFunc,
		"upper":           stdlib.UpperFunc,
		"chunklist":       stdlib.ChunklistFunc,
		"coalesce":        stdlib.CoalesceFunc,
		"coalescelist":    stdlib.CoalesceListFunc,
		"compact":         stdlib.CompactFunc,
		"concat":          stdlib.ConcatFunc,
		"contains":        stdlib.ContainsFunc,
		"distinct":        stdlib.DistinctFunc,
		"element":         stdlib.ElementFunc,
		"flatten":         stdlib.FlattenFunc,
		"keys":            stdlib.KeysFunc,
		"lookup":          stdlib.LookupFunc,
		"merge":           stdlib.MergeFunc,
		"range":           stdlib.RangeFunc,
		"reverse":         stdlib.ReverseListFunc,
		"setintersection": stdlib.SetIntersectionFunc,
		"setproduct":      stdlib.SetProductFunc,
		"setsubtract":     stdlib.SetSubtractFunc,
		"setunion":        stdlib.SetUnionFunc,
		"slice":           stdlib.SliceFunc,
		"sort":            stdlib.SortFunc,
		"values":          stdlib.ValuesFunc,
		"zipmap":          stdlib.ZipmapFunc,
		"csvdecode":       stdlib.CSVDecodeFunc,
		"jsondecode":      stdlib.JSONDecodeFunc,
		"jsonencode":      stdlib.JSONEncodeFunc,
		"formatdate":      stdlib.FormatDateFunc,
		"timeadd":         stdlib.TimeAddFunc,
		"yamldecode":      yaml.YAMLDecodeFunc,
		"yamlencode":      yaml.YAMLEncodeFunc,
		"try":             tryfunc.TryFunc,
		"can":             tryfunc.CanFunc,
		"length":          lengthFunc,
		"replace":         replaceFunc,
		"index":           indexFunc,
		"one":             oneFunc,
		"alltrue":         allTrueFunc,
		"anytrue":         anyTrueFunc,
		"sum":             sumFunc,
		"transpose":       transposeFunc,
		"matchkeys":       matchkeysFunc,
		"startswith":      strPredicate(strings.HasPrefix),
		"endswith":        strPredicate(strings.HasSuffix),
		"strcontains":     strPredicate(strings.Contains),
		"tobool":          makeToFunc(cty.Bool),
		"tonumber":        makeToFunc(cty.Number),
		"tostring":        makeToFunc(cty.String),
		"tolist":          makeToFunc(cty.List(cty.DynamicPseudoType)),
		"toset":           makeToFunc(cty.Set(cty.DynamicPseudoType)),
		"tomap":           makeToFunc(cty.Map(cty.DynamicPseudoType)),
		"base64encode":    stringFunc(func(s string) (string, error) { return base64.StdEncoding.EncodeToString([]byte(s)), nil }),
		"base64decode": stringFunc(func(s string) (string, error) {
			b, err := base64.StdEncoding.DecodeString(s)
			if err != nil {
				return "", fmt.Errorf("failed to decode base64 data %q", s)
			}
			return string(b), nil
		}),
		"base64gzip": stringFunc(func(s string) (string, error) {
			var buf bytes.Buffer
			w := gzip.NewWriter(&buf)
			w.Write([]byte(s))
			w.Close()
			return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
		}),
		"urlencode":    stringFunc(func(s string) (string, error) { return url.QueryEscape(s), nil }),
		"md5":          hashFunc(md5.New, hex.EncodeToString),
		"sha1":         hashFunc(sha1.New, hex.EncodeToString),
		"sha256":       hashFunc(sha256.New, hex.EncodeToString),
		"sha512":       hashFunc(sha512.New, hex.EncodeToString),
		"base64sha256": hashFunc(sha256.New, base64.StdEncoding.EncodeToString),
		"base64sha512": hashFunc(sha512.New, base64.StdEncoding.EncodeToString),
		"uuid": function.New(&function.Spec{
			Type: function.StaticReturnType(cty.String),
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				return cty.UnknownVal(cty.String), nil
			},
		}),
		"timestamp": function.New(&function.Spec{
			Type: function.StaticReturnType(cty.String),
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				// Like Terraform, timestamp() is only known during apply.
				if e.applying {
					return cty.StringVal(e.now.UTC().Format(time.RFC3339)), nil
				}
				return cty.UnknownVal(cty.String), nil
			},
		}),
		"plantimestamp": function.New(&function.Spec{
			Type: function.StaticReturnType(cty.String),
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				return cty.StringVal(e.now.UTC().Format(time.RFC3339)), nil
			},
		}),
		"cidrhost":    cidrHostFunc,
		"cidrnetmask": cidrNetmaskFunc,
		"cidrsubnet":  cidrSubnetFunc,
		"cidrsubnets": cidrSubnetsFunc,
		"sensitive": function.New(&function.Spec{
			Params: []function.Parameter{{Name: "value", Type: cty.DynamicPseudoType, AllowUnknown: true, AllowNull: true, AllowMarked: true}},
			Type:   func(args []cty.Value) (cty.Type, error) { return args[0].Type(), nil },
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				return args[0].Mark(markSensitive), nil
			},
		}),
		"nonsensitive": function.New(&function.Spec{
			Params: []function.Parameter{{Name: "value", Type: cty.DynamicPseudoType, AllowUnknown: true, AllowNull: true, AllowMarked: true}},
			Type:   func(args []cty.Value) (cty.Type, error) { return args[0].Type(), nil },
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				v, _ := args[0].Unmark()
				return v, nil
			},
		}),
		"issensitive": function.New(&function.Spec{
			Params: []function.Parameter{{Name: "value", Type: cty.DynamicPseudoType, AllowUnknown: true, AllowNull: true, AllowMarked: true}},
			Type:   function.StaticReturnType(cty.Bool),
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				return cty.BoolVal(args[0].HasMark(markSensitive)), nil
			},
		}),
		"file": stringFunc(readFile),
		"fileexists": function.New(&function.Spec{
			Params: []function.Parameter{{Name: "path", Type: cty.String}},
			Type:   function.StaticReturnType(cty.Bool),
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				_, ok := fs[resolve(args[0].AsString())]
				return cty.BoolVal(ok), nil
			},
		}),
		"filebase64": stringFunc(func(p string) (string, error) {
			s, err := readFile(p)
			return base64.StdEncoding.EncodeToString([]byte(s)), err
		}),
		"filemd5":    fileHashFunc(readFile, md5.New),
		"filesha256": fileHashFunc(readFile, sha256.New),
		"fileset": function.New(&function.Spec{
			Params: []function.Parameter{{Name: "path", Type: cty.String}, {Name: "pattern", Type: cty.String}},
			Type:   function.StaticReturnType(cty.Set(cty.String)),
			Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
				base := resolve(args[0].AsString())
				var out []cty.Value
				for name := range fs {
					rel := name
					if base != "." && base != "" {
						if !strings.HasPrefix(name, base+"/") {
							continue
						}
						rel = strings.TrimPrefix(name, base+"/")
					}
					if ok, _ := globMatch(args[1].AsString(), rel); ok {
						out = append(out, cty.StringVal(rel))
					}
				}
				if len(out) == 0 {
					return cty.SetValEmpty(cty.String), nil
				}
				return cty.SetVal(out), nil
			},
		}),
		"basename": stringFunc(func(s string) (string, error) { return path.Base(s), nil }),
		"dirname":  stringFunc(func(s string) (string, error) { return path.Dir(s), nil }),
		"abspath":  stringFunc(func(s string) (string, error) { return "/playground/" + resolve(s), nil }),
		"pathexpand": stringFunc(func(s string) (string, error) {
			return strings.Replace(s, "~", "/home/playground", 1), nil
		}),
	}

	fns["templatefile"] = function.New(&function.Spec{
		Params: []function.Parameter{
			{Name: "path", Type: cty.String},
			{Name: "vars", Type: cty.DynamicPseudoType},
		},
		Type: function.StaticReturnType(cty.DynamicPseudoType),
		Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
			src, err := readFile(args[0].AsString())
			if err != nil {
				return cty.DynamicVal, err
			}
			expr, diags := hclsyntax.ParseTemplate([]byte(src), resolve(args[0].AsString()), hcl.InitialPos)
			if diags.HasErrors() {
				return cty.DynamicVal, diags
			}
			vars := map[string]cty.Value{}
			if v := args[1]; !v.IsNull() && v.IsKnown() && (v.Type().IsObjectType() || v.Type().IsMapType()) {
				for it := v.ElementIterator(); it.Next(); {
					k, ev := it.Element()
					vars[k.AsString()] = ev
				}
			}
			ctx := &hcl.EvalContext{Variables: vars, Functions: fns}
			val, diags := expr.Value(ctx)
			if diags.HasErrors() {
				return cty.DynamicVal, diags
			}
			return val, nil
		},
	})
	return fns
}

var lengthFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "value", Type: cty.DynamicPseudoType, AllowDynamicType: true, AllowUnknown: true, AllowMarked: true}},
	Type:   function.StaticReturnType(cty.Number),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		v := args[0]
		if v.Type() == cty.String {
			return stdlib.Strlen(v)
		}
		return stdlib.Length(v)
	},
})

var replaceFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "str", Type: cty.String}, {Name: "substr", Type: cty.String}, {Name: "replace", Type: cty.String}},
	Type:   function.StaticReturnType(cty.String),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		str, substr, repl := args[0].AsString(), args[1].AsString(), args[2].AsString()
		if len(substr) > 1 && substr[0] == '/' && substr[len(substr)-1] == '/' {
			re, err := regexp.Compile(substr[1 : len(substr)-1])
			if err != nil {
				return cty.UnknownVal(cty.String), err
			}
			return cty.StringVal(re.ReplaceAllString(str, repl)), nil
		}
		return cty.StringVal(strings.ReplaceAll(str, substr, repl)), nil
	},
})

var indexFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "list", Type: cty.DynamicPseudoType}, {Name: "value", Type: cty.DynamicPseudoType}},
	Type:   function.StaticReturnType(cty.Number),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		if !(args[0].Type().IsListType() || args[0].Type().IsTupleType()) {
			return cty.NilVal, fmt.Errorf("argument must be a list or tuple")
		}
		for it := args[0].ElementIterator(); it.Next(); {
			i, v := it.Element()
			eq, err := stdlib.Equal(v, args[1])
			if err != nil {
				return cty.NilVal, err
			}
			if !eq.IsKnown() {
				return cty.UnknownVal(cty.Number), nil
			}
			if eq.True() {
				return i, nil
			}
		}
		return cty.NilVal, fmt.Errorf("item not found")
	},
})

var oneFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "list", Type: cty.DynamicPseudoType}},
	Type: func(args []cty.Value) (cty.Type, error) {
		t := args[0].Type()
		switch {
		case t.IsListType() || t.IsSetType():
			return t.ElementType(), nil
		case t.IsTupleType():
			if n := len(t.TupleElementTypes()); n == 1 {
				return t.TupleElementTypes()[0], nil
			}
			return cty.DynamicPseudoType, nil
		}
		return cty.NilType, fmt.Errorf("must be a list, set, or tuple value")
	},
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		v := args[0]
		n := v.LengthInt()
		switch n {
		case 0:
			return cty.NullVal(retType), nil
		case 1:
			it := v.ElementIterator()
			it.Next()
			_, e := it.Element()
			return e, nil
		}
		return cty.NilVal, fmt.Errorf("must be a list, set, or tuple value with either zero or one elements")
	},
})

func boolFold(any bool) function.Function {
	return function.New(&function.Spec{
		Params: []function.Parameter{{Name: "list", Type: cty.List(cty.Bool)}},
		Type:   function.StaticReturnType(cty.Bool),
		Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
			result := !any
			for it := args[0].ElementIterator(); it.Next(); {
				_, v := it.Element()
				if !v.IsKnown() {
					return cty.UnknownVal(cty.Bool), nil
				}
				if v.IsNull() {
					continue
				}
				if any && v.True() {
					return cty.True, nil
				}
				if !any && v.False() {
					return cty.False, nil
				}
			}
			return cty.BoolVal(result), nil
		},
	})
}

var allTrueFunc = boolFold(false)
var anyTrueFunc = boolFold(true)

var sumFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "list", Type: cty.DynamicPseudoType}},
	Type:   function.StaticReturnType(cty.Number),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		if !args[0].CanIterateElements() || args[0].LengthInt() == 0 {
			return cty.NilVal, fmt.Errorf("cannot sum an empty list")
		}
		total := cty.Zero
		for it := args[0].ElementIterator(); it.Next(); {
			_, v := it.Element()
			n, err := convert.Convert(v, cty.Number)
			if err != nil {
				return cty.NilVal, err
			}
			total = total.Add(n)
		}
		return total, nil
	},
})

var transposeFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "values", Type: cty.Map(cty.List(cty.String))}},
	Type:   function.StaticReturnType(cty.Map(cty.List(cty.String))),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		tmp := map[string][]string{}
		for it := args[0].ElementIterator(); it.Next(); {
			k, list := it.Element()
			for lit := list.ElementIterator(); lit.Next(); {
				_, v := lit.Element()
				tmp[v.AsString()] = append(tmp[v.AsString()], k.AsString())
			}
		}
		out := map[string]cty.Value{}
		for k, vs := range tmp {
			sort.Strings(vs)
			l := make([]cty.Value, len(vs))
			for i, s := range vs {
				l[i] = cty.StringVal(s)
			}
			out[k] = cty.ListVal(l)
		}
		if len(out) == 0 {
			return cty.MapValEmpty(cty.List(cty.String)), nil
		}
		return cty.MapVal(out), nil
	},
})

var matchkeysFunc = function.New(&function.Spec{
	Params: []function.Parameter{
		{Name: "values", Type: cty.List(cty.DynamicPseudoType)},
		{Name: "keys", Type: cty.List(cty.DynamicPseudoType)},
		{Name: "searchset", Type: cty.List(cty.DynamicPseudoType)},
	},
	Type: func(args []cty.Value) (cty.Type, error) { return args[0].Type(), nil },
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		if args[0].LengthInt() != args[1].LengthInt() {
			return cty.NilVal, fmt.Errorf("length of keys and values should be equal")
		}
		vals := args[0].AsValueSlice()
		var out []cty.Value
		i := 0
		for it := args[1].ElementIterator(); it.Next(); i++ {
			_, k := it.Element()
			for sit := args[2].ElementIterator(); sit.Next(); {
				_, s := sit.Element()
				if k.RawEquals(s) {
					out = append(out, vals[i])
					break
				}
			}
		}
		if len(out) == 0 {
			return cty.ListValEmpty(retType.ElementType()), nil
		}
		return cty.ListVal(out), nil
	},
})

func strPredicate(fn func(string, string) bool) function.Function {
	return function.New(&function.Spec{
		Params: []function.Parameter{{Name: "str", Type: cty.String}, {Name: "sub", Type: cty.String}},
		Type:   function.StaticReturnType(cty.Bool),
		Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
			return cty.BoolVal(fn(args[0].AsString(), args[1].AsString())), nil
		},
	})
}

func stringFunc(fn func(string) (string, error)) function.Function {
	return function.New(&function.Spec{
		Params: []function.Parameter{{Name: "str", Type: cty.String}},
		Type:   function.StaticReturnType(cty.String),
		Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
			s, err := fn(args[0].AsString())
			if err != nil {
				return cty.UnknownVal(cty.String), err
			}
			return cty.StringVal(s), nil
		},
	})
}

func hashFunc(h func() hash.Hash, enc func([]byte) string) function.Function {
	return stringFunc(func(s string) (string, error) {
		hh := h()
		hh.Write([]byte(s))
		return enc(hh.Sum(nil)), nil
	})
}

func fileHashFunc(read func(string) (string, error), h func() hash.Hash) function.Function {
	return stringFunc(func(p string) (string, error) {
		s, err := read(p)
		if err != nil {
			return "", err
		}
		hh := h()
		hh.Write([]byte(s))
		return hex.EncodeToString(hh.Sum(nil)), nil
	})
}

func makeToFunc(want cty.Type) function.Function {
	return function.New(&function.Spec{
		Params: []function.Parameter{{Name: "v", Type: cty.DynamicPseudoType, AllowNull: true, AllowDynamicType: true, AllowMarked: true}},
		Type: func(args []cty.Value) (cty.Type, error) {
			gotTy := args[0].Type()
			if gotTy.Equals(want) {
				return gotTy, nil
			}
			conv := convert.GetConversionUnsafe(args[0].Type(), want)
			if conv == nil {
				return cty.NilType, function.NewArgErrorf(0, "cannot convert %s to %s", gotTy.FriendlyNameForConstraint(), want.FriendlyNameForConstraint())
			}
			out, err := conv(cty.UnknownVal(gotTy))
			if err != nil {
				return cty.NilType, err
			}
			return out.Type(), nil
		},
		Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
			v, err := convert.Convert(args[0], retType)
			if err != nil {
				return cty.NilVal, function.NewArgErrorf(0, "cannot convert %s", err)
			}
			return v, nil
		},
	})
}

// --- CIDR functions (ported from Terraform, simplified to IPv4/IPv6 math) ---

func parseCIDR(s string) (*net.IPNet, error) {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		return nil, fmt.Errorf("invalid CIDR expression: %s", err)
	}
	return n, nil
}

func ipToInt(ip net.IP) (*big.Int, int) {
	if v4 := ip.To4(); v4 != nil {
		return big.NewInt(0).SetBytes(v4), 32
	}
	return big.NewInt(0).SetBytes(ip.To16()), 128
}

func intToIP(n *big.Int, bits int) net.IP {
	b := n.Bytes()
	size := bits / 8
	out := make([]byte, size)
	copy(out[size-len(b):], b)
	return net.IP(out)
}

func cidrHost(n *net.IPNet, num *big.Int) (net.IP, error) {
	ones, bits := n.Mask.Size()
	hostBits := bits - ones
	max := big.NewInt(0).Lsh(big.NewInt(1), uint(hostBits))
	if num.Sign() < 0 {
		num = big.NewInt(0).Add(max, num)
	}
	if num.Sign() < 0 || num.Cmp(max) >= 0 {
		return nil, fmt.Errorf("prefix of %d does not accommodate a host numbered %s", ones, num)
	}
	base, _ := ipToInt(n.IP)
	return intToIP(big.NewInt(0).Add(base, num), bits), nil
}

func cidrSubnet(n *net.IPNet, newbits int, num *big.Int) (*net.IPNet, error) {
	ones, bits := n.Mask.Size()
	newPrefix := ones + newbits
	if newbits < 0 || newPrefix > bits {
		return nil, fmt.Errorf("insufficient address space to extend prefix of %d by %d", ones, newbits)
	}
	max := big.NewInt(0).Lsh(big.NewInt(1), uint(newbits))
	if num.Sign() < 0 || num.Cmp(max) >= 0 {
		return nil, fmt.Errorf("prefix extension of %d does not accommodate a subnet numbered %s", newbits, num)
	}
	base, _ := ipToInt(n.IP)
	shifted := big.NewInt(0).Lsh(num, uint(bits-newPrefix))
	ip := intToIP(big.NewInt(0).Or(base, shifted), bits)
	return &net.IPNet{IP: ip, Mask: net.CIDRMask(newPrefix, bits)}, nil
}

var cidrHostFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "prefix", Type: cty.String}, {Name: "hostnum", Type: cty.Number}},
	Type:   function.StaticReturnType(cty.String),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		n, err := parseCIDR(args[0].AsString())
		if err != nil {
			return cty.UnknownVal(cty.String), err
		}
		num, _ := args[1].AsBigFloat().Int(nil)
		ip, err := cidrHost(n, num)
		if err != nil {
			return cty.UnknownVal(cty.String), err
		}
		return cty.StringVal(ip.String()), nil
	},
})

var cidrNetmaskFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "prefix", Type: cty.String}},
	Type:   function.StaticReturnType(cty.String),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		n, err := parseCIDR(args[0].AsString())
		if err != nil {
			return cty.UnknownVal(cty.String), err
		}
		if len(n.Mask) != net.IPv4len {
			return cty.UnknownVal(cty.String), fmt.Errorf("only IPv4 networks are supported")
		}
		return cty.StringVal(net.IP(n.Mask).String()), nil
	},
})

var cidrSubnetFunc = function.New(&function.Spec{
	Params: []function.Parameter{{Name: "prefix", Type: cty.String}, {Name: "newbits", Type: cty.Number}, {Name: "netnum", Type: cty.Number}},
	Type:   function.StaticReturnType(cty.String),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		n, err := parseCIDR(args[0].AsString())
		if err != nil {
			return cty.UnknownVal(cty.String), err
		}
		var newbits int
		if err := gocty(args[1], &newbits); err != nil {
			return cty.UnknownVal(cty.String), err
		}
		num, _ := args[2].AsBigFloat().Int(nil)
		sub, err := cidrSubnet(n, newbits, num)
		if err != nil {
			return cty.UnknownVal(cty.String), err
		}
		return cty.StringVal(sub.String()), nil
	},
})

var cidrSubnetsFunc = function.New(&function.Spec{
	Params:   []function.Parameter{{Name: "prefix", Type: cty.String}},
	VarParam: &function.Parameter{Name: "newbits", Type: cty.Number},
	Type:     function.StaticReturnType(cty.List(cty.String)),
	Impl: func(args []cty.Value, retType cty.Type) (cty.Value, error) {
		n, err := parseCIDR(args[0].AsString())
		if err != nil {
			return cty.UnknownVal(retType), err
		}
		ones, bits := n.Mask.Size()
		base, _ := ipToInt(n.IP)
		cur := big.NewInt(0).Set(base)
		var out []cty.Value
		for _, a := range args[1:] {
			var nb int
			if err := gocty(a, &nb); err != nil {
				return cty.UnknownVal(retType), err
			}
			prefix := ones + nb
			if prefix > bits {
				return cty.UnknownVal(retType), fmt.Errorf("would extend prefix to %d bits, which is too long for an IPv%d address", prefix, map[int]int{32: 4, 128: 6}[bits])
			}
			size := big.NewInt(0).Lsh(big.NewInt(1), uint(bits-prefix))
			// align cur up to size
			rem := big.NewInt(0).Mod(big.NewInt(0).Sub(cur, base), size)
			if rem.Sign() != 0 {
				cur.Add(cur, big.NewInt(0).Sub(size, rem))
			}
			end := big.NewInt(0).Add(base, big.NewInt(0).Lsh(big.NewInt(1), uint(bits-ones)))
			if big.NewInt(0).Add(cur, size).Cmp(end) > 0 {
				return cty.UnknownVal(retType), fmt.Errorf("not enough remaining address space for a subnet with a prefix of %d bits", prefix)
			}
			out = append(out, cty.StringVal((&net.IPNet{IP: intToIP(cur, bits), Mask: net.CIDRMask(prefix, bits)}).String()))
			cur.Add(cur, size)
		}
		if len(out) == 0 {
			return cty.ListValEmpty(cty.String), nil
		}
		return cty.ListVal(out), nil
	},
})

func gocty(v cty.Value, out *int) error {
	bf := v.AsBigFloat()
	i, acc := bf.Int64()
	if acc != big.Exact {
		return fmt.Errorf("value must be a whole number")
	}
	*out = int(i)
	return nil
}

// globMatch implements the subset of doublestar globbing used by fileset.
func globMatch(pattern, name string) (bool, error) {
	var re strings.Builder
	re.WriteByte('^')
	for i := 0; i < len(pattern); i++ {
		c := pattern[i]
		switch c {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				re.WriteString(".*")
				i++
				if i+1 < len(pattern) && pattern[i+1] == '/' {
					i++
					re.WriteString("/?")
				}
			} else {
				re.WriteString("[^/]*")
			}
		case '?':
			re.WriteString("[^/]")
		case '{':
			re.WriteByte('(')
		case '}':
			re.WriteByte(')')
		case ',':
			re.WriteByte('|')
		default:
			re.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	re.WriteByte('$')
	return regexp.MatchString(re.String(), name)
}

// seededUUID builds a deterministic, UUID-shaped string from a seed.
func seededUUID(seed uint64) string {
	var b [16]byte
	binary.BigEndian.PutUint64(b[:8], seed)
	binary.BigEndian.PutUint64(b[8:], seed*0x9E3779B97F4A7C15+0x632BE59BD9B4E019)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
