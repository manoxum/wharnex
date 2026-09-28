package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func newOrchestratorLifecycleTestService() *Service {
	return NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
}

func TestOrchestratorCompletionIsTerminalAcrossArchive(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	source, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "source"})
	if err != nil {
		t.Fatal(err)
	}
	dependent, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "dependent", DependsOn: []string{source.ID}})
	if err != nil {
		t.Fatal(err)
	}
	source.Status = orchestrator.TaskReview
	if err := service.orchestrator.PutTask(ctx, source); err != nil {
		t.Fatal(err)
	}
	completed, err := service.TransitionOrchestratorTask(ctx, owner.ID, source.ID, orchestrator.TaskComplete)
	if err != nil || !completed.WasCompleted {
		t.Fatalf("complete did not persist lifecycle evidence: %#v %v", completed, err)
	}
	assertAllowedTransitions(t, completed, orchestrator.TaskArchived)
	page, err := service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskComplete})
	if err != nil || len(page.Tasks) != 1 || page.Tasks[0].ID != source.ID {
		t.Fatalf("completed task page mismatch: %#v %v", page, err)
	}
	assertAllowedTransitions(t, page.Tasks[0], orchestrator.TaskArchived)
	for _, target := range []orchestrator.TaskStatus{orchestrator.TaskPending, orchestrator.TaskReady} {
		if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, source.ID, target); err == nil {
			t.Fatalf("completed task accepted regression to %s", target)
		}
	}
	archived, err := service.TransitionOrchestratorTask(ctx, owner.ID, source.ID, orchestrator.TaskArchived)
	if err != nil || !archived.WasCompleted {
		t.Fatalf("archive lost completion evidence: %#v %v", archived, err)
	}
	assertAllowedTransitions(t, archived)
	page, err = service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskArchived})
	if err != nil || len(page.Tasks) != 1 || page.Tasks[0].ID != source.ID {
		t.Fatalf("archived task page mismatch: %#v %v", page, err)
	}
	assertAllowedTransitions(t, page.Tasks[0])
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, source.ID, orchestrator.TaskPending); err == nil {
		t.Fatal("archived completed task was reopened")
	}
	dependent, err = service.TransitionOrchestratorTask(ctx, owner.ID, dependent.ID, orchestrator.TaskReady)
	if err != nil || dependent.Status != orchestrator.TaskReady {
		t.Fatalf("archived completed dependency stopped satisfying readiness: %#v %v", dependent, err)
	}
}

func TestCompletedDependentIsNotRewrittenByUpstreamRegression(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	upstream, _ := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "upstream"})
	downstream, _ := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "downstream", DependsOn: []string{upstream.ID}})
	upstream.Status = orchestrator.TaskReview
	downstream.Status = orchestrator.TaskReview
	if err := service.orchestrator.PutTask(ctx, upstream); err != nil {
		t.Fatal(err)
	}
	if err := service.orchestrator.PutTask(ctx, downstream); err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, downstream.ID, orchestrator.TaskComplete); err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, upstream.ID, orchestrator.TaskPending); err != nil {
		t.Fatal(err)
	}
	stored, err := service.orchestrator.GetTask(ctx, downstream.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != orchestrator.TaskComplete || !stored.WasCompleted {
		t.Fatalf("dependency invalidation rewrote completed history: %#v", stored)
	}
}
