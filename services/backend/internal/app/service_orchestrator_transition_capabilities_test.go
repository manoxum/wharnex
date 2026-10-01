package app

import (
	"context"
	"strings"
	"testing"
	"time"

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

func TestOrchestratorManualRegressionIsBlockedAfterDoing(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	assertRegressionBlocked := func(taskID string) {
		t.Helper()
		for _, target := range []orchestrator.TaskStatus{orchestrator.TaskReady, orchestrator.TaskPending} {
			_, err := service.TransitionOrchestratorTask(ctx, owner.ID, taskID, target)
			if err == nil || !strings.Contains(err.Error(), "already entered DOING") {
				t.Fatalf("manual %s after DOING returned %v", target, err)
			}
		}
	}

	completed, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "completed history"})
	if err != nil {
		t.Fatal(err)
	}
	completed.Status = orchestrator.TaskReview
	completed.FirstDoingAt = &now
	if err := service.orchestrator.PutTask(ctx, completed); err != nil {
		t.Fatal(err)
	}
	assertRegressionBlocked(completed.ID)
	completed, err = service.TransitionOrchestratorTask(ctx, owner.ID, completed.ID, orchestrator.TaskComplete)
	if err != nil {
		t.Fatal(err)
	}
	assertRegressionBlocked(completed.ID)
	historicalRun := orchestrator.TaskRun{ID: "run-history", TaskID: completed.ID, ProjectPath: owner.ProjectPath, SessionID: "ses-history", RequestID: "req-history", Attempt: 1, Status: "review", StartedAt: now}
	if err := service.orchestrator.AppendRun(ctx, historicalRun); err != nil {
		t.Fatal(err)
	}
	archived, err := service.TransitionOrchestratorTask(ctx, owner.ID, completed.ID, orchestrator.TaskArchived)
	if err != nil {
		t.Fatal(err)
	}
	if archived.FirstDoingAt == nil || !archived.FirstDoingAt.Equal(now) {
		t.Fatalf("archive lost execution evidence: %#v", archived)
	}
	runs, err := service.orchestrator.ListRuns(ctx, archived.ID)
	if err != nil || len(runs) != 1 || runs[0].SessionID != historicalRun.SessionID || runs[0].RequestID != historicalRun.RequestID {
		t.Fatalf("archive lost run history or affinity: %#v err=%v", runs, err)
	}
	assertRegressionBlocked(archived.ID)

	failed, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "failed retry"})
	if err != nil {
		t.Fatal(err)
	}
	failed.Status = orchestrator.TaskFailed
	failed.Condition = orchestrator.ConditionFailedRun
	failed.FirstDoingAt = &now
	if err := service.orchestrator.PutTask(ctx, failed); err != nil {
		t.Fatal(err)
	}
	assertRegressionBlocked(failed.ID)
	retried, err := service.RetryOrchestratorTask(ctx, owner.ID, failed.ID, orchestrator.TaskRetryContext{Guidance: "retry through the dedicated backend path"})
	if err != nil {
		t.Fatal(err)
	}
	if retried.Status != orchestrator.TaskReady || retried.FirstDoingAt == nil || !retried.FirstDoingAt.Equal(now) {
		t.Fatalf("explicit retry did not preserve lifecycle evidence: %#v", retried)
	}
	assertRegressionBlocked(retried.ID)

	fresh, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "backend-owned states"})
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []orchestrator.TaskStatus{orchestrator.TaskDoing, orchestrator.TaskReview, orchestrator.TaskFailed} {
		if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, fresh.ID, target); err == nil {
			t.Fatalf("manual transition to %s was accepted", target)
		}
	}
}
