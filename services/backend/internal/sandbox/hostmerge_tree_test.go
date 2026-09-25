package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const tenLines = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n"

func writeTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readTestFile(t *testing.T, root, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// verifyBaseRootedCandidate mirrors Protected execution: capture the host's
// request base (HEAD plus the operator's uncommitted work), apply the plan's
// edit to exactly that tree in a sandbox, and publish the verified branch.
func verifyBaseRootedCandidate(t *testing.T, host, requestID, path, content string) (branch, base string) {
	t.Helper()
	ctx := context.Background()
	base, err := CaptureRequestBase(ctx, host, requestID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := cloneSandbox(t, host)
	branch = "whx/" + requestID
	if err := FetchRefFromHost(ctx, workspace, host, RequestBaseRef(requestID)); err != nil {
		t.Fatal(err)
	}
	if err := CheckoutRequestBase(ctx, workspace, branch, base); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, workspace, path, content)
	if _, err := CommitBaseRootedPatch(ctx, workspace, "fix: candidate edit", []string{path}); err != nil {
		t.Fatal(err)
	}
	if err := PushBranchToHost(ctx, workspace, host, branch); err != nil {
		t.Fatal(err)
	}
	return branch, base
}

// The operator creates an untracked file, the candidate edits it, and the
// operator keeps editing a different part of it before Apply. Merged from the
// bare HEAD (which lacks the file) this was an add/add conflict on work that
// never diverged; merged from the request base both edits simply combine.
func TestMergeBranchOnHostCombinesCandidateWithEvolvingOperatorWork(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	writeTestFile(t, host, "wip.go", tenLines)
	branch, base := verifyBaseRootedCandidate(t, host, "req_evolving", "wip.go", strings.Replace(tenLines, "l2\n", "candidate\n", 1))
	writeTestFile(t, host, "wip.go", strings.Replace(tenLines, "l9\n", "operator\n", 1))

	if got := CandidateMergeBase(context.Background(), host, branch); got != base {
		t.Fatalf("candidate merge base = %q, want request base %q", got, base)
	}
	if _, err := MergeBranchOnHost(context.Background(), host, branch); err != nil {
		t.Fatalf("expected a clean merge, got %v", err)
	}
	want := strings.Replace(strings.Replace(tenLines, "l2\n", "candidate\n", 1), "l9\n", "operator\n", 1)
	if got := readTestFile(t, host, "wip.go"); got != want {
		t.Fatalf("wip.go = %q, want %q", got, want)
	}
	if status := mustGit(t, host, "status", "--porcelain"); status != "" {
		t.Fatalf("host must be clean after integration, got %q", status)
	}
	if parents := strings.Fields(mustGit(t, host, "log", "-1", "--format=%P")); len(parents) != 2 {
		t.Fatalf("integration must be a two-parent merge commit, got parents %v", parents)
	}
}

// An edit the operator had uncommitted when the request was taken, and then
// discarded, must stay discarded. Merged from the bare HEAD the candidate
// side appeared to have made that edit, and the merge silently restored it.
func TestMergeBranchOnHostDoesNotResurrectDiscardedOperatorEdit(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	writeTestFile(t, host, "a.txt", "operator experiment\n")
	branch, _ := verifyBaseRootedCandidate(t, host, "req_discard", "b.txt", "candidate\n")
	mustGit(t, host, "checkout", "--", "a.txt")

	if _, err := MergeBranchOnHost(context.Background(), host, branch); err != nil {
		t.Fatalf("expected a clean merge, got %v", err)
	}
	if got := readTestFile(t, host, "a.txt"); got != "committed\n" {
		t.Fatalf("discarded operator edit was resurrected: a.txt = %q", got)
	}
	if got := readTestFile(t, host, "b.txt"); got != "candidate\n" {
		t.Fatalf("candidate change missing: b.txt = %q", got)
	}
}

// A genuine collision is still a conflict. It is reported against the request
// base, so the capsule's BASE side is what both sides really started from,
// and the checkout is never left mid-merge.
func TestMergeBranchOnHostReportsRealConflictAgainstRequestBase(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	writeTestFile(t, host, "wip.go", tenLines)
	branch, base := verifyBaseRootedCandidate(t, host, "req_collide", "wip.go", strings.Replace(tenLines, "l5\n", "candidate\n", 1))
	operator := strings.Replace(tenLines, "l5\n", "operator\n", 1)
	writeTestFile(t, host, "wip.go", operator)

	_, err := MergeBranchOnHost(context.Background(), host, branch)
	var conflict *MergeConflictError
	if !isMergeConflictError(err, &conflict) {
		t.Fatalf("expected *MergeConflictError, got %v", err)
	}
	if conflict.MergeBaseSHA != base || len(conflict.Paths) != 1 || conflict.Paths[0] != "wip.go" {
		t.Fatalf("unexpected conflict %+v (request base %s)", conflict, base)
	}
	if _, err := os.Stat(filepath.Join(host, ".git", "MERGE_HEAD")); !os.IsNotExist(err) {
		t.Fatal("a conflicting integration must not leave the checkout mid-merge")
	}
	if got := readTestFile(t, host, "wip.go"); got != operator {
		t.Fatalf("operator work changed by a failed integration: %q", got)
	}
}

func TestCandidateMergeBaseIsEmptyForCandidateWithoutRequestBase(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	workspace := cloneSandbox(t, host)
	writeTestFile(t, workspace, "a.txt", "changed\n")
	sha, err := CommitVerifiedPatch(context.Background(), workspace, "whx/legacy", "fix: legacy candidate", []string{"a.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if got := CandidateMergeBase(context.Background(), workspace, sha); got != "" {
		t.Fatalf("expected no request base for a legacy candidate, got %q", got)
	}
}
