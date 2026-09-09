package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// CommitDiff exists so a verification sandbox with no shared ancestry can
// still replay a pending candidate. This asserts the diff it produces is a
// plain unified diff of that commit alone.
func TestCommitDiffReturnsUnifiedDiffOfOneCommit(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	if err := os.WriteFile(filepath.Join(host, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", "hello.txt")
	mustGit(t, host, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "second")
	head := mustGit(t, host, "rev-parse", "HEAD")

	patch, err := CommitDiff(context.Background(), host, head)
	if err != nil {
		t.Fatalf("CommitDiff: %v", err)
	}
	if !strings.Contains(patch, "diff --git a/hello.txt b/hello.txt") {
		t.Fatalf("expected a unified diff header, got:\n%s", patch)
	}
	if !strings.Contains(patch, "-before") || !strings.Contains(patch, "+after") {
		t.Fatalf("expected the commit's own change, got:\n%s", patch)
	}
	if strings.Contains(patch, "second") {
		t.Fatalf("the commit message must not be part of the patch body, got:\n%s", patch)
	}
}

// A root commit has no parent; a candidate committed into a freshly created
// repository must still replay rather than erroring.
func TestCommitDiffHandlesRootCommit(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "only\n")
	head := mustGit(t, host, "rev-parse", "HEAD")
	patch, err := CommitDiff(context.Background(), host, head)
	if err != nil {
		t.Fatalf("CommitDiff on a root commit: %v", err)
	}
	if !strings.Contains(patch, "+only") {
		t.Fatalf("expected the root commit's content, got:\n%s", patch)
	}
}

func TestHasCommitDistinguishesPresentAndAbsent(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "x\n")
	head := mustGit(t, host, "rev-parse", "HEAD")
	if !HasCommit(context.Background(), host, head) {
		t.Fatal("HEAD must be reported as present")
	}
	if HasCommit(context.Background(), host, "0123456789012345678901234567890123456789") {
		t.Fatal("an unknown sha must be reported as absent")
	}
	if HasCommit(context.Background(), host, "") {
		t.Fatal("an empty sha must be reported as absent")
	}
}

// The failure this whole path exists for: a workspace with a synthetic root
// commit cannot merge a host branch. Proving git really refuses keeps the
// downgrade in replayPendingChangeSets honest.
func TestMergeRefusesUnrelatedHistories(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "host\n")
	branch := "whx/req_test"
	if err := os.WriteFile(filepath.Join(host, "hello.txt"), []byte("candidate\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "checkout", "-q", "-b", branch)
	mustGit(t, host, "add", "hello.txt")
	mustGit(t, host, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "candidate")

	// A workspace rebuilt from an archived request base: independent history.
	synthetic := t.TempDir()
	if err := os.WriteFile(filepath.Join(synthetic, "hello.txt"), []byte("host\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := initializeWorkspaceGit(synthetic); err != nil {
		t.Fatal(err)
	}
	if err := FetchBranchFromHost(context.Background(), synthetic, host, branch); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	_, mergeErr := MergeBranchOnHost(context.Background(), synthetic, branch)
	if mergeErr == nil {
		t.Fatal("merging unrelated histories must fail; the commit-diff replay path depends on it")
	}
	if !strings.Contains(mergeErr.Error(), "unrelated histories") {
		t.Fatalf("expected git's unrelated-histories refusal, got %v", mergeErr)
	}
}
