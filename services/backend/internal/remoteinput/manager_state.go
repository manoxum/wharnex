package remoteinput

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type record struct {
	InstanceID string    `json:"instance_id"`
	ObjectName string    `json:"object_name"`
	CreatedAt  time.Time `json:"created_at"`
	Bytes      int64     `json:"bytes"`
}

type managerState struct {
	Version  int                    `json:"version"`
	Records  []record               `json:"records"`
	Requests map[string][]time.Time `json:"requests"`
	Stopped  map[string]bool        `json:"stopped,omitempty"`
}

func (m *Manager) load() (managerState, error) {
	state := managerState{Version: 1, Records: []record{}, Requests: map[string][]time.Time{}, Stopped: map[string]bool{}}
	if m.indexPath == "" {
		return state, nil
	}
	raw, err := os.ReadFile(m.indexPath)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, fmt.Errorf("read remote storage state: %w", err)
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return state, fmt.Errorf("decode remote storage state: %w", err)
	}
	if state.Version != 1 {
		return state, errors.New("unsupported remote storage state version")
	}
	if state.Requests == nil {
		state.Requests = map[string][]time.Time{}
	}
	if state.Stopped == nil {
		state.Stopped = map[string]bool{}
	}
	return state, nil
}

func (m *Manager) save(state managerState) error {
	if m.indexPath == "" {
		return errors.New("remote storage requires a durable state file")
	}
	if err := os.MkdirAll(filepath.Dir(m.indexPath), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary := m.indexPath + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, m.indexPath)
}
