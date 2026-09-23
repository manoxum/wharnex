package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalTerminalCommandUsesProjectScopedHistoryInsteadOfHostHistory(t *testing.T) {
	if _, err := os.Stat("/bin/bash"); err != nil {
		t.Skip("bash is unavailable")
	}
	project := t.TempDir()
	execution := t.TempDir()
	hostHistory := filepath.Join(t.TempDir(), "host-history")
	t.Setenv("SHELL", "/bin/bash")
	t.Setenv("HISTFILE", hostHistory)

	cmd, err := localTerminalCommand(Workspace{
		Path:        execution,
		SourcePath:  execution,
		ProjectPath: project,
	}, TerminalOptions{Cwd: "."})
	if err != nil {
		t.Fatal(err)
	}

	want := filepath.Join(project, ".harness", "terminal", "history", "bash")
	if got := environmentValue(cmd.Env, "HISTFILE"); got != want {
		t.Fatalf("HISTFILE = %q, want project-scoped %q", got, want)
	}
	if got := environmentValue(cmd.Env, "WHARNEX_PROJECT_HISTFILE"); got != want {
		t.Fatalf("WHARNEX_PROJECT_HISTFILE = %q, want %q", got, want)
	}
	initFile := filepath.Join(project, ".harness", "terminal", bashTerminalInitName)
	if got := strings.Join(cmd.Args[1:], " "); got != "--rcfile "+initFile+" -i" {
		t.Fatalf("bash must start through the project terminal init: %q", got)
	}
	if data, err := os.ReadFile(initFile); err != nil || !strings.Contains(string(data), `HISTFILE="$WHARNEX_PROJECT_HISTFILE"`) {
		t.Fatalf("project terminal init does not pin the project history: %v %q", err, data)
	}
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("project history file was not prepared: %v", err)
	}
	if _, err := os.Stat(hostHistory); !os.IsNotExist(err) {
		t.Fatalf("host history path was unexpectedly touched: %v", err)
	}
}

func TestProjectTerminalHistoriesStayIndependent(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	firstPath, err := prepareTerminalHistory(Workspace{Path: first, SourcePath: first}, "/bin/bash")
	if err != nil {
		t.Fatal(err)
	}
	secondPath, err := prepareTerminalHistory(Workspace{Path: second, SourcePath: second}, "/bin/bash")
	if err != nil {
		t.Fatal(err)
	}
	if firstPath == secondPath {
		t.Fatalf("separate projects share history path %q", firstPath)
	}
	if err := os.WriteFile(firstPath, []byte("echo first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	secondData, err := os.ReadFile(secondPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(secondData), "echo first") {
		t.Fatal("one project's terminal history leaked into another project")
	}
}

func TestPrepareTerminalHistoryRejectsSymlinkDirectoryComponent(t *testing.T) {
	project := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(project, ".harness")); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareTerminalHistory(Workspace{Path: project, SourcePath: project}, "/bin/bash"); err == nil {
		t.Fatal("symlink history directory was accepted")
	}
}

func TestPrepareTerminalHistoryRejectsSymlinkHistoryFile(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, ".harness", "terminal", "history")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "outside-history")
	if err := os.WriteFile(target, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "bash")); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareTerminalHistory(Workspace{Path: project, SourcePath: project}, "/bin/bash"); err == nil {
		t.Fatal("symlink history file was accepted")
	}
}
