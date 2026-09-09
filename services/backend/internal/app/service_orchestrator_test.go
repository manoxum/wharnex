package app

import (
	"context"
	"strings"
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

type orchestratorTestPlanner struct{ proposal orchestrator.Proposal }

func (p orchestratorTestPlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	if request.PlanningMode == "orchestrator" {
		proposal := p.proposal
		return planner.Result{OrchestratorPlan: &proposal}, nil
	}
	return planner.Result{Turn: &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: request.RequestID, Kind: domain.TurnKindAnswer, Message: "done", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}}, nil
}

func TestOrchestratorApprovalReadinessAndReopen(t *testing.T) {
	root := t.TempDir()
	proposal := orchestrator.Proposal{Protocol: orchestrator.ProtocolV1, Title: "Migration", Objective: "migrate safely", Tasks: []orchestrator.ProposalTask{
		{ID: "t1", Title: "Backend", Priority: orchestrator.PriorityHigh, Complexity: "medium"},
		{ID: "t2", Title: "Frontend", DependsOn: []string{"t1"}, Priority: orchestrator.PriorityNormal, Complexity: "medium"},
	}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{proposal: proposal}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(context.Background(), started.ID, "migrate safely")
	if err != nil {
		t.Fatal(err)
	}
	if result.Plan == nil || result.Plan.Status != orchestrator.PlanDraft || len(result.Tasks) != 2 {
		t.Fatalf("unexpected draft proposal: %#v", result)
	}
	for _, task := range result.Tasks {
		if task.Status != orchestrator.TaskPending || task.Condition != orchestrator.ConditionPlanApproval {
			t.Fatalf("generated task must start pending approval: %#v", task)
		}
	}
	overview, err := service.ApproveOrchestratorPlan(context.Background(), started.ID, result.Plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	first, second := taskByTitle(t, overview.Tasks, "Backend"), taskByTitle(t, overview.Tasks, "Frontend")
	if first.Status != orchestrator.TaskReady || second.Status != orchestrator.TaskPending || second.Condition != orchestrator.ConditionDependency {
		t.Fatalf("approval readiness mismatch: first=%#v second=%#v", first, second)
	}
	first, err = service.TransitionOrchestratorTask(context.Background(), started.ID, first.ID, orchestrator.TaskComplete)
	if err != nil {
		t.Fatal(err)
	}
	overview, err = service.OrchestratorOverview(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	second = taskByTitle(t, overview.Tasks, "Frontend")
	if second.Status != orchestrator.TaskReady {
		t.Fatalf("completed dependency did not release downstream task: %#v", second)
	}
	if _, err := service.TransitionOrchestratorTask(context.Background(), started.ID, first.ID, orchestrator.TaskPending); err != nil {
		t.Fatal(err)
	}
	overview, _ = service.OrchestratorOverview(context.Background(), started.ID)
	second = taskByTitle(t, overview.Tasks, "Frontend")
	if second.Status != orchestrator.TaskPending {
		t.Fatalf("reopen did not invalidate dependent task: %#v", second)
	}
}

func TestOrchestratorRefusesSecondProjectMutationSlot(t *testing.T) {
	root := t.TempDir()
	store := orchestrator.NewMemoryStore()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetOrchestratorStore(store)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := store.PutTask(context.Background(), orchestrator.Task{ID: "running", ProjectPath: started.ProjectPath, Title: "Running", Status: orchestrator.TaskDoing, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutTask(context.Background(), orchestrator.Task{ID: "next", ProjectPath: started.ProjectPath, Title: "Next", Status: orchestrator.TaskReady, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	_, err = service.StartOrchestratorTask(context.Background(), started.ID, "next")
	if err == nil || !strings.Contains(err.Error(), "mutation slot") {
		t.Fatalf("expected occupied mutation slot error, got %v", err)
	}
}

func taskByTitle(t *testing.T, tasks []orchestrator.Task, title string) orchestrator.Task {
	t.Helper()
	for _, task := range tasks {
		if task.Title == title {
			return task
		}
	}
	t.Fatalf("task %q not found", title)
	return orchestrator.Task{}
}
