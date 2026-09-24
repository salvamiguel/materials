package engine

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"hash/fnv"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/zclconf/go-cty/cty"
	"github.com/zclconf/go-cty/cty/convert"
	ctyjson "github.com/zclconf/go-cty/cty/json"
)

const mockAccountID = "123456789012"

var nowFunc = time.Now

// rng is a small deterministic PRNG (xorshift64*).
type rng struct{ s uint64 }

func newRNG(parts ...string) *rng {
	h := fnv.New64a()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	s := h.Sum64()
	if s == 0 {
		s = 0x9E3779B97F4A7C15
	}
	return &rng{s: s}
}

func (r *rng) next() uint64 {
	r.s ^= r.s >> 12
	r.s ^= r.s << 25
	r.s ^= r.s >> 27
	return r.s * 2685821657736338717
}

func (r *rng) intn(n int) int { return int(r.next() % uint64(n)) }

func (r *rng) chars(n int, alphabet string) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = alphabet[r.intn(len(alphabet))]
	}
	return string(b)
}

const (
	hexChars   = "0123456789abcdef"
	digitChars = "0123456789"
	upperChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	lowerChars = "abcdefghijklmnopqrstuvwxyz0123456789"
	alnumChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
)

var petAdjectives = []string{"brave", "calm", "clever", "cosmic", "daring", "eager", "fancy", "gentle", "happy", "jolly", "keen", "lucky", "mighty", "noble", "proud", "quick", "rapid", "shiny", "smart", "sunny", "swift", "tidy", "vivid", "witty", "zesty"}
var petNames = []string{"alpaca", "badger", "beaver", "bison", "camel", "cheetah", "dolphin", "eagle", "falcon", "ferret", "gecko", "heron", "ibex", "jaguar", "koala", "lemur", "lynx", "marmot", "narwhal", "otter", "panda", "puffin", "quokka", "raven", "salmon", "tapir", "walrus", "yak", "zebra"}

func (r *rng) pet(words int, sep string) string {
	if words < 1 {
		words = 2
	}
	parts := make([]string, 0, words)
	for i := 0; i < words-1; i++ {
		parts = append(parts, petAdjectives[r.intn(len(petAdjectives))])
	}
	parts = append(parts, petNames[r.intn(len(petNames))])
	return strings.Join(parts, sep)
}

// mocker fills the unknown values of a planned object during apply.
type mocker struct {
	e         *evaluator
	p         *providerCtx
	rtype     string
	name      string
	schema    *Block
	rng       *rng
	vals      map[string]cty.Value
	resolving map[string]bool
	aws       bool
	google    bool
	project   string
	zone      string
	region    string
}

func (e *evaluator) finalize(p *providerCtx, rtype, addr, name string, schema *Block, planned cty.Value, isData bool) cty.Value {
	if !planned.IsKnown() {
		planned = proposeBlock(schema, cty.NullVal(schema.ImpliedType()), cty.NullVal(schema.ImpliedType()))
	}
	seed := []string{addr, e.prior.Lineage, fmt.Sprint(e.prior.Serial)}
	if isData {
		// The same query returns the same data, wherever it is made from.
		seed = []string{rtype, planned.GoString()}
	}
	m := &mocker{
		e: e, p: p, rtype: rtype, name: name, schema: schema, rng: newRNG(seed...),
		vals: planned.AsValueMap(), resolving: map[string]bool{},
		aws:    p.Source == "hashicorp/aws",
		google: p.Source == "hashicorp/google" || p.Source == "hashicorp/google-beta",
	}
	if m.vals == nil {
		m.vals = map[string]cty.Value{}
	}
	if m.google {
		m.region, m.project, m.zone = p.stringConfig("region"), p.stringConfig("project"), p.stringConfig("zone")
		if m.project == "" {
			m.project = "playground-project"
		}
		if m.region == "" {
			m.region = "us-central1"
		}
		for _, n := range []string{"project", "region", "zone"} {
			if v, ok := m.vals[n]; ok && v.IsKnown() && !v.IsNull() && v.Type() == cty.String && v.AsString() != "" {
				switch n {
				case "project":
					m.project = v.AsString()
				case "region":
					m.region = v.AsString()
				case "zone":
					m.zone = v.AsString()
				}
			}
		}
		if m.zone == "" {
			m.zone = m.region + "-b"
		}
	}
	if m.aws {
		m.region = p.awsRegion()
		if r, ok := m.vals["region"]; ok && r.IsKnown() && !r.IsNull() {
			m.region = r.AsString()
		}
	}
	m.special(isData)
	for _, n := range schema.sortedAttributeNames() {
		m.resolve(n)
	}
	for _, n := range schema.sortedBlockNames() {
		m.vals[n] = m.fillBlock(schema.Blocks[n], m.vals[n])
	}
	out := cty.ObjectVal(m.vals)
	if c, err := convert.Convert(out, schema.ImpliedType()); err == nil {
		return c
	}
	return out
}

