package committing_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

func TestCommitPathsCommitsOnlyTheSelectedPaths(t *testing.T) {
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "wanted.txt", "wanted\n")
	write(t, root, "unrelated.txt", "unrelated\n")

	sha, err := hostrepo.CommitPaths(context.Background(), root, "feat: add wanted", []string{"wanted.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if sha == "" {
		t.Fatal("expected a commit sha")
	}
	files := git(t, root, "show", "--format=", "--name-only", sha)
	if !strings.Contains(files, "wanted.txt") || strings.Contains(files, "unrelated.txt") {
		t.Fatalf("the commit must hold only the selected path, got %q", files)
	}
	if status := git(t, root, "status", "--porcelain"); !strings.Contains(status, "unrelated.txt") {
		t.Fatalf("the unselected file must stay uncommitted, got %q", status)
	}
}

func TestCommitPathsReportsNothingToCommit(t *testing.T) {
	root := newRepo(t, "README.md", "root\n")
	_, err := hostrepo.CommitPaths(context.Background(), root, "feat: nothing", []string{"README.md"})
	if !errors.Is(err, hostrepo.ErrNothingToCommit) {
		t.Fatalf("expected ErrNothingToCommit, got %v", err)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("a commit that did not happen must leave the index alone, got %q", status)
	}
}

func TestCommitInternalPathsUsesWharnexIdentityAndLeavesOtherChanges(t *testing.T) {
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "VERSION", "v1.2.3.4\n")
	write(t, root, "unrelated.txt", "keep me pending\n")

	sha, err := hostrepo.CommitInternalPaths(context.Background(), root, "chore(version): bump project version", []string{"VERSION"})
	if err != nil {
		t.Fatal(err)
	}
	if author := git(t, root, "show", "-s", "--format=%an <%ae>", sha); author != "Wharnex <wharness@localhost>" {
		t.Fatalf("unexpected internal commit identity: %q", author)
	}
	files := git(t, root, "show", "--format=", "--name-only", sha)
	if !strings.Contains(files, "VERSION") || strings.Contains(files, "unrelated.txt") {
		t.Fatalf("internal commit must contain only VERSION, got %q", files)
	}
	if status := git(t, root, "status", "--porcelain"); !strings.Contains(status, "unrelated.txt") {
		t.Fatalf("unrelated work must remain pending, got %q", status)
	}
}
