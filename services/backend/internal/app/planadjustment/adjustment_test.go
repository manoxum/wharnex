package planadjustment_test

import (
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestFailedProtectedReviewPreservesMainRequestAndRequiresNewConsent(t *testing.T) {
	for _, state := range []string{"planned", "failed"} {
		t.Run(state, func(t *testing.T) { testExplicitReview(t, state) })
	}
}

func testExplicitReview(t *testing.T, state string) {
	store := session.NewStore()
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(t.Context(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	parent := "req_failed_review"
	_, err = store.Update(started.ID, func(item *domain.Session) error {
		item.State = state
		item.LastRequestID = parent
		item.ExecutionApprovedRootID = parent
		item.ApprovedBoundaryKeys = []string{"tool:sandbox:use:pnpm"}
		item.Plan = &domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "plan_failed_review", RequestID: parent, Status: "ready", Summary: "Failed review candidate"}
		item.LastExecution = &domain.ExecutionResult{PlanID: item.Plan.PlanID, Success: false, Error: "dependency preparation failed"}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, adjusted, err := service.SubmitExecutionPlanAdjustment(t.Context(), started.ID, "Preserve runtime identity checks and add production regression tests.")
	if err != nil {
		t.Fatalf("explicit failed Protected review must remain in lineage: %v", err)
	}
	lineage := adjusted.RequestLineages[adjusted.LastRequestID]
	if adjusted.LastRequestID == parent || adjusted.LastRequestMode != "adjust_plan" || lineage.ParentRequestID != parent || lineage.RootRequestID != parent {
		t.Fatalf("review lost the Main Request: %#v", lineage)
	}
	if adjusted.ExecutionApprovedRootID != "" || len(adjusted.ApprovedBoundaryKeys) != 0 || adjusted.InterruptedExecution != nil {
		t.Fatal("review must not execute or inherit execution approval")
	}
}
