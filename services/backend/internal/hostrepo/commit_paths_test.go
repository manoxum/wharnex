package hostrepo

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWorktreeMatchesCommitPathsAfterManualUnwind(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "app.txt", "old\n")
	base := git(t, root, "rev-parse", "HEAD")

	write(t, root, "app.txt", "new\n")
	write(t, root, "added.txt", "added\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "candidate")
	candidate := git(t, root, "rev-parse", "HEAD")
	git(t, root, "reset", "--mixed", "--quiet", base)

	matched, err := WorktreeMatchesCommitPaths(context.Background(), root, candidate)
	if err != nil {
		t.Fatal(err)
	}
	if !matched {
		t.Fatal("manual unwind left the candidate result on disk, so the worktree must prove it is already materialized")
	}

	if err := os.WriteFile(filepath.Join(root, "app.txt"), []byte("changed again\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	matched, err = WorktreeMatchesCommitPaths(context.Background(), root, candidate)
	if err != nil {
		t.Fatal(err)
	}
	if matched {
		t.Fatal("a later edit on a candidate path must prevent the worktree proof")
	}
}
