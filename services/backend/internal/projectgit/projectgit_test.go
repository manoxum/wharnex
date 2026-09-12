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

func TestCloneRecursivelyInitializesSubmodules(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	main := filepath.Join(root, "main")
	for _, repo := range []string{sub, main} {
		if err := os.Mkdir(repo, 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := Ensure(context.Background(), repo); err != nil {
			t.Fatal(err)
		}
		runGit(t, repo, "config", "user.email", "test@example.invalid")
		runGit(t, repo, "config", "user.name", "Wharnex Test")
	}
	if err := os.WriteFile(filepath.Join(sub, "sub.txt"), []byte("submodule\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, sub, "add", "sub.txt")
	runGit(t, sub, "commit", "-qm", "sub")
	if err := os.WriteFile(filepath.Join(main, "main.txt"), []byte("main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, main, "add", "main.txt")
	runGit(t, main, "commit", "-qm", "main")
	cmd := exec.Command("git", "-c", "protocol.file.allow=always", "-C", main, "submodule", "add", sub, "modules/sub")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("add submodule: %s", output)
	}
	runGit(t, main, "commit", "-qam", "submodule")

	parent := filepath.Join(root, "clones")
	if err := os.Mkdir(parent, 0o755); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	t.Setenv("GIT_ALLOW_PROTOCOL", "file")
	cloned, err := Clone(ctx, main, parent, "checkout")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(cloned, "modules", "sub", "sub.txt")); err != nil {
		t.Fatalf("recursive submodule content missing: %v", err)
	}
}

func TestCloneRejectsUnsafeDirectoryName(t *testing.T) {
	_, err := Clone(context.Background(), "https://example.invalid/repo.git", t.TempDir(), "../escape")
	if err == nil {
		t.Fatal("expected unsafe directory rejection")
	}
}

func runGit(t *testing.T, root string, args ...string) {
	t.Helper()
	full := append([]string{"-C", root}, args...)
	cmd := exec.Command("git", full...)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s", args, output)
	}
}

func TestCreateInitializesNewProject(t *testing.T) {
	requireGit(t)
	parent := t.TempDir()
	root, err := Create(context.Background(), parent, "fresh-project")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		t.Fatalf("new project git boundary missing: %v", err)
	}
}
