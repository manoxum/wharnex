package hostrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The regression this whole package exists for: a host whose only uncommitted
// state is submodule content used to fail the pre-merge snapshot with
// "no changes added to commit", aborting Apply. Because `git reset --hard`
// never cleans a submodule worktree either, the condition persisted and every
// subsequent Apply failed identically.
func TestPreserveSucceedsWhenOnlySubmoduleContentIsDirty(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	write(t, root, "mod/app/lib.txt", "v1\nlocal edit\n")
	headBefore := git(t, root, "rev-parse", "HEAD")

	preservation, err := Preserve(context.Background(), root, "snapshot")
	if err != nil {
		t.Fatalf("a dirty submodule must not block integration: %v", err)
	}
	if preservation.Committed {
		t.Fatal("there was nothing a superproject commit could capture")
	}
	if !contains(preservation.DirtySubmodules, "mod/app") {
		t.Fatalf("the operator must be told their submodule work is outside the snapshot, got %+v", preservation)
	}
	if head := git(t, root, "rev-parse", "HEAD"); head != headBefore {
		t.Fatal("nothing was committable, so HEAD must not have moved")
	}
	if body := readFile(t, root, "mod/app/lib.txt"); !strings.Contains(body, "local edit") {
		t.Fatalf("the operator's submodule work must be untouched, got %q", body)
	}
}

func TestPreserveCommitsOrdinaryDirtAlongsideADirtySubmodule(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	write(t, root, "mod/app/lib.txt", "v1\nlocal edit\n")
	write(t, root, "README.md", "root\nchanged\n")

	preservation, err := Preserve(context.Background(), root, "snapshot")
	if err != nil {
		t.Fatal(err)
	}
	if !preservation.Committed || preservation.CommitSHA == "" {
		t.Fatalf("stageable dirt must still be captured, got %+v", preservation)
	}
	if !contains(preservation.DirtySubmodules, "mod/app") {
		t.Fatalf("expected the uncapturable submodule reported, got %+v", preservation)
	}
	if body := git(t, root, "show", "--format=", "--name-only", "HEAD"); !strings.Contains(body, "README.md") {
		t.Fatalf("expected README.md in the snapshot commit, got %q", body)
	}
}

// `git add -A` records an untracked nested repository as a bare gitlink: the
// snapshot would claim to preserve the operator's files while holding only a
// pointer the superproject cannot resolve, so the revert that is supposed to
// restore them could not.
func TestPreserveExcludesEmbeddedRepositoriesInsteadOfRecordingAGitlink(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "README.md", "root\nchanged\n")
	nested := filepath.Join(root, "scratch")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, nested, "init", "-q", "-b", "main")
	write(t, root, "scratch/n.txt", "n\n")
	git(t, nested, "add", "-A")
	git(t, nested, "commit", "-qm", "nested")

	preservation, err := Preserve(context.Background(), root, "snapshot")
	if err != nil {
		t.Fatal(err)
	}
	if !contains(preservation.LeftInPlace, "scratch") {
		t.Fatalf("expected scratch reported as left in place, got %+v", preservation)
	}
	if entries := git(t, root, "ls-files", "--stage"); strings.Contains(entries, "160000") {
		t.Fatalf("the snapshot must never record an embedded repository as a gitlink:\n%s", entries)
	}
	if body := readFile(t, root, "scratch/n.txt"); body != "n\n" {
		t.Fatalf("the embedded repository's files must be untouched, got %q", body)
	}
}

// Staging and committing a repository mid-merge writes the operator's own
// conflict markers into their project history as though they were resolved.
func TestPreserveRefusesUnmergedPaths(t *testing.T) {
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
	headBefore := git(t, root, "rev-parse", "HEAD")

	_, err := Preserve(context.Background(), root, "snapshot")
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected a *BlockedError, got %v", err)
	}
	// The unfinished merge is detected first; either classification is a
	// refusal, and both name the same operator action.
	if blocked.Reason != BlockedUnmergedPaths && blocked.Reason != BlockedOperationInProgress {
		t.Fatalf("unexpected reason %q", blocked.Reason)
	}
	if blocked.Remedy == "" {
		t.Fatal("a refusal must name the action that clears it")
	}
	if head := git(t, root, "rev-parse", "HEAD"); head != headBefore {
		t.Fatal("a refused host state must not be mutated")
	}
	if body := readFile(t, root, "f.txt"); !strings.Contains(body, "<<<<<<<") {
		t.Fatalf("the operator's conflict must be left exactly as it was, got %q", body)
	}
}