func (m *mocker) fillBlock(nb *NestedBlock, v cty.Value) cty.Value {
	elemTy := nb.Block.ImpliedType()
	if !v.IsKnown() {
		switch nb.Nesting {
		case "list":
			return cty.ListValEmpty(elemTy)
		case "set":
			return cty.SetValEmpty(elemTy)
		case "map":
			return cty.MapValEmpty(elemTy)
		default:
			return cty.NullVal(elemTy)
		}
	}
	if v.IsWhollyKnown() {
		return v
	}
	return m.fillDeep(v)
}

// fillDeep replaces unknown leaves by generic values named after the
// attribute that holds them.
func (m *mocker) fillDeep(v cty.Value) cty.Value {
	out, err := cty.Transform(v, func(path cty.Path, v cty.Value) (cty.Value, error) {
		if v.IsKnown() {
			return v, nil
		}
		name := ""
		for i := len(path) - 1; i >= 0; i-- {
			if s, ok := path[i].(cty.GetAttrStep); ok {
				name = s.Name
				break
			}
		}
		// Each nested value gets its own seed so the result does not depend
		// on the (map) iteration order of cty.Transform.
		saved := m.rng
		m.rng = newRNG(fmt.Sprint(saved.s), pathString(path))
		out := m.generic(name, v.Type())
		m.rng = saved
		return out, nil
	})
	if err != nil {
		return v
	}
	return out
}

func (m *mocker) resolve(name string) cty.Value {
	v, ok := m.vals[name]
	if !ok {
		return cty.NilVal
	}
	if v.IsWhollyKnown() {
		return v
	}
	if m.resolving[name] {
		return m.generic(name, v.Type())
	}
	m.resolving[name] = true
	defer delete(m.resolving, name)
	a := m.schema.Attributes[name]
	var nv cty.Value
	if !v.IsKnown() {
		if tpl, ok := m.schema.Mock[name]; ok {
			nv = m.template(tpl, a.ty)
		}
		if nv == cty.NilVal {
			nv = m.generic(name, a.ty)
		}
	} else {
		nv = m.fillDeep(v)
	}
	m.vals[name] = nv
	return nv
}

func (m *mocker) str(name string) string {
	v := m.resolve(name)
	if v == cty.NilVal || v.IsNull() || !v.IsKnown() {
		return ""
	}
	switch v.Type() {
	case cty.String:
		return v.AsString()
	case cty.Number:
		return v.AsBigFloat().Text('f', -1)
	case cty.Bool:
		return fmt.Sprint(v.True())
	}
	return ""
}

var placeholderRe = regexp.MustCompile(`\{([a-z]+)(?::([^{}]*))?\}`)

