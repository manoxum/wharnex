package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
)

func TestApplyRecoveryProjectsSelfEvolutionBusyWithoutDiscardingCandidate(t *testing.T) {
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	patch := "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
	seeded, err := store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.LastRequestID = "req-original"
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan-original", Success: true}
		item.PendingHostChanges = []domain.PendingHostChange{{Plan: domain.ExecutionPlan{
			PlanID: "plan-original", Operations: []domain.Operation{{Type: "apply_patch", Patch: patch}},
		}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	updated, err := service.TriggerApplyFailureRepair(context.Background(), seeded.ID, selfevolution.ErrBusy)
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "verified" || len(updated.PendingHostChanges) != 1 {
		t.Fatalf("verified candidate was not retained: state=%q pending=%d", updated.State, len(updated.PendingHostChanges))
	}
	if updated.FailureKind != domain.FailureKindSelfEvolutionBusy {
		t.Fatalf("failure kind=%q want %q", updated.FailureKind, domain.FailureKindSelfEvolutionBusy)
	}
	if updated.LastRepairError == "" {
		t.Fatal("local recovery detail was not projected for the attention action")
	}
	if updated.LastRequestID != "req-original" || updated.LastManualPrompt != "" || len(updated.PendingManualRequestIDs) != 0 {
		t.Fatalf("local coordination failure incorrectly opened a GPT repair: %#v", updated)
	}
}
