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

// maxUnpersistedEventsPerSession bounds the in-memory fallback a persistent
// bus keeps for events its store refused. Persisted events are never kept in
// memory: History reads them back from the store.
const maxUnpersistedEventsPerSession = 256

type Bus struct {
	mu          sync.RWMutex
	history     map[string][]domain.Event
	subscribers map[string]map[chan domain.Event]struct{}
	store       EventStore
	observer    func(domain.Event)
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

// SetObserver registers a function that sees every published event after it
// is persisted, such as the operational log mirror. It must not block.
func (b *Bus) SetObserver(observer func(domain.Event)) {
	b.mu.Lock()
	b.observer = observer
	b.mu.Unlock()
}

func (b *Bus) Publish(sessionID, eventType string, data map[string]any) domain.Event {
	event := domain.Event{ID: ids.New("evt"), SessionID: sessionID, Type: eventType, Timestamp: time.Now().UTC(), Data: sanitizeData(data)}
	persisted := b.store != nil && b.store.AppendEvent(event) == nil
	b.mu.RLock()
	observer := b.observer
	b.mu.RUnlock()
	if observer != nil {
		observer(event)
	}
	b.mu.Lock()
	if !persisted {
		b.rememberLocked(event)
	}
	for ch := range b.subscribers[sessionID] {
		select {
		case ch <- event:
		default:
		}
	}
	b.mu.Unlock()
	return event
}

// rememberLocked keeps an event the store did not hold. A memory-only bus
// keeps its whole history; a persistent bus keeps only a bounded window.
func (b *Bus) rememberLocked(event domain.Event) {
	items := append(b.history[event.SessionID], event)
	if b.store != nil && len(items) > maxUnpersistedEventsPerSession {
		items = append([]domain.Event(nil), items[len(items)-maxUnpersistedEventsPerSession:]...)
	}
	b.history[event.SessionID] = items
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
			if len(b.subscribers[sessionID]) == 0 {
				delete(b.subscribers, sessionID)
			}
		}
		b.mu.Unlock()
	}
	return ch, cancel
}
