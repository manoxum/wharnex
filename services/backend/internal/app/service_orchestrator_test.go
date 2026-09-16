package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

type orchestratorTestPlanner struct{ proposal orchestrator.Proposal }

func (p orchestratorTestPlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	if request.PlanningMode == "orchestrator" {
		proposal := p.proposal
		return planner.Result{OrchestratorPlan: &proposal}, nil
	}
	return planner.Result{Turn: &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: request.RequestID, Kind: domain.TurnKindAnswer, Message: "done", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}}, nil
}

type orchestratorManualTestPlanner struct{}

func (orchestratorManualTestPlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	if request.PlanningMode == "orchestrator" {
		return planner.Result{ManualPrompt: "produce the orchestrator DAG"}, nil
	}
	return planner.Result{}, nil
}

type orchestratorCapturePlanner struct{ request planner.Request }

func (p *orchestratorCapturePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	p.request = request
	return planner.Result{ManualPrompt: "produce the orchestrator DAG"}, nil
}

func TestManualOrchestratorProposalQueuesDurableUrgentWorker(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(context.Background(), started.ID, "ship a durable objective")
	if err != nil {
		t.Fatal(err)
	}
	if result.RequestID == "" || result.WorkerTaskID == "" || result.Delivery != session.ChatAgentTaskPending {
		t.Fatalf("manual proposal was not durably queued: %#v", result)
	}
	queued, err := store.GetChatAgentTask(result.WorkerTaskID)
	if err != nil {
		t.Fatal(err)
	}
	if queued.Type != "ORCHESTRATOR_PLAN" || queued.Priority != -1 || queued.ProjectID != started.ProjectPath || queued.SessionID != started.ID || queued.RequestID != result.RequestID || queued.MaxAttempts != 8 {
		t.Fatalf("unexpected orchestrator worker task: %#v", queued)
	}
	var payload map[string]string
	if err := json.Unmarshal(queued.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["protocol"] != orchestratorPlanningWorkerProtocol || payload["request_id"] != result.RequestID || payload["objective"] != "ship a durable objective" || payload["prompt"] == "" {
		t.Fatalf("unexpected orchestrator worker payload: %#v", payload)
	}
	if payload["reasoning_effort"] != string(domain.ReasoningEffortHigh) {
		t.Fatalf("orchestrator reasoning effort=%q, want high", payload["reasoning_effort"])
	}
	overview, err := service.OrchestratorOverview(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.PlanningRequests) != 1 || overview.PlanningRequests[0].TaskID != result.WorkerTaskID || overview.PlanningRequests[0].Objective != "ship a durable objective" || overview.PlanningRequests[0].Status != session.ChatAgentTaskPending {
		t.Fatalf("queued planning request disappeared from orchestrator overview: %#v", overview.PlanningRequests)
	}
}

func TestOrchestratorComposerContextFlowsToPlannerAndWorker(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	capture := &orchestratorCapturePlanner{}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), capture, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	input := OrchestratorComposerContext{
		IncludeContext:     true,
		ProjectFiles:       []string{"services/frontend/src/App.tsx"},
		AttachmentCacheKey: "orch_test",
		Attachments: []OrchestratorPlanningAttachment{{
			Name: "design-notes.md", Size: 128, MIME: "text/markdown", StorageRef: "orch_test/msg_1/0",
		}},
	}
	result, err := service.ProposeOrchestratorPlan(context.Background(), started.ID, "reuse the Agent composer", input)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(capture.request.Message, "reuse the Agent composer") || !strings.Contains(capture.request.Message, "services/frontend/src/App.tsx") || !strings.Contains(capture.request.Message, "design-notes.md") || !strings.Contains(capture.request.Message, "untrusted") {
		t.Fatalf("planner request lost composer context: %q", capture.request.Message)
	}
	if capture.request.EffortLevel != started.EffortLevel {
		t.Fatalf("planner effort = %q, expected %q", capture.request.EffortLevel, started.EffortLevel)
	}
	if capture.request.ReasoningEffort != domain.ReasoningEffortHigh {
		t.Fatalf("planner reasoning effort = %q, expected high", capture.request.ReasoningEffort)
	}
	queued, err := store.GetChatAgentTask(result.WorkerTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		IncludeContext     bool                             `json:"include_context"`
		AttachmentCacheKey string                           `json:"attachment_cache_key"`
		Attachments        []OrchestratorPlanningAttachment `json:"attachments"`
		ReasoningEffort    string                           `json:"reasoning_effort"`
	}
	if err := json.Unmarshal(queued.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ReasoningEffort != string(domain.ReasoningEffortHigh) {
		t.Fatalf("worker reasoning effort=%q, want high", payload.ReasoningEffort)
	}
	if !payload.IncludeContext || payload.AttachmentCacheKey != input.AttachmentCacheKey || len(payload.Attachments) != 1 || payload.Attachments[0].StorageRef != input.Attachments[0].StorageRef {
		t.Fatalf("worker payload lost composer context: %#v", payload)
	}
}

func TestFailedOrchestratorPlanningRetryKeepsRequestAndReplacesQueueProjection(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(context.Background(), started.ID, "recover this planning request")
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim orchestrator planning task: task=%#v err=%v", claimed, err)
	}
	if _, err := store.StartChatAgentTask(claimed.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FailChatAgentTask(claimed.TaskID, "worker-1", "composer temporarily unavailable", true); err != nil {
		t.Fatal(err)
	}

	retried, err := service.RetryOrchestratorPlanning(started.ID, result.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if retried.RequestID != result.RequestID || retried.TaskID == result.WorkerTaskID || retried.Objective != "recover this planning request" || retried.Status != session.ChatAgentTaskPending || retried.MaxAttempts != 8 {
		t.Fatalf("unexpected retried request: %#v", retried)
	}
	queued, err := store.GetChatAgentTask(retried.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if queued.ParentTaskID != result.WorkerTaskID {
		t.Fatalf("retry lost attempt provenance: %#v", queued)
	}
	overview, err := service.OrchestratorOverview(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.PlanningRequests) != 1 || overview.PlanningRequests[0].TaskID != retried.TaskID {
		t.Fatalf("retry duplicated the planning request projection: %#v", overview.PlanningRequests)
	}
}

func TestOrchestratorPlanningProjectionRecoversLegacyObjective(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"prompt": "planner instructions\nOBJECTIVE:\nKeep legacy requests visible\n\nPROJECT MANIFEST:\n{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := orchestratorPlanningRequest(session.ChatAgentTask{
		TaskID: "cat-legacy", RequestID: "orp-legacy", Status: session.ChatAgentTaskWaiting,
		Payload: payload, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	})
	if request.Objective != "Keep legacy requests visible" {
		t.Fatalf("legacy planning objective was not recovered: %#v", request)
	}
}

func TestOrchestratorApprovalReadinessAndReopen(t *testing.T) {
	root := t.TempDir()
	proposal := orchestrator.Proposal{Protocol: orchestrator.ProtocolV1, Title: "Migration", Objective: "migrate safely", Tasks: []orchestrator.ProposalTask{
		{ID: "t1", Title: "Backend", Priority: orchestrator.PriorityHigh, Complexity: "medium"},
		{ID: "t2", Title: "Frontend", DependsOn: []string{"t1"}, Priority: orchestrator.PriorityNormal, Complexity: "medium"},
	}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorTestPlanner{proposal: proposal}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(context.Background(), started.ID, "migrate safely")
	if err != nil {
		t.Fatal(err)
	}
	if result.Plan == nil || result.Plan.Status != orchestrator.PlanDraft || len(result.Tasks) != 2 {
		t.Fatalf("unexpected draft proposal: %#v", result)
	}
	for _, task := range result.Tasks {
		if task.Status != orchestrator.TaskPending || task.Condition != orchestrator.ConditionPlanApproval {
			t.Fatalf("generated task must start pending approval: %#v", task)
		}
	}
	overview, err := service.ApproveOrchestratorPlan(context.Background(), started.ID, result.Plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	first, second := taskByTitle(t, overview.Tasks, "Backend"), taskByTitle(t, overview.Tasks, "Frontend")
	if first.Status != orchestrator.TaskReady || second.Status != orchestrator.TaskPending || second.Condition != orchestrator.ConditionDependency {
		t.Fatalf("approval readiness mismatch: first=%#v second=%#v", first, second)
	}
	first, err = service.TransitionOrchestratorTask(context.Background(), started.ID, first.ID, orchestrator.TaskComplete)
	if err != nil {
		t.Fatal(err)
	}
	overview, err = service.OrchestratorOverview(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	second = taskByTitle(t, overview.Tasks, "Frontend")
	if second.Status != orchestrator.TaskReady {
		t.Fatalf("completed dependency did not release downstream task: %#v", second)
	}
	if _, err := service.TransitionOrchestratorTask(context.Background(), started.ID, first.ID, orchestrator.TaskPending); err != nil {
		t.Fatal(err)
	}
	overview, _ = service.OrchestratorOverview(context.Background(), started.ID)
	second = taskByTitle(t, overview.Tasks, "Frontend")
	if second.Status != orchestrator.TaskPending {
		t.Fatalf("reopen did not invalidate dependent task: %#v", second)
	}
}

func TestOrchestratorRefusesSecondProjectMutationSlot(t *testing.T) {
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
	_, err = service.StartOrchestratorTask(context.Background(), started.ID, "next")
	if err == nil || !strings.Contains(err.Error(), "mutation slot") {
		t.Fatalf("expected occupied mutation slot error, got %v", err)
	}
}

func taskByTitle(t *testing.T, tasks []orchestrator.Task, title string) orchestrator.Task {
	t.Helper()
	for _, task := range tasks {
		if task.Title == title {
			return task
		}
	}
	t.Fatalf("task %q not found", title)
	return orchestrator.Task{}
}

// A checkpoint records where one attempt left off: its expected filename is
// derived from that task's own id. Copying it into a retry made the new task
// fail its own filename check on the first line of the worker, permanently —
// a planning request that could never recover no matter how often it retried.
func TestOrchestratorPlanningRetryStartsFreshInsteadOfResumingADeadCheckpoint(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorManualTestPlanner{}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.ProposeOrchestratorPlan(context.Background(), started.ID, "resume must not inherit a dead checkpoint")
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim orchestrator planning task: task=%#v err=%v", claimed, err)
	}
	if _, err := store.StartChatAgentTask(claimed.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	// The attempt submitted to ChatGPT and checkpointed before it failed.
	checkpoint, err := json.Marshal(map[string]any{
		"conversation_url":   "https://chatgpt.com/c/6aa57854-43d0-83e9-985e-4505d5b70c47",
		"expected_filename":  "whx_orchestrator_plan_" + claimed.TaskID + ".json",
		"assistant_baseline": 0,
		"submitted_at":       time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CheckpointChatAgentTask(claimed.TaskID, "worker-1", checkpoint); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FailChatAgentTask(claimed.TaskID, "worker-1", "plan not delivered before the timeout", true); err != nil {
		t.Fatal(err)
	}

	retried, err := service.RetryOrchestratorPlanning(started.ID, result.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	queued, err := store.GetChatAgentTask(retried.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(queued.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"conversation_url", "expected_filename", "assistant_baseline", "submitted_at"} {
		if _, present := payload[field]; present {
			t.Fatalf("retry inherited task-scoped checkpoint field %q: %#v", field, payload)
		}
	}
	// The request identity and the objective are what a retry must preserve.
	if payload["request_id"] != result.RequestID || payload["prompt"] == "" {
		t.Fatalf("retry lost the request identity or objective: %#v", payload)
	}
}
