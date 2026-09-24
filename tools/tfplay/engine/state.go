package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/zclconf/go-cty/cty"
	ctyjson "github.com/zclconf/go-cty/cty/json"
)

const terraformVersion = "1.16.4"

// State is the in-memory form of a terraform.tfstate (format version 4).
type State struct {
	Lineage   string
	Serial    int64
	Outputs   map[string]*OutputState
	Instances map[string]*InstanceState
}

type OutputState struct {
	Value     cty.Value
	Sensitive bool
}

type InstanceState struct {
	Module              string // "", "module.net", "module.net[0].module.sub"
	Mode                string // managed | data
	Type                string
	Name                string
	Key                 cty.Value // cty.NilVal, a number (count) or a string (for_each)
	Provider            string
	SchemaVersion       int
	RawAttrs            json.RawMessage
	Value               cty.Value // decoded lazily against the schema
	Deps                []string
	CreateBeforeDestroy bool
}

func (i *InstanceState) ResourceAddr() string {
	return resourceAddr(i.Module, i.Mode, i.Type, i.Name)
}

func (i *InstanceState) Addr() string {
	a := i.ResourceAddr()
	if i.Key != cty.NilVal {
		a += indexString(i.Key)
	}
	return a
}

func resourceAddr(module, mode, typ, name string) string {
	var sb strings.Builder
	if module != "" {
		sb.WriteString(module)
		sb.WriteByte('.')
	}
	if mode == "data" {
		sb.WriteString("data.")
	}
	sb.WriteString(typ)
	sb.WriteByte('.')
	sb.WriteString(name)
	return sb.String()
}

func NewState() *State {
	return &State{
		Lineage:   newLineage(),
		Outputs:   map[string]*OutputState{},
		Instances: map[string]*InstanceState{},
	}
}

var lineageCounter uint64

func newLineage() string {
	lineageCounter++
	return seededUUID(uint64(nowFunc().UnixNano()) ^ lineageCounter*0x9E3779B97F4A7C15)
}

// --- JSON (tfstate v4) ---

type stateFileV4 struct {
	Version          int                        `json:"version"`
	TerraformVersion string                     `json:"terraform_version"`
	Serial           int64                      `json:"serial"`
	Lineage          string                     `json:"lineage"`
	Outputs          map[string]outputStateV4   `json:"outputs"`
	Resources        []resourceStateV4          `json:"resources"`
	CheckResults     json.RawMessage            `json:"check_results"`
	Extra            map[string]json.RawMessage `json:"-"`
}

type outputStateV4 struct {
	Value     json.RawMessage `json:"value"`
	Type      json.RawMessage `json:"type"`
	Sensitive bool            `json:"sensitive,omitempty"`
}

type resourceStateV4 struct {
	Module    string            `json:"module,omitempty"`
	Mode      string            `json:"mode"`
	Type      string            `json:"type"`
	Name      string            `json:"name"`
	Each      string            `json:"each,omitempty"`
	Provider  string            `json:"provider"`
	Instances []instanceStateV4 `json:"instances"`
}

type instanceStateV4 struct {
	IndexKey            json.RawMessage `json:"index_key,omitempty"`
	SchemaVersion       int             `json:"schema_version"`
	Attributes          json.RawMessage `json:"attributes"`
	SensitiveAttributes json.RawMessage `json:"sensitive_attributes"`
	IdentitySchemaVer   *int            `json:"identity_schema_version,omitempty"`
	Private             string          `json:"private,omitempty"`
	Dependencies        []string        `json:"dependencies,omitempty"`
	CreateBeforeDestroy bool            `json:"create_before_destroy,omitempty"`
}

// ParseState reads a tfstate. An empty string yields an empty state.
func ParseState(data string) (*State, error) {
	s := NewState()
	if strings.TrimSpace(data) == "" {
		return s, nil
	}
	var f stateFileV4
	if err := json.Unmarshal([]byte(data), &f); err != nil {
		return nil, fmt.Errorf("the state file could not be read: %s", err)
	}
	if f.Version != 4 {
		return nil, fmt.Errorf("unsupported state file format version %d (only version 4 is supported)", f.Version)
	}
	if f.Lineage != "" {
		s.Lineage = f.Lineage
	}
	s.Serial = f.Serial
	for name, o := range f.Outputs {
		ty, err := ctyjson.UnmarshalType(o.Type)
		if err != nil {
			return nil, fmt.Errorf("output %s: %s", name, err)
		}
		v, err := ctyjson.Unmarshal(o.Value, ty)
		if err != nil {
			return nil, fmt.Errorf("output %s: %s", name, err)
		}
		s.Outputs[name] = &OutputState{Value: v, Sensitive: o.Sensitive}
	}
	for _, r := range f.Resources {
		for _, is := range r.Instances {
			inst := &InstanceState{
				Module:              r.Module,
				Mode:                r.Mode,
				Type:                r.Type,
				Name:                r.Name,
				Key:                 cty.NilVal,
				Provider:            r.Provider,
				SchemaVersion:       is.SchemaVersion,
				RawAttrs:            is.Attributes,
				Deps:                is.Dependencies,
				CreateBeforeDestroy: is.CreateBeforeDestroy,
			}
			if len(is.IndexKey) > 0 {
				var k any
				if err := json.Unmarshal(is.IndexKey, &k); err != nil {
					return nil, err
				}
				switch kv := k.(type) {
				case float64:
					inst.Key = cty.NumberIntVal(int64(kv))
				case string:
					inst.Key = cty.StringVal(kv)
				}
			}
			s.Instances[inst.Addr()] = inst
		}
	}
	return s, nil
}

