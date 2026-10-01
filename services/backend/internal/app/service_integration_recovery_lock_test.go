package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/selfevolution"
)

// lockParkedSession reproduces the 2026-09-29 Orchestrator stall: a verified
// candidate whose Apply was refused only by the self-evolution batch lock.
func lockParkedSession(t *testing.T) (*Service, string, string) {
	t.Helper()
	service, sessionID, host, _ := parkedSession(t, domain.AutomationModeAutoApprove, nil)
	// Never read the checkout's own self-evolution status from a test.
	service.selfEvolution = selfevolution.New(t.TempDir())
	if _, err := service.store.Update(sessionID, func(item *domain.Session) error {
		item.State = "verified"
		item.FailureKind = domain.FailureKindSelfEvolutionBusy
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return service, sessionID, host
}

func holdSelfEvolutionLock(t *testing.T, service *Service, phase string) {
	t.Helper()
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := "phase=" + phase + "\nsession_id=ses-held\nplan_id=plan-held\ntransaction=txn-held\nupdated_at=2026-09-29T10:02:44Z\n"
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	service.selfEvolution = selfevolution.New(root)
}

func TestRecoverBlockedIntegrationsResumesACandidateTheSelfEvolutionLockParked(t *testing.T) {
	service, sessionID, host := lockParkedSession(t)
	if attempted := service.RecoverBlockedIntegrations(context.Background()); attempted != 1 {
		t.Fatalf("attempted = %d, want 1", attempted)
	}
	recovered, err := service.store.Get(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != "applied" || len(recovered.PendingHostChanges) != 0 {
		t.Fatalf("the lock-parked candidate must be integrated: state=%q pending=%d", recovered.State, len(recovered.PendingHostChanges))
	}
	if _, statErr := os.Stat(filepath.Join(host, "feature.txt")); statErr != nil {
		t.Fatalf("candidate content missing on host: %v", statErr)
	}
}

func TestRecoverBlockedIntegrationsWaitsWhileAFailClosedTransactionHoldsTheLock(t *testing.T) {
	service, sessionID, _ := lockParkedSession(t)
	holdSelfEvolutionLock(t, service, "rollback_failed")
	if attempted := service.RecoverBlockedIntegrations(context.Background()); attempted != 0 {
		t.Fatalf("retrying against a fail-closed transaction only spends the attempt, attempted = %d", attempted)
	}
	if item, _ := service.store.Get(sessionID); item.State != "verified" || len(item.PendingHostChanges) != 1 {
		t.Fatalf("the candidate must stay parked intact: state=%q pending=%d", item.State, len(item.PendingHostChanges))
	}
}

func TestSelfEvolutionRetryGateKeysEachLockState(t *testing.T) {
	service, _, _ := lockParkedSession(t)
	holdSelfEvolutionLock(t, service, "restart_pending")
	first, open := service.selfEvolutionRetryGate()
	if !open || first == "" {
		t.Fatalf("an extendable pending batch is not a block: open=%v key=%q", open, first)
	}
	holdSelfEvolutionLock(t, service, "released")
	if second, _ := service.selfEvolutionRetryGate(); second == first {
		t.Fatal("a lock that moved to another state must be a new retry state")
	}
}
