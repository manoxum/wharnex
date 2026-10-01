package app

import (
	"context"
	"errors"
	"strings"

	"kernl.local/harness/backend/internal/orchestrator"
)

// An Orchestrator task is one agentic Main Request (ADR-0081). Its rounds
// travel on the agentic transport — PREPARE_PROMPT, AWAIT_RESPONSE,
// RECOVERY_WRITE — served by the Worker pinned to the task (ADR-0082). These
// entry points are what that transport needs where a chat has its renderer:
// the task's one conversation, delivery of its response bundle, and the end
// of a run a delivery cannot continue.

// SubmitOrchestratorTaskBundle ingests a task's response bundle captured by
// the agentic supervision, exactly as a chat ingests its Main Request bundle.
func (s *Service) SubmitOrchestratorTaskBundle(ctx context.Context, taskID, filename string, raw []byte) (OrchestratorWorkerRequest, error) {
	current, err := s.orchestratorWorkerRequest(ctx, taskID)
	if err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	if current.Task.Status != orchestrator.TaskDoing || current.ExpectedFilename != filename {
		return OrchestratorWorkerRequest{}, errors.New("orchestrator Worker bundle does not match the active Agent request")
	}
	if _, err := s.SubmitExecutionBundle(ctx, current.AgentSessionID, filename, raw); err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	if _, err := s.store.RecordChatAgentValidBundle(current.RequestID, "", 0); err != nil {
		s.bus.Publish(current.AgentSessionID, "chat_agent.valid_bundle_unrecorded", map[string]any{"task_id": taskID, "error": err.Error()})
	}
	if err := s.reconcileOrchestratorWorkerRun(ctx, taskID); err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	return s.orchestratorWorkerRequest(ctx, taskID)
}

// FailOrchestratorTaskRun ends the current run of a DOING task with a cause
// its transport cannot recover from, such as a response bundle the validator
// rejects in a way no correction prompt can fix.
func (s *Service) FailOrchestratorTaskRun(ctx context.Context, taskID, cause string) (orchestrator.Task, error) {
	cause = strings.TrimSpace(cause)
	if cause == "" {
		return orchestrator.Task{}, errors.New("a failure cause is required")
	}
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	lock := s.orchestratorProjectLock(task.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	if task, err = s.orchestrator.GetTask(ctx, taskID); err != nil || task.Status != orchestrator.TaskDoing {
		return task, err
	}
	runs, err := s.orchestrator.ListRuns(ctx, taskID)
	if err != nil || len(runs) == 0 {
		return task, errors.New("orchestrator task has no Agent run")
	}
	result, _ := s.failOrchestratorRun(ctx, task, runs[len(runs)-1], errors.New(truncateRepairText(cause, 2000)))
	return result.Task, s.recalculateOrchestratorTasks(ctx, task.ProjectPath)
}
