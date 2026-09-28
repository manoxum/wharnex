package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
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
	if s.retryCanceledOrchestratorTasks(ctx, item, tasks) {
		tasks, err = s.orchestrator.ListTasks(ctx, item.ProjectPath)
		if err != nil {
			return orchestrator.Overview{}, err
		}
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
	plans, err = s.orchestrator.ListPlans(ctx, item.ProjectPath)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	tasks = projectOrchestratorTaskTransitions(item, tasks, plans)
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
	counts := map[orchestrator.TaskStatus]int{
		orchestrator.TaskPending: 0, orchestrator.TaskWaiting: 0, orchestrator.TaskReady: 0, orchestrator.TaskDoing: 0,
		orchestrator.TaskReview: 0, orchestrator.TaskFailed: 0, orchestrator.TaskComplete: 0, orchestrator.TaskArchived: 0,
	}
	used := 0
	for _, task := range tasks {
		counts[task.Status]++
		if task.Status == orchestrator.TaskDoing {
			used++
		}
	}
	return orchestrator.Overview{Plans: plans, Tasks: tasks, TaskCounts: counts, PlanningRequests: planning, MutationSlots: s.executionQueue.currentCapacity(), MutationSlotsUsed: used}, nil
}

func (s *Service) OrchestratorTasksPage(ctx context.Context, sessionID string, filter orchestrator.TaskPageFilter) (orchestrator.TaskPage, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.TaskPage{}, err
	}
	page, err := s.orchestrator.ListTaskPage(ctx, item.ProjectPath, filter)
	if err != nil {
		return orchestrator.TaskPage{}, err
	}
	// Terminal pages contain only COMPLETE/ARCHIVED tasks, whose allowed
	// transitions are independent of plan/dependency state. Still use the same
	// lifecycle decision function as mutations so the API cannot drift.
	page.Tasks = projectOrchestratorTaskTransitions(item, page.Tasks, nil)
	return page, nil
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

// orchestratorCanceledRetryLimit bounds automatic retries of executions a
// restart canceled, so a task that is itself the reason for the restarts cannot
// loop.
const orchestratorCanceledRetryLimit = 3

// retryCanceledOrchestratorTasks returns to READY a FAILED task whose current
// run failed only because its execution context was canceled — a Wharnex
// restart, not a verdict on the plan — exactly as an operator retry would.
func (s *Service) retryCanceledOrchestratorTasks(ctx context.Context, owner domain.Session, tasks []orchestrator.Task) bool {
	if !orchestratorAutomaticExecutionAllowed(owner) {
		return false
	}
	retried := false
	for _, task := range tasks {
		if task.Status != orchestrator.TaskFailed {
			continue
		}
		runs, err := s.orchestrator.ListRuns(ctx, task.ID)
		if err != nil || len(runs) == 0 || runs[len(runs)-1].SessionID == "" {
			continue
		}
		agent, err := s.store.Get(runs[len(runs)-1].SessionID)
		if err != nil || agent.FailureKind != domain.FailureKindExecutionCanceled {
			continue
		}
		canceled := 0
		for _, run := range runs {
			if strings.Contains(run.Error, "context canceled") {
				canceled++
			}
		}
		if canceled > orchestratorCanceledRetryLimit {
			continue
		}
		guidance := "A execução anterior desta task foi interrompida porque o Wharnex reiniciou a meio (context canceled). O plano não foi rejeitado por Policy, verificação ou conteúdo. Esta conversa já contém esse plano; se continuar válido face ao código atual, reentregue-o; caso contrário, ajuste-o."
		if _, err := s.RetryOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskRetryContext{Guidance: guidance}); err != nil {
			s.bus.Publish(owner.ID, "orchestrator.canceled_retry_failed", map[string]any{"task_id": task.ID, "error": err.Error()})
			continue
		}
		s.bus.Publish(owner.ID, "orchestrator.canceled_execution_retried", map[string]any{"task_id": task.ID, "attempt": canceled})
		retried = true
	}
	return retried
}
