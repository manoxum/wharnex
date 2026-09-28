package app

import (
	"context"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
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

func TestOrchestratorWorkerSeesNoRequestOnceItsBundleWasAccepted(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "Executing locally"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskReady); err != nil {
		t.Fatal(err)
	}
	claim, err := store.ClaimChatAgentTaskWithOptions("worker-1", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-1", Role: session.ChatAgentRoleWorker})
	if err != nil || claim == nil {
		t.Fatalf("claim=%#v err=%v", claim, err)
	}
	started, err := service.StartOrchestratorWorkerTask(ctx, owner.ID, task.ID, claim.TaskID, "worker-1")
	if err != nil || started.RequestID == "" {
		t.Fatalf("a pending request must be delivered: %#v err=%v", started, err)
	}
	if _, err := store.Update(started.AgentSessionID, func(current *domain.Session) error {
		current.PendingManualRequestIDs = nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	current, err := service.orchestratorWorkerRequest(ctx, task.ID)
	if err != nil || current.RequestID != "" || current.ExpectedFilename != "" {
		t.Fatalf("an answered request was still offered to the Worker: %#v err=%v", current, err)
	}
}