func (m *mocker) render(s string) string {
	return placeholderRe.ReplaceAllStringFunc(s, func(ph string) string {
		sm := placeholderRe.FindStringSubmatch(ph)
		kind, arg := sm[1], sm[2]
		n := 0
		fmt.Sscan(arg, &n)
		switch kind {
		case "id":
			return m.str("id")
		case "region":
			return m.region
		case "project":
			return m.project
		case "zone":
			return m.zone
		case "account":
			return mockAccountID
		case "partition":
			return "aws"
		case "name":
			return m.name
		case "az":
			return m.region + "a"
		case "azid":
			return azID(m.region)
		case "hex":
			return m.rng.chars(n, hexChars)
		case "digits":
			return m.rng.chars(n, digitChars)
		case "upper":
			return m.rng.chars(n, upperChars)
		case "lower":
			return m.rng.chars(n, lowerChars)
		case "alnum":
			return m.rng.chars(n, alnumChars)
		case "uuid":
			return seededUUID(m.rng.next())
		case "now":
			return m.e.now.UTC().Format(time.RFC3339)
		case "pet":
			return m.rng.pet(2, "-")
		case "attr":
			return m.str(arg)
		case "dash":
			return strings.ReplaceAll(m.str(arg), ".", "-")
		case "ip":
			parts := strings.Split(arg, ".")
			for len(parts) < 4 {
				parts = append(parts, fmt.Sprint(1+m.rng.intn(250)))
			}
			return strings.Join(parts, ".")
		case "pubip":
			return fmt.Sprintf("%d.%d.%d.%d", []int{3, 18, 34, 52, 54}[m.rng.intn(5)], m.rng.intn(256), m.rng.intn(256), 1+m.rng.intn(254))
		}
		return ph
	})
}

func azID(region string) string {
	parts := strings.Split(region, "-")
	var sb strings.Builder
	for i, p := range parts {
		if p == "" {
			continue
		}
		if i == len(parts)-1 {
			sb.WriteString(p)
		} else {
			sb.WriteByte(p[0])
		}
	}
	return sb.String() + "-az1"
}

// template renders a JSON template (strings with placeholders) and converts
// the result to the attribute type.
func (m *mocker) template(raw json.RawMessage, ty cty.Type) cty.Value {
	var tpl any
	if err := json.Unmarshal(raw, &tpl); err != nil {
		return cty.NilVal
	}
	var walk func(any) any
	walk = func(x any) any {
		switch t := x.(type) {
		case string:
			return m.render(t)
		case []any:
			for i := range t {
				t[i] = walk(t[i])
			}
		case map[string]any:
			for k := range t {
				t[k] = walk(t[k])
			}
		}
		return x
	}
	rendered, _ := json.Marshal(walk(tpl))
	implied, err := ctyjson.ImpliedType(rendered)
	if err != nil {
		return cty.NilVal
	}
	v, err := ctyjson.Unmarshal(rendered, implied)
	if err != nil {
		return cty.NilVal
	}
	if c, err := convert.Convert(v, ty); err == nil {
		return c
	}
	return cty.NilVal
}

var awsIDPrefixes = map[string]string{
	"instance": "i", "vpc": "vpc", "subnet": "subnet", "security_group": "sg",
	"route_table": "rtb", "network_acl": "acl", "network_interface": "eni",
	"internet_gateway": "igw", "nat_gateway": "nat", "dhcp_options": "dopt",
	"allocation": "eipalloc", "image": "ami", "ami": "ami", "volume": "vol",
	"snapshot": "snap", "key_pair": "key", "launch_template": "lt",
	"transit_gateway": "tgw", "vpc_endpoint": "vpce", "association": "rtbassoc",
	"security_group_rule": "sgr", "prefix_list": "pl", "egress_only_gateway": "eigw",
	"ipv6_association": "vpc-cidr-assoc", "vpn_gateway": "vgw", "customer_gateway": "cgw",
}

func awsIDFor(key string, r *rng) string {
	if p, ok := awsIDPrefixes[key]; ok {
		return p + "-0" + r.chars(16, hexChars)
	}
	return ""
}

// generic returns a plausible value for an attribute nobody described.
func (m *mocker) generic(name string, ty cty.Type) cty.Value {
	switch {
	case ty == cty.String:
		return cty.StringVal(m.genericString(name))
	case ty == cty.Number:
		return cty.Zero
	case ty == cty.Bool:
		return cty.False
	case ty.IsListType():
		return cty.ListValEmpty(ty.ElementType())
	case ty.IsSetType():
		return cty.SetValEmpty(ty.ElementType())
	case ty.IsMapType():
		return cty.MapValEmpty(ty.ElementType())
	}
	return cty.NullVal(ty)
}

