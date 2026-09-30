package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareTerminalHistoryKeepsRuntimeStateOutOfGit(t *testing.T) {
	root := initTerminalGitRepository(t)
	if _, err := prepareTerminalHistory(Workspace{Path: root, SourcePath: root}, "/bin/bash"); err != nil {
		t.Fatal(err)
	}
	status, err := exec.Command("git", "-C", root, "status", "--porcelain", "--untracked-files=all").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(status)) != "" {
		t.Fatalf("terminal runtime state polluted Git status: %q", status)
	}
	exclude, err := os.ReadFile(filepath.Join(root, ".git", "info", "exclude"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(exclude), terminalRuntimeGitExclude) != 1 {
		t.Fatalf("terminal exclude rule missing or duplicated: %q", exclude)
	}
}

func TestTerminalRuntimeGitExcludeIsIdempotent(t *testing.T) {
	root := initTerminalGitRepository(t)
	for range 2 {
		if err := ensureTerminalRuntimeGitExclude(root); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(root, ".git", "info", "exclude"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), terminalRuntimeGitExclude) != 1 {
		t.Fatalf("terminal exclude rule was not idempotent: %q", data)
	}
}

func TestTerminalRuntimeGitExcludeCoversNestedProjectRoot(t *testing.T) {
	root := initTerminalGitRepository(t)
	project := filepath.Join(root, "services", "api")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareTerminalHistory(Workspace{Path: project, SourcePath: project}, "/bin/bash"); err != nil {
		t.Fatal(err)
	}
	status, err := exec.Command("git", "-C", root, "status", "--porcelain", "--untracked-files=all").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(status)) != "" {
		t.Fatalf("nested terminal runtime state polluted Git status: %q", status)
	}
}

func TestTerminalRuntimeGitExcludeAllowsNonGitProjects(t *testing.T) {
	if err := ensureTerminalRuntimeGitExclude(t.TempDir()); err != nil {
		t.Fatalf("non-Git project was rejected: %v", err)
	}
}

func TestTerminalRuntimeGitExcludeAllowsHostWithoutGit(t *testing.T) {
	t.Setenv("PATH", "")
	if err := ensureTerminalRuntimeGitExclude(t.TempDir()); err != nil {
		t.Fatalf("host without Git was rejected: %v", err)
	}
}

func initTerminalGitRepository(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root := t.TempDir()
	if output, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("initialize Git repository: %v: %s", err, output)
	}
	return root
}
