package engine

import (
	"bytes"
	"compress/gzip"
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// Golden tests: every directory in testdata is a scenario made of steps
// (step1, step2, ...). For each step the engine plans the configuration
// against the state produced by applying the previous steps, and the output
// is compared with expected.txt, which was produced by the real terraform
// binary on the very same files and state.
//
// To regenerate expected.txt with a real terraform and providers mirror:
//
//	TFPLAY_TERRAFORM=/path/to/terraform TF_CLI_CONFIG_FILE=/path/to/mirror.tfrc \
//	  go test ./engine -run TestGolden -update
var update = flag.Bool("update", false, "regenerate expected.txt using a real terraform binary")

const providersDir = "../../../static/tfplay/providers"

func loadEngine(t *testing.T) (*Engine, []string) {
	t.Helper()
	en := New()
	fixed := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	en.Now = func() time.Time { return fixed }
	nowFunc = func() time.Time { return fixed }
	lineageCounter = 0
	var installed []string
	entries, err := os.ReadDir(providersDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(providersDir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(e.Name(), ".gz") {
			r, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			data, _ = io.ReadAll(r)
		}
		info, err := en.RegisterProvider(data)
		if err != nil {
			t.Fatal(err)
		}
		installed = append(installed, info.Source)
	}
	return en, installed
}

func readFiles(t *testing.T, dir string) map[string]string {
	files := map[string]string{}
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		if rel == "expected.txt" {
			return nil
		}
		b, _ := os.ReadFile(p)
		files[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	return files
}

// normalize drops what legitimately differs: refresh lines (the real
// terraform runs with -refresh=false because there is no cloud to refresh
// from) and the trailing -out note.
func normalize(s string) string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, ": Refreshing state...") {
			continue
		}
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func TestGolden(t *testing.T) {
	cases, _ := os.ReadDir("testdata")
	for _, c := range cases {
		if !c.IsDir() {
			continue
		}
		t.Run(c.Name(), func(t *testing.T) {
			en, installed := loadEngine(t)
			dir := filepath.Join("testdata", c.Name())
			steps, _ := filepath.Glob(filepath.Join(dir, "step*"))
			sort.Strings(steps)
			state := ""
			for i, step := range steps {
				files := readFiles(t, step)
				resp := en.Run(Request{Command: "plan", Files: files, State: state, Installed: installed})
				expPath := filepath.Join(step, "expected.txt")
				if *update {
					exp := realPlan(t, files, state)
					os.WriteFile(expPath, []byte(exp), 0o644)
				}
				exp, err := os.ReadFile(expPath)
				if err != nil {
					t.Fatalf("%s: %v (run with -update to generate)", step, err)
				}
				if got, want := normalize(resp.Output), normalize(string(exp)); got != want {
					t.Errorf("%s: plan differs from real terraform\n%s", filepath.Base(step), lineDiff(want, got))
				}
				if i < len(steps)-1 {
					ar := en.Run(Request{Command: "apply", Files: files, State: state, Installed: installed})
					if ar.ExitCode != 0 || ar.State == nil {
						t.Fatalf("%s: apply failed:\n%s", step, ar.Output)
					}
					state = *ar.State
				}
			}
		})
	}
}

func realPlan(t *testing.T, files map[string]string, state string) string {
	bin := os.Getenv("TFPLAY_TERRAFORM")
	if bin == "" {
		t.Skip("TFPLAY_TERRAFORM not set")
	}
	dir := t.TempDir()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(content), 0o644)
	}
	if state != "" {
		os.WriteFile(filepath.Join(dir, "terraform.tfstate"), []byte(state), 0o644)
	}
	run := func(args ...string) string {
		cmd := exec.Command(bin, args...)
		cmd.Dir = dir
		out, _ := cmd.CombinedOutput()
		return string(out)
	}
	run("init", "-input=false", "-no-color")
	return run("plan", "-no-color", "-input=false", "-refresh=false")
}

func lineDiff(want, got string) string {
	w, g := strings.Split(want, "\n"), strings.Split(got, "\n")
	var sb strings.Builder
	for _, op := range lcsDiff(len(w), len(g), func(i, j int) bool { return w[i] == g[j] }) {
		switch op.kind {
		case '-':
			sb.WriteString("- (terraform) " + w[op.i] + "\n")
		case '+':
			sb.WriteString("+ (engine)    " + g[op.j] + "\n")
		}
	}
	return sb.String()
}
