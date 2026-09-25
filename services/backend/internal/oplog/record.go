package oplog

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

// Sources that may write the operational log.
const (
	SourceBackend  = "backend"
	SourceDesktop  = "desktop"
	SourceFrontend = "frontend"
)

const maxDataBytes = 16 << 10

// Record is one classified, correlated operational fact.
type Record struct {
	ID            string         `json:"id"`
	OccurredAt    time.Time      `json:"occurred_at"`
	Source        string         `json:"source"`
	Component     string         `json:"component"`
	Level         string         `json:"level"`
	Category      string         `json:"category"`
	Event         string         `json:"event"`
	Message       string         `json:"message,omitempty"`
	SessionID     string         `json:"session_id,omitempty"`
	RequestID     string         `json:"request_id,omitempty"`
	RootRequestID string         `json:"root_request_id,omitempty"`
	ChatID        string         `json:"chat_id,omitempty"`
	TaskID        string         `json:"task_id,omitempty"`
	PlanID        string         `json:"plan_id,omitempty"`
	ProjectID     string         `json:"project_id,omitempty"`
	EventRef      string         `json:"event_ref,omitempty"`
	TraceID       string         `json:"trace_id,omitempty"`
	Data          map[string]any `json:"data,omitempty"`
}

// Normalize fills defaults, classifies, bounds and redacts a record in place.
// It is the single gate every record passes, whatever wrote it.
func (r *Record) Normalize(now time.Time) {
	if r.ID == "" {
		r.ID = ids.New("log")
	}
	if r.OccurredAt.IsZero() || r.OccurredAt.After(now.Add(time.Minute)) {
		r.OccurredAt = now
	}
	r.OccurredAt = r.OccurredAt.UTC()
	if r.Source != SourceDesktop && r.Source != SourceFrontend {
		r.Source = SourceBackend
	}
	r.Event = bound(r.Event, 160)
	if r.Event == "" {
		r.Event = "unknown"
	}
	component, level, category := Classify(r.Event)
	if r.Component == "" {
		r.Component = component
	} else {
		r.Component = boundedToken(strings.ToLower(r.Component), 48)
	}
	if !ValidLevel(r.Level) {
		r.Level = level
	}
	if r.Category == "" {
		r.Category = category
	} else {
		r.Category = boundedToken(strings.ToLower(r.Category), 32)
	}
	r.Message = bound(audit.SanitizeText(r.Message), 2000)
	for _, field := range []*string{&r.SessionID, &r.RequestID, &r.RootRequestID, &r.ChatID, &r.TaskID, &r.PlanID, &r.ProjectID, &r.EventRef, &r.TraceID} {
		*field = bound(*field, 400)
	}
	r.Data = boundedData(audit.SanitizeEventData(r.Data))
}

// FromEvent mirrors an audit-bus event. The complete body stays in
// harness_events and is referenced by EventRef; only small scalar fields and
// correlation are copied.
func FromEvent(event domain.Event) Record {
	data := event.Data
	record := Record{
		OccurredAt: event.Timestamp, Source: SourceBackend, Event: event.Type, SessionID: event.SessionID, EventRef: event.ID,
		RequestID: text(data, "request_id"), RootRequestID: text(data, "root_request_id"), ChatID: text(data, "chat_id"),
		TaskID: text(data, "task_id"), PlanID: text(data, "plan_id"), ProjectID: text(data, "project_path"),
		Message: firstText(data, "error", "detail", "reason", "message"), Data: map[string]any{},
	}
	for key, value := range data {
		switch typed := value.(type) {
		case string:
			if len(typed) <= 300 {
				record.Data[key] = typed
			}
		case bool, int, int64, float64:
			record.Data[key] = typed
		}
	}
	return record
}

func text(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}

func firstText(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := text(data, key); value != "" {
			return value
		}
	}
	return ""
}

func bound(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut] + "…"
}

func boundedData(data map[string]any) map[string]any {
	if len(data) == 0 {
		return map[string]any{}
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return map[string]any{"unencodable": true}
	}
	if len(encoded) > maxDataBytes {
		return map[string]any{"truncated": true, "bytes": len(encoded)}
	}
	return data
}
