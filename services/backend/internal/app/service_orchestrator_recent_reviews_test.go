package app

import (
	"context"
	"fmt"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestOrchestratorOverviewExposesOnlyFivePendingReviews(t *testing.T) {
	ctx := context.Background()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, time.September, 29, 1, 0, 0, 0, time.UTC)
	for index := 1; index <= 6; index++ {
		completed := base.Add(time.Duration(index) * time.Hour)
		taskID := fmt.Sprintf("overview-review-%d", index)
		task := orchestrator.Task{ID: taskID, ProjectPath: started.ProjectPath, Title: taskID, Status: orchestrator.TaskReview, CreatedAt: base, UpdatedAt: completed}
		if err := service.orchestrator.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
		if err := service.orchestrator.AppendRun(ctx, orchestrator.TaskRun{ID: "run-" + taskID, TaskID: taskID, ProjectPath: started.ProjectPath, Attempt: 1, Status: "review", StartedAt: completed.Add(-time.Minute), CompletedAt: &completed}); err != nil {
			t.Fatal(err)
		}
	}

	overview, err := service.OrchestratorOverview(ctx, started.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"overview-review-6", "overview-review-5", "overview-review-4", "overview-review-3", "overview-review-2"}
	if len(overview.RecentReviews) != len(want) {
		t.Fatalf("recent reviews=%d want=%d: %#v", len(overview.RecentReviews), len(want), overview.RecentReviews)
	}
	for index, taskID := range want {
		if overview.RecentReviews[index].TaskID != taskID {
			t.Fatalf("recent review[%d]=%s want=%s", index, overview.RecentReviews[index].TaskID, taskID)
		}
	}

	finished, err := service.orchestrator.GetTask(ctx, "overview-review-6")
	if err != nil {
		t.Fatal(err)
	}
	finished.Status = orchestrator.TaskArchived
	finished.UpdatedAt = base.Add(24 * time.Hour)
	if err := service.orchestrator.PutTask(ctx, finished); err != nil {
		t.Fatal(err)
	}
	overview, err = service.OrchestratorOverview(ctx, started.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range overview.RecentReviews {
		if item.TaskID == finished.ID {
			t.Fatalf("archived task remained in pending reviews: %#v", overview.RecentReviews)
		}
	}
}
