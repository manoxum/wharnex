package app

import (
	"context"
	"encoding/json"
	"sync"
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
	planStatus := make(map[string]orchestrator.PlanStatus, len(plans))
	for _, plan := range plans {
		planStatus[plan.ID] = plan.Status
	}
	for _, task := range tasks {
		if task.Status != orchestrator.TaskPending && task.Status != orchestrator.TaskWaiting && task.Status != orchestrator.TaskReady {
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
		if plan.Status != orchestrator.PlanActive && plan.Status != orchestrator.PlanCompleted {
			continue
		}
		count, terminal := 0, 0
		for _, task := range tasks {
			if task.PlanID != plan.ID {
				continue
			}
			count++
			if task.Status == orchestrator.TaskComplete || task.Status == orchestrator.TaskArchived {
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

func (s *Service) orchestratorProjectLock(projectPath string) *sync.Mutex {
	s.orchestratorMu.Lock()
	defer s.orchestratorMu.Unlock()
	lock := s.orchestratorLocks[projectPath]
	if lock == nil {
		lock = &sync.Mutex{}
		s.orchestratorLocks[projectPath] = lock
	}
	return lock
}

func (s *Service) invalidateOrchestratorDependents(ctx context.Context, projectPath, dependencyID string) error {
	tasks, err := s.orchestrator.ListTasks(ctx, projectPath)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		if !containsOrchestratorDependency(task.DependsOn, dependencyID) {
			continue
		}
		if task.Status == orchestrator.TaskComplete || task.Status == orchestrator.TaskReview {
			task.Status = orchestrator.TaskPending
			task.Condition = orchestrator.ConditionStaleDependency
		} else if task.Status != orchestrator.TaskDoing && task.Status != orchestrator.TaskArchived {
			task.Status = orchestrator.TaskWaiting
			task.Condition = orchestrator.ConditionDependency
		}
		task.UpdatedAt = time.Now().UTC()
		if err := s.orchestrator.PutTask(ctx, task); err != nil {
			return err
		}
	}
	return nil
}

func containsOrchestratorDependency(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func orchestratorTaskPrompt(task orchestrator.Task) string {
	payload, _ := json.MarshalIndent(map[string]any{
		"title": task.Title, "description": task.Description, "acceptance_criteria": task.AcceptanceCriteria,
		"impact_files": task.ImpactFiles, "read_files": task.ReadFiles, "barrier_files": task.BarrierFiles,
	}, "", "  ")
	return "Execute this Orchestrator task as one normal Agent request. Do not bypass the existing Policy, Protected sandbox, verification, or Apply pipeline.\n\n" + string(payload)
}
