package engine

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path"
	"sort"
	"strings"
)

// Files managed by hashicorp/local's local_file and local_sensitive_file.
// The playground's "disk" is the set of workspace files: apply writes the
// file there (the editor shows it as one more tab) and destroy removes it.
// Like the real provider, refresh treats a missing or edited file as an
// object deleted outside Terraform, so the next plan creates it again.

func isLocalFile(inst *InstanceState) bool {
	return inst.Mode == "managed" && (inst.Type == "local_file" || inst.Type == "local_sensitive_file")
}

// workspaceFile maps a path argument ("./hola.txt", "${path.module}/x",
// abspath(...)) to a workspace file name. ok is false outside the workspace.
func workspaceFile(name string) (string, bool) {
	p := strings.TrimPrefix(name, "/playground/")
	if p == "" || path.IsAbs(p) {
		return "", false
	}
	p = path.Clean(p)
	if p == "." || p == ".." || strings.HasPrefix(p, "../") {
		return "", false
	}
	return p, true
}

// isConfigFile reports files that are part of the configuration: a
// local_file pointing at them is not written, so it can't break the session.
func isConfigFile(name string) bool {
	for _, suffix := range []string{".tf", ".tf.json", ".tfvars", ".tfvars.json", ".provider.json", ".tftest.hcl", ".terraform.lock.hcl"} {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

// localFileContent is the file a local_file writes, as the provider builds
// it from content, sensitive_content, content_base64 or source.
func localFileContent(get func(string) string, files map[string]string) string {
	content := get("content")
	if content == "" {
		content = get("sensitive_content")
	}
	if b64 := get("content_base64"); b64 != "" {
		if raw, err := base64.StdEncoding.DecodeString(b64); err == nil {
			content = string(raw)
		}
	}
	if src := get("source"); content == "" && src != "" {
		if p, ok := workspaceFile(src); ok {
			content = files[p]
		}
	}
	return content
}

type localFile struct {
	Path, Content, ID string
}

// localFileOf reads the file a local_file instance in the state manages.
func localFileOf(inst *InstanceState, files map[string]string) (localFile, bool) {
	if !isLocalFile(inst) {
		return localFile{}, false
	}
	var attrs map[string]any
	if err := json.Unmarshal(inst.RawAttrs, &attrs); err != nil {
		return localFile{}, false
	}
	get := func(k string) string {
		s, _ := attrs[k].(string)
		return s
	}
	p, ok := workspaceFile(get("filename"))
	if !ok || isConfigFile(p) {
		return localFile{}, false
	}
	return localFile{Path: p, Content: localFileContent(get, files), ID: get("id")}, true
}

func sha1Hex(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// refreshLocalFiles removes from the state the local files that are missing
// or whose content no longer matches their id (a SHA-1 of the content) and
// returns them.
func refreshLocalFiles(st *State, files map[string]string) []*InstanceState {
	var gone []*InstanceState
	for _, inst := range st.SortedInstances() {
		f, ok := localFileOf(inst, files)
		if !ok {
			continue
		}
		if cur, exists := files[f.Path]; exists && sha1Hex(cur) == f.ID {
			continue
		}
		delete(st.Instances, inst.Addr())
		gone = append(gone, inst)
	}
	return gone
}

// localFileWrites compares the local files before and after an apply: the
// files to write (new or different content) and the ones to delete.
func localFileWrites(before, after *State, files map[string]string) (map[string]string, []string) {
	writes := map[string]string{}
	kept := map[string]bool{}
	for _, inst := range after.SortedInstances() {
		if f, ok := localFileOf(inst, files); ok {
			kept[f.Path] = true
			if cur, exists := files[f.Path]; !exists || cur != f.Content {
				writes[f.Path] = f.Content
			}
		}
	}
	var removed []string
	for _, inst := range before.SortedInstances() {
		if f, ok := localFileOf(inst, files); ok && !kept[f.Path] {
			if _, exists := files[f.Path]; exists {
				removed = append(removed, f.Path)
				kept[f.Path] = true // once
			}
		}
	}
	sort.Strings(removed)
	return writes, removed
}

// renderDrift renders Terraform's note about objects deleted outside of it.
func renderDrift(changes []*Change) string {
	if len(changes) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("Note: Objects have changed outside of Terraform\n\n")
	sb.WriteString("Terraform detected the following changes made outside of Terraform since the\nlast \"terraform apply\" which may have affected this plan:\n\n")
	for _, c := range changes {
		lines := strings.SplitN(RenderChange(c), "\n", 2)
		lines[0] = "  # " + c.Addr + " has been deleted"
		sb.WriteString(strings.Join(lines, "\n") + "\n\n")
	}
	sb.WriteString("\nUnless you have made equivalent changes to your configuration, or ignored the\nrelevant attributes using ignore_changes, the following plan may include\nactions to undo or respond to these changes.\n")
	sb.WriteString("\n─────────────────────────────────────────────────────────────────────────────\n\n")
	return sb.String()
}
