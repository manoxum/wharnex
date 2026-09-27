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
	if first.Status != orchestrator.TaskReady || first.Condition != orchestrator.ConditionNone || second.Status != orchestrator.TaskWaiting || second.Condition != orchestrator.ConditionDependency {
		t.Fatalf("approval readiness mismatch: first=%#v second=%#v", first, second)
	}
	first.Status, first.Condition = orchestrator.TaskReview, orchestrator.ConditionNone
	if err := service.orchestrator.PutTask(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	if err := service.recalculateOrchestratorTasks(context.Background(), started.ProjectPath); err != nil {
		t.Fatal(err)
	}
	overview, err = service.OrchestratorOverview(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	second = taskByTitle(t, overview.Tasks, "Frontend")
	if second.Status != orchestrator.TaskReady || second.Condition != orchestrator.ConditionNone {
		t.Fatalf("successful reviewed dependency did not release downstream task: %#v", second)
	}
	if _, err := service.TransitionOrchestratorTask(context.Background(), started.ID, first.ID, orchestrator.TaskComplete); err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(context.Background(), started.ID, first.ID, orchestrator.TaskPending); err != nil {
		t.Fatal(err)
	}
	overview, _ = service.OrchestratorOverview(context.Background(), started.ID)
	second = taskByTitle(t, overview.Tasks, "Frontend")
	if second.Status != orchestrator.TaskWaiting || second.Condition != orchestrator.ConditionDependency {
		t.Fatalf("reopen did not invalidate dependent task: %#v", second)
	}
}

func TestPlanDecisionDoesNotDeadlockWithAnotherDoingTask(t *testing.T) {
	ctx := context.Background()
	proposal := orchestrator.Proposal{Protocol: orchestrator.ProtocolV1, Title: "Follow-up", Objective: "plan while another task runs", Tasks: []orchestrator.ProposalTask{
		{ID: "next", Title: "Next", Priority: orchestrator.PriorityNormal},
	}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{proposal: proposal}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := service.orchestrator.PutTask(ctx, orchestrator.Task{ID: "already-doing", ProjectPath: owner.ProjectPath, Title: "Current", Status: orchestrator.TaskDoing, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(ctx, owner.ID, proposal.Objective)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ApproveOrchestratorPlan(ctx, owner.ID, result.Plan.ID); err != nil {
		t.Fatal(err)
	}
}
