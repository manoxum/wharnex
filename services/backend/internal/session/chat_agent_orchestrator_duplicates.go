package session

import (
	"fmt"
	"strings"
	"time"
)

const orchestratorDuplicateReason = "superseded by the earlier Orchestrator execution claim"

// CancelDuplicateOrchestratorExecutionTasks retains one canonical Worker
// claim for a task. This also cleans queue rows created by older releases
// whose dedupe key did not include the explicit READY transition identity.
func (s *Store) CancelDuplicateOrchestratorExecutionTasks(chatID, keepTaskID string) (int, error) {
	chatID, keepTaskID = strings.TrimSpace(chatID), strings.TrimSpace(keepTaskID)
	if chatID == "" || keepTaskID == "" {
		return 0, nil
	}
	if s.db != nil {
		result, err := s.db.Exec(`UPDATE harness_chat_agent_tasks
			SET status='CANCELLED', last_error=$3, lease_owner='', lease_expires_at=NULL, updated_at=now()
			WHERE chat_id=$1 AND type='ORCHESTRATOR_EXECUTE' AND task_id<>$2
			AND status IN ('PENDING','LEASED','RUNNING','WAITING')`, chatID, keepTaskID, orchestratorDuplicateReason)
		if err != nil {
			return 0, fmt.Errorf("cancel duplicate Orchestrator execution tasks: %w", err)
		}
		count, _ := result.RowsAffected()
		return int(count), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	count := 0
	for id, task := range s.chatAgentFallback() {
		if task.ChatID != chatID || task.Type != "ORCHESTRATOR_EXECUTE" || id == keepTaskID || !chatAgentTaskActive(task.Status) {
			continue
		}
		task.Status, task.LastError = ChatAgentTaskCancelled, orchestratorDuplicateReason
		task.LeaseOwner, task.LeaseExpiresAt, task.UpdatedAt = "", nil, now
		s.chatAgentFallback()[id] = task
		count++
	}
	return count, nil
}
