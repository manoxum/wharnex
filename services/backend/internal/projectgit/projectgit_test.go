package projectgit

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

func TestEnsureInitializesProjectRoot(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	initialized, err := Ensure(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !initialized {
		t.Fatal("expected a new repository")
	}
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		t.Fatalf(".git was not created: %v", err)
	}
	cmd := exec.Command("git", "-C", root, "rev-parse", "--show-toplevel")
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	resolved, _ := filepath.EvalSymlinks(root)
	got, _ := filepath.EvalSymlinks(stringTrimSpace(string(output)))
	if resolved != got {
		t.Fatalf("unexpected repository root: got %q want %q", got, resolved)
	}
}

func TestEnsureIsIdempotent(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	if _, err := Ensure(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	initialized, err := Ensure(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if initialized {
		t.Fatal("existing repository must not be reinitialized")
	}
}

func TestEnsureCreatesNestedRepoEvenInsideParentRepo(t *testing.T) {
	requireGit(t)
	parent := t.TempDir()
	if _, err := Ensure(context.Background(), parent); err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(parent, "child-project")
	if err := os.Mkdir(child, 0o755); err != nil {
		t.Fatal(err)
	}
	initialized, err := Ensure(context.Background(), child)
	if err != nil {
		t.Fatal(err)
	}
	if !initialized {
		t.Fatal("project root should own a repository rather than inheriting its parent")
	}
	if _, err := os.Stat(filepath.Join(child, ".git")); err != nil {
		t.Fatalf("nested project .git was not created: %v", err)
	}
}

func stringTrimSpace(value string) string {
	for len(value) > 0 {
		last := value[len(value)-1]
		if last != '\n' && last != '\r' && last != ' ' && last != '\t' {
			break
		}
		value = value[:len(value)-1]
	}
	return value
}
