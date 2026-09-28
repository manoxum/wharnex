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

func TestDoingOrchestratorEffortUpdatesNextAgentRequest(t *testing.T) {
	ctx := context.Background()
	store := orchestrator.NewMemoryStore()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetOrchestratorStore(store)
	root := t.TempDir()
	owner, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	task := orchestrator.Task{ID: "task-active", ProjectPath: owner.ProjectPath, Title: "Active", Status: orchestrator.TaskDoing, Priority: orchestrator.PriorityNormal, ReasoningEffort: "high", CreatedAt: now, UpdatedAt: now}
	if err := store.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendRun(ctx, orchestrator.TaskRun{ID: "run-active", TaskID: task.ID, ProjectPath: owner.ProjectPath, SessionID: agent.ID, Status: "running", StartedAt: now}); err != nil {
		t.Fatal(err)
	}
	updated, err := service.SetOrchestratorTaskEffort(ctx, owner.ID, task.ID, domain.ReasoningEffortInstant)
	if err != nil || updated.ReasoningEffort != "instant" {
		t.Fatalf("updated=%#v err=%v", updated, err)
	}
	current, err := service.store.Get(agent.ID)
	if err != nil || current.ReasoningEffort != domain.ReasoningEffortInstant {
		t.Fatalf("Agent effort=%q err=%v", current.ReasoningEffort, err)
	}
}

func TestDoingOrchestratorEffortLevelUpdatesAgentAttemptBudget(t *testing.T) {
	ctx := context.Background()
	store := orchestrator.NewMemoryStore()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetOrchestratorStore(store)
	root := t.TempDir()
	owner, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeAuto, domain.EffortLevelMedium)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	task := orchestrator.Task{ID: "task-budget", ProjectPath: owner.ProjectPath, Title: "Budget", Status: orchestrator.TaskDoing, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}
	if err := store.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendRun(ctx, orchestrator.TaskRun{ID: "run-budget", TaskID: task.ID, ProjectPath: owner.ProjectPath, SessionID: agent.ID, Status: "running", StartedAt: now}); err != nil {
		t.Fatal(err)
	}
	updated, err := service.SetOrchestratorTaskEffortLevel(ctx, owner.ID, task.ID, domain.EffortLevelUltra)
	if err != nil || updated.EffortLevel != "ultra" {
		t.Fatalf("updated=%#v err=%v", updated, err)
	}
	current, err := service.store.Get(agent.ID)
	if err != nil || current.EffortLevel != domain.EffortLevelUltra {
		t.Fatalf("Agent effort level=%q err=%v", current.EffortLevel, err)
	}
	// A task must end in FAILED once its budget is spent, so the unbounded
	// composer level is not a task setting.
	if _, err := service.SetOrchestratorTaskEffortLevel(ctx, owner.ID, task.ID, domain.EffortLevelLoop); err == nil {
		t.Fatal("loop accepted as a task effort level")
	}
}

func TestOrchestratorTaskEffortLevelIsBounded(t *testing.T) {
	cases := []struct {
		task  string
		owner domain.EffortLevel
		want  domain.EffortLevel
	}{
		{"low", domain.EffortLevelMax, domain.EffortLevelLow},
		{"", domain.EffortLevelMax, domain.EffortLevelMax},
		{"", domain.EffortLevelLoop, domain.EffortLevelUltra},
		{"loop", domain.EffortLevelHigh, domain.EffortLevelHigh},
		{"", "", domain.EffortLevelMedium},
	}
	for _, tc := range cases {
		got := orchestratorTaskEffortLevel(orchestrator.Task{EffortLevel: tc.task}, domain.Session{EffortLevel: tc.owner})
		if got != tc.want {
			t.Fatalf("task=%q owner=%q got=%q want=%q", tc.task, tc.owner, got, tc.want)
		}
	}
}
