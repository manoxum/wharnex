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

func abandonedActivationService(t *testing.T, phase string, updated time.Time) (*Service, *audit.Bus, string) {
	t.Helper()
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := "phase=" + phase + "\nsession_id=ses-held\nplan_id=plan-held\ntransaction=txn-held\nupdated_at=" + updated.UTC().Format(time.RFC3339) + "\n"
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	bus := audit.NewBus()
	if err := store.Put(domain.Session{
		ID: "ses-held", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected, SelfEvolution: true,
		SelfEvolutionActivation: "restart_scheduled", State: "restart_scheduled",
		Plan: &domain.ExecutionPlan{PlanID: "plan-held"},
	}); err != nil {
		t.Fatal(err)
	}
	return &Service{store: store, bus: bus, selfEvolution: selfevolution.New(root)}, bus, "ses-held"
}

func withSupervisorProbe(t *testing.T, probe selfevolution.SupervisorProbe) {
	t.Helper()
	previous := supervisorProbe
	supervisorProbe = &cachedSupervisorProbe{probe: probe}
	t.Cleanup(func() { supervisorProbe = previous })
}

// A supervisor that died mid-activation must become a visible, retryable
// restart instead of a restart_scheduled chat that never moves again.
func TestAbandonedActivationProjectsRetryableRestartOnTheChat(t *testing.T) {
	withSupervisorProbe(t, func(string) (bool, bool) { return false, true })
	service, bus, sessionID := abandonedActivationService(t, "restarting", time.Now().Add(-6*time.Hour))

	service.reconcileSelfEvolutionStatus()

	current, err := service.store.Get(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != "restart_pending" || current.SelfEvolutionActivation != "restart_pending" {
		t.Fatalf("abandoned activation did not become a retryable restart: state=%q activation=%q", current.State, current.SelfEvolutionActivation)
	}
	if !strings.Contains(current.LastRepairError, "supervisor de ativação") {
		t.Fatalf("the operator is not told why the activation stopped: %q", current.LastRepairError)
	}
	if countEvents(bus.History(sessionID), "self_evolution.activation_abandoned") != 1 {
		t.Fatal("the abandonment must leave durable evidence")
	}
}

// Reconciliation runs on every session read; it may announce a projection
// change once, never once per read.
func TestUnchangedSelfEvolutionProjectionIsNotRewrittenOnEveryRead(t *testing.T) {
	withSupervisorProbe(t, func(string) (bool, bool) { return true, true })
	service, bus, sessionID := abandonedActivationService(t, "restarting", time.Now().Add(-time.Minute))

	for range 5 {
		service.reconcileSelfEvolutionStatus()
	}

	if got := countEvents(bus.History(sessionID), "self_evolution.status_reconciled"); got != 0 {
		t.Fatalf("an already projected restart_scheduled state was re-announced %d times", got)
	}
	if countEvents(bus.History(sessionID), "self_evolution.activation_abandoned") != 0 {
		t.Fatal("a young activation with a live supervisor must not be abandoned")
	}
}

func TestHealthyRestartRestoresUnappliedStrandedConfirmationToVerified(t *testing.T) {
	for _, phase := range []string{"restarted", "aborted"} {
		t.Run(phase, func(t *testing.T) { testUnappliedStrandedConfirmation(t, phase) })
	}
}

func testUnappliedStrandedConfirmation(t *testing.T, phase string) {
	root := t.TempDir()
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	status := strings.Join([]string{
		"phase=" + phase, "session_id=ses-newer", "plan_id=plan-newer",
		"transaction=txn-newer", "updated_at=" + time.Now().UTC().Format(time.RFC3339), "",
	}, "\n")
	if err := os.WriteFile(filepath.Join(base, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	change := domain.PendingHostChange{Plan: domain.ExecutionPlan{PlanID: "plan-stranded"}}
	if err := store.Put(domain.Session{
		ID: "ses-stranded", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, State: "restart_pending", SelfEvolutionActivation: "restart_pending",
		SelfEvolutionImpacts: []string{"backend"}, PendingHostChanges: []domain.PendingHostChange{change},
		LastRepairError: "self-evolution host build failed",
	}); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus(), selfEvolution: selfevolution.New(root)}

	service.reconcileSelfEvolutionStatus()
	updated, err := store.Get("ses-stranded")
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "verified" || updated.SelfEvolutionActivation != "" || len(updated.SelfEvolutionImpacts) != 0 {
		t.Fatalf("unapplied session still offers a restart: state=%q activation=%q impacts=%v", updated.State, updated.SelfEvolutionActivation, updated.SelfEvolutionImpacts)
	}
	if len(updated.PendingHostChanges) != 1 || updated.PendingHostChanges[0].Plan.PlanID != "plan-stranded" || updated.LastRepairError != "self-evolution host build failed" {
		t.Fatalf("recovery discarded pending work or failure evidence: %#v", updated)
	}
}
