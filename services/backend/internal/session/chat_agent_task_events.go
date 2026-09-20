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

	"kernl.local/harness/backend/internal/audit"
)

// ChatAgentTaskEvent is one durable decision recorded against a chat-agent
// task's whole lifecycle: a recovery reload, a keep-continue wake-up, a
// bundle validated/rejected, a manual/automatic re-request, a human
// escalation, and so on. It exists because none of that history survived a
// Desktop restart or an archived chat before this — only console logs and
// in-memory state did.
type ChatAgentTaskEvent struct {
	ID            string         `json:"id"`
	TaskID        string         `json:"task_id"`
	RequestID     string         `json:"request_id"`
	RootRequestID string         `json:"root_request_id"`
	SessionID     string         `json:"session_id"`
	ChatID        string         `json:"chat_id"`
	ProjectID     string         `json:"project_id"`
	Type          string         `json:"type"`
	OccurredAt    time.Time      `json:"occurred_at"`
	Data          map[string]any `json:"data"`
}

// ChatAgentTaskEventFilter selects a bounded window of the ledger. TaskID is
// the precise anchor; RequestID/RootRequestID let a caller correlate across
// every task a single Main Request touched (e.g. AWAIT_RESPONSE plus a later
// RECOVERY_WRITE for the same root_request_id).
type ChatAgentTaskEventFilter struct {
	TaskID        string
	RequestID     string
	RootRequestID string
	Limit         int
}

const chatAgentTaskEventDefaultLimit = 200
const chatAgentTaskEventMaxLimit = 1000

func newChatAgentTaskEventID() string {
	var raw [10]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return "cae_" + hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("cae_%d", time.Now().UTC().UnixNano())
}

// AppendChatAgentTaskEvent durably records one decision. It never fails the
// caller's own operation on redaction grounds: Data is always sanitized
// in-place through the same rules the ordinary event bus applies, matching
// "Secret values must be redacted before event publication" (SoT/OBSERVABILITY.md).
func (s *Store) AppendChatAgentTaskEvent(event ChatAgentTaskEvent) (ChatAgentTaskEvent, error) {
	event.TaskID = strings.TrimSpace(event.TaskID)
	event.Type = strings.TrimSpace(event.Type)
	if event.TaskID == "" {
		return ChatAgentTaskEvent{}, errors.New("task_id is required")
	}
	if event.Type == "" {
		return ChatAgentTaskEvent{}, errors.New("type is required")
	}
	if event.ID == "" {
		event.ID = newChatAgentTaskEventID()
	}
	event.RequestID = strings.TrimSpace(event.RequestID)
	event.RootRequestID = strings.TrimSpace(event.RootRequestID)
	event.SessionID = strings.TrimSpace(event.SessionID)
	event.ChatID = strings.TrimSpace(event.ChatID)
	event.ProjectID = strings.TrimSpace(event.ProjectID)
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	if event.Data == nil {
		event.Data = map[string]any{}
	}
	event.Data = audit.SanitizeEventData(event.Data)

	if s.db != nil {
		data, err := json.Marshal(event.Data)
		if err != nil {
			return ChatAgentTaskEvent{}, fmt.Errorf("encode chat agent task event data: %w", err)
		}
		_, err = s.db.Exec(`INSERT INTO harness_chat_agent_task_events
			(id,task_id,request_id,root_request_id,session_id,chat_id,project_id,type,occurred_at,data)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (id) DO NOTHING`,
			event.ID, event.TaskID, event.RequestID, event.RootRequestID, event.SessionID, event.ChatID,
			event.ProjectID, event.Type, event.OccurredAt, data)
		if err != nil {
			return ChatAgentTaskEvent{}, wrapPostgresError("record chat agent task event", err)
		}
		return event, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.chatAgentTaskEvents == nil {
		s.chatAgentTaskEvents = make(map[string][]ChatAgentTaskEvent)
	}
	s.chatAgentTaskEvents[event.TaskID] = append(s.chatAgentTaskEvents[event.TaskID], event)
	return event, nil
}

// ListChatAgentTaskEvents reads the ledger back, oldest first, bounded like
// every other browser-agent queue listing (SoT/OBSERVABILITY.md "Browser-agent
// queue observability": a client-side count/window must never silently stop
// describing the real history).
func (s *Store) ListChatAgentTaskEvents(filter ChatAgentTaskEventFilter) ([]ChatAgentTaskEvent, error) {
	limit := filter.Limit
	if limit <= 0 || limit > chatAgentTaskEventMaxLimit {
		limit = chatAgentTaskEventDefaultLimit
	}

	if s.db != nil {
		where := []string{"TRUE"}
		args := make([]any, 0, 4)
		add := func(column, value string) {
			if strings.TrimSpace(value) == "" {
				return
			}
			args = append(args, value)
			where = append(where, fmt.Sprintf("%s=$%d", column, len(args)))
		}
		add("task_id", filter.TaskID)
		add("request_id", filter.RequestID)
		add("root_request_id", filter.RootRequestID)
		args = append(args, limit)
		query := `SELECT id,task_id,request_id,root_request_id,session_id,chat_id,project_id,type,occurred_at,data
			FROM harness_chat_agent_task_events WHERE ` + strings.Join(where, " AND ") +
			fmt.Sprintf(` ORDER BY occurred_at, id LIMIT $%d`, len(args))
		rows, err := s.db.Query(query, args...)
		if err != nil {
			return nil, fmt.Errorf("list chat agent task events: %w", err)
		}
		defer rows.Close()
		items := make([]ChatAgentTaskEvent, 0, limit)
		for rows.Next() {
			event, scanErr := scanChatAgentTaskEvent(rows)
			if scanErr != nil {
				return nil, fmt.Errorf("scan chat agent task event: %w", scanErr)
			}
			items = append(items, event)
		}
		return items, rows.Err()
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]ChatAgentTaskEvent, 0)
	for taskID, list := range s.chatAgentTaskEvents {
		if filter.TaskID != "" && taskID != filter.TaskID {
			continue
		}
		for _, event := range list {
			if filter.RequestID != "" && event.RequestID != filter.RequestID {
				continue
			}
			if filter.RootRequestID != "" && event.RootRequestID != filter.RootRequestID {
				continue
			}
			items = append(items, event)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].OccurredAt.Equal(items[j].OccurredAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].OccurredAt.Before(items[j].OccurredAt)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func scanChatAgentTaskEvent(scanner interface{ Scan(...any) error }) (ChatAgentTaskEvent, error) {
	var event ChatAgentTaskEvent
	var data []byte
	err := scanner.Scan(&event.ID, &event.TaskID, &event.RequestID, &event.RootRequestID, &event.SessionID,
		&event.ChatID, &event.ProjectID, &event.Type, &event.OccurredAt, &data)
	if err != nil {
		return ChatAgentTaskEvent{}, err
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &event.Data); err != nil {
			return ChatAgentTaskEvent{}, err
		}
	}
	if event.Data == nil {
		event.Data = map[string]any{}
	}
	return event, nil
}
