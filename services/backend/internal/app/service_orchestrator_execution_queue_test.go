package app

import (
	"context"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestReadyOrchestratorKeepsRunningClaimWhenPendingDuplicateAppears(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "One execution"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskReady); err != nil {
		t.Fatal(err)
	}
	claim, err := store.ClaimChatAgentTaskWithOptions("worker-1", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-1", Role: session.ChatAgentRoleWorker})
	if err != nil || claim == nil {
		t.Fatalf("expected READY claim, got %#v: %v", claim, err)
	}
	if _, err := store.StartChatAgentTask(claim.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	duplicate, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_EXECUTE", ProjectID: owner.ProjectPath, ChatID: task.ID, SessionID: owner.ID,
		DedupeKey: "duplicate-after-claim",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	kept, _ := store.GetChatAgentTask(claim.TaskID)
	cancelled, _ := store.GetChatAgentTask(duplicate.TaskID)
	if kept.Status != session.ChatAgentTaskRunning || cancelled.Status != session.ChatAgentTaskCancelled {
		t.Fatalf("running claim=%s duplicate=%s", kept.Status, cancelled.Status)
	}
}
