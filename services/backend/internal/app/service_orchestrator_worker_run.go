package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

type OrchestratorWorkerRequest struct {
	Task             orchestrator.Task    `json:"task"`
	Run              orchestrator.TaskRun `json:"run"`
	AgentSessionID   string               `json:"agent_session_id"`
	RequestID        string               `json:"request_id"`
	Prompt           string               `json:"prompt,omitempty"`
	ExpectedFilename string               `json:"expected_filename,omitempty"`
	ChatID           string               `json:"chat_id,omitempty"`
	ReasoningEffort  string               `json:"reasoning_effort,omitempty"`
	AgentState       string               `json:"agent_state"`
}

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
	if err != nil || task.ProjectPath != ownerSession.ProjectPath {
		return OrchestratorWorkerRequest{}, errors.New("orchestrator task does not belong to this project")
	}
	if task.Status == orchestrator.TaskReady {
		if _, err := s.StartOrchestratorTask(ctx, sessionID, taskID); err != nil {
			return OrchestratorWorkerRequest{}, err
		}
	} else if task.Status != orchestrator.TaskDoing {
		return OrchestratorWorkerRequest{}, fmt.Errorf("orchestrator task is %s, not READY or DOING", task.Status)
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
		RequestID: agent.LastRequestID, Prompt: agent.LastManualPrompt, AgentState: agent.State,
		ChatID: sessionChatID(agent), ReasoningEffort: string(agent.ReasoningEffort)}
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
	task, run := current.Task, current.Run
	switch orchestratorAgentOutcome(agent.State) {
	case "review":
		task.Status, task.Condition, run.Status = orchestrator.TaskReview, orchestrator.ConditionNone, "review"
	case "failed":
		task.Status, task.Condition, run.Status = orchestrator.TaskFailed, orchestrator.ConditionFailedRun, "failed"
		run.Error = agent.LastRepairError
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
			if candidate.Status == session.ChatAgentTaskFailed && (failed == nil || candidate.CreatedAt.After(failed.CreatedAt)) {
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
