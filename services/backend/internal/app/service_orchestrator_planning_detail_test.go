package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestOrchestratorPlanningDetailPreservesScopeWithoutStorageReferences(t *testing.T) {
	ctx := context.Background()
	queue := session.NewStore()
	orchestratorStore := orchestrator.NewMemoryStore()
	service := NewService(queue, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	service.SetOrchestratorStore(orchestratorStore)
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	composer := OrchestratorComposerContext{
		ProjectFiles:       []string{"services/backend/internal/app/service.go"},
		AttachmentCacheKey: "planning_detail",
		Attachments: []OrchestratorPlanningAttachment{{
			Name: "notes.md", Size: 12, MIME: "text/markdown", StorageRef: "planning_detail/msg_1/0",
		}},
		GeneratedAttachments: []OrchestratorGeneratedAttachment{{
			Name: "prior.json", MIME: "application/json", Content: `{"secret":"raw-content"}`,
		}},
	}
	queued, err := service.ProposeOrchestratorPlan(ctx, owner.ID, "inspect planning detail", composer)
	if err != nil {
		t.Fatal(err)
	}
	proposal := orchestrator.Proposal{Protocol: orchestrator.ProtocolV1, Title: "Detail", Objective: "inspect planning detail", Tasks: []orchestrator.ProposalTask{
		{ID: "one", Title: "First", Priority: orchestrator.PriorityNormal},
		{ID: "two", Title: "Second", Priority: orchestrator.PriorityNormal},
	}}
	imported, err := service.ImportOrchestratorProposal(ctx, owner.ID, queued.RequestID, proposal)
	if err != nil {
		t.Fatal(err)
	}
	first := imported.Tasks[0]
	first.RetryContext = &orchestrator.TaskRetryContext{
		AttachmentCacheKey: "retry_cache",
		Attachments:        []orchestrator.TaskAttachment{{Name: "retry.txt", Size: 4, StorageRef: "retry_cache/msg/0"}},
	}
	if err := orchestratorStore.PutTask(ctx, first); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := orchestratorStore.AppendRun(ctx, orchestrator.TaskRun{ID: "run-good", TaskID: first.ID, ProjectPath: owner.ProjectPath, PlanID: "exec-plan-1", Status: "review", StartedAt: now}); err != nil {
		t.Fatal(err)
	}
	if err := orchestratorStore.AppendRun(ctx, orchestrator.TaskRun{ID: "run-foreign", TaskID: first.ID, ProjectPath: "/other/project", PlanID: imported.Plan.ID, Status: "failed", StartedAt: now}); err != nil {
		t.Fatal(err)
	}
	otherPlan := orchestrator.Plan{ID: "other-plan", ProjectPath: owner.ProjectPath, Title: "Other", Objective: "other", Status: orchestrator.PlanActive, PlannerRequestID: "orp-other", CreatedAt: now, UpdatedAt: now}
	otherTask := orchestrator.Task{ID: "other-task", ProjectPath: owner.ProjectPath, PlanID: otherPlan.ID, Title: "Other task", Status: orchestrator.TaskReady, Priority: orchestrator.PriorityNormal, CreatedAt: now, UpdatedAt: now}
	if err := orchestratorStore.CreatePlan(ctx, otherPlan, []orchestrator.Task{otherTask}); err != nil {
		t.Fatal(err)
	}
	if err := orchestratorStore.AppendRun(ctx, orchestrator.TaskRun{ID: "run-other-task", TaskID: otherTask.ID, ProjectPath: owner.ProjectPath, PlanID: "exec-plan-other", Status: "running", StartedAt: now}); err != nil {
		t.Fatal(err)
	}

	detail, err := service.OrchestratorPlanningRequestDetail(ctx, owner.ID, queued.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Plan == nil || detail.Plan.ID != imported.Plan.ID || len(detail.Tasks) != 2 || len(detail.Attempts) != 1 {
		t.Fatalf("unexpected planning detail linkage: %#v", detail)
	}
	if len(detail.ProjectFiles) != 1 || detail.ProjectFiles[0] != composer.ProjectFiles[0] || len(detail.Attachments) != 2 {
		t.Fatalf("planning context was not preserved: %#v", detail)
	}
	for _, task := range detail.Tasks {
		if task.Task.ID == otherTask.ID || task.Task.PlanID != imported.Plan.ID || task.Task.RetryContext != nil {
			t.Fatalf("planning detail leaked an unrelated or unsafe task: %#v", task.Task)
		}
		if task.Task.ID == first.ID && (len(task.Runs) != 1 || task.Runs[0].ID != "run-good") {
			t.Fatalf("task runs were not scoped to the related project: %#v", task.Runs)
		}
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"attachment_cache_key", "storage_ref", "raw-content", "retry_cache"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("detail leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestOrchestratorPlanningDetailAllowsIncompleteHistory(t *testing.T) {
	ctx := context.Background()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := service.OrchestratorPlanningRequestDetail(ctx, owner.ID, "orp-missing")
	if err != nil {
		t.Fatal(err)
	}
	if detail.RequestID != "orp-missing" || detail.Plan != nil || detail.TaskID != "" ||
		len(detail.Attempts) != 0 || len(detail.ProjectFiles) != 0 || len(detail.Attachments) != 0 || len(detail.Tasks) != 0 {
		t.Fatalf("incomplete planning history should stay empty and readable: %#v", detail)
	}
}
