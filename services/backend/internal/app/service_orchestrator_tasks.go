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
	if err == nil {
		task = created
	}
	s.bus.Publish(sessionID, "orchestrator.task_created", map[string]any{"task_id": task.ID, "plan_id": task.PlanID})
	return task, err
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
	if target == orchestrator.TaskDoing || target == orchestrator.TaskReview || target == orchestrator.TaskFailed {
		return orchestrator.Task{}, errors.New("DOING, REVIEW and FAILED are controlled by Orchestrator execution")
	}
	if task.Status == orchestrator.TaskDoing {
		return orchestrator.Task{}, errors.New("a DOING task is controlled by its Agent run and cannot be moved manually")
	}
	if target == orchestrator.TaskReady || target == orchestrator.TaskWaiting {
		if !orchestratorAutomaticExecutionAllowed(item) {
			return orchestrator.Task{}, errors.New("READY execution requires Protected mode with Auto or Auto Approve")
		}
		if err := s.releaseOrchestratorChain(ctx, item.ProjectPath, task.ID); err != nil {
			return orchestrator.Task{}, err
		}
	} else {
		if target == orchestrator.TaskComplete && task.Status != orchestrator.TaskReview {
			return orchestrator.Task{}, errors.New("only a reviewed task can be completed")
		}
		wasSuccessful := task.Status == orchestrator.TaskReview || task.Status == orchestrator.TaskComplete
		task.Status, task.UpdatedAt = target, time.Now().UTC()
		if target == orchestrator.TaskPending {
			task.Condition = orchestrator.ConditionManualPause
		} else {
			task.Condition = orchestrator.ConditionNone
		}
		if err := s.orchestrator.PutTask(ctx, task); err != nil {
			return orchestrator.Task{}, err
		}
		if wasSuccessful && target != orchestrator.TaskComplete {
			if err := s.invalidateOrchestratorDependents(ctx, item.ProjectPath, task.ID); err != nil {
				return orchestrator.Task{}, err
			}
		}
	}
	if err := s.recalculateOrchestratorTasks(ctx, item.ProjectPath); err != nil {
		return orchestrator.Task{}, err
	}
	updated, err := s.orchestrator.GetTask(ctx, task.ID)
	if err == nil {
		task = updated
	}
	if target == orchestrator.TaskReady || target == orchestrator.TaskWaiting || target == orchestrator.TaskComplete {
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
	s.bus.Publish(sessionID, "orchestrator.task_transitioned", map[string]any{"task_id": task.ID, "status": task.Status, "condition": task.Condition})
	s.reconcileProjectTodosForOrchestratorPlan(ctx, item.ProjectPath, task.PlanID)
	return task, err
}
