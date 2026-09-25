package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBashTerminalHistoryScopeShortcuts(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash is unavailable")
	}

	t.Run("up stays inside the project", func(t *testing.T) {
		project, wharnexRoot, _ := prepareBashHistoryScopeFixture(t, bash)
		seedBashHistory(t, filepath.Join(project, ".harness", "terminal", "history", "bash"), "echo PROJECT_SCOPE\n")
		seedBashHistory(t, filepath.Join(wharnexRoot, ".harness", "terminal", "history", "wharnex", "commands"), "echo WHARNEX_SCOPE\n")

		output, code := runProjectTerminal(t, project, "\x1b[A\nexit\n")
		if code != 0 {
			t.Fatalf("bash PTY exited %d, want 0; output:\n%s", code, output)
		}
		if !strings.Contains(output, "PROJECT_SCOPE") || strings.Contains(output, "WHARNEX_SCOPE") {
			t.Fatalf("plain Up did not stay project-scoped:\n%s", output)
		}
	})

	t.Run("shift up reads Wharnex-wide history", func(t *testing.T) {
		project, wharnexRoot, _ := prepareBashHistoryScopeFixture(t, bash)
		seedBashHistory(t, filepath.Join(wharnexRoot, ".harness", "terminal", "history", "wharnex", "commands"), "echo WHARNEX_SCOPE\n")

		output, code := runProjectTerminal(t, project, "\x1b[1;2A\nexit\n")
		if code != 0 {
			t.Fatalf("bash PTY exited %d, want 0; output:\n%s", code, output)
		}
		if !strings.Contains(output, "WHARNEX_SCOPE") {
			t.Fatalf("Shift+Up did not recall Wharnex history:\n%s", output)
		}
	})

	t.Run("shift up sees commands from another project", func(t *testing.T) {
		firstProject, _, _ := prepareBashHistoryScopeFixture(t, bash)
		firstOutput, firstCode := runProjectTerminal(t, firstProject, "echo CROSS_PROJECT_SCOPE\nexit\n")
		if firstCode != 0 {
			t.Fatalf("first bash PTY exited %d, want 0; output:\n%s", firstCode, firstOutput)
		}

		secondProject := t.TempDir()
		output, code := runProjectTerminal(t, secondProject, "\x1b[1;2A\nexit\n")
		if code != 0 {
			t.Fatalf("second bash PTY exited %d, want 0; output:\n%s", code, output)
		}
		if !strings.Contains(output, "CROSS_PROJECT_SCOPE") {
			t.Fatalf("Shift+Up did not recall the other project's command:\n%s", output)
		}
	})

	t.Run("ctrl shift up includes operating system history", func(t *testing.T) {
		project, _, home := prepareBashHistoryScopeFixture(t, bash)
		seedBashHistory(t, filepath.Join(home, ".bash_history"), "echo OS_SCOPE\n")

		output, code := runProjectTerminal(t, project, "\x1b[1;6A\nexit\n")
		if code != 0 {
			t.Fatalf("bash PTY exited %d, want 0; output:\n%s", code, output)
		}
		if !strings.Contains(output, "OS_SCOPE") {
			t.Fatalf("Ctrl+Shift+Up did not recall OS history:\n%s", output)
		}
	})

	t.Run("ctrl shift up traverses Wharnex then OS history", func(t *testing.T) {
		project, wharnexRoot, home := prepareBashHistoryScopeFixture(t, bash)
		seedBashHistory(t, filepath.Join(home, ".bash_history"), "echo OS_OLDER_SCOPE\n")
		seedBashHistory(t, filepath.Join(wharnexRoot, ".harness", "terminal", "history", "wharnex", "commands"), "echo WHARNEX_NEWER_SCOPE\n")

		output, code := runProjectTerminal(t, project, "\x1b[1;6A\x1b[1;6A\nexit\n")
		if code != 0 {
			t.Fatalf("bash PTY exited %d, want 0; output:\n%s", code, output)
		}
		if !strings.Contains(output, "OS_OLDER_SCOPE") {
			t.Fatalf("repeated Ctrl+Shift+Up did not traverse into OS history:\n%s", output)
		}
	})
}

func prepareBashHistoryScopeFixture(t *testing.T, bash string) (project, wharnexRoot, home string) {
	t.Helper()
	project = t.TempDir()
	wharnexRoot = t.TempDir()
	home = t.TempDir()
	profile := "HISTFILE=\"$HOME/.bash_history\"\nPS1='wx$ '\n"
	if err := os.WriteFile(filepath.Join(home, ".profile"), []byte(profile), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("SHELL", bash)
	t.Setenv("HISTFILE", filepath.Join(home, ".bash_history"))
	t.Setenv("WHARNESS_ROOT", wharnexRoot)
	return project, wharnexRoot, home
}

func seedBashHistory(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
