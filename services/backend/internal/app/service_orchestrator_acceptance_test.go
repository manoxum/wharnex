package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

func TestOrchestratorAcceptanceTerminalLifecycleAndPagination(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	for _, title := range []string{"first", "second", "third"} {
		item, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: title})
		if err != nil {
			t.Fatal(err)
		}
		item.Status = orchestrator.TaskReview
		if err := service.orchestrator.PutTask(ctx, item); err != nil {
			t.Fatal(err)
		}
		completed, err := service.TransitionOrchestratorTask(ctx, owner.ID, item.ID, orchestrator.TaskComplete)
		if err != nil {
			t.Fatal(err)
		}
		assertAllowedTransitions(t, completed, orchestrator.TaskArchived)
	}
	first, err := service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskComplete, Limit: 1})
	if err != nil || first.Total != 3 || len(first.Tasks) != 1 || !first.HasMore || first.NextCursor == "" {
		t.Fatalf("unexpected COMPLETE page: %#v %v", first, err)
	}
	second, err := service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskComplete, Limit: 1, Cursor: first.NextCursor})
	if err != nil || len(second.Tasks) != 1 || second.Tasks[0].ID == first.Tasks[0].ID {
		t.Fatalf("cursor duplicated COMPLETE task: first=%#v second=%#v err=%v", first, second, err)
	}
	for _, item := range []orchestrator.Task{first.Tasks[0], second.Tasks[0]} {
		archived, err := service.TransitionOrchestratorTask(ctx, owner.ID, item.ID, orchestrator.TaskArchived)
		if err != nil || !archived.WasCompleted {
			t.Fatalf("archive lost completion evidence: %#v %v", archived, err)
		}
		assertAllowedTransitions(t, archived)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, first.Tasks[0].ID, orchestrator.TaskReady); err == nil {
		t.Fatal("ARCHIVED task reopened")
	}
	completePage, err := service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskComplete, Limit: 10})
	if err != nil || completePage.Total != 1 {
		t.Fatalf("COMPLETE page did not reconcile: %#v %v", completePage, err)
	}
	archiveFirst, err := service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskArchived, Limit: 1})
	if err != nil || archiveFirst.Total != 2 || len(archiveFirst.Tasks) != 1 || !archiveFirst.HasMore || archiveFirst.NextCursor == "" {
		t.Fatalf("unexpected ARCHIVED page: %#v %v", archiveFirst, err)
	}
	archiveSecond, err := service.OrchestratorTasksPage(ctx, owner.ID, orchestrator.TaskPageFilter{Status: orchestrator.TaskArchived, Limit: 1, Cursor: archiveFirst.NextCursor})
	if err != nil || len(archiveSecond.Tasks) != 1 || archiveSecond.Tasks[0].ID == archiveFirst.Tasks[0].ID {
		t.Fatalf("cursor duplicated ARCHIVED task: first=%#v second=%#v err=%v", archiveFirst, archiveSecond, err)
	}
}
