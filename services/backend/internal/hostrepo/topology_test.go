package hostrepo

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A linked worktree's `.git` is a FILE. Code that wrote into <root>/.git — the
// request-base capture and the merge preflight both did — failed with "not a
// directory", and because both treat capture as best effort, the failure was
// silent: base-rooted integration and the preflight were simply disabled on
// exactly the repository shapes that need them.
func TestInspectResolvesGitDirOfALinkedWorktree(t *testing.T) {
	requireGit(t)
	main := newRepo(t, "README.md", "root\n")
	linked := filepath.Join(t.TempDir(), "linked")
	git(t, main, "worktree", "add", "-q", linked, "-b", "feature")

	topology, err := Inspect(context.Background(), linked)
	if err != nil {
		t.Fatal(err)
	}
	if !topology.LinkedWorktree {
		t.Fatalf("expected a linked worktree, got %+v", topology)
	}
	if info, statErr := os.Stat(topology.GitDir); statErr != nil || !info.IsDir() {
		t.Fatalf("GitDir must resolve to a real directory, got %q (%v)", topology.GitDir, statErr)
	}
	if topology.GitDir == filepath.Join(linked, ".git") {
		t.Fatal("a linked worktree's .git is a file; GitDir must be the directory it points at")
	}
	if !topology.HeadBorn || topology.Branch != "feature" {
		t.Fatalf("expected a born HEAD on 'feature', got %+v", topology)
	}
}

func TestInspectListsSubmodulesFromTheIndex(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")

	topology, err := Inspect(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(topology.Submodules) != 1 {
		t.Fatalf("expected exactly one submodule, got %+v", topology.Submodules)
	}
	submodule := topology.Submodules[0]
	if submodule.Path != "mod/app" || submodule.CommitSHA == "" {
		t.Fatalf("unexpected submodule record %+v", submodule)
	}
	if !submodule.Registered || !submodule.Initialized {
		t.Fatalf("expected a registered, initialized submodule, got %+v", submodule)
	}
}

// The question that matters at ingestion is not "is this path a submodule" but
// "does this path live inside one", because that is what `git add` refuses.
func TestSubmoduleForMatchesPathsInsideASubmodule(t *testing.T) {
	topology := Topology{Submodules: []Submodule{{Path: "mod/app"}}}
	for _, inside := range []string{"mod/app", "mod/app/src/main.go", "./mod/app/README.md"} {
		if _, found := topology.SubmoduleFor(inside); !found {
			t.Fatalf("expected %q recognised as inside mod/app", inside)
		}
	}
	for _, outside := range []string{"mod/apple/x.go", "mod", "other/mod/app/x.go"} {
		if _, found := topology.SubmoduleFor(outside); found {
			t.Fatalf("expected %q treated as outside mod/app", outside)
		}
	}
}

func TestInspectReportsUnbornHead(t *testing.T) {
	requireGit(t)
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")

	topology, err := Inspect(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if topology.HeadBorn {
		t.Fatal("a repository with no commit has no born HEAD")
	}
}

func TestInspectDetectsAnInProgressMerge(t *testing.T) {
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

	topology, err := Inspect(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if topology.InProgress != OperationMerge {
		t.Fatalf("expected an in-progress merge, got %q", topology.InProgress)
	}
}
