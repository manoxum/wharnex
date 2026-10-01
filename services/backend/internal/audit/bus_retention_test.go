package audit

import (
	"errors"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

type failingEventStore struct{}

func (failingEventStore) AppendEvent(domain.Event) error { return errors.New("database unavailable") }
func (failingEventStore) EventHistory(string) ([]domain.Event, error) {
	return nil, errors.New("database unavailable")
}

// A persistent bus reads history from its store, so keeping every published
// event in memory as well grew the heap for the whole life of the process.
func TestPersistentBusDoesNotRetainPersistedEvents(t *testing.T) {
	bus := NewPersistentBus(&memoryEventStore{})
	for range 10 {
		bus.Publish("s1", "git.fetch_completed", map[string]any{"ok": true})
	}
	if retained := len(bus.history["s1"]); retained != 0 {
		t.Fatalf("persisted events must not stay resident, retained %d", retained)
	}
	if got := len(bus.History("s1")); got != 10 {
		t.Fatalf("history must still come from the store, got %d", got)
	}
}

func TestPersistentBusKeepsBoundedFallbackForUnpersistedEvents(t *testing.T) {
	bus := NewPersistentBus(failingEventStore{})
	for range maxUnpersistedEventsPerSession + 25 {
		bus.Publish("s1", "command.output", map[string]any{"stdout": "x"})
	}
	items := bus.History("s1")
	if len(items) != maxUnpersistedEventsPerSession {
		t.Fatalf("fallback must keep the newest %d unpersisted events, got %d", maxUnpersistedEventsPerSession, len(items))
	}
}

func TestSubscriptionCancelReleasesSessionEntry(t *testing.T) {
	bus := NewBus()
	_, cancel := bus.Subscribe("s1")
	cancel()
	if _, ok := bus.subscribers["s1"]; ok {
		t.Fatal("cancelling the last subscription must release the session's subscriber set")
	}
}
