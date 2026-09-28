package app

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

// An Orchestrator task is one agentic Main Request (ADR-0081). Its rounds
// travel on the agentic transport — PREPARE_PROMPT, AWAIT_RESPONSE,
// RECOVERY_WRITE — served by the Worker pinned to the task (ADR-0082). These
// entry points are what that transport needs where a chat has its renderer:
// the task's one conversation, delivery of its response bundle, and the end
// of a run a delivery cannot continue.

var orchestratorConversationURLPattern = regexp.MustCompile(`^https://chatgpt\.com/c/[A-Za-z0-9-]{1,128}$`)

// adoptOrchestratorTaskConversation gives a task that predates the durable
// field the most recent conversation one of its attempts used.
func (s *Service) adoptOrchestratorTaskConversation(ctx context.Context, task orchestrator.Task) (orchestrator.Task, error) {
	if task.ConversationURL != "" {
		return task, nil
	}
	attempts, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{ProjectID: task.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE", Limit: 200})
	if err != nil {
		return task, err
	}
	url := orchestratorTaskConversationURL(attempts)
	if !orchestratorConversationURLPattern.MatchString(url) {
		return task, nil
	}
	task.ConversationURL = url
	task.UpdatedAt = time.Now().UTC()
	return task, s.orchestrator.PutTask(ctx, task)
}

// RecordOrchestratorWorkerConversation stores the task's conversation the
// first time a request is submitted. It never replaces one: the stored URL is
// returned, and every later round continues there.
func (s *Service) RecordOrchestratorWorkerConversation(ctx context.Context, sessionID, taskID, workerTaskID, owner, conversationURL string) (string, error) {
	if err := s.orchestratorWorkerLease(workerTaskID, owner, taskID, sessionID); err != nil {
		return "", err
	}
	url := strings.TrimSpace(conversationURL)
	if !orchestratorConversationURLPattern.MatchString(url) {
		return "", errors.New("orchestrator task conversation must be a ChatGPT conversation URL")
	}
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return "", err
	}
	lock := s.orchestratorProjectLock(task.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	if task, err = s.orchestrator.GetTask(ctx, taskID); err != nil {
		return "", err
	}
	if task.ConversationURL != "" {
		return task.ConversationURL, nil
	}
	task.ConversationURL = url
	task.UpdatedAt = time.Now().UTC()
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return "", err
	}
	return url, nil
}

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
