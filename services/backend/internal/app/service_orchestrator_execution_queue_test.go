package app

import (
	"context"
	"encoding/json"
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

// A FAILED task retries in its durable affinity even if the previous Worker
// checkpoint contains stale remote state.
func TestOrchestratorRetryAttemptReusesTheTaskConversation(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "Retried execution"})
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
	const conversation = "https://chatgpt.com/c/6ab9c881-0da0-83ea-a7f5-635202bbebc5"
	if _, err := service.RecordOrchestratorWorkerConversationAffinity(ctx, owner.ID, task.ID, claim.TaskID, "worker-1", conversation); err != nil {
		t.Fatal(err)
	}
	if _, err := store.StartChatAgentTask(claim.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CheckpointChatAgentTask(claim.TaskID, "worker-1", []byte(`{"conversation_url":"https://chatgpt.com/c/stale-checkpoint","active_request_id":"req_old"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FailChatAgentTask(claim.TaskID, "worker-1", "no response bundle", false); err != nil {
		t.Fatal(err)
	}
	current, err := service.orchestrator.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	current.Status = orchestrator.TaskFailed
	current.UpdatedAt = time.Now().UTC().Add(time.Second)
	if err := service.orchestrator.PutTask(ctx, current); err != nil {
		t.Fatal(err)
	}
	retried, err := service.RetryOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskRetryContext{Guidance: "try again"})
	if err != nil {
		t.Fatal(err)
	}
	if retried.ConversationURL != conversation || retried.ConversationID != "6ab9c881-0da0-83ea-a7f5-635202bbebc5" {
		t.Fatalf("retried task affinity=%#v", retried)
	}
	workers, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	var retry *session.ChatAgentTask
	for index := range workers {
		if workers[index].TaskID != claim.TaskID && orchestratorExecutionClaimPriority(workers[index].Status) > 0 {
			retry = &workers[index]
		}
	}
	if retry == nil {
		t.Fatalf("no retry attempt was enqueued: %#v", workers)
	}
	if retry.ConversationID != "6ab9c881-0da0-83ea-a7f5-635202bbebc5" {
		t.Fatalf("retry conversation id=%q", retry.ConversationID)
	}
	var payload struct {
		ConversationURL string `json:"conversation_url"`
		ConversationID  string `json:"conversation_id"`
		ActiveRequestID string `json:"active_request_id"`
	}
	if err := json.Unmarshal(retry.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ConversationURL != conversation || payload.ConversationID != retry.ConversationID {
		t.Fatalf("retry affinity=%#v, want %q/%q", payload, conversation, retry.ConversationID)
	}
	if payload.ActiveRequestID != "" {
		t.Fatalf("retry inherited the failed request %q", payload.ActiveRequestID)
	}
}
