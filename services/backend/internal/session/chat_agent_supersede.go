package session

import (
	"fmt"
	"strings"
	"time"
)

// chatAgentDeleteSupersedeReason is written to the cancelled rows so an operator
// reading the queue can tell deliberate supersession from a failure.
const chatAgentDeleteSupersedeReason = "superseded by chat deletion"

// chatAgentSupersededByDelete reports whether a queued task stops being useful
// once its chat is being deleted.
//
// Everything that operates on the conversation itself — waiting for a response,
// discovering or committing a title, organizing it into a project — is work for
// a chat that will not exist, and running it costs a real ChatGPT round trip and
// the global account lock. The remote cleanup jobs are the exception: deleting
// the conversation, its temporary sibling and its library bundles is precisely
// what deletion still has to accomplish.
func chatAgentSupersededByDelete(taskType string) bool {
	switch taskType {
	case "DELETE_CHAT", "DELETE_TEMP_CHAT", "DELETE_BUNDLE":
		return false
	default:
		return true
	}
}

// SupersedeChatAgentTasksForDeletedChat cancels the queued work a deleted chat
// can no longer justify, keeping keepTaskID (the deletion job itself) alive.
//
// It exists because deleting a chat removed the chat row and nothing else. Every
// AWAIT_RESPONSE, TITLE_DISCOVER and ORGANIZE_CHAT queued for it stayed
// claimable indefinitely, so workers kept navigating to abandoned conversations,
// kept failing account automation against them, and — because the account lane
// is one global lock — kept the live chats' own maintenance waiting behind that
// dead work. Deletion is the point at which the queue has to converge.
func (s *Store) SupersedeChatAgentTasksForDeletedChat(chatID, keepTaskID string) (int, error) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return 0, nil
	}
	keepTaskID = strings.TrimSpace(keepTaskID)
	if s.db != nil {
		return s.postgresSupersedeChatAgentTasksForDeletedChat(chatID, keepTaskID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	count := 0
	for id, task := range s.chatAgentFallback() {
		if task.ChatID != chatID || id == keepTaskID {
			continue
		}
		if !chatAgentTaskActive(task.Status) || !chatAgentSupersededByDelete(task.Type) {
			continue
		}
		task.Status = ChatAgentTaskCancelled
		task.LastError = chatAgentDeleteSupersedeReason
		task.LeaseOwner = ""
		task.LeaseExpiresAt = nil
		task.UpdatedAt = now
		s.chatAgentFallback()[id] = task
		count++
	}
	return count, nil
}

func (s *Store) postgresSupersedeChatAgentTasksForDeletedChat(chatID, keepTaskID string) (int, error) {
	result, err := s.db.Exec(`UPDATE harness_chat_agent_tasks
		SET status='CANCELLED', last_error=$3, lease_owner='', lease_expires_at=NULL, updated_at=now()
		WHERE chat_id=$1 AND task_id<>$2 AND status IN ('PENDING','LEASED','RUNNING','WAITING')
		  AND type NOT IN ('DELETE_CHAT','DELETE_TEMP_CHAT','DELETE_BUNDLE')`,
		chatID, keepTaskID, chatAgentDeleteSupersedeReason)
	if err != nil {
		return 0, fmt.Errorf("supersede chat agent tasks for deleted chat: %w", err)
	}
	count, _ := result.RowsAffected()
	return int(count), nil
}
