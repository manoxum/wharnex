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
