package app

import (
	"context"
	"errors"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

type orchestratorTransitionDecision struct {
	allowed   bool
	release   bool
	status    orchestrator.TaskStatus
	condition orchestrator.TaskCondition
	reason    string
}

var orchestratorManualTransitionTargets = []orchestrator.TaskStatus{
	orchestrator.TaskPending,
	orchestrator.TaskWaiting,
	orchestrator.TaskReady,
	orchestrator.TaskComplete,
	orchestrator.TaskArchived,
}

func evaluateOrchestratorTaskTransition(owner domain.Session, task orchestrator.Task, target orchestrator.TaskStatus, tasks []orchestrator.Task, plans map[string]orchestrator.PlanStatus) orchestratorTransitionDecision {
	deny := func(reason string) orchestratorTransitionDecision {
		return orchestratorTransitionDecision{reason: reason}
	}
	if !orchestrator.ValidTaskStatus(target) {
		return deny("unsupported task status")
	}
	if target == orchestrator.TaskDoing || target == orchestrator.TaskReview || target == orchestrator.TaskFailed {
		return deny("DOING, REVIEW and FAILED are controlled by Orchestrator execution")
	}
	if (target == orchestrator.TaskReady || target == orchestrator.TaskPending) && orchestrator.TaskHasEnteredDoing(task) {
		return deny("task already entered DOING and cannot be manually moved to READY or PENDING; use explicit retry for FAILED tasks or create a new task after completion/archive")
	}
	if task.Status == orchestrator.TaskDoing {
		return deny("a DOING task is controlled by its Agent run and cannot be moved manually")
	}
	if task.Status == orchestrator.TaskArchived {
		return deny("an ARCHIVED task is historical and read-only")
	}
	if orchestrator.TaskHasCompleted(task) {
		if task.Status == orchestrator.TaskComplete && target == orchestrator.TaskArchived {
			return orchestratorTransitionDecision{allowed: true, status: orchestrator.TaskArchived, condition: orchestrator.ConditionNone}
		}
		return deny("a completed task is terminal and can only be archived")
	}
	if target == orchestrator.TaskComplete {
		if task.Status != orchestrator.TaskReview {
			return deny("only a reviewed task can be completed")
		}
		return orchestratorTransitionDecision{allowed: true, status: orchestrator.TaskComplete, condition: orchestrator.ConditionNone}
	}
	if target == orchestrator.TaskArchived {
		return orchestratorTransitionDecision{allowed: true, status: orchestrator.TaskArchived, condition: orchestrator.ConditionNone}
	}
	if target == orchestrator.TaskPending {
		if task.Status == orchestrator.TaskFailed {
			return deny("a FAILED task requires an explicit retry")
		}
		return orchestratorTransitionDecision{allowed: true, status: orchestrator.TaskPending, condition: orchestrator.ConditionManualPause}
	}
	if target != orchestrator.TaskReady && target != orchestrator.TaskWaiting {
		return deny("unsupported manual task transition")
	}
	if task.Status != orchestrator.TaskPending && task.Status != orchestrator.TaskWaiting && task.Status != orchestrator.TaskReady {
		return deny("only pending or released tasks can be released")
	}
	if !orchestratorAutomaticExecutionAllowed(owner) {
		return deny("READY execution requires Protected mode with Auto or Auto Approve")
	}
	if task.PlanID != "" && plans[task.PlanID] != orchestrator.PlanActive && plans[task.PlanID] != orchestrator.PlanCompleted {
		return deny("orchestrator plan must be approved before releasing tasks")
	}
	probe := task
	probe.Status, probe.Condition = orchestrator.TaskReady, orchestrator.ConditionNone
	status, condition := orchestrator.EvaluateReadiness(probe, tasks, plans[task.PlanID])
	if status != orchestrator.TaskReady && status != orchestrator.TaskWaiting {
		return deny("orchestrator task cannot be released")
	}
	return orchestratorTransitionDecision{allowed: true, release: true, status: status, condition: condition}
}

func orchestratorAllowedTaskTransitions(owner domain.Session, task orchestrator.Task, tasks []orchestrator.Task, plans map[string]orchestrator.PlanStatus) []orchestrator.TaskStatus {
	allowed := make([]orchestrator.TaskStatus, 0, len(orchestratorManualTransitionTargets))
	seen := make(map[orchestrator.TaskStatus]bool, len(orchestratorManualTransitionTargets))
	for _, target := range orchestratorManualTransitionTargets {
		decision := evaluateOrchestratorTaskTransition(owner, task, target, tasks, plans)
		if !decision.allowed || decision.status == task.Status || seen[decision.status] {
			continue
		}
		seen[decision.status] = true
		allowed = append(allowed, decision.status)
	}
	return allowed
}

func orchestratorPlanStatuses(plans []orchestrator.Plan) map[string]orchestrator.PlanStatus {
	statuses := make(map[string]orchestrator.PlanStatus, len(plans))
	for _, plan := range plans {
		statuses[plan.ID] = plan.Status
	}
	return statuses
}

func projectOrchestratorTaskTransitions(owner domain.Session, tasks []orchestrator.Task, plans []orchestrator.Plan) []orchestrator.Task {
	projected := append([]orchestrator.Task(nil), tasks...)
	statuses := orchestratorPlanStatuses(plans)
	for index := range projected {
		allowed := orchestratorAllowedTaskTransitions(owner, projected[index], tasks, statuses)
		projected[index].AllowedTransitions = &allowed
	}
	return projected
}

func (s *Service) projectOrchestratorTask(ctx context.Context, owner domain.Session, task orchestrator.Task) (orchestrator.Task, error) {
	tasks, err := s.orchestrator.ListTasks(ctx, owner.ProjectPath)
	if err != nil {
		return orchestrator.Task{}, err
	}
	plans, err := s.orchestrator.ListPlans(ctx, owner.ProjectPath)
	if err != nil {
		return orchestrator.Task{}, err
	}
	for _, projected := range projectOrchestratorTaskTransitions(owner, tasks, plans) {
		if projected.ID == task.ID {
			return projected, nil
		}
	}
	return orchestrator.Task{}, errors.New("orchestrator task is unavailable")
}