func (m *mocker) genericString(name string) string {
	if m.google {
		return m.googleString(name)
	}
	if !m.aws {
		if name == "id" {
			return seededUUID(m.rng.next())
		}
		return ""
	}
	short := strings.TrimPrefix(m.rtype, "aws_")
	svc := short
	kind := short
	if i := strings.IndexByte(short, '_'); i > 0 {
		svc, kind = short[:i], strings.ReplaceAll(short[i+1:], "_", "-")
	}
	switch {
	case name == "id":
		if id := awsIDFor(short, m.rng); id != "" {
			return id
		}
		for _, n := range []string{"name", "bucket", "function_name", "identifier", "cluster_name", "key_name", "role"} {
			if s := m.str(n); s != "" && n != "id" {
				if m.schema.Attributes[n] != nil {
					return s
				}
			}
		}
		return seededUUID(m.rng.next())
	case name == "arn":
		id := m.str("id")
		if n := m.str("name"); n != "" {
			id = n
		}
		return fmt.Sprintf("arn:aws:%s:%s:%s:%s/%s", svc, m.region, mockAccountID, kind, id)
	case name == "owner_id" || name == "account_id" || name == "owner" || name == "registry_id":
		return mockAccountID
	case name == "region":
		return m.region
	case name == "availability_zone":
		return m.region + "a"
	case name == "availability_zone_id":
		return azID(m.region)
	case name == "private_ip" || strings.HasSuffix(name, "private_ip_address"):
		return fmt.Sprintf("10.0.%d.%d", m.rng.intn(256), 4+m.rng.intn(250))
	case name == "public_ip" || strings.HasSuffix(name, "public_ip_address"):
		return fmt.Sprintf("54.%d.%d.%d", m.rng.intn(256), m.rng.intn(256), 1+m.rng.intn(254))
	case strings.HasSuffix(name, "_date") || strings.HasSuffix(name, "_time") || name == "created_at" || name == "last_modified" || name == "creation_date":
		return m.e.now.UTC().Format(time.RFC3339)
	case strings.HasSuffix(name, "_id"):
		base := strings.TrimSuffix(name, "_id")
		base = strings.TrimPrefix(base, "default_")
		base = strings.TrimPrefix(base, "main_")
		base = strings.TrimPrefix(base, "primary_")
		if id := awsIDFor(base, m.rng); id != "" {
			return id
		}
		return ""
	case name == "dns_name" || strings.HasSuffix(name, "_dns"):
		return fmt.Sprintf("%s-%s.%s.%s.amazonaws.com", svc, m.rng.chars(10, digitChars), m.region, svc)
	}
	return ""
}

