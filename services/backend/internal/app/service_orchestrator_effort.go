package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

func (s *Service) orchestratorPlanningEffort(sessionID, projectPath, requestID string) (string, error) {
	owner, err := s.store.Get(sessionID)
	if err != nil {
		return "", err
	}
	effort := normalizeReasoningEffort(owner.ReasoningEffort)
	tasks, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ProjectID: projectPath, RequestID: requestID, Type: "ORCHESTRATOR_PLAN", Limit: 20,
	})
	if err != nil {
		return "", err
	}
	for _, task := range tasks {
		var payload struct {
			ReasoningEffort string `json:"reasoning_effort"`
		}
		if json.Unmarshal(task.Payload, &payload) == nil && domain.ValidReasoningEffort(domain.ReasoningEffort(payload.ReasoningEffort)) {
			return payload.ReasoningEffort, nil
		}
	}
	return string(effort), nil
}

func (s *Service) SetOrchestratorTaskEffort(ctx context.Context, sessionID, taskID string, effort domain.ReasoningEffort) (orchestrator.Task, error) {
	if !domain.ValidReasoningEffort(effort) {
		return orchestrator.Task{}, errors.New("unsupported reasoning effort")
	}
	owner, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	lock := s.orchestratorProjectLock(owner.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	if task.ProjectPath != owner.ProjectPath {
		return orchestrator.Task{}, errors.New("task does not belong to this project")
	}
	if task.ReasoningEffort == string(effort) {
		return task, nil
	}
	if task.Status == orchestrator.TaskDoing {
		runs, runErr := s.orchestrator.ListRuns(ctx, task.ID)
		if runErr != nil || len(runs) == 0 || runs[len(runs)-1].SessionID == "" {
			return orchestrator.Task{}, errors.New("active task has no Agent session for the next effort setting")
		}
		if _, runErr = s.SetReasoningEffort(runs[len(runs)-1].SessionID, effort); runErr != nil {
			return orchestrator.Task{}, runErr
		}
	}
	task.ReasoningEffort = string(effort)
	task.UpdatedAt = time.Now().UTC()
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return orchestrator.Task{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.task_effort_changed", map[string]any{"task_id": task.ID, "reasoning_effort": effort})
	return task, nil
}
