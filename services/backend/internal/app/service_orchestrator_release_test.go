package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestOrchestratorReleaseNormalizesColumnsAndActivatesPendingAncestors(t *testing.T) {
	ctx := context.Background()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "first"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "second", DependsOn: []string{first.ID}})
	if err != nil {
		t.Fatal(err)
	}
	third, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "third", DependsOn: []string{second.ID}})
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range []orchestrator.Task{first, second, third} {
		if task.Status != orchestrator.TaskPending {
			t.Fatalf("manual task unexpectedly released: %#v", task)
		}
	}
	third, err = service.TransitionOrchestratorTask(ctx, owner.ID, third.ID, orchestrator.TaskReady)
	if err != nil || third.Status != orchestrator.TaskWaiting {
		t.Fatalf("dependent release should wait: %#v %v", third, err)
	}
	first, _ = service.orchestrator.GetTask(ctx, first.ID)
	second, _ = service.orchestrator.GetTask(ctx, second.ID)
	if first.Status != orchestrator.TaskReady || second.Status != orchestrator.TaskWaiting {
		t.Fatalf("pending ancestors were not released: first=%s second=%s", first.Status, second.Status)
	}
	first.Status = orchestrator.TaskReview
	if err := service.orchestrator.PutTask(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := service.recalculateOrchestratorTasks(ctx, owner.ProjectPath); err != nil {
		t.Fatal(err)
	}
	second, _ = service.orchestrator.GetTask(ctx, second.ID)
	if second.Status != orchestrator.TaskReady {
		t.Fatalf("successful predecessor did not release dependent: %#v", second)
	}
	second.Status = orchestrator.TaskReview
	if err := service.orchestrator.PutTask(ctx, second); err != nil {
		t.Fatal(err)
	}
	if err := service.recalculateOrchestratorTasks(ctx, owner.ProjectPath); err != nil {
		t.Fatal(err)
	}
	third, _ = service.orchestrator.GetTask(ctx, third.ID)
	if third.Status != orchestrator.TaskReady {
		t.Fatalf("recursive dependent did not become ready: %#v", third)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, third.ID, orchestrator.TaskReview); err == nil {
		t.Fatal("user could enter REVIEW directly")
	}
}

func TestOrchestratorWaitingDropWithoutDependenciesBecomesReady(t *testing.T) {
	ctx := context.Background()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "root"})
	if err != nil {
		t.Fatal(err)
	}
	task, err = service.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskWaiting)
	if err != nil || task.Status != orchestrator.TaskReady {
		t.Fatalf("WAITING drop without dependencies must normalize to READY: %#v %v", task, err)
	}
}

func TestFailedOrchestratorRetryKeepsUserGuidanceAndValidatesAttachmentOwnership(t *testing.T) {
	ctx := context.Background()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "retry"})
	if err != nil {
		t.Fatal(err)
	}
	task.Status, task.Condition = orchestrator.TaskFailed, orchestrator.ConditionFailedRun
	if err := service.orchestrator.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	foreign := orchestrator.TaskRetryContext{AttachmentCacheKey: "retry_1", Attachments: []orchestrator.TaskAttachment{{Name: "evidence.txt", Size: 4, StorageRef: "other/message/0"}}}
	if _, err := service.RetryOrchestratorTask(ctx, owner.ID, task.ID, foreign); err == nil {
		t.Fatal("foreign retry attachment was accepted")
	}
	retried, err := service.RetryOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskRetryContext{Guidance: "Inspect the failing fixture first"})
	if err != nil || retried.Status != orchestrator.TaskReady || retried.RetryContext == nil {
		t.Fatalf("retry failed: %#v %v", retried, err)
	}
	if !strings.Contains(orchestratorTaskPrompt(retried), "Inspect the failing fixture first") {
		t.Fatal("retry guidance was not included in Agent request")
	}
}

func TestOrchestratorTasksInheritPlanningEffortAndAllowAnExplicitOverride(t *testing.T) {
	ctx := context.Background()
	proposal := orchestrator.Proposal{Protocol: orchestrator.ProtocolV1, Title: "Small plan", Objective: "ship", Tasks: []orchestrator.ProposalTask{{ID: "one", Title: "First"}}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{proposal: proposal}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetReasoningEffort(owner.ID, domain.ReasoningEffortMedium); err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(ctx, owner.ID, proposal.Objective)
	if err != nil || result.Plan == nil || result.Plan.ReasoningEffort != "medium" || result.Tasks[0].ReasoningEffort != "medium" {
		t.Fatalf("planning effort was not retained: %#v %v", result, err)
	}
	if _, err := service.SetReasoningEffort(owner.ID, domain.ReasoningEffortHigh); err != nil {
		t.Fatal(err)
	}
	changed, err := service.SetOrchestratorTaskEffort(ctx, owner.ID, result.Tasks[0].ID, domain.ReasoningEffortInstant)
	if err != nil || changed.ReasoningEffort != "instant" {
		t.Fatalf("task effort override failed: %#v %v", changed, err)
	}
	if _, err := service.SetOrchestratorTaskEffort(ctx, owner.ID, result.Tasks[0].ID, "unbounded"); err == nil {
		t.Fatal("invalid task effort was accepted")
	}
}
