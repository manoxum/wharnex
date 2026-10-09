package postintegration_test

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/app/postintegration"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

const (
	rootRequest   = "req_20260101T000000_0000000000000001"
	sourceRequest = "req_20260101T000001_0000000000000002"
)

func TestPostIntegrationObservationKeepsRootAndDoesNotReexecuteSource(t *testing.T) {
	service, _, started := integratedFixture(t)
	_, result, err := service.SubmitPostIntegrationObservation(t.Context(), started.ID, "Check the app database identity and real deleted/active API cases.")
	if err != nil {
		t.Fatal(err)
	}
	if result.ExecutionApprovedRootID != "" || len(result.ApprovedBoundaryKeys) != 0 || result.ApprovedChatPlan != nil {
		t.Fatal("source consent cannot authorize runtime observation")
	}
	lineage := result.RequestLineages[result.LastRequestID]
	if lineage.ParentRequestID != sourceRequest || lineage.RootRequestID != rootRequest || lineage.Kind != postintegration.RequestKind {
		t.Fatalf("lost source Main Request lineage: %+v", lineage)
	}
	if result.State != "awaiting_plan" || result.Plan != nil || result.InterruptedExecution != nil || len(result.PendingHostChanges) != 0 {
		t.Fatal("an observation must not run or re-integrate the source")
	}
	if !strings.Contains(result.LastManualPrompt, "Integrated plan: plan_source") || !strings.Contains(result.LastManualPrompt, "missing runtime evidence") {
		t.Fatal("planner did not receive source receipt and runtime boundary")
	}
}

func integratedFixture(t *testing.T, adapters ...planner.Planner) (*app.Service, *session.Store, domain.Session) {
	t.Helper()
	store := session.NewStore()
	var adapter planner.Planner = manualplanner.New()
	if len(adapters) > 0 {
		adapter = adapters[0]
	}
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), adapter, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(t.Context(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Update(started.ID, func(item *domain.Session) error {
		item.State, item.LastRequestID = "applied", sourceRequest
		item.RequestLineages = map[string]domain.RequestLineage{sourceRequest: {RequestID: sourceRequest, RootRequestID: rootRequest}}
		item.Plan = &domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "plan_source", RequestID: sourceRequest, Status: "ready", Summary: "Integrated source"}
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan_source", Success: true}
		item.ExecutionApprovedRootID = rootRequest
		item.ApprovedBoundaryKeys = []string{"source-only"}
		item.LastAppliedChanges = []domain.PendingHostChange{{Plan: *item.Plan, Execution: *item.LastExecution}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return service, store, started
}
