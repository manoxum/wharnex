package selfevolution

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeActivationStatus(t *testing.T, root, phase string, updated time.Time) string {
	t.Helper()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	body := "phase=" + phase + "\nsession_id=ses_1\nplan_id=plan_1\ntransaction=txn-held\nupdated_at=" + updated.UTC().Format(time.RFC3339) + "\ndetail=activating\n"
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, lock := range []string{"active.lock", "stage.lock"} {
		if err := os.WriteFile(filepath.Join(base, lock), []byte("run_id=old\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return base
}

// The 2026-09-25 incident: the supervisor died in "restarting" and every later
// Apply was refused for hours with nothing to retry.
func TestAbandonedActivationBecomesRetryableRestartFailed(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 9, 25, 16, 0, 0, 0, time.UTC)
	base := writeActivationStatus(t, root, "restarting", now.Add(-5*time.Hour))
	manager := New(root)

	status, changed, err := manager.ReconcileAbandonedActivation(now, func(string) (bool, bool) { return false, true })
	if err != nil || !changed {
		t.Fatalf("abandoned activation was not reconciled: changed=%v err=%v", changed, err)
	}
	if status.Phase != "restart_failed" || status.Transaction != "txn-held" || status.PlanID != "plan_1" || status.SessionID != "ses_1" {
		t.Fatalf("unexpected reconciled status: %#v", status)
	}
	persisted, err := manager.LastStatus()
	if err != nil || persisted.Phase != "restart_failed" || persisted.Detail == "" {
		t.Fatalf("restart_failed was not persisted with a remedy: %#v err=%v", persisted, err)
	}
	if manager.BlockedStatus(persisted) != nil {
		t.Fatal("restart_failed must be the extendable pending batch, not a fail-closed block")
	}
	if _, statErr := os.Stat(filepath.Join(base, "stage.lock")); !os.IsNotExist(statErr) {
		t.Fatal("the stage lock the dead supervisor held must be released")
	}
	if _, statErr := os.Stat(filepath.Join(base, "active.lock")); statErr != nil {
		t.Fatal("the batch lock is the pending batch and must be kept for the retry")
	}
}

func TestActivationIsNeverAbandonedWhileItsSupervisorRuns(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 9, 25, 16, 0, 0, 0, time.UTC)
	writeActivationStatus(t, root, "restarting", now.Add(-3*time.Hour))
	if _, changed, _ := New(root).ReconcileAbandonedActivation(now, func(string) (bool, bool) { return true, true }); changed {
		t.Fatal("a running supervisor is live work and must not be preempted")
	}
}

func TestRecentOrUnprobedActivationFollowsTheAgeBound(t *testing.T) {
	now := time.Date(2026, 9, 25, 16, 0, 0, 0, time.UTC)
	recent := t.TempDir()
	writeActivationStatus(t, recent, "restart_scheduled", now.Add(-ActivationAbandonAfter+time.Minute))
	if _, changed, _ := New(recent).ReconcileAbandonedActivation(now, nil); changed {
		t.Fatal("an activation younger than the bound must be left alone")
	}
	stale := t.TempDir()
	writeActivationStatus(t, stale, "restart_scheduled", now.Add(-ActivationAbandonAfter-time.Minute))
	if _, changed, _ := New(stale).ReconcileAbandonedActivation(now, func(string) (bool, bool) { return false, false }); !changed {
		t.Fatal("with unknown supervisor liveness the age bound alone must release a stale activation")
	}
	settled := t.TempDir()
	writeActivationStatus(t, settled, "restarted", now.Add(-10*time.Hour))
	if _, changed, _ := New(settled).ReconcileAbandonedActivation(now, nil); changed {
		t.Fatal("only restart_scheduled/restarting can be abandoned")
	}
}

func TestSupervisorContainerNameMatchesTheScheduledContainer(t *testing.T) {
	if SupervisorContainerName("txn-20260925T111106-e95a54cd1c7e") != "wharness-self-restart-20260925T111106-e95a54cd1c7e" ||
		SupervisorContainerName("20260925T111106-e95a54cd1c7e") != "wharness-self-restart-20260925T111106-e95a54cd1c7e" {
		t.Fatal("status transaction ids and scheduled transaction ids must name the same supervisor container")
	}
}
