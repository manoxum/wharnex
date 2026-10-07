package committing_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

func TestCommitRecreatedPathAfterStagedDeletion(t *testing.T) {
	root := newRepo(t, "file.txt", "original\n")
	git(t, root, "rm", "--", "file.txt")
	write(t, root, "file.txt", "recreated\n")
	sha, err := hostrepo.CommitPaths(context.Background(), root, "fix: recreate file", []string{"file.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if content := git(t, root, "show", sha+":file.txt"); content != "recreated" {
		t.Fatalf("commit must capture current worktree content: %q", content)
	}
}

func TestUnchangedSelectionPreservesUnrelatedStagedWork(t *testing.T) {
	for _, internal := range []bool{false, true} {
		root := newRepo(t, "file.txt", "unchanged\n")
		write(t, root, "other.txt", "leave staged\n")
		git(t, root, "add", "--", "other.txt")
		head := git(t, root, "rev-parse", "HEAD")
		commit := hostrepo.CommitPaths
		if internal {
			commit = hostrepo.CommitInternalPaths
		}
		_, err := commit(context.Background(), root, "fix: unchanged", []string{"file.txt"})
		if !errors.Is(err, hostrepo.ErrNothingToCommit) {
			t.Fatalf("unchanged selection must report no change: %v", err)
		}
		if staged := git(t, root, "diff", "--cached", "--name-only"); staged != "other.txt" {
			t.Fatalf("unrelated staging must survive: %q", staged)
		}
		if current := git(t, root, "rev-parse", "HEAD"); current != head {
			t.Fatal("unchanged selection must not create a commit")
		}
	}
}

func TestUnknownPathStillFailsBeforeCommit(t *testing.T) {
	root := newRepo(t, "file.txt", "original\n")
	head := git(t, root, "rev-parse", "HEAD")
	write(t, root, "file.txt", "changed\n")
	_, err := hostrepo.CommitPaths(context.Background(), root, "fix: missing", []string{"file.txt", "unknown.txt"})
	if err == nil || !strings.Contains(err.Error(), "pathspec") {
		t.Fatalf("only proven staged deletions may bypass git add: %v", err)
	}
	if current := git(t, root, "rev-parse", "HEAD"); current != head {
		t.Fatal("invalid selection must not create a commit")
	}
}

func TestSelectedFilenameIsLiteral(t *testing.T) {
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "file[1].txt", "selected\n")
	write(t, root, "file1.txt", "unselected\n")
	sha, err := hostrepo.CommitPaths(context.Background(), root, "fix: literal selection", []string{"file[1].txt"})
	if err != nil {
		t.Fatal(err)
	}
	if files := git(t, root, "show", "--format=", "--name-only", sha); files != "file[1].txt" {
		t.Fatalf("selection must not expand filename metacharacters: %q", files)
	}
}
