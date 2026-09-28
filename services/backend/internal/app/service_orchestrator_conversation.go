package app

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

var orchestratorConversationURLPattern = regexp.MustCompile(`^https://chatgpt\.com/c/([A-Za-z0-9-]{1,128})$`)

type OrchestratorConversationAffinity struct {
	ConversationURL string `json:"conversation_url"`
	ConversationID  string `json:"conversation_id"`
}

func parseOrchestratorConversationURL(value string) (OrchestratorConversationAffinity, error) {
	url := strings.TrimSpace(value)
	match := orchestratorConversationURLPattern.FindStringSubmatch(url)
	if len(match) != 2 {
		return OrchestratorConversationAffinity{}, errors.New("orchestrator task conversation must be a concrete ChatGPT conversation URL")
	}
	return OrchestratorConversationAffinity{ConversationURL: url, ConversationID: match[1]}, nil
}

func taskConversationAffinity(task orchestrator.Task) (OrchestratorConversationAffinity, error) {
	if strings.TrimSpace(task.ConversationURL) == "" {
		if strings.TrimSpace(task.ConversationID) != "" {
			return OrchestratorConversationAffinity{}, errors.New("orchestrator task conversation affinity is inconsistent; do not submit another prompt")
		}
		return OrchestratorConversationAffinity{}, nil
	}
	affinity, err := parseOrchestratorConversationURL(task.ConversationURL)
	if err != nil || (task.ConversationID != "" && task.ConversationID != affinity.ConversationID) {
		return OrchestratorConversationAffinity{}, errors.New("orchestrator task conversation affinity is inconsistent; do not submit another prompt")
	}
	return affinity, nil
}

// adoptOrchestratorTaskConversation upgrades legacy task affinity while the
// current ORCHESTRATOR_EXECUTE lease owns the task. New tasks bind only through
// RecordOrchestratorWorkerConversationAffinity.
func (s *Service) adoptOrchestratorTaskConversation(ctx context.Context, task orchestrator.Task) (orchestrator.Task, error) {
	affinity, err := taskConversationAffinity(task)
	if err != nil {
		return task, err
	}
	if affinity.ConversationURL != "" {
		if task.ConversationID == affinity.ConversationID {
			return task, nil
		}
		task.ConversationID = affinity.ConversationID
		task.UpdatedAt = time.Now().UTC()
		return task, s.orchestrator.PutTask(ctx, task)
	}
	attempts, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{ProjectID: task.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE", Limit: 200})
	if err != nil {
		return task, err
	}
	legacyURL := orchestratorTaskConversationURL(attempts)
	if legacyURL == "" {
		return task, nil
	}
	affinity, err = parseOrchestratorConversationURL(legacyURL)
	if err != nil {
		return task, nil
	}
	task.ConversationURL = affinity.ConversationURL
	task.ConversationID = affinity.ConversationID
	task.UpdatedAt = time.Now().UTC()
	return task, s.orchestrator.PutTask(ctx, task)
}

// orchestratorTaskConversationURL is compatibility evidence for a task created
// before durable affinity lived on the task itself.
func orchestratorTaskConversationURL(attempts []session.ChatAgentTask) string {
	latest := ""
	var latestAt time.Time
	for _, attempt := range attempts {
		var payload struct {
			ConversationURL string `json:"conversation_url"`
		}
		if json.Unmarshal(attempt.Payload, &payload) != nil || payload.ConversationURL == "" {
			continue
		}
		if latest == "" || attempt.UpdatedAt.After(latestAt) {
			latest, latestAt = payload.ConversationURL, attempt.UpdatedAt
		}
	}
	return latest
}

// RecordOrchestratorWorkerConversation preserves the URL-only service contract
// used by older callers while enforcing the immutable affinity.
func (s *Service) RecordOrchestratorWorkerConversation(ctx context.Context, sessionID, taskID, workerTaskID, owner, conversationURL string) (string, error) {
	affinity, err := s.RecordOrchestratorWorkerConversationAffinity(ctx, sessionID, taskID, workerTaskID, owner, conversationURL)
	return affinity.ConversationURL, err
}

// RecordOrchestratorWorkerConversationAffinity establishes the task's immutable
// conversation only while its ORCHESTRATOR_EXECUTE lease is held. Repeating the
// same concrete URL is idempotent; every other rebind attempt fails closed.
func (s *Service) RecordOrchestratorWorkerConversationAffinity(ctx context.Context, sessionID, taskID, workerTaskID, owner, conversationURL string) (OrchestratorConversationAffinity, error) {
	if err := s.orchestratorWorkerLease(workerTaskID, owner, taskID, sessionID); err != nil {
		return OrchestratorConversationAffinity{}, err
	}
	candidate, candidateErr := parseOrchestratorConversationURL(conversationURL)
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return OrchestratorConversationAffinity{}, err
	}
	lock := s.orchestratorProjectLock(task.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	if err := s.orchestratorWorkerLease(workerTaskID, owner, taskID, sessionID); err != nil {
		return OrchestratorConversationAffinity{}, err
	}
	if task, err = s.orchestrator.GetTask(ctx, taskID); err != nil {
		return OrchestratorConversationAffinity{}, err
	}
	current, err := taskConversationAffinity(task)
	if err != nil {
		return OrchestratorConversationAffinity{}, err
	}
	if current.ConversationURL != "" {
		if candidateErr != nil || current != candidate {
			return OrchestratorConversationAffinity{}, errors.New("orchestrator task is already bound to a different ChatGPT conversation; reopen the stored conversation before sending")
		}
		if task.ConversationID == "" {
			task.ConversationID = current.ConversationID
			task.UpdatedAt = time.Now().UTC()
			if err := s.orchestrator.PutTask(ctx, task); err != nil {
				return OrchestratorConversationAffinity{}, err
			}
		}
		return current, nil
	}
	if candidateErr != nil {
		return OrchestratorConversationAffinity{}, candidateErr
	}
	task.ConversationURL = candidate.ConversationURL
	task.ConversationID = candidate.ConversationID
	task.UpdatedAt = time.Now().UTC()
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return OrchestratorConversationAffinity{}, err
	}
	return candidate, nil
}
