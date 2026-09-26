package engine

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/strvals"
	"sigs.k8s.io/yaml"

	"github.com/salvamiguel/materials/tools/k8splay/helmlite"
)

// HelmRequest renders a chart of the workspace (helm template / install / upgrade).
type HelmRequest struct {
	Files     map[string]string `json:"files"`
	ChartDir  string            `json:"chartDir"`
	Release   string            `json:"release"`
	Namespace string            `json:"namespace"`
	Revision  int               `json:"revision"`
	IsInstall bool              `json:"isInstall"`
	IsUpgrade bool              `json:"isUpgrade"`
	// ValueFiles are workspace paths (-f), applied in order.
	ValueFiles []string `json:"valueFiles"`
	Set        []string `json:"set"`
	SetString  []string `json:"setString"`
	// Base values (e.g. --reuse-values), merged before the value files.
	Values map[string]interface{} `json:"values"`
	Strict bool                   `json:"strict"`
}

// Manifest is one rendered template.
type Manifest struct {
	// Template is the workspace path of the template file.
	Template string `json:"template"`
	// Name as Helm prints it: <chart>/templates/<file>.
	Name string `json:"name"`
	YAML string `json:"yaml"`
}

// ChartInfo is the metadata of the chart.
type ChartInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	AppVersion  string `json:"appVersion"`
	Description string `json:"description"`
	Type        string `json:"type"`
}

// HelmResponse is the rendered chart.
type HelmResponse struct {
	Manifests []Manifest `json:"manifests"`
	Notes     string     `json:"notes"`
	Chart     ChartInfo  `json:"chart"`
	// UserValues are the values given by the user (-f, --set), as `helm get values` shows.
	UserValues map[string]interface{} `json:"userValues"`
	// DefaultValues is the chart's values.yaml.
	DefaultValues string `json:"defaultValues"`
	Error         string `json:"error,omitempty"`
}

func loadChart(files map[string]string, dir string) (*chart.Chart, error) {
	dir = cleanDir(dir)
	prefix := ""
	if dir != "" {
		prefix = dir + "/"
	}
	var bf []*loader.BufferedFile
	for name, content := range files {
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		bf = append(bf, &loader.BufferedFile{Name: strings.TrimPrefix(name, prefix), Data: []byte(content)})
	}
	sort.Slice(bf, func(i, j int) bool { return bf[i].Name < bf[j].Name })
	if len(bf) == 0 {
		return nil, fmt.Errorf("path %q not found", "./"+displayDir(dir))
	}
	hasChart := false
	for _, f := range bf {
		if f.Name == "Chart.yaml" {
			hasChart = true
		}
	}
	if !hasChart {
		return nil, fmt.Errorf("Chart.yaml file is missing")
	}
	c, err := loader.LoadFiles(bf)
	if err != nil {
		return nil, err
	}
	if len(c.Metadata.Dependencies) > 0 {
		have := map[string]bool{}
		for _, d := range c.Dependencies() {
			have[d.Name()] = true
		}
		for _, d := range c.Metadata.Dependencies {
			if !have[d.Name] {
				return nil, fmt.Errorf("found in Chart.yaml, but missing in charts/ directory: %s (el playground no descarga dependencias de repositorios: copia el subchart en %s/charts/)", d.Name, displayDir(dir))
			}
		}
	}
	return c, nil
}

// UserValues merges the value files and --set flags like Helm's values options.
func UserValues(req HelmRequest) (map[string]interface{}, error) {
	base := map[string]interface{}{}
	for k, v := range req.Values {
		base[k] = v
	}
	for _, f := range req.ValueFiles {
		p := strings.TrimPrefix(path.Clean("/"+strings.TrimPrefix(f, "./")), "/")
		data, ok := req.Files[p]
		if !ok {
			return nil, fmt.Errorf("open %s: no such file or directory", f)
		}
		var cur map[string]interface{}
		if err := yaml.Unmarshal([]byte(data), &cur); err != nil {
			return nil, fmt.Errorf("failed to parse %s: %w", f, err)
		}
		base = helmlite.MergeTables(cur, base)
	}
	for _, s := range req.Set {
		if err := strvals.ParseInto(s, base); err != nil {
			return nil, fmt.Errorf("failed parsing --set data: %w", err)
		}
	}
	for _, s := range req.SetString {
		if err := strvals.ParseIntoString(s, base); err != nil {
			return nil, fmt.Errorf("failed parsing --set-string data: %w", err)
		}
	}
	return base, nil
}

// Helm renders a chart.
func Helm(req HelmRequest) HelmResponse {
	c, err := loadChart(req.Files, req.ChartDir)
	if err != nil {
		return HelmResponse{Error: err.Error()}
	}
	out := HelmResponse{Chart: ChartInfo{Name: c.Metadata.Name, Version: c.Metadata.Version, AppVersion: c.Metadata.AppVersion, Description: c.Metadata.Description, Type: c.Metadata.Type}}
	for _, f := range c.Raw {
		if f.Name == "values.yaml" {
			out.DefaultValues = string(f.Data)
		}
	}
	if err := c.Validate(); err != nil {
		out.Error = fmt.Sprintf("validation: chart.metadata.%s", strings.TrimPrefix(err.Error(), "validation: chart.metadata."))
		return out
	}
	if c.Metadata.Type == "library" {
		out.Error = "library charts are not installable"
		return out
	}
	user, err := UserValues(req)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.UserValues = user
	rev := req.Revision
	if rev == 0 {
		rev = 1
	}
	vals, err := helmlite.ToRenderValues(c, user, helmlite.ReleaseOptions{Name: req.Release, Namespace: req.Namespace, Revision: rev, IsInstall: req.IsInstall, IsUpgrade: req.IsUpgrade}, nil)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	e := helmlite.Engine{Strict: req.Strict}
	rendered, err := e.Render(c, vals)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	dir := cleanDir(req.ChartDir)
	keys := make([]string, 0, len(rendered))
	for k := range rendered {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := rendered[k]
		base := path.Base(k)
		// k is "<chart>/templates/x.yaml" (subcharts: "<chart>/charts/<sub>/templates/…").
		rel := strings.SplitN(k, "/", 2)
		ws := k
		if len(rel) == 2 {
			ws = path.Join(dir, rel[1])
		}
		if base == "NOTES.txt" {
			if !strings.Contains(k, "/charts/") {
				out.Notes = v
			}
			continue
		}
		if strings.HasPrefix(base, "_") || strings.TrimSpace(v) == "" {
			continue
		}
		out.Manifests = append(out.Manifests, Manifest{Template: ws, Name: k, YAML: v})
	}
	return out
}
