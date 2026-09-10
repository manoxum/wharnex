package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/gitsettings"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/pendingcommit"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func gitSurfaceService(t *testing.T) (*Service, string) {
	t.Helper()
	state := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.SetGitSurface(filepath.Join(state, "git-settings.json"), pendingcommit.NewStore(filepath.Join(state, "git-pending-commits.json")))
	return service, state
}

func gitRepo(t *testing.T, fileName, content string) string {
	t.Helper()
	root := t.TempDir()
	runGitForApp(t, root, "init", "-q", "-b", "main")
	// Service-level Git operations run outside runGitForApp, so persist the
	// operator identity in this fixture instead of relying on command-scoped -c.
	runGitForApp(t, root, "config", "user.name", "Tester")
	runGitForApp(t, root, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(root, fileName), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "initial")
	return root
}

func headOf(t *testing.T, root string) string {
	t.Helper()
	cmd := exec.Command("git", "-C", root, "rev-parse", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(output))
}

func TestCommitModeDefaultsToAutoAndRoundTrips(t *testing.T) {
	service, _ := gitSurfaceService(t)
	if mode := service.GitCommitMode("/w/alpha"); mode != gitsettings.CommitModeAuto {
		t.Fatalf("expected auto by default, got %q", mode)
	}
	if _, err := service.SetGitCommitMode("/w/alpha", gitsettings.CommitModeManual); err != nil {
		t.Fatal(err)
	}
	if mode := service.GitCommitMode("/w/alpha"); mode != gitsettings.CommitModeManual {
		t.Fatalf("expected manual after the toggle, got %q", mode)
	}
	if _, err := service.SetGitCommitMode("/w/alpha", "sometimes"); err == nil {
		t.Fatal("an unsupported mode must be refused")
	}
}

// Manual mode's whole contract: the change stays on disk, the history returns
// to where the operator left it, and the planner-authored commit message — the
// part they cannot reconstruct — is preserved.
func TestRecordAndUnwindLeavesTheChangeUncommittedWithItsMessage(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "app.go", "package main\n")
	original := headOf(t, root)

	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\n\nfunc main() {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "feat(app): add entry point\n\nWhy it matters.\n\nRequest-Id: req_1\nPlan-Id: plan_1")
	applied := headOf(t, root)

	integrated := []integratedCandidate{{
		planID: "plan_1", requestID: "req_1", sessionID: "ses_1", branch: "whx/req_1",
		beforeSHA: original, afterSHA: applied,
		message: "feat(app): add entry point\n\nWhy it matters.\n\nRequest-Id: req_1\nPlan-Id: plan_1",
		paths:   []string{"app.go"},
	}}
	if err := service.recordAndUnwindIntegration(context.Background(), "ses_1", root, integrated, original); err != nil {
		t.Fatal(err)
	}

	if head := headOf(t, root); head != original {
		t.Fatalf("expected the history returned to %s, got %s", original, head)
	}
	body, err := os.ReadFile(filepath.Join(root, "app.go"))
	if err != nil || !strings.Contains(string(body), "func main()") {
		t.Fatalf("the applied change must stay in the working tree, got %q err=%v", body, err)
	}
	records, err := service.pendingCommits.List(root)
	if err != nil || len(records) != 1 {
		t.Fatalf("expected one pending record, got %+v err=%v", records, err)
	}
	if records[0].Subject != "feat(app): add entry point" {
		t.Fatalf("the planner's own subject must survive, got %q", records[0].Subject)
	}
	if !strings.Contains(records[0].Message, "Request-Id: req_1") {
		t.Fatal("the trailers must survive so the commit is traceable")
	}
	if !strings.Contains(records[0].Diff, "func main()") {
		t.Fatalf("the record must carry the change's own diff, got %q", records[0].Diff)
	}
}

func TestCommitPendingCommitsWithTheRecordedMessage(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "app.go", "package main\n")
	sessionID := startGitSession(t, service, root)

	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\n// changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.pendingCommits.Append(pendingcommit.Record{
		ID: "pending_1", ProjectPath: root, Message: "feat(app): change it\n\nRequest-Id: req_1", Paths: []string{"app.go"},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := service.CommitPending(context.Background(), sessionID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Outcomes) != 1 || result.Outcomes[0].CommitSHA == "" {
		t.Fatalf("expected one commit, got %+v", result)
	}
	commits, err := hostrepo.Log(context.Background(), root, 5)
	if err != nil {
		t.Fatal(err)
	}
	if commits[0].Subject != "feat(app): change it" || commits[0].RequestID != "req_1" {
		t.Fatalf("the commit must carry the recorded message and trailers, got %+v", commits[0])
	}
	// A committed record is retired; leaving it would offer the same commit twice.
	remaining, _ := service.pendingCommits.List(root)
	if len(remaining) != 0 {
		t.Fatalf("expected the queue drained, got %+v", remaining)
	}
}

