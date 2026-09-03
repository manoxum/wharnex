package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"kernl.local/harness/backend/internal/domain"
)

var ErrNotFound = errors.New("session not found")

const persistenceVersion = 1

type persistenceEnvelope struct {
	Version  int              `json:"version"`
	Sessions []domain.Session `json:"sessions"`
}

type Store struct {
	mu    sync.RWMutex
	items map[string]domain.Session
	path  string
}

func NewStore() *Store { return &Store{items: make(map[string]domain.Session)} }

func NewPersistentStore(path string) (*Store, error) {
	cleaned := ""
	if path != "" {
		cleaned = filepath.Clean(path)
	}
	store := &Store{items: make(map[string]domain.Session), path: cleaned}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Put(item domain.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[item.ID] = item
	if err := s.persistLocked(); err != nil {
		delete(s.items, item.ID)
		return err
	}
	return nil
}

func (s *Store) Get(id string) (domain.Session, error) {
	s.mu.RLock()
	item, ok := s.items[id]
	s.mu.RUnlock()
	if !ok {
		return domain.Session{}, ErrNotFound
	}
	return item, nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return ErrNotFound
	}
	delete(s.items, id)
	if err := s.persistLocked(); err != nil {
		s.items[id] = item
		return err
	}
	return nil
}

func (s *Store) Update(id string, fn func(*domain.Session) error) (domain.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return domain.Session{}, ErrNotFound
	}
	original := item
	if err := fn(&item); err != nil {
		return domain.Session{}, err
	}
	s.items[id] = item
	if err := s.persistLocked(); err != nil {
		s.items[id] = original
		return domain.Session{}, err
	}
	return item, nil
}

func (s *Store) load() error {
	if s.path == "" {
		return nil
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read session state: %w", err)
	}
	var envelope persistenceEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode session state: %w", err)
	}
	if envelope.Version != persistenceVersion {
		return fmt.Errorf("unsupported session state version %d", envelope.Version)
	}
	for _, item := range envelope.Sessions {
		if item.ID == "" || item.ProjectPath == "" {
			continue
		}
		if item.ExecutionMode == "" {
			item.ExecutionMode = domain.ExecutionModeProtected
		}
		if item.AutomationMode == "" {
			item.AutomationMode = domain.AutomationModeManual
		}
		s.items[item.ID] = item
	}
	return nil
}

func (s *Store) persistLocked() error {
	if s.path == "" {
		return nil
	}
	items := make([]domain.Session, 0, len(s.items))
	for _, item := range s.items {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	data, err := json.MarshalIndent(persistenceEnvelope{Version: persistenceVersion, Sessions: items}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode session state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create session state directory: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return fmt.Errorf("write session state: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace session state: %w", err)
	}
	return nil
}
