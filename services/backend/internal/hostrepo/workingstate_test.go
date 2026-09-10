package hostrepo

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A submodule holding uncommitted content makes the superproject report itself
// modified while `git add -A` stages nothing. The previous code read only "is
// status non-empty" and then required the commit to succeed, so this exact
// state failed every host integration — permanently, because nothing in the
// flow could ever clear it.
func TestWorkingClassifiesDirtySubmoduleContentAsUncommittable(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	write(t, root, "mod/app/lib.txt", "v1\nlocal edit\n")

	state, err := Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(state.DirtySubmodules, "mod/app") {
		t.Fatalf("expected mod/app classified as a dirty submodule, got %+v", state)
	}
	if len(state.Stageable) != 0 {
		t.Fatalf("submodule content is not stageable from the superproject, got %v", state.Stageable)
	}
	if state.Committable() {
		t.Fatal("a worktree whose only dirt lives inside a submodule has nothing a superproject commit can capture")
	}
	if state.Clean() {
		t.Fatal("the worktree is dirty and must not be reported clean")
	}
}

// Untracked content inside a submodule reads identically to modified content
// from the superproject, and broke integration the same way.
func TestWorkingClassifiesUntrackedSubmoduleContent(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	write(t, root, "mod/app/scratch.tmp", "temp\n")

	state, err := Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(state.DirtySubmodules, "mod/app") || state.Committable() {
		t.Fatalf("expected uncommittable submodule dirt, got %+v", state)
	}
}

// A moved gitlink IS stageable, unlike submodule content. Collapsing the two
// (as porcelain v1 does) is what made the distinction invisible.
func TestWorkingSeparatesMovedGitlinkFromDirtyContent(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	sub := filepath.Join(root, "mod", "app")
	write(t, root, "mod/app/lib.txt", "v2\n")
	git(t, sub, "commit", "-qam", "v2")

	state, err := Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(state.GitlinkChanges, "mod/app") {
		t.Fatalf("expected mod/app recorded as a gitlink change, got %+v", state)
	}
	if contains(state.DirtySubmodules, "mod/app") {
		t.Fatalf("a committed submodule has no uncommitted content, got %+v", state)
	}
	if !state.Committable() {
		t.Fatal("a moved gitlink is stageable and must be committable")
	}
}

func TestWorkingClassifiesEmbeddedRepositoryAndOrdinaryDirt(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "README.md", "root\nchanged\n")
	write(t, root, "notes.txt", "new\n")
	nested := filepath.Join(root, "scratch")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, nested, "init", "-q", "-b", "main")
	write(t, root, "scratch/n.txt", "n\n")
	git(t, nested, "add", "-A")
	git(t, nested, "commit", "-qm", "nested")

	state, err := Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(state.EmbeddedRepositories, "scratch") {
		t.Fatalf("expected scratch classified as an embedded repository, got %+v", state)
	}
	if !contains(state.Stageable, "README.md") || !contains(state.Stageable, "notes.txt") {
		t.Fatalf("expected ordinary dirt to remain stageable, got %+v", state)
	}
	if contains(state.Stageable, "scratch") {
		t.Fatal("an embedded repository must never be offered as stageable: git add records it as a bare gitlink")
	}
}

func TestWorkingReportsUnmergedPaths(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "f.txt", "base\n")
	git(t, root, "checkout", "-q", "-b", "other")
	write(t, root, "f.txt", "other\n")
	git(t, root, "commit", "-qam", "other")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "f.txt", "mine\n")
	git(t, root, "commit", "-qam", "mine")
	if _, err := tryGit(root, "merge", "other"); err == nil {
		t.Fatal("expected the merge to conflict")
	}

	state, err := Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(state.Unmerged, "f.txt") {
		t.Fatalf("expected f.txt reported as unmerged, got %+v", state)
	}
}

// Paths with spaces must survive classification: porcelain v2's path field is
// the remainder of the record, not its last space-separated token.
func TestWorkingHandlesPathsWithSpaces(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "a file with spaces.txt", "content\n")

	state, err := Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(state.Stageable, "a file with spaces.txt") {
		t.Fatalf("expected the full path preserved, got %+v", state)
	}
}
