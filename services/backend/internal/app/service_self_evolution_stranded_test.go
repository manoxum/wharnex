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
