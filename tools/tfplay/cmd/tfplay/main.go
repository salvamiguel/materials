// Command tfplay runs the playground engine natively, which is handy for
// tests and for comparing its output with the real terraform binary.
//
//	go run ./cmd/tfplay -dir ./example plan
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/salvamiguel/materials/tools/tfplay/engine"
)

type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, v); return nil }

func main() {
	dir := flag.String("dir", ".", "configuration directory")
	provDir := flag.String("providers", "../../static/tfplay/providers", "directory with provider .json(.gz) files")
	statePath := flag.String("state", "", "state file (default <dir>/terraform.tfstate)")
	asJSON := flag.Bool("json", false, "print the full JSON response")
	var vars multiFlag
	flag.Var(&vars, "var", "variable assignment name=value (repeatable)")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: tfplay [flags] <command> [args]")
		os.Exit(2)
	}
	if *statePath == "" {
		*statePath = filepath.Join(*dir, "terraform.tfstate")
	}

	en := engine.New()
	var installed []string
	entries, _ := os.ReadDir(*provDir)
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(*provDir, e.Name()))
		if err != nil {
			continue
		}
		if strings.HasSuffix(e.Name(), ".gz") {
			r, err := gzip.NewReader(bytes.NewReader(data))
			if err != nil {
				continue
			}
			data, _ = io.ReadAll(r)
		}
		info, err := en.RegisterProvider(data)
		if err != nil {
			fmt.Fprintln(os.Stderr, e.Name()+":", err)
			continue
		}
		installed = append(installed, info.Source)
	}

	files := map[string]string{}
	filepath.WalkDir(*dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(*dir, p)
		if strings.HasSuffix(rel, ".tfstate") || strings.HasPrefix(rel, ".") {
			return nil
		}
		b, _ := os.ReadFile(p)
		files[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	// Custom providers count as installed, like after `terraform init`.
	for _, info := range en.RequiredProviders(files) {
		installed = append(installed, info.Source)
	}

	stateData, _ := os.ReadFile(*statePath)
	req := engine.Request{
		Command:   strings.ReplaceAll(strings.Join(flag.Args()[:min(2, flag.NArg())], " "), "state ", "state_"),
		Files:     files,
		State:     string(stateData),
		Installed: installed,
		Vars:      map[string]string{},
	}
	if !strings.HasPrefix(req.Command, "state_") {
		req.Command = flag.Arg(0)
		req.Args = flag.Args()[1:]
	} else {
		req.Args = flag.Args()[2:]
	}
	for _, v := range vars {
		k, val, _ := strings.Cut(v, "=")
		req.Vars[k] = val
	}
	resp := en.Run(req)
	if *asJSON {
		b, _ := json.MarshalIndent(resp, "", "  ")
		fmt.Println(string(b))
	} else {
		fmt.Print(resp.Output)
	}
	if resp.State != nil {
		os.WriteFile(*statePath, []byte(*resp.State), 0o644)
	}
	for name, content := range resp.Files {
		if strings.HasPrefix(name, ".terraform") {
			continue
		}
		os.WriteFile(filepath.Join(*dir, name), []byte(content), 0o644)
	}
	os.Exit(resp.ExitCode)
}
