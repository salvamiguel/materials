// Package engine renders Kubernetes manifests for the playground with the
// real kustomize API and Helm's template engine, over an in-memory copy of
// the workspace files.
package engine

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"sigs.k8s.io/kustomize/api/krusty"
	"sigs.k8s.io/kustomize/api/types"
	"sigs.k8s.io/kustomize/kyaml/filesys"
	"sigs.k8s.io/yaml"
)

// Root of the workspace inside the in-memory file system.
const root = "/workspace"

// Resource is one rendered object and the workspace file it came from.
type Resource struct {
	YAML string `json:"yaml"`
	// Origin is the workspace path of the file that declared it ("" when
	// generated, e.g. by configMapGenerator).
	Origin string `json:"origin,omitempty"`
	// Generator describes what generated it (ConfigMapGenerator…).
	Generator string `json:"generator,omitempty"`
	// ConfiguredIn is the kustomization that configured a generated object.
	ConfiguredIn string `json:"configuredIn,omitempty"`
}

// KustomizeRequest asks to build the kustomization in Dir.
type KustomizeRequest struct {
	Files map[string]string `json:"files"`
	Dir   string            `json:"dir"`
}

// KustomizeResponse is `kustomize build`'s output, split per object.
type KustomizeResponse struct {
	YAML      string     `json:"yaml"`
	Resources []Resource `json:"resources"`
	Error     string     `json:"error,omitempty"`
}

func cleanDir(d string) string {
	d = strings.TrimSpace(d)
	d = strings.TrimPrefix(d, "./")
	d = path.Clean("/" + d)
	return strings.TrimPrefix(d, "/")
}

func writeFs(files map[string]string) (filesys.FileSystem, error) {
	fs := filesys.MakeFsInMemory()
	if err := fs.MkdirAll(root); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		p := path.Join(root, path.Clean("/"+n))
		if err := fs.MkdirAll(path.Dir(p)); err != nil {
			return nil, err
		}
		if err := fs.WriteFile(p, []byte(files[n])); err != nil {
			return nil, err
		}
	}
	return fs, nil
}

var kustomizationNames = []string{"kustomization.yaml", "kustomization.yml", "Kustomization"}

// Kustomize runs `kustomize build <dir>`.
func Kustomize(req KustomizeRequest) KustomizeResponse {
	dir := cleanDir(req.Dir)
	fs, err := writeFs(req.Files)
	if err != nil {
		return KustomizeResponse{Error: err.Error()}
	}
	abs := path.Join(root, dir)
	// Ask kustomize to record where every object comes from, so the
	// playground can open the right file when you click it.
	var kfile string
	for _, n := range kustomizationNames {
		if fs.Exists(path.Join(abs, n)) {
			kfile = path.Join(abs, n)
			break
		}
	}
	if kfile == "" {
		return KustomizeResponse{Error: fmt.Sprintf("unable to find one of 'kustomization.yaml', 'kustomization.yml' or 'Kustomization' in directory '%s'", displayDir(dir))}
	}
	if err := addOriginAnnotations(fs, kfile); err != nil {
		return KustomizeResponse{Error: err.Error()}
	}
	opts := krusty.MakeDefaultOptions()
	// Namespaces first, then config, then workloads: like `kubectl apply -k`.
	opts.Reorder = krusty.ReorderOptionLegacy
	k := krusty.MakeKustomizer(opts)
	m, err := k.Run(fs, abs)
	if err != nil {
		return KustomizeResponse{Error: strings.ReplaceAll(err.Error(), root+"/", "")}
	}
	var out KustomizeResponse
	var all []string
	for _, r := range m.Resources() {
		res := Resource{}
		if o, err := r.GetOrigin(); err == nil && o != nil {
			if o.Path != "" {
				res.Origin = path.Clean(path.Join(dir, o.Path))
			}
			if o.ConfiguredIn != "" {
				res.ConfiguredIn = path.Clean(path.Join(dir, o.ConfiguredIn))
			}
			if o.ConfiguredBy.Kind != "" {
				res.Generator = o.ConfiguredBy.Kind
			}
		}
		annos := r.GetAnnotations()
		delete(annos, "config.kubernetes.io/origin")
		if err := r.SetAnnotations(annos); err != nil {
			return KustomizeResponse{Error: err.Error()}
		}
		y, err := r.AsYAML()
		if err != nil {
			return KustomizeResponse{Error: err.Error()}
		}
		res.YAML = string(y)
		out.Resources = append(out.Resources, res)
		all = append(all, res.YAML)
	}
	out.YAML = strings.Join(all, "---\n")
	return out
}

func displayDir(d string) string {
	if d == "" {
		return "."
	}
	return d
}

// addOriginAnnotations adds `buildMetadata: [originAnnotations]` to the root kustomization.
func addOriginAnnotations(fs filesys.FileSystem, file string) error {
	data, err := fs.ReadFile(file)
	if err != nil {
		return err
	}
	var k map[string]interface{}
	if err := yaml.Unmarshal(data, &k); err != nil {
		return fmt.Errorf("invalid Kustomization: %w", err)
	}
	if k == nil {
		k = map[string]interface{}{}
	}
	var meta []interface{}
	if bm, ok := k["buildMetadata"].([]interface{}); ok {
		meta = bm
	}
	for _, m := range meta {
		if m == types.OriginAnnotations {
			return nil
		}
	}
	k["buildMetadata"] = append(meta, types.OriginAnnotations)
	out, err := yaml.Marshal(k)
	if err != nil {
		return err
	}
	return fs.WriteFile(file, out)
}
