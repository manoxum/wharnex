package session

import (
	"errors"
	"sync"

	"kernl.local/harness/backend/internal/domain"
)

var ErrNotFound = errors.New("session not found")

type Store struct {
	mu    sync.RWMutex
	items map[string]domain.Session
}

func NewStore() *Store { return &Store{items: make(map[string]domain.Session)} }

func (s *Store) Put(item domain.Session) {
	s.mu.Lock()
	s.items[item.ID] = item
	s.mu.Unlock()
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

func (s *Store) Update(id string, fn func(*domain.Session) error) (domain.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[id]
	if !ok {
		return domain.Session{}, ErrNotFound
	}
	if err := fn(&item); err != nil {
		return domain.Session{}, err
	}
	s.items[id] = item
	return item, nil
}
