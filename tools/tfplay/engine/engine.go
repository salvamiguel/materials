// Package engine is a small, dependency-light re-implementation of the parts
// of Terraform needed to teach it: it parses real HCL with hashicorp/hcl,
// evaluates expressions with go-cty (so unknown values really are
// "known after apply"), builds the dependency graph, and plans changes
// against schema-driven mock providers. Nothing ever talks to a cloud API.
package engine

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

type Request struct {
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	Files     map[string]string `json:"files"`
	State     string            `json:"state"`
	Vars      map[string]string `json:"vars"`
	Installed []string          `json:"installed"`
	Workspace string            `json:"workspace"`
	Destroy   bool              `json:"destroy"`
}

type Diag struct {
	Severity  string `json:"severity"`
	Summary   string `json:"summary"`
	Detail    string `json:"detail"`
	Filename  string `json:"filename,omitempty"`
	Line      int    `json:"line,omitempty"`
	Column    int    `json:"column,omitempty"`
	EndLine   int    `json:"end_line,omitempty"`
	EndColumn int    `json:"end_column,omitempty"`
}

type ChangeInfo struct {
	Address string `json:"address"`
	Action  string `json:"action"`
	Reason  string `json:"reason,omitempty"`
}

type Summary struct {
	Add     int `json:"add"`
	Change  int `json:"change"`
	Destroy int `json:"destroy"`
	Read    int `json:"read"`
}

type GraphNode struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Action string `json:"action,omitempty"`
}

type GraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type GraphInfo struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

type ProviderInfo struct {
	Name    string `json:"name"`
	Source  string `json:"source"`
	Version string `json:"version,omitempty"`
}

