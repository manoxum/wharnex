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

func newOrchestratorTaskDetailService(t *testing.T, root string) (*Service, *session.Store, domain.Session) {
	t.Helper()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	return service, store, owner
}

func TestOrchestratorTaskDetailIsTaskScopedAndKeepsArchivedHistory(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	service, store, owner := newOrchestratorTaskDetailService(t, root)
	agent, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	foreignAgent, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	task := orchestrator.Task{ID: "otk_detail", ProjectPath: root, Title: "Archived detail", Status: orchestrator.TaskArchived, Condition: orchestrator.ConditionNone,
		Priority: orchestrator.PriorityNormal, ConversationURL: "https://chatgpt.com/c/task-chat", ConversationID: "task-chat", CreatedAt: now, UpdatedAt: now}
	other := orchestrator.Task{ID: "otk_other", ProjectPath: root, Title: "Other", Status: orchestrator.TaskFailed, Condition: orchestrator.ConditionFailedRun,
		Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}
	if err := service.orchestrator.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if err := service.orchestrator.PutTask(ctx, other); err != nil {
		t.Fatal(err)
	}
	completed := now.Add(time.Second)
	if err := service.orchestrator.AppendRun(ctx, orchestrator.TaskRun{ID: "run-1", TaskID: task.ID, ProjectPath: root, SessionID: agent.ID, RequestID: "req-root", Attempt: 1, Status: "review", StartedAt: now, CompletedAt: &completed}); err != nil {
		t.Fatal(err)
	}
	if err := service.orchestrator.AppendRun(ctx, orchestrator.TaskRun{ID: "run-2", TaskID: other.ID, ProjectPath: root, SessionID: foreignAgent.ID, RequestID: "req-other", Attempt: 1, Status: "failed", StartedAt: now}); err != nil {
		t.Fatal(err)
	}
	_, err = store.Update(agent.ID, func(item *domain.Session) error {
		item.RequestLineages = map[string]domain.RequestLineage{
			"req-root":  {RequestID: "req-root", RootRequestID: "req-root", Kind: "standard", CreatedAt: now},
			"req-child": {RequestID: "req-child", RootRequestID: "req-root", ParentRequestID: "req-root", Kind: "repair", CreatedAt: now.Add(time.Millisecond)},
		}
		item.Artifacts = []domain.ArtifactRecord{{ID: "artifact-task", RequestID: "req-child", Direction: "output", Kind: "file", Name: "result.txt", Size: 3, SHA256: "abc", CreatedAt: now},
			{ID: "artifact-foreign", RequestID: "req-foreign", Direction: "output", Kind: "file", Name: "foreign.txt", Size: 3, SHA256: "def", CreatedAt: now}}
		item.LastTurn = &domain.AgentTurn{Protocol: "harness.turn/v1", RequestID: "req-child", Kind: domain.TurnKindChange, Message: "done", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	service.recordPlanActivity(agent.ID, &domain.ExecutionPlan{Protocol: "harness.execution/v2", PlanID: "plan-task", RequestID: "req-child", Status: "ready", Summary: "task plan", Risk: "low"})
	service.recordPlanActivity(agent.ID, &domain.ExecutionPlan{Protocol: "harness.execution/v2", PlanID: "plan-foreign", RequestID: "req-foreign", Status: "ready", Summary: "foreign plan", Risk: "low"})
	service.recordExecutionActivity(agent.ID, "req-child", domain.ExecutionResult{PlanID: "plan-task", Success: true, StartedAt: now, CompletedAt: completed, Commands: []domain.CommandResult{}})
	service.recordExecutionActivity(agent.ID, "req-foreign", domain.ExecutionResult{PlanID: "plan-foreign", Success: false, StartedAt: now, CompletedAt: completed, Commands: []domain.CommandResult{}})
	service.bus.Publish(foreignAgent.ID, "turn.received", map[string]any{"request_id": "req-other"})

	for _, status := range []orchestrator.TaskStatus{orchestrator.TaskComplete, orchestrator.TaskFailed, orchestrator.TaskArchived} {
		task.Status = status
		if err := service.orchestrator.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
		detail, detailErr := service.OrchestratorTaskDetail(ctx, owner.ID, task.ID)
		if detailErr != nil {
			t.Fatal(detailErr)
		}
		if detail.Protocol != OrchestratorTaskDetailProtocol || detail.Task.Status != status || detail.Chat.ConversationURL != task.ConversationURL {
			t.Fatalf("detail contract lost terminal task identity for %s: %#v", status, detail)
		}
		if len(detail.Runs) != 1 || len(detail.Chat.Sessions) != 1 || detail.Chat.Sessions[0].SessionID != agent.ID {
			t.Fatalf("task detail mixed run sessions for %s: %#v", status, detail.Chat.Sessions)
		}
		if len(detail.Files) != 1 || detail.Files[0].Artifact.ID != "artifact-task" || len(detail.Plans) != 1 || detail.Plans[0].PlanID != "plan-task" || len(detail.Execution) != 1 || detail.Execution[0].PlanID != "plan-task" {
			t.Fatalf("task detail leaked foreign request data for %s: files=%#v plans=%#v execution=%#v", status, detail.Files, detail.Plans, detail.Execution)
		}
	}
	otherOwner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.OrchestratorTaskDetail(ctx, otherOwner.ID, task.ID); err == nil {
		t.Fatal("cross-project task detail was readable")
	}
}
