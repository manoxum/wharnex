package audit

import (
	"regexp"
	"strings"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

type EventStore interface {
	AppendEvent(domain.Event) error
	EventHistory(string) ([]domain.Event, error)
}

type Bus struct {
	mu          sync.RWMutex
	history     map[string][]domain.Event
	subscribers map[string]map[chan domain.Event]struct{}
	store       EventStore
}

func NewBus() *Bus {
	return &Bus{
		history:     make(map[string][]domain.Event),
		subscribers: make(map[string]map[chan domain.Event]struct{}),
	}
}

func NewPersistentBus(store EventStore) *Bus {
	bus := NewBus()
	bus.store = store
	return bus
}

// SanitizeEventData applies the bus's own redaction/bounding rules to an
// arbitrary event body. Exported so other durable event stores (e.g. the
// chat-agent task event ledger in package session) apply exactly the rules
// Publish applies, instead of a second, driftable implementation.
func SanitizeEventData(data map[string]any) map[string]any { return sanitizeData(data) }

func (b *Bus) Publish(sessionID, eventType string, data map[string]any) domain.Event {
	event := domain.Event{ID: ids.New("evt"), SessionID: sessionID, Type: eventType, Timestamp: time.Now().UTC(), Data: sanitizeData(data)}
	if b.store != nil {
		_ = b.store.AppendEvent(event)
	}
	b.mu.Lock()
	b.history[sessionID] = append(b.history[sessionID], event)
	for ch := range b.subscribers[sessionID] {
		select {
		case ch <- event:
		default:
		}
	}
	b.mu.Unlock()
	return event
}

func (b *Bus) History(sessionID string) []domain.Event {
	if b.store != nil {
		if items, err := b.store.EventHistory(sessionID); err == nil {
			return items
		}
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	items := b.history[sessionID]
	out := make([]domain.Event, len(items))
	copy(out, items)
	return out
}

var secretAssignment = regexp.MustCompile(`(?i)(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s]+`)

func sanitizeData(data map[string]any) map[string]any {
	result := make(map[string]any, len(data))
	for key, value := range data {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "credential") || strings.Contains(lower, "api_key") {
			result[key] = "[REDACTED]"
			continue
		}
		result[key] = sanitizeValue(value)
	}
	return result
}

// SanitizeText applies the audit log redaction and bounded-string rule to a
// string before it is written to any other durable operational ledger.
func SanitizeText(value string) string {
	return sanitizeValue(value).(string)
}

func sanitizeValue(value any) any {
	switch typed := value.(type) {
	case string:
		clean := secretAssignment.ReplaceAllString(typed, "$1=[REDACTED]")
		if len(clean) > 8192 {
			clean = clean[:8192] + "…[truncated]"
		}
		return clean
	case []string:
		out := make([]string, len(typed))
		for i, item := range typed {
			out[i] = sanitizeValue(item).(string)
		}
		return out
	case map[string]any:
		return sanitizeData(typed)
	case []any:
		// Anything that arrives as decoded JSON puts its objects inside []any,
		// and without this case neither redaction nor the length bound reached
		// them: a plan's operations, an execution's per-command stdout/stderr,
		// or any nested structure passed straight through untouched. That is the
		// one shape where an event is most likely to be both large and to carry
		// a credential echoed by a command.
		out := make([]any, len(typed))
		for index, item := range typed {
			out[index] = sanitizeValue(item)
		}
		return out
	default:
		return value
	}
}

func (b *Bus) ClearAll() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.history = make(map[string][]domain.Event)
}

func (b *Bus) Subscribe(sessionID string) (<-chan domain.Event, func()) {
	ch := make(chan domain.Event, 64)
	b.mu.Lock()
	if b.subscribers[sessionID] == nil {
		b.subscribers[sessionID] = make(map[chan domain.Event]struct{})
	}
	b.subscribers[sessionID][ch] = struct{}{}
	b.mu.Unlock()
	cancel := func() {
		b.mu.Lock()
		if _, ok := b.subscribers[sessionID][ch]; ok {
			delete(b.subscribers[sessionID], ch)
			close(ch)
		}
		b.mu.Unlock()
	}
	return ch, cancel
}
