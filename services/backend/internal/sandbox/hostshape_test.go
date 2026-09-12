package sandbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

// gitAllowFile runs git with permission to use a file:// submodule source,
// which Git denies by default since CVE-2022-39253.
func gitAllowFile(t *testing.T, dir string, args ...string) string {
	t.Helper()
	return mustGit(t, dir, append([]string{"-c", "protocol.file.allow=always"}, args...)...)
}

// newHostRepoWithSubmodule builds the shape that broke host integration: a
// superproject with one initialized submodule.
func newHostRepoWithSubmodule(t *testing.T, subPath string) string {
	t.Helper()
	origin := newTestHostRepo(t, "lib.txt", "v1\n")
	root := newTestHostRepo(t, "hello.txt", "before\n")
	gitAllowFile(t, root, "submodule", "add", "-q", "--", origin, subPath)
	mustGit(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "add submodule")
	return root
}

// End-to-end regression for the reported failure: an operator with uncommitted
// work inside a submodule could not apply anything, because the pre-merge
// snapshot's commit failed with "no changes added to commit" and aborted the
// merge. The condition was self-perpetuating, since no Wharnex operation ever
// cleaned a submodule worktree.
func TestMergeBranchOnHostSucceedsWithADirtySubmodule(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "mod/app")
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-sub", "feat: update hello.txt", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := PushBranchToHost(context.Background(), sandbox, host, "whx/req-sub"); err != nil {
		t.Fatal(err)
	}
	// The operator's own uncommitted work, living where no superproject commit
	// can reach it.
	if err := os.WriteFile(filepath.Join(host, "mod", "app", "lib.txt"), []byte("v1\noperator work\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	merge, err := MergeBranchOnHost(context.Background(), host, "whx/req-sub")
	if err != nil {
		t.Fatalf("a dirty submodule must not block host integration: %v", err)
	}
	if !contains(merge.Preservation.DirtySubmodules, "mod/app") {
		t.Fatalf("the uncapturable submodule must be reported, got %+v", merge.Preservation)
	}
	data, err := os.ReadFile(filepath.Join(host, "hello.txt"))
	if err != nil || string(data) != "after\n" {
		t.Fatalf("expected the merged change on host, got %q err=%v", data, err)
	}
	operatorWork, err := os.ReadFile(filepath.Join(host, "mod", "app", "lib.txt"))
	if err != nil || !strings.Contains(string(operatorWork), "operator work") {
		t.Fatalf("the operator's submodule work must be untouched, got %q err=%v", operatorWork, err)
	}
}

// A change that moves a dirty submodule's recorded commit is refused rather
// than merged over the operator's in-progress work.
func TestMergeBranchOnHostRefusesToMoveADirtySubmodulePointer(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "mod/app")
	sub := filepath.Join(host, "mod", "app")
	if err := os.WriteFile(filepath.Join(sub, "lib.txt"), []byte("v2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, sub, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qam", "v2")
	mustGit(t, host, "checkout", "-q", "-b", "whx/req-bump")
	mustGit(t, host, "add", "-A")
	mustGit(t, host, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "feat: bump submodule")
	mustGit(t, host, "checkout", "-q", "-")
	mustGit(t, host, "submodule", "update", "--no-fetch", "--checkout", "--", "mod/app")
	if err := os.WriteFile(filepath.Join(sub, "lib.txt"), []byte("v1\noperator work\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	headBefore := mustGit(t, host, "rev-parse", "HEAD")

	_, err := MergeBranchOnHost(context.Background(), host, "whx/req-bump")
	var blocked *hostrepo.BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("expected a *hostrepo.BlockedError, got %v", err)
	}
	if blocked.Reason != hostrepo.BlockedDirtySubmoduleGitlink {
		t.Fatalf("unexpected refusal reason %q", blocked.Reason)
	}
	if head := mustGit(t, host, "rev-parse", "HEAD"); head != headBefore {
		t.Fatal("a refused integration must not move the host's HEAD")
	}
	work, err := os.ReadFile(filepath.Join(sub, "lib.txt"))
	if err != nil || !strings.Contains(string(work), "operator work") {
		t.Fatalf("the operator's submodule work must survive the refusal, got %q err=%v", work, err)
	}
}

// A merge that legitimately moves a clean submodule's pointer must leave the
// submodule checked out at the commit the superproject now records; Git alone
// leaves it stale, which fails post-merge verification and permanently dirties
// the host.
func TestMergeBranchOnHostRealignsACleanSubmodule(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "mod/app")
	sub := filepath.Join(host, "mod", "app")
	if err := os.WriteFile(filepath.Join(sub, "lib.txt"), []byte("v2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, sub, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qam", "v2")
	expected := mustGit(t, sub, "rev-parse", "HEAD")
	mustGit(t, host, "checkout", "-q", "-b", "whx/req-bump")
	mustGit(t, host, "add", "-A")
	mustGit(t, host, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "feat: bump submodule")
	mustGit(t, host, "checkout", "-q", "-")
	mustGit(t, host, "submodule", "update", "--no-fetch", "--checkout", "--", "mod/app")

	merge, err := MergeBranchOnHost(context.Background(), host, "whx/req-bump")
	if err != nil {
		t.Fatal(err)
	}
	if !contains(merge.SubmoduleSync.Updated, "mod/app") {
		t.Fatalf("expected mod/app realigned by the merge, got %+v", merge.SubmoduleSync)
	}
	if actual := mustGit(t, sub, "rev-parse", "HEAD"); actual != expected {
		t.Fatalf("expected the submodule at %s, got %s", expected, actual)
	}
	if status := mustGit(t, host, "status", "--porcelain"); status != "" {
		t.Fatalf("expected a clean host after integration, got %q", status)
	}

	sync, err := RevertHostMerge(context.Background(), host, merge.PreMergeSHA)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(sync.Updated, "mod/app") {
		t.Fatalf("expected the revert to realign mod/app, got %+v", sync)
	}
	if status := mustGit(t, host, "status", "--porcelain"); status != "" {
		t.Fatalf("expected a clean host after revert, got %q", status)
	}
}

// The snapshot may itself commit a gitlink the operator moved. Realigning
// against the pre-snapshot reading would then check that submodule out to
// where it already is, detaching a branch the operator deliberately put it on.
// Only pointers the merge itself moves may be realigned.
func TestMergeBranchOnHostLeavesAnOperatorMovedSubmoduleOnItsBranch(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "mod/app")
	sub := filepath.Join(host, "mod", "app")
	// The change being integrated touches only the superproject.
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-plain", "feat: update hello.txt", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := PushBranchToHost(context.Background(), sandbox, host, "whx/req-plain"); err != nil {
		t.Fatal(err)
	}
	// The operator moved their submodule forward, on a branch, uncommitted in
	// the superproject.
	mustGit(t, sub, "checkout", "-q", "-b", "operator-work")
	if err := os.WriteFile(filepath.Join(sub, "lib.txt"), []byte("v2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, sub, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qam", "operator work")

	merge, err := MergeBranchOnHost(context.Background(), host, "whx/req-plain")
	if err != nil {
		t.Fatal(err)
	}
	if contains(merge.SubmoduleSync.Updated, "mod/app") {
		t.Fatalf("the merge did not move this pointer; it must not be realigned: %+v", merge.SubmoduleSync)
	}
	if branch := mustGit(t, sub, "rev-parse", "--abbrev-ref", "HEAD"); branch != "operator-work" {
		t.Fatalf("the operator's submodule branch must survive integration, got %q", branch)
	}
}

// A linked worktree's `.git` is a file, so creating the temporary index at
// <root>/.git failed with "not a directory" — silently disabling request-base
// rooting and the merge preflight on that whole class of repository.
func TestCaptureWorkingTreeCommitWorksInALinkedWorktree(t *testing.T) {
	requireGit(t)
	main := newTestHostRepo(t, "hello.txt", "before\n")
	linked := filepath.Join(t.TempDir(), "linked")
	mustGit(t, main, "worktree", "add", "-q", linked, "-b", "feature")
	if err := os.WriteFile(filepath.Join(linked, "hello.txt"), []byte("operator edit\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	commit, err := CaptureWorkingTreeCommit(context.Background(), linked, "Wharnex request base")
	if err != nil {
		t.Fatalf("request-base capture must work in a linked worktree: %v", err)
	}
	if commit == "" {
		t.Fatal("expected a real commit object")
	}
	if body := mustGit(t, linked, "show", commit+":hello.txt"); body != "operator edit" {
		t.Fatalf("the base must record the tree the model was shown, got %q", body)
	}
	if status := mustGit(t, linked, "status", "--porcelain"); !strings.Contains(status, "hello.txt") {
		t.Fatalf("capture must not disturb the operator's worktree, got %q", status)
	}
}

// The base tree must hold an embedded repository's files as absent rather than
// as an unresolvable gitlink, or a sandbox checked out at that base finds an
// empty directory where the model was shown content.
func TestCaptureWorkingTreeCommitExcludesEmbeddedRepositories(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	nested := filepath.Join(host, "scratch")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	mustGit(t, nested, "init", "-q")
	if err := os.WriteFile(filepath.Join(nested, "n.txt"), []byte("n\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, nested, "add", "-A")
	mustGit(t, nested, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "nested")

	commit, err := CaptureWorkingTreeCommit(context.Background(), host, "Wharnex request base")
	if err != nil {
		t.Fatal(err)
	}
	if tree := mustGit(t, host, "ls-tree", "-r", commit); strings.Contains(tree, "160000") {
		t.Fatalf("the request base must never record an embedded repository as a gitlink:\n%s", tree)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
