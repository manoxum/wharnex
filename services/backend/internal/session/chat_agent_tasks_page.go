package session

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	UnifiedTaskScopeActive  = "active"
	UnifiedTaskScopeHistory = "history"

	defaultUnifiedTaskPageLimit = 100
	maxUnifiedTaskPageLimit     = 100
)

var ErrUnifiedTaskPageFilter = errors.New("invalid unified task page filter")

var unifiedTaskActiveStatuses = []string{
	ChatAgentTaskPending, ChatAgentTaskLeased, ChatAgentTaskRunning,
	ChatAgentTaskWaiting, "READY", "DOING", "REVIEW",
	ChatAgentTaskAttention, ChatAgentTaskFailed,
}

var unifiedTaskHistoryStatuses = []string{
	ChatAgentTaskDone, ChatAgentTaskCancelled, "COMPLETE", "ARCHIVED",
}

type UnifiedTaskPageFilter struct {
	ProjectID string
	Scope     string
	Status    string
	Limit     int
	Cursor    string
}

type UnifiedTaskPage struct {
	Tasks      []ChatAgentTask `json:"tasks"`
	NextCursor string          `json:"next_cursor,omitempty"`
	HasMore    bool            `json:"has_more"`
}

type unifiedTaskPageCursor struct {
	UpdatedAt time.Time `json:"updated_at"`
	TaskID    string    `json:"task_id"`
}

func (s *Store) ListUnifiedTaskPage(filter UnifiedTaskPageFilter) (UnifiedTaskPage, error) {
	filter, cursor, err := normalizeUnifiedTaskPageFilter(filter)
	if err != nil {
		return UnifiedTaskPage{}, err
	}
	if s.db != nil {
		return s.postgresListUnifiedTaskPage(filter, cursor)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	matching := make([]ChatAgentTask, 0)
	for _, task := range s.chatAgentTasks {
		if unifiedTaskMatchesPageFilter(task, filter) {
			matching = append(matching, task)
		}
	}
	sort.Slice(matching, func(i, j int) bool {
		if matching[i].UpdatedAt.Equal(matching[j].UpdatedAt) {
			return matching[i].TaskID > matching[j].TaskID
		}
		return matching[i].UpdatedAt.After(matching[j].UpdatedAt)
	})

	items := make([]ChatAgentTask, 0, filter.Limit+1)
	for _, task := range matching {
		if cursor != nil && !unifiedTaskAfterCursor(task, *cursor) {
			continue
		}
		items = append(items, task)
		if len(items) > filter.Limit {
			break
		}
	}
	return buildUnifiedTaskPage(items, filter.Limit)
}

func normalizeUnifiedTaskPageFilter(filter UnifiedTaskPageFilter) (UnifiedTaskPageFilter, *unifiedTaskPageCursor, error) {
	filter.ProjectID = normalizeChatAgentProjectID(filter.ProjectID)
	filter.Scope = strings.ToLower(strings.TrimSpace(filter.Scope))
	filter.Status = strings.ToUpper(strings.TrimSpace(filter.Status))
	filter.Cursor = strings.TrimSpace(filter.Cursor)
	if filter.ProjectID == "" {
		return UnifiedTaskPageFilter{}, nil, fmt.Errorf("%w: project_id is required", ErrUnifiedTaskPageFilter)
	}
	statuses := unifiedTaskScopeStatuses(filter.Scope)
	if len(statuses) == 0 {
		return UnifiedTaskPageFilter{}, nil, fmt.Errorf("%w: scope must be active or history", ErrUnifiedTaskPageFilter)
	}
	if filter.Scope == UnifiedTaskScopeHistory && filter.Limit <= 0 {
		return UnifiedTaskPageFilter{}, nil, fmt.Errorf("%w: history limit must be explicit", ErrUnifiedTaskPageFilter)
	}
	if filter.Limit <= 0 {
		filter.Limit = defaultUnifiedTaskPageLimit
	}
	if filter.Limit > maxUnifiedTaskPageLimit {
		filter.Limit = maxUnifiedTaskPageLimit
	}
	if filter.Status != "" && !stringInSet(filter.Status, statuses) {
		return UnifiedTaskPageFilter{}, nil, fmt.Errorf("%w: status %s is outside %s scope", ErrUnifiedTaskPageFilter, filter.Status, filter.Scope)
	}
	if filter.Cursor == "" {
		return filter, nil, nil
	}
	cursor, err := decodeUnifiedTaskPageCursor(filter.Cursor)
	if err != nil {
		return UnifiedTaskPageFilter{}, nil, err
	}
	return filter, &cursor, nil
}

func unifiedTaskMatchesPageFilter(task ChatAgentTask, filter UnifiedTaskPageFilter) bool {
	if task.ProjectID != filter.ProjectID || !stringInSet(task.Status, unifiedTaskScopeStatuses(filter.Scope)) {
		return false
	}
	return filter.Status == "" || task.Status == filter.Status
}

func unifiedTaskScopeStatuses(scope string) []string {
	if scope == UnifiedTaskScopeActive {
		return unifiedTaskActiveStatuses
	}
	if scope == UnifiedTaskScopeHistory {
		return unifiedTaskHistoryStatuses
	}
	return nil
}

func stringInSet(value string, values []string) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func unifiedTaskAfterCursor(task ChatAgentTask, cursor unifiedTaskPageCursor) bool {
	return task.UpdatedAt.Before(cursor.UpdatedAt) || (task.UpdatedAt.Equal(cursor.UpdatedAt) && task.TaskID < cursor.TaskID)
}

func buildUnifiedTaskPage(items []ChatAgentTask, limit int) (UnifiedTaskPage, error) {
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	page := UnifiedTaskPage{Tasks: items, HasMore: hasMore}
	if hasMore && len(items) > 0 {
		cursor, err := encodeUnifiedTaskPageCursor(items[len(items)-1])
		if err != nil {
			return UnifiedTaskPage{}, err
		}
		page.NextCursor = cursor
	}
	return page, nil
}

func encodeUnifiedTaskPageCursor(task ChatAgentTask) (string, error) {
	raw, err := json.Marshal(unifiedTaskPageCursor{UpdatedAt: task.UpdatedAt.UTC(), TaskID: task.TaskID})
	if err != nil {
		return "", fmt.Errorf("encode unified task cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeUnifiedTaskPageCursor(value string) (unifiedTaskPageCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return unifiedTaskPageCursor{}, fmt.Errorf("%w: invalid cursor", ErrUnifiedTaskPageFilter)
	}
	var cursor unifiedTaskPageCursor
	if json.Unmarshal(raw, &cursor) != nil || cursor.UpdatedAt.IsZero() || strings.TrimSpace(cursor.TaskID) == "" {
		return unifiedTaskPageCursor{}, fmt.Errorf("%w: invalid cursor", ErrUnifiedTaskPageFilter)
	}
	return cursor, nil
}
