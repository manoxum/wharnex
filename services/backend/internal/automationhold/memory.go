package automationhold

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Memory keeps holds for the process lifetime (unit tests, bare development).
type Memory struct {
	mu      sync.Mutex
	holds   map[string]Hold
	catalog Catalog
	now     func() time.Time
}

func NewMemory(catalog Catalog) *Memory {
	return &Memory{holds: map[string]Hold{}, catalog: catalog, now: time.Now}
}

func (m *Memory) Get(_ context.Context, name string) (Hold, error) {
	if !m.catalog.Known(name) {
		return Hold{}, ErrUnknownHold
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	hold, ok := m.holds[name]
	if !ok {
		return m.catalog.unset(name), nil
	}
	return hold, nil
}

func (m *Memory) Set(_ context.Context, hold Hold) (Hold, error) {
	hold, err := m.catalog.Normalize(hold, m.now().UTC())
	if err != nil {
		return Hold{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if previous, ok := m.holds[hold.Name]; ok {
		hold.UID = previous.UID
	}
	m.holds[hold.Name] = hold
	return hold, nil
}

func (m *Memory) List(context.Context) ([]Hold, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	holds := make([]Hold, 0, len(m.holds))
	for _, hold := range m.holds {
		holds = append(holds, hold)
	}
	sort.Slice(holds, func(i, j int) bool { return holds[i].Name < holds[j].Name })
	return holds, nil
}
