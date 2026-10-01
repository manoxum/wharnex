package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
)

func TestResolveOrchestratorTaskReferencesAcceptsOnlyCompletedSameProjectTasks(t *testing.T) {
	ctx := context.Background()
	store := orchestrator.NewMemoryStore()
	service := &Service{orchestrator: store}
	now := time.Date(2026, 9, 28, 3, 0, 0, 0, time.UTC)
	complete := orchestrator.Task{ID: "task-complete", ProjectPath: "/project/a", PlanID: "plan-1", Title: "Finished", Description: "api_key=super-secret " + strings.Repeat("x", 2000), AcceptanceCriteria: []string{"criterion one"}, Status: orchestrator.TaskComplete, DependsOn: []string{"dep-1"}, UpdatedAt: now}
	archived := orchestrator.Task{ID: "task-archived", ProjectPath: "/project/a", Title: "Archived", Status: orchestrator.TaskArchived, WasCompleted: true, UpdatedAt: now.Add(time.Minute)}
	active := orchestrator.Task{ID: "task-active", ProjectPath: "/project/a", Title: "Active", Status: orchestrator.TaskDoing, UpdatedAt: now.Add(2 * time.Minute)}
	archivedWithoutCompletion := orchestrator.Task{ID: "task-old-archive", ProjectPath: "/project/a", Title: "Old archive", Status: orchestrator.TaskArchived, UpdatedAt: now.Add(3 * time.Minute)}
	foreign := orchestrator.Task{ID: "task-foreign", ProjectPath: "/project/b", Title: "Foreign", Status: orchestrator.TaskComplete, UpdatedAt: now.Add(4 * time.Minute)}
	for _, task := range []orchestrator.Task{complete, archived, active, archivedWithoutCompletion, foreign} {
		if err := store.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
	}
	completedAt := now.Add(-time.Minute)
	if err := store.AppendRun(ctx, orchestrator.TaskRun{ID: "run-1", TaskID: complete.ID, ProjectPath: complete.ProjectPath, RequestID: "req-1", PlanID: "exec-1", Attempt: 1, Status: "completed", Error: "token=must-not-leak", StartedAt: now.Add(-2 * time.Minute), CompletedAt: &completedAt}); err != nil {
		t.Fatal(err)
	}

	refs, err := service.resolveOrchestratorTaskReferences(ctx, "/project/a", []string{complete.ID, archived.ID, active.ID, archivedWithoutCompletion.ID, foreign.ID, "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 6 || !refs[0].Available || !refs[1].Available {
		t.Fatalf("completed references were not available: %#v", refs)
	}
	for _, index := range []int{2, 3, 4, 5} {
		if refs[index].Available || refs[index].Reason == "" {
			t.Fatalf("reference %d must be explicitly unavailable: %#v", index, refs[index])
		}
	}
	if refs[4].Reason != "task belongs to another project" || refs[5].Reason != "task not found" {
		t.Fatalf("wrong unavailable reasons: %#v", refs)
	}

	message := messageWithOrchestratorTaskReferences("reuse @{[task]task-complete}", refs)
	for _, want := range []string{"task=task-complete available=true", "title=\"Finished\"", "criterion one", "dep-1", "run=run-1", "request=req-1", "execution_plan=exec-1", "task=task-archived available=true", "task=task-active available=false"} {
		if !strings.Contains(message, want) {
			t.Fatalf("snapshot missing %q: %s", want, message)
		}
	}
	if strings.Contains(message, "super-secret") || strings.Contains(message, "must-not-leak") || !strings.Contains(message, "[REDACTED]") || !strings.Contains(message, "[truncated]") {
		t.Fatalf("snapshot was not bounded/redacted or leaked run error: %s", message)
	}
	stored, err := store.GetTask(ctx, complete.ID)
	if err != nil || !stored.UpdatedAt.Equal(complete.UpdatedAt) || stored.Status != complete.Status {
		t.Fatalf("read-only resolution mutated task: %#v err=%v", stored, err)
	}
	runs, err := store.ListRuns(ctx, complete.ID)
	if err != nil || len(runs) != 1 || runs[0].ID != "run-1" || runs[0].CompletedAt == nil || !runs[0].CompletedAt.Equal(completedAt) {
		t.Fatalf("read-only resolution changed run history or completed_at: %#v err=%v", runs, err)
	}
}

func TestOrchestratorTaskReferenceCountIsBounded(t *testing.T) {
	ctx := context.Background()
	store := orchestrator.NewMemoryStore()
	service := &Service{orchestrator: store}
	ids := make([]string, 0, maxTaskReferenceCount+1)
	for index := 0; index < maxTaskReferenceCount+1; index++ {
		id := string(rune('a' + index))
		ids = append(ids, id)
		if err := store.PutTask(ctx, orchestrator.Task{ID: id, ProjectPath: "/project/a", Title: id, Status: orchestrator.TaskComplete}); err != nil {
			t.Fatal(err)
		}
	}
	refs, err := service.resolveOrchestratorTaskReferences(ctx, "/project/a", ids)
	if err != nil {
		t.Fatal(err)
	}
	if refs[len(refs)-1].Available || refs[len(refs)-1].Reason != "reference limit exceeded" {
		t.Fatalf("overflow reference was not explicitly unavailable: %#v", refs[len(refs)-1])
	}
}

func TestDirectiveLegendExplainsTaskReference(t *testing.T) {
	legend := directiveLegend("reuse @task:task-complete", manifestWith("README.md"))
	for _, want := range []string{"@{[task]<task id>}", "completed task from this project", "read-only snapshot"} {
		if !strings.Contains(legend, want) {
			t.Fatalf("task directive legend missing %q: %s", want, legend)
		}
	}
}
