package app

import (
	"context"
	"encoding/json"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestDebugProjectExecutionSummaryUsesDurableProjectLedger(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	bus := audit.NewBus()
	service := NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	first, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	bus.Publish(first.ID, EventExecutionRecorded, map[string]any{"plan_id": "ok", "success": true})
	bus.Publish(first.ID, EventExecutionRecorded, map[string]any{"plan_id": "failed", "success": false})
	bus.Publish(first.ID, "host.applied", map[string]any{"plan_id": "ok"})
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV2, PlanID: "debug-summary", RequestID: "req_debug_summary", Status: "ready", Summary: "execution rates", Document: "# Execution rates", Risk: "low",
		Dependencies: []domain.PlanDependency{}, SystemTools: []domain.PlanSystemTool{}, Operations: []domain.Operation{}, Verification: []domain.CommandSpec{},
		Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Query: domain.DebugQueryProjectExecutionSummary, Rationale: "use the durable ledger"},
	}
	result, err := service.executeWorkflowPlan(context.Background(), second.ID, plan, domain.PolicyDecision{Allowed: true}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || len(result.Commands) != 1 {
		t.Fatalf("expected one successful engine-owned observation, got %#v", result)
	}
	var summary projectExecutionSummary
	if err := json.Unmarshal([]byte(result.Commands[0].Stdout), &summary); err != nil {
		t.Fatalf("decode diagnostic summary: %v; output=%q", err, result.Commands[0].Stdout)
	}
	if summary.ExecutionsTotal != 2 || summary.ExecutionsSucceeded != 1 || summary.ExecutionsFailed != 1 || summary.HostApplied != 1 {
		t.Fatalf("summary did not reflect the project audit ledger: %#v", summary)
	}
}
