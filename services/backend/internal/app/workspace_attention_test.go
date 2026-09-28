package app

import (
	"context"
	"fmt"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

func TestAttentionRecordOmitsResolvedBlockedTurnAfterApply(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "remove .git/index.lock"}
	record := attentionRecordFor(domain.Session{
		ID: "ses-applied", State: "applied", LastTurn: &turn, LastManualPrompt: "stale retry prompt",
	})

	if record.LastTurn != nil || record.HasManualPrompt {
		t.Fatalf("applied session still projects resolved operator attention: %+v", record)
	}
}

func TestAttentionRecordKeepsCurrentBlockedTurn(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "operator action required"}
	record := attentionRecordFor(domain.Session{
		ID: "ses-blocked", State: "blocked", LastTurn: &turn, LastManualPrompt: "retry prompt",
	})

	if record.LastTurn == nil || !record.HasManualPrompt {
		t.Fatalf("current operator attention was hidden: %+v", record)
	}
}

func TestAttentionRecordKeepsConsentAndDebugDecisionMetadata(t *testing.T) {
	record := attentionRecordFor(domain.Session{
		ID: "ses-debug", State: "debug_approval_required",
		Plan: &domain.ExecutionPlan{
			PlanID: "plan-debug", RequestID: "req-debug", Document: "# Execution contract",
			Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "inspect the live runtime"},
		},
	})

	if !record.HasPlanDocument || record.PlanRequestID != "req-debug" || record.DebugTarget != "host" || record.DebugAccess != domain.DebugAccessModify || record.DebugRationale == "" {
		t.Fatalf("compact projection lost an operator decision input: %+v", record)
	}
}

func TestAttentionRecordProjectsCompletionAndRestartNotificationMetadata(t *testing.T) {
	appliedAt := time.Date(2026, time.September, 22, 18, 47, 0, 123000000, time.UTC)
	record := attentionRecordFor(domain.Session{
		ID: "ses-complete", State: "restart_pending", SelfEvolution: true,
		SelfEvolutionActivation: "restart_pending", SelfEvolutionImpacts: []string{"frontend", "desktop"},
		LastHostAppliedAt: appliedAt, PendingKnowledgeReviewRequestID: "req-review",
	})

	if !record.SelfEvolution || record.SelfEvolutionActivation != "restart_pending" || len(record.SelfEvolutionImpacts) != 2 {
		t.Fatalf("compact projection lost self-evolution completion metadata: %+v", record)
	}
	if record.LastHostAppliedAt != appliedAt.Format(time.RFC3339Nano) || record.PendingKnowledgeReview != "req-review" {
		t.Fatalf("compact projection lost completion readiness metadata: %+v", record)
	}
}

func TestWorkspaceAttentionProjectsStableSuccessfulOrchestratorConclusions(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	other, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	completedAt := time.Date(2026, time.September, 28, 4, 10, 0, 0, time.UTC)
	add := func(owner domain.Session, id, title string, status orchestrator.TaskStatus, runStatus string, completed *time.Time) orchestrator.Task {
		t.Helper()
		task := orchestrator.Task{ID: id, ProjectPath: owner.ProjectPath, Title: title, Status: status, CreatedAt: completedAt.Add(-time.Minute), UpdatedAt: completedAt}
		if err := service.orchestrator.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
		run := orchestrator.TaskRun{ID: "run-" + id, TaskID: id, ProjectPath: owner.ProjectPath, Status: runStatus, StartedAt: completedAt.Add(-time.Minute), CompletedAt: completed}
		if err := service.orchestrator.AppendRun(ctx, run); err != nil {
			t.Fatal(err)
		}
		return task
	}

	success := add(owner, "task-success", "Successful task", orchestrator.TaskReview, "review", &completedAt)
	add(owner, "task-failed", "Failed task", orchestrator.TaskFailed, "review", &completedAt)
	add(owner, "task-unsuccessful-run", "Unsuccessful run", orchestrator.TaskReview, "failed", &completedAt)
	add(owner, "task-doing", "Doing task", orchestrator.TaskDoing, "running", nil)
	add(other, "task-other-project", "Other project", orchestrator.TaskReview, "review", &completedAt)

	_, conclusions, err := service.WorkspaceAttention(ctx, owner.ProjectPath)
	if err != nil {
		t.Fatal(err)
	}
	assertConclusion := func(wantStatus orchestrator.TaskStatus) {
		t.Helper()
		if len(conclusions) != 1 {
			t.Fatalf("expected one successful project conclusion, got %#v", conclusions)
		}
		got := conclusions[0]
		if got.RunID != "run-task-success" || got.TaskID != success.ID || got.Title != success.Title || got.Status != wantStatus || !got.CompletedAt.Equal(completedAt) {
			t.Fatalf("unexpected compact conclusion: %#v", got)
		}
	}
	assertConclusion(orchestrator.TaskReview)

	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, success.ID, orchestrator.TaskComplete); err != nil {
		t.Fatal(err)
	}
	_, conclusions, err = service.WorkspaceAttention(ctx, owner.ProjectPath)
	if err != nil {
		t.Fatal(err)
	}
	assertConclusion(orchestrator.TaskComplete)

	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, success.ID, orchestrator.TaskArchived); err != nil {
		t.Fatal(err)
	}
	_, conclusions, err = service.WorkspaceAttention(ctx, owner.ProjectPath)
	if err != nil {
		t.Fatal(err)
	}
	assertConclusion(orchestrator.TaskArchived)
}

func TestWorkspaceAttentionLimitsOrchestratorConclusions(t *testing.T) {
	ctx := context.Background()
	service := newOrchestratorLifecycleTestService()
	project := t.TempDir()
	base := time.Date(2026, time.September, 28, 4, 0, 0, 0, time.UTC)
	for index := 0; index < workspaceOrchestratorConclusionLimit+5; index++ {
		id := fmt.Sprintf("task-%02d", index)
		completed := base.Add(time.Duration(index) * time.Minute)
		if err := service.orchestrator.PutTask(ctx, orchestrator.Task{ID: id, ProjectPath: project, Title: id, Status: orchestrator.TaskReview}); err != nil {
			t.Fatal(err)
		}
		if err := service.orchestrator.AppendRun(ctx, orchestrator.TaskRun{ID: "run-" + id, TaskID: id, ProjectPath: project, Status: "review", CompletedAt: &completed}); err != nil {
			t.Fatal(err)
		}
	}
	_, conclusions, err := service.WorkspaceAttention(ctx, project)
	if err != nil {
		t.Fatal(err)
	}
	if len(conclusions) != workspaceOrchestratorConclusionLimit || conclusions[0].TaskID != "task-36" {
		t.Fatalf("workspace conclusion limit/order mismatch: len=%d first=%#v", len(conclusions), conclusions[0])
	}
}
