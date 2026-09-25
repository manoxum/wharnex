package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

const releaseTestLines = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n"

// dissolvedConflictFixture reproduces the incident: an operator file exists
// only as uncommitted work, a candidate rooted at the request base edits one
// line of it, and the operator then edits another line. Merged from the bare
// HEAD this was an add/add conflict; from the request base it is clean.
func dissolvedConflictFixture(t *testing.T, operatorLine string) (domain.Session, []domain.PendingHostChange) {
	t.Helper()
	requireGitBinary(t)
	host := t.TempDir()
	runGitForTest(t, host, "init", "-q")
	writeReleaseFile(t, host, "a.txt", "committed\n")
	runGitForTest(t, host, "add", "a.txt")
	runGitForTest(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "initial")
	writeReleaseFile(t, host, "wip.go", releaseTestLines)
	base, err := sandbox.CaptureRequestBase(context.Background(), host, "req_candidate")
	if err != nil {
		t.Fatal(err)
	}
	branch := "whx/req_candidate"
	runGitForTest(t, host, "branch", branch, base)
	worktree := filepath.Join(t.TempDir(), "candidate")
	runGitForTest(t, host, "worktree", "add", "-q", worktree, branch)
	writeReleaseFile(t, worktree, "wip.go", strings.Replace(releaseTestLines, "l2\n", "candidate\n", 1))
	runGitForTest(t, worktree, "-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost", "commit", "-qam", "fix: candidate edit")
	runGitForTest(t, host, "worktree", "remove", "--force", worktree)
	writeReleaseFile(t, host, "wip.go", strings.Replace(releaseTestLines, operatorLine+"\n", "operator\n", 1))

	item := domain.Session{
		ProjectPath:         host,
		State:               "failed",
		LastRequestID:       "req_resolution",
		IntegrationConflict: &domain.ConflictResolution{ID: "conflict-1", RequestID: "req_resolution", Paths: []string{"wip.go"}},
	}
	pending := []domain.PendingHostChange{{Plan: domain.ExecutionPlan{PlanID: "plan-1", RequestID: "req_candidate"}, IntegrationBranch: branch}}
	return item, pending
}

func writeReleaseFile(t *testing.T, root, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

// The chat that motivated this stayed parked after its false conflict could no
// longer occur: its round had arrived, so the orphan rule kept the record, and
// the record refused every Apply.
func TestIntegrationConflictDissolvedWhenEveryCandidateNowMergesCleanly(t *testing.T) {
	item, pending := dissolvedConflictFixture(t, "l9")
	service := &Service{}
	if orphanedIntegrationConflict(item) {
		t.Fatal("fixture must not be an orphan: its own round is the session's current one")
	}
	if !service.integrationConflictDissolved(context.Background(), item, pending) {
		t.Fatal("a conflict the live host no longer reproduces must be released")
	}
}

func TestIntegrationConflictKeptWhenItStillHoldsOrCannotBeProven(t *testing.T) {
	ctx := context.Background()
	service := &Service{}

	collision, pending := dissolvedConflictFixture(t, "l2")
	if service.integrationConflictDissolved(ctx, collision, pending) {
		t.Fatal("a genuine collision on the same line must keep its record")
	}

	item, pending := dissolvedConflictFixture(t, "l9")
	manual := item
	manual.IntegrationConflict = &domain.ConflictResolution{ID: "conflict-1", RequestID: "req_resolution", Paths: []string{"wip.go"}, ManualPaths: []string{"wip.go"}}
	if service.integrationConflictDissolved(ctx, manual, pending) {
		t.Fatal("an operator's manual resolution must never be discarded")
	}
	resolving := item
	resolving.State = "conflict_resolution_pending"
	if service.integrationConflictDissolved(ctx, resolving, pending) {
		t.Fatal("a conflict whose round is still being worked on is live")
	}
	legacy := []domain.PendingHostChange{{Plan: domain.ExecutionPlan{PlanID: "plan-legacy"}}}
	if service.integrationConflictDissolved(ctx, item, legacy) {
		t.Fatal("a candidate without an integration branch cannot be proven clean")
	}
}
