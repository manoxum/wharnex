package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

func TestOrchestratorLegacyAndIncompleteArchivesRemainDistinct(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "legacy complete"})
	if err != nil {
		t.Fatal(err)
	}
	legacy.Status = orchestrator.TaskComplete
	legacy.WasCompleted = false
	if err := service.orchestrator.PutTask(ctx, legacy); err != nil {
		t.Fatal(err)
	}
	legacy, err = service.TransitionOrchestratorTask(ctx, owner.ID, legacy.ID, orchestrator.TaskArchived)
	if err != nil || !legacy.WasCompleted {
		t.Fatalf("legacy COMPLETE did not acquire durable evidence when archived: %#v %v", legacy, err)
	}

	incomplete, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "incomplete"})
	if err != nil {
		t.Fatal(err)
	}
	incomplete, err = service.TransitionOrchestratorTask(ctx, owner.ID, incomplete.ID, orchestrator.TaskArchived)
	if err != nil || incomplete.WasCompleted {
		t.Fatalf("archive invented completion evidence: %#v %v", incomplete, err)
	}
	assertAllowedTransitions(t, incomplete)
	child, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "child", DependsOn: []string{incomplete.ID}})
	if err != nil {
		t.Fatal(err)
	}
	child, err = service.TransitionOrchestratorTask(ctx, owner.ID, child.ID, orchestrator.TaskReady)
	if err != nil || child.Status != orchestrator.TaskWaiting || child.Condition != orchestrator.ConditionDependency {
		t.Fatalf("incomplete archive satisfied a dependency: %#v %v", child, err)
	}
}

func TestOrchestratorTransitionCapabilitiesUseExecutionModeAndDependencies(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	root, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "root"})
	if err != nil {
		t.Fatal(err)
	}
	dependent, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "dependent", DependsOn: []string{root.ID}})
	if err != nil {
		t.Fatal(err)
	}
	assertAllowedTransitions(t, root, orchestrator.TaskReady, orchestrator.TaskArchived)
	assertAllowedTransitions(t, dependent, orchestrator.TaskWaiting, orchestrator.TaskArchived)

	if _, err := service.SetAutomationMode(owner.ID, domain.AutomationModeManual); err != nil {
		t.Fatal(err)
	}
	overview, err := service.OrchestratorOverview(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertAllowedTransitions(t, taskByTitle(t, overview.Tasks, "root"), orchestrator.TaskArchived)
	assertAllowedTransitions(t, taskByTitle(t, overview.Tasks, "dependent"), orchestrator.TaskArchived)
}

func assertAllowedTransitions(t *testing.T, task orchestrator.Task, want ...orchestrator.TaskStatus) {
	t.Helper()
	if task.AllowedTransitions == nil {
		t.Fatalf("task %s omitted allowed_transitions", task.ID)
	}
	got := *task.AllowedTransitions
	if len(got) != len(want) {
		t.Fatalf("task %s transitions=%v want=%v", task.ID, got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("task %s transitions=%v want=%v", task.ID, got, want)
		}
	}
}
