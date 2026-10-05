package sessionvault

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Memory is the vault used without a database (unit tests and bare local
// development). Sessions it holds end with the process.
type Memory struct {
	mu    sync.Mutex
	items map[string]Snapshot
}

func NewMemory() *Memory { return &Memory{items: map[string]Snapshot{}} }

func memoryKey(s Snapshot) string {
	return s.Project + "\x00" + s.EnvironmentID + "\x00" + s.TestID
}

func (m *Memory) Save(_ context.Context, snapshot Snapshot) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current, ok := m.items[memoryKey(snapshot)]; ok {
		snapshot.SID = current.SID
	} else {
		snapshot.SID = NewSID()
	}
	m.items[memoryKey(snapshot)] = clone(snapshot)
	return clone(snapshot), nil
}

func (m *Memory) Get(_ context.Context, project, sid string) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, item := range m.items {
		if item.Project == project && item.SID == sid {
			return clone(item), nil
		}
	}
	return Snapshot{}, ErrNotFound
}

func (m *Memory) List(_ context.Context, project string, now time.Time) ([]Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Snapshot{}
	for _, item := range m.items {
		if item.Project == project && item.ExpiresAt.After(now) {
			out = append(out, clone(item))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CapturedAt.After(out[j].CapturedAt) })
	return out, nil
}

func (m *Memory) Delete(_ context.Context, project string, filter Filter) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	removed := 0
	for key, item := range m.items {
		if item.Project == project && filter.matches(item) {
			delete(m.items, key)
			removed++
		}
	}
	return removed, nil
}

func (m *Memory) Prune(_ context.Context, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, item := range m.items {
		if !item.ExpiresAt.After(now) {
			delete(m.items, key)
		}
	}
	return nil
}

func clone(snapshot Snapshot) Snapshot {
	snapshot.Covers = append([]string(nil), snapshot.Covers...)
	digests := make(map[string]string, len(snapshot.Digests))
	for key, value := range snapshot.Digests {
		digests[key] = value
	}
	snapshot.Digests = digests
	return snapshot
}
