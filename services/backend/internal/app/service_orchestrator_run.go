package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/orchestrator"
)

func (s *Service) StartOrchestratorTask(ctx context.Context, sessionID, taskID string) (OrchestratorRunResult, error) {
	owner, err := s.store.Get(sessionID)
	if err != nil {
		return OrchestratorRunResult{}, err
	}
	lock := s.orchestratorProjectLock(owner.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return OrchestratorRunResult{}, err
	}
	if task.ProjectPath != owner.ProjectPath || task.Status != orchestrator.TaskReady {
		return OrchestratorRunResult{}, errors.New("task is not READY in this project")
	}
	runs, err := s.orchestrator.ListRuns(ctx, task.ID)
	if err != nil {
		return OrchestratorRunResult{}, err
	}
	now := time.Now().UTC()
	run := orchestrator.TaskRun{ID: ids.New("orun"), TaskID: task.ID, ProjectPath: task.ProjectPath, Attempt: len(runs) + 1, Status: "starting", StartedAt: now}
	task.Status = orchestrator.TaskDoing
	task.Condition = orchestrator.ConditionNone
	task.UpdatedAt = now
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return OrchestratorRunResult{}, err
	}
	if err := s.orchestrator.AppendRun(ctx, run); err != nil {
		task.Status = orchestrator.TaskReady
		task.UpdatedAt = time.Now().UTC()
		_ = s.orchestrator.PutTask(ctx, task)
		return OrchestratorRunResult{}, err
	}
	effort := domain.ReasoningEffort(task.ReasoningEffort)
	if !domain.ValidReasoningEffort(effort) {
		effort = normalizeReasoningEffort(owner.ReasoningEffort)
	}
	agentSession, err := s.StartSessionWithModes(ctx, task.ProjectPath, owner.ExecutionMode, owner.AutomationMode, orchestratorTaskEffortLevel(task, owner))
	if err != nil {
		return s.failOrchestratorRun(ctx, task, run, err)
	}
	agentSession, err = s.SetChatID(agentSession.ID, strings.ReplaceAll(task.ID, "_", "-"))
	if err != nil {
		return s.failOrchestratorRun(ctx, task, run, err)
	}
	agentSession, err = s.SetReasoningEffort(agentSession.ID, effort)
	if err != nil {
		return s.failOrchestratorRun(ctx, task, run, err)
	}
	run.SessionID = agentSession.ID
	run.Status = "planning"
	_ = s.orchestrator.AppendRun(ctx, run)
	result, agentSession, err := s.SubmitMessage(ctx, agentSession.ID, orchestratorTaskPrompt(task))
	if err != nil {
		return s.failOrchestratorRun(ctx, task, run, err)
	}
	run.RequestID = agentSession.LastRequestID
	if agentSession.Plan != nil {
		run.PlanID = agentSession.Plan.PlanID
	}
	run.Status = "running"
	manualPrompt := result.ManualPrompt
	switch orchestratorAgentOutcome(agentSession.State) {
	case "review":
		completed := time.Now().UTC()
		run.Status = "review"
		run.CompletedAt = &completed
		task.Status = orchestrator.TaskReview
		task.Condition = orchestrator.ConditionNone
	case "failed":
		completed := time.Now().UTC()
		run.Status = "failed"
		run.Error = agentSession.LastRepairError
		run.CompletedAt = &completed
		task.Status = orchestrator.TaskFailed
		task.Condition = orchestrator.ConditionFailedRun
	default:
		if manualPrompt != "" || agentSession.State == "awaiting_plan" {
			run.Status = "awaiting_agent"
			task.Condition = orchestrator.ConditionApproval
		}
	}
	task.UpdatedAt = time.Now().UTC()
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return OrchestratorRunResult{}, err
	}
	if err := s.orchestrator.AppendRun(ctx, run); err != nil {
		return OrchestratorRunResult{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.task_run_started", map[string]any{"task_id": task.ID, "run_id": run.ID, "agent_session_id": run.SessionID, "status": run.Status})
	return OrchestratorRunResult{Task: task, Run: run, ManualPrompt: manualPrompt}, nil
}

func (s *Service) OrchestratorTaskRuns(ctx context.Context, sessionID, taskID string) ([]orchestrator.TaskRun, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if task.ProjectPath != item.ProjectPath {
		return nil, errors.New("task does not belong to this project")
	}
	return s.orchestrator.ListRuns(ctx, taskID)
}

func (s *Service) failOrchestratorRun(ctx context.Context, task orchestrator.Task, run orchestrator.TaskRun, cause error) (OrchestratorRunResult, error) {
	completed := time.Now().UTC()
	run.Status = "failed"
	run.Error = cause.Error()
	run.CompletedAt = &completed
	task.Status = orchestrator.TaskFailed
	task.Condition = orchestrator.ConditionFailedRun
	task.UpdatedAt = completed
	_ = s.orchestrator.PutTask(ctx, task)
	_ = s.orchestrator.AppendRun(ctx, run)
	s.setProjectTodosByPlan(task.ProjectPath, task.PlanID, domain.ProjectTodoExecutionFailed, cause.Error())
	return OrchestratorRunResult{Task: task, Run: run}, cause
}
