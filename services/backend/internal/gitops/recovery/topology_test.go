//go:build linux

package recovery

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runGit(t *testing.T, root string, args ...string) string {
	t.Helper()
	argv := []string{"-C", root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "-c", "protocol.file.allow=always"}
	output, err := exec.Command("git", append(argv, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func TestClearProvesSubmoduleAndWorktreeMetadataOwnership(t *testing.T) {
	for _, kind := range []string{"submodule", "worktree"} {
		t.Run(kind, func(t *testing.T) {
			root, lock := repository(t)
			if err := os.Remove(lock); err != nil {
				t.Fatal(err)
			}
			runGit(t, root, "commit", "-qm", "initial")
			switch kind {
			case "submodule":
				parent, parentLock := repository(t)
				if err := os.Remove(parentLock); err != nil {
					t.Fatal(err)
				}
				runGit(t, parent, "submodule", "add", "-q", root, "child")
				root = filepath.Join(parent, "child")
			case "worktree":
				linked := filepath.Join(t.TempDir(), "linked")
				runGit(t, root, "worktree", "add", "-qb", "linked", linked)
				root = linked
			}
			gitDir := runGit(t, root, "rev-parse", "--absolute-git-dir")
			lock = filepath.Join(gitDir, "index.lock")
			put(t, lock, "")
			old := time.Now().Add(-24 * time.Hour)
			if err := os.Chtimes(lock, old, old); err != nil {
				t.Fatal(err)
			}
			result := clear(context.Background(), root, func(os.FileInfo) error { return nil })
			if !result.Recovered || result.Path != lock {
				t.Fatalf("%+v", result)
			}
		})
	}
}
