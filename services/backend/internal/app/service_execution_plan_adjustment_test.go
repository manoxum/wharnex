package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestSubmitExecutionPlanAdjustmentCreatesDerivedPlannerRequest(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	parentRequestID := "req_parent"
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		item.State = "planned"
		item.LastRequestID = parentRequestID
		item.Plan = &domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "plan_parent", RequestID: parentRequestID, Status: "ready", Summary: "Parent plan", Document: "# Parent"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	_, adjusted, err := service.SubmitExecutionPlanAdjustment(context.Background(), started.ID, "  reduzir o escopo  ")
	if err != nil {
		t.Fatal(err)
	}
	if adjusted.LastRequestID == parentRequestID || adjusted.LastRequestMode != "adjust_plan" {
		t.Fatalf("adjustment must create a derived adjust_plan request: %#v", adjusted)
	}
	lineage, ok := adjusted.RequestLineages[adjusted.LastRequestID]
	if !ok || lineage.ParentRequestID != parentRequestID || lineage.Kind != "execution_plan_adjustment" {
		t.Fatalf("adjustment lineage mismatch: %#v", lineage)
	}
	if !strings.Contains(adjusted.LastManualPrompt, "REQUEST STRATEGY: ADJUST_PLAN") || !strings.Contains(adjusted.LastManualPrompt, "reduzir o escopo") {
		t.Fatalf("adjustment prompt lost strategy or guidance: %q", adjusted.LastManualPrompt)
	}
}

func TestSubmitExecutionPlanAdjustmentRejectsInvalidDraft(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	if _, _, err := service.SubmitExecutionPlanAdjustment(context.Background(), "missing", "   "); err == nil || !strings.Contains(err.Error(), "guidance") {
		t.Fatalf("expected guidance validation, got %v", err)
	}
}
