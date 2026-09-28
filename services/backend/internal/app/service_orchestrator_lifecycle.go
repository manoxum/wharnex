package app

import (
	"context"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
)

func (s *Service) recalculateOrchestratorTasks(ctx context.Context, projectPath string) error {
	tasks, err := s.orchestrator.ListTasks(ctx, projectPath)
	if err != nil {
		return err
	}
	plans, err := s.orchestrator.ListPlans(ctx, projectPath)
	if err != nil {
		return err
	}
	planStatus := orchestratorPlanStatuses(plans)
	for _, task := range tasks {
		if orchestrator.TaskHasCompleted(task) || (task.Status != orchestrator.TaskPending && task.Status != orchestrator.TaskWaiting && task.Status != orchestrator.TaskReady) {
			continue
		}
		status, condition := orchestrator.EvaluateReadiness(task, tasks, planStatus[task.PlanID])
		if status == task.Status && condition == task.Condition {
			continue
		}
		task.Status, task.Condition, task.UpdatedAt = status, condition, time.Now().UTC()
		if err := s.orchestrator.PutTask(ctx, task); err != nil {
			return err
		}
	}
	return s.syncOrchestratorPlanStatus(ctx, plans, tasks)
}

func (s *Service) syncOrchestratorPlanStatus(ctx context.Context, plans []orchestrator.Plan, tasks []orchestrator.Task) error {
	for _, plan := range plans {
		if plan.Status != orchestrator.PlanActive {
			continue
		}
		count, terminal := 0, 0
		for _, task := range tasks {
			if task.PlanID != plan.ID {
				continue
			}
			count++
			if orchestrator.TaskHasCompleted(task) {
				terminal++
			}
		}
		target := orchestrator.PlanActive
		if count > 0 && terminal == count {
			target = orchestrator.PlanCompleted
		}
		if target == plan.Status {
			continue
		}
		plan.Status = target
		plan.UpdatedAt = time.Now().UTC()
		if err := s.orchestrator.PutPlan(ctx, plan); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) invalidateOrchestratorDependents(ctx context.Context, projectPath, dependencyID string) error {
	tasks, err := s.orchestrator.ListTasks(ctx, projectPath)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		if !containsOrchestratorDependency(task.DependsOn, dependencyID) || orchestrator.TaskHasCompleted(task) || task.Status == orchestrator.TaskArchived {
			continue
		}
		if task.Status == orchestrator.TaskReview {
			task.Status = orchestrator.TaskPending
			task.Condition = orchestrator.ConditionStaleDependency
		} else if task.Status != orchestrator.TaskDoing {
			task.Status = orchestrator.TaskWaiting
			task.Condition = orchestrator.ConditionDependency
		} else {
			continue
		}
		task.UpdatedAt = time.Now().UTC()
		if err := s.orchestrator.PutTask(ctx, task); err != nil {
			return err
		}
	}
	return nil
}
