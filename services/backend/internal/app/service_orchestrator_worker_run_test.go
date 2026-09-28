package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

type orchestratorExecutionManualPlanner struct{}

func (orchestratorExecutionManualPlanner) Plan(_ context.Context, _ planner.Request) (planner.Result, error) {
	return planner.Result{ManualPrompt: "Return the exact requested response ZIP"}, nil
}

func TestReadyOrchestratorReconcilesDuplicateWorkerClaims(t *testing.T) {
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
	if _, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_EXECUTE", ProjectID: owner.ProjectPath, ChatID: task.ID, SessionID: owner.ID,
		DedupeKey: "old-version-duplicate", Payload: json.RawMessage(`{"protocol":"harness.orchestrator-execution/v1"}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	claims, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{Type: "ORCHESTRATOR_EXECUTE", ChatID: task.ID})
	if err != nil || len(claims) != 2 {
		t.Fatalf("duplicate claims=%#v err=%v", claims, err)
	}
	active := 0
	for _, claim := range claims {
		if claim.Status == session.ChatAgentTaskPending {
			active++
		}
	}
	if active != 1 {
		t.Fatalf("one READY task has %d active Worker claims: %#v", active, claims)
	}
}

func TestReadyOrchestratorTaskIsClaimedOnceByWorker(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "Implement change"})
	if err != nil || first.Status != orchestrator.TaskPending {
		t.Fatalf("created task=%#v err=%v", first, err)
	}
	first, err = service.TransitionOrchestratorTask(ctx, owner.ID, first.ID, orchestrator.TaskReady)
	if err != nil || first.Status != orchestrator.TaskReady {
		t.Fatalf("released task=%#v err=%v", first, err)
	}
	queued, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{Type: "ORCHESTRATOR_EXECUTE", ProjectID: owner.ProjectPath})
	if err != nil || len(queued) != 1 || queued[0].ChatID != first.ID {
		t.Fatalf("execution queue=%#v err=%v", queued, err)
	}
	if _, err := service.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	again, _ := store.ListChatAgentTasks(session.ChatAgentTaskFilter{Type: "ORCHESTRATOR_EXECUTE", ProjectID: owner.ProjectPath})
	if len(again) != 1 {
		t.Fatalf("overview duplicated the durable claim: %#v", again)
	}
	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", time.Minute, session.ChatAgentClaimOptions{Role: session.ChatAgentRoleWorker})
	if err != nil || claimed == nil || claimed.TaskID != queued[0].TaskID {
		t.Fatalf("claimed=%#v err=%v", claimed, err)
	}
	if _, err := service.StartOrchestratorWorkerTask(ctx, owner.ID, first.ID, claimed.TaskID, "worker-2"); err == nil {
		t.Fatal("a Worker without the lease started the Agent")
	}
	request, err := service.StartOrchestratorWorkerTask(ctx, owner.ID, first.ID, claimed.TaskID, "worker-1")
	if err != nil || request.Task.Status != orchestrator.TaskDoing || request.Run.SessionID == "" ||
		request.Prompt == "" || request.ExpectedFilename == "" || request.ChatID == "system" {
		t.Fatalf("Worker start=%#v err=%v", request, err)
	}
	retried, err := service.StartOrchestratorWorkerTask(ctx, owner.ID, first.ID, claimed.TaskID, "worker-1")
	if err != nil || retried.Run.ID != request.Run.ID || retried.RequestID != request.RequestID {
		t.Fatalf("Worker restart created another Agent request: %#v err=%v", retried, err)
	}
	second, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "Next change"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, second.ID, orchestrator.TaskReady); err != nil {
		t.Fatal(err)
	}
	other, err := store.ClaimChatAgentTaskWithOptions("worker-2", time.Minute, session.ChatAgentClaimOptions{Role: session.ChatAgentRoleWorker})
	if err != nil || other == nil || other.ChatID != second.ID {
		t.Fatalf("second Worker must claim READY work in the same project: %#v err=%v", other, err)
	}
}

func TestTerminalOrchestratorClaimDoesNotRequeueWithoutNewRelease(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "Explicit release"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskReady); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CancelChatAgentLineage(task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	items, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{Type: "ORCHESTRATOR_EXECUTE", ChatID: task.ID})
	if err != nil || len(items) != 1 || items[0].Status != session.ChatAgentTaskCancelled {
		t.Fatalf("terminal release requeued: %#v err=%v", items, err)
	}
	updated, err := service.orchestrator.GetTask(ctx, task.ID)
	if err != nil || updated.Status != orchestrator.TaskFailed || updated.Condition != orchestrator.ConditionFailedRun {
		t.Fatalf("terminal release stayed silently READY: %#v err=%v", updated, err)
	}
}

func TestLegacyDoingOrchestratorRunGetsWorkerRecovery(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	task := orchestrator.Task{ID: "otk_legacy", ProjectPath: owner.ProjectPath, Title: "Interrupted run", Status: orchestrator.TaskReady, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}
	if err := service.orchestrator.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartOrchestratorTask(ctx, owner.ID, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	queued, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{Type: "ORCHESTRATOR_EXECUTE", ChatID: task.ID})
	if err != nil || len(queued) != 1 || queued[0].Status != session.ChatAgentTaskPending {
		t.Fatalf("legacy DOING recovery queue=%#v err=%v", queued, err)
	}
}
