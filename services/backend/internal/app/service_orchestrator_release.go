package app

import (
	"context"
	"errors"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
)

// releaseOrchestratorChain releases a requested task and every still-pending
// ancestor. Readiness is derived from the updated DAG, never from the Kanban
// column onto which the operator dropped the card.
func (s *Service) releaseOrchestratorChain(ctx context.Context, projectPath, taskID string) error {
	tasks, err := s.orchestrator.ListTasks(ctx, projectPath)
	if err != nil {
		return err
	}
	if err := orchestrator.ValidateTaskGraph(tasks); err != nil {
		return err
	}
	plans, err := s.orchestrator.ListPlans(ctx, projectPath)
	if err != nil {
		return err
	}
	planStatus := make(map[string]orchestrator.PlanStatus, len(plans))
	for _, plan := range plans {
		planStatus[plan.ID] = plan.Status
	}
	byID := make(map[string]int, len(tasks))
	for index, task := range tasks {
		byID[task.ID] = index
	}
	if _, exists := byID[taskID]; !exists {
		return errors.New("orchestrator task is unavailable")
	}
	visited := make(map[string]bool, len(tasks))
	var release func(string) error
	release = func(id string) error {
		if visited[id] {
			return nil
		}
		visited[id] = true
		index := byID[id]
		for _, dependencyID := range tasks[index].DependsOn {
			dependency := tasks[byID[dependencyID]]
			if !orchestrator.TaskHasCompleted(dependency) && (dependency.Status == orchestrator.TaskPending || dependency.Status == orchestrator.TaskWaiting) {
				if err := release(dependencyID); err != nil {
					return err
				}
			}
		}
		current := tasks[index]
		if orchestrator.TaskHasCompleted(current) {
			return errors.New("completed orchestrator task cannot be released")
		}
		if current.Status != orchestrator.TaskPending && current.Status != orchestrator.TaskWaiting && current.Status != orchestrator.TaskReady && !(id == taskID && current.Status == orchestrator.TaskFailed) {
			return nil
		}
		if current.PlanID != "" && planStatus[current.PlanID] != orchestrator.PlanActive && planStatus[current.PlanID] != orchestrator.PlanCompleted {
			return errors.New("orchestrator plan must be approved before releasing tasks")
		}
		probe := current
		probe.Status, probe.Condition = orchestrator.TaskReady, orchestrator.ConditionNone
		status, condition := orchestrator.EvaluateReadiness(probe, tasks, planStatus[current.PlanID])
		if status != orchestrator.TaskReady && status != orchestrator.TaskWaiting {
			return errors.New("orchestrator task cannot be released")
		}
		if current.Status == status && current.Condition == condition {
			return nil
		}
		current.Status, current.Condition, current.UpdatedAt = status, condition, time.Now().UTC()
		tasks[index] = current
		return s.orchestrator.PutTask(ctx, current)
	}
	return release(taskID)
}
