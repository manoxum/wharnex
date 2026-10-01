package app

import (
	"context"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/orchestrator"
)

func (s *Service) persistOrchestratorProposal(ctx context.Context, sessionID, projectPath, requestID string, proposal orchestrator.Proposal) (OrchestratorProposalResult, error) {
	if err := orchestrator.ValidateProposal(proposal); err != nil {
		return OrchestratorProposalResult{}, err
	}
	effort, err := s.orchestratorPlanningEffort(sessionID, projectPath, requestID)
	if err != nil {
		return OrchestratorProposalResult{}, err
	}
	now := time.Now().UTC()
	plan := orchestrator.Plan{
		ID: ids.New("opl"), ProjectPath: projectPath, Title: strings.TrimSpace(proposal.Title),
		Objective: strings.TrimSpace(proposal.Objective), Status: orchestrator.PlanDraft,
		PlannerRequestID: requestID, Assumptions: append([]string(nil), proposal.Assumptions...), ReasoningEffort: effort, CreatedAt: now, UpdatedAt: now,
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
			BarrierFiles: append([]string(nil), candidate.BarrierFiles...), ReasoningEffort: effort, CreatedAt: now, UpdatedAt: now,
		})
	}
	if err := s.orchestrator.CreatePlan(ctx, plan, tasks); err != nil {
		return OrchestratorProposalResult{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.plan_proposed", map[string]any{"project_path": projectPath, "plan_id": plan.ID, "request_id": requestID, "tasks": len(tasks)})
	return OrchestratorProposalResult{RequestID: requestID, Plan: &plan, Tasks: tasks}, nil
}
