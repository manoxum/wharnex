package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/session"
)

type OrchestratorProposalResult struct {
	RequestID    string              `json:"request_id"`
	Plan         *orchestrator.Plan  `json:"plan,omitempty"`
	Tasks        []orchestrator.Task `json:"tasks,omitempty"`
	ManualPrompt string              `json:"manual_prompt,omitempty"`
	WorkerTaskID string              `json:"worker_task_id,omitempty"`
	Delivery     string              `json:"delivery_status,omitempty"`
}

const orchestratorPlanningWorkerProtocol = "harness.orchestrator-planning/v1"

type OrchestratorTaskInput struct {
	PlanID             string                `json:"plan_id,omitempty"`
	Title              string                `json:"title"`
	Description        string                `json:"description,omitempty"`
	AcceptanceCriteria []string              `json:"acceptance_criteria,omitempty"`
	Priority           orchestrator.Priority `json:"priority,omitempty"`
	DependsOn          []string              `json:"depends_on,omitempty"`
	Capability         string                `json:"capability,omitempty"`
}

type OrchestratorRunResult struct {
	Task         orchestrator.Task    `json:"task"`
	Run          orchestrator.TaskRun `json:"run"`
	ManualPrompt string               `json:"manual_prompt,omitempty"`
}

func (s *Service) ProposeOrchestratorPlan(ctx context.Context, sessionID, objective string) (OrchestratorProposalResult, error) {
	objective = strings.TrimSpace(objective)
	if objective == "" {
		return OrchestratorProposalResult{}, errors.New("objective is required")
	}
	item, err := s.refreshContext(sessionID)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	knowledge, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	requestID := ids.New("orp")
	result, err := s.planner.Plan(ctx, withPlannerKnowledge(planner.Request{
		SessionID: item.ID, RequestID: requestID, Message: objective,
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		AutomationMode: item.AutomationMode, SelfEvolution: s.isSelfEvolution(item),
		PlanningMode: "orchestrator",
	}, knowledge))
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	if result.OrchestratorPlan == nil {
		if result.ManualPrompt != "" {
			payload, marshalErr := json.Marshal(map[string]string{
				"protocol":   orchestratorPlanningWorkerProtocol,
				"session_id": sessionID,
				"request_id": requestID,
				"objective":  objective,
				"prompt":     result.ManualPrompt,
			})
			if marshalErr != nil {
				return OrchestratorProposalResult{}, fmt.Errorf("encode orchestrator planning worker: %w", marshalErr)
			}
			worker, enqueueErr := s.store.EnqueueChatAgentTask(session.ChatAgentTask{
				Type: "ORCHESTRATOR_PLAN", ProjectID: item.ProjectPath, ChatID: requestID, SessionID: sessionID,
				RequestID: requestID, RootRequestID: requestID,
				DedupeKey: "orchestrator-plan:" + requestID, Payload: payload, MaxAttempts: 8,
			})
			if enqueueErr != nil {
				return OrchestratorProposalResult{}, fmt.Errorf("enqueue orchestrator planning worker: %w", enqueueErr)
			}
			s.bus.Publish(sessionID, "orchestrator.plan_queued", map[string]any{
				"project_path": item.ProjectPath, "request_id": requestID, "worker_task_id": worker.TaskID,
			})
			return OrchestratorProposalResult{
				RequestID: requestID, ManualPrompt: result.ManualPrompt,
				WorkerTaskID: worker.TaskID, Delivery: worker.Status,
			}, nil
		}
		return OrchestratorProposalResult{}, errors.New("planner returned no orchestrator proposal")
	}
	return s.persistOrchestratorProposal(ctx, sessionID, item.ProjectPath, requestID, *result.OrchestratorPlan)
}

func (s *Service) ImportOrchestratorProposal(ctx context.Context, sessionID, requestID string, proposal orchestrator.Proposal) (OrchestratorProposalResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	if strings.TrimSpace(requestID) == "" {
		requestID = ids.New("orp")
	}
	return s.persistOrchestratorProposal(ctx, sessionID, item.ProjectPath, requestID, proposal)
}

