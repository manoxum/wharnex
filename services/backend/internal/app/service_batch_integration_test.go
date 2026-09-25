package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// publishTestCandidate pushes a candidate branch into host that writes one
// file on top of the host's current HEAD.
func publishTestCandidate(t *testing.T, host, requestID, path, content string) domain.PendingHostChange {
	t.Helper()
	return publishTestCandidateFiles(t, host, requestID, map[string]string{path: content})
}

// publishTestCandidateFiles pushes one verified candidate commit writing every
// given file, recorded exactly as Protected verification records it.
func publishTestCandidateFiles(t *testing.T, host, requestID string, files map[string]string) domain.PendingHostChange {
	t.Helper()
	candidate := filepath.Join(t.TempDir(), "candidate")
	branch := "whx/" + requestID
	runGitForApp(t, filepath.Dir(candidate), "clone", "-q", "--local", host, candidate)
	runGitForApp(t, candidate, "checkout", "-qb", branch)
	operations := make([]domain.Operation, 0, len(files))
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(candidate, path), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		runGitForApp(t, candidate, "add", path)
		operations = append(operations, domain.Operation{Type: "apply_patch", Patch: "--- /dev/null\n+++ b/" + path + "\n@@ -0,0 +1 @@\n+" + strings.TrimSuffix(content, "\n") + "\n"})
	}
	runGitForApp(t, candidate, "commit", "-qm", "feat(app): candidate "+requestID)
	runGitForApp(t, candidate, "push", "-q", "--", host, branch+":refs/heads/"+branch)
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "plan_" + requestID, RequestID: requestID, Status: "ready",
		Summary: "Candidate " + requestID, CommitMessage: "feat(app): candidate " + requestID, Risk: "low",
		Operations: operations,
	}
	return domain.PendingHostChange{
		Plan: plan, IntegrationBranch: branch, VerifiedAt: time.Now().UTC(),
		IntegrationCommit: strings.TrimSpace(runGitForTest(t, host, "rev-parse", branch)),
		Execution:         domain.ExecutionResult{PlanID: plan.PlanID, Success: true, CompletedAt: time.Now().UTC()},
	}
}

// Apply is all-or-nothing across its batch. In production a batch of three
// merged the first two, stopped at a conflict on the third, and left the two
// merges on the host with no post-merge verification: the revert that should
// have undone them never ran, and its error was discarded.
func TestBatchConflictLeavesTheHostWithoutAnyCandidateOfTheBatch(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	host := gitRepo(t, "app.go", "package main\n")
	started, err := service.StartSessionWithModes(context.Background(), host, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, host, "add", "-A")
	runGitForApp(t, host, "commit", "-qm", "chore: add project config")

	clean := publishTestCandidate(t, host, "req_clean", "feature.txt", "feature\n")
	colliding := publishTestCandidate(t, host, "req_collide", "app.go", "package main\n// candidate\n")
	if err := os.WriteFile(filepath.Join(host, "app.go"), []byte("package main\n// host\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, host, "commit", "-qam", "fix(app): host edit")
	// The operator (or another agent) is mid-edit, as in production: the Apply
	// first preserves that work in a snapshot commit.
	if err := os.WriteFile(filepath.Join(host, "notes.md"), []byte("operator work in progress\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	before := strings.TrimSpace(runGitForTest(t, host, "rev-parse", "HEAD"))

	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.Plan = &colliding.Plan
		item.LastRequestID = colliding.Plan.RequestID
		item.PendingHostChanges = []domain.PendingHostChange{clean, colliding}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, applyErr := service.ApplyToHost(context.Background(), started.ID)
	if !errors.Is(applyErr, ErrIntegrationConflict) {
		t.Fatalf("expected an integration conflict, got %v", applyErr)
	}
	// The batch is simulated before its first merge, so nothing — not even the
	// pre-merge snapshot of the operator's work — reaches the host history.
	if after := strings.TrimSpace(runGitForTest(t, host, "rev-parse", "HEAD")); after != before {
		t.Fatalf("host HEAD moved from %s to %s although the batch could not integrate", before, after)
	}
	reported := false
	for _, event := range service.bus.History(started.ID) {
		if event.Type == "integration.batch_preflight_conflict" && event.Data["plan_id"] == colliding.Plan.PlanID {
			reported = true
		}
	}
	if !reported {
		t.Fatal("the batch conflict must be reported against the candidate that stops the batch")
	}
	if notes, readErr := os.ReadFile(filepath.Join(host, "notes.md")); readErr != nil || string(notes) != "operator work in progress\n" {
		t.Fatalf("operator work lost: %q %v", notes, readErr)
	}
	if _, statErr := os.Stat(filepath.Join(host, "feature.txt")); !os.IsNotExist(statErr) {
		t.Fatal("the clean candidate must not reach the host while its batch cannot integrate")
	}
}
