package postintegration_test

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/app/postintegration"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestPostIntegrationObservationKeepsRootAndDoesNotReexecuteSource(t *testing.T) {
	store := session.NewStore()
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(t.Context(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Update(started.ID, func(item *domain.Session) error {
		item.State, item.LastRequestID = "applied", "req_source"
		item.RequestLineages = map[string]domain.RequestLineage{"req_source": {RequestID: "req_source", RootRequestID: "req_root"}}
		item.Plan = &domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "plan_source", RequestID: "req_source", Status: "ready", Summary: "Integrated source"}
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan_source", Success: true}
		item.LastAppliedChanges = []domain.PendingHostChange{{Plan: *item.Plan, Execution: *item.LastExecution}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, result, err := service.SubmitPostIntegrationObservation(t.Context(), started.ID, "Check the app database identity and real deleted/active API cases.")
	if err != nil {
		t.Fatal(err)
	}
	lineage := result.RequestLineages[result.LastRequestID]
	if lineage.ParentRequestID != "req_source" || lineage.RootRequestID != "req_root" || lineage.Kind != postintegration.RequestKind {
		t.Fatalf("lost source Main Request lineage: %+v", lineage)
	}
	if result.State != "awaiting_plan" || result.Plan != nil || result.InterruptedExecution != nil || len(result.PendingHostChanges) != 0 {
		t.Fatal("an observation must not run or re-integrate the source")
	}
	if !strings.Contains(result.LastManualPrompt, "Integrated plan: plan_source") || !strings.Contains(result.LastManualPrompt, "missing runtime evidence") {
		t.Fatal("planner did not receive source receipt and runtime boundary")
	}
}
