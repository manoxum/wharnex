package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

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
	for _, task := range tasks {
		if task.Status == orchestrator.TaskDoing {
			if err := s.reconcileOrchestratorWorkerRun(ctx, task.ID); err != nil {
				return orchestrator.Overview{}, err
			}
		}
	}
	tasks, err = s.orchestrator.ListTasks(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	if err := s.ensureLegacyDoingOrchestratorTasksQueued(ctx, item, tasks); err != nil {
		return orchestrator.Overview{}, err
	}
	if err := s.ensureReadyOrchestratorTasksQueued(ctx, item, tasks); err != nil {
		return orchestrator.Overview{}, err
	}
	tasks, err = s.orchestrator.ListTasks(ctx, item.ProjectPath)
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
	return orchestrator.Overview{Plans: plans, Tasks: tasks, PlanningRequests: planning, MutationSlots: s.executionQueue.currentCapacity(), MutationSlotsUsed: used}, nil
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