// special implements provider specific apply-time behaviour.
func (m *mocker) special(isData bool) {
	setIfUnknown := func(name string, v cty.Value) {
		cur, ok := m.vals[name]
		if !ok || cur.IsWhollyKnown() {
			return
		}
		if c, err := convert.Convert(v, cur.Type()); err == nil {
			m.vals[name] = c
		}
	}
	getInt := func(name string, def int) int {
		v, ok := m.vals[name]
		if !ok || v.IsNull() || !v.IsKnown() {
			return def
		}
		var i int
		if gocty(v, &i) != nil {
			return def
		}
		return i
	}
	getBool := func(name string, def bool) bool {
		v, ok := m.vals[name]
		if !ok || v.IsNull() || !v.IsKnown() || v.Type() != cty.Bool {
			return def
		}
		return v.True()
	}
	getStr := func(name, def string) string {
		v, ok := m.vals[name]
		if !ok || v.IsNull() || !v.IsKnown() || v.Type() != cty.String {
			return def
		}
		return v.AsString()
	}

	switch m.rtype {
	case "terraform_data":
		setIfUnknown("id", cty.StringVal(seededUUID(m.rng.next())))
		if in, ok := m.vals["input"]; ok {
			if out := m.vals["output"]; !out.IsWhollyKnown() {
				m.vals["output"] = in
			}
		}
	case "null_resource":
		setIfUnknown("id", cty.StringVal(m.rng.chars(19, digitChars)))
	case "random_pet":
		pet := m.rng.pet(getInt("length", 2), getStr("separator", "-"))
		if p := getStr("prefix", ""); p != "" {
			pet = p + getStr("separator", "-") + pet
		}
		setIfUnknown("id", cty.StringVal(pet))
	case "random_id":
		n := getInt("byte_length", 8)
		b := make([]byte, n)
		for i := range b {
			b[i] = byte(m.rng.next())
		}
		prefix := getStr("prefix", "")
		b64url := base64.RawURLEncoding.EncodeToString(b)
		setIfUnknown("id", cty.StringVal(b64url))
		setIfUnknown("b64_url", cty.StringVal(prefix+b64url))
		setIfUnknown("b64_std", cty.StringVal(prefix+base64.StdEncoding.EncodeToString(b)))
		setIfUnknown("hex", cty.StringVal(prefix+hex.EncodeToString(b)))
		setIfUnknown("dec", cty.StringVal(prefix+new(big.Int).SetBytes(b).String()))
	case "random_string", "random_password":
		alphabet := ""
		if getBool("lower", true) {
			alphabet += "abcdefghijklmnopqrstuvwxyz"
		}
		if getBool("upper", true) {
			alphabet += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		}
		if getBool("numeric", true) && getBool("number", true) {
			alphabet += digitChars
		}
		if getBool("special", true) {
			alphabet += getStr("override_special", "!@#$%&*()-_=+[]{}<>:?")
		}
		if alphabet == "" {
			alphabet = lowerChars
		}
		res := m.rng.chars(getInt("length", 16), alphabet)
		setIfUnknown("result", cty.StringVal(res))
		if m.rtype == "random_string" {
			setIfUnknown("id", cty.StringVal(res))
		} else {
			setIfUnknown("id", cty.StringVal("none"))
			setIfUnknown("bcrypt_hash", cty.StringVal("$2a$10$"+m.rng.chars(53, alnumChars)))
		}
	case "random_integer":
		lo, hi := getInt("min", 0), getInt("max", 100)
		if hi < lo {
			hi = lo
		}
		v := lo + m.rng.intn(hi-lo+1)
		setIfUnknown("result", cty.NumberIntVal(int64(v)))
		setIfUnknown("id", cty.StringVal(fmt.Sprint(v)))
	case "random_uuid":
		u := seededUUID(m.rng.next())
		setIfUnknown("result", cty.StringVal(u))
		setIfUnknown("id", cty.StringVal(u))
	case "random_shuffle":
		in := m.vals["input"]
		if in.IsKnown() && !in.IsNull() {
			elems := in.AsValueSlice()
			for i := len(elems) - 1; i > 0; i-- {
				j := m.rng.intn(i + 1)
				elems[i], elems[j] = elems[j], elems[i]
			}
			if n := getInt("result_count", len(elems)); n < len(elems) {
				elems = elems[:n]
			}
			if len(elems) == 0 {
				setIfUnknown("result", cty.ListValEmpty(cty.String))
			} else {
				setIfUnknown("result", cty.ListVal(elems))
			}
		}
		setIfUnknown("id", cty.StringVal("-"))
	case "random_bytes":
		n := getInt("length", 32)
		b := make([]byte, n)
		for i := range b {
			b[i] = byte(m.rng.next())
		}
		setIfUnknown("base64", cty.StringVal(base64.StdEncoding.EncodeToString(b)))
		setIfUnknown("hex", cty.StringVal(hex.EncodeToString(b)))
		setIfUnknown("id", cty.StringVal("none"))
	case "local_file", "local_sensitive_file":
		content := getStr("content", "")
		if content == "" {
			content = getStr("sensitive_content", "")
		}
		if b64 := getStr("content_base64", ""); b64 != "" {
			if raw, err := base64.StdEncoding.DecodeString(b64); err == nil {
				content = string(raw)
			}
		}
		b := []byte(content)
		s1, s256, s512, m5 := sha1.Sum(b), sha256.Sum256(b), sha512.Sum512(b), md5.Sum(b)
		setIfUnknown("id", cty.StringVal(hex.EncodeToString(s1[:])))
		setIfUnknown("content_sha1", cty.StringVal(hex.EncodeToString(s1[:])))
		setIfUnknown("content_sha256", cty.StringVal(hex.EncodeToString(s256[:])))
		setIfUnknown("content_sha512", cty.StringVal(hex.EncodeToString(s512[:])))
		setIfUnknown("content_md5", cty.StringVal(hex.EncodeToString(m5[:])))
		setIfUnknown("content_base64sha256", cty.StringVal(base64.StdEncoding.EncodeToString(s256[:])))
		setIfUnknown("content_base64sha512", cty.StringVal(base64.StdEncoding.EncodeToString(s512[:])))
		if isData {
			if f, ok := m.e.files[strings.TrimPrefix(getStr("filename", ""), "./")]; ok {
				setIfUnknown("content", cty.StringVal(f))
				setIfUnknown("content_base64", cty.StringVal(base64.StdEncoding.EncodeToString([]byte(f))))
			}
		}
	case "google_iam_policy":
		type binding struct {
			Members []string `json:"members"`
			Role    string   `json:"role"`
		}
		var bindings []binding
		if bs := m.vals["binding"]; bs.IsKnown() && !bs.IsNull() {
			for it := bs.ElementIterator(); it.Next(); {
				_, b := it.Element()
				var members []string
				if ms := b.GetAttr("members"); !ms.IsNull() && ms.IsKnown() {
					for mit := ms.ElementIterator(); mit.Next(); {
						_, mv := mit.Element()
						members = append(members, mv.AsString())
					}
				}
				sort.Strings(members)
				bindings = append(bindings, binding{Members: members, Role: b.GetAttr("role").AsString()})
			}
		}
		sort.Slice(bindings, func(i, j int) bool { return bindings[i].Role < bindings[j].Role })
		doc, _ := json.Marshal(map[string]any{"bindings": bindings})
		setIfUnknown("policy_data", cty.StringVal(string(doc)))
		setIfUnknown("id", cty.StringVal(fmt.Sprint(int(crc32.ChecksumIEEE(doc)))))
	case "aws_iam_policy_document":
		doc := policyDocument(m.vals)
		pretty, _ := json.MarshalIndent(doc, "", "  ")
		mini, _ := json.Marshal(doc)
		setIfUnknown("json", cty.StringVal(string(pretty)))
		setIfUnknown("minified_json", cty.StringVal(string(mini)))
		setIfUnknown("id", cty.StringVal(fmt.Sprint(int(crc32.ChecksumIEEE(pretty)))))
	}
}

