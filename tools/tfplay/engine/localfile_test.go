package engine

import (
	"slices"
	"strings"
	"testing"
)

// write applies the files a command wrote or removed, like the editor does.
func (s *session) write(resp Response) {
	for name, content := range resp.Files {
		s.files[name] = content
	}
	for _, name := range resp.RemovedFiles {
		delete(s.files, name)
	}
}

const saludoTf = `
resource "local_file" "saludo" {
  filename = "${path.module}/saludo.txt"
  content  = "hola"
}
`

func TestLocalFileIsWrittenAndRemoved(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": saludoTf})
	resp := s.run("apply")
	if resp.ExitCode != 0 || resp.Files["saludo.txt"] != "hola" {
		t.Fatalf("apply should write saludo.txt, got %q (exit %d):\n%s", resp.Files, resp.ExitCode, resp.Output)
	}
	s.write(resp)
	mustContain(t, s.run("plan").Output, "No changes.")

	// Changing the content (every argument forces replacement) rewrites it.
	s.files["main.tf"] = strings.Replace(saludoTf, `"hola"`, `"hola de nuevo"`, 1)
	resp = s.run("apply")
	if resp.Files["saludo.txt"] != "hola de nuevo" {
		t.Fatalf("the new content was not written: %q", resp.Files)
	}
	s.write(resp)

	// A new filename writes the new file and deletes the old one.
	s.files["main.tf"] = strings.Replace(s.files["main.tf"], "saludo.txt", "otro.txt", 1)
	resp = s.run("apply")
	s.write(resp)
	if s.files["otro.txt"] != "hola de nuevo" || !slices.Equal(resp.RemovedFiles, []string{"saludo.txt"}) {
		t.Fatalf("rename: files %q, removed %q", resp.Files, resp.RemovedFiles)
	}

	resp = s.run("destroy")
	if !slices.Equal(resp.RemovedFiles, []string{"otro.txt"}) {
		t.Fatalf("destroy should remove otro.txt, removed %q:\n%s", resp.RemovedFiles, resp.Output)
	}
}

func TestLocalFileDrift(t *testing.T) {
	s := newSession(t, map[string]string{"main.tf": saludoTf})
	s.write(s.run("apply"))

	for name, edit := range map[string]func(){
		"edited":  func() { s.files["saludo.txt"] = "adiós" },
		"deleted": func() { delete(s.files, "saludo.txt") },
	} {
		edit()
		plan := s.run("plan")
		mustContain(t, plan.Output,
			"local_file.saludo: Refreshing state...",
			"Note: Objects have changed outside of Terraform",
			"  # local_file.saludo has been deleted\n  - resource \"local_file\" \"saludo\" {",
			"  # local_file.saludo will be created",
			"Plan: 1 to add, 0 to change, 0 to destroy.",
		)
		if plan.Files != nil {
			t.Errorf("%s: plan must not write files: %q", name, plan.Files)
		}
		resp := s.run("apply")
		if resp.Files["saludo.txt"] != "hola" {
			t.Fatalf("%s: apply should restore the content, got %q:\n%s", name, resp.Files, resp.Output)
		}
		s.write(resp)
		if out := s.run("plan").Output; !strings.Contains(out, "No changes.") || strings.Contains(out, "outside of Terraform") {
			t.Errorf("%s: the file should be in sync after apply:\n%s", name, out)
		}
	}
}

func TestLocalFileDriftIsNotDestroyed(t *testing.T) {
	// The provider forgets an edited file on refresh, so destroy leaves it alone.
	s := newSession(t, map[string]string{"main.tf": saludoTf})
	s.write(s.run("apply"))
	s.files["saludo.txt"] = "editado a mano"
	resp := s.run("destroy")
	mustContain(t, resp.Output, "has been deleted", "No changes. No objects need to be destroyed.")
	if len(resp.RemovedFiles) != 0 || s.files["saludo.txt"] != "editado a mano" {
		t.Errorf("an edited file must survive destroy: removed %q", resp.RemovedFiles)
	}
}

func TestLocalFileOnlyInsideWorkspace(t *testing.T) {
	for _, filename := range []string{"./main.tf", "../fuera.txt", "/etc/motd"} {
		s := newSession(t, map[string]string{"main.tf": strings.Replace(saludoTf, "${path.module}/saludo.txt", filename, 1)})
		resp := s.run("apply")
		if resp.ExitCode != 0 || len(resp.Files) != 0 {
			t.Errorf("%s: nothing should be written, got %q (exit %d)", filename, resp.Files, resp.ExitCode)
		}
		s.write(resp)
		mustContain(t, s.run("plan").Output, "No changes.")
	}
}

func TestLocalFileSource(t *testing.T) {
	s := newSession(t, map[string]string{
		"main.tf":       `resource "local_file" "copia" {` + "\n" + `  filename = "copia.txt"` + "\n" + `  source = "plantilla.txt"` + "\n}\n",
		"plantilla.txt": "desde source",
	})
	resp := s.run("apply")
	if resp.Files["copia.txt"] != "desde source" {
		t.Fatalf("source should be copied, got %q:\n%s", resp.Files, resp.Output)
	}
	s.write(resp)
	mustContain(t, s.run("plan").Output, "No changes.")
}
