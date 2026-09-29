package projectgit

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gitText(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %s", args, output)
	}
	return string(output)
}

func writeRuntimeFile(t *testing.T, root string) {
	t.Helper()
	path := filepath.Join(root, ".harness", "state", "runtime.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("private runtime state\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureIgnoresRuntimeBeforeInitialCommit(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	writeRuntimeFile(t, root)
	if _, err := Ensure(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if got := gitText(t, root, "ls-tree", "-r", "--name-only", "HEAD"); strings.Contains(got, ".harness/") {
		t.Fatalf("baseline committed runtime state: %s", got)
	}
	gitText(t, root, "check-ignore", "-q", ".harness/state/runtime.json")
}

func TestEnsureRepairsExistingRepositoryAndUntracksRuntime(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	gitText(t, root, "init", "-q")
	gitText(t, root, "config", "user.name", "Wharnex Test")
	gitText(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("node_modules/"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeRuntimeFile(t, root)
	gitText(t, root, "add", "-A")
	gitText(t, root, "commit", "-qm", "existing project")
	for i := 0; i < 2; i++ {
		if _, err := Ensure(context.Background(), root); err != nil {
			t.Fatal(err)
		}
	}
	gitText(t, root, "check-ignore", "--no-index", "-q", ".harness/state/runtime.json")
	if got := gitText(t, root, "ls-files", "--", ".harness"); got != "" {
		t.Fatalf("runtime state remains in Git index: %s", got)
	}
	if _, err := os.Stat(filepath.Join(root, ".harness", "state", "runtime.json")); err != nil {
		t.Fatalf("runtime state was removed from disk: %v", err)
	}
	ignore, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if string(ignore) != "node_modules/\n/.harness/\n" {
		t.Fatalf("unexpected or duplicated ignore rule: %q", ignore)
	}
}
