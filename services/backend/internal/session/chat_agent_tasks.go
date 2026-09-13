package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	ChatAgentTaskPending   = "PENDING"
	ChatAgentTaskLeased    = "LEASED"
	ChatAgentTaskRunning   = "RUNNING"
	ChatAgentTaskWaiting   = "WAITING"
	ChatAgentTaskDone      = "DONE"
	ChatAgentTaskFailed    = "FAILED"
	ChatAgentTaskAttention = "ATTENTION"
	ChatAgentTaskCancelled = "CANCELLED"
)

var (
	ErrChatAgentTaskNotFound = errors.New("chat agent task not found")
	ErrChatAgentLeaseOwner   = errors.New("chat agent task lease owner mismatch")
)

type ChatAgentTask struct {
	TaskID         string          `json:"task_id"`
	Type           string          `json:"type"`
	ProjectID      string          `json:"project_id"`
	ChatID         string          `json:"chat_id"`
	SessionID      string          `json:"session_id"`
	RequestID      string          `json:"request_id"`
	RootRequestID  string          `json:"root_request_id"`
	ConversationID string          `json:"conversation_id"`
	ParentTaskID   string          `json:"parent_task_id"`
	Priority       int             `json:"priority"`
	Status         string          `json:"status"`
	NotBefore      time.Time       `json:"not_before"`
	Attempt        int             `json:"attempt"`
	MaxAttempts    int             `json:"max_attempts"`
	DedupeKey      string          `json:"dedupe_key"`
	AssignedWorker string          `json:"assigned_worker"`
	KeepFlowing    bool            `json:"keep_flowing"`
	LeaseOwner     string          `json:"lease_owner"`
	LeaseExpiresAt *time.Time      `json:"lease_expires_at,omitempty"`
	Payload        json.RawMessage `json:"payload"`
	LastError      string          `json:"last_error"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type ChatAgentTaskFilter struct {
	ProjectID  string
	ChatID     string
	SessionID  string
	RequestID  string
	Type       string
	Status     string
	ActiveOnly bool
	Limit      int
}

var chatAgentPriorities = map[string]int{
	"TRANSLATE_MARKDOWN": -1, "ORCHESTRATOR_PLAN": -1,
	"BOT_WRITE": 0, "RECOVERY_WRITE": 0,
	"AWAIT_RESPONSE": 1,
	"TITLE_DISCOVER": 2, "TITLE_GENERATE_TEMP": 2, "TITLE_AWAIT": 2,
	"ORGANIZE_CHAT": 2, "RENAME_CHAT": 2,
	"ARCHIVE_CHAT": 3, "DELETE_CHAT": 3,
	"DELETE_BUNDLE": 4, "DELETE_TEMP_CHAT": 4,
}

func newChatAgentTaskID() string {
	var raw [10]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return "cat_" + hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("cat_%d", time.Now().UTC().UnixNano())
}

func normalizeChatAgentTask(task ChatAgentTask, now time.Time) (ChatAgentTask, error) {
	task.Type = strings.ToUpper(strings.TrimSpace(task.Type))
	priority, ok := chatAgentPriorities[task.Type]
	if !ok {
		return ChatAgentTask{}, fmt.Errorf("unsupported chat agent task type %q", task.Type)
	}
	if strings.TrimSpace(task.ChatID) == "" && strings.TrimSpace(task.ConversationID) == "" {
		return ChatAgentTask{}, errors.New("chat_id or conversation_id is required")
	}
	if task.TaskID == "" {
		task.TaskID = newChatAgentTaskID()
	}
	task.ProjectID = normalizeChatAgentProjectID(task.ProjectID)
	task.ChatID = strings.TrimSpace(task.ChatID)
	task.SessionID = strings.TrimSpace(task.SessionID)
	task.RequestID = strings.TrimSpace(task.RequestID)
	task.RootRequestID = strings.TrimSpace(task.RootRequestID)
	task.ConversationID = strings.TrimSpace(task.ConversationID)
	task.ParentTaskID = strings.TrimSpace(task.ParentTaskID)
	task.DedupeKey = strings.TrimSpace(task.DedupeKey)
	// Routing is an operator action applied after enqueue. Never trust task
	// producers to smuggle a Worker pin or temporary Keep flowing policy in the
	// generic enqueue payload.
	task.AssignedWorker = ""
	task.KeepFlowing = false
	task.Priority = priority
	task.Status = ChatAgentTaskPending
	task.Attempt = 0
	if task.MaxAttempts <= 0 {
		task.MaxAttempts = 6
	}
	if task.MaxAttempts > 30 {
		task.MaxAttempts = 30
	}
	if task.NotBefore.IsZero() {
		task.NotBefore = now
	}
	if len(task.Payload) == 0 {
		task.Payload = json.RawMessage(`{}`)
	}
	if !json.Valid(task.Payload) {
		return ChatAgentTask{}, errors.New("chat agent task payload must be valid JSON")
	}
	task.LeaseOwner = ""
	task.LeaseExpiresAt = nil
	task.LastError = ""
	task.CreatedAt = now
	task.UpdatedAt = now
	return task, nil
}

func chatAgentTaskActive(status string) bool {
	switch status {
	case ChatAgentTaskPending, ChatAgentTaskLeased, ChatAgentTaskRunning, ChatAgentTaskWaiting:
		return true
	default:
		return false
	}
}

func chatAgentTaskNeverDedupe(taskType string) bool {
	switch taskType {
	case "BOT_WRITE", "RECOVERY_WRITE":
		return true
	default:
		return false
	}
}

var chatAgentWriterTypes = []string{
	"TRANSLATE_MARKDOWN", "ORCHESTRATOR_PLAN", "BOT_WRITE", "RECOVERY_WRITE", "ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "DELETE_TEMP_CHAT",
}

var chatAgentAccountTypes = []string{
	"ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "DELETE_BUNDLE", "DELETE_TEMP_CHAT",
}

func chatAgentTaskTypeIn(taskType string, values []string) bool {
	for _, value := range values {
		if taskType == value {
			return true
		}
	}
	return false
}

func chatAgentTaskWriter(taskType string) bool {
	return chatAgentTaskTypeIn(taskType, chatAgentWriterTypes)
}

func chatAgentTaskAccount(taskType string) bool {
	return chatAgentTaskTypeIn(taskType, chatAgentAccountTypes)
}

// chatAgentQuietWhileAwaiting lists the task types that drive a conversation's
// own surface and must therefore stand back while it is producing a response.
//
// Each one navigates or mutates the very renderer the model is streaming into:
// organizing and renaming open the sidebar menu and click a project anchor,
// which is a real `/g/g-p-…` navigation; archive and delete click ChatGPT's own
// Stop control; title discovery reloads the conversation; and the temporary
// title fallback sends the worker to a brand-new chat and submits an unrelated
// prompt there. Running any of them mid-generation is what interrupted the
// model's reasoning and left the request with no bundle to deliver.
//
// DELETE_BUNDLE and DELETE_TEMP_CHAT are absent deliberately: they act on the
// library and on a separate temporary conversation, never on this one. Writes
// are absent too — a write is the point of the conversation, and the existing
// per-conversation write lease already orders them.
func chatAgentQuietWhileAwaiting(taskType string) bool {
	return chatAgentTaskTypeIn(taskType, chatAgentQuietTypes)
}

// chatAgentQuietWhileAwaitingSQL renders chatAgentQuietWhileAwaiting as a SQL
// predicate over the given type column, so the claim query and the in-memory
// fallback can never drift apart on which types have to stand back.
func chatAgentQuietWhileAwaitingSQL(column string) string {
	return chatAgentTaskTypesSQL(column, chatAgentQuietTypes)
}

func chatAgentTaskTypesSQL(column string, values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, "'"+value+"'")
	}
	return column + " IN (" + strings.Join(quoted, ",") + ")"
}

func chatAgentTaskWriterSQL(column string) string {
	return chatAgentTaskTypesSQL(column, chatAgentWriterTypes)
}

func chatAgentTaskAccountSQL(column string) string {
	return chatAgentTaskTypesSQL(column, chatAgentAccountTypes)
}

var chatAgentQuietTypes = []string{
	"ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "TITLE_DISCOVER", "TITLE_GENERATE_TEMP",
}

func chatAgentEffectivePriority(task ChatAgentTask, now time.Time) int {
	if task.Priority <= 1 {
		return task.Priority
	}
	aged := int(now.Sub(task.CreatedAt) / (15 * time.Minute))
	value := task.Priority - aged
	if value < 1 {
		return 1
	}
	return value
}

func (s *Store) chatAgentFallback() map[string]ChatAgentTask {
	if s.chatAgentTasks == nil {
		s.chatAgentTasks = make(map[string]ChatAgentTask)
	}
	return s.chatAgentTasks
}

func (s *Store) EnqueueChatAgentTask(input ChatAgentTask) (ChatAgentTask, error) {
	task, err := normalizeChatAgentTask(input, time.Now().UTC())
	if err != nil {
		return ChatAgentTask{}, err
	}
	// Attribution is resolved here rather than trusted from the caller, so a
	// caller that forgets — or passes a ChatGPT display name, as the transport
	// path did — cannot create a task that escapes every project filter.
	task.ProjectID = s.resolveChatAgentTaskProject(task)
	stored, err := s.enqueueChatAgentTask(task)
	if err != nil {
		return ChatAgentTask{}, err
	}
	// Queueing the deletion of a chat is the moment the rest of that chat's work
	// becomes pointless, so it is the moment the queue converges. Doing it here
	// rather than in a caller means every path that deletes a chat — the REST
	// API, the Desktop lifecycle bridge, a future one — converges identically.
	if stored.Type == "DELETE_CHAT" {
		if _, cancelErr := s.SupersedeChatAgentTasksForDeletedChat(stored.ChatID, stored.TaskID); cancelErr != nil {
			return ChatAgentTask{}, cancelErr
		}
	}
	return stored, nil
}

func (s *Store) enqueueChatAgentTask(task ChatAgentTask) (ChatAgentTask, error) {
	if s.db != nil {
		return s.postgresEnqueueChatAgentTask(task)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if task.DedupeKey != "" && !chatAgentTaskNeverDedupe(task.Type) {
		for _, existing := range s.chatAgentFallback() {
			if existing.DedupeKey == task.DedupeKey && chatAgentTaskActive(existing.Status) {
				return existing, nil
			}
		}
	}
	s.chatAgentFallback()[task.TaskID] = task
	return task, nil
}

func (s *Store) GetChatAgentTask(taskID string) (ChatAgentTask, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if s.db != nil {
		return s.postgresGetChatAgentTask(taskID)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	task, ok := s.chatAgentTasks[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	return task, nil
}

func (s *Store) ListChatAgentTasks(filter ChatAgentTaskFilter) ([]ChatAgentTask, error) {
	// A project filter fails closed. Normalizing an unusable value to "" would
	// silently widen the query from one project to the whole account, which is
	// precisely the disclosure a project-scoped view exists to prevent.
	if strings.TrimSpace(filter.ProjectID) != "" {
		filter.ProjectID = normalizeChatAgentProjectID(filter.ProjectID)
		if filter.ProjectID == "" {
			return []ChatAgentTask{}, nil
		}
	}
	if s.db != nil {
		return s.postgresListChatAgentTasks(filter)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]ChatAgentTask, 0, len(s.chatAgentTasks))
	for _, task := range s.chatAgentTasks {
		if filter.ProjectID != "" && task.ProjectID != filter.ProjectID {
			continue
		}
		if filter.ChatID != "" && task.ChatID != filter.ChatID {
			continue
		}
		if filter.SessionID != "" && task.SessionID != filter.SessionID {
			continue
		}
		if filter.RequestID != "" && task.RequestID != filter.RequestID {
			continue
		}
		if filter.Type != "" && task.Type != filter.Type {
			continue
		}
		if filter.Status != "" && task.Status != filter.Status {
			continue
		}
		if filter.ActiveOnly && !chatAgentTaskActive(task.Status) {
			continue
		}
		items = append(items, task)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].TaskID < items[j].TaskID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	if filter.Limit > 0 && len(items) > filter.Limit {
		items = items[:filter.Limit]
	}
	return items, nil
}
