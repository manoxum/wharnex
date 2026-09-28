package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// A task has no chat and nobody to answer "resume or discard", so an approved
// Protected execution interrupted by a restart is resumed on its own.
func TestOrchestratorResumesOnlyAnApprovedProtectedInterruption(t *testing.T) {
	pending := &domain.InterruptedExecution{PlanID: "plan_a", Approved: true, Status: "awaiting_decision"}
	protected := domain.Session{ExecutionMode: domain.ExecutionModeProtected, InterruptedExecution: pending}
	if !orchestratorShouldResumeInterrupted(protected) {
		t.Fatal("approved Protected interruption was not resumed")
	}
	for name, candidate := range map[string]domain.Session{
		"none":       {ExecutionMode: domain.ExecutionModeProtected},
		"unapproved": {ExecutionMode: domain.ExecutionModeProtected, InterruptedExecution: &domain.InterruptedExecution{PlanID: "plan_a", Status: "awaiting_decision"}},
		"running":    {ExecutionMode: domain.ExecutionModeProtected, InterruptedExecution: &domain.InterruptedExecution{PlanID: "plan_a", Approved: true, Status: "resuming"}},
		"host":       {ExecutionMode: domain.ExecutionModeUnprotected, InterruptedExecution: pending},
	} {
		if orchestratorShouldResumeInterrupted(candidate) {
			t.Fatalf("%s interruption was resumed automatically", name)
		}
	}
}
