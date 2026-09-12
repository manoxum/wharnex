package session

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CheckpointChatAgentTask durably merges a top-level JSON object into the
// payload of a task still owned by the active worker. Checkpointing does not
// change the task's status or lease, so a worker can record remote side effects
// before proceeding to the next scheduler transition.
func (s *Store) CheckpointChatAgentTask(taskID, owner string, patch json.RawMessage) (ChatAgentTask, error) {
	patchObject, err := chatAgentJSONObject(patch, "chat agent checkpoint payload")
	if err != nil {
		return ChatAgentTask{}, err
	}
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return ChatAgentTask{}, errors.New("lease owner is required")
	}
	if s.db != nil {
		return s.postgresCheckpointChatAgentTask(taskID, owner, patch)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if task.LeaseOwner != owner || (task.Status != ChatAgentTaskLeased && task.Status != ChatAgentTaskRunning) {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	payloadObject, err := chatAgentJSONObject(task.Payload, "chat agent task payload")
	if err != nil {
		return ChatAgentTask{}, err
	}
	for key, value := range patchObject {
		payloadObject[key] = value
	}
	merged, err := json.Marshal(payloadObject)
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("merge chat agent checkpoint payload: %w", err)
	}
	task.Payload = merged
	task.UpdatedAt = time.Now().UTC()
	s.chatAgentFallback()[task.TaskID] = task
	return task, nil
}

func chatAgentJSONObject(raw json.RawMessage, label string) (map[string]json.RawMessage, error) {
	if len(raw) == 0 || !json.Valid(raw) {
		return nil, fmt.Errorf("%s must be a valid JSON object", label)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, fmt.Errorf("%s must be a valid JSON object", label)
	}
	return object, nil
}

func (s *Store) postgresCheckpointChatAgentTask(taskID, owner string, patch json.RawMessage) (ChatAgentTask, error) {
	row := s.db.QueryRow(`UPDATE harness_chat_agent_tasks
		SET payload=payload || $3::jsonb, updated_at=now()
		WHERE task_id=$1 AND lease_owner=$2 AND status IN ('LEASED','RUNNING')
		RETURNING `+chatAgentTaskColumns, taskID, owner, patch)
	task, err := scanChatAgentTask(row)
	if err == sql.ErrNoRows {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	if err != nil {
		return ChatAgentTask{}, fmt.Errorf("checkpoint chat agent task: %w", err)
	}
	return task, nil
}
