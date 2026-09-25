package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// parkedSession reproduces the incident: a Protected session parked in
// `failed` holding a verified candidate after a failure that was not the
// candidate's fault.
func parkedSession(t *testing.T, automation domain.AutomationMode, verification []domain.CommandSpec) (*Service, string, string, domain.PendingHostChange) {
	t.Helper()
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	host := gitRepo(t, "app.go", "package main\n")
	started, err := service.StartSessionWithModes(context.Background(), host, domain.ExecutionModeProtected, automation)
	if err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, host, "add", "-A")
	runGitForApp(t, host, "commit", "-qm", "chore: add project config")
	candidate := publishTestCandidate(t, host, "req_parked", "feature.txt", "feature\n")
	candidate.Plan.Verification = verification
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "failed"
		item.FailureKind = domain.FailureKindPlannerGuidanceRequired
		item.Plan = &candidate.Plan
		item.LastRequestID = candidate.Plan.RequestID
		item.PendingHostChanges = []domain.PendingHostChange{candidate}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return service, started.ID, host, candidate
}

func TestRecoverBlockedIntegrationsResumesAProvenCleanParkedSession(t *testing.T) {
	service, sessionID, host, _ := parkedSession(t, domain.AutomationModeAutoApprove, nil)
	if attempted := service.RecoverBlockedIntegrations(context.Background()); attempted != 1 {
		t.Fatalf("attempted = %d, want 1", attempted)
	}
	recovered, err := service.store.Get(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != "applied" || len(recovered.PendingHostChanges) != 0 {
		t.Fatalf("the parked candidate must be integrated: state=%q pending=%d", recovered.State, len(recovered.PendingHostChanges))
	}
	if _, statErr := os.Stat(filepath.Join(host, "feature.txt")); statErr != nil {
		t.Fatalf("candidate content missing on host: %v", statErr)
	}
}

func TestRecoverBlockedIntegrationsTriesEachHostStateOnce(t *testing.T) {
	gate := writeFailingGate(t, "--- FAIL: TestFeature\nFAIL\n", 1)
	verification := []domain.CommandSpec{{Argv: []string{gate}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}
	service, _, _, _ := parkedSession(t, domain.AutomationModeAutoApprove, verification)
	if attempted := service.RecoverBlockedIntegrations(context.Background()); attempted != 1 {
		t.Fatalf("first sweep attempted = %d, want 1", attempted)
	}
	if attempted := service.RecoverBlockedIntegrations(context.Background()); attempted != 0 {
		t.Fatalf("an Apply that failed again must not be retried on the same host state, attempted = %d", attempted)
	}
}

func TestRecoverBlockedIntegrationsLeavesManualAndConflictingSessionsAlone(t *testing.T) {
	manual, _, _, _ := parkedSession(t, domain.AutomationModeManual, nil)
	if attempted := manual.RecoverBlockedIntegrations(context.Background()); attempted != 0 {
		t.Fatalf("a manual session is the operator's to apply, attempted = %d", attempted)
	}

	service, sessionID, host, _ := parkedSession(t, domain.AutomationModeAutoApprove, nil)
	if err := os.WriteFile(filepath.Join(host, "feature.txt"), []byte("host\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, host, "add", "feature.txt")
	runGitForApp(t, host, "commit", "-qm", "feat: host feature")
	if attempted := service.RecoverBlockedIntegrations(context.Background()); attempted != 0 {
		t.Fatalf("a batch that still conflicts must stay parked, attempted = %d", attempted)
	}
	if item, _ := service.store.Get(sessionID); item.State != "failed" {
		t.Fatalf("state = %q, want failed", item.State)
	}
}