// policyDocument renders an aws_iam_policy_document data source the way the
// AWS provider does (field order, set ordering and single-value collapsing).
type iamPolicyDoc struct {
	Version    string          `json:",omitempty"`
	ID         string          `json:"Id,omitempty"`
	Statements []*iamStatement `json:"Statement,omitempty"`
}

type iamStatement struct {
	Sid           string                    `json:",omitempty"`
	Effect        string                    `json:",omitempty"`
	Actions       any                       `json:"Action,omitempty"`
	NotActions    any                       `json:"NotAction,omitempty"`
	Resources     any                       `json:"Resource,omitempty"`
	NotResources  any                       `json:"NotResource,omitempty"`
	Principals    any                       `json:"Principal,omitempty"`
	NotPrincipals any                       `json:"NotPrincipal,omitempty"`
	Conditions    map[string]map[string]any `json:"Condition,omitempty"`
}

// sdkSetOrder orders strings like a terraform-plugin-sdk schema.Set does:
// by the decimal string of their crc32 hash code.
func sdkSetOrder(in []string) []string {
	out := append([]string(nil), in...)
	key := func(s string) string { return fmt.Sprint(int(crc32.ChecksumIEEE([]byte(s)))) }
	sort.SliceStable(out, func(i, j int) bool { return key(out[i]) < key(out[j]) })
	return out
}