type Response struct {
	Output      string            `json:"output"`
	ExitCode    int               `json:"exit_code"`
	State       *string           `json:"state,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
	Diagnostics []Diag            `json:"diagnostics"`
	Summary     *Summary          `json:"summary,omitempty"`
	Changes     []ChangeInfo      `json:"changes,omitempty"`
	Graph       *GraphInfo        `json:"graph,omitempty"`
	Required    []ProviderInfo    `json:"required,omitempty"`
	Installed   []string          `json:"installed,omitempty"`
}

// Engine keeps the provider schemas loaded so far.
type Engine struct {
	providers map[string]*ProviderSchema
	Now       func() time.Time
}

func New() *Engine {
	e := &Engine{providers: map[string]*ProviderSchema{}, Now: time.Now}
	p, err := ParseProviderSchema([]byte(builtinTerraformProvider))
	if err != nil {
		panic(err)
	}
	e.providers[p.Source] = p
	return e
}

// RegisterProvider loads a provider in the playground format.
func (en *Engine) RegisterProvider(data []byte) (*ProviderInfo, error) {
	p, err := ParseProviderSchema(data)
	if err != nil {
		return nil, err
	}
	en.providers[p.Source] = p
	return &ProviderInfo{Name: p.Name, Source: p.Source, Version: p.Version}, nil
}

func (en *Engine) HasProvider(source string) bool {
	_, ok := en.providers[source]
	return ok
}

// customProviders loads *.provider.json files from the request.
func (en *Engine) customProviders(files map[string]string) (map[string]*ProviderSchema, []string, hcl.Diagnostics) {
	out := map[string]*ProviderSchema{}
	var names []string
	var diags hcl.Diagnostics
	for name, content := range files {
		if !strings.HasSuffix(name, ".provider.json") {
			continue
		}
		p, err := ParseProviderSchema([]byte(content))
		if err != nil {
			diags = append(diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Invalid custom provider definition",
				Detail:   fmt.Sprintf("%s: %s", name, err),
			})
			continue
		}
		out[p.Source] = p
		names = append(names, name)
	}
	sort.Strings(names)
	return out, names, diags
}

func (en *Engine) providerSet(custom map[string]*ProviderSchema) map[string]*ProviderSchema {
	all := map[string]*ProviderSchema{}
	for k, v := range en.providers {
		all[k] = v
	}
	for k, v := range custom {
		all[k] = v
	}
	return all
}

// Run executes one playground command.
func (en *Engine) Run(req Request) (resp Response) {
	defer func() {
		if r := recover(); r != nil {
			resp = Response{
				Output:   fmt.Sprintf("\nError: internal playground error\n\n%v\n\nThis is a bug in the playground engine, not in your configuration.\n", r),
				ExitCode: 1,
			}
		}
	}()
	if req.Files == nil {
		req.Files = map[string]string{}
	}
	if req.Workspace == "" {
		req.Workspace = "default"
	}
	switch req.Command {
	case "init":
		return en.cmdInit(req)
	case "validate":
		return en.cmdValidate(req)
	case "fmt":
		return cmdFmt(req)
	case "plan":
		return en.cmdPlan(req, false)
	case "apply":
		return en.cmdPlan(req, true)
	case "destroy":
		req.Destroy = true
		return en.cmdPlan(req, true)
	case "output":
		return cmdOutput(req)
	case "state_list", "state list":
		return cmdStateList(req)
	case "state_show", "state show", "show":
		return en.cmdShow(req)
	case "graph":
		return en.cmdGraph(req)
	case "console":
		return en.cmdConsole(req)
	case "providers":
		return en.cmdProviders(req)
	}
	return Response{Output: fmt.Sprintf("Terraform has no command named %q.\n", req.Command), ExitCode: 1}
}

// RequiredProviders lists the providers the configuration needs.
func (en *Engine) RequiredProviders(files map[string]string) []ProviderInfo {
	cfg, _ := LoadConfig(files)
	return requiredProviders(cfg.Root)
}

func requiredProviders(root *Module) []ProviderInfo {
	seen := map[string]ProviderInfo{}
	var visit func(m *Module)
	visit = func(m *Module) {
		add := func(name string) {
			if name == "terraform" {
				return
			}
			src := "hashicorp/" + name
			ver := ""
			if rp, ok := m.RequiredProviders[name]; ok {
				src, ver = rp.Source, rp.Version
			}
			if _, ok := seen[src]; !ok || ver != "" {
				seen[src] = ProviderInfo{Name: name, Source: src, Version: ver}
			}
		}
		for name := range m.RequiredProviders {
			add(name)
		}
		for _, pc := range m.ProviderConfigs {
			add(pc.Name)
		}
		for _, r := range m.Resources {
			name := r.providerKey()
			if i := strings.IndexByte(name, '.'); i >= 0 {
				name = name[:i]
			}
			add(name)
		}
		for _, c := range m.Children {
			visit(c)
		}
	}
	if root != nil {
		visit(root)
	}
	out := make([]ProviderInfo, 0, len(seen))
	for _, p := range seen {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Source < out[j].Source })
	return out
}

func (en *Engine) cmdInit(req Request) Response {
	var sb strings.Builder
	cfg, diags := LoadConfig(req.Files)
	custom, customFiles, cdiags := en.customProviders(req.Files)
	diags = append(diags, cdiags...)
	if diags.HasErrors() {
		return diagResponse(cfg, diags, "")
	}
	sb.WriteString("Initializing the backend...\n")
	if b := cfg.Root.Backend; b != "" && b != "local" {
		sb.WriteString(fmt.Sprintf("\nSuccessfully configured the backend %q! Terraform will automatically\nuse this backend unless the backend configuration changes.\n", b))
		sb.WriteString("(Playground: the state is kept in your browser, not in a real " + b + " backend.)\n")
	}
	if len(cfg.Root.ModuleCalls) > 0 {
		sb.WriteString("Initializing modules...\n")
		var list func(prefix string, m *Module)
		list = func(prefix string, m *Module) {
			for _, c := range sortedCalls(m.ModuleCalls) {
				if child := m.Children[c.Name]; child != nil {
					sb.WriteString(fmt.Sprintf("- %s%s in %s\n", prefix, c.Name, child.Dir))
					list(prefix+c.Name+".", child)
				}
			}
		}
		list("", cfg.Root)
	}
	sb.WriteString("Initializing provider plugins...\n")
	all := en.providerSet(custom)
	installed := map[string]bool{}
	for _, s := range req.Installed {
		installed[s] = true
	}
	var failed []ProviderInfo
	var got []string
	var lock strings.Builder
	lock.WriteString("# This file is maintained automatically by \"terraform init\".\n# Manual edits may be lost in future updates.\n")
	for _, rp := range requiredProviders(cfg.Root) {
		p := all[rp.Source]
		if p == nil {
			failed = append(failed, rp)
			continue
		}
		fromFile := ""
		if _, ok := custom[rp.Source]; ok {
			for _, f := range customFiles {
				if pp, err := ParseProviderSchema([]byte(req.Files[f])); err == nil && pp.Source == rp.Source {
					fromFile = f
				}
			}
		}
		if installed[rp.Source] {
			sb.WriteString(fmt.Sprintf("- Reusing previous version of %s from the dependency lock file\n", rp.Source))
			sb.WriteString(fmt.Sprintf("- Using previously-installed %s v%s\n", rp.Source, p.Version))
		} else {
			if rp.Version != "" {
				sb.WriteString(fmt.Sprintf("- Finding %s versions matching %q...\n", rp.Source, rp.Version))
			} else {
				sb.WriteString(fmt.Sprintf("- Finding latest version of %s...\n", rp.Source))
			}
			sb.WriteString(fmt.Sprintf("- Installing %s v%s...\n", rp.Source, p.Version))
			if fromFile != "" {
				sb.WriteString(fmt.Sprintf("- Installed %s v%s (loaded from %s)\n", rp.Source, p.Version, fromFile))
			} else {
				sb.WriteString(fmt.Sprintf("- Installed %s v%s (signed by HashiCorp)\n", rp.Source, p.Version))
			}
		}
		got = append(got, rp.Source)
		constraint := rp.Version
		if constraint == "" {
			constraint = p.Version
		}
		lock.WriteString(fmt.Sprintf("\nprovider %q {\n  version     = %q\n  constraints = %q\n  hashes = [\n    \"h1:%s=\",\n  ]\n}\n",
			registryAddr(rp.Source), p.Version, constraint, newRNG(rp.Source, p.Version).chars(43, alnumChars)))
	}
	if len(failed) > 0 {
		out := sb.String()
		for _, f := range failed {
			out += fmt.Sprintf("- Finding latest version of %s...\n", f.Source)
		}
		var d hcl.Diagnostics
		for _, f := range failed {
			d = append(d, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Failed to query available provider packages",
				Detail: fmt.Sprintf("Could not retrieve the list of available versions for provider %s: provider registry registry.terraform.io does not have a provider named %s\n\n"+
					"The playground can only install hashicorp/aws, hashicorp/random, hashicorp/null and the built-in terraform provider. You can also describe your own provider in a *.provider.json file.",
					f.Source, registryAddr(f.Source)),
			})
		}
		resp := diagResponse(cfg, d, out)
		resp.Required = requiredProviders(cfg.Root)
		return resp
	}
	if len(got) > 0 {
		sb.WriteString("Terraform has created a lock file .terraform.lock.hcl to record the provider\nselections it made above. Include this file in your version control repository\nso that Terraform can guarantee to make the same selections by default when\nyou run \"terraform init\" in the future.\n")
	}
	sb.WriteString("\nTerraform has been successfully initialized!\n\n")
	sb.WriteString("You may now begin working with Terraform. Try running \"terraform plan\" to see\nany changes that are required for your infrastructure. All Terraform commands\nshould now work.\n\n")
	sb.WriteString("If you ever set or change modules or backend configuration for Terraform,\nrerun this command to reinitialize your working directory. If you forget, other\ncommands will detect it and remind you to do so if necessary.\n")
	resp := Response{Output: sb.String(), Installed: got, Required: requiredProviders(cfg.Root), Diagnostics: []Diag{}}
	if len(got) > 0 {
		resp.Files = map[string]string{".terraform.lock.hcl": lock.String()}
	}
	return resp
}

// checkInstalled mimics Terraform's lock file consistency check.
func (en *Engine) checkInstalled(cfg *Config, req Request, all map[string]*ProviderSchema) hcl.Diagnostics {
	installed := map[string]bool{builtinTerraformSource: true}
	for _, s := range req.Installed {
		installed[s] = true
	}
	var missing []string
	for _, rp := range requiredProviders(cfg.Root) {
		if !installed[rp.Source] || all[rp.Source] == nil {
			missing = append(missing, rp.Source)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	var lines []string
	for _, m := range missing {
		lines = append(lines, fmt.Sprintf("  - provider %s: required by this configuration but no version is selected", registryAddr(m)))
	}
	return hcl.Diagnostics{{
		Severity: hcl.DiagError,
		Summary:  "Inconsistent dependency lock file",
		Detail:   "The following dependency selections recorded in the lock file are inconsistent with the current configuration:\n" + strings.Join(lines, "\n") + "\n\nTo make the initial dependency selections that will initialize the dependency lock file, run:\n  terraform init",
	}}
}

// rootInputs reads terraform.tfvars and *.auto.tfvars.
func rootInputs(cfg *Config, files map[string]string) (map[string]cty.Value, hcl.Diagnostics) {
	var names []string
	for name := range files {
		if strings.Contains(name, "/") {
			continue
		}
		if name == "terraform.tfvars" || strings.HasSuffix(name, ".auto.tfvars") {
			names = append(names, name)
		}
	}
	sort.Slice(names, func(i, j int) bool {
		if names[i] == "terraform.tfvars" {
			return true
		}
		if names[j] == "terraform.tfvars" {
			return false
		}
		return names[i] < names[j]
	})
	out := map[string]cty.Value{}
	var diags hcl.Diagnostics
	for _, name := range names {
		f, d := cfg.Parser.ParseHCL([]byte(files[name]), name)
		diags = append(diags, d...)
		if f == nil {
			continue
		}
		attrs, d := f.Body.JustAttributes()
		diags = append(diags, d...)
		for n, a := range attrs {
			v, d := a.Expr.Value(nil)
			diags = append(diags, d...)
			if d.HasErrors() {
				continue
			}
			if _, ok := cfg.Root.Variables[n]; !ok {
				diags = append(diags, &hcl.Diagnostic{
					Severity: hcl.DiagWarning,
					Summary:  "Value for undeclared variable",
					Detail:   fmt.Sprintf("The root module does not declare a variable named %q but a value was found in file %q. If you meant to use this value, add a \"variable\" block to the configuration.", n, name),
					Subject:  a.NameRange.Ptr(),
				})
				continue
			}
			out[n] = v
		}
	}
	return out, diags
}

func (en *Engine) newEvaluator(cfg *Config, req Request, all map[string]*ProviderSchema, prior *State) *evaluator {
	now := time.Now()
	if en.Now != nil {
		now = en.Now()
	}
	return &evaluator{
		cfg: cfg, files: req.Files, providers: all, prior: prior, now: now,
		workspace: req.Workspace, varFlags: req.Vars,
		changeByAddr: map[string]*Change{}, visited: map[string]bool{},
		prevAddr: map[string]string{}, rootOutputs: map[string]cty.Value{}, rootOutSens: map[string]bool{},
	}
}

// prepare loads configuration, providers, variables and state shared by
// most commands.
func (en *Engine) prepare(req Request) (*Config, map[string]*ProviderSchema, *State, map[string]cty.Value, hcl.Diagnostics) {
	cfg, diags := LoadConfig(req.Files)
	custom, _, cdiags := en.customProviders(req.Files)
	diags = append(diags, cdiags...)
	all := en.providerSet(custom)
	if diags.HasErrors() {
		return cfg, all, nil, nil, diags
	}
	diags = append(diags, en.checkInstalled(cfg, req, all)...)
	if diags.HasErrors() {
		return cfg, all, nil, nil, diags
	}
	inputs, d := rootInputs(cfg, req.Files)
	diags = append(diags, d...)
	for name := range req.Vars {
		if _, ok := cfg.Root.Variables[name]; !ok {
			diags = append(diags, &hcl.Diagnostic{
				Severity: hcl.DiagError,
				Summary:  "Value for undeclared variable",
				Detail:   fmt.Sprintf("A variable named %q was assigned on the command line, but the root module does not declare a variable of that name. To use this value, add a \"variable\" block to the configuration.", name),
			})
		}
	}
	state, err := ParseState(req.State)
	if err != nil {
		diags = append(diags, &hcl.Diagnostic{Severity: hcl.DiagError, Summary: "Failed to load state", Detail: err.Error()})
	}
	return cfg, all, state, inputs, diags
}

func (en *Engine) cmdValidate(req Request) Response {
	cfg, all, _, _, diags := en.prepare(req)
	if !diags.HasErrors() {
		ev := en.newEvaluator(cfg, req, all, NewState())
		ev.validating = true
		root := newModInstance(ev, cfg.Root, "", unknownInputs(cfg.Root), nil)
		ev.walkModule(root)
		diags = append(diags, ev.diags...)
	}
	if diags.HasErrors() {
		return diagResponse(cfg, diags, "")
	}
	out := formatDiags(cfg, diags)
	if len(diags) > 0 {
		out += "\n"
	}
	out += "Success! The configuration is valid."
	if len(diags) > 0 {
		out += ", but there were some validation warnings as shown above."
	}
	return Response{Output: out + "\n", Diagnostics: toDiags(diags)}
}

func unknownInputs(m *Module) map[string]cty.Value {
	out := map[string]cty.Value{}
	for name, v := range m.Variables {
		out[name] = cty.UnknownVal(v.Type)
	}
	return out
}

func cmdFmt(req Request) Response {
	var changed []string
	files := map[string]string{}
	var diags hcl.Diagnostics
	names := make([]string, 0, len(req.Files))
	for n := range req.Files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		if !(strings.HasSuffix(name, ".tf") || strings.HasSuffix(name, ".tfvars") || strings.HasSuffix(name, ".tftest.hcl")) {
			continue
		}
		src := req.Files[name]
		_, d := hclsyntax.ParseConfig([]byte(src), name, hcl.InitialPos)
		if d.HasErrors() {
			diags = append(diags, d...)
			continue
		}
		out := string(hclwrite.Format([]byte(src)))
		if out != src {
			changed = append(changed, name)
			files[name] = out
		}
	}
	if diags.HasErrors() {
		return diagResponse(nil, diags, "")
	}
	resp := Response{Files: files, Diagnostics: []Diag{}}
	if len(changed) > 0 {
		resp.Output = strings.Join(changed, "\n") + "\n"
	}
	return resp
}

// cmdPlan implements plan, apply and destroy.
func (en *Engine) cmdPlan(req Request, apply bool) Response {
	cfg, all, prior, inputs, diags := en.prepare(req)
	if diags.HasErrors() {
		return diagResponse(cfg, diags, "")
	}
	pl := en.newEvaluator(cfg, req, all, prior)
	pl.destroy = req.Destroy
	pl.rootInputs = inputs
	pl.run()
	diags = append(diags, pl.diags...)
	if diags.HasErrors() {
		return diagResponse(cfg, diags, logText(pl.log))
	}
	var sb strings.Builder
	sb.WriteString(logText(pl.log))
	if len(pl.log) == 0 {
		sb.WriteString("\n")
	}
	if req.Destroy && len(visibleChanges(pl.changes)) == 0 && len(pl.outputChanges) == 0 {
		sb.WriteString("No changes. No objects need to be destroyed.\n\nEither you have not created any objects yet or the existing objects were\nalready deleted outside of Terraform.\n")
	} else {
		sb.WriteString(RenderPlan(pl.changes, pl.outputChanges, req.Destroy))
	}
	if w := formatDiags(cfg, diags); w != "" {
		sb.WriteString("\n" + w)
	}
	sum := summarize(pl.changes)
	resp := Response{
		Diagnostics: toDiags(diags),
		Summary:     &Summary{Add: sum.Add, Change: sum.Change, Destroy: sum.Destroy, Read: sum.Read},
		Changes:     changeInfos(pl.changes),
	}
	if !apply {
		sb.WriteString("\n─────────────────────────────────────────────────────────────────────────────\n\n")
		sb.WriteString("Note: You didn't use the -out option to save this plan, so Terraform can't\nguarantee to take exactly these actions if you run \"terraform apply\" now.\n")
		resp.Output = sb.String()
		return resp
	}

	hasChanges := len(visibleChanges(pl.changes)) > 0 || len(pl.outputChanges) > 0
	if hasChanges {
		sb.WriteString("\nDo you want to perform these actions?\n")
		if req.Destroy {
			sb.WriteString("  Terraform will destroy all your managed infrastructure, as shown above.\n  There is no undo. Only 'yes' will be accepted to confirm.\n\n")
		} else {
			sb.WriteString("  Terraform will perform the actions described above.\n  Only 'yes' will be accepted to approve.\n\n")
		}
		sb.WriteString("  Enter a value: yes\n\n")
	}

	ap := en.newEvaluator(cfg, req, all, prior)
	ap.destroy = req.Destroy
	ap.applying = true
	ap.rootInputs = inputs
	ap.next = &State{Lineage: prior.Lineage, Serial: prior.Serial, Outputs: map[string]*OutputState{}, Instances: map[string]*InstanceState{}}
	ap.run()
	if ap.diags.HasErrors() {
		diags = append(diags, ap.diags...)
		return diagResponse(cfg, diags, sb.String()+logText(ap.log))
	}
	if hasChanges {
		ap.next.Serial = prior.Serial + 1
	}
	for _, l := range ap.log {
		sb.WriteString(l + "\n")
	}
	if len(ap.log) > 0 {
		sb.WriteString("\n")
	}
	asum := summarize(ap.changes)
	if req.Destroy {
		sb.WriteString(fmt.Sprintf("Destroy complete! Resources: %d destroyed.\n", asum.Destroy))
	} else {
		sb.WriteString(fmt.Sprintf("Apply complete! Resources: %d added, %d changed, %d destroyed.\n", asum.Add, asum.Change, asum.Destroy))
		if len(ap.next.Outputs) > 0 {
			sb.WriteString("\nOutputs:\n\n")
			sb.WriteString(formatOutputs(ap.next.Outputs))
		}
	}
	st := ap.next.JSON()
	resp.State = &st
	resp.Output = sb.String()
	resp.Summary = &Summary{Add: asum.Add, Change: asum.Change, Destroy: asum.Destroy, Read: asum.Read}
	resp.Changes = changeInfos(ap.changes)
	return resp
}

func logText(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n\n"
}

func changeInfos(changes []*Change) []ChangeInfo {
	var out []ChangeInfo
	for _, c := range visibleChanges(changes) {
		out = append(out, ChangeInfo{Address: c.Addr, Action: string(c.Action), Reason: c.Reason})
	}
	return out
}

func formatOutputs(outs map[string]*OutputState) string {
	names := make([]string, 0, len(outs))
	for n := range outs {
		names = append(names, n)
	}
	sort.Strings(names)
	var sb strings.Builder
	for _, n := range names {
		o := outs[n]
		if o.Sensitive {
			sb.WriteString(fmt.Sprintf("%s = <sensitive>\n", n))
			continue
		}
		sb.WriteString(fmt.Sprintf("%s = %s\n", n, FormatValue(o.Value, 0)))
	}
	return sb.String()
}

func cmdOutput(req Request) Response {
	st, err := ParseState(req.State)
	if err != nil {
		return Response{Output: "Error: " + err.Error() + "\n", ExitCode: 1}
	}
	if len(req.Args) > 0 {
		o, ok := st.Outputs[req.Args[0]]
		if !ok {
			return Response{Output: fmt.Sprintf("╷\n│ Error: Output %q not found\n│\n│ The output variable requested could not be found in the state file. If you\n│ recently added this to your configuration, be sure to run `terraform\n│ apply`, since the state won't be updated with new output variables until\n│ that command is run.\n╵\n", req.Args[0]), ExitCode: 1}
		}
		v, _ := o.Value.UnmarkDeep()
		return Response{Output: FormatValue(v, 0) + "\n"}
	}
	if len(st.Outputs) == 0 {
		return Response{Output: "╷\n│ Warning: No outputs found\n│\n│ The state file either has no outputs defined, or all the defined outputs\n│ are empty. Please define an output in your configuration with the `output`\n│ keyword and run `terraform refresh` for it to become available. If you are\n│ using interpolation, please verify the interpolated value is not empty. You\n│ can use the `terraform show` command to view the state.\n╵\n"}
	}
	return Response{Output: formatOutputs(st.Outputs)}
}

func cmdStateList(req Request) Response {
	st, err := ParseState(req.State)
	if err != nil {
		return Response{Output: "Error: " + err.Error() + "\n", ExitCode: 1}
	}
	var sb strings.Builder
	for _, i := range st.SortedInstances() {
		if len(req.Args) > 0 && !strings.HasPrefix(i.Addr(), req.Args[0]) {
			continue
		}
		sb.WriteString(i.Addr() + "\n")
	}
	if sb.Len() == 0 && len(st.Instances) == 0 {
		return Response{Output: "No state file was found!\n\nState management commands require a state file. Run this command\nin a directory where Terraform has been run or use the -state flag\nto point the command to a specific state location.\n", ExitCode: 1}
	}
	return Response{Output: sb.String()}
}

// cmdShow implements `terraform show` and `terraform state show ADDR`.
func (en *Engine) cmdShow(req Request) Response {
	st, err := ParseState(req.State)
	if err != nil {
		return Response{Output: "Error: " + err.Error() + "\n", ExitCode: 1}
	}
	custom, _, _ := en.customProviders(req.Files)
	all := en.providerSet(custom)
	var sb strings.Builder
	var want string
	if len(req.Args) > 0 {
		want = req.Args[0]
	}
	if len(st.Instances) == 0 && want == "" {
		return Response{Output: "The state file is empty. No resources are represented.\n"}
	}
	found := false
	for _, inst := range st.SortedInstances() {
		if want != "" && inst.Addr() != want {
			continue
		}
		found = true
		schema := schemaForInstance(all, inst)
		if schema == nil {
			sb.WriteString(fmt.Sprintf("# %s: (provider schema not loaded; run terraform init)\n\n", inst.Addr()))
			continue
		}
		v, err := decodeAttrs(inst.RawAttrs, schema.ImpliedType())
		if err != nil {
			continue
		}
		kind := "resource"
		if inst.Mode == "data" {
			kind = "data"
		}
		r := &renderer{}
		for name, a := range schema.Attributes {
			if a.Sensitive {
				r.sens = append(r.sens, cty.GetAttrPath(name))
			}
		}
		r.add(fmt.Sprintf("# %s:", inst.Addr()))
		r.add(fmt.Sprintf("%s %q %q {", kind, inst.Type, inst.Name))
		r.showBody(schema, v, 0)
		r.add("}")
		sb.WriteString(strings.Join(r.lines, "\n") + "\n")
		if want == "" {
			sb.WriteString("\n")
		}
	}
	if want != "" && !found {
		return Response{Output: fmt.Sprintf("╷\n│ Error: No instance found for the given address!\n│\n│ This command requires that the address references one specific instance.\n│ To view the available instances, use \"terraform state list\". Please modify\n│ the address to reference a specific instance.\n╵\n"), ExitCode: 1}
	}
	if want == "" && len(st.Outputs) > 0 {
		sb.WriteString("\nOutputs:\n\n")
		sb.WriteString(formatOutputs(st.Outputs))
	}
	return Response{Output: sb.String()}
}

// showBody renders a stored object without action symbols.
func (r *renderer) showBody(b *Block, v cty.Value, indent int) {
	pad := 0
	for _, n := range b.sortedAttributeNames() {
		if av := v.GetAttr(n); !av.IsNull() && len(n) > pad {
			pad = len(n)
		}
	}
	wrote := false
	for _, n := range b.sortedAttributeNames() {
		av := v.GetAttr(n)
		if av.IsNull() {
			continue
		}
		p := cty.GetAttrPath(n)
		val := r.one(av, indent+4, " ", p)
		if b.Attributes[n].Sensitive {
			val = "(sensitive value)"
		}
		r.add(prefix(indent, " ") + fmt.Sprintf("%-*s = ", pad, n) + val)
		wrote = true
	}
	for _, n := range b.sortedBlockNames() {
		nb := b.Blocks[n]
		for _, ev := range sliceOrSingle(nb, v.GetAttr(n)) {
			if wrote {
				r.add("")
			}
			r.add(prefix(indent, " ") + n + " {")
			r.showBody(&nb.Block, ev, indent+4)
			r.add(spaces(indent+4) + "}")
			wrote = true
		}
	}
}

func parseProviderAddr(s string) (source, alias string) {
	// provider["registry.terraform.io/hashicorp/aws"].west
	s = strings.TrimPrefix(s, "provider[")
	end := strings.Index(s, "]")
	if end < 0 {
		return "", ""
	}
	source = strings.Trim(s[:end], "\"")
	source = strings.TrimPrefix(source, "registry.terraform.io/")
	rest := s[end+1:]
	if strings.HasPrefix(rest, ".") {
		alias = rest[1:]
	}
	return source, alias
}

func schemaForInstance(all map[string]*ProviderSchema, inst *InstanceState) *Block {
	src, _ := parseProviderAddr(inst.Provider)
	p := all[src]
	if p == nil {
		return nil
	}
	var b *Block
	if inst.Mode == "data" {
		b, _ = p.DataSource(inst.Type)
	} else {
		b, _ = p.Resource(inst.Type)
	}
	return b
}

func (en *Engine) cmdGraph(req Request) Response {
	cfg, diags := LoadConfig(req.Files)
	if diags.HasErrors() {
		return diagResponse(cfg, diags, "")
	}
	g, gdiags := cfg.Root.buildGraph()
	info := &GraphInfo{}
	for _, id := range g.Order {
		info.Nodes = append(info.Nodes, GraphNode{ID: id, Kind: g.Nodes[id].Kind})
	}
	for _, id := range g.Order {
		deps := make([]string, 0, len(g.Nodes[id].Deps))
		for d := range g.Nodes[id].Deps {
			deps = append(deps, d)
		}
		sort.Strings(deps)
		for _, d := range deps {
			if _, ok := g.Nodes[d]; ok {
				info.Edges = append(info.Edges, GraphEdge{From: id, To: d})
			}
		}
	}
	// DOT output like `terraform graph` (resources only, transitive through
	// variables and locals).
	var sb strings.Builder
	sb.WriteString("digraph G {\n  rankdir = \"RL\";\n  node [shape = rect, fontname = \"sans-serif\"];\n")
	isRes := func(k string) bool { return k == "resource" || k == "data" || k == "module" }
	for _, id := range g.Order {
		if isRes(g.Nodes[id].Kind) {
			sb.WriteString(fmt.Sprintf("  %q [label=%q];\n", id, id))
		}
	}
	for _, id := range g.Order {
		if !isRes(g.Nodes[id].Kind) {
			continue
		}
		seen := map[string]bool{}
		var targets []string
		var walk func(n string)
		walk = func(n string) {
			for d := range g.Nodes[n].Deps {
				if seen[d] || g.Nodes[d] == nil {
					continue
				}
				seen[d] = true
				if isRes(g.Nodes[d].Kind) {
					targets = append(targets, d)
				} else {
					walk(d)
				}
			}
		}
		walk(id)
		sort.Strings(targets)
		for _, t := range targets {
			sb.WriteString(fmt.Sprintf("  %q -> %q;\n", id, t))
		}
	}
	sb.WriteString("}\n")
	resp := Response{Output: sb.String(), Graph: info, Diagnostics: toDiags(gdiags)}
	if gdiags.HasErrors() {
		resp.Output = formatDiags(cfg, gdiags)
		resp.ExitCode = 1
	}
	return resp
}

func (en *Engine) cmdConsole(req Request) Response {
	if len(req.Args) == 0 {
		return Response{Output: ""}
	}
	cfg, all, prior, inputs, diags := en.prepare(req)
	if diags.HasErrors() {
		return diagResponse(cfg, diags, "")
	}
	ev := en.newEvaluator(cfg, req, all, prior)
	ev.rootInputs = inputs
	root := ev.walkRoot()
	src := req.Args[0]
	expr, d := hclsyntax.ParseExpression([]byte(src), "<console-input>", hcl.InitialPos)
	if d.HasErrors() {
		return Response{Output: formatDiagsWithSource(d, map[string]string{"<console-input>": src}), ExitCode: 1, Diagnostics: toDiags(d)}
	}
	v, d := expr.Value(root.ctx(nil))
	if d.HasErrors() {
		return Response{Output: formatDiagsWithSource(d, map[string]string{"<console-input>": src}), ExitCode: 1, Diagnostics: toDiags(d)}
	}
	return Response{Output: FormatValue(v, 0) + "\n"}
}

func (en *Engine) cmdProviders(req Request) Response {
	cfg, diags := LoadConfig(req.Files)
	if diags.HasErrors() {
		return diagResponse(cfg, diags, "")
	}
	var sb strings.Builder
	sb.WriteString("\nProviders required by configuration:\n.\n")
	var tree func(m *Module, indent string)
	tree = func(m *Module, indent string) {
		provs := requiredProviders(&Module{RequiredProviders: m.RequiredProviders, ProviderConfigs: m.ProviderConfigs, Resources: m.Resources})
		calls := sortedCalls(m.ModuleCalls)
		total := len(provs) + len(calls)
		i := 0
		for _, p := range provs {
			i++
			branch := "├── "
			if i == total {
				branch = "└── "
			}
			ver := ""
			if p.Version != "" {
				ver = " " + p.Version
			}
			sb.WriteString(indent + branch + "provider[" + registryAddr(p.Source) + "]" + ver + "\n")
		}
		for _, c := range calls {
			i++
			branch, next := "├── ", "│   "
			if i == total {
				branch, next = "└── ", "    "
			}
			sb.WriteString(indent + branch + "module." + c.Name + "\n")
			if child := m.Children[c.Name]; child != nil {
				tree(child, indent+next)
			}
		}
	}
	tree(cfg.Root, "")
	return Response{Output: sb.String()}
}

// --- evaluator entry points ---

func (e *evaluator) walkRoot() *modInstance {
	e.applyMoved()
	root := newModInstance(e, e.cfg.Root, "", e.rootInputs, nil)
	e.walkModule(root)
	return root
}

func (e *evaluator) run() {
	if e.destroy {
		e.runDestroy()
		return
	}
	e.walkRoot()
	if e.diags.HasErrors() {
		return
	}
	e.planOrphans()
	e.planOutputs()
}

func (e *evaluator) applyMoved() {
	var visit func(m *Module, prefix string)
	visit = func(m *Module, prefix string) {
		for _, mv := range m.Moved {
			from, to := prefix+mv.From, prefix+mv.To
			var moved bool
			for addr, inst := range e.prior.Instances {
				var newAddr string
				switch {
				case addr == from:
					newAddr = to
				case strings.HasPrefix(addr, from+"[") || strings.HasPrefix(addr, from+"."):
					newAddr = to + strings.TrimPrefix(addr, from)
				default:
					continue
				}
				if _, exists := e.prior.Instances[newAddr]; exists {
					e.diags = append(e.diags, &hcl.Diagnostic{
						Severity: hcl.DiagWarning,
						Summary:  "Unresolved resource instance address changes",
						Detail:   fmt.Sprintf("Terraform tried to adjust resource instance addresses in the prior state based on change information recorded in the configuration, but some adjustments did not succeed: cannot move %s to %s: the target already exists.", addr, newAddr),
						Subject:  mv.DeclRange.Ptr(),
					})
					continue
				}
				nst, err := reparseInstance(inst, newAddr)
				if err != nil {
					continue
				}
				delete(e.prior.Instances, addr)
				e.prior.Instances[newAddr] = nst
				e.prevAddr[newAddr] = addr
				moved = true
			}
			_ = moved
		}
		for name, child := range m.Children {
			visit(child, prefix+"module."+name+".")
		}
	}
	visit(e.cfg.Root, "")
}

// reparseInstance clones inst with fields derived from a new address.
func reparseInstance(inst *InstanceState, addr string) (*InstanceState, error) {
	t, diags := hclsyntax.ParseTraversalAbs([]byte(addr), "", hcl.InitialPos)
	if diags.HasErrors() {
		return nil, diags
	}
	n := *inst
	n.Module = ""
	n.Key = cty.NilVal
	i := 0
	var mods []string
	for i+1 < len(t) {
		name := ""
		switch s := t[i].(type) {
		case hcl.TraverseRoot:
			name = s.Name
		case hcl.TraverseAttr:
			name = s.Name
		}
		if name != "module" {
			break
		}
		mod := "module." + t[i+1].(hcl.TraverseAttr).Name
		i += 2
		if i < len(t) {
			if idx, ok := t[i].(hcl.TraverseIndex); ok {
				mod += indexString(idx.Key)
				i++
			}
		}
		mods = append(mods, mod)
	}
	n.Module = strings.Join(mods, ".")
	stepName := func(s hcl.Traverser) string {
		switch st := s.(type) {
		case hcl.TraverseRoot:
			return st.Name
		case hcl.TraverseAttr:
			return st.Name
		}
		return ""
	}
	rest := t[i:]
	if len(rest) >= 1 && stepName(rest[0]) == "data" {
		n.Mode = "data"
		rest = rest[1:]
	}
	if len(rest) < 2 {
		return nil, fmt.Errorf("invalid address %s", addr)
	}
	n.Type, n.Name = stepName(rest[0]), stepName(rest[1])
	if len(rest) > 2 {
		if idx, ok := rest[2].(hcl.TraverseIndex); ok {
			n.Key = idx.Key
		}
	}
	return &n, nil
}

// findResource returns the configuration for a state instance, if any, and
// a reason explaining why it is an orphan.
func (e *evaluator) findResource(inst *InstanceState) (*Resource, string) {
	m := e.cfg.Root
	modAddr := ""
	if inst.Module != "" {
		t, diags := hclsyntax.ParseTraversalAbs([]byte(inst.Module), "", hcl.InitialPos)
		if diags.HasErrors() {
			return nil, ""
		}
		for i := 0; i < len(t); i++ {
			a, ok := t[i].(hcl.TraverseAttr)
			if !ok || a.Name == "module" {
				continue
			}
			modAddr += "module." + a.Name
			call := m.ModuleCalls[a.Name]
			child := m.Children[a.Name]
			if call == nil || child == nil {
				return nil, "because " + modAddr + " is not in configuration"
			}
			if i+1 < len(t) {
				if idx, ok := t[i+1].(hcl.TraverseIndex); ok {
					modAddr += indexString(idx.Key)
					i++
				}
			}
			modAddr += "."
			m = child
		}
	}
	key := inst.Type + "." + inst.Name
	if inst.Mode == "data" {
		key = "data." + key
	}
	r := m.Resources[key]
	if r == nil {
		return nil, "because " + inst.ResourceAddr() + " is not in configuration"
	}
	if inst.Key != cty.NilVal {
		if inst.Key.Type() == cty.Number {
			if r.Count == nil {
				return r, "because resource does not use count"
			}
			return r, "because index " + indexString(inst.Key) + " is out of range for count"
		}
		if r.ForEach == nil {
			return r, "because resource does not use for_each"
		}
		return r, "because key " + indexString(inst.Key) + " is not in for_each map"
	}
	if r.Count != nil {
		return r, "because resource uses count"
	}
	if r.ForEach != nil {
		return r, "because resource uses for_each"
	}
	return r, ""
}

func (e *evaluator) planOrphans() {
	var deletes []*Change
	for _, inst := range e.prior.SortedInstances() {
		addr := inst.Addr()
		if e.visited[addr] {
			continue
		}
		if inst.Mode == "data" {
			continue
		}
		c := e.deleteChange(inst)
		if c == nil {
			continue
		}
		r, reason := e.findResource(inst)
		c.Reason = reason
		if r != nil && r.PreventDestroy {
			e.diags = append(e.diags, preventDestroyDiag(addr, r.DeclRange))
			continue
		}
		deletes = append(deletes, c)
	}
	deletes = orderDeletes(deletes)
	var log []string
	for _, c := range deletes {
		e.recordChange(c)
		if e.applying {
			saved := e.log
			e.log = nil
			e.logApply(c, cty.NilVal)
			log = append(log, e.log...)
			e.log = saved
		}
	}
	if e.applying {
		e.log = append(log, e.log...)
	}
}

func (e *evaluator) deleteChange(inst *InstanceState) *Change {
	schema := schemaForInstance(e.providers, inst)
	if schema == nil {
		src, _ := parseProviderAddr(inst.Provider)
		e.diags = append(e.diags, &hcl.Diagnostic{
			Severity: hcl.DiagError,
			Summary:  "Provider configuration not present",
			Detail:   fmt.Sprintf("To work with %s its original provider configuration at %s is required, but it has been removed. Add the provider back (and run terraform init) before destroying this object.", inst.Addr(), registryAddr(src)),
		})
		return nil
	}
	before, err := decodeAttrs(inst.RawAttrs, schema.ImpliedType())
	if err != nil {
		return nil
	}
	if !e.applying && !e.destroy {
		e.log = append(e.log, fmt.Sprintf("%s: Refreshing state... [id=%s]", inst.Addr(), idOf(before)))
	}
	src, _ := parseProviderAddr(inst.Provider)
	return &Change{
		Addr: inst.Addr(), Module: inst.Module, Mode: inst.Mode, Type: inst.Type, Name: inst.Name, Key: inst.Key,
		Action: ActDelete, Before: before, After: cty.NullVal(schema.ImpliedType()), Schema: schema,
		ProviderAddr: inst.Provider, ProviderSource: src, Deps: inst.Deps,
	}
}

// orderDeletes orders deletions so dependents are destroyed first.
func orderDeletes(cs []*Change) []*Change {
	byAddr := map[string]*Change{}
	for _, c := range cs {
		byAddr[c.Addr] = c
	}
	var out []*Change
	done := map[string]bool{}
	var visit func(c *Change)
	visit = func(c *Change) {
		if done[c.Addr] {
			return
		}
		done[c.Addr] = true
		// anything that depends on c must go first
		for _, o := range cs {
			for _, d := range o.Deps {
				if d == c.Addr || strings.HasPrefix(c.Addr, d+"[") {
					visit(o)
				}
			}
		}
		out = append(out, c)
	}
	for _, c := range cs {
		visit(c)
	}
	return out
}

func (e *evaluator) runDestroy() {
	var deletes []*Change
	for _, inst := range e.prior.SortedInstances() {
		if inst.Mode == "data" {
			continue
		}
		c := e.deleteChange(inst)
		if c == nil {
			continue
		}
		if !e.applying {
			e.log = append(e.log, fmt.Sprintf("%s: Refreshing state... [id=%s]", inst.Addr(), idOf(c.Before)))
		}
		if r, _ := e.findResource(inst); r != nil && r.PreventDestroy {
			e.diags = append(e.diags, preventDestroyDiag(inst.Addr(), r.DeclRange))
			continue
		}
		deletes = append(deletes, c)
	}
	for _, c := range orderDeletes(deletes) {
		e.recordChange(c)
		if e.applying {
			e.logApply(c, cty.NilVal)
		}
	}
	names := make([]string, 0, len(e.prior.Outputs))
	for n := range e.prior.Outputs {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		o := e.prior.Outputs[n]
		e.outputChanges = append(e.outputChanges, &OutputChange{Name: n, Action: ActDelete, Before: o.Value, After: cty.NullVal(o.Value.Type()), Sensitive: o.Sensitive})
	}
}

func (e *evaluator) planOutputs() {
	names := map[string]bool{}
	for n := range e.rootOutputs {
		names[n] = true
	}
	for n := range e.prior.Outputs {
		names[n] = true
	}
	for _, n := range sortedKeys(names) {
		after, has := e.rootOutputs[n]
		prior, hadPrior := e.prior.Outputs[n]
		sens := e.rootOutSens[n]
		oc := &OutputChange{Name: n, Sensitive: sens}
		switch {
		case !has:
			oc.Action, oc.Before, oc.After = ActDelete, prior.Value, cty.NullVal(prior.Value.Type())
			oc.Sensitive = prior.Sensitive
		case !hadPrior:
			a, _ := after.UnmarkDeep()
			oc.Action, oc.Before, oc.After = ActCreate, cty.NullVal(a.Type()), a
		default:
			a, _ := after.UnmarkDeep()
			oc.Before, oc.After = prior.Value, a
			if valuesEqual(prior.Value, a) && prior.Sensitive == sens {
				oc.Action = ActNoOp
			} else {
				oc.Action = ActUpdate
			}
		}
		e.outputChanges = append(e.outputChanges, oc)
		if e.applying && has {
			a, _ := after.UnmarkDeep()
			if a.IsWhollyKnown() {
				e.next.Outputs[n] = &OutputState{Value: a, Sensitive: sens}
			}
		}
	}
}

// --- diagnostics ---

func toDiags(diags hcl.Diagnostics) []Diag {
	out := []Diag{}
	for _, d := range dedupe(diags) {
		sev := "error"
		if d.Severity == hcl.DiagWarning {
			sev = "warning"
		}
		dd := Diag{Severity: sev, Summary: d.Summary, Detail: d.Detail}
		if d.Subject != nil {
			dd.Filename = d.Subject.Filename
			dd.Line, dd.Column = d.Subject.Start.Line, d.Subject.Start.Column
			dd.EndLine, dd.EndColumn = d.Subject.End.Line, d.Subject.End.Column
		}
		out = append(out, dd)
	}
	return out
}

func dedupe(diags hcl.Diagnostics) hcl.Diagnostics {
	seen := map[string]bool{}
	var out hcl.Diagnostics
	for _, d := range diags {
		k := d.Summary + "|" + d.Detail
		if d.Subject != nil {
			k += "|" + d.Subject.String()
		}
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, d)
	}
	return out
}

func diagResponse(cfg *Config, diags hcl.Diagnostics, prefixText string) Response {
	return Response{
		Output:      prefixText + formatDiags(cfg, diags),
		ExitCode:    1,
		Diagnostics: toDiags(diags),
	}
}

func formatDiags(cfg *Config, diags hcl.Diagnostics) string {
	var files map[string]string
	if cfg != nil {
		files = cfg.Files
	}
	return formatDiagsWithSource(diags, files)
}

// formatDiagsWithSource renders diagnostics in Terraform's boxed style.
func formatDiagsWithSource(diags hcl.Diagnostics, files map[string]string) string {
	var sb strings.Builder
	parser := map[string]*hcl.File{}
	for _, d := range dedupe(diags) {
		var lines []string
		sev := "Error"
		if d.Severity == hcl.DiagWarning {
			sev = "Warning"
		}
		lines = append(lines, fmt.Sprintf("%s: %s", sev, d.Summary))
		if d.Subject != nil {
			lines = append(lines, "")
			src, ok := files[d.Subject.Filename]
			ctxStr := ""
			if ok {
				f := parser[d.Subject.Filename]
				if f == nil {
					f, _ = hclsyntax.ParseConfig([]byte(src), d.Subject.Filename, hcl.InitialPos)
					parser[d.Subject.Filename] = f
				}
				if f != nil {
					if nav, ok := f.Nav.(interface{ ContextString(int) string }); ok {
						ctxStr = nav.ContextString(d.Subject.Start.Byte)
					}
				}
			}
			loc := fmt.Sprintf("  on %s line %d", d.Subject.Filename, d.Subject.Start.Line)
			if ctxStr != "" {
				loc += ", in " + ctxStr
			}
			lines = append(lines, loc+":")
			if ok {
				srcLines := strings.Split(src, "\n")
				for ln := d.Subject.Start.Line; ln <= d.Subject.End.Line && ln <= len(srcLines); ln++ {
					if ln < 1 {
						continue
					}
					lines = append(lines, fmt.Sprintf("  %2d: %s", ln, srcLines[ln-1]))
					if ln-d.Subject.Start.Line >= 4 {
						break
					}
				}
			}
		}
		if d.Detail != "" {
			lines = append(lines, "")
			lines = append(lines, strings.Split(d.Detail, "\n")...)
		}
		sb.WriteString("╷\n")
		for _, l := range lines {
			if l == "" {
				sb.WriteString("│\n")
			} else {
				sb.WriteString("│ " + l + "\n")
			}
		}
		sb.WriteString("╵\n")
	}
	return sb.String()
}

// Formatting helpers exposed for the WASM bridge.
func Format(src, filename string) (string, error) {
	_, d := hclsyntax.ParseConfig([]byte(src), filename, hcl.InitialPos)
	if d.HasErrors() {
		return "", d
	}
	return string(hclwrite.Format([]byte(src))), nil
}