func TestPreserveRefusesRebaseInProgress(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "f.txt", "base\n")
	git(t, root, "checkout", "-q", "-b", "topic")
	write(t, root, "f.txt", "topic\n")
	git(t, root, "commit", "-qam", "topic")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "f.txt", "main\n")
	git(t, root, "commit", "-qam", "main")
	git(t, root, "checkout", "-q", "topic")
	if _, err := tryGit(root, "rebase", "main"); err == nil {
		t.Fatal("expected the rebase to stop on a conflict")
	}

	_, err := Preserve(context.Background(), root, "snapshot")
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected a *BlockedError, got %v", err)
	}
	if blocked.Reason != BlockedOperationInProgress {
		t.Fatalf("expected an in-progress operation, got %q", blocked.Reason)
	}
}

// The snapshot is Wharnex's internal bookkeeping, not the operator's
// contribution, so a project's own commit hooks have no authority over it —
// and a failing pre-commit hook must not block every host integration.
func TestPreserveIsNotBlockedByProjectCommitHooks(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	hook := filepath.Join(root, ".git", "hooks", "pre-commit")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\necho refused >&2\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, root, "README.md", "root\nchanged\n")

	preservation, err := Preserve(context.Background(), root, "snapshot")
	if err != nil {
		t.Fatalf("a project hook must not block Wharnex's own snapshot: %v", err)
	}
	if !preservation.Committed {
		t.Fatal("expected the stageable change to be captured")
	}
}

func readFile(t *testing.T, root, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// A locked index is a host condition the operator clears, not a defect in the
// generated change. Left unclassified it fell through to the generic error
// path, which spends an automatic AI repair round on a question no patch can
// answer and then reproduces the same failure on the next Apply.
func TestPreserveRefusesALockedIndexAsATypedHostBlock(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "a.txt", "a\n")
	write(t, root, "a.txt", "dirty\n")
	lock := filepath.Join(root, ".git", "index.lock")
	if err := os.WriteFile(lock, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := Preserve(context.Background(), root, "snapshot")
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected a typed host block, got %v", err)
	}
	if blocked.Reason != BlockedIndexLocked {
		t.Fatalf("unexpected reason %q", blocked.Reason)
	}
	if len(blocked.Paths) != 1 || blocked.Paths[0] != lock {
		t.Fatalf("the refusal must name the lock file, got %v", blocked.Paths)
	}
	if blocked.Remedy == "" {
		t.Fatal("the refusal must carry the operator action that clears it")
	}
}

// The lock's age is what decides the operator's action: seconds old means a
// live Git process and the answer is to wait; hours old means a crash leftover
// and the answer is to delete it. Git's own message cannot tell them apart.
func TestIndexLockBlockedDistinguishesLiveContentionFromACrashLeftover(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "a.txt", "a\n")
	lock := filepath.Join(root, ".git", "index.lock")
	if err := os.WriteFile(lock, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	output := "fatal: Unable to create '" + lock + "': File exists."

	fresh := IndexLockBlocked(context.Background(), root, output)
	if fresh == nil || strings.Contains(fresh.Remedy, "remove") {
		t.Fatalf("a fresh lock must be reported as live contention, got %+v", fresh)
	}

	stale := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(lock, stale, stale); err != nil {
		t.Fatal(err)
	}
	old := IndexLockBlocked(context.Background(), root, output)
	if old == nil || !strings.Contains(old.Remedy, "remove") || !strings.Contains(old.Detail, "crashed") {
		t.Fatalf("a long-held lock must be reported as a probable crash leftover, got %+v", old)
	}

	if other := IndexLockBlocked(context.Background(), root, "fatal: not a git repository"); other != nil {
		t.Fatalf("an unrelated failure must not be classified as a lock, got %+v", other)
	}
}
