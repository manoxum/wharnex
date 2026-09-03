package audit

import (
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

type Bus struct {
	mu          sync.RWMutex
	history     map[string][]domain.Event
	subscribers map[string]map[chan domain.Event]struct{}
}

func NewBus() *Bus {
	return &Bus{
		history:     make(map[string][]domain.Event),
		subscribers: make(map[string]map[chan domain.Event]struct{}),
	}
}

func (b *Bus) Publish(sessionID, eventType string, data map[string]any) domain.Event {
	event := domain.Event{ID: ids.New("evt"), SessionID: sessionID, Type: eventType, Timestamp: time.Now().UTC(), Data: data}
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
	b.mu.RLock()
	defer b.mu.RUnlock()
	items := b.history[sessionID]
	out := make([]domain.Event, len(items))
	copy(out, items)
	return out
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
