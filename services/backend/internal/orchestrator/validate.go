package orchestrator

import (
	"errors"
	"fmt"
	"strings"
)

func ValidTaskStatus(status TaskStatus) bool {
	switch status {
	case TaskPending, TaskWaiting, TaskReady, TaskDoing, TaskReview, TaskComplete, TaskArchived:
		return true
	default:
		return false
	}
}

func ValidPriority(priority Priority) bool {
	switch priority {
	case PriorityLow, PriorityNormal, PriorityHigh, PriorityUrgent:
		return true
	default:
		return false
	}
}

func ValidateProposal(proposal Proposal) error {
	if proposal.Protocol != ProtocolV1 {
		return fmt.Errorf("unsupported orchestrator proposal protocol %q", proposal.Protocol)
	}
	if strings.TrimSpace(proposal.Title) == "" || strings.TrimSpace(proposal.Objective) == "" {
		return errors.New("orchestrator proposal requires title and objective")
	}
	if len(proposal.Tasks) == 0 {
		return errors.New("orchestrator proposal requires at least one task")
	}
	if len(proposal.Tasks) > 128 {
		return errors.New("orchestrator proposal exceeds the 128 task limit")
	}
	ids := make(map[string]struct{}, len(proposal.Tasks))
	for _, task := range proposal.Tasks {
		id := strings.TrimSpace(task.ID)
		if id == "" || strings.TrimSpace(task.Title) == "" {
			return errors.New("every proposed task requires an id and title")
		}
		if _, exists := ids[id]; exists {
			return fmt.Errorf("duplicate proposed task id %q", id)
		}
		if task.Priority != "" && !ValidPriority(task.Priority) {
			return fmt.Errorf("task %q has unsupported priority %q", id, task.Priority)
		}
		ids[id] = struct{}{}
	}
	for _, task := range proposal.Tasks {
		for _, dependency := range task.DependsOn {
			if dependency == task.ID {
				return fmt.Errorf("task %q cannot depend on itself", task.ID)
			}
			if _, exists := ids[dependency]; !exists {
				return fmt.Errorf("task %q depends on unknown task %q", task.ID, dependency)
			}
		}
	}
	return validateAcyclicProposal(proposal.Tasks)
}

func ValidateTaskGraph(tasks []Task) error {
	byID := make(map[string]Task, len(tasks))
	for _, task := range tasks {
		byID[task.ID] = task
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if visiting[id] {
			return fmt.Errorf("task dependency cycle contains %s", id)
		}
		if visited[id] {
			return nil
		}
		visiting[id] = true
		for _, dependency := range byID[id].DependsOn {
			if dependency == id {
				return fmt.Errorf("task %s cannot depend on itself", id)
			}
			if _, exists := byID[dependency]; !exists {
				return fmt.Errorf("task %s depends on unknown task %s", id, dependency)
			}
			if err := visit(dependency); err != nil {
				return err
			}
		}
		visiting[id] = false
		visited[id] = true
		return nil
	}
	for id := range byID {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}

func EvaluateReadiness(task Task, tasks []Task, plan PlanStatus) (TaskStatus, TaskCondition) {
	if task.Status == TaskArchived || task.Status == TaskDoing || task.Status == TaskReview || task.Status == TaskComplete {
		return task.Status, task.Condition
	}
	if task.PlanID != "" && plan != PlanActive && plan != PlanCompleted {
		return TaskPending, ConditionPlanApproval
	}
	byID := make(map[string]Task, len(tasks))
	for _, candidate := range tasks {
		byID[candidate.ID] = candidate
	}
	for _, dependency := range task.DependsOn {
		candidate, exists := byID[dependency]
		if !exists || candidate.Status != TaskComplete {
			return TaskWaiting, ConditionDependency
		}
	}
	if task.Condition == ConditionManualPause || task.Condition == ConditionMissingContext || task.Condition == ConditionApproval || task.Condition == ConditionConflict || task.Condition == ConditionFailedRun || task.Condition == ConditionStaleDependency {
		return TaskPending, task.Condition
	}
	if task.Status == TaskReady {
		return TaskReady, ConditionNone
	}
	return TaskPending, ConditionNone
}

func validateAcyclicProposal(tasks []ProposalTask) error {
	converted := make([]Task, 0, len(tasks))
	for _, task := range tasks {
		converted = append(converted, Task{ID: task.ID, DependsOn: append([]string(nil), task.DependsOn...)})
	}
	return ValidateTaskGraph(converted)
}
