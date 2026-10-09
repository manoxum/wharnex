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
	Source         string          `json:"source"`
	ProjectID      string          `json:"project_id"`
	ChatID         string          `json:"chat_id"`
	SessionID      string          `json:"session_id"`
	RequestID      string          `json:"request_id"`
	RootRequestID  string          `json:"root_request_id"`
	ConversationID string          `json:"conversation_id"`
	ParentTaskID   string          `json:"parent_task_id"`
	PlanID         string          `json:"plan_id"`
	Title          string          `json:"title"`
	Description    string          `json:"description"`
	Condition      string          `json:"condition"`
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

func chatAgentTaskSource(taskType string) string {
	switch taskType {
	case "TRANSLATE_MARKDOWN":
		return "translation"
	case "RELEASE_NOTES":
		return "release"
	case "TODO_CLASSIFY":
		return "todo"
	case "UI_TEST_DISCOVER", "UI_TEST_RUN":
		return "ui-testing"
	case "ORCHESTRATOR_PLAN":
		return "orchestration"
	case "ORCHESTRATOR_EXECUTE":
		return "orchestration"
	default:
		return "chat"
	}
}

// NewChatAgentTaskID mints an id before the task is enqueued.
//
// A protocol whose artifact filenames are derived from the task id has to know
// that id before it can build the request, and enqueue-then-patch would leave a
// claimable task in the queue with no request in it.
func NewChatAgentTaskID() string { return newChatAgentTaskID() }

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
	task.Source = chatAgentTaskSource(task.Type)
	task.ProjectID = normalizeChatAgentProjectID(task.ProjectID)
	task.ChatID = strings.TrimSpace(task.ChatID)
	task.SessionID = strings.TrimSpace(task.SessionID)
	task.RequestID = strings.TrimSpace(task.RequestID)
	task.RootRequestID = strings.TrimSpace(task.RootRequestID)
	task.ConversationID = strings.TrimSpace(task.ConversationID)
	task.ParentTaskID = strings.TrimSpace(task.ParentTaskID)
	task.PlanID = strings.TrimSpace(task.PlanID)
	task.Title = strings.TrimSpace(task.Title)
	task.Description = strings.TrimSpace(task.Description)
	task.Condition = strings.TrimSpace(task.Condition)
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

var chatAgentWriterTypes = []string{
	"TRANSLATE_MARKDOWN", "RELEASE_NOTES", "TODO_CLASSIFY", "UI_TEST_DISCOVER", "UI_TEST_RUN", "ORCHESTRATOR_PLAN", "ORCHESTRATOR_EXECUTE", "BOT_WRITE", "RECOVERY_WRITE", "ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "DELETE_TEMP_CHAT",
}

var chatAgentAccountTypes = []string{
	"ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "DELETE_BUNDLE", "DELETE_TEMP_CHAT",
}

// chatAgentSupervisorTypes is the work the Supervisor pool owns: opening the
// chat, submitting the request bundle, collecting the response bundle, and
// following the remote conversation in real time.
//
// The partition exists to stop cross-conversation navigation, which is the
// provider request that earns HTTP 429. A Supervisor is already resident on the
// conversation these types act on, so handing one to a Worker navigates a
// second renderer to a page that is already loaded — and then the Supervisor
// reloads it back when the operator returns to that chat. Everything else is
// small account-lifecycle or utility work that no Supervisor may take, so a
// rename or an archive can never evict a conversation that is mid-request.
var chatAgentSupervisorTypes = []string{
	"AWAIT_RESPONSE", "BOT_WRITE", "RECOVERY_WRITE",
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

func chatAgentTaskSupervisor(taskType string) bool {
	return chatAgentTaskTypeIn(taskType, chatAgentSupervisorTypes)
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

func chatAgentTaskSupervisorSQL(column string) string {
	return chatAgentTaskTypesSQL(column, chatAgentSupervisorTypes)
}

// An Orchestrator task is one agentic Main Request whose chat is the task
// itself (chat id "otk_…"). Its write, supervision and recovery tasks are the
// agentic ones, but a Worker serves them in the Supervisor's role (ADR-0081),
// and they share the task's lane "h:<task id>" whatever their conversation, so
// the Worker pinned to the task (ADR-0082) serves every round of it.
const chatAgentOrchestratorChatPrefix = "otk_"

func chatAgentTaskOrchestratorChat(task ChatAgentTask) bool {
	return strings.HasPrefix(strings.TrimSpace(task.ChatID), chatAgentOrchestratorChatPrefix)
}

func chatAgentTaskOrchestratorChatSQL(alias string) string {
	return alias + `.chat_id LIKE 'otk\_%'`
}

// chatAgentTaskForSupervisor reports whether the Supervisor pool serves this
// task: a Supervisor type in a person's chat.
func chatAgentTaskForSupervisor(task ChatAgentTask) bool {
	return chatAgentTaskSupervisor(task.Type) && !chatAgentTaskOrchestratorChat(task)
}

func chatAgentTaskForSupervisorSQL(alias string) string {
	return "(" + chatAgentTaskSupervisorSQL(alias+".type") + " AND NOT " + chatAgentTaskOrchestratorChatSQL(alias) + ")"
}

// chatAgentEphemeralTypes are served by the ephemeral utility pool (role
// "translator"): each claim gets its own browser that lives until the task
// settles. They never wait behind, or take a slot of, the persistent Workers,
// whose configured count and auto scale serve Orchestrator execution. UI Lab
// exchanges are deliberately absent: they run on the persistent Workers, where
// pacing, suspension and upload spend stay under operator control (ADR-0093).
var chatAgentEphemeralTypes = []string{"TRANSLATE_MARKDOWN", "ORCHESTRATOR_PLAN", "RELEASE_NOTES"}

func chatAgentTaskEphemeral(taskType string) bool {
	return chatAgentTaskTypeIn(taskType, chatAgentEphemeralTypes)
}

func chatAgentTaskEphemeralSQL(column string) string {
	return chatAgentTaskTypesSQL(column, chatAgentEphemeralTypes)
}

var chatAgentQuietTypes = []string{
	"ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "TITLE_DISCOVER", "TITLE_GENERATE_TEMP",
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
	if task.DedupeKey != "" {
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

// ListUnifiedTasks exposes the project-wide task ledger. The normal chat-agent
// queue APIs intentionally keep their historical queue semantics, while this
// reader also includes orchestrator tasks stored in the same canonical table.
func (s *Store) ListUnifiedTasks(filter ChatAgentTaskFilter) ([]ChatAgentTask, error) {
	if strings.TrimSpace(filter.ProjectID) != "" {
		filter.ProjectID = normalizeChatAgentProjectID(filter.ProjectID)
		if filter.ProjectID == "" {
			return []ChatAgentTask{}, nil
		}
	}
	if s.db != nil {
		return s.postgresListUnifiedTasks(filter)
	}
	return s.ListChatAgentTasks(filter)
}