func policyDocument(vals map[string]cty.Value) *iamPolicyDoc {
	doc := &iamPolicyDoc{Version: "2012-10-17"}
	if v := vals["version"]; v.IsKnown() && !v.IsNull() && v.AsString() != "" {
		doc.Version = v.AsString()
	}
	if v := vals["policy_id"]; v.IsKnown() && !v.IsNull() {
		doc.ID = v.AsString()
	}
	strs := func(v cty.Value) []string {
		if v.IsNull() || !v.IsKnown() {
			return nil
		}
		var out []string
		for it := v.ElementIterator(); it.Next(); {
			_, e := it.Element()
			if e.IsKnown() && !e.IsNull() {
				out = append(out, e.AsString())
			}
		}
		return sdkSetOrder(out)
	}
	oneOrMany := func(s []string) any {
		switch len(s) {
		case 0:
			return nil
		case 1:
			return s[0]
		}
		return s
	}
	principals := func(ps cty.Value) any {
		if ps.IsNull() || !ps.IsKnown() || ps.LengthInt() == 0 {
			return nil
		}
		pm := map[string]any{}
		for it := ps.ElementIterator(); it.Next(); {
			_, p := it.Element()
			typ := p.GetAttr("type").AsString()
			ids := strs(p.GetAttr("identifiers"))
			if typ == "*" && len(ids) == 1 && ids[0] == "*" {
				return "*"
			}
			pm[typ] = oneOrMany(ids)
		}
		return pm
	}
	if st := vals["statement"]; st.IsKnown() && !st.IsNull() {
		for it := st.ElementIterator(); it.Next(); {
			_, s := it.Element()
			out := &iamStatement{Effect: "Allow"}
			if sid := s.GetAttr("sid"); !sid.IsNull() {
				out.Sid = sid.AsString()
			}
			if ef := s.GetAttr("effect"); !ef.IsNull() && ef.AsString() != "" {
				out.Effect = ef.AsString()
			}
			out.Actions = oneOrMany(strs(s.GetAttr("actions")))
			out.NotActions = oneOrMany(strs(s.GetAttr("not_actions")))
			out.Resources = oneOrMany(strs(s.GetAttr("resources")))
			out.NotResources = oneOrMany(strs(s.GetAttr("not_resources")))
			out.Principals = principals(s.GetAttr("principals"))
			out.NotPrincipals = principals(s.GetAttr("not_principals"))
			if cs := s.GetAttr("condition"); !cs.IsNull() && cs.IsKnown() && cs.LengthInt() > 0 {
				out.Conditions = map[string]map[string]any{}
				for cit := cs.ElementIterator(); cit.Next(); {
					_, c := cit.Element()
					test := c.GetAttr("test").AsString()
					if out.Conditions[test] == nil {
						out.Conditions[test] = map[string]any{}
					}
					out.Conditions[test][c.GetAttr("variable").AsString()] = oneOrMany(strs(c.GetAttr("values")))
				}
			}
			doc.Statements = append(doc.Statements, out)
		}
	}
	return doc
}

// --- apply log ---

var slowTypes = map[string]int{
	"aws_instance": 13, "aws_db_instance": 247, "aws_rds_cluster": 92, "aws_nat_gateway": 95,
	"aws_eks_cluster": 562, "aws_eks_node_group": 183, "aws_lb": 163, "aws_cloudfront_distribution": 214,
	"aws_elasticache_cluster": 311, "aws_ecs_service": 12, "aws_lambda_function": 7, "aws_eip": 1,
}

func fmtDuration(s int) string {
	if s < 60 {
		return fmt.Sprintf("%ds", s)
	}
	return fmt.Sprintf("%dm%ds", s/60, s%60)
}

