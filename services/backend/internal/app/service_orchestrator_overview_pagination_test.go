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
