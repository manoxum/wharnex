package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/planner"
)

type OrchestratorProposalResult struct {
	RequestID    string              `json:"request_id"`
	Plan         *orchestrator.Plan  `json:"plan,omitempty"`
	Tasks        []orchestrator.Task `json:"tasks,omitempty"`
	ManualPrompt string              `json:"manual_prompt,omitempty"`
}

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
			return OrchestratorProposalResult{RequestID: requestID, ManualPrompt: result.ManualPrompt}, nil
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
	used := 0
	for _, task := range tasks {
		if task.Status == orchestrator.TaskDoing {
			used++
		}
	}
	return orchestrator.Overview{Plans: plans, Tasks: tasks, MutationSlots: 1, MutationSlotsUsed: used}, nil
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