// Committing a later record alone would take the file's current content, which
// already contains the earlier change, and label it with the wrong message.
func TestCommitPendingRefusesASelectionThatWouldAbsorbAnEarlierChange(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "app.go", "package main\n")
	sessionID := startGitSession(t, service, root)

	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\n// first\n// second\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct{ id, message string }{
		{"pending_1", "feat(app): first change"},
		{"pending_2", "feat(app): second change"},
	} {
		if err := service.pendingCommits.Append(pendingcommit.Record{
			ID: entry.id, ProjectPath: root, Message: entry.message, Paths: []string{"app.go"},
		}); err != nil {
			t.Fatal(err)
		}
	}

	result, err := service.CommitPending(context.Background(), sessionID, []string{"pending_2"})
	if !errors.Is(err, ErrPendingCommitBlocked) {
		t.Fatalf("expected ErrPendingCommitBlocked, got %v", err)
	}
	if len(result.Blocked) != 1 || result.Blocked[0] != "pending_1" {
		t.Fatalf("the refusal must name what to include, got %+v", result.Blocked)
	}
	if commits, _ := hostrepo.Log(context.Background(), root, 5); len(commits) != 1 {
		t.Fatal("a blocked selection must commit nothing at all")
	}
	// Including the predecessor makes the same selection valid.
	if _, err := service.CommitPending(context.Background(), sessionID, []string{"pending_1", "pending_2"}); err != nil {
		t.Fatalf("including the predecessor must be accepted: %v", err)
	}
}

// A record whose files the operator already dealt with themselves describes
// nothing; it is retired rather than left as a permanent phantom entry.
func TestCommitPendingRetiresAStaleRecord(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "app.go", "package main\n")
	sessionID := startGitSession(t, service, root)
	if err := service.pendingCommits.Append(pendingcommit.Record{
		ID: "pending_1", ProjectPath: root, Message: "feat(app): already handled", Paths: []string{"app.go"},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := service.CommitPending(context.Background(), sessionID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Outcomes) != 1 || result.Outcomes[0].Skipped == "" {
		t.Fatalf("expected the record skipped as stale, got %+v", result)
	}
	if remaining, _ := service.pendingCommits.List(root); len(remaining) != 0 {
		t.Fatalf("a stale record must be retired, got %+v", remaining)
	}
}

// Discarding drops Wharnex's note about a change, never the change itself.
func TestDiscardPendingLeavesTheWorkingTreeUntouched(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "app.go", "package main\n")
	sessionID := startGitSession(t, service, root)
	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\n// edited\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.pendingCommits.Append(pendingcommit.Record{
		ID: "pending_1", ProjectPath: root, Message: "feat(app): edited", Paths: []string{"app.go"},
	}); err != nil {
		t.Fatal(err)
	}

	removed, err := service.DiscardPending(sessionID, []string{"pending_1"})
	if err != nil || removed != 1 {
		t.Fatalf("expected one record removed, got %d err=%v", removed, err)
	}
	body, err := os.ReadFile(filepath.Join(root, "app.go"))
	if err != nil || !strings.Contains(string(body), "// edited") {
		t.Fatalf("discarding a record must never touch the files, got %q err=%v", body, err)
	}
}

func TestGitOverviewReportsBranchesPendingAndWorkingState(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "app.go", "package main\n")
	sessionID := startGitSession(t, service, root)
	// Opening a session materializes whaness.yml; commit it so the assertion
	// below is about the change this test makes, not about bootstrap files.
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "chore: project config")
	runGitForApp(t, root, "checkout", "-q", "-b", "feature")
	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\n// dirty\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.pendingCommits.Append(pendingcommit.Record{
		ID: "pending_1", ProjectPath: root, Message: "feat(app): dirty", Paths: []string{"app.go"},
		Diff: "a very large diff body",
	}); err != nil {
		t.Fatal(err)
	}

	overview, err := service.GitOverview(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if !overview.Available || overview.CurrentBranch != "feature" {
		t.Fatalf("expected the current branch reported, got %+v", overview)
	}
	if overview.Working.Clean || overview.Working.StageableCount != 1 {
		t.Fatalf("expected one uncommitted path, got %+v", overview.Working)
	}
	if len(overview.Pending) != 1 || overview.Pending[0].Subject != "feat(app): dirty" {
		t.Fatalf("expected the pending record listed, got %+v", overview.Pending)
	}
	// The list must stay small: a diff is up to 256 KB and is fetched per record.
	if overview.Pending[0].Diff != "" {
		t.Fatal("the overview must not carry diffs; they are fetched per record")
	}
	full, err := service.PendingCommitDiff(sessionID, "pending_1")
	if err != nil || full.Diff == "" {
		t.Fatalf("the per-record endpoint must return the diff, got %+v err=%v", full, err)
	}
}

func startGitSession(t *testing.T, service *Service, root string) string {
	t.Helper()
	item, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	return item.ID
}
