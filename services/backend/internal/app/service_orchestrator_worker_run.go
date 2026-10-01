package app

import (
	"context"
	"errors"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

func (s *Service) orchestratorWorkerLease(workerTaskID, owner, taskID, sessionID string) error {
	claim, err := s.store.GetChatAgentTask(workerTaskID)
	if err != nil {
		return err
	}
	if claim.Type != "ORCHESTRATOR_EXECUTE" || claim.ChatID != taskID || claim.SessionID != sessionID ||
		claim.LeaseOwner != owner || (claim.Status != session.ChatAgentTaskLeased && claim.Status != session.ChatAgentTaskRunning) {
		return errors.New("orchestrator Worker lease does not own this task")
	}
	return nil
}

func (s *Service) StartOrchestratorWorkerTask(ctx context.Context, sessionID, taskID, workerTaskID, owner string) (OrchestratorWorkerRequest, error) {
	if err := s.orchestratorWorkerLease(workerTaskID, owner, taskID, sessionID); err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	ownerSession, err := s.store.Get(sessionID)
	if err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	if !orchestratorAutomaticExecutionAllowed(ownerSession) {
		return OrchestratorWorkerRequest{}, errors.New("orchestrator Worker execution requires Protected Auto mode")
	}
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil && !errors.Is(err, orchestrator.ErrNotFound) {
		return OrchestratorWorkerRequest{}, orchestratorStoreUnavailable(err)
	}
	if err != nil || task.ProjectPath != ownerSession.ProjectPath {
		return OrchestratorWorkerRequest{}, errors.New("orchestrator task does not belong to this project")
	}
	if orchestrator.TaskHasCompleted(task) {
		return settledOrchestratorWorkerRequest(task), nil
	}
	task, err = s.adoptOrchestratorTaskConversation(ctx, task)
	if err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	if task.Status == orchestrator.TaskReady {
		if _, err := s.StartOrchestratorTask(ctx, sessionID, taskID); err != nil {
			return OrchestratorWorkerRequest{}, err
		}
	} else if task.Status != orchestrator.TaskDoing {
		// The task left execution (REVIEW, FAILED, moved back, archived) while
		// this attempt was queued. Report its status so the Worker settles the
		// attempt; an error here returned it to the queue to be claimed again
		// and again, each claim spending a paced slot and an attempt.
		return settledOrchestratorWorkerRequest(task), nil
	}
	return s.orchestratorWorkerRequest(ctx, taskID)
}

func (s *Service) orchestratorWorkerRequest(ctx context.Context, taskID string) (OrchestratorWorkerRequest, error) {
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	runs, err := s.orchestrator.ListRuns(ctx, taskID)
	if err != nil || len(runs) == 0 {
		return OrchestratorWorkerRequest{}, errors.New("orchestrator task has no Agent run")
	}
	run := runs[len(runs)-1]
	if run.SessionID == "" {
		return OrchestratorWorkerRequest{}, errors.New("orchestrator Agent run has no session")
	}
	agent, err := s.store.Get(run.SessionID)
	if err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	result := OrchestratorWorkerRequest{Task: task, Run: run, AgentSessionID: run.SessionID,
		AgentState: agent.State, AgentFailureKind: agent.FailureKind, ChatID: sessionChatID(agent), ReasoningEffort: string(agent.ReasoningEffort),
		ConversationURL: task.ConversationURL, ConversationID: task.ConversationID}
	// Only a request still awaiting its response is the Worker's to deliver.
	// Once its bundle is accepted the Agent executes locally; reporting the old
	// request kept the Worker reopening the conversation to wait for a ZIP it
	// had already delivered.
	if containsString(agent.PendingManualRequestIDs, agent.LastRequestID) {
		result.RequestID, result.Prompt = agent.LastRequestID, agent.LastManualPrompt
	}
	if result.RequestID != "" {
		result.ExpectedFilename = expectedResponseBundleFilename(agent, result.RequestID)
	}
	return result, nil
}

func (s *Service) SubmitOrchestratorWorkerBundle(ctx context.Context, sessionID, taskID, workerTaskID, owner, filename string, raw []byte) (OrchestratorWorkerRequest, error) {
	if err := s.orchestratorWorkerLease(workerTaskID, owner, taskID, sessionID); err != nil {
		return OrchestratorWorkerRequest{}, err
	}
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
	// An accepted bundle is the provider-health evidence an agentic Main
	// Request records on delivery; without it the rate-limit level of an
	// account serving only Orchestrator tasks never returned to its floor.
	if _, err := s.store.RecordChatAgentValidBundle(current.RequestID, "", 0); err != nil {
		s.bus.Publish(sessionID, "chat_agent.valid_bundle_unrecorded", map[string]any{"task_id": taskID, "error": err.Error()})
	}
	if err := s.reconcileOrchestratorWorkerRun(ctx, taskID); err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	if _, err := s.OrchestratorOverview(ctx, sessionID); err != nil {
		return OrchestratorWorkerRequest{}, err
	}
	return s.orchestratorWorkerRequest(ctx, taskID)
}

func (s *Service) reconcileOrchestratorWorkerRun(ctx context.Context, taskID string) error {
	lockTask, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return err
	}
	lock := s.orchestratorProjectLock(lockTask.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	current, err := s.orchestratorWorkerRequest(ctx, taskID)
	if err != nil || current.Task.Status != orchestrator.TaskDoing {
		return nil
	}
	agent, err := s.store.Get(current.AgentSessionID)
	if err != nil {
		return err
	}
	// In an agentic chat a person answers "resume or discard" for an execution
	// a restart interrupted. A task has no chat and nobody to answer, so its
	// current run resumes an approved Protected interruption on its own;
	// otherwise the task stayed DOING indefinitely with a verified plan.
	if orchestratorShouldResumeInterrupted(agent) {
		if _, resumeErr := s.ResumeInterruptedExecution(agent.ID); resumeErr != nil {
			s.bus.Publish(agent.ID, "orchestrator.execution_resume_failed", map[string]any{"task_id": taskID, "error": resumeErr.Error()})
		} else {
			s.bus.Publish(agent.ID, "orchestrator.execution_resumed", map[string]any{"task_id": taskID, "plan_id": agent.InterruptedExecution.PlanID})
		}
		return nil
	}
	task, run := current.Task, current.Run
	switch orchestratorAgentOutcome(agent) {
	case "review":
		task.Status, task.Condition, run.Status = orchestrator.TaskReview, orchestrator.ConditionNone, "review"
	case "failed":
		task.Status, task.Condition, run.Status = orchestrator.TaskFailed, orchestrator.ConditionFailedRun, "failed"
		run.Error = orchestratorAgentOutcomeError(agent)
	default:
		workers, listErr := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{ProjectID: task.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE", Limit: 100})
		if listErr != nil {
			return listErr
		}
		var failed *session.ChatAgentTask
		for index := range workers {
			candidate := &workers[index]
			if orchestratorExecutionClaimPriority(candidate.Status) > 0 {
				return nil
			}
			// ATTENTION holds no lease and delivers nothing further: like FAILED
			// it ends the run, or the task would stay DOING with no Worker.
			ended := candidate.Status == session.ChatAgentTaskFailed || candidate.Status == session.ChatAgentTaskAttention
			if ended && (failed == nil || candidate.CreatedAt.After(failed.CreatedAt)) {
				failed = candidate
			}
		}
		if failed == nil {
			return nil
		}
		task.Status, task.Condition, run.Status = orchestrator.TaskFailed, orchestrator.ConditionFailedRun, "failed"
		run.Error = failed.LastError
	}
	now := time.Now().UTC()
	task.UpdatedAt, run.CompletedAt = now, &now
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return err
	}
	if err := s.orchestrator.AppendRun(ctx, run); err != nil {
		return err
	}
	return s.recalculateOrchestratorTasks(ctx, task.ProjectPath)
}

func orchestratorShouldResumeInterrupted(agent domain.Session) bool {
	intent := agent.InterruptedExecution
	return intent != nil && intent.Approved && intent.Status == "awaiting_decision" &&
		agent.ExecutionMode == domain.ExecutionModeProtected
}
