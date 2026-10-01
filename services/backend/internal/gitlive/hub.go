package gitlive

import (
	"context"
	"sync"
	"time"
)

type Sampler func(context.Context, string) (map[string][32]byte, error)

// Hub runs one Git observer per project, regardless of how many session
// streams or Desktop windows are currently showing it.
type Hub struct {
	mu       sync.Mutex
	watches  map[string]*watch
	interval time.Duration
	sample   Sampler
	changed  func(string)
}

type watch struct {
	sessions map[string]int
	pending  map[string]bool
	cancel   context.CancelFunc
}

func NewHub(interval time.Duration, sample Sampler, changed func(string)) *Hub {
	return &Hub{watches: make(map[string]*watch), interval: interval, sample: sample, changed: changed}
}

// Acquire keeps the observer alive while a stream needs it. The returned
// release function is idempotent, so every disconnect path can call it.
func (h *Hub) Acquire(projectPath, sessionID string) func() {
	h.mu.Lock()
	current := h.watches[projectPath]
	if current == nil {
		ctx, cancel := context.WithCancel(context.Background())
		current = &watch{sessions: make(map[string]int), pending: make(map[string]bool), cancel: cancel}
		h.watches[projectPath] = current
		go h.run(ctx, projectPath, current)
	}
	current.sessions[sessionID]++
	current.pending[sessionID] = true
	h.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.watches[projectPath] != current {
				return
			}
			current.sessions[sessionID]--
			if current.sessions[sessionID] == 0 {
				delete(current.sessions, sessionID)
				delete(current.pending, sessionID)
			}
			if len(current.sessions) == 0 {
				delete(h.watches, projectPath)
				current.cancel()
			}
		})
	}
}

func (h *Hub) run(ctx context.Context, projectPath string, current *watch) {
	read := func() (map[string][32]byte, error) {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return h.sample(attempt, projectPath)
	}
	var previous map[string][32]byte
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	for {
		latest, err := read()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				continue
			}
		}
		changed := previous != nil && len(Changed(previous, latest)) != 0
		h.mu.Lock()
		if h.watches[projectPath] != current {
			h.mu.Unlock()
			return
		}
		ids := make([]string, 0, len(current.sessions))
		for id := range current.sessions {
			if changed || current.pending[id] {
				ids = append(ids, id)
				delete(current.pending, id)
			}
		}
		h.mu.Unlock()
		for _, id := range ids {
			if ctx.Err() != nil {
				return
			}
			h.changed(id)
		}
		previous = latest
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
