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

type orchestratorPlanProgress struct {
	total     int
	completed int
	review    int
}

func (progress orchestratorPlanProgress) allCompleted() bool {
	return progress.total > 0 && progress.completed == progress.total
}

func (progress orchestratorPlanProgress) allReviewOrCompleted() bool {
	return progress.review > 0 && progress.review+progress.completed == progress.total
}

func orchestratorPlanTaskProgress(planID string, tasks []orchestrator.Task) orchestratorPlanProgress {
	progress := orchestratorPlanProgress{}
	for _, task := range tasks {
		if task.PlanID != planID {
			continue
		}
		progress.total++
		if orchestrator.TaskHasCompleted(task) {
			progress.completed++
		} else if task.Status == orchestrator.TaskReview {
			progress.review++
		}
	}
	return progress
}

func orchestratorPlanningRequestPhase(requestID string, plans []orchestrator.Plan, tasks []orchestrator.Task) orchestrator.OrchestrationPhase {
	planIndex := -1
	for index := range plans {
		if plans[index].PlannerRequestID != requestID {
			continue
		}
		if planIndex < 0 || plans[index].UpdatedAt.After(plans[planIndex].UpdatedAt) {
			planIndex = index
		}
	}
	if planIndex < 0 {
		return orchestrator.OrchestrationPhasePlanning
	}
	plan := plans[planIndex]
	switch plan.Status {
	case orchestrator.PlanDraft:
		return orchestrator.OrchestrationPhaseAwaitingApproval
	case orchestrator.PlanArchived:
		return orchestrator.OrchestrationPhaseArchived
	}
	progress := orchestratorPlanTaskProgress(plan.ID, tasks)
	if progress.allCompleted() {
		return orchestrator.OrchestrationPhaseCompleted
	}
	if progress.allReviewOrCompleted() {
		return orchestrator.OrchestrationPhaseReview
	}
	return orchestrator.OrchestrationPhaseExecuting
}

func (s *Service) syncOrchestratorPlanStatus(ctx context.Context, plans []orchestrator.Plan, tasks []orchestrator.Task) error {
	for _, plan := range plans {
		if plan.Status != orchestrator.PlanActive {
			continue
		}
		progress := orchestratorPlanTaskProgress(plan.ID, tasks)
		target := orchestrator.PlanActive
		if progress.allCompleted() {
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
