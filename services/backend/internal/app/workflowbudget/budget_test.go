package workflowbudget

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestContextIncrementsDoNotSpendWorkflowSteps(t *testing.T) {
	item := domain.Session{WorkflowRound: 9, ContextIncrements: 8}
	if got := StepsUsed(item); got != 1 {
		t.Fatalf("steps used = %d, want 1", got)
	}
	if _, exhausted := Exhausted(item, &domain.ExecutionPlan{}); exhausted {
		t.Fatal("context increments must not exhaust the workflow step budget")
	}
}

func TestExecutedStepsStillExhaustTheBudget(t *testing.T) {
	item := domain.Session{WorkflowRound: OrdinaryLimit + 3, ContextIncrements: 3}
	limit, exhausted := Exhausted(item, &domain.ExecutionPlan{})
	if !exhausted || limit != OrdinaryLimit {
		t.Fatalf("limit=%d exhausted=%t", limit, exhausted)
	}
}

func TestInteractivePlansGetTheWiderBudget(t *testing.T) {
	plan := &domain.ExecutionPlan{Debug: &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2}}
	if got := Limit(plan); got != interactiveLimit {
		t.Fatalf("interactive limit = %d", got)
	}
	if got := StepsUsed(domain.Session{WorkflowRound: 1, ContextIncrements: 4}); got != 0 {
		t.Fatalf("inconsistent counters must clamp to zero, got %d", got)
	}
}
