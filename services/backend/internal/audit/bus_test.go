package audit

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

type memoryEventStore struct{ events []domain.Event }

func (s *memoryEventStore) AppendEvent(event domain.Event) error {
	s.events = append(s.events, event)
	return nil
}

func (s *memoryEventStore) EventHistory(sessionID string) ([]domain.Event, error) {
	var result []domain.Event
	for _, event := range s.events {
		if event.SessionID == sessionID {
			result = append(result, event)
		}
	}
	return result, nil
}

func TestPublishAndHistory(t *testing.T) {
	bus := NewBus()
	bus.Publish("s1", "session.created", map[string]any{"ok": true})
	items := bus.History("s1")
	if len(items) != 1 || items[0].Type != "session.created" {
		t.Fatalf("unexpected history: %#v", items)
	}
}

func TestPersistentBusRestoresBoundedRedactedHistory(t *testing.T) {
	store := &memoryEventStore{}
	bus := NewPersistentBus(store)
	bus.Publish("s1", "command.completed", map[string]any{"stdout": "ok", "token": "must-not-leak"})
	restarted := NewPersistentBus(store)
	items := restarted.History("s1")
	if len(items) != 1 || items[0].Data["token"] != "[REDACTED]" {
		t.Fatalf("persistent redacted history unavailable: %#v", items)
	}
}
