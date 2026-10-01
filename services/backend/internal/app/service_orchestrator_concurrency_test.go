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

func TestOrchestratorAllowsAnotherReadyTaskWhileOneIsDoing(t *testing.T) {
	root := t.TempDir()
	store := orchestrator.NewMemoryStore()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetOrchestratorStore(store)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := store.PutTask(context.Background(), orchestrator.Task{ID: "running", ProjectPath: started.ProjectPath, Title: "Running", Status: orchestrator.TaskDoing, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutTask(context.Background(), orchestrator.Task{ID: "next", ProjectPath: started.ProjectPath, Title: "Next", Status: orchestrator.TaskReady, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	result, err := service.StartOrchestratorTask(context.Background(), started.ID, "next")
	if err != nil || result.Task.ID != "next" {
		t.Fatalf("second task must start independently: result=%#v err=%v", result, err)
	}
}
