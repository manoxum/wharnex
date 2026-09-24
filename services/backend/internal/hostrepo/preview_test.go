package hostrepo

import (
	"context"
	"strings"
	"testing"
)

func TestResolveRefReportsExistingAndMissingRefs(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")

	sha, exists, err := ResolveRef(context.Background(), root, "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if !exists || sha == "" {
		t.Fatalf("HEAD should resolve to a commit, got sha=%q exists=%v", sha, exists)
	}

	sha, exists, err = ResolveRef(context.Background(), root, "origin/missing")
	if err != nil {
		t.Fatal(err)
	}
	if exists || sha != "" {
		t.Fatalf("missing ref should not resolve, got sha=%q exists=%v", sha, exists)
	}
}

func TestDiffFromEmptyShowsCompleteTargetTree(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "nested/new.txt", "new\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "add nested file")

	diff, truncated, err := DiffFromEmpty(context.Background(), root, "HEAD", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("small test diff must not be truncated")
	}
	for _, want := range []string{"README.md", "nested/new.txt", "+root", "+new"} {
		if !strings.Contains(diff, want) {
			t.Fatalf("diff from empty tree missing %q:\n%s", want, diff)
		}
	}
}