func (s *Service) RetryOrchestratorPlanning(sessionID, requestID string) (orchestrator.PlanningRequest, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.PlanningRequest{}, err
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return orchestrator.PlanningRequest{}, errors.New("orchestrator request_id is required")
	}
	tasks, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ProjectID: item.ProjectPath, RequestID: requestID, Type: "ORCHESTRATOR_PLAN", Limit: 50,
	})
	if err != nil {
		return orchestrator.PlanningRequest{}, fmt.Errorf("list orchestrator planning attempts: %w", err)
	}
	if len(tasks) == 0 {
		return orchestrator.PlanningRequest{}, errors.New("orchestrator planning request was not found")
	}
	latest := tasks[0]
	for _, candidate := range tasks[1:] {
		if candidate.UpdatedAt.After(latest.UpdatedAt) || (candidate.UpdatedAt.Equal(latest.UpdatedAt) && candidate.CreatedAt.After(latest.CreatedAt)) {
			latest = candidate
		}
	}
	if latest.Status == session.ChatAgentTaskPending || latest.Status == session.ChatAgentTaskLeased || latest.Status == session.ChatAgentTaskRunning || latest.Status == session.ChatAgentTaskWaiting {
		return orchestratorPlanningRequest(latest), nil
	}
	if latest.Status != session.ChatAgentTaskFailed && latest.Status != session.ChatAgentTaskAttention {
		return orchestrator.PlanningRequest{}, fmt.Errorf("orchestrator planning request cannot retry from %s", latest.Status)
	}
	var payload map[string]any
	if err := json.Unmarshal(latest.Payload, &payload); err != nil {
		return orchestrator.PlanningRequest{}, fmt.Errorf("decode orchestrator planning request: %w", err)
	}
	payload["session_id"] = sessionID
	encoded, err := json.Marshal(payload)
	if err != nil {
		return orchestrator.PlanningRequest{}, fmt.Errorf("encode orchestrator planning retry: %w", err)
	}
	retried, err := s.store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_PLAN", ProjectID: item.ProjectPath, ChatID: requestID, SessionID: sessionID,
		RequestID: requestID, RootRequestID: requestID, ParentTaskID: latest.TaskID,
		DedupeKey: "orchestrator-plan:" + requestID, Payload: encoded, MaxAttempts: 8,
	})
	if err != nil {
		return orchestrator.PlanningRequest{}, fmt.Errorf("retry orchestrator planning worker: %w", err)
	}
	s.bus.Publish(sessionID, "orchestrator.plan_requeued", map[string]any{
		"project_path": item.ProjectPath, "request_id": requestID, "worker_task_id": retried.TaskID,
	})
	return orchestratorPlanningRequest(retried), nil
}

