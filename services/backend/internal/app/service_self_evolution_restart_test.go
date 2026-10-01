package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
)

func TestRestartSelfEvolutionAcceptsAlreadyCompletedActivation(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := strings.Join([]string{
		"phase=restarted",
		"session_id=ses-completed",
		"plan_id=plan-completed",
		"transaction=txn-completed",
		"updated_at=2026-09-29T15:23:02Z",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses-completed", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, SelfEvolutionActivation: "restart_pending", State: "restart_pending",
		LastHostAppliedAt: time.Date(2026, 9, 29, 15, 20, 0, 0, time.UTC),
		Plan:              &domain.ExecutionPlan{PlanID: "plan-completed"},
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus(), selfEvolution: selfevolution.New(root)}

	updated, err := service.RestartSelfEvolution("ses-completed")
	if err != nil {
		t.Fatalf("completed activation should reconcile instead of failing to recover pending transaction: %v", err)
	}
	if updated.State != "applied" || updated.SelfEvolutionActivation != "" {
		t.Fatalf("completed activation was not reconciled: state=%q activation=%q", updated.State, updated.SelfEvolutionActivation)
	}
}

func TestRestartSelfEvolutionAcceptsActivationCoveredByLaterHealthyRestart(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := strings.Join([]string{
		"phase=restarted",
		"session_id=ses-newer",
		"plan_id=plan-newer",
		"transaction=txn-newer",
		"updated_at=2026-09-29T15:23:02Z",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses-older", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, SelfEvolutionActivation: "restart_pending", State: "restart_pending",
		LastHostAppliedAt: time.Date(2026, 9, 29, 15, 20, 0, 0, time.UTC),
		Plan:              &domain.ExecutionPlan{PlanID: "plan-older"},
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus(), selfEvolution: selfevolution.New(root)}

	updated, err := service.RestartSelfEvolution("ses-older")
	if err != nil {
		t.Fatalf("later healthy restart should settle the older pending session: %v", err)
	}
	if updated.State != "applied" || updated.SelfEvolutionActivation != "" {
		t.Fatalf("older activation was not reconciled: state=%q activation=%q", updated.State, updated.SelfEvolutionActivation)
	}
}

func TestRestartSelfEvolutionAcceptsAlreadyScheduledActivation(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := strings.Join([]string{
		"phase=restart_scheduled",
		"session_id=ses-scheduled",
		"plan_id=plan-scheduled",
		"transaction=txn-scheduled",
		"updated_at=" + time.Now().UTC().Format(time.RFC3339),
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses-scheduled", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, SelfEvolutionActivation: "restart_pending", State: "restart_pending",
		Plan: &domain.ExecutionPlan{PlanID: "plan-scheduled"},
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus(), selfEvolution: selfevolution.New(root)}

	updated, err := service.RestartSelfEvolution("ses-scheduled")
	if err != nil {
		t.Fatalf("accepted activation should not request another pending transaction: %v", err)
	}
	if updated.State != "restart_scheduled" || updated.SelfEvolutionActivation != "restart_scheduled" {
		t.Fatalf("scheduled activation was not reconciled: state=%q activation=%q", updated.State, updated.SelfEvolutionActivation)
	}
}

func TestRestartSelfEvolutionUsesCurrentPendingBatchForOlderStrandedConfirmation(t *testing.T) {
	root := selfEvolutionRestartFixtureRoot(t)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := selfevolution.New(root)
	tx, err := manager.Prepare("ses-current", "plan-current", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if err := manager.RecordStatus(tx, "ses-current", "plan-current", "restart_pending", "current batch ready"); err != nil {
		t.Fatal(err)
	}
	tx.ReleaseStage()

	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses-stale", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, SelfEvolutionActivation: "restart_pending", State: "restart_pending",
		LastHostAppliedAt: time.Now().UTC().Add(-time.Minute),
		Plan:              &domain.ExecutionPlan{PlanID: "plan-stale"},
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus(), selfEvolution: manager}

	updated, err := service.RestartSelfEvolution("ses-stale")
	if err != nil {
		t.Fatalf("older pending confirmation should activate the newer covering batch: %v", err)
	}
	if updated.State != "restart_scheduled" || updated.SelfEvolutionActivation != "restart_scheduled" {
		t.Fatalf("covered confirmation was not marked scheduled: state=%q activation=%q", updated.State, updated.SelfEvolutionActivation)
	}
	status, err := manager.LastStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Phase != "restart_scheduled" || status.SessionID != "ses-current" || status.PlanID != "plan-current" {
		t.Fatalf("restart handoff must retain the current batch identity, got %#v", status)
	}
}

func TestReconcileEarlierRestartScheduledActivationAfterHealthyRestart(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := strings.Join([]string{
		"phase=restarted",
		"session_id=ses-current",
		"plan_id=plan-current",
		"transaction=txn-current",
		"updated_at=2026-09-29T15:23:02Z",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses-stale", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, SelfEvolutionActivation: "restart_scheduled", State: "restart_scheduled",
		LastHostAppliedAt: time.Date(2026, 9, 29, 15, 20, 0, 0, time.UTC),
		Plan:              &domain.ExecutionPlan{PlanID: "plan-stale"},
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus(), selfEvolution: selfevolution.New(root)}

	service.reconcileSelfEvolutionStatus()

	updated, err := store.Get("ses-stale")
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "applied" || updated.SelfEvolutionActivation != "" {
		t.Fatalf("scheduled activation covered by healthy restart was not reconciled: state=%q activation=%q", updated.State, updated.SelfEvolutionActivation)
	}
}

func selfEvolutionRestartFixtureRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "Makefile"), "all:\n\t@true\n", 0o644)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "services", "backend", "go.mod"), "module example.invalid/fake\n", 0o644)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "services", "desktop", "package.json"), "{}\n", 0o644)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "scripts", "self-restart.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "scripts", "start.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "scripts", "stop.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWriteSelfEvolutionRestartFixture(t, filepath.Join(root, "scripts", "stack.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	return root
}

func mustWriteSelfEvolutionRestartFixture(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
}
