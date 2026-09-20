package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPlanExecutionHoldIsBoundToTheActivePlan(t *testing.T) {
	item := domain.Session{PlanControl: &domain.PlanExecutionControl{PlanID: "plan-a", State: planControlPaused}}
	if !planExecutionHeld(item, "plan-a") {
		t.Fatal("pause must hold the matching active plan")
	}
	if planExecutionHeld(item, "plan-b") {
		t.Fatal("a stale control record must not hold a replacement plan")
	}
}

func TestStrandedHostApplyDoesNotResumeAPlanHeldByOperator(t *testing.T) {
	plan := domain.ExecutionPlan{PlanID: "plan-held"}
	item := domain.Session{
		ExecutionMode:      domain.ExecutionModeProtected,
		State:              "verified",
		Plan:               &plan,
		PlanControl:        &domain.PlanExecutionControl{PlanID: plan.PlanID, State: planControlSuspended},
		PendingHostChanges: []domain.PendingHostChange{{Plan: plan}},
	}
	if strandedHostApply(item) {
		t.Fatal("startup reconciliation must not bypass a durable plan suspension")
	}
}