// decodeAttrs decodes stored attributes against a schema type, tolerating
// missing and unknown top-level attributes (useful when users hand-edit the
// state in the playground to simulate drift).
func decodeAttrs(raw json.RawMessage, ty cty.Type) (cty.Value, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return cty.NullVal(ty), nil
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return cty.NilVal, err
	}
	vals := map[string]cty.Value{}
	for name, at := range ty.AttributeTypes() {
		r, ok := m[name]
		if !ok {
			vals[name] = cty.NullVal(at)
			continue
		}
		v, err := ctyjson.Unmarshal(r, at)
		if err != nil {
			return cty.NilVal, fmt.Errorf("attribute %q: %s", name, err)
		}
		vals[name] = v
	}
	return cty.ObjectVal(vals), nil
}

// JSON renders the state in tfstate v4 format.
func (s *State) JSON() string {
	f := stateFileV4{
		Version:          4,
		TerraformVersion: terraformVersion,
		Serial:           s.Serial,
		Lineage:          s.Lineage,
		Outputs:          map[string]outputStateV4{},
		Resources:        []resourceStateV4{},
		CheckResults:     json.RawMessage("null"),
	}
	for name, o := range s.Outputs {
		v, _ := o.Value.UnmarkDeep()
		ty := v.Type()
		vb, err := ctyjson.Marshal(v, ty)
		if err != nil {
			continue
		}
		tb, _ := ctyjson.MarshalType(ty)
		f.Outputs[name] = outputStateV4{Value: vb, Type: tb, Sensitive: o.Sensitive}
	}

	insts := s.SortedInstances()
	byRes := map[string]*resourceStateV4{}
	var order []string
	for _, inst := range insts {
		ra := inst.Module + "|" + inst.Mode + "|" + inst.ResourceAddr()
		r, ok := byRes[ra]
		if !ok {
			r = &resourceStateV4{Module: inst.Module, Mode: inst.Mode, Type: inst.Type, Name: inst.Name, Provider: inst.Provider}
			byRes[ra] = r
			order = append(order, ra)
		}
		is := instanceStateV4{
			SchemaVersion:       inst.SchemaVersion,
			Attributes:          inst.RawAttrs,
			SensitiveAttributes: json.RawMessage("[]"),
			Dependencies:        inst.Deps,
			CreateBeforeDestroy: inst.CreateBeforeDestroy,
		}
		if inst.Key != cty.NilVal {
			if inst.Key.Type() == cty.String {
				is.IndexKey, _ = json.Marshal(inst.Key.AsString())
				r.Each = "map"
			} else {
				bf := inst.Key.AsBigFloat()
				is.IndexKey = json.RawMessage(bf.Text('f', -1))
				r.Each = "list"
			}
		}
		r.Instances = append(r.Instances, is)
	}
	for _, k := range order {
		f.Resources = append(f.Resources, *byRes[k])
	}
	b, _ := json.MarshalIndent(f, "", "  ")
	return string(b) + "\n"
}

// SortedInstances returns instances ordered like Terraform does in state.
func (s *State) SortedInstances() []*InstanceState {
	out := make([]*InstanceState, 0, len(s.Instances))
	for _, i := range s.Instances {
		out = append(out, i)
	}
	sort.Slice(out, func(a, b int) bool {
		x, y := out[a], out[b]
		if x.Module != y.Module {
			return x.Module < y.Module
		}
		if x.Mode != y.Mode {
			return x.Mode < y.Mode
		}
		if x.Type != y.Type {
			return x.Type < y.Type
		}
		if x.Name != y.Name {
			return x.Name < y.Name
		}
		return keyLess(x.Key, y.Key)
	})
	return out
}

func keyLess(a, b cty.Value) bool {
	if a == cty.NilVal || b == cty.NilVal {
		return a == cty.NilVal && b != cty.NilVal
	}
	if a.Type() == cty.Number && b.Type() == cty.Number {
		return a.LessThan(b).True()
	}
	if a.Type() == cty.String && b.Type() == cty.String {
		return a.AsString() < b.AsString()
	}
	return a.Type() == cty.Number
}

func providerAddrString(source, alias string) string {
	s := fmt.Sprintf("provider[\"registry.terraform.io/%s\"]", source)
	if alias != "" {
		s += "." + alias
	}
	return s
}
