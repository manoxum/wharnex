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

func TestOrchestratorOverviewExposesTaskCountsForTerminalHistory(t *testing.T) {
	ctx := context.Background()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for _, task := range []orchestrator.Task{
		{ID: "pending", ProjectPath: started.ProjectPath, Title: "Pending", Status: orchestrator.TaskPending, CreatedAt: now, UpdatedAt: now},
		{ID: "complete", ProjectPath: started.ProjectPath, Title: "Complete", Status: orchestrator.TaskComplete, CreatedAt: now, UpdatedAt: now},
		{ID: "archived", ProjectPath: started.ProjectPath, Title: "Archived", Status: orchestrator.TaskArchived, CreatedAt: now, UpdatedAt: now},
	} {
		if err := service.orchestrator.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
	}
	overview, err := service.OrchestratorOverview(ctx, started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if overview.TaskCounts[orchestrator.TaskPending] != 1 || overview.TaskCounts[orchestrator.TaskComplete] != 1 || overview.TaskCounts[orchestrator.TaskArchived] != 1 {
		t.Fatalf("unexpected task counts: %#v", overview.TaskCounts)
	}
	if _, ok := overview.TaskCounts[orchestrator.TaskReady]; !ok {
		t.Fatalf("zero-value status counts must remain explicit: %#v", overview.TaskCounts)
	}
}

func TestOrchestratorOverviewDerivesPlanningPhaseFromPlanAndTasks(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	const requestID = "orp-phase"
	queued, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_PLAN", ProjectID: owner.ProjectPath, ChatID: requestID,
		SessionID: owner.ID, RequestID: requestID, RootRequestID: requestID,
		DedupeKey: "orchestrator-plan:" + requestID, MaxAttempts: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskPending, orchestrator.OrchestrationPhasePlanning)

	claimed, err := store.ClaimChatAgentTask("worker-1", time.Minute)
	if err != nil || claimed == nil || claimed.TaskID != queued.TaskID {
		t.Fatalf("claim planning task: task=%#v err=%v", claimed, err)
	}
	if _, err := store.StartChatAgentTask(queued.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteChatAgentTask(queued.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	plan := orchestrator.Plan{
		ID: "plan-phase", ProjectPath: owner.ProjectPath, Title: "Phase plan", Objective: "derive phase",
		Status: orchestrator.PlanDraft, PlannerRequestID: requestID, CreatedAt: now, UpdatedAt: now,
	}
	tasks := []orchestrator.Task{
		{ID: "phase-a", ProjectPath: owner.ProjectPath, PlanID: plan.ID, Title: "A", Status: orchestrator.TaskPending, Condition: orchestrator.ConditionPlanApproval, CreatedAt: now, UpdatedAt: now},
		{ID: "phase-b", ProjectPath: owner.ProjectPath, PlanID: plan.ID, Title: "B", Status: orchestrator.TaskPending, Condition: orchestrator.ConditionPlanApproval, CreatedAt: now, UpdatedAt: now},
	}
	if err := service.orchestrator.CreatePlan(ctx, plan, tasks); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseAwaitingApproval)

	if _, err := service.ApproveOrchestratorPlan(ctx, owner.ID, plan.ID); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseExecuting)

	first, err := service.orchestrator.GetTask(ctx, tasks[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	first.Status, first.Condition, first.UpdatedAt = orchestrator.TaskReview, orchestrator.ConditionNone, time.Now().UTC()
	if err := service.orchestrator.PutTask(ctx, first); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseExecuting)

	second, err := service.orchestrator.GetTask(ctx, tasks[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	second.Status, second.Condition, second.UpdatedAt = orchestrator.TaskReview, orchestrator.ConditionNone, time.Now().UTC()
	if err := service.orchestrator.PutTask(ctx, second); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseReview)

	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, first.ID, orchestrator.TaskComplete); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseReview)
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, second.ID, orchestrator.TaskComplete); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseCompleted)

	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, first.ID, orchestrator.TaskArchived); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskDone, orchestrator.OrchestrationPhaseCompleted)
}

func TestOrchestratorOverviewKeepsRejectedDraftArchivedInsteadOfCompleted(t *testing.T) {
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	const requestID = "orp-rejected-phase"
	if _, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_PLAN", ProjectID: owner.ProjectPath, ChatID: requestID,
		SessionID: owner.ID, RequestID: requestID, RootRequestID: requestID, DedupeKey: "orchestrator-plan:" + requestID,
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	plan := orchestrator.Plan{ID: "plan-rejected-phase", ProjectPath: owner.ProjectPath, Title: "Rejected", Objective: "reject", Status: orchestrator.PlanDraft, PlannerRequestID: requestID, CreatedAt: now, UpdatedAt: now}
	task := orchestrator.Task{ID: "rejected-task", ProjectPath: owner.ProjectPath, PlanID: plan.ID, Title: "Never completed", Status: orchestrator.TaskPending, Condition: orchestrator.ConditionPlanApproval, CreatedAt: now, UpdatedAt: now}
	if err := service.orchestrator.CreatePlan(ctx, plan, []orchestrator.Task{task}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RejectOrchestratorPlan(ctx, owner.ID, plan.ID); err != nil {
		t.Fatal(err)
	}
	assertPlanningPhase(t, service, owner.ID, requestID, session.ChatAgentTaskPending, orchestrator.OrchestrationPhaseArchived)
	stored, err := service.orchestrator.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != orchestrator.TaskArchived || stored.WasCompleted {
		t.Fatalf("rejected task acquired completion evidence: %#v", stored)
	}
}

func assertPlanningPhase(t *testing.T, service *Service, sessionID, requestID, technicalStatus string, phase orchestrator.OrchestrationPhase) {
	t.Helper()
	overview, err := service.OrchestratorOverview(context.Background(), sessionID)
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range overview.PlanningRequests {
		if request.RequestID != requestID {
			continue
		}
		if request.Status != technicalStatus || request.Phase != phase {
			t.Fatalf("planning request=%#v want status=%s phase=%s", request, technicalStatus, phase)
		}
		return
	}
	t.Fatalf("planning request %s not found: %#v", requestID, overview.PlanningRequests)
}
