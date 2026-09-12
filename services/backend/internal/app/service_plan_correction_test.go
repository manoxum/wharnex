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

func TestPlanCorrectionCreatesPlanningOnlyContinuation(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessageWithMode(context.Background(), started.ID, "refactor UI", "plan_first")
	if err != nil {
		t.Fatal(err)
	}
	planRequestID := prompted.LastRequestID
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(prompted, planRequestID), makePlanBundle(t, planRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.State != "awaiting_plan_approval" {
		t.Fatalf("plan proposal did not await approval: %#v", result.Session)
	}

	_, corrected, err := service.SubmitPlanCorrection(context.Background(), started.ID, planRequestID, "separa a migração em duas fases")
	if err != nil {
		t.Fatal(err)
	}
	if corrected.LastRequestID == planRequestID || corrected.LastRequestMode != "correct_plan" {
		t.Fatalf("correction must create a distinct planning continuation: %#v", corrected)
	}
	lineage, ok := corrected.RequestLineages[corrected.LastRequestID]
	if !ok || lineage.Kind != requestKindPlanCorrection || lineage.ParentRequestID != planRequestID || lineage.RootRequestID != planRequestID {
		t.Fatalf("correction lineage mismatch: %#v", lineage)
	}
	for _, want := range []string{"REQUEST STRATEGY: CORRECT_PLAN", "separa a migração em duas fases", "Refatorar o fluxo de aprovação"} {
		if !strings.Contains(corrected.LastManualPrompt, want) {
			t.Fatalf("correction prompt missing %q: %q", want, corrected.LastManualPrompt)
		}
	}
	correctedRequestID := corrected.LastRequestID
	correctedFilename := expectedResponseBundleFilename(corrected, correctedRequestID)
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, correctedFilename, makeExecutionBundle(t, correctedRequestID)); err == nil || !strings.Contains(err.Error(), "correct_plan") {
		t.Fatalf("correction continuation must reject implementation bundles, got %v", err)
	}
	revised, err := service.SubmitExecutionBundle(context.Background(), started.ID, correctedFilename, makePlanBundle(t, correctedRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if revised.Session.State != "awaiting_plan_approval" || revised.Session.LastTurn == nil || revised.Session.LastTurn.RequestID != correctedRequestID {
		t.Fatalf("corrected proposal must require a fresh decision: %#v", revised.Session)
	}
	if _, _, err := service.SubmitPlanApproval(context.Background(), started.ID, planRequestID); err == nil {
		t.Fatal("superseded proposal must no longer be approvable")
	}
	if _, _, err := service.SubmitPlanCorrection(context.Background(), started.ID, planRequestID, "outra correção"); err == nil {
		t.Fatal("superseded proposal must no longer be correctable")
	}
	if _, approved, err := service.SubmitPlanApproval(context.Background(), started.ID, correctedRequestID); err != nil {
		t.Fatal(err)
	} else if approved.LastRequestMode != "approve_plan" {
		t.Fatalf("corrected proposal was not approvable: %#v", approved)
	}
}

func TestPlanCorrectionRequiresGuidance(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	if _, _, err := service.SubmitPlanCorrection(context.Background(), "missing", "req-plan", "  "); err == nil || !strings.Contains(err.Error(), "guidance") {
		t.Fatalf("expected correction guidance validation, got %v", err)
	}
}