func (e *evaluator) logApply(c *Change, result cty.Value) {
	secs := slowTypes[c.Type]
	if secs == 0 {
		secs = 1
	}
	still := func(verb string) {
		for t := 10; t < secs && t <= 30; t += 10 {
			e.log = append(e.log, fmt.Sprintf("%s: Still %s... [%s elapsed]", c.Addr, verb, fmtDuration(t)))
		}
	}
	oldID := idOf(c.Before)
	switch c.Action {
	case ActCreate:
		e.log = append(e.log, c.Addr+": Creating...")
		still("creating")
		e.log = append(e.log, fmt.Sprintf("%s: Creation complete after %s [id=%s]", c.Addr, fmtDuration(secs), idOf(result)))
	case ActUpdate:
		e.log = append(e.log, fmt.Sprintf("%s: Modifying... [id=%s]", c.Addr, oldID))
		e.log = append(e.log, fmt.Sprintf("%s: Modifications complete after 1s [id=%s]", c.Addr, idOf(result)))
	case ActReplace:
		e.log = append(e.log, fmt.Sprintf("%s: Destroying... [id=%s]", c.Addr, oldID))
		e.log = append(e.log, fmt.Sprintf("%s: Destruction complete after 1s", c.Addr))
		e.log = append(e.log, c.Addr+": Creating...")
		still("creating")
		e.log = append(e.log, fmt.Sprintf("%s: Creation complete after %s [id=%s]", c.Addr, fmtDuration(secs), idOf(result)))
	case ActReplaceCBD:
		deposed := newRNG(c.Addr, oldID).chars(8, hexChars)
		e.log = append(e.log, c.Addr+": Creating...")
		still("creating")
		e.log = append(e.log, fmt.Sprintf("%s: Creation complete after %s [id=%s]", c.Addr, fmtDuration(secs), idOf(result)))
		e.log = append(e.log, fmt.Sprintf("%s (deposed object %s): Destroying... [id=%s]", c.Addr, deposed, oldID))
		e.log = append(e.log, fmt.Sprintf("%s (deposed object %s): Destruction complete after 1s", c.Addr, deposed))
	case ActDelete:
		e.log = append(e.log, fmt.Sprintf("%s: Destroying... [id=%s]", c.Addr, oldID))
		e.log = append(e.log, fmt.Sprintf("%s: Destruction complete after 1s", c.Addr))
	}
}

// googleString invents GCP-looking values for attributes without template.
func (m *mocker) googleString(name string) string {
	short := strings.TrimPrefix(m.rtype, "google_")
	kind := short
	if i := strings.IndexByte(short, '_'); i > 0 {
		kind = short[i+1:]
	}
	camel := ""
	for i, part := range strings.Split(kind, "_") {
		if i > 0 && part != "" {
			part = strings.ToUpper(part[:1]) + part[1:]
		}
		camel += part
	}
	switch {
	case name == "id":
		n := m.str("name")
		if n == "" {
			n = m.rng.chars(10, lowerChars)
		}
		loc := "global"
		if _, ok := m.vals["zone"]; ok {
			loc = "zones/" + m.zone
		} else if _, ok := m.vals["region"]; ok {
			loc = "regions/" + m.region
		} else if l := m.str("location"); l != "" {
			loc = "locations/" + l
		}
		return fmt.Sprintf("projects/%s/%s/%ss/%s", m.project, loc, camel, n)
	case name == "self_link":
		id := m.str("id")
		if strings.HasPrefix(short, "compute_") {
			return "https://www.googleapis.com/compute/v1/" + id
		}
		return "https://" + strings.SplitN(short, "_", 2)[0] + ".googleapis.com/v1/" + id
	case name == "project" || strings.HasSuffix(name, "_project"):
		return m.project
	case name == "region":
		return m.region
	case name == "zone":
		return m.zone
	case name == "nat_ip" || strings.HasSuffix(name, "public_ip_address") || name == "public_ip":
		return fmt.Sprintf("34.%d.%d.%d", m.rng.intn(256), m.rng.intn(256), 1+m.rng.intn(254))
	case name == "network_ip" || name == "gateway_address" || strings.HasSuffix(name, "private_ip_address") || name == "internal_ip":
		return fmt.Sprintf("10.%d.%d.%d", m.rng.intn(256), m.rng.intn(256), 2+m.rng.intn(250))
	case strings.HasSuffix(name, "_timestamp") || name == "create_time" || name == "update_time" || name == "creation_time":
		return m.e.now.UTC().Format("2006-01-02T15:04:05.000-07:00")
	case strings.HasSuffix(name, "fingerprint"):
		return m.rng.chars(11, alnumChars) + "="
	case name == "etag":
		return "BwY" + m.rng.chars(9, alnumChars) + "="
	case name == "unique_id" || name == "numeric_id" || name == "instance_id" || strings.HasSuffix(name, "network_id") || name == "project_number" || name == "number":
		return m.rng.chars(19, digitChars)
	case name == "name":
		return "nic0"
	case name == "cpu_platform":
		return "Intel Broadwell"
	case name == "current_status" || name == "status" || name == "state":
		return "RUNNING"
	case name == "direction":
		return "INGRESS"
	}
	return ""
}
