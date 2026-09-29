package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestOrchestratorExecutionContractSurvivesRestartRetryReclaimAndArchive(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	queue := session.NewStore()
	durable := orchestrator.NewMemoryStore()
	service := NewService(queue, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetOrchestratorStore(durable)
	owner, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "Cross regression"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskReady); err != nil {
		t.Fatal(err)
	}
	first, err := queue.ClaimChatAgentTaskWithOptions("worker-1", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-1", Role: session.ChatAgentRoleWorker})
	if err != nil || first == nil {
		t.Fatalf("first claim=%#v err=%v", first, err)
	}
	const conversation = "https://chatgpt.com/c/cross-regression"
	if _, err = service.RecordOrchestratorWorkerConversationAffinity(ctx, owner.ID, task.ID, first.TaskID, "worker-1", conversation); err != nil {
		t.Fatal(err)
	}
	started, err := service.StartOrchestratorWorkerTask(ctx, owner.ID, task.ID, first.TaskID, "worker-1")
	if err != nil || started.Task.FirstDoingAt == nil {
		t.Fatalf("started=%#v err=%v", started, err)
	}
	firstDoingAt := *started.Task.FirstDoingAt

	restarted := NewService(queue, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	restarted.SetOrchestratorStore(durable)
	detail, err := restarted.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
	if err != nil || detail.Chat.ConversationURL != conversation || detail.Engine.ActiveWorker == nil {
		t.Fatalf("restart detail=%#v err=%v", detail, err)
	}
	if _, err = restarted.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskPending); err == nil || !strings.Contains(err.Error(), "already entered DOING") {
		t.Fatalf("manual regression err=%v", err)
	}

	if _, err = queue.WaitChatAgentTask(first.TaskID, "worker-1", time.Now().Add(-time.Second), "reclaim", true); err != nil {
		t.Fatal(err)
	}
	second, err := queue.ClaimChatAgentTaskWithOptions("worker-2", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-2", Role: session.ChatAgentRoleWorker})
	if err != nil || second == nil || second.TaskID != first.TaskID {
		t.Fatalf("reclaim=%#v err=%v", second, err)
	}
	reclaimed, err := restarted.StartOrchestratorWorkerTask(ctx, owner.ID, task.ID, second.TaskID, "worker-2")
	if err != nil || reclaimed.ConversationURL != conversation {
		t.Fatalf("reclaimed=%#v err=%v", reclaimed, err)
	}
	if _, err = queue.StartChatAgentTask(second.TaskID, "worker-2"); err != nil {
		t.Fatal(err)
	}
	if _, err = queue.FailChatAgentTask(second.TaskID, "worker-2", "cross-regression failure", false); err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.OrchestratorOverview(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	failed, err := durable.GetTask(ctx, task.ID)
	if err != nil || failed.Status != orchestrator.TaskFailed {
		t.Fatalf("failed task=%#v err=%v", failed, err)
	}
	detail, err = restarted.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
	if err != nil || detail.Engine.ActiveWorker != nil {
		t.Fatalf("ended lease stayed active: %#v err=%v", detail.Engine, err)
	}

	retried, err := restarted.RetryOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskRetryContext{Guidance: "retry in the same conversation"})
	if err != nil || retried.Status != orchestrator.TaskReady || retried.ConversationURL != conversation || retried.FirstDoingAt == nil || !retried.FirstDoingAt.Equal(firstDoingAt) {
		t.Fatalf("retried=%#v err=%v", retried, err)
	}
	third, err := queue.ClaimChatAgentTaskWithOptions("worker-3", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-3", Role: session.ChatAgentRoleWorker})
	if err != nil || third == nil {
		t.Fatalf("retry claim=%#v err=%v", third, err)
	}
	retryRun, err := restarted.StartOrchestratorWorkerTask(ctx, owner.ID, task.ID, third.TaskID, "worker-3")
	if err != nil || retryRun.ConversationURL != conversation || retryRun.Run.Attempt != 2 {
		t.Fatalf("retry run=%#v err=%v", retryRun, err)
	}
	if _, err = queue.CompleteChatAgentTask(third.TaskID, "worker-3"); err != nil {
		t.Fatal(err)
	}
	detail, err = restarted.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
	if err != nil || detail.Engine.ActiveWorker != nil {
		t.Fatalf("completed lease stayed active: %#v err=%v", detail.Engine, err)
	}

	current, err := durable.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	current.Status = orchestrator.TaskReview
	if err = durable.PutTask(ctx, current); err != nil {
		t.Fatal(err)
	}
	completed, err := restarted.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskComplete)
	if err != nil || completed.ConversationURL != conversation {
		t.Fatalf("completed=%#v err=%v", completed, err)
	}
	archived, err := restarted.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskArchived)
	if err != nil || archived.Status != orchestrator.TaskArchived || archived.ConversationURL != conversation || archived.FirstDoingAt == nil || !archived.FirstDoingAt.Equal(firstDoingAt) {
		t.Fatalf("archived=%#v err=%v", archived, err)
	}
	if _, err = restarted.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskPending); err == nil {
		t.Fatal("archived task reopened")
	}
}
