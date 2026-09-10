package hostrepo

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// bumpSubmoduleOnBranch commits a new submodule commit and records the moved
// gitlink on a branch, then returns the superproject to a clean main — the
// shape a Wharnex integration branch has when it changes a submodule pointer.
func bumpSubmoduleOnBranch(t *testing.T, root, subPath, branch string) (newSubmoduleSHA string) {
	t.Helper()
	sub := filepath.Join(root, filepath.FromSlash(subPath))
	original := git(t, sub, "rev-parse", "HEAD")
	write(t, root, subPath+"/lib.txt", "v2\n")
	git(t, sub, "commit", "-qam", "v2")
	newSubmoduleSHA = git(t, sub, "rev-parse", "HEAD")
	git(t, root, "checkout", "-q", "-b", branch)
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: bump submodule")
	git(t, root, "checkout", "-q", "main")
	git(t, sub, "checkout", "-q", original)
	return newSubmoduleSHA
}

// Git updates a gitlink in the index and HEAD but leaves the submodule's own
// checkout wherever it was. Post-merge verification then builds against
// content that matches neither tree, and the superproject reports itself
// modified forever — which is the state that blocked every later Apply.
func TestSyncSubmodulesRealignsAMovedGitlink(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	expected := bumpSubmoduleOnBranch(t, root, "mod/app", "whx/req")

	before, err := Inspect(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	git(t, root, "merge", "--no-ff", "--no-edit", "whx/req")
	if status := git(t, root, "status", "--porcelain"); status == "" {
		t.Fatal("precondition: git itself must leave the submodule checkout stale after the merge")
	}

	result, err := SyncSubmodules(context.Background(), root, before.Submodules)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(result.Updated, "mod/app") {
		t.Fatalf("expected mod/app realigned, got %+v", result)
	}
	if actual := git(t, filepath.Join(root, "mod", "app"), "rev-parse", "HEAD"); actual != expected {
		t.Fatalf("expected the submodule at %s, got %s", expected, actual)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("expected a clean superproject after realignment, got %q", status)
	}
}

func TestSyncSubmodulesRealignsAfterAReset(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	bumpSubmoduleOnBranch(t, root, "mod/app", "whx/req")
	original := git(t, filepath.Join(root, "mod", "app"), "rev-parse", "HEAD")
	preMerge := git(t, root, "rev-parse", "HEAD")
	git(t, root, "merge", "--no-ff", "--no-edit", "whx/req")
	git(t, root, "submodule", "update", "--no-fetch", "--checkout", "--", "mod/app")

	before, err := Inspect(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	git(t, root, "reset", "--hard", preMerge)

	result, err := SyncSubmodules(context.Background(), root, before.Submodules)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(result.Updated, "mod/app") {
		t.Fatalf("expected the revert to realign mod/app, got %+v", result)
	}
	if actual := git(t, filepath.Join(root, "mod", "app"), "rev-parse", "HEAD"); actual != original {
		t.Fatalf("expected the submodule restored to %s, got %s", original, actual)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("a revert must leave a genuinely clean host, got %q", status)
	}
}

func TestSyncSubmodulesLeavesDirtySubmodulesAlone(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	bumpSubmoduleOnBranch(t, root, "mod/app", "whx/req")
	before, err := Inspect(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	git(t, root, "merge", "--no-ff", "--no-edit", "whx/req")
	write(t, root, "mod/app/lib.txt", "v1\noperator work\n")

	result, err := SyncSubmodules(context.Background(), root, before.Submodules)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Updated) != 0 {
		t.Fatalf("a submodule holding uncommitted work must not be checked out over, got %+v", result)
	}
	if len(result.Skipped) != 1 || result.Skipped[0].Path != "mod/app" {
		t.Fatalf("expected the skip reported so the operator knows, got %+v", result)
	}
	if body := readFile(t, root, "mod/app/lib.txt"); !strings.Contains(body, "operator work") {
		t.Fatalf("the operator's submodule work must survive, got %q", body)
	}
}

// Git permits a merge that moves a dirty submodule's pointer and simply leaves
// the checkout behind — the worst available outcome, since the operator's work
// then sits on a base the superproject no longer records.
func TestGuardDirtySubmodulesBlocksAPointerMove(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	bumpSubmoduleOnBranch(t, root, "mod/app", "whx/req")
	write(t, root, "mod/app/lib.txt", "v1\noperator work\n")

	err := GuardDirtySubmodules(context.Background(), root, "whx/req", []string{"mod/app"})
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected a *BlockedError, got %v", err)
	}
	if blocked.Reason != BlockedDirtySubmoduleGitlink || !contains(blocked.Paths, "mod/app") {
		t.Fatalf("unexpected refusal %+v", blocked)
	}
}

// A dirty submodule the change does not touch is irrelevant to the merge and
// must never block it — refusing there would be as broken as the failure this
// replaces, in the opposite direction.
func TestGuardDirtySubmodulesAllowsAnUnrelatedChange(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	git(t, root, "checkout", "-q", "-b", "whx/req")
	write(t, root, "README.md", "root\nchanged\n")
	git(t, root, "commit", "-qam", "feat: unrelated change")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "mod/app/lib.txt", "v1\noperator work\n")

	if err := GuardDirtySubmodules(context.Background(), root, "whx/req", []string{"mod/app"}); err != nil {
		t.Fatalf("a change that does not move the pointer must proceed: %v", err)
	}
}
