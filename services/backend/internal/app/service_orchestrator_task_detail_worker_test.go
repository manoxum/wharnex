package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

func TestOrchestratorTaskDetailReadsActiveLeaseWithoutReservingWorker(t *testing.T) {
	ctx := context.Background()
	service, store, owner := newOrchestratorTaskDetailService(t, t.TempDir())
	now := time.Now().UTC()
	task := orchestrator.Task{ID: "otk_lease", ProjectPath: owner.ProjectPath, Title: "Lease detail", Status: orchestrator.TaskReady,
		Condition: orchestrator.ConditionNone, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}
	if err := service.orchestrator.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	before, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{ProjectID: owner.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE"})
	if err != nil || len(before) != 0 {
		t.Fatalf("unexpected initial worker queue: %#v err=%v", before, err)
	}
	detail, err := service.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
	if err != nil || detail.Engine.ActiveWorker != nil {
		t.Fatalf("read-only detail created an active Worker: %#v err=%v", detail.Engine, err)
	}
	after, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{ProjectID: owner.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE"})
	if err != nil || len(after) != 0 {
		t.Fatalf("detail read reserved Worker work: %#v err=%v", after, err)
	}
	queued, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "ORCHESTRATOR_EXECUTE", ProjectID: owner.ProjectPath, ChatID: task.ID,
		SessionID: owner.ID, RequestID: "release-1", RootRequestID: task.ID, ConversationID: "task-chat", Payload: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	claim, err := store.ClaimChatAgentTaskWithOptions("worker-1", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-1", Role: session.ChatAgentRoleWorker})
	if err != nil || claim == nil || claim.TaskID != queued.TaskID {
		t.Fatalf("claim=%#v err=%v", claim, err)
	}
	detail, err = service.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
	if err != nil || detail.Engine.ActiveWorker == nil || detail.Engine.ActiveWorker.WorkerTaskID != queued.TaskID || detail.Engine.ActiveWorker.LeaseOwner != "worker-1" {
		t.Fatalf("active Worker lease not projected: %#v err=%v", detail.Engine, err)
	}
	if _, err := store.CompleteChatAgentTask(queued.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	detail, err = service.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
	if err != nil || detail.Engine.ActiveWorker != nil {
		t.Fatalf("completed lease stayed active: %#v err=%v", detail.Engine, err)
	}
}
