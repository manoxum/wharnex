package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/orchestrator"
)

func (s *Service) CreateOrchestratorTask(ctx context.Context, sessionID string, input OrchestratorTaskInput) (orchestrator.Task, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	lock := s.orchestratorProjectLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	if strings.TrimSpace(input.Title) == "" {
		return orchestrator.Task{}, errors.New("task title is required")
	}
	if input.Priority == "" {
		input.Priority = orchestrator.PriorityNormal
	}
	if !orchestrator.ValidPriority(input.Priority) {
		return orchestrator.Task{}, fmt.Errorf("unsupported task priority %q", input.Priority)
	}
	now := time.Now().UTC()
	task := orchestrator.Task{ID: ids.New("otk"), ProjectPath: item.ProjectPath, PlanID: input.PlanID, Title: strings.TrimSpace(input.Title), Description: strings.TrimSpace(input.Description), AcceptanceCriteria: append([]string(nil), input.AcceptanceCriteria...), Status: orchestrator.TaskPending, Condition: orchestrator.ConditionNone, Priority: input.Priority, DependsOn: append([]string(nil), input.DependsOn...), Capability: input.Capability, ReasoningEffort: string(normalizeReasoningEffort(item.ReasoningEffort)), CreatedAt: now, UpdatedAt: now}
	if input.PlanID != "" {
		plan, err := s.orchestrator.GetPlan(ctx, input.PlanID)
		if err != nil || plan.ProjectPath != item.ProjectPath {
			return orchestrator.Task{}, errors.New("task plan does not belong to this project")
		}
		if plan.Status != orchestrator.PlanActive {
			task.Condition = orchestrator.ConditionPlanApproval
		}
		if plan.ReasoningEffort != "" {
			task.ReasoningEffort = plan.ReasoningEffort
		}
	}
	tasks, err := s.orchestrator.ListTasks(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Task{}, err
	}
	if err := orchestrator.ValidateTaskGraph(append(tasks, task)); err != nil {
		return orchestrator.Task{}, err
	}
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return orchestrator.Task{}, err
	}
	if err := s.recalculateOrchestratorTasks(ctx, item.ProjectPath); err != nil {
		return orchestrator.Task{}, err
	}
	created, err := s.orchestrator.GetTask(ctx, task.ID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	task, err = s.projectOrchestratorTask(ctx, item, created)
	if err != nil {
		return orchestrator.Task{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.task_created", map[string]any{"task_id": task.ID, "plan_id": task.PlanID})
	return task, nil
}

func (s *Service) TransitionOrchestratorTask(ctx context.Context, sessionID, taskID string, target orchestrator.TaskStatus) (orchestrator.Task, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	lock := s.orchestratorProjectLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	if task.ProjectPath != item.ProjectPath {
		return orchestrator.Task{}, errors.New("task does not belong to this project")
	}
	if !orchestrator.ValidTaskStatus(target) {
		return orchestrator.Task{}, fmt.Errorf("unsupported task status %q", target)
	}
	tasks, err := s.orchestrator.ListTasks(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Task{}, err
	}
	plans, err := s.orchestrator.ListPlans(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Task{}, err
	}
	decision := evaluateOrchestratorTaskTransition(item, task, target, tasks, orchestratorPlanStatuses(plans))
	if !decision.allowed {
		return orchestrator.Task{}, errors.New(decision.reason)
	}
	if decision.release {
		if err := s.releaseOrchestratorChain(ctx, item.ProjectPath, task.ID); err != nil {
			return orchestrator.Task{}, err
		}
	} else {
		wasSuccessful := orchestrator.TaskSatisfiesDependency(task)
		if orchestrator.TaskHasCompleted(task) || decision.status == orchestrator.TaskComplete {
			task.WasCompleted = true
		}
		task.Status, task.Condition, task.UpdatedAt = decision.status, decision.condition, time.Now().UTC()
		if err := s.orchestrator.PutTask(ctx, task); err != nil {
			return orchestrator.Task{}, err
		}
		if wasSuccessful && !orchestrator.TaskSatisfiesDependency(task) {
			if err := s.invalidateOrchestratorDependents(ctx, item.ProjectPath, task.ID); err != nil {
				return orchestrator.Task{}, err
			}
		}
	}
	if err := s.recalculateOrchestratorTasks(ctx, item.ProjectPath); err != nil {
		return orchestrator.Task{}, err
	}
	updated, err := s.orchestrator.GetTask(ctx, task.ID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	task = updated
	if decision.release || task.Status == orchestrator.TaskComplete {
		all, err := s.orchestrator.ListTasks(ctx, item.ProjectPath)
		if err != nil {
			return orchestrator.Task{}, err
		}
		if err := s.ensureReadyOrchestratorTasksQueued(ctx, item, all); err != nil {
			return orchestrator.Task{}, err
		}
	} else if task.Status != orchestrator.TaskDoing {
		_, _ = s.store.CancelChatAgentLineage(task.ID)
	}
	task, err = s.projectOrchestratorTask(ctx, item, task)
	if err != nil {
		return orchestrator.Task{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.task_transitioned", map[string]any{"task_id": task.ID, "status": task.Status, "condition": task.Condition})
	s.reconcileProjectTodosForOrchestratorPlan(ctx, item.ProjectPath, task.PlanID)
	return task, nil
}

func (s *Service) orchestratorPlanningTasksWithRuns(ctx context.Context, projectPath, planID string) ([]orchestrator.PlanningTaskDetail, error) {
	details := make([]orchestrator.PlanningTaskDetail, 0)
	if strings.TrimSpace(planID) == "" {
		return details, nil
	}
	tasks, err := s.orchestrator.ListTasks(ctx, projectPath)
	if err != nil {
		return nil, err
	}
	for _, task := range tasks {
		if task.ProjectPath != projectPath || task.PlanID != planID {
			continue
		}
		runs, err := s.orchestrator.ListRuns(ctx, task.ID)
		if err != nil {
			return nil, err
		}
		filteredRuns := make([]orchestrator.TaskRun, 0, len(runs))
		for _, run := range runs {
			if run.TaskID != task.ID || (run.ProjectPath != "" && run.ProjectPath != projectPath) {
				continue
			}
			filteredRuns = append(filteredRuns, run)
		}
		task.RetryContext = nil
		details = append(details, orchestrator.PlanningTaskDetail{Task: task, Runs: filteredRuns})
	}
	return details, nil
}