func (s *Service) persistOrchestratorProposal(ctx context.Context, sessionID, projectPath, requestID string, proposal orchestrator.Proposal) (OrchestratorProposalResult, error) {
	if err := orchestrator.ValidateProposal(proposal); err != nil {
		return OrchestratorProposalResult{}, err
	}
	now := time.Now().UTC()
	plan := orchestrator.Plan{
		ID: ids.New("opl"), ProjectPath: projectPath, Title: strings.TrimSpace(proposal.Title),
		Objective: strings.TrimSpace(proposal.Objective), Status: orchestrator.PlanDraft,
		PlannerRequestID: requestID, Assumptions: append([]string(nil), proposal.Assumptions...), CreatedAt: now, UpdatedAt: now,
	}
	idMap := make(map[string]string, len(proposal.Tasks))
	for _, candidate := range proposal.Tasks {
		idMap[candidate.ID] = ids.New("otk")
	}
	tasks := make([]orchestrator.Task, 0, len(proposal.Tasks))
	for _, candidate := range proposal.Tasks {
		dependencies := make([]string, 0, len(candidate.DependsOn))
		for _, dependency := range candidate.DependsOn {
			dependencies = append(dependencies, idMap[dependency])
		}
		priority := candidate.Priority
		if priority == "" {
			priority = orchestrator.PriorityNormal
		}
		tasks = append(tasks, orchestrator.Task{
			ID: idMap[candidate.ID], ProjectPath: projectPath, PlanID: plan.ID,
			Title: candidate.Title, Description: candidate.Description,
			AcceptanceCriteria: append([]string(nil), candidate.AcceptanceCriteria...),
			Status:             orchestrator.TaskPending, Condition: orchestrator.ConditionPlanApproval,
			Priority: priority, DependsOn: dependencies, Capability: candidate.Capability,
			Complexity: candidate.Complexity, Parallelizable: candidate.Parallelizable,
			ImpactFiles: append([]string(nil), candidate.ImpactFiles...), ReadFiles: append([]string(nil), candidate.ReadFiles...),
			BarrierFiles: append([]string(nil), candidate.BarrierFiles...), CreatedAt: now, UpdatedAt: now,
		})
	}
	if err := s.orchestrator.CreatePlan(ctx, plan, tasks); err != nil {
		return OrchestratorProposalResult{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.plan_proposed", map[string]any{"project_path": projectPath, "plan_id": plan.ID, "request_id": requestID, "tasks": len(tasks)})
	return OrchestratorProposalResult{RequestID: requestID, Plan: &plan, Tasks: tasks}, nil
}

func (s *Service) OrchestratorOverview(ctx context.Context, sessionID string) (orchestrator.Overview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	plans, err := s.orchestrator.ListPlans(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	tasks, err := s.orchestrator.ListTasks(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	planningTasks, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ProjectID: item.ProjectPath, Type: "ORCHESTRATOR_PLAN", Limit: 200,
	})
	if err != nil {
		return orchestrator.Overview{}, fmt.Errorf("list orchestrator planning requests: %w", err)
	}
	planningByRequest := make(map[string]orchestrator.PlanningRequest, len(planningTasks))
	for _, task := range planningTasks {
		candidate := orchestratorPlanningRequest(task)
		if previous, ok := planningByRequest[candidate.RequestID]; !ok || candidate.UpdatedAt.After(previous.UpdatedAt) || (candidate.UpdatedAt.Equal(previous.UpdatedAt) && candidate.CreatedAt.After(previous.CreatedAt)) {
			planningByRequest[candidate.RequestID] = candidate
		}
	}
	planning := make([]orchestrator.PlanningRequest, 0, len(planningByRequest))
	for _, candidate := range planningByRequest {
		planning = append(planning, candidate)
	}
	used := 0
	for _, task := range tasks {
		if task.Status == orchestrator.TaskDoing {
			used++
		}
	}
	return orchestrator.Overview{Plans: plans, Tasks: tasks, PlanningRequests: planning, MutationSlots: 1, MutationSlotsUsed: used}, nil
}

func orchestratorPlanningRequest(task session.ChatAgentTask) orchestrator.PlanningRequest {
	var payload struct {
		Objective string `json:"objective"`
		Prompt    string `json:"prompt"`
	}
	_ = json.Unmarshal(task.Payload, &payload)
	objective := strings.TrimSpace(payload.Objective)
	if objective == "" {
		const objectiveMarker = "\nOBJECTIVE:\n"
		const manifestMarker = "\n\nPROJECT MANIFEST:\n"
		if start := strings.Index(payload.Prompt, objectiveMarker); start >= 0 {
			value := payload.Prompt[start+len(objectiveMarker):]
			if end := strings.Index(value, manifestMarker); end >= 0 {
				objective = strings.TrimSpace(value[:end])
			}
		}
	}
	return orchestrator.PlanningRequest{
		RequestID: task.RequestID, TaskID: task.TaskID, Objective: objective, Status: task.Status,
		Attempt: task.Attempt, MaxAttempts: task.MaxAttempts, LastError: task.LastError,
		CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt,
	}
}

func (s *Service) ApproveOrchestratorPlan(ctx context.Context, sessionID, planID string) (orchestrator.Overview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	lock := s.orchestratorProjectLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	plan, err := s.orchestrator.GetPlan(ctx, planID)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	if plan.ProjectPath != item.ProjectPath {
		return orchestrator.Overview{}, errors.New("plan does not belong to this project")
	}
	plan.Status = orchestrator.PlanActive
	plan.UpdatedAt = time.Now().UTC()
	if err := s.orchestrator.PutPlan(ctx, plan); err != nil {
		return orchestrator.Overview{}, err
	}
	if err := s.recalculateOrchestratorTasks(ctx, item.ProjectPath); err != nil {
		return orchestrator.Overview{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.plan_approved", map[string]any{"plan_id": plan.ID})
	return s.OrchestratorOverview(ctx, sessionID)
}
